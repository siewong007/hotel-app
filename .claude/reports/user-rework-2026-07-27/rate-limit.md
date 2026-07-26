# Rate Limiting & Abuse Protection Audit

Repo: `/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app`
Scope: `hotel-app-be/src/core/rate_limiter.rs` (read in full, 328 lines) + every
consumer found via `grep -rn "rate_limit\|RateLimit" hotel-app-be/src`, plus
deployment topology (`docker-compose.yml`, `docs/guides/deployment.md`,
`deploy/Caddyfile`) and the user/RBAC domain for pagination/body/IN-clause
abuse surfaces.

All line numbers below were read directly this session; none are copied from
memory or from another report.

---

## 1. Algorithm

**Sliding-window log** (not fixed-window, not token bucket), keyed per
identifier, implemented from scratch — no crate (e.g. `governor`) used.

`core/rate_limiter.rs:37-70` (`RateLimitEntry::check_and_record`):
- Each key holds a `Vec<Instant>` of request timestamps.
- On every check: `self.timestamps.retain(|t| *t > cutoff)` where
  `cutoff = now - config.window` (line 53/56) — a true sliding window, not a
  bucket that resets on a boundary.
- If the retained count `< max_requests`, the request is admitted and its
  timestamp pushed (line 58-60); otherwise it is rejected and
  `retry_after = window - (now - oldest_timestamp)`, floored at 1s (line 61-68).

Two limiter types share this core:
- `RateLimiter` — keyed by `IpAddr` (`core/rate_limiter.rs:75-124`).
- `KeyedRateLimiter` — keyed by an arbitrary caller-supplied `String`
  (`core/rate_limiter.rs:129-165`), used for token/booking/guest-id keys.

### Configured buckets, quoted verbatim (`core/rate_limiter.rs:226-242`)

| Field | Limit | Window | Type |
|---|---|---|---|
| `auth` | 5 | 60s | `RateLimiter` (IP) |
| `register` | 10 | 600s | `RateLimiter` (IP) |
| `sensitive` | 10 | 300s | `RateLimiter` (IP) |
| `guest_portal_verify` | 10 | 300s | `RateLimiter` (IP) |
| `guest_portal_booking` | 5 | 900s | `KeyedRateLimiter` (booking number) |
| `guest_portal_token` | 5 | 900s | `KeyedRateLimiter` (token) |
| `guest_portal_token_payment` | 100 | 600s | `KeyedRateLimiter` (token) |
| `guest_portal_payment` | 100 | 600s | `KeyedRateLimiter` (guest id) |
| `guest_portal_token_read` | 120 | 900s | `KeyedRateLimiter` (token) |
| `guest_portal_support_mutation` | 30 | 900s | `KeyedRateLimiter` |
| `guest_portal_support_mutation_ip` | 120 | 900s | `RateLimiter` (IP) |
| `guest_portal_booking_create` | 10 | 900s | `KeyedRateLimiter` (guest id) |
| `guest_portal_booking_create_ip` | 30 | 900s | `RateLimiter` (IP) |
| `api` | 200 | 60s | `RateLimiter` (IP) — **see Finding R-3, never wired to any route** |
| `webhook` | 60 | 60s | `RateLimiter` (IP) |

---

## 2. Keying — IP derivation and the trust boundary

`routes/mod.rs:56-73` (`extract_client_ip`):

```rust
pub(crate) fn extract_client_ip(headers: &axum::http::HeaderMap, peer_addr: SocketAddr) -> IpAddr {
    if !config::get().trust_proxy_headers {
        return peer_addr.ip();
    }
    headers.get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())          // <-- takes the FIRST entry
        .and_then(|s| s.trim().parse().ok())
        .or_else(|| headers.get("x-real-ip")....)
        .unwrap_or_else(|| peer_addr.ip())
}
```

Gated by `config::get().trust_proxy_headers`, sourced from env var
`TRUST_PROXY_HEADERS` (`core/config.rs:30,162`, default `false` — verified in
`hotel-app-be/.env.example:79` and `docker-compose.yml` backend service:
`TRUST_PROXY_HEADERS: ${TRUST_PROXY_HEADERS:-false}`).

### R-1 (BLOCKER): documented nginx reverse-proxy config + `TRUST_PROXY_HEADERS=true` makes every IP-keyed limiter trivially bypassable

