# Commander findings — verified directly, not via subagent

Session 2026-07-27. Every item below was read/grepped by the main session itself.
These are *inputs* to SYNTHESIS.md, not duplicates of it.

## C1 — `user_roles.expires_at` is schema-only: expired role grants never expire (blocker)

`user_roles` declares `expires_at timestamp with time zone`
(`database/postgres/migrations/0001_v1_baseline.sql`, `CREATE TABLE public.user_roles`).

Every permission/role resolution query joins `user_roles` with **no expiry predicate**:

- `src/core/rbac_cache.rs:90-101` — `SELECT DISTINCT p.name … INNER JOIN user_roles ur ON rp.role_id = ur.role_id WHERE ur.user_id = $1`
- `src/core/rbac_cache.rs:103-113` — same for role names
- `src/core/auth.rs:459` — `AuthService::check_permission` SQL
- `src/core/auth.rs:475` — `AuthService::get_user_roles`
- `src/repositories/rbac.rs:228, 393, 489`
- `src/repositories/user.rs:422, 441, 464`

`grep -rn "expires_at" src/repositories/rbac.rs src/core/rbac_cache.rs src/repositories/user.rs`
returns **nothing** — the column is never read anywhere.

It is also never *written*: all four insert sites are
`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)` —
`src/repositories/rbac.rs:161`, `src/repositories/rbac.rs:466`,
`src/repositories/auth.rs:266`, `src/repositories/user.rs:127`.

