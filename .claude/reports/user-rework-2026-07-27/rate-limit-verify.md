# Adversarial verification — "Rate limiting and abuse protection" findings

Session date: 2026-07-27. All line numbers below were opened and read this session.

## Verdicts

### 1. xff-spoof-nginx-append-first-entry — CONFIRMED (blocker stands)
- `hotel-app-be/src/routes/mod.rs:56-73` `extract_client_ip` verified verbatim: when
  `trust_proxy_headers` is true, line 64 does
  `.and_then(|s| s.split(',').next())` — takes the FIRST (leftmost, client-controlled)
  comma-separated entry of `X-Forwarded-For`.
- `docs/guides/deployment.md:184-191` (under `#### 3. Frontend Deployment + Reverse
  Proxy`, part of `### Manual Deployment`) ships
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` at line 190 — nginx's
  documented append (not overwrite) directive.
- Stronger evidence than the auditor cited: `SECURITY.md:53` is explicit —
  "Set `TRUST_PROXY_HEADERS=true` only behind a trusted TLS-terminating proxy that
  **overwrites** `X-Forwarded-For` and `X-Real-IP`." The shipped nginx recipe in
  deployment.md does the opposite (appends). This is a direct self-contradiction
  between the repo's own security policy and its own deployment guide — better
  evidence than the auditor's citation of deployment.md:262 (a generic table row,
  not an explicit instruction for the nginx path).
- Verified via WebFetch (caddyserver.com/docs/caddyfile/directives/reverse_proxy):
  Caddy's `reverse_proxy` without `trusted_proxies` configured DISCARDS inbound XFF
  and sets its own value from the real peer — confirms the Caddy path (deploy/Caddyfile,
  no `trusted_proxies` directive present) does not share this flaw; it is specific to
  the nginx path as the auditor claimed.
- Correction to the impact paragraph: the "unlimited login/password-guessing... no
  lockout ever triggering" framing overstates the password-guessing case specifically.
  `services/auth.rs:75,82-113` (`AuthRepository::max_login_attempts`, default 5 via
  `repositories/auth.rs:93-94`) implements a PER-ACCOUNT, DB-persisted lockout
  (30 min, `is_locked`/`locked_until`) that fires regardless of which IP the request
  came from — spoofing X-Forwarded-For does NOT bypass this for plain password
  guessing.
  However, verified `services/auth.rs:123-210` (the login-embedded 2FA/recovery-code
  check): a wrong TOTP or recovery code during login returns `Unauthorized` at line 206
  with NO increment to `failed_login_attempts` and no lockout call — this path is
  protected ONLY by the per-IP `auth` limiter (5/60s), which the XFF-spoof bypass
  does defeat completely, with no account-side backstop at all. So the auditor's
  core exploitation avenue (2FA-code / recovery-code brute force once a password is
  already known, e.g. via a breach or phishing) is real and still blocker-class; the
  password-only framing is the overstated part.
- Verdict: CONFIRMED, severity blocker retained (2FA/recovery-code bypass alone
  justifies it), with the above nuance recorded.

### 2. trust-proxy-headers-default-collapses-limits — PARTIAL (citation error, substance confirmed)
- `docker-compose.yml:40` is `TRUST_PROXY_HEADERS: ${TRUST_PROXY_HEADERS:-false}` —
  the auditor cited line 33, which is actually
  `- "127.0.0.1:${BACKEND_PORT:-3030}:3030"` (the backend port mapping) and says
  nothing about `TRUST_PROXY_HEADERS`. Per the evidence rules this is a wrong
  citation, not proof of the claim.
- The underlying claim is still correct: `.env.example:79` is
  `TRUST_PROXY_HEADERS=false` (verified), and `routes/mod.rs:57-58`
  (`if !config::get().trust_proxy_headers { return peer_addr.ip(); }`) does collapse
  every request behind an unconfigured reverse proxy to one peer IP. Confirmed via
  `main.rs:262` that peer_addr comes from `into_make_service_with_connect_info::<SocketAddr>()`
  (the raw TCP peer), which a container/loopback-fronting proxy would present
  identically for every real visitor.
- Verdict: PARTIAL — substance holds, but fix the citation to `docker-compose.yml:40`.
  Severity unchanged (high).

### 3. no-rate-limit-on-user-rbac-mutations — CONFIRMED
- `routes/users.rs` (full 127-line file read): confirmed zero `RateLimiters`/rate
  limiter usage; `create_user` at 32/50, `update_user` 34/60, `delete_user` 35/72,
  `assign_role` 37/91, `replace_user_roles` 38/112, `remove_role` 39/102 all match
  exactly as cited.
- `routes/rbac.rs:1-80` read in full for the route table and several handlers — no
  rate limiter import or check anywhere.
- `grep -rn "\.api\b|check_rate_limit(" hotel-app-be/src --include="*.rs" | grep -v rate_limiter.rs`
  → zero hits, confirming `RateLimiters::api` (`core/rate_limiter.rs:208-210`,
  `#[allow(dead_code)]`) and `check_rate_limit` (245-262, also `#[allow(dead_code)]`)
  are referenced nowhere outside their own defining file.