`docs/guides/deployment.md:262` tells the operator: `TRUST_PROXY_HEADERS` —
"Only `true` behind a trusted reverse proxy." The same file's own "Manual
Deployment" / nginx reverse-proxy example (the *documented* non-Docker
production path) sets, verbatim, at `docs/guides/deployment.md:190`:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

`$proxy_add_x_forwarded_for` is nginx's **append** variable: if the inbound
request already carries an `X-Forwarded-For` header, nginx appends its own
`$remote_addr` to the end rather than replacing it (this is well-documented
nginx behavior, not project-specific). So a request sent directly to nginx as
`X-Forwarded-For: 203.0.113.9` arrives at the backend as
`X-Forwarded-For: 203.0.113.9, <real client IP>`.

`extract_client_ip` (`routes/mod.rs:64`) does `s.split(',').next()` — it takes
the **first**, attacker-controlled entry, not the last (trusted-hop) entry.
Any external client can therefore set an arbitrary, freshly-generated fake IP
on every request and the backend will bucket each request under a distinct
key. Combined with the fact that this is the exact, only-documented way to
make `TRUST_PROXY_HEADERS=true` "work" for a non-Docker deployment
(`docs/guides/deployment.md:262` recommends turning it on precisely for this
proxy), this defeats **every** IP-keyed limiter in the table above —
`auth`, `register`, `sensitive`, `guest_portal_verify`,
`guest_portal_support_mutation_ip`, `guest_portal_booking_create_ip`,
`webhook` — with a single spoofed header per request, for unlimited login /
2FA / recovery-code / passkey / registration attempts.

Verified via `WebFetch` against Caddy's own docs that **Caddy** (the
Docker-Compose HTTPS path, `deploy/Caddyfile`, no `trusted_proxies`
configured) does the opposite by default: it discards any client-supplied
`X-Forwarded-For` and sets the header to only the real peer address ("by
default, the proxy will ignore \[incoming\] values ... to prevent spoofing").
So the Docker+Caddy path (`docker-compose.yml` + `--profile https`) is **not**
exploitable this way — confirmed only for Caddy, not nginx. The vulnerability
is specific to the documented manual/nginx deployment path once an operator
follows the docs' own advice to flip `TRUST_PROXY_HEADERS=true` there.

Root cause is in the app, not just the docs: `extract_client_ip` trusts
*any* caller of the header once the boolean flag is on — it never validates
that the immediate peer (`peer_addr`) is itself one of a known/trusted proxy
CIDR, and it takes the leftmost (client-controlled) comma entry instead of
the rightmost (nearest-hop) one. A correct implementation needs both: only
honor `X-Forwarded-For` when `peer_addr` is inside a configured trusted-proxy
CIDR list, and then take the rightmost entry not consumed by trusted hops.

### R-2 (HIGH): default (`TRUST_PROXY_HEADERS=false`) silently turns all IP-keyed limits into one shared, whole-site bucket when any reverse proxy is in front

Even on the *safe* Caddy/Docker path, `TRUST_PROXY_HEADERS` is **not** set to
`true` by `docker-compose.yml`'s own default (`${TRUST_PROXY_HEADERS:-false}`)
— the operator must add it to `.env` by hand per
`docs/guides/deployment.md:104`. If they don't (easy to miss — it is not part
of the `docker compose --profile https up -d` command itself, only a
prerequisite `.env` line), `extract_client_ip` returns `peer_addr.ip()` for
every request, and because all traffic arrives at the backend from the same
docker-network peer (Caddy's/nginx's container/loopback address), **every
client on the whole site shares one 5-per-60s login bucket, one 10-per-600s
registration bucket, etc.** One user's failed logins (or one attacker's
deliberate burst of 5 bogus logins) locks out the *entire site's* login
endpoint for the next `retry_after` window — a trivial, unauthenticated,
repeatable denial-of-service against login for all legitimate users, and it
requires no header spoofing at all, just knowledge of the default. Nothing in
the code warns or fails loudly when this condition holds (peer_addr is always
a valid IP, so the limiter "works", just against the wrong population).

### Desktop mode (unaffected)

