# User-domain test coverage and verification-gate audit

Scope: `hotel-app-be/tests/` + `hotel-web-fe/src/**/*.test.ts(x)` touching
users/rbac/audit/auth/2FA/passkey/profile. Static analysis only — no test
suite was executed (per instructions). Every function-name/line claim below
was verified with `grep -n`/`Read` against the working tree on 2026-07-27.

---

## 1. Test files touching the user domain, and what each asserts

### Backend (`hotel-app-be/tests/`)

| File | Lines | Domain | What it actually asserts (fn — one line) |
|---|---|---|---|
| `rbac_profile.rs` | 1396 | rbac, profile, 2FA, auth(login) | 10 scenarios, all `#[tokio::test]`, all skip gracefully if `DATABASE_URL` unset (`setup_pg_pool`, line 55-70): <br>• `postgres_check_permission_grants_exact_match_and_denies_missing_permission` (231) — exact-match grant + `Forbidden` on missing perm via `middleware::check_permission`. <br>• `postgres_manage_permission_implies_resource_actions` (273) — `<resource>:manage` implies read/create on that resource but not an unrelated resource. <br>• `postgres_role_and_permission_management_reflects_in_permission_checks` (323) — `assign_permission_to_role`/`remove_permission_from_role`/`replace_role_permissions` change `check_permission` results immediately (cache invalidation); `create_role`/`update_role`/`delete_role` CRUD lifecycle. <br>• `postgres_user_role_assignment_changes_effective_permissions` (472) — `assign_role_to_user`/`remove_role_from_user`/`replace_user_roles` change effective permissions immediately. <br>• `postgres_password_change_rejects_wrong_current_and_login_works_with_new_password` (576) — `profile::update_password` rejects wrong current password (hash unchanged), accepts correct one, old password then fails `login`. <br>• `postgres_session_listing_and_revoke_removes_only_target_session` (678) — `profile::list_sessions`/`revoke_session`: two live sessions, `is_current` flagging, revoke removes only the target, re-revoke → `NotFound`. <br>• `postgres_two_factor_status_verify_and_disable_lifecycle_with_live_totp` (795) — `two_factor::get_2fa_status`/`verify_2fa_code`/`disable_2fa` against a directly-seeded enabled-2FA row, using a real generated TOTP code (`totp-rs`). <br>• `postgres_two_factor_setup_enable_regenerate_and_recovery_code_disable` (919) — full `setup_2fa → enable_2fa → regenerate_backup_codes → disable_2fa(recovery code)` lifecycle incl. challenge single-use/expiry/stale-challenge rejection and `two_factor_challenges` row hygiene. <br>• `postgres_login_with_recovery_code_consumes_code_and_audits` (1233) — `auth::login` with a recovery code: consumes it, reports `recovery_codes_remaining`, writes `two_factor_recovery_code_used` + `login_success(method=password+2fa_recovery)` audit rows, rejects replay. |
| `auth_session.rs` | 444 | auth (JWT + session lifecycle) | Non-PG (`#[test]`, always run): `jwt_with_wrong_signature_is_rejected` (42), `jwt_that_has_expired_is_rejected` (64). PG-gated (`mod postgres_tests`, skip if no `DATABASE_URL`): `postgres_login_mints_access_token_and_session` (201) — login mints access token + refresh-token row (ip/user-agent/expiry). `postgres_refresh_rotates_access_and_refresh_tokens` (274) — refresh rotates the token, preserves `sid`, rejects replay of the consumed token. `postgres_logout_invalidates_session_and_blocks_refresh` (360) — logout revokes the session row, `is_session_active` flips false, refresh with the revoked token fails, but the already-issued JWT itself still verifies (stateless-JWT design note). |
| `rate_limiter_tests.rs` | 164 | rate limiter (infra used by auth routes) | Non-PG, always run: `rate_limiter_allows_requests_up_to_configured_limit` (21), `rate_limiter_enforces_limit` (33), `rate_limiter_different_ips_have_independent_buckets` (51), `rate_limiter_different_routes_have_independent_buckets` (66), `rate_limiter_recovers_over_time` (83), `rate_limiter_handles_high_load_gracefully` (102), `keyed_rate_limiter_tracks_keys_independently` (119), `guest_payment_limit_allows_100_attempts_in_ten_minutes` (128) — all test the generic `RateLimiter`/`KeyedRateLimiter` primitives (and `RateLimiters::new().guest_portal_payment/guest_portal_token_payment` fields) directly; **none** call the auth-route dispatch path (see §4). |
| `audit_analytics_settings.rs` | 928 | audit (partial), settings, analytics, night-audit, search, booking-channels | Only two audit-relevant call sites: `AuditLog::log_event` exercised at lines 187/201 (writes + a `get_audit_logs` read-back at line 218 asserting the row appears). No 2FA/rbac/passkey/profile content in this file. |

### Frontend (`hotel-web-fe/src/**`)

