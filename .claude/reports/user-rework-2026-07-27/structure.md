# User domain — layering & module-migration readiness

Scope: `src/routes|handlers|services/{users,rbac,audit,profile,auth,two_factor,passkey}.rs`,
`src/repositories/{user,rbac,audit,auth,passkey}.rs`, `src/models/{user,rbac,audit,auth}.rs`,
`src/core/{auth,middleware,rbac_cache}.rs`. All line numbers below were read this session
(`hotel-app-be/src/...`, paths relative to that root unless noted).

Comparison baseline: `modules/settings/*` (525 lines total, read in full) and
`modules/promotions/*` (2522 lines total, read in full).

## 1. Line-count inventory

| Domain | routes | handlers | service | repository | models |
|---|---|---|---|---|---|
| users | routes/users.rs 127 | handlers/users.rs 56 | services/users.rs 272 | repositories/user.rs 476 | models/user.rs 192 |
| rbac | routes/rbac.rs 230 | handlers/rbac.rs 188 | services/rbac.rs 368 | repositories/rbac.rs 642 | models/rbac.rs 143 |
| audit | routes/audit.rs 92 | handlers/audit.rs 78 | services/audit.rs 797 | repositories/audit.rs 412 | models/audit.rs 116 |
| profile | routes/profile.rs 231 (also owns passkey+2FA sub-routes, see §3) | handlers/profile.rs 64 | services/profile.rs 193 | *(none — uses UserRepository)* | *(none — uses models/user.rs)* |
| auth | routes/auth.rs 154 | handlers/auth.rs 125 | services/auth.rs 494 | repositories/auth.rs 277 | models/auth.rs 245 |
| two_factor | routes/two_factor.rs 148 | handlers/two_factor.rs 68 | services/two_factor.rs 301 | *(none — uses UserRepository)* | *(none — types in models/auth.rs)* |
| passkey | routes/passkey.rs 126 | handlers/passkey.rs 88 | services/passkey.rs 723 | repositories/passkey.rs 221 | *(none — types in models/auth.rs)* |
| **subtotal** | **1108** | **667** | **3148** | **2028** | **696** |

Plus `core/auth.rs` 1064, `core/middleware.rs` 152, `core/rbac_cache.rs` 164 — these are
shared infrastructure in principle, but §4 shows `core/auth.rs` is not purely infrastructure.

**Grand total ~9027 lines** of pre-migration code for this domain family — larger than any
single already-migrated module (promotions 2522, settings 525) and comparable to 3-4 of them
combined (loyalty ~2560, communications ~1180+, support ~883+, guest_booking ~704+, each just
counting repository.rs). This size, on its own, is evidence against a single flat
`modules/access/{routes,handlers,service,repository,models}.rs` — see §7.

`models/auth.rs` (245 lines) is a shared model file already spanning three of these
domains: `UserSessionInfo` (auth.rs:70), `TwoFactorSetupRequest` (auth.rs:130),
`PasskeyRegistrationStart`/`PasskeyInfo` (auth.rs:178,223) all live there — there is no
`models/two_factor.rs` or `models/passkey.rs` today.

## 2. Per-domain answers to (a)-(d)

### users
- (a) Handler pass-through: **100%**. `handlers/users.rs` (56 lines, 5 fns) — every fn is
  `Ok(Json(svc::fn(...).await?))` or the two-line delete variant (handlers/users.rs:14-56, read in full).
- (b) Service: real logic. `services/users.rs` (272 lines) does validation, sanitization,
  password hashing, the priority-guard call, and 3 audit-log calls (services/users.rs:63-74,
  154-165, 195-206). Not `pub use` anywhere (grepped, no hits).
- (c) Repository axum import: none (`grep ^use repositories/user.rs` — chrono/core/models/param only).
- (d) `require_any_permission_helper` sits in **routes/users.rs** closures (lines 46, 56, 67,
  77, 87, 97, 108, 119) — never in the handler or service.