`HOTEL_DESKTOP_MODE` binds to `127.0.0.1` (per CLAUDE.md and confirmed by
`main.rs:236` binding `"127.0.0.1"` in desktop mode) with a single local
client, so IP-keying is a non-issue there; `TRUST_PROXY_HEADERS` is
irrelevant in that mode (no reverse proxy sits in front of the sidecar).

---

## 3. Coverage matrix

### Routes that DO call a rate limiter (confirmed by reading the file)

| Route(s) | Bucket | File:line |
|---|---|---|
| `POST /auth/login` | `auth` (5/60s, IP) | `routes/auth.rs:58-76` |
| `POST /auth/refresh` | `sensitive` (10/300s, IP) | `routes/auth.rs:91-108` |
| `POST /auth/register` | `register` (10/600s, IP) | `routes/auth.rs:121-139` |
| `POST /auth/passkey/register/start` \| `/finish` | `sensitive` (IP) | `routes/passkey.rs:28-72` |
| `POST /auth/passkey/login/start` \| `/finish` | `auth` (IP) | `routes/passkey.rs:74-126` |
| `POST /auth/2fa/setup` \| `/enable` \| `/disable` \| `/verify` \| `/regenerate-backup-codes` | `sensitive` (IP) | `routes/two_factor.rs:32-148` |
| `POST /profile/password` | `sensitive` (IP) | `routes/profile.rs:62-82` |
| `POST /profile/2fa/setup` \| `/enable` \| `/disable` \| `/verify` (duplicate surface of `/auth/2fa/*`, same handlers) | `sensitive` (IP) | `routes/profile.rs:137-231` |
| `POST /webhooks/paypal` | `webhook` (60/60s, IP) | `routes/webhooks.rs:23-39` |
| Guest portal verify/booking/token/payment/support/direct-booking routes (11+ endpoints) | various guest_portal_* buckets | `routes/guest_portal.rs`, `handlers/guest_portal.rs`, `services/guest_portal.rs`, `modules/support/handlers.rs`, `modules/guest_booking/handlers.rs` |
| Promotions redemption endpoints | (uses `RateLimiters` extension — guest_portal-style keying) | `modules/promotions/handlers.rs:50,85` |

### Sensitive routes confirmed NOT rate limited (read the full route file; zero `RateLimiters`/`check_with_retry` reference)

| Route | Why it matters | Evidence |
|---|---|---|
| `POST /auth/verify-email` | Token brute-force surface (`EmailVerificationConfirm.token`, min 32 chars — high entropy so brute force is impractical, but nothing throttles guessing attempts either) | `routes/auth.rs:44,142-147`; no limiter param on `verify_email` |
| `POST /auth/resend-verification` | **Unauthenticated, unthrottled, triggers a real outbound email** to any address the caller supplies (`ResendVerificationRequest.email`, `models/auth.rs:121-124`). No IP or per-email limiter anywhere in `routes/auth.rs:149-154` or `services/auth.rs:466-488`. Response is a generic "if that account needs verification..." message (`services/auth.rs:490-494`, good anti-enumeration design) — but an attacker can still email-bomb any unverified user's inbox indefinitely, and drive up transactional-email provider cost/quota, with zero throttling. |
| `POST /users` (create user) | Explicitly named in task scope | `routes/users.rs:28-58` — full file read, zero `RateLimiters` import/usage anywhere in the file |
| `POST /users/roles` (assign role) | Explicitly named in task scope | `routes/users.rs:91-100` |
| `PUT /users/{id}/roles` (replace roles) | Same | `routes/users.rs:112-127` |
| `DELETE /users/{id}/roles/{role_id}` | Same | `routes/users.rs:102-110` |
| `PATCH/DELETE /users/{id}` (update/delete user) | Privileged mutation | `routes/users.rs:60-80` |
| ALL of `/rbac/*` (roles, permissions, route-policies CRUD) | Privilege-escalation-adjacent | `routes/rbac.rs` — file confirmed absent from the repo-wide `grep -rn "rate_limit\|RateLimit"` result entirely |
| `POST /ekyc/upload-document`, `POST /ekyc/submit`, `POST /ekyc/self-checkin` | File upload + verification-workflow creation, no throttle | `modules/ekyc/routes.rs:24-30` — module absent from the repo-wide rate-limiter grep |
| Every route in `bookings`, `payments`, `ledgers`, `rooms`, `guests`, `housekeeping`, `maintenance`, `rates`, `analytics`, `companies`, `audit`, `search`, `night_audit`, `data_transfer`, `communications` (mutations), `settings` | No general "authenticated API" throttle exists at all — see Finding R-3 | Confirmed: none of these route files appear in `grep -rn "rate_limit\|RateLimit" hotel-app-be/src` output |
| "Password reset" (self-service, unauthenticated) | N/A — **no such flow exists in this codebase.** Only an authenticated `/profile/password` change (rate limited) and an admin-driven `update_user`/CLI `fix_password` reset (not rate limited, see above). Confirmed via `grep -rniE "forgot.?password|password.?reset" hotel-app-be/src` → only hits in `bin/fix_password.rs` (a local CLI tool) and a code comment in `services/users.rs:130,137`. | — |