| File | Lines | What it actually asserts |
|---|---|---|
| `src/auth/AuthContext.test.tsx` | 245 | Session bootstrap on mount (4 cases: refresh-cookie resolves, caches user/roles/permissions, no-crash when no valid cookie, no-crash when post-refresh profile probe fails); client-side `hasPermission`/`hasRole` semantics (exact match, case/whitespace normalization, `<resource>:manage` implies actions, deny-by-default, malformed permission string, deny-everything pre-auth); `auth:unauthorized` window event clears session/storage/query cache. All pure unit-level (mocked service calls), no network. |
| `src/auth/authUser.test.ts` | 33 | `buildAuthUser`-style normalization: builds a full user from a refreshed profile; derives a guest account from roles when `user_type` is omitted. |
| `src/api/users.service.test.ts` | 163 | Per-method request-shape assertions only (`getUserProfile`, `updateUserProfile`, `updatePassword`, `assignRoleToUser`, `removeRoleFromUser`, `replaceUserRoles`, `getAllUsers`, `createUser`, `getUserRolesAndPermissions`, `updateUser`, `deleteUser`) — each test mocks `ky` and checks the method/URL/JSON body sent. No assertion about server behavior. |
| `src/api/auth.service.test.ts` | 274 | Same request-shape pattern for `register`, `verifyEmail` (+ `HTTPError`→`APIError` wrapping), `getHealth`, `getWebSocketStatus`, `getAccessSnapshot`, `listPasskeys`, `updatePasskey`, `deletePasskey`, `listSessions`, `revokeSession`, `setupTwoFactor`, `enableTwoFactor`, `disableTwoFactor`, `getTwoFactorStatus`, `regenerateBackupCodes`. |
| `src/api/admin.service.test.ts` | 256 | Same request-shape pattern for the RBAC admin surface: `getRbacSnapshot`, `getRouteAccessPolicies`, `updateRouteAccessPolicy`, `getAllRoles`, `createRole`, `updateRole`, `deleteRole`, `getAllPermissions`, `createPermission`, `updatePermission`, `deletePermission`, `assignPermissionToRole`, `removePermissionFromRole`, `replaceRolePermissions`, `getRolePermissions`, plus settings endpoints. |
| `src/features/auth/utils/twoFactorCode.test.ts` | 82 | Pure string-shape helpers: `sanitizeTwoFactorCode` (keeps 6-digit/23-char shapes, strips junk, caps at 25 chars), `isCompleteTwoFactorCode`, `notifyRecoveryCodeUsed` (remaining-code-count warning copy). No service/network involvement. |

**Every FE test above mocks the `ky` HTTP client** (verified: `users.service.test.ts`/`auth.service.test.ts`/`admin.service.test.ts` are 100% "does it call `ky.get/post/...` with the right method+URL+JSON body" assertions) — **none exercise a real backend**, and none render a page component.

**Zero component/page tests exist** for the user domain's UI at all:
`find src/features/rbac src/features/user -iname "*.test.*"` → empty, and
`find src/features/admin/components/rbac -iname "*.test.*"` → empty. That
means `UserProfilePage.tsx`, `SecurityTab.tsx` (2FA UI), `PasskeysTab.tsx`,
`DevicesTab.tsx`, `RBACManagementPage.tsx`, `RolesTab/*`, `UsersTab.tsx`,
`PermissionsTab/*`, and `useRBACQueries.ts` (18 files under
`features/admin/components/rbac/` alone) have **no test coverage of any
kind**.

---

## 2. Coverage gaps — pub fn inventory vs. test calls

Method: `grep -n "^pub async fn\|^    pub async fn" <file>` for the
inventory, then `grep -rn -- "<qualified_call>(" hotel-app-be/tests/` for
each function to check for a direct call from any test file. A function is
marked **COVERED** only if some test file directly calls it by its
service/repository-qualified name; **UNCOVERED** otherwise (indirect
exercise through a different, tested function is called out as a note, not
counted as coverage — the task's instruction is to check whether *any test
calls it*).

### `src/services/users.rs` (272 lines) — 0/5 covered

| fn | line | status |
|---|---|---|
| `users` | 22 | UNCOVERED |
| `create_user` | 30 | UNCOVERED |
| `update_user` | 79 | UNCOVERED |
| `delete_user` | 171 | UNCOVERED |
| `user_roles_permissions` | 212 | UNCOVERED |