### rbac
- (a) Handler pass-through: **100%**. `handlers/rbac.rs` (188 lines, 18 fns, read in full) —
  every fn is a 1-3 line wrapper over `svc::*`.
- (b) Service: real logic. `services/rbac.rs` (368 lines) — priority-guard
  (`ensure_actor_can_manage_roles`/`ensure_actor_can_manage_user`, lines 332-368), system-role
  protection (update_role/delete_role/update_permission/delete_permission, lines 192-291),
  route-policy value validation (lines 298-328), and 10 `rbac_cache::invalidate_all()` calls.
- (c) Repository axum import: none (repositories/rbac.rs imports only db/error/models/user-repo/sqlx::FromRow).
- (d) `require_any_permission_helper` sits in **routes/rbac.rs** closures (lines 76, 84, 95,
  109, 118, 127, 135, 144, 154, 168, 180, 197, 208, 219, 228) — consistent with users.rs.

### audit
- (a) Handler pass-through: **~90%**. `handlers/audit.rs` (78 lines, 8 fns, read in full) — 7 of
  8 are one-liners; `export_audit_logs_csv` (lines 36-53, 18 lines) builds a raw
  `axum::response::Response` (Content-Type/Content-Disposition headers) — still HTTP
  translation, not business logic, but the one handler doing more than a single call.
- (b) Service: real logic. `services/audit.rs` (797 lines) — the `AuditLog` impl (lines
  16-358) holds 14 named convenience wrappers (`log_login_success`, `log_role_assignment`, …)
  plus a `CATEGORY_MAP` const (lines 359-397) and 7 query functions (405-556+). Not `pub use`.
- (c) Repository axum import: none (repositories/audit.rs imports chrono/serde_json/core/models only).
- (d) `require_permission_helper` sits in **routes/audit.rs** closures (lines 39, 47, 55, 63,
  72, 81, 90) — consistent with users.rs/rbac.rs.
- Stale comment: `services/audit.rs:29-30` says "the audit_logs table may not exist yet …
  prepared for future migration." Verified false — `audit_logs` is a partitioned table
  present in the baseline (`database/postgres/migrations/0001_v1_baseline.sql:1147`,
  `:1172` for the default partition). The `let _ = AuditLog::log_event(...)` best-effort
  pattern this comment justified is now silently swallowing real errors, not hedging a
  missing table.

### profile
- (a) Handler pass-through: **100%**. `handlers/profile.rs` (64 lines, 5 fns, read in full).
- (b) Service: real logic. `services/profile.rs` (193 lines) — session listing/revocation,
  password-change flow (verifies current hash via `UserRepository::get_password_hash`, see §5).
- (c) N/A — no dedicated repository; profile reuses `UserRepository`.
- (d) `require_auth` (not permission-gated — self-service) sits in **routes/profile.rs**
  closures for the profile/session/passkey/2FA endpoints it owns (lines 48, 57, 80, 88(claims),
  101, 111, 120, 130, 155, 177, 199, 207, 229).
- **`routes/profile.rs` is not a single-domain router.** Its own doc comment says "Routes for
  user profile management, 2FA, and passkeys" (routes/profile.rs:3) and it dispatches to THREE
  handler modules: `handlers::profile`, `handlers::passkey`, `handlers::two_factor`
  (routes/profile.rs:107-231). See §3 for the consequence.

### auth
- (a) Handler pass-through: **NOT pass-through — ~35% of the file is cookie policy, not HTTP
  translation.** `handlers/auth.rs` (125 lines) defines `REFRESH_COOKIE`/
  `REFRESH_COOKIE_MAX_AGE_DAYS` constants and three functions —
  `refresh_cookie_is_secure` (lines 21-23), `build_refresh_cookie` (36-44),
  `clear_refresh_cookie` (48-56) — roughly lines 13-56 (44 of 125 lines) are security-relevant
  cookie-attribute policy (HttpOnly/Secure/SameSite=Lax/Path/Max-Age), not a service call.
  This is exactly the workflow logic the house pattern's doc convention ("HTTP translation
  only — the workflows live in services", copied verbatim from handlers/users.rs:3) says does
  not belong in handlers.