### R-3 (HIGH): the general "authenticated API" bucket exists in config but is never wired to any route — no throttle on privileged mutations

`core/rate_limiter.rs:208-210`:
```rust
/// General API: 200 per minute per IP (lenient - normal usage)
#[allow(dead_code)]
pub api: RateLimiter,
```
and the dispatcher that would use it, `check_rate_limit` (`core/rate_limiter.rs:245-262`), is also `#[allow(dead_code)]` and its doc comment admits it is "primarily used by legacy tests." Confirmed by grep: `limiters.api` / `.api.check` / `check_rate_limit(` appear **only** inside `core/rate_limiter.rs` itself (its own dispatcher body) and its `#[cfg(test)]` module — never from any route or handler in the whole backend (`grep -rn "limiters\.api\|\.api\.check\|check_rate_limit(" hotel-app-be/src` returns only `core/rate_limiter.rs:249,259,260`). So `POST /users`, `POST /users/roles`, all of `/rbac/*`, and every business-domain route listed above have **zero** rate limiting of any kind — not even the lenient 200/min catch-all that the code implies exists. An attacker holding (or having stolen) any valid session token can hammer user-creation, role-assignment, or any business endpoint at whatever rate the server can physically process, with no backpressure.

---

## 4. Memory — eviction and unbounded-growth risk

**There IS a prune path** — every `RateLimiter`/`KeyedRateLimiter` spawns a
background `tokio::spawn` cleanup loop at construction time
(`core/rate_limiter.rs:87-100` and the identical `134-153` for
`KeyedRateLimiter`):
```rust
tokio::spawn(async move {
    loop {
        tokio::time::sleep(Duration::from_secs(300)).await;   // every 5 minutes
        let mut map = entries.lock().await;
        let now = Instant::now();
        map.retain(|_, entry| {
            entry.timestamps.retain(|t| now.duration_since(*t) < window);
            !entry.timestamps.is_empty()
        });
    }
});
```
So the map is not permanently unbounded — every 300s, any key whose
timestamps have all aged out of its window is dropped entirely.

### R-4 (MEDIUM, compounds with R-1): no hard cap between prunes — combined with the header-spoofing bypass (R-1), this becomes a memory-exhaustion vector

Between cleanup ticks (up to 5 minutes), there is **no maximum entry count** —
`entries: Arc<Mutex<HashMap<IpAddr, RateLimitEntry>>>` / `HashMap<String, ...>`
grows with every *distinct* key seen. Under normal operation (genuine IPs),
growth is naturally bounded by real client population. But per Finding R-1, an
attacker who can set `X-Forwarded-For` (in the vulnerable nginx-fronted
config) can mint an unlimited number of distinct "IP" keys — one per request —
each inserting a new `RateLimitEntry` (`HashMap` entry + `Vec<Instant>`
allocation, `core/rate_limiter.rs:42-47`) that will not be reclaimed for up to
5 minutes. A sustained flood at, say, 5,000 req/s for 5 minutes inserts 1.5M
entries into a single `Mutex`-guarded `HashMap` before the next prune — a
real, if not catastrophic, memory-growth and lock-contention DoS vector layered
on top of the auth-bypass in R-1. Independent of R-1, even genuine IPv6
clients (effectively unlimited address space per residential prefix) hitting
`webhook`/`auth` from rotating source addresses would produce the same
unbounded-until-prune growth; no cap exists either way.

