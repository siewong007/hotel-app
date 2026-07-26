# Adversarial verification — Layering & module-migration readiness of the user domain
Date: 2026-07-27

## Verdicts on submitted findings

### 1. settings-change-missing-audit — CONFIRMED
- modules/settings/service.rs:19-30 read verbatim: `update_system_setting` calls only
  `SettingsRepository::update_value_by_user` (line 25) then `settings_cache::invalidate_key`
  (line 28). No AuditLog/log_event anywhere in modules/settings/*.rs (grep empty; only
  handlers.rs:36 calls the service fn).
- services/audit.rs:332-357 confirmed: `log_settings_changed(pool, admin_id, setting_key,
  old_value, new_value)` builds an exact before/after JSON diff.
- `grep -rwo log_settings_changed src tests` → single hit, the definition line itself
  (services/audit.rs). Zero callers confirmed.
- Verdict: CONFIRMED, severity high is reasonable (privileged settings:update path,
  zero forensic trail, dead helper already built).

### 2. core-auth-duplicates-rbac-repository — CONFIRMED (and undercounted — see missed #3)
- core/auth.rs:450-468 `get_user_permissions` / :470-484 `get_user_roles` — verbatim
  three-table joins, read and match exactly.
- repositories/rbac.rs:480-498 `get_user_permissions` (extra columns + ORDER BY) and
  :223-237 `get_user_roles` (extra columns + ORDER BY) — verbatim match.
- core/auth.rs:274-301 `store_refresh_token`, :304-327 `validate_refresh_token` confirmed
  direct SQL against refresh_tokens; no separate repository file for this table exists
  anywhere (`grep FROM/INTO/UPDATE refresh_tokens` → only core/auth.rs, 8 hits).
- core/auth.rs:733-760 `create_2fa_challenge`, :767-791 `consume_2fa_challenge` confirmed
  direct SQL against two_factor_challenges.
- Callers verified exactly: services/auth.rs:214,217 (login), :274,277 (access_snapshot),
  :330(+336 not cited but same pattern) (refresh_token); services/passkey.rs:300,303
  (login_finish). All confirmed via `use crate::core::auth::AuthService` import at
  services/auth.rs:3.
- Verdict: CONFIRMED exactly as stated. See missed-finding #3 below — the duplication is
  actually THREE copies, not two; the auditor missed core/rbac_cache.rs.

### 3. duplicate-2fa-route-surface — CONFIRMED
- routes/mod.rs:226 merges profile::routes() (auditor cited 225 — off by one; line 225 is
  actually `.merge(users::routes())`. Line 239 for two_factor::routes() is correct.)
- routes/profile.rs:35-39 registers /profile/2fa/{setup,enable,disable,status,verify} —
  read verbatim, exact match. Each wrapper (lines 137-231) calls
  `handlers::two_factor::*_handler` — confirmed by direct read.
- routes/two_factor.rs:21-29 registers /auth/2fa/{setup,enable,disable,status,verify,
  regenerate-backup-codes} — read verbatim, exact match. Same handler functions called
  (grep confirms identical `handlers::two_factor::*_handler` targets at lines 51,73,95,
  103,125,147).
- hotel-web-fe/src/api/auth.service.ts:95,103,108,112,116 — read verbatim, FE calls
  'profile/2fa/setup|enable|disable' and 'auth/2fa/status|regenerate-backup-codes' —
  exact match, confirms FE splits across both prefixes.
- `grep -rn "2fa/verify\|verifyTwoFactor\|verify_2fa" hotel-web-fe/src/` → zero hits,
  confirmed no FE caller for either verify endpoint.
- Verdict: CONFIRMED exactly (aside from the trivial 225→226 line-number slip that does
  not affect the substance — both merges are real and verified independently).

### 4. handlers-auth-cookie-policy-not-passthrough — CONFIRMED
- handlers/auth.rs:13-56 read verbatim: REFRESH_COOKIE, REFRESH_COOKIE_MAX_AGE_DAYS,
  refresh_cookie_is_secure(), build_refresh_cookie() (line 36), clear_refresh_cookie() —
  exact match including the SameSite=Lax rationale comment.
- handlers/users.rs:3 doc comment "HTTP translation only — the workflows live in
  [`crate::services::users`]" — exact match.
- handlers/passkey.rs:7 `use crate::handlers::auth::build_refresh_cookie;`, consumed at
  line 86 `jar.add(build_refresh_cookie(refresh_token))` — exact match.
- Verdict: CONFIRMED exactly as stated.

### 5. duplicate-password-hash-query — CONFIRMED
- repositories/auth.rs:85-91 `password_hash`: byte-identical
  `SELECT password_hash FROM users WHERE id = $1`.
- repositories/user.rs:296-303 `get_password_hash`: byte-identical query string — confirmed.
- repositories/user.rs:58-67 sibling `exists()` query DOES carry `AND deleted_at IS NULL` —
  confirmed, supporting the auditor's "must be remembered in two places" impact claim.
- Callers: services/auth.rs:74 `AuthRepository::password_hash`, services/profile.rs:109
  `UserRepository::get_password_hash` — both confirmed live call sites.
- Verdict: CONFIRMED exactly as stated.

### 6. duplicated-rate-limit-boilerplate — CONFIRMED with minor count correction
- `grep -c check_with_retry` on the four files gives profile.rs=5 (lines 70,145,167,189,
  219), two_factor.rs=5 (40,62,84,114,136), passkey.rs=4 (36,59,82,104), auth.rs=3
  (67,99,129) — all line numbers match the auditor's list exactly.
- Total is 5+5+4+3 = **17**, not the auditor's stated "16". Minor arithmetic error.
- passkey.rs: auditor says "4x, one uses limiters.auth instead of .sensitive" — actually
  **two** of the four (lines 82 and 104, both in the passkey-login flow) use
  `limiters.auth`, not one. Read passkey.rs:36-110 to confirm: lines 36,59 use
  `.sensitive`; lines 82,104 use `.auth` with a different message
  ("Too many login attempts" vs "Too many requests").
- core/rate_limiter.rs:114,159 confirmed to define two `check_with_retry` overloads;
  grepped core/rate_limiter.rs and core/middleware.rs for `TooManyRequestsRetryAfter` —
  zero hits, confirming no shared helper builds the ApiError.
- Verdict: CONFIRMED (duplication and "no wrapper" claim both hold), but the auditor's
  own count is off by one (17 actual vs 16 claimed) and undercounts the `.auth` variant
  in passkey.rs (2 vs "one"). Severity (medium) is not overstated — if anything the
  actual duplication is slightly larger than claimed.

### 7. profile-routes-owns-three-domains — CONFIRMED, precisely
- routes/profile.rs:3 doc comment "Routes for user profile management, 2FA, and
  passkeys." — exact match.
- `grep -n "handlers::(two_factor|passkey|profile)::" routes/profile.rs` gives:
  handlers::profile:: at 49,58,81,93,102 (5); handlers::passkey:: at 112,121,131 (3);
  handlers::two_factor:: at 156,178,200,208,230 (5). Total 13 delegating closures;
  3+5=8 delegate outside the profile handler module — matches "8 of its ~13 route
  closures" EXACTLY.
- Route count in `routes()` (lines 22-40) independently counted at 13 — matches "~13".
- Verdict: CONFIRMED exactly as stated, no corrections needed. Strongest-evidenced
  finding in the set.

## Summary of verdicts
All 7 submitted findings CONFIRMED. Two (finding 3 and finding 6) have trivial,
non-substantive citation/count inaccuracies (off-by-one line number; off-by-one
occurrence count and "one vs two" .auth variant count) that do not change the verdict
or severity.

## Missed findings (new, found by re-reading the same domain files)

1. **services/rbac.rs: 9 of 13 mutating service functions have NO audit call**, while
   4 siblings in the same file do — the exact same class of gap as submitted finding
   #1 (settings), but bigger blast radius (RBAC = who can do what). Unaudited:
   `create_role` (15-17), `create_permission` (72-84), `assign_permission_to_role`
   (111-120), `remove_permission_from_role` (122-132), `replace_role_permissions`
   (134-149 — bulk-replaces a role's entire permission set, affecting every user
   holding that role, with zero forensic trail), `update_role` (192-216), `delete_role`
   (218-241), `update_permission` (243-267), `delete_permission` (269-291). Audited:
   `update_route_policy` (57-68), `assign_role_to_user` (93), `remove_role_from_user`
   (106), `replace_user_roles` (171,174 — per-role-id diff logging).

2. **services/passkey.rs has ZERO AuditLog calls anywhere in the file** (`grep -n
   "AuditLog\|log_event" src/services/passkey.rs` → empty). Confirmed by reading:
   `delete_passkey` (36-46, removes an auth credential), `register_finish` (114-195,
   `PasskeyRepository::insert_passkey` at 182-190 creates a new auth credential), and
   `login_finish` (243-...) which — unlike password login's
   `AuditLog::log_login_success` call at services/auth.rs:248 — never logs a successful
   passkey authentication. Registering or deleting a passkey is a persistent-credential
   change (attacker-registered passkey = durable account takeover) with no audit row.

3. **The permissions/roles join query the auditor found duplicated in 2 places
   actually exists in a 3rd**: core/rbac_cache.rs:90-101 (permissions) and :103-113
   (roles) — read verbatim, same three-table joins as core/auth.rs:450-468/470-484 and
   repositories/rbac.rs:480-498/223-237. The code's own comment at rbac_cache.rs:89
   ("compiles and runs under either backend (matching AuthService's own SQL)") proves
   the duplication is a known, deliberate copy, not an unnoticed drift — which makes it
   worse for migration planning (three copies to reconcile, not two, and the team has
   already chosen not to consolidate them once).

4. **Two entire authorization-helper call chains are dead code**, sitting alongside the
   real `check_permission`/`require_permission_helper` gating and complicating any
   decision about what a modules/access/ migration should carry forward:
   `require_admin_helper` (core/middleware.rs:123, `#[allow(dead_code)]`) →
   `check_admin_role` (core/middleware.rs:82, `#[allow(dead_code)]`) →
   `AuthService::check_role` (core/auth.rs:499, `#[allow(dead_code)]`); and
   `require_super_admin_helper` (core/middleware.rs:131, `#[allow(dead_code)]`).
   Verified: `grep -rn "require_admin_helper\|require_super_admin_helper"` shows both
   only appear at their own definitions plus re-export chains (src/lib.rs:19-20,
   src/core/mod.rs:32-33) — no route or handler calls either. `check_role` itself has
   exactly one real, unrelated caller (services/search.rs:14, a plain "guest" role
   check, nothing to do with admin gating). A migration that assumes "the RBAC helper
   surface = what's actually used" will misjudge this without grepping call sites first.

5. **services/profile.rs `update_user_profile` (23-97) has no AuditLog call**, despite
   mutating full_name, email (including the guest-email-configuration branch at 59-87,
   a security-relevant contact-info change), phone, and avatar_url. Contrast with the
   same file's `update_password` (audited via `log_password_changed` at line 133) and
   `revoke_session` (audited via `log_event` at 169-180), and with the admin-driven
   `services::users::update_user` which DOES audit "user_updated" (154-165). Self-service
   profile edits are the one mutating path in this file left completely untraced.

6. **6 of the 7 already-migrated modules import `AuditLog` from the NOT-yet-migrated
   `services::audit`**, which itself sits inside the "audit" domain the user explicitly
   listed as unmigrated. Verified: `grep -rln "services::audit::AuditLog" src/modules/`
   → modules/ekyc/service.rs, modules/loyalty/service.rs, modules/promotions/service.rs,
   modules/support/service.rs, modules/guest_booking/service.rs,
   modules/communications/{service,scheduler}.rs. services/audit.rs itself has no
   `use crate::modules` import (grep empty), so the dependency is one-directional, but
   it means "audit" cannot be migrated last/independently without rewriting imports in
   6 modules that are supposedly already done — migration-readiness assumption that
   each remaining domain is a clean, independent unit does not hold for audit.
   Additionally, services/audit.rs (797 lines) itself conflates two responsibilities:
   an `impl AuditLog` write-side helper library (lines 16-357, consumed by literally
   every domain) and read-side reporting functions for the audit-viewer feature
   (`get_audit_logs` 405, `get_audit_actions` 439, `export_audit_logs_csv` 447,
   `get_audit_users` 519, `get_audit_category_counts` 527, `get_db_statements` 549) —
   these two halves have very different migration destinies (one is a cross-cutting
   primitive every domain needs forever, the other is domain-specific to an audit
   viewer page) and the file does not separate them.

## Checked but found clean (absence claims, for completeness)
- No backwards imports from core/{auth,middleware,rbac_cache}.rs into services/handlers/
  routes/modules (`grep "^use crate::services\|^use crate::handlers\|^use crate::routes"`
  → empty on all three files) — layering direction is clean in that regard.
- No `use crate::modules` in any of repositories/{rbac,user,auth,passkey}.rs or
  services/{rbac,users,auth,passkey,profile,two_factor}.rs or core/auth.rs — user-domain
  code does not reach into already-migrated modules (only the reverse, audit-only,
  coupling in missed-finding #6).
- services/auth.rs `register()` (services/auth.rs:372) and repositories/auth.rs:236-245
  `INSERT INTO users` (guest self-registration, user_type='guest', tied to a guest_id in
  the same transaction) were checked against services/users.rs `create_user` /
  repositories/user.rs:100-130 `create_with_roles` (admin-created staff users with role
  assignment) — these are NOT the same duplication class as finding #5: different
  columns, different transaction shape, different business purpose. Not flagged.
- routes/rbac.rs permission-string constants (18-39) were checked against their handler
  call sites (72-229) for mismatched/wrong permission gating — all `require_any_permission_helper`
  calls use the constant matching their operation name; no mis-gated route found.