- (b) Service: real logic. `services/auth.rs` (494 lines, fns at lines 23, 264, 289, 363, 372,
  444, 466) — login/2FA-challenge/refresh/register/verify-email flows.
- (c) Repository axum import: none (repositories/auth.rs imports db/error/settings_cache/models/chrono only).
- (d) `require_auth` for `access_snapshot` sits in **routes/auth.rs** (line 54); login/
  register/refresh/logout are intentionally unauthenticated (pre-login), consistent design.
- `handlers/auth.rs:22` exports `pub(crate) const REFRESH_COOKIE` and `pub(crate) fn
  build_refresh_cookie`, consumed cross-domain by `handlers/passkey.rs:7` — see §3.

### two_factor
- (a) Handler pass-through: **100%**. `handlers/two_factor.rs` (68 lines, 6 fns incl.
  `regenerate_backup_codes_handler` at lines 60-68, read in full).
- (b) Service: real logic. `services/two_factor.rs` (301 lines) — TOTP verification,
  recovery-code handling, uses `UserRepository` + `AuditLog`.
- (c) N/A — no dedicated repository; reuses `UserRepository`.
- (d) `require_auth` sits in **routes/two_factor.rs** closures (lines 50, 72, 94, 102, 124,
  146) — but see §3: this entire route file duplicates routes/profile.rs's 2FA section.

### passkey
- (a) Handler pass-through: **~95%**. `handlers/passkey.rs` (88 lines, 6 fns, read in full) —
  5 of 6 are one-liners; `passkey_login_finish_handler` (lines 77-88) adds the refresh cookie
  to the jar using a function imported from a different domain (see below).
- (b) Service: real logic. `services/passkey.rs` (723 lines) — WebAuthn ceremony
  (register/login start+finish), imports `AuthRepository`, `PasskeyRepository`,
  `RbacRepository`, and `core::auth::AuthService` all at once (services/passkey.rs:3-19).
- (c) Repository axum import: none (repositories/passkey.rs imports db/error/models/chrono only).
- (d) `require_auth` sits in **routes/passkey.rs** closures (lines 46, 69) for the
  authenticated register endpoints; login endpoints are pre-auth by necessity.
- `handlers/passkey.rs:7` — `use crate::handlers::auth::build_refresh_cookie;` — a
  cross-domain import of another domain's `pub(crate)` handler-layer function. See §3.

## 3. Cross-cutting couplings that raise migration cost

These are the findings that matter most for "what would a `modules/access/` migration cost,"
because they are invisible if you look at one domain file at a time.

1. **Duplicate live 2FA route surface.** `routes/mod.rs` merges BOTH `profile::routes()`
   (routes/mod.rs:225) AND `two_factor::routes()` (routes/mod.rs:239). `routes/profile.rs`
   registers `/profile/2fa/{setup,enable,disable,status,verify}` (lines 35-39), all calling
   `handlers::two_factor::*_handler`. `routes/two_factor.rs` independently registers
   `/auth/2fa/{setup,enable,disable,status,verify,regenerate-backup-codes}` (lines 21-29),
   calling the *same* handler functions. Verified live in the FE
   (`hotel-web-fe/src/api/auth.service.ts:95,103,108,112,116`): it calls
   `profile/2fa/setup`, `profile/2fa/enable`, `profile/2fa/disable` from one prefix, and
   `auth/2fa/status`, `auth/2fa/regenerate-backup-codes` from the other — the two duplicate
   route trees are each partially adopted. Grepping the whole FE src tree for
   `2fa/verify`/`verifyTwoFactor` (both prefixes) returns zero hits — `POST .../2fa/verify`
   and `GET /profile/2fa/status` are routed, permission-checked, fully wired... and have no
   caller anywhere in the product today.
