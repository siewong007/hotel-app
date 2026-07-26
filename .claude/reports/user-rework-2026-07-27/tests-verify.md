# Adversarial verification — "Test coverage and verification gates for the user domain"

Session date: 2026-07-27. All line numbers re-derived by opening the cited file
at the cited line this session (paths relative to hotel-app-be/ or hotel-web-fe/
unless stated).

## Per-finding verdicts

### user-crud-zero-test-coverage — CONFIRMED
- `services/users.rs:30` `create_user`, `:79` `update_user`, `:171` `delete_user` all verified at
  exact lines (Read offset 1-90, 160-190).
- `routes/users.rs:29-36` route table verified; permission const arrays at lines 22-25.
- `grep -rn "create_user(\|update_user(\|delete_user(" tests/*.rs` → zero hits each (exit 1 / no output),
  confirmed independently.

### passkey-service-zero-coverage — CONFIRMED (evidence string imprecise, substance holds)
- All 7 function signatures verified at exact lines via `grep -n "^pub async fn" src/services/passkey.rs`:
  22, 36, 48, 61, 114, 197, 243 — matches exactly.
- Auditor's claim "`grep -rn \"passkey\" hotel-app-be/tests/*.rs` returns zero hits" is technically
  FALSE — it returns 2 hits (`tests/status_vocabulary.rs:151,301`, both the string
  `idx_passkeys_credential_id`, an index-name check, not a functional test). Re-ran
  `grep -rln "register_start\|register_finish\|login_start\|login_finish\|list_passkeys\|delete_passkey\|update_passkey" tests/`
  → zero hits. Net effect unchanged: zero functional coverage of any passkey service function.
  Downgrading evidence precision only, not the verdict.

### ci-backend-job-test-step-no-op-for-live-pg — PARTIAL, severity high → medium
- Line-level claims all verified exactly: ci.yml:108 `cargo test --all-features` (no env: block on
  that step), first `DATABASE_URL` at ci.yml:113 inside the later "PostgreSQL schema smoke" step.
  rbac_profile.rs:55-61 and auth_session.rs:119-126 both verified verbatim: `Err(_) => { eprintln!(...);
  return None; }` under `setup_pg_pool`.
- BUT: the auditor's own evidence already discloses the mitigating fact and I independently
  confirmed it fully: job `backend-postgres-smoke` (ci.yml:134-233) triggers on the SAME `on:
  push/pull_request branches:[master]` (ci.yml:3-7) as the `backend` job, sets `DATABASE_URL` at
  job-env level (ci.yml:156-160) against a real `postgres:19beta2` service container, and its
  "Run PostgreSQL tests" step (ci.yml:202-203) runs `cargo test --features postgres
  --no-default-features` with NO test/module filter — i.e., the whole test binary, same as
  `--all-features` (Cargo.toml:15-17 defines exactly one feature, `postgres`, default-on, so
  `--all-features` and `--features postgres --no-default-features` compile-and-run the identical
  test set). So every rbac_profile.rs/auth_session.rs `postgres_*` test DOES execute for real,
  against a live DB, on every push/PR to master — just inside a differently-named job, not inside
  the `backend` job's own "Cargo test" step.
- Corrected characterization: the `backend` job's "Cargo test" step is a genuinely redundant,
  misleadingly-named no-op for every DATABASE_URL-gated test (that part is true and worth fixing —
  e.g. rename the step or give it a DATABASE_URL too), but the *overall CI signal* is not blind to
  user-domain live-PG regressions the way the title implies. Whether `backend-postgres-smoke` is a
  *required* status check for merge is a GitHub branch-protection setting, not visible in-repo —
  left UNVERIFIED.
- Severity corrected: high → medium (the step is wasted CI time / a naming trap for a future
  engineer reading the job list, not an actual verification hole in the pipeline as it runs today).

### no-http-level-401-403-test — CONFIRMED
- middleware.rs:95 `require_auth` verified; also read 1-152 in full (152 lines) to confirm
  `require_permission_helper`(101), `require_any_permission_helper`(111), `require_admin_helper`(123),
  `require_super_admin_helper`(131).
- `grep -rn "require_auth(\|require_permission_helper(\|require_any_permission_helper(\|require_admin_helper(\|require_super_admin_helper(" tests/*.rs`
  → exactly one hit, `guests_rates_loyalty.rs:346`, a doc-comment (verified: line begins `///`).
- `grep -rln "reqwest\|oneshot\|TestServer\|tower::ServiceExt" tests/*.rs` → zero files.
- `check_permission` Forbidden-assertions in rbac_profile.rs verified at exactly lines
  259,307,370,397,511,536 (all `matches!(..., Err(ApiError::Forbidden(_)))`).

