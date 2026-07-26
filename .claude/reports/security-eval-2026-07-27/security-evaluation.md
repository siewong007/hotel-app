# Security Evaluation — Hotel PMS

**Date:** 2026-07-27
**Scope:** `hotel-app-be`, `hotel-web-fe`, `hotel-desktop`, `deploy/`, `.github/`
**Method:** 7 audited dimensions (authn, authz, injection, secrets, DoS, infra, detection), each independently re-verified by an adversarial reviewer. Findings the reviewer refuted are excluded from this document. Every claim below carries a `path:line` anchor.

---

## 1. Verdict

**Posture: strong application-layer security, near-zero operational visibility.**

This codebase has genuinely good security hygiene and you should not rebuild the parts that work. The authentication core is correct in ways that most projects get wrong: `JWT_SECRET` has no fallback and the process exits at startup if it is missing or short (`hotel-app-be/src/core/config.rs:141-142`, `src/main.rs:122-126`); refresh tokens are 256-bit, SHA-256 hashed before storage, and rotated with an atomic single-winner UPDATE (`src/core/auth.rs:260-271`, `:331-355`); a global middleware re-validates every session against the live database row on every request, so logout and deactivation take effect immediately (`src/routes/mod.rs:79-119`, `:241-244`). Authorization coverage is broad and real — every domain router is actually merged (`src/routes/mod.rs:203-227`), role-priority hierarchy genuinely blocks privilege escalation into the admin tier (`src/services/rbac.rs:349-353`), and IDOR checks exist where they matter (`src/services/guest_portal.rs:487-495`). SQL injection is effectively closed: every dynamic `ORDER BY` and table name in the repository goes through an exhaustive `match` or a hardcoded allowlist (`src/repositories/ledger.rs:159-166`, `src/repositories/data_transfer.rs:19-79`). Uploads validate magic bytes rather than `Content-Type` (`src/modules/ekyc/validation.rs:35-57`). The production deployment is well built — Postgres has no published port on an `internal: true` network (`deploy/docker-compose.prod.yml:152-154`), secrets are generated with `openssl rand` and written `0600` (`deploy/deploy.sh:138-159`), and the release bundle is checksum-verified (`deploy/deploy.sh:65-68`).

The real gap is not a vulnerability — it is that **you cannot see your own server**. Production runs `RUST_LOG: warn` (`deploy/docker-compose.prod.yml:83`) while the request-tracing layer emits at DEBUG (`src/routes/mod.rs:264`), and the production Caddy config generated at `deploy/deploy.sh:361-382` has no `log` directive. There is no access log at either layer. Rate-limit rejections write nothing anywhere (`grep -n "log::" src/core/rate_limiter.rs` → no matches across 328 lines). 401/403 denials are never logged (`src/core/error.rs:112-119`). Login audit rows discard the IP the code already computed (8 sites in `src/services/auth.rs`). And SMTP is not configured in production at all (`grep -rn SMTP deploy/` → no matches), so nothing can email you even if it wanted to.

Two things override that general picture and need action soon. First, `PATCH /api/bookings/{id}/pre-checkin` takes no authentication at all and is live in production (present in `HEAD`; production deploys from `master`). Its guest-PII write is inert — it names columns that do not exist and aborts — so what it actually leaks is unauthenticated booking-id and occupancy enumeration. It is nonetheless a latent write primitive: fixing the column names below would turn it into a mass-PII-overwrite endpoint, so **remove the route before fixing H1**. Second, a **live production-breaking bug** that is not a security issue but is costing you today: four guest-lookup queries reference those same nonexistent column names, confirmed empirically against the running database (Finding H1).

Both are cheap to fix. Neither changes the overall assessment: the engineering here is good, and the thing you are missing is not more controls but the ability to see what your server is doing.

> **A note on how this document was produced.** Three claims in early drafts were wrong and were corrected only by testing against the running system rather than by reading code: the pre-checkin route's status (working tree vs `HEAD`), its exploitability (assumed vs proven inert), and its severity. Sections marked *corrected* carry the tested conclusion. Treat unmarked severities as code-review judgment, not empirical fact.

---

## 2. What is already strong — do not rebuild these

| Control | Where | Why it counts |
|---|---|---|
| JWT secret required, validated, hard-fail at startup | `hotel-app-be/src/core/config.rs:141-142`; `src/main.rs:122-126`, `:152-155` | No default fallback. Process exits rather than booting insecure. |
| JWT algorithm fixed to HS256 both directions | `src/core/auth.rs:157-161`, `:195-202` | `alg:none` / algorithm-confusion is structurally impossible. |
| Refresh tokens hashed at rest, atomic rotation | `src/core/auth.rs:260-264`, `:267-271`, `:331-355` | Replay cannot win the UPDATE twice. DB dump does not yield usable tokens. |
| Live session re-validation on every request | `src/routes/mod.rs:79-119`, `:241-244`; `src/core/auth.rs:425-448` | Checks `is_active`, `is_locked`, `deleted_at`. Logout is immediate, not TTL-bound. |
| Per-account lockout independent of IP | `src/services/auth.rs:82-97`; `src/repositories/auth.rs:93-95` | 5 attempts → 30 min lock + all sessions revoked. Survives IP spoofing. |
| 2FA recovery codes hashed, constant-time compare, atomic consumption | `src/core/auth.rs:639-641`, `:706-728`, `:870-890` | `array_remove ... RETURNING` makes double-spend impossible. |
| Real WebAuthn verification with UV flag enforcement | `src/services/passkey.rs:275-296`, `:675-680` | ECDSA P-256 signature check, counter regression check, user-verification required. |
| Role-priority hierarchy blocks upward privilege escalation | `src/services/rbac.rs:332-357`, `:349-353`; `database/postgres/data.sql:387-388` | admin=100 vs super_admin=1000; `role_priority >= actor_priority` forbids. |
| Guest portal session isolation | `src/services/guest_portal.rs:25-36`; `src/repositories/guest_portal_session.rs:38-47` | 256-bit CSPRNG, SHA-256 stored, no privilege overlap with staff JWTs. |
| All dynamic SQL allowlisted | `src/repositories/ledger.rs:159-166`; `src/repositories/data_transfer.rs:19-79`, `:78-84` | No user string ever reaches a statement unparameterized. |
| Upload magic-byte validation + traversal guard | `src/modules/ekyc/validation.rs:35-57`; `src/services/payments.rs:1921-1943` | `canonicalize()` + `starts_with()` on read-back; UUID filenames. |
| Private uploads never statically served | `src/routes/mod.rs:252` | Only `uploads/public` is mounted; eKYC docs are auth-gated routes. |
| Email template variables HTML-escaped | `src/modules/communications/validation.rs:201-214`, `:219-249` | Guest-supplied values cannot inject into campaign HTML. |
| PayPal webhook verified upstream, not by local HMAC | `src/services/paypal_client.rs:339-343`; `src/handlers/webhooks.rs:60` | Avoids the attacker-supplied-cert_url vulnerability class. |
| Production Postgres unreachable from outside Docker | `deploy/docker-compose.prod.yml:152-154` (no `ports:` on the postgres service) | Not merely firewalled — structurally isolated. |
| Deploy secrets generated strongly, `0600`, length-validated | `deploy/deploy.sh:13`, `:138-159` | `umask 077`, `openssl rand -hex 32/48`, regex strength check each run. |
| SSH host key pinned; no `workflow_dispatch` to prod | `.github/workflows/deploy.yml:11-12`, `:15-16`, `:157-158` | MITM-resistant; untested revisions cannot reach production. |
| Full-history secret scanning already in CI | `.github/workflows/security.yml:16-25` | `gitleaks` with `fetch-depth: 0` on push, PR, and weekly cron. |
| No `pull_request_target`; no event data in shell | `.github/workflows/*.yml` (grep → no matches) | Workflow script-injection surface is clean. |
| Frontend never persists the access token | `hotel-web-fe/src/auth/tokenStore.ts` (module variable); `src/utils/storage.ts:8-17` | Refresh token is HttpOnly cookie only (`src/handlers/auth.rs:36-44`). |
| RBAC cache invalidated on every mutation | `src/services/rbac.rs:94,107,118,130,147,177,212`; `src/services/users.rs:166,207` | Revoked access does not linger for a cache TTL. |
| Audit log table is real forensic infrastructure | `database/postgres/migrations/0001_v1_baseline.sql:1158`, `:5035`, `:6208-6264` | Monthly RANGE partitions with a DEFAULT catch-all; indexed on action, created_at, resource, and a GIN trigram on details. |
| Money domains have near-complete audit coverage | `src/services/ledgers.rs` (8 `AuditLog::` calls); `src/services/payments.rs` (15) | Every ledger and payment mutation is recorded. |

---

## 3. Findings

Severity reflects impact **on a single-tenant, owner-operated hotel PMS** — not a generic web-app rubric. An "insider with staff credentials" is a much narrower threat here than in a multi-tenant SaaS, and findings are calibrated accordingly.

### HIGH — `PATCH /api/bookings/{id}/pre-checkin` is unauthenticated and is live in production

*(This section was corrected twice. Draft 1 called the route "no longer exists" — it read the working tree, where an uncommitted edit removes it, while production deploys from `master` where it remains. Draft 2 over-corrected to "blocker", asserting a mass-PII-overwrite exploit that empirical testing then disproved. The assessment below is the tested one: the route is real and live, the write does not work, and the severity is **high**.)*

The route rewrites guest PII with no authentication of any kind:

```
git show HEAD:hotel-app-be/src/routes/bookings.rs
 57:  .route("/bookings/{id}/pre-checkin", patch(pre_checkin_update))
221:  async fn pre_checkin_update(
226:      // Public endpoint - no authentication required for pre-check-in
227:      handlers::bookings::pre_checkin_update_handler(State(pool), path, Json(input)).await
```

There is no `require_auth`, no `require_permission_helper`, no token gate. The handler accepts a raw integer booking id and overwrites guest name, email, IC/passport number and address — including the email address that gates guest-portal access.

**Why this is live, not hypothetical:**

| Fact | Evidence |
|---|---|
| Production deploys from `master` on CI success | `.github/workflows/deploy.yml:18-20` (`workflow_run` → `branches: [master]`) |
| Current branch is `master`, HEAD `313d1f397` | `git rev-parse --abbrev-ref HEAD` |
| The route is present in `HEAD` | `git show HEAD:…/routes/bookings.rs` (above) |
| The removal is **committed nowhere** | `git log --all -S "pre_checkin_update" -- …/routes/bookings.rs` returns only `be37c5394`, the commit that *added* it |
| The removal exists only as an uncommitted working-tree edit | `git diff --stat` → 102 deletions across `routes/bookings.rs`, `handlers/bookings.rs`, `repositories/bookings/lifecycle.rs` |

So the deployed build serves this endpoint. The safer replacement — `POST /guest-portal/pre-checkin/{token}`, token-gated, rate-limited and audited (`src/routes/guest_portal.rs:32`, `src/services/guest_portal.rs:135`) — already exists, but the insecure route has not been retired anywhere a deploy can see.

**Exploit — corrected after empirical testing.** An earlier draft of this section claimed an attacker could rewrite every guest's email and take over guest-portal accounts. **That is wrong, and the correction matters for how urgently you treat this.** The handler's `UPDATE guests` names `address_line1` and `state_province`, which do not exist — the columns are `address_line_1` and `state` (`0001_v1_baseline.sql:1569`, `:1572`). Proven against the live `hotel-db` container:

```
UPDATE guests SET ..., address_line1=NULL, ..., state_province=NULL, ... WHERE id = 1;
ERROR:  column "address_line1" of relation "guests" does not exist
```

The statement aborts before writing, so **no guest PII is ever modified**. This is the same defect as Finding H1, and here it accidentally neutralises the write.

What remains real:

- **Unauthenticated booking enumeration.** The handler reads `SELECT id, guest_id, status FROM bookings WHERE id = $1` *before* the failing UPDATE and branches on the result, returning three distinguishable responses: `404 "Booking not found"`, `400 "Cannot pre-check-in booking with status: {status}"`, and `500` for a valid pending/confirmed booking. Walking ids 1..N therefore reveals which booking ids exist and the exact status of each — occupancy intelligence, disclosed to anyone on the internet.
- **Unauthenticated database load.** The route has no rate limiter (`routes/bookings.rs:54` registers it with no `limiters` extension), so each request costs an indexed query plus a failed UPDATE against a 192MB-capped container.
- **A latent write primitive.** The moment anyone fixes the column names — exactly what Finding H1 asks you to do — this silently becomes the mass-PII-overwrite endpoint the earlier draft described. Fixing H1 without removing this route would *create* the blocker.

**Revised severity: high, not blocker.** Still remove it, and remove it before fixing H1.

**Action, in order:**
1. Commit the working-tree removal and let CI deploy it. This is the single most urgent action in this document.
2. Until that deploy lands, block the path at the edge — add to the `@backend` handler in the Caddy config generated at `deploy/deploy.sh:361-382`:
   ```
   @precheckin path_regexp ^/api/bookings/[0-9]+/pre-checkin$
   respond @precheckin 404
   ```
3. Because the working tree is shared with concurrent sessions (this repo has a documented history of that), do not leave the only copy of a security fix uncommitted.

> **Process finding.** A security fix living solely in an uncommitted working tree is indistinguishable from no fix at all, and it inverts the reviewer's picture — an auditor reading the tree concludes "fixed", while production is exposed. Commit security fixes immediately, even if the surrounding feature work is unfinished.

---

### HIGH

#### H1 — Four guest queries reference columns that do not exist (live 500s) *(availability, not security)*

**Where:** `hotel-app-be/src/repositories/guest.rs:42` (`find_all`), `:83` (`find_by_email`), `:100` (`find_by_user_id`), `:128` (`create` RETURNING). Also `src/repositories/guest_portal.rs:146,153` and `src/repositories/bookings/lifecycle.rs:2210,2218,2924,2932`.

The schema declares `address_line_1` and `state` (`database/postgres/migrations/0001_v1_baseline.sql:1569,1572`). These queries select and update `address_line1` and `state_province`. The sibling function `find_by_id` gets it right with aliases (`src/repositories/guest.rs:58`: `address_line_1 as address_line1, city, state as state_province`), which is the proof this is a typo class and not a schema I failed to find.

**Verified empirically** against your running `hotel-db` container:

```
$ docker exec hotel-db psql -U hotel_admin -d hotel_management \
    -c "SELECT id, full_name, address_line1, city, state_province FROM guests WHERE deleted_at IS NULL LIMIT 1;"
ERROR:  column "address_line1" does not exist
HINT:  Perhaps you meant to reference the column "guests.address_line_1".
```

**Exploit scenario:** No attacker required. Any staff member listing guests, looking a guest up by email, or completing a check-in that touches address fields gets a 500. `cargo check --all-features` cannot catch this — these are plain `sqlx::query_as` calls, not the compile-checked macros.

**Fix:** Alias consistently, exactly as `find_by_id` does. Add one live-Postgres test per repository function that actually fetches a `Guest`.

**Would you even know?** Yes — as a user complaint. It surfaces as `ApiError::Database` → a generic 500 (`src/core/error.rs:105-111`), with the real cause logged server-side into `/opt/saliminn/logs/backend-*.log`. But nothing alerts you, and the generic client message means the report reaching you will be "the guest list is broken", not the column name.

---

#### H2 — `docker-compose.yml` ships a publicly-known default JWT signing key

**Where:** `docker-compose.yml:35` — `JWT_SECRET: ${JWT_SECRET:-CHANGE_ME_TO_RANDOM_STRING_MIN_32_CHARACTERS_LONG_FOR_SECURITY}`, and `:10` for `POSTGRES_PASSWORD`.

That literal is 62 characters, so it passes the only check that exists — `validate_jwt_secret` tests length against `MIN_JWT_SECRET_LEN = 32` and nothing else (`src/core/config.rs:267-276`, `:10`). The backend boots happily. Anyone with this file can forge a JWT for any user id with any roles.

The two sibling compose files use the hard-fail form: `hotel-app-be/docker-compose.yml:7` and `deploy/docker-compose.prod.yml:72` (`${JWT_SECRET:?JWT_SECRET is required}`). The documented VPS path is safe — `deploy/deploy.sh:138-159` generates real secrets. The exposure is this root compose file, whose `--profile https` caddy service publishes 80/443 on all interfaces (`docker-compose.yml:88-90`).

**Exploit scenario:** Someone brings up the root compose for a demo, a staging box, or a second property without setting env vars. Every token in that deployment is forgeable by anyone who has read the repo. Total auth bypass — create bookings, issue refunds, read every guest's passport number.

**Fix:** Change `:-` to `:?` on lines 10, 34, 35. Additionally add a placeholder blocklist to `validate_security` (`src/core/config.rs:182-209`) so a `CHANGE_ME`-prefixed secret refuses to boot.

**Would you even know?** No. A forged token is cryptographically valid and passes `enforce_active_session` if it names a real session. It is indistinguishable from a real login in every record you keep.

---

#### H3 — Client-controlled `X-Forwarded-For` defeats every per-IP rate limiter in production

**Where:** `src/routes/mod.rs:56-73` — when `trust_proxy_headers` is set, `extract_client_ip` takes `.split(',').next()`, the **first** entry, which is the value the client sent, not the one the proxy appended.

`deploy/docker-compose.prod.yml:81` sets `TRUST_PROXY_HEADERS: "true"`. The production Caddy config generated at `deploy/deploy.sh:361-382` is a bare `reverse_proxy` with no `header_up X-Forwarded-For {remote_host}` and no `trusted_proxies` (verified: no such directive anywhere in `deploy/`). Caddy's documented default appends the peer address rather than replacing it — *unverified against your specific Caddy version; confirm before acting.*

**Exploit scenario:** One host rotates a spoofed `X-Forwarded-For` per request and bypasses the register limiter (10/600s), the webhook limiter (60/60s), and the guest-portal verify ceiling entirely. The practical worst case for a hotel is **denial of service against yourself**: combined with the per-account lockout at 5 attempts / 30 minutes (`src/services/auth.rs:83-110`), a single host can keep every staff account permanently locked out during check-in rush.

Password brute force is *not* enabled by this — the account lockout is IP-independent and still holds.

**Fix:** Parse `X-Forwarded-For` right-to-left and take the last hop, **and** add `header_up X-Forwarded-For {remote_host}` to the reverse_proxy block in `deploy/deploy.sh:369-378`. Do both; either alone is fragile.

**Would you even know?** No. Spoofed requests look like distinct legitimate client IPs everywhere. And because login audit rows record no IP at all (M4), the only source-address record you have — `refresh_tokens.ip_address` — is itself the forged value.

---

#### H4 — No request-level telemetry at either layer