2. **`core/auth.rs` is a hidden repository+service layer inside `core/`.** It is 1064 lines,
   not ~150-300 like `core/middleware.rs`/`core/rbac_cache.rs`. It contains direct SQL against
   `refresh_tokens` (`store_refresh_token` core/auth.rs:274-301, `validate_refresh_token`
   :304-327, `rotate_refresh_token` :331+), against `two_factor_challenges`
   (`create_2fa_challenge`/`consume_2fa_challenge`, :733-793), 2FA enable/disable/recovery-code
   writes (:794-892), and RBAC read queries that **duplicate** `repositories/rbac.rs`:
   - `AuthService::get_user_permissions` (core/auth.rs:450-468, `SELECT DISTINCT p.name FROM
     permissions p INNER JOIN role_permissions rp ... WHERE ur.user_id = $1`) vs.
     `RbacRepository::get_user_permissions` (repositories/rbac.rs:480-498, same three-table
     join, extra columns, `ORDER BY`) — not byte-identical text, but the same query built
     twice in two different layers.
   - `AuthService::get_user_roles` (core/auth.rs:470-484) vs. `RbacRepository::get_user_roles`
     (repositories/rbac.rs:223-237) — same relationship, same tables, independently written.
   - Callers of the `core/auth.rs` versions: `services/auth.rs:214,217,274,277,330`,
     `services/passkey.rs:300,303`. Callers of the `repositories/rbac.rs` versions: internal to
     `RbacRepository::user_with_roles_permissions` (repositories/rbac.rs:507-508).
   `core/` cannot become a thin shared-infra layer for a migrated `modules/access/` without
   first deciding whether this logic becomes part of the new module or stays a genuine
   cross-module primitive (JWT/session issuance legitimately is core-level; the RBAC-name
   lookups and the 2FA-challenge CRUD look like they should move with the domain).
3. **Cross-domain private-function import.** `handlers/passkey.rs:7` —
   `use crate::handlers::auth::build_refresh_cookie;` — imports a `pub(crate)` fn defined in
   a *different* handler file (handlers/auth.rs:36). `passkey_login_finish_handler`
   (handlers/passkey.rs:77-88) cannot be migrated independently of wherever
   `build_refresh_cookie` ends up; the cookie-builder needs a shared home (e.g. a
   `modules/access/cookies.rs` or a `core` helper) before auth and passkey can move on
   different schedules.
4. **`routes/profile.rs` is 3 domains' entrypoint.** Confirmed by its own doc comment
   (routes/profile.rs:3) and by 8 of its route handlers calling into `handlers::passkey::*`
   or `handlers::two_factor::*` (lines 112, 121, 131, 156, 178, 200, 208, 230) rather than
   `handlers::profile::*`. Any migration plan that treats "profile" as one module and
   "passkey"/"two_factor" as separate ones must also decide who owns this routing file.
5. **Duplicated rate-limit boilerplate, concentrated in this domain.** The
   `let (allowed, retry_after) = limiters.<x>.check_with_retry(...); if !allowed { return
   Err(ApiError::TooManyRequestsRetryAfter(...)) }` block (17-20 lines) is copy-pasted with no
   shared helper: **5** times in routes/profile.rs (lines 70,145,167,189,219), **5** times in
   routes/two_factor.rs (40,62,84,114,136), **3** times in routes/passkey.rs (36,59,82,104),
   **3** times in routes/auth.rs (67,99,129). 16 near-identical blocks (~270 lines) across
   just these four files in this domain. (The same pattern exists repo-wide — routes/
   guest_portal.rs and routes/webhooks.rs also have copies — so this is not unique to the
   user domain, but the user domain has the highest concentration of it.)

## 4. Dead code (zero callers, proven by grep across `src/` and `tests/`)

Method: extracted every `pub fn`/`pub async fn` name from the 12 in-scope
service/repository files (162 functions), then ran `grep -rwo <name> src tests` for each and
inspected every result with a total occurrence count of 1 or 2. A count of 1 means the
identifier appears nowhere except its own `pub async fn name(` definition line — i.e. zero
callers anywhere in the crate.