### role-assignment-audit-unverified — PARTIAL (evidence miscited, conclusion holds)
- rbac.rs:93 `log_role_assignment` (inside `assign_role_to_user`) and :106 `log_role_removal`
  (inside `remove_role_from_user`) verified exactly.
- Auditor's evidence: "both of which ARE called by rbac_profile.rs Scenarios 4/5 (lines
  377,394,517,533)". Re-derived: lines 377/394 are inside
  `postgres_role_and_permission_management_reflects_in_permission_checks` (test at line 323,
  "Scenario 4") and are calls to `rbac_service::assign_permission_to_role` /
  `rbac_service::remove_permission_from_role` — a DIFFERENT pair of service functions (role↔permission
  attachment, services/rbac.rs:111,122) that has **no AuditLog call at all** in its source (see
  "missed" #3 below). Only lines 517/533, inside
  `postgres_user_role_assignment_changes_effective_permissions` (line 472, "Scenario 5"), actually
  call `assign_role_to_user`/`remove_role_from_user`. So 2 of the 4 cited line numbers point to the
  wrong function pair.
- The underlying conclusion still holds on the correct evidence: Scenario 5 (lines 472-541) asserts
  only on `check_permission` results, never queries `audit_logs`; `grep -n "audit_logs"
  tests/rbac_profile.rs` → only lines 195 (cleanup DELETE), 1362, 1375 (Scenario 10's
  recovery-code/login_success counts) — confirmed verbatim. auth_session.rs:183 confirmed as a
  cleanup DELETE. `grep -rn "login_failure" tests/*.rs` → empty, confirmed.
- Severity unchanged (high is reasonable given the confirmed conclusion), but evidence should cite
  517/533 only, not 377/394.

### audit-log-swallows-errors — CONFIRMED
- audit.rs:28-47 read in full: `log_event` computes `result = AuditRepository::insert_event(...)`,
  logs a `log::warn!` on `Err`, then unconditionally `Ok(())` at line 47 (auditor said "46", off by
  one line but same statement/content). `let _ = AuditLog::log_role_assignment(...)` caller pattern
  at rbac.rs:93 confirmed (caller can't observe failure either).

### login-rate-limit-route-wiring-untested — CONFIRMED
- routes/auth.rs: `Extension(limiters)` at line 60, `check_with_retry` at line 67,
  `TooManyRequestsRetryAfter` at lines 69-76 (auditor's summary of 60-67 is accurate).
- rate_limiter.rs:227 `auth: RateLimiter::new(RateLimitConfig::new(5, 60))` confirmed exactly.
- rate_limiter_tests.rs has 8 `#[tokio::test]` fns (lines 21,33,51,66,83,102,119,128); only line
  128 constructs `RateLimiters::new()` and only exercises `.guest_portal_payment` /
  `.guest_portal_token_payment`. `grep -rn "\.auth\." tests/*.rs` → zero hits; `grep -rln
  "routes::auth\|routes/auth" tests/*.rs` → zero hits.

### audit-repo-list-export-uncovered — CONFIRMED
- All 6 repositories/audit.rs functions verified at exact lines: 173, 180, 189, 219, 233, 266.
- All 6 services/audit.rs wrapper names verified inside lines 439-556 (`get_audit_actions`,
  `get_audit_resource_types`, `export_audit_logs_csv`, `get_audit_users`,
  `get_audit_category_counts`, `get_db_statements`) — each individually grepped in tests/*.rs, zero
  hits for every one. `log_event_tx(\|log_booking_voided_tx(\|insert_event_tx(` → zero hits.

### rbac-fe-zero-component-tests — CONFIRMED (file count off: 20, not 18)
- `find hotel-web-fe/src/features/rbac hotel-web-fe/src/features/user -iname "*.test.*"` → empty.
- `find hotel-web-fe/src/features/admin/components/rbac -iname "*.test.*"` → empty.
- Recounted non-test files in that directory: **20**, not 18 as claimed (listed all 20 explicitly in
  session). Minor inaccuracy, does not change the verdict.
- Confirmed `SecurityTab.tsx` and `PasskeysTab.tsx` exist under
  `src/features/user/components/profile/` and have no referencing test file.
- Confirmed the 3 existing FE test files for this domain (`users.service.test.ts`,
  `auth.service.test.ts`, `admin.service.test.ts`) contain no `render(`/`@testing-library` usage —
  pure mocked-`ky`-client request-shape assertions.

## Additional issues found (missed by the original audit)

1. **services::rbac::{create_permission, update_permission, delete_permission} have zero test
   coverage anywhere** (rbac.rs:72, 243, 269) — routed live at `POST/PUT/DELETE /rbac/permissions[...]`
   (routes/rbac.rs:58-62,139-146,213-230). Unlike the parallel role-CRUD trio (`create_role`,
   `update_role`, `delete_role` ARE tested at rbac_profile.rs:429,440,453), the permission-CRUD trio,
   including their "cannot modify/delete system permission" guards (rbac.rs:250-252, 272-275) and the
   `role_count_for_permission` in-use guard (rbac.rs:280-282), is entirely unexercised —
   `grep -rn "create_permission(\|update_permission(\|delete_permission(" tests/*.rs` → zero hits.
   Permissions are the atomic unit the whole RBAC system is built on; a regression here (e.g. the
   system-permission guard silently inverted) would ship with every gate green.

2. **services::profile::{get_user_profile, update_user_profile} have zero test coverage** (profile.rs:17,
   23-97), unlike their siblings in the same file (`update_password`, `list_sessions`,
   `revoke_session`, all tested at rbac_profile.rs:596-764). `update_user_profile` contains
   non-trivial guest-self-service email-change logic: distinguishing guest vs staff accounts,
   rejecting email changes once already configured, a uniqueness check
   (`email_exists_for_other_user`), and minting a 24-hour email-verification token
   (`generate_email_verification_token`, `configure_guest_email`) — profile.rs:53-87. Routed live at
   `GET/PATCH /profile` (routes/profile.rs:49,58; handlers/profile.rs:14-29). None of this branching
   is covered by any test.

3. **Role/permission-DEFINITION mutations write no audit trail at all — not merely untested, the
   code path doesn't exist** — distinct from the "role-assignment-audit-unverified" finding, which
   is about `assign_role_to_user`/`remove_role_from_user` (which DO call AuditLog but aren't
   test-verified). Grepped every `AuditLog::` call in services/rbac.rs (`grep -n "AuditLog::"
   src/services/rbac.rs` → lines 57, 93, 106, 171, 174 only). `create_role` (rbac.rs:15-17),
   `update_role` (192-216), `delete_role` (218-241), `create_permission` (72-84), `update_permission`
   (243-267), `delete_permission` (269-...), `assign_permission_to_role` (111-120),
   `remove_permission_from_role` (122-132), and `replace_role_permissions` (134-149) — 9 of the 15
   mutating functions in this file — call zero AuditLog function. Creating a role, defining what a
   permission means, or wholesale-replacing a role's permission set are exactly the kind of
   privileged configuration changes an audit trail exists for; here there is nothing to test because
   there is nothing written.

4. **`require_admin_helper`, `require_super_admin_helper`, `check_admin_role` are dead
   verification-gate code — zero callers anywhere in the backend** (middleware.rs:82 `#[allow(dead_code)]`,
   123, 131 likewise annotated). `grep -rn "require_admin_helper\|require_super_admin_helper" src/
   --include="*.rs"` → only the definitions themselves plus re-exports (lib.rs:19-20,
   core/mod.rs:32-33) — no route or handler in the whole backend invokes them. If any endpoint is
   intended to be super-admin-only, it is not using this helper; if none is, this is unused
   surface area that will silently rot (and can never be "tested" meaningfully because nothing
   depends on it).

## Commands used for absence claims (for reproducibility)
All run from `hotel-app-be/` unless noted; zsh, paths quoted per repo convention.
- `grep -rn "create_user(\|update_user(\|delete_user(" tests/*.rs`
- `grep -rn "passkey" tests/*.rs` (2 incidental hits, see above) and the 7-name functional grep
- `grep -n "setup_pg_pool\|mod postgres_tests" tests/rbac_profile.rs tests/auth_session.rs`
- `grep -rn "require_auth(\|require_permission_helper(\|require_any_permission_helper(\|require_admin_helper(\|require_super_admin_helper(" tests/*.rs`
- `grep -rln "reqwest\|oneshot\|TestServer\|tower::ServiceExt" tests/*.rs`
- `grep -n "audit_logs" tests/rbac_profile.rs tests/auth_session.rs`
- `grep -rn "login_failure" tests/*.rs`
- `grep -rn "\.auth\." tests/*.rs`; `grep -rln "routes::auth\|routes/auth" tests/*.rs`
- per-name loops for repositories/audit.rs wrapper names and rbac permission-CRUD names
- (hotel-web-fe) `find src/features/rbac src/features/user -iname "*.test.*"`;
  `find src/features/admin/components/rbac -type f | grep -v -i test | wc -l` → 20