**Impact:** a temporary role grant (contractor, seasonal night-auditor, a "just for
tonight" manager override) is permanent by construction. An operator who sets an
expiry through any future UI would be told the access lapses; it never does.

**Fix:** add `AND (ur.expires_at IS NULL OR ur.expires_at > CURRENT_TIMESTAMP)` to all
eight resolution queries, accept an optional expiry at assignment time, and bound the
rbac-cache TTL so an expiry takes effect within one TTL window (or store the earliest
expiry with the cache entry and expire the entry at that instant).

## C2 — `assigned_by` / `granted_by` are never written: role grants have no actor (high, traceability)

`user_roles.assigned_by bigint` and `role_permissions.granted_by bigint` exist in the
baseline. `grep -rn "assigned_by\|granted_by" --include="*.rs" src/` returns exactly one
hit — `src/services/audit.rs:126`, a JSON *detail key*, not a column write.

**Impact:** the question "who gave this account the admin role, and when" cannot be
answered from the authorization tables at all. It is answerable only if a matching
`audit_logs` row happens to exist and survives retention — and the audit write is
best-effort in several paths. This is precisely the traceability gap the rework targets.

**Fix:** thread the actor into all four insert sites and write `assigned_by` /
`granted_by`. Both columns already exist, so this is a code-only change with no patch.

## C3 — `check_permission` does the `:manage` fallback twice; the route consts do it a third time (medium, efficiency)

`src/core/rbac_cache.rs:122-132` (`has_permission`) already derives and checks
`<resource>:manage` internally. `src/core/middleware.rs:43-53` then derives
`<resource>:manage` **again** and issues a second `AuthService::check_permission` call.
On top of that, `src/routes/users.rs:21-25` defines
`USER_READ_PERMISSIONS = &["users:read", "users:manage"]` and passes it to
`require_any_permission_helper`, which loops `check_permission` over both entries
(`src/core/middleware.rs:61-78`).

Worst case for one denied request: `users:read` → (implicit `users:manage`) → explicit
`users:manage` → (implicit `users:manage`) = 4 resolutions. Same shape in every
`*_PERMISSIONS` const array in `routes/users.rs`.

**Fix:** delete `middleware.rs:43-53`, and collapse the const arrays to a single string —
`require_permission_helper(&pool, &headers, "users:read")` is behaviourally identical
because `:manage` is implied one level down. Keep `check_any_permission` only where the
alternatives are genuinely different *resources* (e.g. `analytics:read` OR
`reports:execute`).

## C4 — `is_super_admin` is enforced nowhere (high)

`users.is_super_admin boolean DEFAULT false` exists in the baseline.
`src/core/middleware.rs:129-152` `require_super_admin_helper` is the only reader and is
`#[allow(dead_code)]` — zero call sites. So no endpoint is super-admin-only, and nothing
distinguishes the bootstrap administrator from any account holding `users:manage`.

**Consequence to check in the rework:** whatever protects the seeded admin role, the
last-admin-standing case, and system-role editing must be an explicit rule; there is no
super-admin backstop today.

## C5 — divergent, spoofable `client_ip` in the eKYC module (high, security)

The canonical helper `src/routes/mod.rs:56-73` `extract_client_ip` is correct: it returns
`peer_addr.ip()` unless `config::get().trust_proxy_headers` is set, and only then reads
`x-forwarded-for` / `x-real-ip`.

`src/modules/ekyc/routes.rs:395-405` defines its **own** `client_ip(&HeaderMap)` that reads
`x-forwarded-for` then `x-real-ip` with **no `trust_proxy_headers` gate and no peer-address
fallback** — it never sees the socket at all. Every eKYC audit/attribution call site
(`routes.rs:136,179,197,215,235,255,280,315,334,381`) records a caller-supplied string.

**Impact:** identity-verification events — the most sensitive audit trail in the product —
are attributed to an IP the client chooses. Fix: delete the local helper, take
`ConnectInfo<SocketAddr>` and call `crate::routes::extract_client_ip`, exactly as
`src/modules/promotions/handlers.rs:22-24` already does.

## C6 — unthrottled sensitive auth endpoints (high)

From `src/routes/auth.rs` (read in full):

| route | limiter |
|---|---|
| `POST /auth/login` | `limiters.auth` — 5 / 60s **per IP** |
| `POST /auth/refresh` | `limiters.sensitive` — 10 / 300s per IP |
| `POST /auth/register` | `limiters.register` — 10 / 600s per IP |
| `POST /auth/logout` | **none** |
| `POST /auth/verify-email` | **none** |
| `POST /auth/resend-verification` | **none** |

`resend-verification` sends mail and takes an address — unthrottled it is both an email
amplifier and an account-enumeration oracle. Two further structural gaps in
`src/core/rate_limiter.rs` (read in full, 328 lines):

1. **Login is keyed by IP only.** `RateLimiters` carries eleven guest-portal buckets, and
   *not one* staff-side bucket keyed by username or user id. A hotel's staff all share one
   NAT egress IP, so 5 attempts/minute is shared across the whole front desk (support
   burden), while a distributed attacker gets unlimited attempts per account.
   `KeyedRateLimiter` already exists and is exactly the right tool — the guest portal uses
   it seven times.
2. **A rate-limit rejection is never audited or logged.** `check_and_record`
   (`rate_limiter.rs:51-70`) returns `(false, retry_after)` and every caller turns that
   straight into an `ApiError`. There is no counter, log line, or `audit_logs` row, so a
   credential-stuffing run against this deployment is invisible after the fact.

## C7 — the house module pattern is not uniform (medium, maintainability)

`src/modules/settings/routes.rs:36-62` puts `require_permission_helper` in the **routes**
layer and keeps `handlers.rs` permission-free.
`src/modules/promotions/handlers.rs:63-200` puts auth extraction in the **handlers** layer.

Both are "the house pattern" depending on which module you copy. The user-domain migration
must pick one and state it, or it will inherit the ambiguity into seven more files. The
settings shape (gate in `routes.rs`, one line per route, handler takes a plain `user_id`)
is the better target: it keeps the route table and its permission next to each other, which
is what makes the route→permission map machine-diffable.

## C8 — `ensure_audit_logs_partition` has no Rust caller (medium)

`audit_logs` is `PARTITION BY RANGE (created_at)` monthly, with
`ensure_audit_logs_partition(p_month date)` to pre-create months
(baseline:272-319). `grep -rn "ensure_audit_logs_partition" --include="*.rs"` → **no hits**;
the only invocation is inside SQL at baseline:9602. Nothing in the running application
pre-creates next month's partition.

Rows still land in `audit_logs_default`, so this is not an outage — but the function's own
comment warns that creating a month late takes exclusive locks and moves data
("Pre-create months during maintenance"). A long-lived deployment accumulates the whole
trail in the default partition and then pays a locking split whenever someone finally runs
it. The night-audit scheduler (`src/services/night_audit_scheduler.rs`) is an existing,
already-wired place to call it monthly.