| Function | Location | Verified callers |
|---|---|---|
| `RbacRepository::find_role_by_name` | repositories/rbac.rs:88 | 0 |
| `RbacRepository::role_name_by_id` | repositories/rbac.rs:635 | 0 |
| `UserRepository::find_by_username_or_email` | repositories/user.rs:33 | 0 |
| `AuditLog::log_booking_cancelled` | services/audit.rs:220 | 0 |
| `AuditLog::log_ekyc_approved` | services/audit.rs:260 | 0 (ekyc module calls the generic `AuditLog::log_event` directly instead — `modules/ekyc/service.rs:95,218,406,607,661,709` — so eKYC decisions ARE audited, just not through this named wrapper) |
| `AuditLog::log_ekyc_rejected` | services/audit.rs:287 | 0 (same as above) |
| `AuditLog::log_settings_changed` | services/audit.rs:332 | 0 — **and this one matters**, see §6 finding 1 |

Additional dead chain in `core/middleware.rs` (in scope):
- `check_admin_role` (core/middleware.rs:82, `#[allow(dead_code)]` already on it) — its only
  caller is `require_admin_helper` (same file, line 125).
- `require_admin_helper` (core/middleware.rs:123) — re-exported via `core/mod.rs:32` and
  `lib.rs:19`, but grepped zero real call sites anywhere in `src/` or `tests/`.
- `require_super_admin_helper` (core/middleware.rs:131, contains its own inline
  `SELECT is_super_admin FROM users WHERE id = $1`) — re-exported via `core/mod.rs:33` and
  `lib.rs:20`, zero real call sites.
- Note: `AuthService::check_role` (core/auth.rs:499, also `#[allow(dead_code)]`) is **not**
  dead — it has a real caller at `services/search.rs:14` (guest-role check) in addition to
  the dead `check_admin_role`. Do not remove it when cleaning up the admin-role chain.

Net: this domain carries a whole superseded "is_admin / is_super_admin" authorization path
that predates the granular `<resource>:<action>` permission system and was never deleted,
plus 7 unused convenience wrappers.

## 5. Duplicated query text / duplicated logic

- **Byte-identical duplicate query**, two different repositories, two different services
  consuming them:
  - `repositories/auth.rs:86` — `AuthRepository::password_hash` —
    `"SELECT password_hash FROM users WHERE id = $1"`, called from `services/auth.rs:74`
    (login password check).
  - `repositories/user.rs:298` — `UserRepository::get_password_hash` — the identical string,
    called from `services/profile.rs:109` (password-change verification).
  Both are live. This is a real "two repositories independently reinvented the same lookup"
  case — a future `modules/access/` should have exactly one.
- No hand-written `row_to_user`/`row_to_role`/`row_to_permission` mapper functions exist
  anywhere in the repo (`grep -rn "fn row_to_user\|fn row_to_role\|fn row_to_permission"` from
  the repo root: zero hits). `models/user.rs`, `models/rbac.rs`, `models/audit.rs`,
  `models/auth.rs` all use `#[derive(FromRow)]` directly (confirmed at models/user.rs:10,
  models/rbac.rs:10,26,72,79, models/audit.rs:63,77,83, models/auth.rs:209,222,232) rather
  than a hand-written mapper. **The file-local-shadowing bug class documented in
  `.claude/rules/lessons.md` (2026-07-26s, `row_to_room_type`) does not apply to this
  domain** — stated as a checked absence, not an assumption.
- Permission-string constant arrays (`const *_PERMISSIONS: &[&str]`) are not duplicated
  *within* the 7 in-scope domains — each of `routes/users.rs` (5 consts) and `routes/rbac.rs`
  (9 consts) defines its own set once. The one cross-file duplicate found in the wider repo,
  `LOYALTY_READ_PERMISSIONS`/`LOYALTY_MANAGE_PERMISSIONS` appearing in both `routes/loyalty.rs`
  and `modules/loyalty/routes.rs`, is explained by `routes/mod.rs:19-21` as an intentional,
  documented leftover from the loyalty migration (`#[allow(dead_code)]` on `pub mod loyalty;`,
  not wired into the router) — not a live duplicate, but see §6 for why this precedent matters.