**Where:** `src/routes/mod.rs:264` (`TraceLayer::new_for_http()` with no `make_span_with` override → spans emit at DEBUG) combined with `deploy/docker-compose.prod.yml:83` (`RUST_LOG: warn`). And `deploy/deploy.sh:361-382` — the production Caddy site block has no `log` directive.

In development this works: `grep -c tower_http hotel-app-be/logs/backend-2026-07-26.log` returns 82 lines with method, URI, status and latency. In production, zero.

**Exploit scenario:** An attacker enumerates `/api/*` endpoints, probes for path traversal, floods 404s, or scrapes the guest portal. Not one request is recorded anywhere. You cannot answer "how many requests did we serve last hour", "which endpoint is slow", or "was there a scan".

**Fix:** Two independent changes. (a) Raise the TraceLayer's own span level above the global filter rather than raising `RUST_LOG` — note that `RUST_LOG=warn,tower_http=debug` **will not work**, because `src/core/config.rs:238-246` matches only the exact strings `trace`/`debug`/`warn`/`error` and falls through to `Info` for anything else. (b) Add a `log` directive to the Caddy heredoc.

**Would you even know?** This *is* the "would you know" problem. Answer: no, about anything traffic-shaped.

---

#### H5 — Whole-database export is unaudited

**Where:** `src/routes/data_transfer.rs:19` (`GET /data-transfer/export`), gated only by `require_permission_helper(&pool, &headers, "settings:manage")` at `:30`. `grep -c "AuditLog::" src/handlers/data_transfer.rs src/services/data_transfer.rs src/routes/data_transfer.rs` returns **0, 0, 0**.

`src/services/data_transfer.rs:209-271` exports `guests`, `companies`, `bookings`, `payments`, `invoices`, `customer_ledgers`, `customer_ledger_payments` and ~25 more tables — with no LIMIT, buffered entirely into one JSON response.

**Exploit scenario:** A compromised or departing admin session issues one GET and walks away with every guest's name, email, phone, IC/passport number and full payment history, plus your entire ledger. This is the largest exfiltration channel in the product and it is the one with no record.

**Fix:** One `AuditLog::log_event` call in the handler (action `data_export`, resource_type `system`, with row counts). Add a single-permit semaphore while you are there — the 100MB import counterpart at `src/routes/data_transfer.rs:20-23` runs against a 192MB container (`deploy/docker-compose.prod.yml:107`).

**Would you even know?** No. No audit row, no log line at production verbosity, no access log. The only artifact is outbound bytes you cannot see.

---

#### H6 — Seven room endpoints are login-only and leak guest identity plus financials

**Where:** `src/services/rooms.rs:1271, 1314, 1365, 1377, 1391, 1402, 1413` — each begins `let _user_id = require_auth(&headers).await?;`. The user id is bound to an underscore and discarded, so no permission check is possible downstream. Routed at `src/routes/rooms.rs:40,41,48,49,50,51,52`; `src/handlers/rooms.rs:158-215` is a pure passthrough with no guards.

`GET /api/rooms/{id}/detailed` returns `RoomDetailedStatus`, whose `current_booking`/`next_booking` are `BookingWithDetails` carrying `guest_name`, `guest_email` (`src/models/booking.rs:296-297`) plus `total_amount`, `payment_status`, `total_paid`, `balance_due` (`:308-310`, `:326-328`).

**Exploit scenario:** The `housekeeping` role is seeded with only `rooms:read/update`, `housekeeping:*`, `maintenance:read/write` (`database/postgres/data.sql:565-570`) — deliberately no `bookings:read`, no `guests:read`, no `payments:read`. Yet any housekeeping login reads guest names, guest emails and the full financial state of every room. Same for `staff` (`data.sql:574-577`) and `support_readonly` (`:614-616`). This is a designed permission boundary that silently does not hold.

Note the contrast: all 13 *mutating* handlers in the same file correctly use `require_permission_helper` (`src/services/rooms.rs:403,414,425,488,556,604,864,924,987,1038,1156,1208`). Only the read handlers were missed.

**Fix:** `require_permission_helper(&pool, &headers, "bookings:read")` on `:1271` and `:1314`; `"rooms:read"` on the five occupancy endpoints. Or strip guest/financial fields from the room projection.

**Would you even know?** No. These are successful 200s from a legitimately authenticated account. No audit row, no denial to log.

---

#### H7 — Production runs a pre-release database engine

**Where:** `deploy/docker-compose.prod.yml:21` — `image: postgres:19beta2`. Also `docker-compose.yml:3`, `hotel-app-be/docker-compose.yml:3`, and the desktop bundle.

PostgreSQL betas carry no on-disk-format stability guarantee and no supported upgrade path to GA. Your live bookings, payments and ledgers sit on it. Combined with F-M12 (no scheduled backup) this is the largest data-loss exposure in the deployment.

**Fix:** Plan a migration to PostgreSQL 18 GA or wait for 19 GA with a tested `pg_dump`/restore path. Until then, treat F-M12 as urgent rather than routine.

**Would you even know?** Only after the fact. A beta-specific corruption or a failed GA upgrade surfaces as data loss, not as an alert.

---

#### H8 — Guest-portal rate limiter is keyed on raw attacker-controlled strings with no length cap

**Where:** `src/routes/guest_portal.rs:234-237` — `limiters.guest_portal_token_read.check_with_retry(path.0.clone())`, keying the map on the raw URL token. Same shape at `:257-260`, `:279-282`. And `:206-215` keys on `input.booking_number` from JSON body, before any validation.

`src/core/rate_limiter.rs:130` is `Arc<Mutex<HashMap<String, RateLimitEntry>>>`; `:162-163` does `.entry(key.into()).or_insert_with(...)`; `:58-60` unconditionally allows *and allocates* the first hit of any new key. A "5 per window" rule only limits repeats of the same key — a flood of distinct garbage is never throttled.

Worse, `GET /guest-portal/booking/{token}` (`:229-249`) has **only** the keyed check and no IP ceiling in front of it, unlike `/guest-portal/verify` which does (`:195`).