---

## 5. Concurrency

Both limiter types use `tokio::sync::Mutex<HashMap<...>>`
(`core/rate_limiter.rs:76,130`) — a single async mutex per *bucket*, not
sharded by key.

**No lock-held-across-await risk found.** `check_with_retry`
(`core/rate_limiter.rs:114-118` and `159-165`) is:
```rust
pub async fn check_with_retry(&self, ip: IpAddr) -> (bool, u64) {
    let mut entries = self.entries.lock().await;
    let entry = entries.entry(ip).or_insert_with(RateLimitEntry::new);
    entry.check_and_record(&self.config)   // synchronous, no .await
}
```
The lock guard is dropped at the end of the synchronous body; `check_and_record`
(lines 51-70) does no I/O and no `.await`. Same shape in the cleanup task
(lines 92-98): the lock is held only across a synchronous `retain`, not across
`sleep`. **No deadlock risk.**

### R-5 (LOW/nit): whole-bucket mutex is a scalability bottleneck, not a correctness bug

Every request checking, e.g., the `auth` bucket serializes through **one**
`Mutex`, regardless of which IP it is for — two different legitimate users
logging in concurrently contend on the same lock even though they touch
different `HashMap` keys (a sharded map, e.g. by hashing the key into N
mutex-guarded shards, would remove this). For a hotel-PMS-scale login rate
this is very unlikely to matter in practice; flagged for completeness since
the audit asked specifically about lock-across-await/contention risk.

---

## 6. Multi-process

**Explicitly single-process by design and by construction.**
- Doc comment: `core/rate_limiter.rs:1-4` — "In-memory rate limiter ... Suitable
  for single-instance deployments (hotel PMS)."
- `core/rbac_cache.rs:15` cross-references it: "Single-process design (mirrors
  `crate::core::rate_limiter`)".
- `RateLimiters::new()` is constructed exactly once per process, at router
  build time, `routes/mod.rs:200`, then shared via `axum::Extension`
  (`routes/mod.rs:256`) — an `Arc`-backed clone is handed to every request
  within that one process; there is no cross-process store (no Redis, no
  shared DB table).