This is the entire admin user-management surface (create/update/soft-delete
a user account, list users, list a user's effective roles+permissions) —
live at `POST/PATCH/DELETE /users`, `GET /users`, `GET /users/{id}`
(`hotel-app-be/src/routes/users.rs:29-36`, permission-gated on
`users:create`/`users:update`/`users:delete`/`users:manage`) — with **zero**
test evidence that any of them work against a live database.

### `src/services/rbac.rs` (368 lines) — 9/18 covered

| fn | line | status |
|---|---|---|
| `roles` | 11 | UNCOVERED |
| `create_role` | 15 | COVERED — `rbac_profile.rs:429` |
| `permissions` | 19 | UNCOVERED |
| `snapshot` | 23 | UNCOVERED |
| `route_policies` | 45 | UNCOVERED |
| `update_route_policy` | 49 | UNCOVERED |
| `create_permission` | 72 | UNCOVERED |
| `assign_role_to_user` | 86 | COVERED — `rbac_profile.rs:517` |
| `remove_role_from_user` | 98 | COVERED — `rbac_profile.rs:533` |
| `assign_permission_to_role` | 111 | COVERED — `rbac_profile.rs:377` |
| `remove_permission_from_role` | 122 | COVERED — `rbac_profile.rs:394` |
| `replace_role_permissions` | 134 | COVERED — `rbac_profile.rs:404` |
| `replace_user_roles` | 151 | COVERED — `rbac_profile.rs:543` |
| `role_permissions` | 181 | UNCOVERED |
| `update_role` | 192 | COVERED — `rbac_profile.rs:440` |
| `delete_role` | 218 | COVERED — `rbac_profile.rs:453` |
| `update_permission` | 243 | UNCOVERED |
| `delete_permission` | 269 | UNCOVERED |

Live, permission-gated endpoints with zero coverage: `GET /rbac/snapshot`,
`GET /rbac/route-policies`, `PUT /rbac/route-policies/{id}`,
`GET /rbac/roles`, `GET /rbac/permissions`, `POST /rbac/permissions`,
`PUT/DELETE /rbac/permissions/{id}`, `GET /rbac/roles/{id}/permissions`
(routes confirmed at `hotel-app-be/src/routes/rbac.rs:44-60`).

### `src/services/auth.rs` (494 lines) — 3/7 covered

| fn | line | status |
|---|---|---|
| `login` | 23 | COVERED — `auth_session.rs`, `rbac_profile.rs` (12 call sites) |
| `access_snapshot` | 264 | UNCOVERED |
| `refresh_token` | 289 | COVERED — `auth_session.rs:303,335,423` |
| `logout` | 363 | COVERED — `auth_session.rs:396` |
| `register` | 372 | UNCOVERED |
| `verify_email` | 444 | UNCOVERED |
| `resend_verification` | 466 | UNCOVERED |

Live endpoints with zero coverage: `GET /auth/access`, `POST /auth/register`,
`POST /auth/verify-email`, `POST /auth/resend-verification`
(`hotel-app-be/src/routes/auth.rs:40-45`). Account self-registration and
email verification — arguably the highest-exposure unauthenticated surface
in the whole domain — has no integration test at all.

### `src/services/profile.rs` (193 lines) — 3/5 covered

| fn | line | status |
|---|---|---|
| `get_user_profile` | 17 | UNCOVERED |
| `update_user_profile` | 23 | UNCOVERED |
| `update_password` | 99 | COVERED — `rbac_profile.rs:596,620` |
| `list_sessions` | 138 | COVERED — `rbac_profile.rs:725,745` |
| `revoke_session` | 161 | COVERED — `rbac_profile.rs:741,764` |

`GET /profile` and `PATCH /profile` (name/email/phone/avatar update, the
`configure_guest_email`/`email_exists_for_other_user` branches inside
`update_user_profile`) are live and untested.

### `src/services/two_factor.rs` (301 lines) — 6/6 covered

| fn | line | status |
|---|---|---|
| `setup_2fa` | 17 | COVERED — `rbac_profile.rs:932,942` |
| `enable_2fa` | 72 | COVERED — `rbac_profile.rs:993,1022,1056,1089` |
| `disable_2fa` | 141 | COVERED — `rbac_profile.rs:861,874,1179,1194` |
| `get_2fa_status` | 204 | COVERED — `rbac_profile.rs:831,884` |
| `verify_2fa_code` | 220 | COVERED — `rbac_profile.rs:838,851` |
| `regenerate_backup_codes` | 248 | COVERED — `rbac_profile.rs:1145` |

This is the best-covered file in the domain — every function has at least
one live-PostgreSQL call, including negative paths (stale/expired/wrong
challenge, wrong code, rotated-away recovery code).

### `src/services/passkey.rs` (723 lines) — 0/7 covered

| fn | line | status |
|---|---|---|
| `list_passkeys` | 22 | UNCOVERED |
| `delete_passkey` | 36 | UNCOVERED |
| `update_passkey` | 48 | UNCOVERED |
| `register_start` | 61 | UNCOVERED |
| `register_finish` | 114 | UNCOVERED |
| `login_start` | 197 | UNCOVERED |
| `login_finish` | 243 | UNCOVERED |

`grep -rn "passkey" hotel-app-be/tests/*.rs` returns **zero** hits in any
test file — this entire WebAuthn-based authentication path (the largest
single service file in the domain at 723 lines, live at
`GET/PATCH/DELETE /profile/passkeys/{id}` and presumably
`POST /auth/passkey/*` via `src/routes/passkey.rs`) has no test of any kind,
unit or integration.

### `src/repositories/user.rs` (476 lines) — 0 direct calls from any test

`grep -rn "UserRepository::" hotel-app-be/tests/` → zero hits. All 21
`pub async fn`s (`find_by_id`, `find_by_username_or_email`, `list_all`,
`exists`, `username_or_email_exists_for_other`, `create_with_roles`,
`admin_update`, `soft_delete`, `get_profile`, `email_exists_for_other_user`,
`configure_guest_email`, `get_password_hash`, `update_full_name`,
`update_email`, `update_phone`, `update_avatar_url`,
`update_password_hash`, `update_two_factor_secret`, `update_last_login`,
`is_super_admin`, `get_roles`, `get_permissions`, `has_permission`) are only
reachable through `services/users.rs` (0/5 covered, above),
`services/profile.rs` (`update_user_profile`/`get_user_profile`, both
UNCOVERED), `services/rbac.rs` (`roles`/`assign_role_to_user` — the latter
covered), and `services/two_factor.rs` (`update_two_factor_secret`,
`find_by_id` at `two_factor.rs:39,298` inside `setup_2fa`/`enable_2fa`,
which ARE covered). Net effect: **`find_by_id`, `update_two_factor_secret`
get real indirect exercise via the 2FA tests; every other repository
function is exercised by nothing, direct or indirect** — most critically
`create_with_roles`, `admin_update`, and `soft_delete` (user creation,
admin-edit, and account deletion), which back the entirely-untested
`services::users` CRUD surface.

### `src/repositories/rbac.rs` (642 lines) — 0 direct calls from any test

`grep -rn "RbacRepository::" hotel-app-be/tests/` → zero hits. Of its 32
`pub async fn`s, the ones backing the 9 COVERED `services/rbac.rs`
functions get real indirect exercise (`assign_role_to_user`,
`remove_role_from_user`, `assign_permission_to_role`,
`remove_permission_from_role`, `replace_role_permissions`,
`replace_user_roles`, `create_role`, `update_role`, `delete_role`, plus
`role_exists`/`role_priority`/`max_role_priority_for_user`/`user_role_ids`
via the internal `ensure_actor_can_manage_roles` helper). The remaining ~20
(`find_all_roles`, `find_role_by_id`, `find_role_by_name`,
`find_all_permissions`, `get_role_permissions`, `create_permission`,
`role_permission_assignments`, `find_all_route_access_policies`,
`update_route_access_policy`, `user_role_assignments`,
`get_user_permissions`, `user_with_roles_permissions`,
`role_system_status`, `user_count_for_role`, `permission_system_status`,
`update_permission`, `role_count_for_permission`, `delete_permission`,
`role_name_by_id`) are exercised by nothing — they back the same UNCOVERED
`services/rbac.rs` list-fetch/route-policy/permission-CRUD functions above.

### `src/repositories/audit.rs` (412 lines) — 0 direct calls from any test

`grep -rn "AuditRepository::" hotel-app-be/tests/` → zero hits (all access
goes through `services::audit::AuditLog`). Indirect status per repository
function:
- `insert_event` (17) — COVERED indirectly (`AuditLog::log_event` exercised
  in `audit_analytics_settings.rs:187,201`, and every mutating handler in
  every domain calls it, so many other test files incidentally exercise it
  too — see §4 on why that's a weaker guarantee than it sounds).
- `list_logs` (89) — COVERED indirectly (`audit_service::get_audit_logs`,
  `audit_analytics_settings.rs:218`).
- `insert_event_tx` (52) — UNCOVERED. Used by `AuditLog::log_event_tx` /
  `log_booking_voided_tx` (`src/services/bookings.rs:129,204`,
  `src/repositories/bookings/lifecycle.rs:2061`); `grep -rn
  "log_event_tx(\|log_booking_voided_tx(\|insert_event_tx(" tests/*.rs` →
  zero hits anywhere in the suite. The transactional audit-write path is
  entirely unverified, in any domain.
- `list_actions` (173), `list_resource_types` (180),
  `list_logs_for_export` (189), `list_users` (219),
  `count_by_resource_type` (233), `list_db_statements` (266) — all
  UNCOVERED. Verified via their `services::audit` wrappers
  (`get_audit_actions`, `get_audit_resource_types`,
  `export_audit_logs_csv`, `get_audit_users`, `get_audit_category_counts`,
  `get_db_statements` — `src/services/audit.rs:439-556`), none of which any
  test file calls (`grep -rn` for each returned nothing in `tests/`).

### Summary uncovered-function risk register (the actual deliverable of §2)

Ordered by blast radius if broken and shipped:

1. **`services::users::{create_user, update_user, delete_user}`** — admin
   account lifecycle, zero coverage, live and permission-gated.
2. **`services::passkey::*` (all 7 fns)** — an entire authentication method,
   zero coverage of any kind.
3. **`services::auth::{register, verify_email, resend_verification}`** —
   unauthenticated self-service account creation, zero coverage.
4. **`services::rbac::{roles, permissions, snapshot, route_policies,
   update_route_policy, create_permission, role_permissions,
   update_permission, delete_permission}`** — the read/list surface plus
   permission CRUD and route-access-policy editing (this last one gates
   frontend nav visibility), zero coverage.
5. **`services::profile::{get_user_profile, update_user_profile}`** — own
   profile view/edit including the `configure_guest_email` branch, zero
   coverage.
6. **`repositories::audit::insert_event_tx`** (and every `*_tx` audit call
   site across all domains) — zero coverage.
7. **`repositories::{user,rbac,audit}` list/report functions** enumerated
   above — zero coverage, direct or indirect.

---

## 3. Authorization (403/Forbidden) tests

**Partial — at one layer only, never at the HTTP/route layer.**

- `middleware::check_permission` (the mid-level permission-check function)
  IS asserted to return `Err(ApiError::Forbidden(_))` in four places:
  `rbac_profile.rs:259` (no matching permission), `rbac_profile.rs:307`
  (`:manage` doesn't leak to an unrelated resource), `rbac_profile.rs:370`
  and `:397` (role with no/removed permission), `rbac_profile.rs:511` and
  `:536` (user with no/removed role).
- **No test anywhere calls `core::middleware::require_auth`,
  `require_permission_helper`, `require_any_permission_helper`,
  `require_admin_helper`, or `require_super_admin_helper` directly** —
  verified: `grep -rn "require_auth(\|require_permission_helper(\|
  require_any_permission_helper(\|require_admin_helper(\|
  require_super_admin_helper(" hotel-app-be/tests/*.rs` returns only one
  hit, a doc-comment mentioning the name (`guests_rates_loyalty.rs:346`),
  not a call. These are the exact functions every route in
  `hotel-app-be/src/routes/*.rs` uses to gate itself
  (`hotel-app-be/src/core/middleware.rs:95-127`), and none has an inline
  `#[cfg(test)]` module either (`grep -n "mod tests\|#\[test\]"
  src/core/middleware.rs` → no hits).
- **No test in the repo constructs a real HTTP request** (no `reqwest`, no
  `axum::body`, no `tower::ServiceExt::oneshot`, no test server) anywhere
  under `hotel-app-be/tests/` — verified via
  `grep -rln "reqwest\|oneshot\|TestServer\|tower::ServiceExt"
  hotel-app-be/tests/*.rs` (zero files). So there is **no test that proves a
  request with a missing/invalid Authorization header returns HTTP 401, or
  that a request from an authenticated-but-under-privileged user returns
  HTTP 403** — every assertion of "Forbidden" in the suite is against the
  Rust-level `ApiError` return value of a directly-called service function,
  never against a wire response.
- On the frontend, `AuthContext.test.tsx` (163-207) tests the *client-side*
  `hasPermission`/`hasRole` gating helper used to hide/disable UI — exact
  match, `:manage` implication, deny-by-default, case-insensitive role
  match, deny-everything-pre-auth. This is real coverage of the FE's own
  gating logic, but it is a UI-affordance check, not a security boundary:
  the backend is the actual enforcement point and (per above) its own
  gating wrappers are untested.
- Two dead-code helpers surfaced while checking this:
  `require_admin_helper` (`middleware.rs:123`) and
  `require_super_admin_helper` (`middleware.rs:131`) both carry
  `#[allow(dead_code)]` and have **zero callers anywhere in `src/`**
  (`grep -rn "require_admin_helper(\|require_super_admin_helper("
  src/ | grep -v core/middleware.rs` → empty). Nothing in the routed API
  enforces a super-admin-only boundary through this helper; whether that
  matters is a correctness-dimension question, noted here only because it
  explains why these two have 0% test coverage (nothing calls them, so
  nothing could exercise them).

**Conclusion for point 3: yes, permission-denial is tested, but only at the
`check_permission` boundary reached by directly calling service functions in
`rbac_profile.rs`. No test in the repository exercises the
`require_*_helper` wrappers or an actual HTTP 401/403 response.**

---

## 4. Rate limiter / audit-row creation / cache-invalidation tests

### Rate limiter

- The **primitives** (`RateLimiter`, `KeyedRateLimiter`) are well tested in
  isolation: 8 tests in `rate_limiter_tests.rs` cover limit enforcement,
  per-IP/per-key independence, recovery over time, and high load.
- The **auth-route wiring is untested**. `hotel-app-be/src/routes/auth.rs:60-67`
  extracts `Extension<RateLimiters>` and calls
  `limiters.auth.check_with_retry(ip)` directly inside the `login` route
  handler (5 req/60s, `RateLimiters::new()` at
  `core/rate_limiter.rs:227`) — no test sends >5 requests through an actual
  login call path and asserts a 429/`TooManyRequestsRetryAfter`.
  `refresh`/`register`/etc. routes wire similarly
  (`Extension<RateLimiters>` appears at `routes/auth.rs:60,93,123`,
  `routes/profile.rs:64,139,161,183,213`, `routes/two_factor.rs:34,56,78,108,130`,
  `routes/passkey.rs:30,53,76,97`) and none of it is exercised by any test.
- `RateLimiters::check_rate_limit` (`core/rate_limiter.rs:249`, the one
  method that dispatches by a string category like `"auth:login"`) is
  **dead code** — `grep -rn "check_rate_limit(" src/ tests/` finds only its
  own definition, zero callers. Its own doc comment ("primarily used by
  legacy tests") is stale; no test uses it either.
- `guest_payment_limit_allows_100_attempts_in_ten_minutes`
  (`rate_limiter_tests.rs:128`) is the only test that instantiates the full
  `RateLimiters` struct, and it only touches
  `.guest_portal_payment`/`.guest_portal_token_payment` — not `.auth`, not
  a route.

### Audit-row creation

- Directly asserted with a `SELECT COUNT(*) FROM audit_logs` in exactly one
  scenario for the user domain: `rbac_profile.rs:1361-1372` (
  `two_factor_recovery_code_used`, count = 1) and `:1374-1386`
  (`login_success` with `details->>'method' = 'password+2fa_recovery'`,
  count = 1) — both inside
  `postgres_login_with_recovery_code_consumes_code_and_audits`.
- **Not asserted anywhere**: a plain-password `login_success` row (the
  three `auth_session.rs` login/refresh/logout tests never query
  `audit_logs`, confirmed — its only reference to the table is a `DELETE`
  in `cleanup_auth_fixture` at line 183); any `login_failure` row
  (`grep -rn "login_failure" tests/*.rs` → zero assertion hits, only the
  doc-comment mention above); `role_assignment`/`role_removal` rows written
  by `AuditLog::log_role_assignment`/`log_role_removal`
  (`services/rbac.rs:93,106`) — Scenarios 4 and 5 (`rbac_profile.rs:323,472`)
  exercise `assign_role_to_user`/`remove_role_from_user` but never query
  `audit_logs` to confirm the audit call actually landed a row; a
  `password_changed` row from `AuditLog::log_password_changed`
  (`services/profile.rs` calls it inside `update_password`, per
  `grep -rn "log_password_changed("` — zero test hits).
- **Design note relevant to all of the above**: `AuditLog::log_event`
  (`src/services/audit.rs:28-46`) swallows the repository's `Result` and
  **always returns `Ok(())`**, only `log::warn!`-ing on failure. This means
  a broken audit-write path (wrong column type, missing table) can never
  surface as a request-level error in production — the only way to detect
  it is a test that queries `audit_logs` afterward, which, per the previous
  paragraph, most of the mutating rbac/profile actions in this domain don't
  do.

### Cache invalidation after a role change

- **Yes, meaningfully tested.** `core::rbac_cache::has_permission`
  (`core/rbac_cache.rs:122`, TTL default 30s per `configured_ttl`, line 30)
  is what `middleware::check_permission` ultimately calls
  (`core/auth.rs:489-495` → `core::rbac_cache::has_permission`). Every
  mutating `rbac_service` function under test
  (`assign_role_to_user`/`remove_role_from_user`/
  `assign_permission_to_role`/`remove_permission_from_role`/
  `replace_role_permissions`/`replace_user_roles`) calls
  `crate::core::rbac_cache::invalidate_all()` internally
  (`services/rbac.rs:94,107,118,130,...`), and Scenarios 4 & 5
  (`rbac_profile.rs:323,472`) call `check_permission` for the SAME
  user+permission both immediately *before* and immediately *after* each
  mutation, inside a test that completes in well under the 30s TTL. Because
  the first (`before`) call would have already populated/warmed the cache
  entry with the pre-mutation answer, the `after_*` assertions can only
  pass if `invalidate_all()` genuinely ran — if the internal invalidation
  call were deleted, the `after_attach`/`after_assign` assertions would see
  the stale cached `Forbidden` and fail. This is real regression coverage
  for the "cache invalidation on role/permission change" behavior, not an
  accidental pass.
- **Gap**: `core::rbac_cache::invalidate_user` (per-user, cheaper than the
  blanket `invalidate_all`, defined at `rbac_cache.rs:149`) has **zero
  callers anywhere in `src/`** (`grep -rn
  "rbac_cache::invalidate_user\|rbac_cache::invalidate_all" src/ tests/`
  — every one of the 12 call sites in `src/services/{users,rbac}.rs` uses
  `invalidate_all`, none uses `invalidate_user`). It is dead code, so
  necessarily untested; every real invalidation in production is a full
  cache flush across all users, which works but doesn't scale the way the
  existence of `invalidate_user` suggests was intended.

---

## 5. Fixture hygiene: fixed ids and cleanup pattern

Every user-domain PG test file uses a fixed numeric id block, declared in a
header comment except `auth_session.rs` (see gap below), following the
"upsert (ON CONFLICT DO UPDATE) + cleanup-by-id-list" pattern.

### `rbac_profile.rs` — block `920_xxx` (users `920_0xx`, roles `920_1xx`)

| id | line first used | role in scenario |
|---|---|---|
| `920_001` | 235 | Scenario 1 user |
| `920_101` | 236 | Scenario 1 role |
| `920_002` | 277 | Scenario 2 user |
| `920_102` | 278 | Scenario 2 role |
| `920_010` | 327 | Scenario 4 **actor** |
| `920_004` | 328 | Scenario 4 target |
| `920_103` | 329 | Scenario 4 role |
| `920_011` | 476 | Scenario 5 **actor** |
| `920_005` | 477 | Scenario 5 target |
| `920_104` | 478 | Scenario 5 role (read) |
| `920_105` | 479 | Scenario 5 role (manage) |
| `920_006` | 581 | Scenario 6 (password change) user |
| `920_007` | 683 | Scenario 7 (sessions) user |
| `920_008` | 799 | Scenario 8 (2FA lifecycle, seeded) user |
| `920_009` | 923 | Scenario 9 (2FA full lifecycle) user |
| `920_012` | 1242 | Scenario 10 (recovery-code login) user |

**Documented near-collision, already fixed in-file**: `rbac_profile.rs:1239-1241`
carries an explicit comment — "`920_012`: ids `920_010`/`920_011` are taken
by Scenarios 4/5's actor users, and test fns run concurrently — sharing an
id lets their upsert/cleanup reset this user's 2FA state mid-scenario." This
documents the exact class of flake recorded in
`.claude/rules/lessons.md` (2026-07-27 entry: Scenario 10 originally picked
`920_010`, collided with Scenario 4's *actor* id — easy to miss because it
isn't the scenario's headline/title user — and a concurrent test run reset
2FA state between Scenario 10's seed and its own re-read). No other
collision was found in the current file: all 16 unique ids above are
distinct.

**Cross-file collision check**: `920_xxx` and `970_xxx` (below) are not
reused by any other test file — `grep -rn "920_\|970_" hotel-app-be/tests/*.rs`
outside these two files returns nothing except a defensive comment in
`invoice_numbering.rs:87` explicitly noting `930_xxx/940_xxx/960_xxx/970_xxx`
are already claimed by other files. Other files' declared blocks
(`audit_analytics_settings.rs`: `990_xxx`; `guests_rates_loyalty.rs`:
`985_xxx`; `ledger_service.rs`: `910_xxx`) don't overlap either.

### `auth_session.rs` — undeclared block, ids `970_001`–`970_003`

| id | line | scenario |
|---|---|---|
| `970_001` | 205 | login test |
| `970_002` | 278 | refresh-rotation test |
| `970_003` | 364 | logout test |

**Hygiene gap**: unlike every sibling PG test file in this domain (and
unlike `ledger_service.rs`/`guests_rates_loyalty.rs`/`audit_analytics_settings.rs`
in other domains), `auth_session.rs` has **no header comment declaring its
`970_0xx` reservation** — the only place that block is documented as
"claimed" is a comment in a *different* file (`invoice_numbering.rs:87`).
A future test author reading `auth_session.rs` in isolation has nothing to
tell them ids `970_004+` are free vs. already used elsewhere; they'd have to
grep every other test file first. Low severity today (no live collision
found), but it's the one file in the domain that doesn't follow the
convention its siblings established.

### Cleanup pattern

Both files upsert with `ON CONFLICT (id) DO UPDATE SET ... = <reset value>`
(`rbac_profile.rs:81-113`, `auth_session.rs:145-174`) so reruns against a
persistent dev DB are deterministic regardless of leftover state, and both
delete children-before-parents on a fixed id list at both the start and end
of each test (`cleanup_rbac_fixture`, `rbac_profile.rs:188-224`: deletes
`refresh_tokens` → `audit_logs` (by `user_id` OR `resource_type IN
('user','user_role') AND resource_id`) → `user_roles` → `role_permissions`
→ `roles` → `users`; `cleanup_auth_fixture`, `auth_session.rs:177-198`:
`refresh_tokens` → `audit_logs` (`resource_type='user'`) → `user_roles` →
`users`). Scenario 9 additionally lets `two_factor_challenges` rows be
implicitly covered by the `users` cascade delete (FK `ON DELETE CASCADE`
per the 2026-07-26 patch referenced in `.claude/rules/lessons.md`) rather
than an explicit delete — not verified in this pass whether that FK still
carries `ON DELETE CASCADE` (out of scope: this is a schema check, not a
test-file check); flagging as **UNVERIFIED** rather than asserting it.

---

## 6. Gate commands and what each would/would not catch

### Documented in `CLAUDE.md`

```
# Backend
cargo check --all-features
cargo clippy --all-features -- -D warnings
cargo test <name>                # single test by substring

# Frontend
bun run typecheck && bun run lint && bun run test
bun run build
```

### Actually run in `.github/workflows/ci.yml` (push/PR to `master`)

**`frontend` job** (`hotel-web-fe/`): `bun ci` → `bun run typecheck` →
`bun run lint:strict` (stricter than the `bun run lint` CLAUDE.md
documents: `--max-warnings=0` vs. plain `eslint . --quiet`, confirmed at
`hotel-web-fe/package.json:38-39`) → `bun run test -- --run --coverage` →
`bun run build`.

**`backend` job** (`hotel-app-be/`, Postgres 19beta2 service container, but
**no `DATABASE_URL` env set at the job level or on the "Cargo test" step**
— confirmed by `grep -n "^env:\|DATABASE_URL" .github/workflows/ci.yml`,
which shows the first `DATABASE_URL` assignment at line 113, inside a later
step): `cargo check --all-features` → **`cargo test --all-features`** (no
`DATABASE_URL` in scope) → `PostgreSQL schema smoke`
(`DATABASE_URL` set just for this step; runs exactly one named test,
`status_vocabulary::postgres_schema_reruns_and_normalizes_legacy_cancelled_statuses`)
→ create `hotel_workflow_test` DB + apply baseline only (no `data.sql`/
`seed.sql`) → `PostgreSQL booking workflow tests` (runs exactly one named
test, `booking_service::postgres_concurrent_reactivation_allows_only_one_success`)
→ `cargo clippy --all-features -- -D warnings` → `cargo build --release`.

**`backend-postgres-smoke` job** (separate job, `DATABASE_URL` set at
*job* level, line 157): apply baseline + `data.sql` + `seed.sql` → verify
V1 install marker → **`cargo test --features postgres --no-default-features`
with no test filter** → build the release binary → start it and curl
`/health` only.

**`desktop` job**: `cargo check` only (with placeholder sidecar/pgsql
resources), no tests.

### What each step would/would not catch for a user-domain runtime break (sqlx decode mismatch, missing table, missing permission seed)

| Gate | Catches it? | Why |
|---|---|---|
| `cargo check --all-features` | **No** | Compile-time only; sqlx's plain `sqlx::query()` (used throughout this codebase, confirmed by the absence of `query!`/`query_as!` macro usage in the files read this session) has no compile-time schema checking. |
| `cargo clippy --all-features -D warnings` | **No** | Same — lint/compile only. |
| `backend` job's `cargo test --all-features` | **No, for anything DB-touching** | With no `DATABASE_URL` in that step's environment, every test in this domain that follows the `setup_pg_pool().await else { return; }` pattern (`rbac_profile.rs`, `auth_session.rs`'s `mod postgres_tests`) silently returns `Ok` with zero assertions executed. This step genuinely only exercises: the 2 plain `#[test]`s in `auth_session.rs` (JWT signature/expiry), all 8 tests in `rate_limiter_tests.rs`, and the inline `#[cfg(test)]` unit tests in `src/core/auth.rs` (password/TOTP/token-format helpers) and `src/core/rbac_cache.rs` (one sanity test). It provides **zero** evidence about any live-DB behavior in the user domain. |
| `backend` job's two single-named-test steps | **No, not for this domain** | They exercise `status_vocabulary` and `booking_service` — neither touches users/rbac/auth/2FA/passkey/profile/audit. |
| `backend-postgres-smoke`'s full `cargo test --features postgres --no-default-features` | **Only for the COVERED functions in §2** | This is the one CI step that actually runs all 10 `rbac_profile.rs` scenarios and the 3 PG `auth_session.rs` tests against a fully-seeded live database. A runtime break in any of the §2 UNCOVERED functions (`services::users::*`, `services::passkey::*`, `services::auth::{register,verify_email,resend_verification}`, `services::rbac::{roles,permissions,snapshot,route_policies,update_route_policy,create_permission,role_permissions,update_permission,delete_permission}`, `services::profile::{get_user_profile,update_user_profile}`, and the repository list/report functions in §2) would **not** be caught here either, because nothing calls them — matching the exact historical pattern in `.claude/rules/lessons.md` (missing `two_factor_challenges` table, `array_to_json`-vs-`text[]` bind mismatch, rate-plan `blackout_dates` jsonb-vs-array[] mismatch) where CI stayed green for days until someone wrote a *new* test that happened to call the broken path. |
| Frontend gates (`typecheck`/`lint:strict`/`test`/`build`) | **No, none of them** | Every FE test in this domain mocks the `ky` client (§1) — there is no FE test, and no CI step anywhere, that runs the built frontend against a live backend. A backend response-shape change (e.g. a renamed field `services::users::create_user` returns) would only be caught by the FE if a human manually updates the corresponding mock+assertion to match — which encodes the current believed behavior, not verifies it. |
| `backend-postgres-smoke`'s post-build health check | **No** | Only curls `/health`; no login, no authenticated request, no user-domain endpoint of any kind is exercised against the running binary. |

**Bottom line for point 6**: the CI workflow, taken as a whole, DOES run the
full live-Postgres user-domain suite once per push/PR — but only inside the
`backend-postgres-smoke` job, whose name suggests a lightweight smoke check
rather than "the job that actually runs the tests." The `backend` job's own
`cargo test --all-features` step — the one that most closely mirrors the
command CLAUDE.md documents (`cargo test <name>`) and the one most engineers
would assume is "running the tests" — is a near no-op for this entire
domain because `DATABASE_URL` isn't in scope for it. Neither job, however,
can catch a break in any of the ~19 uncovered service/repository functions
enumerated in §2, because no test anywhere calls them.