**Exploit scenario:** Distinct garbage tokens, each up to ~400KB (hyper's request-head limit), each living ~20 minutes given the 900s window (`src/core/rate_limiter.rs:238`) plus 300s eviction cadence (`:141-153`). A few hundred such requests reach the 192MB container cap (`deploy/docker-compose.prod.yml:107`) and OOM-kill the backend.

**Fix:** Validate token shape and length **before** the limiter call. The codebase already does exactly this one file over — `src/handlers/webhooks.rs:45-58` truncates attacker-controlled values with `.chars().take(128)`. Also add an IP ceiling to `get_booking` to match `/verify`.

**Would you even know?** No in-app signal. Only host RSS growth or a Docker restart of `saliminn-backend`.

---

### MEDIUM

| # | Finding | Where | Exploit scenario | Fix | Would you even know? |
|---|---|---|---|---|---|
| M1 | `failed_login_attempts` is a read-modify-write, not an atomic increment | `src/repositories/auth.rs:120` — `UPDATE users SET failed_login_attempts = $1 WHERE id = $2` (absolute SET); read at `:68`, computed at `src/services/auth.rs:82` | N parallel guesses all read the same value and all write value+1, so a batch of B concurrent attempts costs **one** increment. An attacker gets ~5×B guesses before lockout instead of 5. Compounds with H3. | `UPDATE users SET failed_login_attempts = failed_login_attempts + 1 ... RETURNING failed_login_attempts` and branch on the returned value. | Partially — `login_failure` audit rows still appear, but the lockout that should stop the run fires far later than you think. |
| M2 | Passkey enrollment has no step-up re-auth and survives password reset | `src/routes/passkey.rs:46,69` — only `require_auth(&headers)`, no current-password or TOTP check (contrast `src/services/profile.rs:109-118`). Neither `revoke_all_user_tokens` (`src/core/auth.rs:376-389`) nor admin reset (`src/services/users.rs:133-140`) touches the passkeys table. | An attacker holding a stolen access token for 60 seconds enrolls their own authenticator. They then log in indefinitely without the password, without TOTP, surviving every password change you make. Turns a temporary session compromise into permanent access. | Require password or TOTP re-verification in `register_start`; add "revoke all passkeys" to the password-reset path. | **No.** Passkey registration writes zero audit rows (M3). |
| M3 | Passkey login and registration write no audit rows at all | `grep -n "AuditLog\|audit" src/services/passkey.rs` → **no matches** across 723 lines. `src/services/audit.rs:63` documents the method param as `"password", "passkey", "2fa"` — the helper was written expecting a caller that never materialised. | Every passkey login and every credential enrollment is invisible. Successful logins do leave a `refresh_tokens` row with IP/UA (`src/services/passkey.rs:313`); failed attempts and enrollments leave nothing. | `AuditLog::log_login_success(..., "passkey", ip, ua)` before the `Ok` at `:325`; failures at `:257, :269, :283, :295`; and a `passkey_registered` event in `register_finish` (`:114`). | No. |
| M4 | All 8 login audit events hardcode `None, None` for IP and user-agent | `src/services/auth.rs:37, 42, 56, 99, 116, 130, 198, 248` — every call passes literal `None, None`, while the same function consumes the real values correctly 20 lines away at `:228` | "One IP is attacking 40 accounts" is unanswerable. Only "one account is being attacked" is. The column exists (`0001_v1_baseline.sql:1154`) and the INSERT casts it (`src/repositories/audit.rs:35`) — the values are simply discarded. | Replace each `None, None` with `ip_address.map(String::from), user_agent.map(String::from)`. | Failed logins: no source IP, ever. Successful logins: IP survives in `refresh_tokens` only. |
| M5 | RBAC role/permission *definition* changes are unaudited | `grep -n "AuditLog" src/services/rbac.rs` → only `:57, :93, :106, :171, :174`. Nine mutating fns are silent: `create_role:15`, `create_permission:72`, `assign_permission_to_role:111`, `remove_permission_from_role:122`, `replace_role_permissions:134`, `update_role:192`, `delete_role:218`, `update_permission:243`, `delete_permission:269` | An actor with `permissions:manage` widens an existing role's entire permission set with one `replace_role_permissions` call. The only visible event is the innocuous `role_assigned` that follows. Post-incident you cannot reconstruct how privilege was gained. | Mirror the existing `log_role_assignment` pattern into all nine, prioritising `replace_role_permissions` with a before/after permission-id diff. | No. |
| M6 | Rate-limit rejections (429) leave no trace anywhere | `grep -n "log::\|tracing::\|AuditLog" src/core/rate_limiter.rs` → **no matches** across 328 lines. Rejection sites are equally silent (`src/routes/auth.rs:67-75`); `src/core/error.rs:143-150` maps both 429 variants with no log call. | The throttle fires *before* `services::auth::login` runs, so a throttled attacker generates neither a 429 record nor a `login_failure` row. Someone staying just under 5 req/min/IP on `/api/auth/login` is completely invisible. | A shared `AtomicU64` incremented in the `!allowed` branch of `RateLimiter::check_with_retry` (`:114-118`) and `KeyedRateLimiter::check_with_retry` (`:159-165`) — **two edits instrument all 43 call sites** across 11 files. | No. This is the cheapest attack signal in the codebase and it is currently zero. |
| M7 | 401/403 denials contain no logging statement | `src/core/error.rs:112-119` has no log call (contrast `:106` and `:133` which do). Root cause: `grep -n "log::" src/core/middleware.rs` → **no matches** across 152 lines, so `check_permission`, `require_auth`, `require_permission_helper` are all silent. | A compromised front-desk session enumerating `/api/users`, `/api/rbac/*`, `/api/payments/*` gets 403s that appear in no log and no table. Note raising `RUST_LOG` would not help — the statement does not exist. | One `log::warn!` in the denial branch of `check_permission` with user_id + permission string. WARN survives production filtering. | No. |
| M8 | SMTP is not configured in production — nothing can email you, and guest mail is silently queued | `grep -rn SMTP deploy/ hotel-app-be/.env.example` → **no matches**. `Transport::from_env()` (`src/modules/communications/transport.rs:103-108`) returns `None`, so `worker::spawn` returns early at `src/modules/communications/worker.rs:42-47`. | Every queued guest email — booking confirmations included — is sitting unsent in `email_deliveries`. And any alerting you build is dead on arrival. This is the blocking prerequisite for Phase 2. | Add `SMTP_HOST`, `SMTP_FROM_EMAIL`, `SMTP_USERNAME`, `SMTP_PASSWORD` to `deploy/docker-compose.prod.yml:69-91` and `.env.example`. Use port 587 + STARTTLS (the defaults at `transport.rs:46,51`) — Lightsail commonly blocks outbound 25. | You would notice guests not receiving confirmations, eventually. |
| M9 | `pg_stat_statements` created but never preloaded → a shipped admin feature is permanently dead | Extension created at `0001_v1_baseline.sql:44`. `grep -rn shared_preload_libraries deploy/ docker-compose.yml` → **no matches** (it exists only in `docker-compose.pg19-tuned.yml:6` and the OCI template). | This is not an unused schema object — it backs a live RBAC-gated endpoint: `src/routes/audit.rs:31` (`/audit-logs/db-statements`, gated `audit:read`), reader at `src/repositories/audit.rs:266-291`, graceful degradation at `src/services/audit.rs:562`. On the VPS an admin opening that screen always sees "not installed". | Add `-c shared_preload_libraries=pg_stat_statements` to the postgres command block at `deploy/docker-compose.prod.yml:24-35`. Requires a postmaster restart. | Yes, but only as a confusing UI state. |
| M10 | No least-privilege database role — the app connects as superuser everywhere | `deploy/docker-compose.prod.yml:37,70`; `docker-compose.yml:9,34`; `hotel-app-be/docker-compose.yml:6`; `infra/terraform/oci/templates/bootstrap.sh.tftpl:140`. Verified: `grep -rniE "CREATE[[:space:]]+(ROLE\|USER)\|NOSUPERUSER\|REVOKE[[:space:]]" --include="*.sql" hotel-app-be/database/` returns only two permission-seed string literals. | Defense-in-depth only — there is no trigger today, since all dynamic SQL is allowlisted and no runtime path performs superuser operations. But any future SQL-layer flaw escalates straight to full database control. | Create a `hotel_app` role with DML plus the DDL that data-transfer needs; keep `hotel_admin` for baseline install and patches. Check `src/repositories/data_transfer.rs:324` (`ALTER TABLE ... TRIGGER USER`) needs table ownership. | N/A — not an exploit today. |
| M11 | eKYC and audit CSV exports allow formula injection; audit export is reachable by an anonymous registrant | eKYC: `src/modules/ekyc/service.rs:733` feeds `summary.full_name` into `csv_row` (`src/modules/ekyc/validation.rs:587-594`), which quote-wraps but has no `=`/`+`/`-`/`@` guard. Audit: `src/services/audit.rs:481-494` — only the trailing details column is quoted; `username` and `user_agent` go in bare. | The audit path is the sharper one: `/auth/register` (`src/routes/auth.rs:43`) is unauthenticated, and `RegisterRequest.username` has a length rule but **no character-class rule** (`src/models/auth.rs:83-88`). An anonymous user registers `=HYPERLINK(...)` as a username, logs in once, and plants a formula in your exported audit CSV. Also `Smith,Bob` breaks the column count. | Add the formula guard inside `csv_row` so every caller inherits it; route the audit export through one quoting helper instead of hand-formatting; add `^[A-Za-z0-9._-]+$` to the username validator. | Only if you open the CSV and notice. Modern Excel prompts before executing, so this needs a click-through. |
| M12 | No scheduled database backup | `deploy/deploy.sh:266-294` (`backup_existing_database`) is called once, at `:443`, inside the deploy sequence. Retention is 3 files (`:291`). `grep -rniE "cron\|systemd\|\.timer" deploy/` finds only logrotate. Backups live at `$APP_DIR/backups` — the same VPS filesystem as the Postgres volume (`deploy/docker-compose.prod.yml:144-146`). | Between deploys there is **no recovery point at all**. A disk failure, a bad migration, or a beta-Postgres corruption (H7) loses every booking and ledger entry since your last deploy. `docs/guides/deployment.md:396` acknowledges this gap but nothing installs the cron. | Install a systemd timer from `deploy.sh` alongside the logrotate unit it already writes at `:182-194`. Encrypt (age/gpg) and ship off-host. | Only when you need it. |
| M13 | Campaign HTML is stored unsanitized and rendered with `dangerouslySetInnerHTML` | `hotel-web-fe/src/features/communications/pages/CommunicationsPage.tsx:382` — the only `dangerouslySetInnerHTML` in the repo, no sanitizer wrapper. Server side, `src/modules/communications/validation.rs:85` only trims and bounds length. | Crosses a staff permission boundary: `communications:compose` (`handlers.rs:64,93`) authors it, `communications:read` (`handlers.rs:112`) renders it. XSS in an admin browser reaches payments, refund and RBAC endpoints with the victim's bearer token. Note `validation.rs:82-84` documents this as a deliberate trade-off, and guest-supplied values *are* escaped (`:201-214`). | Sanitize the **preview response** server-side with the existing `Sanitizer::sanitize_html` (`src/utils/sanitization.rs:17`) so stored campaign HTML stays intact for SMTP while the browser never renders raw author HTML. | No. |
| M14 | Loyalty WebSocket authenticates from `Sec-WebSocket-Protocol`, skipping session revocation *and* account status | `src/modules/loyalty/handlers.rs:114-138`; route at `src/modules/loyalty/routes.rs:31`. The global middleware short-circuits when there is no `Authorization` header (`src/routes/mod.rs:88-92`), which a browser WebSocket cannot set. | The RBAC cache never joins `users` (`src/core/rbac_cache.rs:84-113`), so `is_session_active` (`src/core/auth.rs:430-441`) is the *only* per-request check of `is_active`/`is_locked`/`deleted_at`. A **deactivated or soft-deleted** staff account keeps this socket for up to 30 minutes. Capped at medium because the socket is broadcast-only (`src/modules/loyalty/hub.rs:53-73`) — read-only, no mutation surface. | Call `AuthService::is_session_active` before `.on_upgrade()`, mirroring `src/routes/mod.rs:110-118`. | No — no audit entry on upgrade. |
| M15 | eKYC has a private `client_ip()` that ignores the `trust_proxy_headers` flag entirely | `src/modules/ekyc/routes.rs:395-406`, called from 10 sites (`:136,179,197,215,235,255,280,315,334,381`). No `config::get()` reference in the file. | Worse than H3 in one respect: it trusts the header even when `TRUST_PROXY_HEADERS=false`, which is the default (`.env.example:79`) and what desktop hardcodes (`hotel-desktop/src-tauri/src/commands.rs:120`). Corrupts the IP in the KYC document-access compliance trail in every deployment. Audit-trail forgery by an already-privileged insider — not an access bypass. | Delete the local fn; take `ConnectInfo<SocketAddr>` and call `crate::routes::extract_client_ip` like every other module. | The forged value looks legitimate. |
| M16 | Desktop plaintext bootstrap-password file has no permission hardening | `hotel-desktop/src-tauri/src/postgres.rs:1749-1755` — `std::fs::write(&password_file, contents)?` with default umask. The sibling `write_postgres_password_file` at `:483-511` does it correctly with `options.mode(0o600)`. | The file contains the cleartext initial admin password plus every seeded username, for an account that reads guest PII and moves money. A shared front-desk machine with multiple local OS accounts is a plausible deployment. | Route through the same `OpenOptions(.mode(0o600))` + `tighten_secret_file_permissions` pattern used 1,260 lines away. | No. |
| M17 | Dependabot and `cargo audit` both skip `hotel-desktop` entirely | `.github/dependabot.yml` (17 lines, read in full) has entries for `/`, `/hotel-app-be`, `/hotel-web-fe` — no desktop. Both audit jobs are scoped `working-directory: hotel-app-be` (`ci.yml:15`, `security.yml:59`). | `hotel-desktop/src-tauri/Cargo.lock` pulls `tauri`, `tauri-plugin-updater`, `tauri-plugin-shell` and ships an embedded PostgreSQL server to end users, with zero advisory scanning. The `sqlx` ignore (`dependabot.yml:11-13`) also suppresses patch-level advisories. | Add cargo + bun ecosystems for `/hotel-desktop/src-tauri` and `/hotel-desktop`; add a second `cargo audit` step. Scope the sqlx ignore to `update-types: [version-update:semver-major]`. | No. |
| M18 | The audit trail fails open and silently | `src/services/audit.rs:34-48` — logs a `warn!` on insert failure and returns `Ok(())`. Every caller writes `let _ = AuditLog::log_event(...)` anyway, so it is doubly swallowed. | Every alert rule you build on `audit_logs` inherits this. An attacker who breaks audit writes, or a partition/permission problem, degrades detection to zero with nothing surfacing above a WARN line in a file nobody reads. The stale comment at `:29` ("table may not exist yet") is false — it has existed since the V1 baseline. | Increment a counter in the error branch so "the forensic record is broken" becomes alertable. Note `log_event_tx` (`:50`) correctly propagates. | No. |

### LOW

| # | Finding | Where | Note |
|---|---|---|---|
| L1 | bcrypt runs synchronously on tokio worker threads | `src/core/auth.rs:204-210`; `grep -rn spawn_blocking src/` → **no matches** repo-wide. Cost 12 (`bcrypt-0.19.2/src/lib.rs:28`), `cpus: 0.45` (`deploy/docker-compose.prod.yml:108`) | Each verify pins a worker for hundreds of ms. Login volume is tiny, but this is the cheapest CPU-exhaustion primitive once H3 removes the IP limiter. Fix H3 first. |
| L2 | No `statement_timeout` and no timeout layer | `src/core/db.rs:24-30`; `grep -rn "statement_timeout\|TimeoutLayer" ` → only a migration-scoped `lock_timeout`. `tower-http` features at `Cargo.toml:27` do not even include `timeout` | One slow query holds a connection indefinitely against a 5-connection pool (`deploy/docker-compose.prod.yml:71`), cascading into healthcheck failure. Add `SET statement_timeout` to the existing `after_connect` hook at `src/core/db.rs:31-50` — it already runs a `SET timezone` per connection. |
| L3 | Two unauthenticated auth endpoints have no rate limiter | `src/routes/auth.rs:142-147` (`verify_email`) and `:149-154` (`resend_verification`) take no `Extension<RateLimiters>`, unlike login `:67`, refresh `:99`, register `:129` | `resend_verification` is an unmetered trigger for a row-level `UPDATE` on the users table (`src/core/auth.rs:522-535`) — DB write amplification against a 5-connection pool. Not an email bomb: it writes the token column only, despite the response text claiming mail was sent. |
| L4 | TOTP secrets stored in plaintext | `src/services/two_factor.rs:39`; no encryption primitive exists anywhere (`grep -rn "aes_gcm\|ENCRYPTION_KEY" src/` → nothing) | Recovery codes and refresh tokens *are* hashed, so this column is the outlier. Realistic marginal scenario is a stolen backup file. Backlog item. |
| L5 | Email-verification tokens stored unhashed | `src/core/auth.rs:515-538`, bound raw at `:531` | Inconsistent with refresh tokens (`:267-271`), 2FA challenges (`:738-739`) and recovery codes (`:639-641`). 24h expiry, single-use, self-clearing — worst case is marking an email verified. Two-line fix. |
| L6 | nginx CSP `script-src 'self'` will break the PayPal flow when enabled | `hotel-web-fe/nginx.conf:13`; `hotel-web-fe/Dockerfile:40` confirms this policy ships in the production image. `GuestPaymentPanel.tsx:32,351-365` injects a runtime `<script src="https://www.paypal.com/...">` and a paypal.com iframe | Latent — `PAYPAL_ENABLED` defaults false (`deploy/docker-compose.prod.yml:86`). Breaks the moment you switch PayPal on. Same class as the Tauri CSP lesson in `lessons.md`. Also `connect-src 'self' https:` is looser than the backend's `'self'`. |
| L7 | `hotel-app-be/docker-compose.yml` publishes Postgres on all interfaces | `:9-10` — `- "5433:5432"` with no host-IP prefix, unlike `docker-compose.yml:7` (`127.0.0.1:5432:5432`) | Dev-laptop hygiene. Cannot start weak — `:7` uses the `:?` required form. One-character fix. |
| L8 | All GitHub Actions pinned by mutable tag | `grep -rn "uses:" .github/workflows/` → zero SHA pins | Production exposure is minimal: `deploy.yml` uses exactly one action (`actions/checkout@v7` at `:78`). Genuine third-party exposure is CI-only (`gitleaks-action@v3`, `setup-bun@v2`, `Swatinem/rust-cache@v2`). Note `ci.yml:23-25` passes `GITHUB_TOKEN` to gitleaks while declaring no `permissions:` block. |
| L9 | `ci.yml` and `desktop-build.yml` declare no `permissions:` block | Only `security.yml:11`, `docker.yml:13`, `deploy.yml:22` do | The token inherits the repo default, which is a GitHub setting not visible from the tree — **unverified**. Add `permissions: contents: read` to both. |
| L10 | Guest-portal 10MB body-limit override covers zero routes | `src/routes/guest_portal.rs:29` — `.layer()` precedes all 20 `.route()` calls; axum applies layers only to already-registered routes | Functional bug, not security: the effective cap is axum's 2MB default, so a guest's phone-camera receipt is rejected while the comment promises 10MB. Move the layer onto the two upload `MethodRouter`s, as `src/routes/data_transfer.rs:22` does correctly. |
| L11 | Dead validators imply guest input is checked when it is not | `src/utils/validation.rs:25,56,72` — `ValidatedGuestInput` et al. referenced only inside their own file and `#[cfg(test)]` | Misleads readers into believing length/format rules run. Delete them, or wire `#[derive(Validate)]` onto the request models the handlers actually deserialize. |
| L12 | Backend log file has no rotation and no retention cap | `src/main.rs:73-74` computes the date **inside** `init_logging`, called once at `:145`. A container up for 60 days appends to one file named for its boot date. `hotel-app-be/logs/backend-2026-07-14.log` is 453MB | Docker's json-file cap (`deploy/docker-compose.prod.yml:13-17`) does **not** apply to the bind-mounted file sink at `:97`. Host logrotate does cover `/opt/saliminn/logs/*.log` (`deploy/deploy.sh:182-193`). Becomes urgent the moment you fix H4 and add request volume. |
| L13 | `nginx:alpine` — fully floating base image tag | `hotel-web-fe/Dockerfile:34`, built with `--pull` on every deploy (`deploy.yml:100-106`) | Contrast the pinned siblings `rust:1.95.0-bookworm` (`hotel-app-be/Dockerfile:3`) and `oven/bun:1.3.14-alpine`. The web server serving production can differ between two deploys of the same commit. |
| L14 | Desktop artifacts unsigned, unnotarized, no checksum manifest | `.github/workflows/desktop-build.yml:128-132`; `tauri.conf.json:58` (`"certificateThumbprint": null`). Triggered on `v*` tags (`:15-17`), so this is the real distribution path | Contrast `deploy.yml:131-144`, which builds a `SHA256SUMS` that `deploy.sh:65-68` verifies. Also `tauri.conf.json:72,74` still contain `REPLACE_WITH_YOUR_UPDATE_HOST` / `REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY` while the updater plugin is registered (`hotel-desktop/src-tauri/src/lib.rs:23`). |
| L15 | Unencrypted production DB dump world-readable in the working tree | `deploy/backups/saliminn-pre-payments-patch-20260722-145923.dump`, mode `-rw-r--r--`, 2MB, real `PGDMP` format | Correctly gitignored (`.gitignore:12-16`) and never committed. Local-machine hygiene only. `chmod 600` or delete. |
| L16 | Permission-to-role grants never check the actor holds the permission | `src/services/rbac.rs:111,134` — `ensure_actor_can_manage_roles` (`:332-357`) checks only the target *role's* priority, never `input.permission_id` | Latent: no shipped role can reach this. `data.sql:533-535` grants admin/super_admin everything, and no other seeded role carries `roles:*`/`permissions:*`. Becomes real only if you hand-build a custom RBAC-admin role — which the product supports. |

---

## 4. The core gap: you cannot see your own server

Here is what an attacker — or a malicious insider, or a compromised staff laptop — could do on your production VPS **right now, leaving no trace you could ever find**:

1. **Download your entire database.** One `GET /api/data-transfer/export` with a `settings:manage` session returns every guest's name, email, phone, IC/passport number, every booking, every payment, and your whole ledger (`src/routes/data_transfer.rs:19`, `src/services/data_transfer.rs:209-271`). Zero audit rows (`grep -c "AuditLog::"` → 0). Zero log lines at `RUST_LOG=warn`. Zero access log at either layer (H4). The only evidence is outbound bytes you have no way to observe.

2. **Enroll a permanent backdoor.** With a stolen access token valid for 30 minutes, register a passkey (`src/routes/passkey.rs:46` — `require_auth` and nothing else). It survives every password change you make, bypasses the account's TOTP requirement, and writes no audit row at any point (M2, M3). You could reset that user's password every week forever and never revoke it.

3. **Probe every authorization boundary.** Walk `/api/users`, `/api/rbac/*`, `/api/payments/*` collecting 403s. `src/core/error.rs:112-119` has no logging statement, and `src/core/middleware.rs` has none across 152 lines (M7). Raising `RUST_LOG` would not help — the statement does not exist to be filtered.

4. **Brute-force under the radar.** Stay just under 5 requests/min/IP on `/api/auth/login`. The throttle fires before `services::auth::login` runs, so you generate neither a 429 record — `src/core/rate_limiter.rs` has zero logging across 328 lines (M6) — nor a `login_failure` row. Or spoof `X-Forwarded-For` (H3) and skip the throttle entirely, since Caddy appends rather than replaces.

5. **Widen a role silently.** One `replace_role_permissions` call (`src/services/rbac.rs:134`) grants a low-privilege role every permission in the system. Unaudited (M5). The only visible event afterwards is an innocuous `role_assigned`.

6. **Read guest names, emails and balances from a housekeeping login.** Seven room endpoints check only that you are logged in (`src/services/rooms.rs:1271-1413`), returning `guest_name`, `guest_email`, `total_paid` and `balance_due` to roles deliberately denied `guests:read` and `payments:read` (H6). Successful 200s — nothing to log.

And the flip side: **nothing can tell you.** SMTP is not configured in production (`grep -rn SMTP deploy/` → no matches, M8), so even a perfect detection system could not reach you. There is no metrics surface, no request counter, no error-rate signal — `hotel-app-be/Cargo.toml` has no observability dependency, and `grep -rn "/proc/\|sysinfo\|statvfs" src/` returns nothing.

The one bright spot worth knowing: **`refresh_tokens.ip_address` is populated on every successful login** (`0001_v1_baseline.sql:4044`, written at `src/services/auth.rs:227-229`). That single column enables the highest-value compromise signal available — "user X logged in from an IP never seen before" — with **zero changes to any write path**. It works today, despite every `audit_logs` login row having a NULL IP. Phase 2 leans on it heavily.

---

## 5. Ownership plan

Five phases. Phases 0–1 are worth doing regardless of whether you ever build alerting; they are what make Phase 2 possible.

---

### Phase 0 — Free wins (3–5 hours)

**Goal:** Commit the fix already sitting in your tree, close the two config-level foot-guns, and turn on capabilities that already exist and cost nothing.

| # | Task | File | Effort |
|---|---|---|---|
| 0.1 | **Commit the pre-checkin removal.** 102 deletions across three files are uncommitted. Run `git diff --cached --stat` first (shared tree — see `lessons.md` 2026-07-26r) and prefer `git commit -- <paths>`. | `src/routes/bookings.rs`, `src/handlers/bookings.rs`, `src/repositories/bookings/lifecycle.rs` | 15 min |
| 0.2 | **Fix the guest column mismatch (H1).** Alias as `find_by_id` does at `:58`. | `src/repositories/guest.rs:42,83,100,128`; `src/repositories/guest_portal.rs:146,153`; `src/repositories/bookings/lifecycle.rs:2210,2218,2924,2932` | 1 h |
| 0.3 | **Kill the placeholder secrets (H2).** `:-` → `:?` on three lines. Add a `CHANGE_ME` blocklist to `validate_security`. | `docker-compose.yml:10,34,35`; `src/core/config.rs:182-209` | 20 min |
| 0.4 | **Fix XFF trust (H3).** Take the last hop, **and** add `header_up X-Forwarded-For {remote_host}`. | `src/routes/mod.rs:61-65`; `deploy/deploy.sh:369-378` | 45 min |
| 0.5 | **Gate the seven room endpoints (H6).** `require_auth` → `require_permission_helper`. | `src/services/rooms.rs:1271,1314` (`bookings:read`); `:1365,1377,1391,1402,1413` (`rooms:read`) | 30 min |
| 0.6 | **Configure SMTP (M8).** Blocks all of Phase 2. Port 587 + STARTTLS. | `deploy/docker-compose.prod.yml:69-91`; `hotel-app-be/.env.example` | 45 min |
| 0.7 | **Preload `pg_stat_statements` (M9).** Revives a dead admin screen and gives Phase 2 a query-cost signal. | `deploy/docker-compose.prod.yml:24-35` | 15 min |
| 0.8 | **Scheduled backup (M12).** systemd timer beside the logrotate unit `deploy.sh` already writes. Daily `pg_dump`, encrypted, off-host, retain 14. | `deploy/deploy.sh` (near `:182-194`) | 1 h |
| 0.9 | **Atomic lockout counter (M1).** `= failed_login_attempts + 1 ... RETURNING`. | `src/repositories/auth.rs:120`; `src/services/auth.rs:82` | 30 min |
| 0.10 | **`statement_timeout` (L2).** Add to the existing `after_connect` hook. Suggested: `30s`. | `src/core/db.rs:31-50` | 15 min |
| 0.11 | **Loopback-bind dev Postgres (L7).** | `hotel-app-be/docker-compose.yml:10` | 2 min |

**What it buys:** Removes both credential-forgery paths, restores the rate limiter's integrity, closes a real PII leak to housekeeping accounts, fixes a live production 500, and gives you a recovery point that is not "whenever I last deployed". Nothing here requires new architecture.

---

### Phase 1 — Make the app observable (1–2 days)

**Goal:** Produce the signals Phase 2 will alert on. Every item here is a small edit to existing code — no new dependencies.

| # | Task | File | Effort |
|---|---|---|---|
| 1.1 | **Request logging (H4).** Raise the TraceLayer's own span/response level rather than raising `RUST_LOG`. **`RUST_LOG=warn,tower_http=debug` will not work** — `src/core/config.rs:238-246` matches only exact strings and falls through to `Info`. | `src/routes/mod.rs:264` | 2 h |
| 1.2 | **Caddy access log (H4).** Add a `log` directive to the generated site block. Host-side artifact — the container cannot read it. | `deploy/deploy.sh:361-382` | 30 min |
| 1.3 | **Rate-limit rejection counter (M6).** A shared `AtomicU64` in the `!allowed` branch of both `check_with_retry` fns. **Two edits instrument all 43 call sites.** Highest value-per-hour item in this phase. | `src/core/rate_limiter.rs:114-118`, `:159-165` | 1 h |
| 1.4 | **Log 401/403 denials (M7).** One `log::warn!` (survives production filtering) with user_id + permission string. | `src/core/middleware.rs` (`check_permission`, `check_any_permission`) | 45 min |
| 1.5 | **Populate login audit IP/UA (M4).** Values are already in scope at `:26-27` and correctly used at `:228`. | `src/services/auth.rs:37,42,56,99,116,130,198,248` | 45 min |
| 1.6 | **Audit the bulk export (H5).** One `log_event` call. | `src/handlers/data_transfer.rs` | 30 min |
| 1.7 | **Audit passkey login + registration (M3).** | `src/services/passkey.rs:257,269,283,295,325` and `register_finish:114` | 1 h |
| 1.8 | **Audit the nine RBAC definition mutations (M5).** Prioritise `replace_role_permissions` with a before/after permission-id diff. | `src/services/rbac.rs:15,72,111,122,134,192,218,243,269` | 2 h |
| 1.9 | **Audit-failure counter (M18).** Increment in the swallow branch. | `src/services/audit.rs:34-48` | 20 min |
| 1.10 | **Passkey step-up + revocation (M2).** Require password or TOTP in `register_start`; revoke passkeys on password reset. | `src/routes/passkey.rs:46`; `src/services/users.rs:133-140` | 2 h |
| 1.11 | **Guest-portal limiter key validation (H8).** Shape+length check before the limiter call. Copy the `.chars().take(128)` pattern from `src/handlers/webhooks.rs:45-58`. Add an IP ceiling to `get_booking`. | `src/routes/guest_portal.rs:206-215`, `:229-249` | 1.5 h |
| 1.12 | **Session check on the loyalty socket (M14).** | `src/modules/loyalty/handlers.rs:114-138` | 45 min |
| 1.13 | **Log rotation (L12).** Age-based cleanup or a rotating appender — becomes urgent once 1.1 adds request volume. | `src/main.rs:73-74` | 1 h |

**What it buys:** Every alert in Phase 2 becomes possible. Specifically: you gain per-IP attack visibility (1.5), the cheapest early attack signal in the codebase (1.3), authorization-probe detection (1.4), traffic and latency data (1.1/1.2), and a record of the two largest exfiltration and persistence paths (1.6, 1.7).

---

### Phase 2 — The email alerter (2–3 days)

**Goal:** One new module, `hotel-app-be/src/modules/ops_alerts/`, that reuses the existing SMTP transport but **not** the guest outbox. Design premise: a normal week produces **exactly one email** (the daily digest, or zero if nothing happened); a real incident produces one to three.

**Why not reuse `email_deliveries`:** four independent blockers. `guest_id bigint NOT NULL` with an FK to `guests` (`0001_v1_baseline.sql:2439`, `:8483-8487`); `kind` and `topic` CHECK constraints (`:2460`, `:2462`); and decisively, the worker rechecks consent and suppression on **every** send (`src/modules/communications/worker.rs:123-135`, `src/modules/communications/repository.rs:967-987`). A security alert routed through that path can be **silently dropped by an unsubscribe row** — the worst possible failure mode.

**Reuse instead:** `Transport` / `OutgoingEmail` (`src/modules/communications/transport.rs:16-22`, `:103-108`, `:119-158`) — guest-agnostic, no consent check, no new dependencies, and `Transport::fake()` at `:110-114` gives you unit tests for free.

**Module layout:** `config.rs` (env parsing), `probes.rs` (collectors), `rules.rs` (pure functions — unit-testable with no DB), `repository.rs` (dedup state), `notifier.rs`, `scheduler.rs`. Register via `pub mod ops_alerts;` in `src/modules/mod.rs`, spawn with one line after `src/main.rs:225`, copying the `spawn` shape from `src/services/night_audit_scheduler.rs:32-47` — including its sleep-**before**-first-tick ordering, so a restart storm does not itself generate alerts. Copy the "inert when unconfigured" guard verbatim from `src/modules/communications/worker.rs:42-47`.

**Config (env; must be readable when the DB is degraded):** `OPS_ALERT_EMAIL` (unset = feature off — the master switch), `OPS_ALERT_INTERVAL_SECS` (120), `OPS_ALERT_MAX_PER_DAY` (8), `OPS_ALERT_COOLDOWN_MINS` (120), `OPS_ALERT_DIGEST_HOUR` (8, hotel timezone), `OPS_ALERT_HEARTBEAT_URL`. Tunable thresholds go in `system_settings` via `settings_cache` (`src/core/settings_cache.rs`, pattern at `src/services/night_audit_scheduler.rs:57-60`) so you can change them from the Settings UI without a redeploy.

#### ALERT TABLE — immediate (critical)

| Alert | Trigger (concrete threshold) | Severity | Channel | Data source |
|---|---|---|---|---|
| `compromise_burst` | In 15 min, **any** of: ≥1 `two_factor_disabled`; ≥1 `two_factor_recovery_code_used`; ≥3 `role_assigned`; ≥1 `user_created` carrying an admin role; ≥1 `audit_logs_exported`; ≥1 `ekyc_exported`; ≥1 `data_export` (new in 1.6) | Critical | Immediate email — **one mail listing all of them**, never one per action | `audit_logs`, one indexed aggregate (`0001_v1_baseline.sql:6201`, `:6215`) |
| `new_ip_login` | A `(user_id, ip_address)` pair in `refresh_tokens` with `created_at` in the window and **no prior row** for that user. Suppressed for the first 14 days post-deploy while a baseline accumulates | Critical | Immediate | `refresh_tokens.ip_address` (`0001_v1_baseline.sql:4044`) — **works today, no write-path change** |
| `brute_force` | `login_failure` count > **30** in 15 min, **or** any `Account locked after max attempts` row, **or** rate-limit denials > **200** in 15 min | Critical | Immediate | `audit_logs`; denial counter from 1.3 |
| `db_degraded` | `SELECT 1` fails, **or** `pool.num_idle() == 0` with `size() == 5` for **3 consecutive ticks**, **or** `pg_stat_activity` count > **80%** of `max_connections=20` | Critical | Immediate | `sqlx::PgPool` (`src/core/db.rs:4`), `pg_stat_activity`, `deploy/docker-compose.prod.yml:27,71` |
| `disk_critical` | Log-dir filesystem free < **10%**, **or** cgroup `memory.current` > **90%** of `memory.max` (192MB cap) | Critical | Immediate | `statvfs`; `/sys/fs/cgroup/memory.current` |

#### ALERT TABLE — daily digest

| Alert | Trigger | Severity | Channel | Data source |
|---|---|---|---|---|
| `ekyc_access` | Count of `ekyc_document_downloaded` + `ekyc_sensitive_reveal` in 24h | Info | Digest | `src/modules/ekyc/service.rs:410`, `:665`; `ekyc_sensitive_reveals` table (`0001_v1_baseline.sql:2275-2282`) |
| `money_reversals` | Any `payment_refunded`, `payment_deleted`, `customer_ledger_voided`, `customer_ledger_reversed` in 24h | Info | Digest | `audit_logs` |
| `account_changes` | `password_changed`, `session_revoked`, `settings_changed` counts | Info | Digest | `audit_logs` (`src/services/audit.rs:316`, `:332`) |
| `slow_queries` | Count of slow-statement WARN lines; top 3 by total time | Info | Digest | `src/core/db.rs:19-22`; `src/repositories/audit.rs:266-291` (needs 0.7) |
| `email_backlog` | `email_deliveries` rows in `queued` > **50**, or any `failed` | Info | Digest | `SELECT status, count(*) FROM email_deliveries GROUP BY status` |
| `backup_age` | Newest backup older than **36 hours** | Warning | Digest (→ immediate if > 7 days) | Filesystem stat on the backup dir |
| `audit_write_failures` | Counter from 1.9 > **0** | Warning | Digest | In-process counter |
| *(rollup)* | Every critical that fired since the last digest | — | Digest | `ops_alert_notifications` |

**Deliberate asymmetry:** eKYC reveals are the best exfiltration signal in the product, but a busy front desk generates them legitimately all day — so they go to the digest with a count, not to your phone. Same for money reversals. **Only account-control events page you.**

#### Volume control mechanics

Two new tables (three-phase edit per this repo's pg_dump-shaped baseline convention — `CREATE TABLE` with no inline PK/FK, then `ADD CONSTRAINT ..._pkey`, then FKs — plus a dated idempotent file in `database/postgres/patches/` and a byte-identical mirror into `hotel-desktop/src-tauri/database/postgres/`):

- `ops_alert_state(alert_key, severity, first_seen_at, last_seen_at, last_notified_at, occurrences, sample jsonb)`
- `ops_alert_notifications(id, alert_key, severity, sent_at, delivered, error)`

Per tick: snapshot → evaluate → UPSERT with `ON CONFLICT (alert_key) DO UPDATE SET occurrences = occurrences + 1`. **Dedup is on the `alert_key`, not the message text** — a 6-hour brute-force run is one row and one email. Send only if `last_notified_at IS NULL OR last_notified_at < now() - cooldown`. **All criticals eligible on the same tick coalesce into ONE email** (subject: `[saliminn] 3 alerts: brute force, new-IP login, disk 8% free`). At the daily cap, send exactly one "budget exhausted, deferring to digest" mail and route the rest to the digest. **Absolute worst case: 10 emails/day. Normal operation: 0–1.** A key that stops firing for 3 ticks is deleted — **no "resolved" emails, ever**; resolutions appear only in the digest. This alone halves volume versus a naive design.

Write one `audit_logs` row per email sent (action `ops_alert_sent`, `user_id: None` — `AuditEvent` derives `Default` at `src/models/audit.rs:30`).

#### Fail-safe paths

- **SMTP unconfigured** → do not spawn; copy `worker.rs:42-47` including the log wording.
- **Send fails** → retry twice with a 30s gap, then `log::error!` the **full alert body** (lands in `/opt/saliminn/logs`, survives at ERROR under `RUST_LOG=warn`, retained 7 days by `deploy/deploy.sh:182-193`), insert `delivered=false`, and **do not set `last_notified_at`** so the next tick retries. Prepend "N earlier alerts could not be delivered" to the next successful mail. **Never email about email being broken** — that is the loop Phase 3 exists to break.
- **DB unreachable** → `ops_alert_state` is gone, so handle `db_degraded` with a process-local `AtomicI64` cooldown (≥60 min, since an outage re-trips it every tick). Every other rule needs the DB anyway and simply does not evaluate.
- **Alerter panics** → wrap `tick` in `if let Err(e) = ...`, never `unwrap`. Make the Phase 3 heartbeat the **last statement of a successful tick**, so a wedged tick stops the heartbeat and the external service raises the alarm.

**Verification before calling this done:** unit tests on `rules.rs` with a synthetic snapshot (no DB); a `Transport::fake()` test asserting N findings → exactly 1 email, a re-fire inside cooldown → 0 emails, cap exceeded → exactly 1 budget notice; a live-Postgres test seeding `audit_logs` and asserting the expected `alert_key`s; and per this repo's baseline rule, a scratch `postgres:19beta2` install of the new trio + patch with an **empty** `pg_dump --schema-only` diff (strip `\restrict` lines).

---

### Phase 3 — External watchdog (1 day)

**Goal:** Detect the failures an in-process alerter structurally cannot report: process crash, OOM kill against the 192MB cap (`deploy/docker-compose.prod.yml:107`), host reboot, kernel panic, network partition, hypervisor failure.

| Task | How | Effort |
|---|---|---|
| 3.1 Dead-man's switch | `reqwest::get(OPS_ALERT_HEARTBEAT_URL)` as the last statement of each successful alerter tick. **No new dependency** — `reqwest` is already a direct dep with `rustls-tls`. Do not re-add it with default features (drags in native-tls). Point at healthchecks.io free tier or equivalent; grace period **10 min** against a 120s tick. | 2 h |
| 3.2 External uptime probe | Any external monitor hitting `GET /health` every 60s, alerting after 3 consecutive failures. The endpoint does a real DB probe (`src/routes/mod.rs:131-149`, `SELECT 1` at `:134`) and Caddy already routes it (`deploy/deploy.sh:369`). | 1 h |
| 3.3 Container restart watcher | Host-side `docker events` watcher. **Required** because the backend container has no docker socket mounted (`deploy/docker-compose.prod.yml:93-97`) and therefore cannot observe its own restarts or its siblings' health. | 3 h |
| 3.4 Certificate expiry | Caddy auto-renews, but a renewal failure is silent. External probe on the TLS expiry date, warn at **14 days**. | 1 h |

#### ALERT TABLE — Phase 3

| Alert | Trigger | Severity | Channel | Data source |
|---|---|---|---|---|
| `heartbeat_missed` | No ping for **10 min** (5 missed ticks) | Critical | Immediate — external service, not your app | healthchecks.io |
| `health_endpoint_down` | 3 consecutive `GET /health` failures at 60s intervals | Critical | Immediate — external | `src/routes/mod.rs:131-149` |
| `container_restart_loop` | ≥3 restarts of any service in 10 min | Warning | Immediate — host-side | `docker events` |
| `tls_expiring` | Certificate expires in < 14 days | Warning | Digest | External probe |

**What it buys:** This is the only phase that survives the machine being dead. Without it, your alerting has a single point of failure that is the thing it is meant to watch.

---

### Phase 4 — Supply chain and routine (ongoing)

| # | Task | File | Cadence |
|---|---|---|---|
| 4.1 | Add `hotel-desktop/src-tauri` (cargo) and `hotel-desktop` (bun) to Dependabot; add a second `cargo audit` step covering the desktop crate; scope the sqlx ignore to `update-types: [version-update:semver-major]` (M17) | `.github/dependabot.yml:7-13`; `.github/workflows/ci.yml:15`, `security.yml:59` | Once |
| 4.2 | Add `bun audit --audit-level=high` to the frontend job (`dependency-review-action@v5` at `security.yml:52` covers new PR deps but not the existing tree) | `.github/workflows/ci.yml` after `:55` | Once |
| 4.3 | SHA-pin the four genuinely third-party actions; add `permissions: contents: read` to `ci.yml` and `desktop-build.yml` (L8, L9) | `.github/workflows/*.yml` | Once |
| 4.4 | Pin `nginx:alpine` to a version (L13) | `hotel-web-fe/Dockerfile:34` | Once |
| 4.5 | **Backup restore drill** — restore the newest dump into a scratch container and run the app against it. A backup you have never restored is a hypothesis, not a backup. | — | Quarterly |
| 4.6 | Plan the PostgreSQL 19beta2 → GA migration (H7) | `deploy/docker-compose.prod.yml:21` | Before GA |
| 4.7 | Review `audit_logs` partition growth. The baseline pre-creates 12 months (`0001_v1_baseline.sql:9596-9607`); nothing calls `ensure_audit_logs_partition` afterwards, so from month 13 rows land in the DEFAULT partition. Functional, indexes attached — but the table COMMENT describes a maintenance job that does not exist. | — | Annually |
| 4.8 | Re-read the alert digest for tuning. Any rule that fires weekly without you acting on it should move to digest or be deleted. | — | Quarterly |
| 4.9 | Address the remaining LOW findings (L1, L3, L4, L5, L6, L10, L11, L14, L15, L16) | Various | Opportunistic |

---

## 6. Cost and operational reality

**Money — roughly $0/month incremental.**

| Item | Cost |
|---|---|
| SMTP relay | $0 at your volume. Amazon SES ~$0.10 per 1,000; Postmark/Mailgun free tiers cover a hotel's transactional mail plus a handful of alerts. You need this for guest confirmations regardless (M8). |
| External heartbeat + uptime | $0. healthchecks.io free tier covers 20 checks; UptimeRobot free covers 50 monitors at 5-min intervals. |
| Storage for `ops_alert_state` | Negligible — two small tables. |
| Off-host encrypted backups | ~$1–3/month for object storage at your database size (the existing pre-deploy dump is 2MB). |
| CPU/memory for the alerter | One indexed aggregate query per 120s tick against a 5-connection pool. Immaterial — but note the container is capped at 192MB (`deploy/docker-compose.prod.yml:107`) and 0.45 CPU (`:108`), so keep probes cheap and never buffer a full table into memory. |

**Your attention — the number that actually matters.**

Target steady state: **one email per day** (the digest), typically skimmed in under a minute, plus **zero to one** immediate alert per month. That is the whole design goal, and every mechanic in Phase 2 exists to enforce it — key-based dedup, per-key cooldowns, same-tick coalescing into one mail, a hard daily cap, and **no resolution emails**.

**Be honest about alert fatigue: it is the most likely way this fails.** Not a missed attack — an ignored inbox. Three specific risks:

1. **`new_ip_login` will be noisy at first.** Mobile carriers rotate IPs, staff work from home, you travel. This is why it is suppressed for the first 14 days while a baseline accumulates. If it still fires more than about twice a week after a month, move it to the digest. A critical alert you have learned to ignore is worse than no alert, because it teaches you to ignore the channel.

2. **Every rule needs a kill switch.** `OPS_ALERT_EMAIL` unset disables everything; thresholds live in `system_settings` via `settings_cache` so you can raise one from the Settings UI at 2am without a redeploy. Use it — muting a noisy rule is the correct response, not a failure.

3. **Apply the deletion rule quarterly (4.8):** any alert that has fired without you taking action should be demoted to digest or removed. Five rules you read beat twenty you filter.

**Effort:** Phase 0 ≈ half a day. Phase 1 ≈ 1–2 days. Phase 2 ≈ 2–3 days. Phase 3 ≈ 1 day. **Total ≈ 5–7 focused days.** If you only ever do Phase 0, you have still closed both credential-forgery paths, a real PII leak, and a live production 500 — and you have a backup. Phase 0 has the best return by a wide margin.

**Ordering:** 0 → 1 → 2 → 3, strictly. Phase 2 without Phase 1 alerts on signals that do not exist. Phase 3 without Phase 2 has nothing to watch.

---

## 7. What this plan does NOT cover

Stated plainly so you are not surprised later.

1. **Host-level compromise is out of reach for anything in this repo.** New SSH keys, rogue processes, modified binaries, rootkits — the backend runs as non-root uid 1000 (`hotel-app-be/Dockerfile:36-59`) with `no-new-privileges: true` (`deploy/docker-compose.prod.yml:110-111`) and no docker socket (`:93-97`). Detecting "the box is jailbroken" needs an OS-level agent (auditd, AIDE, fail2ban, unattended-upgrade notifications). That is a different deliverable and is deliberately not in these phases.

2. **No WAF, no IPS, no automated blocking.** Nothing here *blocks* an attack — it tells you one happened. Adding Caddy-level IP blocking or fail2ban on the access log from 1.2 is a reasonable follow-on but is not designed here.

3. **No log aggregation or retention beyond 7 days.** Host logrotate keeps `/opt/saliminn/logs/*.log` for 7 rotations (`deploy/deploy.sh:182-193`). If an incident is discovered 10 days late, the request logs are gone. `audit_logs` is retained indefinitely (nothing purges it — verified), so business-event forensics survive; traffic forensics do not.

4. **Prometheus + Grafana + Loki + Alertmanager is deliberately not the recommendation.** For a single VPS with one owner it is more operational surface than the thing it monitors, and it introduces its own uptime problem. If you later run multiple properties or hire ops staff, revisit — the counters from 1.3 are the natural export point. Until then, in-process rules plus one external heartbeat is the proportionate answer.

5. **No penetration test, no dependency CVE triage, no threat model.** This is a code and configuration review. `cargo audit` and `gitleaks` run in CI (`.github/workflows/security.yml`), but nobody has attacked a running instance. Findings here are derived from source, not from exploitation.

6. **The desktop app is only lightly covered.** Phases target the VPS deployment. The desktop build has its own exposures — unsigned artifacts (L14), placeholder updater trust anchors (`tauri.conf.json:72,74` still read `REPLACE_WITH_...` while the updater plugin is registered at `hotel-desktop/src-tauri/src/lib.rs:23`), the plaintext bootstrap-password file (M16) — none of which an in-app alerter on the server can observe.

7. **Two claims I could not verify from the tree, marked as such.** (a) Whether your Caddy version appends rather than replaces `X-Forwarded-For` — this determines the exact severity of H3; confirm with `curl -H "X-Forwarded-For: 1.2.3.4"` against production and check what the backend records. (b) The GitHub repository's default `GITHUB_TOKEN` permission level (L9) — a repository setting not visible from the working tree.

8. **`git` hygiene in a shared tree is your risk, not this plan's.** Several files were modified by a concurrent session during this review (`git status` showed 20+ modified paths including the Phase 0.1 fix). Per `.claude/rules/lessons.md`, do not run two sessions against this working tree — use worktrees. A `git checkout` at the wrong moment reinstates the unauthenticated PII endpoint described at the top of Section 3.

---

*Every technical claim in this document carries a `path:line` anchor verified against the working tree on 2026-07-27. Findings refuted by adversarial review are excluded. Two items are explicitly marked unverified in Section 7.*