**Verified deployment topology has no replica/scale-out configuration today:**
`docker-compose.yml` defines exactly one `backend` service with no `deploy:`
block and no `replicas:` key (confirmed: `grep -rn "replicas" *.yml *.yaml`
across the whole repo returns zero hits). `docs/guides/deployment.md:205-214`
does mention Kubernetes as an *alternative* deployment path ("`Deployment` for
backend (with health checks)") but gives no replica-count guidance and no
warning that this rate limiter's state does not survive or synchronize across
pods.

### R-6 (MEDIUM, latent — no evidence it is exercised today): Kubernetes/Swarm scale-out silently multiplies every limit and resets it on every pod restart

If an operator follows `docs/guides/deployment.md:205-214` and runs the
backend as a Kubernetes `Deployment` with `replicas > 1` (the normal reason to
use a `Deployment` resource over a bare `Pod`), each pod gets an independent
`RateLimiters` instance. A `Service` load-balancing across N pods gives an
attacker roughly N× every limit (e.g., N×5 login attempts/minute) simply by
making enough concurrent connections to be distributed across backends, and
every pod restart/rolling-update resets all counters to zero. Labeled
UNVERIFIED-IN-PRACTICE because no k8s manifest exists in this repo to inspect
(the doc is prose-only) — but the code has no safeguard (no replica-count
check, no warning at startup) if this path is taken, and nothing in the repo
would surface the degradation.

---

## 7. Behavior on limit

**Status code and header: correct.** `core/error.rs:143-165`:
- `ApiError::TooManyRequests` and `ApiError::TooManyRequestsRetryAfter` both
  map to `StatusCode::TOO_MANY_REQUESTS` (429) — `core/error.rs:143-150`.
- For `TooManyRequestsRetryAfter`, a `Retry-After` header carrying the exact
  computed seconds is added — `core/error.rs:158-164`.
- Client-facing message is genericized via `polish_message(...)`
  (`core/error.rs:145,149`) — no internal detail leak.

### R-7 (HIGH): a rate-limit rejection is never logged or audited anywhere

Confirmed by `grep -rniE "log::(warn|info|error).*rate.?limit|rate.?limit.*log::" hotel-app-be/src` → **zero matches**. Every call site that checks
`.check_with_retry(...)` and gets `allowed == false` (e.g.
`routes/auth.rs:67-76`, `routes/two_factor.rs:40-49`, `routes/passkey.rs:36-45`,
`routes/webhooks.rs:31-37`) does nothing but construct and return the
`ApiError` — no `log::warn!`, no call into `services/audit.rs::AuditLog`, no
counter/metric. Contrast with the adjacent, non-rate-limit failure path in the
same function (`services/auth.rs:99-106,113-120`), which DOES call
`AuditLog::log_login_failure` on a bad password. A sustained brute-force or
credential-stuffing run that trips the `auth` limiter over and over produces
**no audit_logs row, no application log line, no metric** distinguishing it
from ordinary traffic — the only visibility is whatever the blanket
`TraceLayer::new_for_http()` (`routes/mod.rs:264`) emits at its default
tracing verbosity, which is a generic per-request access-log line (method,
path, status, latency), not a security event. There is no way today to alert
on, count, or forensically review "how many times was someone rate-limited,
and from where."

---

## 8. Other abuse controls in the user domain

### R-8 (MEDIUM): `GET /users` has no pagination and no cap — always returns the entire table

`routes/users.rs:42-48` — the handler signature takes **no `Query` extractor
at all**:
```rust
async fn get_users(State(pool): State<DbPool>, headers: HeaderMap)
    -> Result<Json<Vec<models::UserResponse>>, ApiError> {
    require_any_permission_helper(&pool, &headers, USER_READ_PERMISSIONS).await?;
    handlers::users::get_users_handler(State(pool)).await
}
```
So `GET /users?limit=1000000` doesn't do anything different from plain
`GET /users` — the query string is simply ignored; there is no limit param to
exploit because there is no limit at all, ever. Traced through
`handlers/users.rs:14-18` → `services/users.rs:22-28` (`svc::users`) →
`repositories/user.rs:48-55` (`UserRepository::list_all`):
```rust
sqlx::query_as::<_, User>(&format!(
    "SELECT {USER_COLUMNS} FROM users WHERE deleted_at IS NULL ORDER BY username"
))
.fetch_all(pool)
```
No `LIMIT`/`OFFSET` clause anywhere in the query. For a hotel-staff-scale
users table this is low real-world impact today, but it is an unbounded
full-table fetch-and-serialize on every call to a route with no throttle
(R-3) — a very large staff roster (or a future merge with a guest-accounts
table) would make this an easy resource-exhaustion lever.

### R-9 (MEDIUM): `PUT /users/{id}/roles` accepts an unbounded `role_ids` array and inserts them one row at a time inside a single held transaction

`models/rbac.rs:66-69`:
```rust
pub struct UserRoleIdsInput {
    pub role_ids: Vec<i64>,
}
```
No `Validate` length constraint on `role_ids` (no `#[validate(length(max = ...))]`
anywhere on this struct). `repositories/rbac.rs:448-478`
(`RbacRepository::replace_user_roles`):
```rust
let mut tx = pool.begin().await...;
sqlx::query("DELETE FROM user_roles WHERE user_id = $1")...;
for role_id in role_ids {
    sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(user_id).bind(role_id).execute(&mut *tx).await...;
}
tx.commit().await
```
This is not a SQL-injection risk (fully parameterized), but it is an
unbounded-input / request-amplification risk: bounded only by axum's default
2MB JSON body limit (confirmed no `DefaultBodyLimit` override on
`/users/*` — `routes/users.rs` never imports `DefaultBodyLimit`), a caller can
submit on the order of ~100k+ integers in `role_ids` in one request, each
producing a **sequential, awaited** round trip to Postgres inside one
long-held transaction/connection (no batching, e.g. `unnest($1::bigint[])`
or a single multi-row `INSERT ... VALUES (...),(...)`). Combined with R-3
(this route has zero rate limiting), a single authenticated low-privilege
session with `users:update`/`users:manage` can tie up a database connection
and a transaction for an extended period, repeatedly, with no backoff.

### Body size limits — checked, no gap found

Axum 0.8 (`Cargo.toml:21` — `axum = { version = "0.8", ... }`) enforces a
**built-in 2MB default limit** on `Bytes`/`String`/`Json`/`Form` extraction
even when the app never adds a `DefaultBodyLimit` layer (verified via
`WebFetch` against `docs.rs/axum` — "for security reasons, `Bytes` will, by
default, not accept bodies larger than 2MB"). Two routes explicitly raise
this where large payloads are legitimate:
`routes/guest_portal.rs:29` (`DefaultBodyLimit::max(10 * 1024 * 1024)`, guest
document/photo uploads) and `routes/data_transfer.rs:22`
(`DefaultBodyLimit::max(100 * 1024 * 1024)`, bulk import). No route removes or
raises the limit unsafely (`DefaultBodyLimit::disable()` does not appear
anywhere in `hotel-app-be/src`). **Not a finding** — flagged only because the
task asked for it explicitly; the mechanism is sound.

One adjacent observation (not a rate-limiting/abuse-protection finding, noted
for completeness): `modules/ekyc/routes.rs` accepts `Multipart` document
uploads (`upload_document`, line 68) with **no** `DefaultBodyLimit` override,
so it is capped at the same 2MB default as ordinary JSON routes — likely too
small for a real ID-document photo, in contrast to the guest-portal upload
route which was explicitly raised to 10MB. This is a functionality gap
(legitimate uploads may be rejected), not an abuse-surface gap.

### Unbounded IN-clauses — none found built from raw user input

Grepped `repositories/user.rs` and `repositories/rbac.rs` for
dynamically-built `IN (...)` / `.join(",")` SQL string construction
(`grep -rniE ".join\(\",\"\)|format!\(.*IN \(" ...`) — **zero matches**. The
one place that loops over a user-supplied list (`replace_user_roles`, R-9
above) does so as N parameterized single-row statements, not a
concatenated `IN (...)` clause, so there is no SQL-injection angle — the
issue there is purely the unbounded loop count (R-9), not clause
construction.

---

## Summary of findings by severity

| ID | Severity | One-line summary |
|---|---|---|
| R-1 | Blocker | Documented nginx `$proxy_add_x_forwarded_for` (append) + backend's "take first CSV entry" `extract_client_ip` = trivial spoof of every IP-keyed limiter once `TRUST_PROXY_HEADERS=true` (which the same doc tells the operator to set for that exact proxy) |
| R-2 | High | Default `TRUST_PROXY_HEADERS=false` behind Caddy/nginx collapses all per-IP limits into one whole-site bucket unless the operator manually adds the env var — undocumented-in-the-command-itself, silent failure mode, self-inflicted login DoS |
| R-3 | High | No rate limiting at all on `/users` (create/update/delete/roles), all of `/rbac/*`, and every other business-domain route — the "general API" bucket (`RateLimiters.api`) is dead code, never invoked outside its own test |
| R-7 | High | Rate-limit rejections are never logged or audited anywhere — zero attack visibility, no way to detect a brute-force run that is being (correctly) blocked |
| R-4 | Medium | No hard cap on in-memory map size between 5-minute prunes; compounds with R-1 into a memory-growth DoS via spoofed keys |
| R-6 | Medium (latent/unverified in practice) | Docs suggest Kubernetes `Deployment` scale-out with no warning that rate-limiter state is per-process and unsynchronized across replicas |
| R-8 | Medium | `GET /users` has no pagination/cap at all — always a full unbounded table fetch |
| R-9 | Medium | `PUT /users/{id}/roles` accepts an unbounded `role_ids` array, inserted one-row-at-a-time inside one held DB transaction, on a route with zero rate limiting |
| R-5 | Low | Single `Mutex` per bucket serializes all keys, not sharded — no deadlock risk, minor contention only |
| — | Not a finding | Login/refresh/register/2FA/passkey/webhook ARE correctly rate-limited with sane limits; 429 + `Retry-After` behavior is correct; body-size limits are sound (axum default 2MB + explicit raises where needed); no unbounded raw-SQL `IN (...)` construction found; no lock-held-across-await found |

Also noted but out of primary scope: `POST /auth/resend-verification` (email
verification resend) has zero throttling and can be used to email-bomb any
address, though the response itself does not leak account existence.