- Verdict: CONFIRMED as written.

### 4. rate-limit-hits-never-logged — CONFIRMED
- `grep -rniE "log::(warn|info|error).*rate.?limit|rate.?limit.*log::" hotel-app-be/src`
  → exit 1, zero matches.
- `routes/auth.rs:58-89` (login) read in full: the 429 branch (lines 68-76) returns
  `ApiError::TooManyRequestsRetryAfter` with no logging/audit call.
  `routes/two_factor.rs:32-52` (setup_2fa) shows the identical pattern.
- Contrast confirmed: `services/auth.rs:99-106` and `:116` call
  `AuditLog::log_login_failure` on bad-password paths — the adjacent code the
  auditor pointed to really does log, while the rate-limit-rejection path never does.
- Verdict: CONFIRMED as written.

### 5. unbounded-map-growth-between-prunes — CONFIRMED
- `core/rate_limiter.rs:76` (`RateLimiter.entries: Arc<Mutex<HashMap<IpAddr, ...>>>`)
  and `:130` (`KeyedRateLimiter.entries: ... HashMap<String, ...>`), with prune loops
  at `:87-103` and `:141-156` sleeping 300s between `retain` passes — no max-size
  check anywhere in the 328-line file.
- Verdict: CONFIRMED as written (medium is a fair severity — real but requires either
  the XFF bypass or a large botnet to matter).

### 6. k8s-scaleout-defeats-inprocess-limiter — CONFIRMED
- `core/rate_limiter.rs:4` doc comment: "Suitable for single-instance deployments
  (hotel PMS)." `core/rbac_cache.rs:15`: "Single-process design (mirrors
  `crate::core::rate_limiter`)."
- `routes/mod.rs:200` `RateLimiters::new()` constructed once; `:256`
  `.layer(axum::Extension(rate_limiters))` shares that single instance.
- `grep -n "deploy:|replicas:" docker-compose.yml` → zero hits (no scale-out
  configured today).
- `docs/guides/deployment.md:205-214` (`### Docker Swarm / Kubernetes`) lists
  `Deployment` resources for backend/frontend with no replica-count guidance or
  rate-limiter caveat.
- Verdict: CONFIRMED as written, correctly self-labeled latent/unverified-in-practice
  by the auditor since no k8s manifest exists in-repo.

### 7. get-users-no-pagination — CONFIRMED
- `routes/users.rs:42-48` `get_users` takes no `Query` extractor.
- `handlers/users.rs:14-18` → `services/users.rs:22-28` (`svc::users`) →
  `repositories/user.rs:48-55` (`UserRepository::list_all`):
  `sqlx::query_as::<_, User>(&format!("SELECT {USER_COLUMNS} FROM users WHERE
  deleted_at IS NULL ORDER BY username")).fetch_all(pool)` — confirmed no
  LIMIT/OFFSET anywhere.
- Verdict: CONFIRMED as written.

### 8. unbounded-role-ids-array-sequential-inserts — CONFIRMED
- `models/rbac.rs:66-69`: `pub struct UserRoleIdsInput { pub role_ids: Vec<i64> }` —
  no length validation attribute, no `Validate` derive at all on this struct.
- `repositories/rbac.rs:448-478` `replace_user_roles`: begins a transaction, deletes
  existing rows (458-462), then a `for role_id in role_ids` loop (464-473) doing one
  `sqlx::query(...).bind(user_id).bind(role_id).execute(&mut *tx).await` per element —
  no batching/unnest.
- `grep -rn "DefaultBodyLimit" hotel-app-be/src` → only `routes/data_transfer.rs` and
  `routes/guest_portal.rs` override it; `routes/users.rs`/`rbac.rs` do not, so the
  request is bounded only by axum's default extractor body limit.
- Verdict: CONFIRMED as written.

### 9. resend-verification-unthrottled-email-bomb — PARTIAL (unthrottled fact real, impact overstated)
- `routes/auth.rs:149-154` confirmed verbatim: no `RateLimiters`/`ConnectInfo`
  extraction, no limiter check — unlike every sibling auth endpoint in the same file.
- `services/auth.rs:466-488` `resend_verification` confirmed: looks up by email,
  returns the same generic response either way (476, 480, 487 — no enumeration leak,
  as the auditor said), and on the "found + unverified" branch calls
  `AuthService::create_email_verification_token(pool, user.id)` at line 483.
- However, tracing `create_email_verification_token`
  (`core/auth.rs:515-538`) shows it performs ONLY a
  `UPDATE users SET email_verification_token = ..., email_token_expires_at = ...`
  — it does **not** send an email. Repo-wide check: the only email/SMTP
  infrastructure in the backend is `modules/communications/transport.rs`
  (lettre-based), wired through `modules/communications/service.rs` and `worker.rs`
  for the guest-communications/campaign domain — grepped for
  "verification"/"verify_email"/"EmailVerif" inside that module: zero hits. No
  `mail`/`email` utility module exists anywhere else under `hotel-app-be/src`
  (`find ... -iname "*email*" -o -iname "*mail*"` → empty). The register flow
  (`services/auth.rs:416-428`) calls the identical token-creation function and then
  tells the user "check your email" (line 425), but there is no code path in this
  backend that actually dispatches that email today.