## 6. House-pattern comparison and migration precedents

Read in full: `modules/settings/{mod,routes,handlers,service,repository,models}.rs` (525
lines) and `modules/promotions/{mod,routes,handlers,service,repository,validation}.rs` (2522
lines, repository.rs and service.rs skimmed by section since >400 lines, others read whole).

1. **The house pattern has not settled on where permission checks live.**
   `modules/settings/routes.rs:42,52` calls `require_permission_helper` inside the ROUTE
   closures (`get_settings`, `update_setting`). `modules/promotions/handlers.rs:101,110,122,
   142,163,184,205,224,234,254` calls `require_permission_helper` inside the HANDLERS, with
   `routes.rs` binding handler fns directly with no closures at all
   (`modules/promotions/routes.rs:9-58`). These are two different, mutually exclusive
   conventions inside the already-migrated code. The legacy user-domain being audited here is
   **internally consistent** — every one of users/rbac/audit/auth/two_factor/passkey puts the
   auth check in the routes-layer closure (§2) — so migrating it will force a choice between
   "keep the routes-closure convention" (matches settings, matches the domain's own existing
   consistency) or "move checks into handlers" (matches promotions, requires touching every
   handler fn signature to accept `HeaderMap`/actor id up front).
2. **"Migrated" does not always mean the repository layer moved.**
   `modules/ekyc/repository.rs` is a 5-line, self-documented placeholder ("Placeholder for the
   migrated repository layer... SQL queries remain in `repositories/ekyc.rs`") — confirmed
   `modules/ekyc/service.rs:19-23` imports `crate::repositories::ekyc::{..., EkycRepository}`
   directly, and every one of ~25 call sites in that 900-line service file goes through the
   pre-migration repository, not `super::repository`. By contrast `modules/settings/`,
   `modules/promotions/`, `modules/loyalty/` (1128-line repository.rs),
   `modules/communications/` (1180 lines), `modules/support/` (883 lines), and
   `modules/guest_booking/` (704 lines) all DID fully migrate their repository. ekyc is the
   one exception. This matters as a planning precedent: it is acceptable in this codebase's
   established practice to migrate routes/handlers/service first and leave the repository
   layer as a follow-up — but it should be a deliberate choice stated in the plan, not an
   accident, given every other migrated domain did the full move.
3. Old routes/handlers/services files for a domain, once superseded, are kept on disk with
   `#[allow(dead_code)]` and dropped from the router merge rather than deleted immediately
   (`routes/mod.rs:19-21`, the `loyalty` precedent) — except `ekyc`, where `routes/ekyc.rs`,
   `handlers/ekyc.rs`, and `services/ekyc.rs` WERE deleted outright (commit `bf38639b6`,
   "chore(be): delete orphaned handlers/ekyc.rs" — verified none of the three files exist on
   disk and `routes/mod.rs` no longer even declares `pub mod ekyc;`). The doc comment at
   `routes/mod.rs:12-13` — "the old routes/ekyc.rs file is preserved for backward reference
   during migration" — is now **stale**: the file it describes doesn't exist. Two different
   cleanup conventions were used for two migrated domains; whichever the team follows for
   `modules/access/`, the leftover comment should be fixed in the same commit that finishes
   the domain it describes.

## 7. Target file tree for a migrated module

Given §1's size (~9027 lines pre-migration, larger than any single existing module) and §3's
coupling (2FA route duplication spanning profile+auth, `core/auth.rs` embedding RBAC-read +
session-repository + 2FA-challenge-repository logic, passkey needing auth's cookie builder,
profile owning passkey+2FA sub-routes), **one flat `modules/access/{routes,handlers,service,
repository,models}.rs` is not recommended** — it would produce a single `service.rs` around
3000+ lines and a single `repository.rs` around 2000+ lines, well outside the size class of
every module used as a comparison point (largest today: promotions repository.rs 786,
service.rs 773). The coupling is real and must be resolved, but resolving it by merging
everything into one mega-module just relocates the tangle instead of untangling it.

Recommended grouping — a `modules/access/` parent with domain sub-modules, so shared code
(cookies, session primitives) has one obvious home and each sub-module stays in the size
range the rest of the codebase already uses:

```
src/modules/access/
├── mod.rs                    (~20 lines — pub mod declarations)
├── cookies.rs                (~70 lines — build_refresh_cookie/clear_refresh_cookie/
│                               refresh_cookie_is_secure, moved out of handlers/auth.rs so
│                               both auth and passkey login-finish can depend on it without
│                               a cross-submodule handler import — resolves §3 finding 3)
├── users/
│   ├── mod.rs, routes.rs (~130), handlers.rs (~60), service.rs (~280),
│   │   repository.rs (~480), models.rs (~200)
├── rbac/
│   ├── mod.rs, routes.rs (~230), handlers.rs (~190), service.rs (~370),
│   │   repository.rs (~650), models.rs (~145)
├── audit/
│   ├── mod.rs, routes.rs (~95), handlers.rs (~80), service.rs (~800 — consider splitting
│   │   the 14 named log_* wrappers from the 7 query fns into audit/log.rs +
│   │   audit/query.rs if this module is edited often), repository.rs (~415)
├── auth_session/           (auth + two_factor + passkey: these three already share
│   │                        UserRepository, core::auth::AuthService, and now cookies.rs —
│   │                        keeping them as one sub-module avoids re-creating the exact
│   │                        cross-file coupling this report found)
│   ├── mod.rs
│   ├── routes.rs (~350 — auth login/refresh/logout/register/verify-email + the ONE 2FA
│   │   route surface, with the duplicate /profile/2fa/* registrations deleted per §3
│   │   finding 1 — decide with the user which prefix survives before deleting)
│   ├── handlers.rs (~230)
│   ├── service.rs (~1500 — services/auth.rs 494 + services/two_factor.rs 301 +
│   │   services/passkey.rs 723, plus whatever moves out of core/auth.rs per §3 finding 2;
│   │   this is the file most likely to need a further split, e.g. auth_session/login.rs,
│   │   auth_session/two_factor.rs, auth_session/passkey.rs as sub-files)
│   ├── repository.rs (~500 — repositories/auth.rs 277 + repositories/passkey.rs 221;
│   │   two_factor's queries already live in UserRepository/users/repository.rs)
│   └── models.rs (~250 — today's models/auth.rs)
└── profile/
    ├── mod.rs, routes.rs (~90 — just the profile/session endpoints; the passkey and 2FA
    │   sub-routes move to auth_session/routes.rs, resolving §3 finding 4),
    │   handlers.rs (~65), service.rs (~195)
```

This keeps every sub-module within roughly the size of `modules/loyalty/` (largest existing
migrated domain today, ~2560 lines total) or smaller, gives the duplicated cookie logic and
the `core/auth.rs` RBAC-read duplication exactly one place to land, and forces the
`/profile/2fa/*` vs `/auth/2fa/*` decision (§3 finding 1) to happen as part of the move rather
than being silently carried forward as two copies in the new tree.

## 8. What this migration should NOT assume for free

- `core/auth.rs` cannot be "left in core" unexamined — parts of it (JWT issuance/verification)
  are legitimately cross-module infrastructure; parts of it (refresh-token storage, 2FA
  challenge storage, RBAC name lookups) are domain logic that duplicates or should replace
  code in `repositories/rbac.rs`. This split needs a deliberate decision, not a mechanical file
  move.
- The `/profile/2fa/*` vs `/auth/2fa/*` duplication (§3.1) is a product decision (which URL
  the FE should standardize on) as much as a code one — per `judgment-rubrics.md` rule 3, this
  is a case to raise with the user before deleting either surface, since `/auth/2fa/status` and
  `/profile/2fa/{setup,enable,disable}` are both currently live in production traffic.
- Settings-change audit (finding in §6/§4) is a correctness gap independent of the migration,
  worth fixing in the same pass since `modules/access/audit/` will be the new home for
  `AuditLog::log_settings_changed`.