- Corrected impact: hitting `resend-verification` at unlimited rate causes cheap,
  unthrottled `UPDATE users` writes per request (a minor DB-write amplification
  lever, and it does needlessly invalidate/rotate any outstanding legitimate
  verification token for that user on every call) — but NOT "email-bombing" an
  inbox or "driving up outbound email provider cost," because no outbound email is
  currently sent by this feature at all. The missing rate limit is still a real,
  worth-fixing inconsistency (and will matter immediately if/when email dispatch is
  wired up), but the stated high-severity abuse impact does not hold today.
- Verdict: PARTIAL. corrected_severity: low.

## Missed findings (new, same evidence rules)

1. **2FA/recovery-code guessing during login has no account-level lockout at all**
   (distinct from password guessing, which does). `services/auth.rs:123-210`:
   once a client submits the right username+password (or an attacker already knows
   them, e.g. from a breach) but a wrong `totp_code`/recovery code, the handler
   returns `Unauthorized` (line 206) with no call to
   `AuthRepository::update_failed_login_attempts`/`lock_user_after_failure` — those
   only fire in the earlier `if !valid` **password** branch (lines 81-121). The sole
   defense is the shared per-IP `auth` `RateLimiter` (5/60s) checked in
   `routes/auth.rs:66-67`, which is (a) bypassable via the XFF-spoof bug (finding 1)
   and (b) trivially spread across a modest number of genuine source IPs even
   without any header spoofing, since there is no per-account counter to fall back
   on. Severity: high — this is a materially different (and more exploitable) gap
   than the password path the auditor's own account-lockout evidence would suggest
   exists uniformly.

2. **`SECURITY.md:53` and `docs/guides/deployment.md:190` directly contradict each
   other** — SECURITY.md instructs contributors to enable `TRUST_PROXY_HEADERS`
   "only behind a trusted TLS-terminating proxy that **overwrites**
   `X-Forwarded-For`," while the deployment guide's own copy-paste nginx recipe uses
   `$proxy_add_x_forwarded_for`, which **appends** rather than overwrites. This is
   the precise, citable root of finding 1 and is worth fixing as its own
   documentation-consistency item (swap the recipe to
   `proxy_set_header X-Forwarded-For $remote_addr;` or add explicit
   `trusted_proxies`-equivalent hardening) independent of any code change to
   `extract_client_ip`. Severity: high (it is the direct enabler of a blocker).

3. **Authenticated profile/session/passkey-management routes have zero rate
   limiting**, extending the same "general API bucket is dead code" pattern the
   auditor found in users.rs/rbac.rs to a different file. Verified in
   `routes/profile.rs:22-40`: `GET /profile`, `PATCH /profile`,
   `GET /profile/sessions`, `DELETE /profile/sessions/{id}`,
   `GET /profile/passkeys`, `DELETE /profile/passkeys/{id}`,
   `PATCH /profile/passkeys/{id}` all call only `require_auth` with no
   `RateLimiters` extraction (only `/profile/password` and the profile 2FA routes
   use `limiters.sensitive`, per lines 62-96 read separately). Impact: a stolen or
   leaked access token can be used to enumerate a user's active sessions/passkeys or
   mass-revoke them at unlimited request rate with no throttling. Severity: medium.

4. **The `auth` limiter is a single un-keyed-by-endpoint bucket shared across
   `/auth/login`, `/auth/passkey/login/start`, and `/auth/passkey/login/finish`**
   (verified: `routes/auth.rs:67`, `routes/passkey.rs:82,104` all call
   `limiters.auth.check_with_retry(ip)` against the same `RateLimiter` instance).
   Combined with finding 2 (default `TRUST_PROXY_HEADERS=false` collapsing all
   visitors behind a proxy to one IP), any one of these three flows being hammered
   from a shared-IP context exhausts the budget for the other two as well — e.g. an
   attacker's passkey-login-start spam can lock out password-login for every real
   user sharing that apparent IP. This compounds finding 2 rather than standing
   fully apart from it, so reported at low/informational severity, but was not
   called out by the auditor as a cross-endpoint-sharing detail.

5. **`verify-email` (`routes/auth.rs:44,142-147`) is also completely unthrottled**,
   same pattern as `resend-verification` — but unlike that endpoint, this is
   confirmed low-impact: `core/auth.rs:508-512`
   (`generate_email_verification_token`) uses a 256-bit random hex token
   (`rand::rng().random::<[u8;32]>()`), which is not brute-forceable regardless of
   rate limit, so flagging only as a minor consistency nit, not a real abuse vector.
