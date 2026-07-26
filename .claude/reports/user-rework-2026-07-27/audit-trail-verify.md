# Adversarial verification — audit trail completeness/integrity/traceability

All line numbers below were opened and read this session (Read tool with offset/limit,
or grep -n to locate then Read). Repo root:
"/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app/hotel-app-be" (paths below
are relative to that root unless stated).

## Verdicts on submitted findings

### 1. audit-export-permission-missing-fresh-install — CONFIRMED (blocker)
- data.sql:58 `('audit:export')` in `expected_system_permissions`; the actual
  `INSERT INTO permissions` block is data.sql:414-517 (read in full) and contains
  NO `audit:export` row (only `audit:read` at line 498).
- data.sql:1091 `missing_seed_count INTEGER;`, computed at 1144-1162, but the DO
  block (1088-1222, read in full) never contains `IF missing_seed_count > 0 THEN
  RAISE`. Contrast: `invalid_count` (1138), `unknown_route_permission_count`
  (1176), `unknown_route_role_count` (1195) all DO raise.
- `admin`/`super_admin` grant is a blind `CROSS JOIN permissions p` with no
  `p.name IN (...)` filter (data.sql:534) — it can only grant rows that exist in
  `permissions`, and confirmed `has_permission` (core/rbac_cache.rs:122-131) has
  no other bypass (only a literal `<resource>:manage` fallback; no `audit:manage`
  exists anywhere — `grep audit:manage` is empty).
- routes/audit.rs:81 gates CSV export on the literal string `"audit:export"`.
- Legacy upgrade path (`database/postgres/upgrade/pg18_4_to_v1.sql:350-363`,
  read in full) DOES insert and grant `audit:export` to `admin`/`manager` — so
  the bug is invisible on upgraded DBs, exactly as claimed.
- Verdict: fully reproduced from source. Severity blocker is justified — a
  routed, permission-gated compliance feature (CSV export) is unreachable by
  ANY role on a fresh V1 install.

### 2. log-event-swallows-db-errors-user-domain — PARTIAL (corrected: high)
- services/audit.rs:28-48 `log_event` confirmed: `Ok(())` unconditionally at
  line 47, comment at 46. `log_event_tx` (50-57) confirmed to
  `.map_err(ApiError::from)` (propagates).
- Grepped every `AuditLog::` call site in auth.rs/rbac.rs/users.rs/profile.rs/
  two_factor.rs: 9+5+3+2+5 = 24 call sites (auditor said 22 — auth.rs actually
  has 9, not 7; miscount does not change the conclusion), ALL route through
  `log_event`/`log_login_success`/`log_login_failure`/`log_role_assignment`/
  `log_role_removal`/`log_password_changed`, which I traced back into
  `Self::log_event` in every case (read audit.rs:60-330). Zero `_tx` suffix use
  in these 6 files (`grep "_tx("` empty in all six).
- Additional evidence the auditor did NOT cite: `log_event_tx` IS the
  established pattern elsewhere — grep shows 29 call sites across
  repositories/bookings/lifecycle.rs, services/bookings.rs, services/payments.rs,
  services/housekeeping.rs, and every one of the 7 already-migrated modules
  (loyalty, promotions, communications, guest_booking). The user domain is the
  ONLY group of domains still on the silent-swallow path.
- Correction: the auditor's technical claim is fully correct, but "blocker" is
  overstated. Unlike finding 1 (deterministically broken on every fresh
  install), this defect only manifests when the `audit_logs` INSERT itself
  fails (transient DB error, connection drop) — a real but comparatively rare
  trigger condition, and the code's own comment frames it as an intentional
  fail-open tradeoff. Downgrading to "high": real integrity gap, security
  sensitive, but conditional rather than deterministic.

### 3. passkey-subsystem-zero-audit-coverage — CONFIRMED (high)
- `grep -n "AuditLog\|audit" src/services/passkey.rs` → zero matches (confirmed).
- delete_passkey (36-46), update_passkey (48-59): read in full, no audit call.
- register_finish (114-195): read in full; `insert_passkey` at 182-190, no
  audit call anywhere in the function.
- login_finish (243-337): read in full; mints full session (store_refresh_token
  313-315, generate_session_jwt 316-322, update_last_login 323) — zero
  AuditLog:: calls anywhere in the function, including none of its multiple
  `Err(...)` returns (challenge invalid 257-261, invalid passkey 269, replay
  283-287, invalid signature 293-295).
- Verdict: fully reproduced, severity high as claimed.

### 4. rbac-role-permission-crud-zero-audit-coverage — CONFIRMED (high)
- Read services/rbac.rs in full (369 lines). Confirmed zero AuditLog calls in:
  create_role (15-17), create_permission (72-84), assign_permission_to_role
  (111-120), remove_permission_from_role (122-132), replace_role_permissions
  (134-149), update_role (192-216), delete_role (218-241), update_permission
  (243-267), delete_permission (269-291).
- Only assign_role_to_user (line 93), remove_role_from_user (line 106), and
  replace_user_roles's diff loop (lines 171, 174) call
  log_role_assignment/log_role_removal — exact line matches.
- routes/rbac.rs read (90-230): confirmed `actor_user_id` IS threaded via
  `Extension` into assign_permission (153), remove_permission (168),
  replace_role_permissions (180), update_role (197), delete_role (208) — the
  actor id is available and simply never used for an audit write in the
  corresponding service fns. (update_permission/delete_permission additionally
  don't even capture actor_user_id at the route layer — an extra gap beyond
  what the auditor claimed, but consistent with "zero audit coverage.")
- Verdict: fully reproduced, severity high as claimed.

### 5. ip-user-agent-never-captured-user-domain — CONFIRMED (high)
- routes/auth.rs:66 (`extract_client_ip`), 77-80 (user_agent), passed into
  login_handler at 81-88 exactly as claimed.
- handlers/auth.rs:58-69 login_handler forwards both into `svc::login`.
- services/auth.rs::login (23-262, read in full): ALL 7 log_login_failure calls
  hardcode `None, None` at EXACTLY the cited lines: 37, 42, 56, 99, 116, 130,
  198. log_login_success at line 248 also hardcodes `None, None`. The real
  ip_address/user_agent params are used exactly once, at line 228
  (`store_refresh_token`) — auditor's line citation is exact.
- routes/profile.rs:69 computes `ip` (rate limiting only, line 70), never
  forwarded to `update_password_handler` at line 81 (only `Extension(user_id)`).
- services/audit.rs:316 `log_password_changed(pool: &DbPool, user_id: i64)` —
  confirmed no ip/user_agent parameters at all.
- handlers/users.rs (read in full, 57 lines): create_user_handler (20-26),
  update_user_handler (28-37) take no HeaderMap — confirmed structurally
  impossible to capture IP/UA here. routes/rbac.rs also has zero HeaderMap
  usage on any handler (grep empty) — supports the "all RBAC endpoints" claim.
- Verdict: fully reproduced with high-precision line matches. Severity high as
  claimed.

### 6. user-updated-no-before-after-values — CONFIRMED (medium)
- changed_user_fields (services/users.rs:234-272, read in full) returns
  `Vec<&'static str>` of field names only.
- Audit call at 154-165 stores `{"changed_fields": changed_fields}` — exact
  match, e.g. `["is_active"]` for both activate/deactivate, no direction, no
  before/after for username/email/phone.
- Verdict: fully reproduced, severity medium as claimed.

### 7. role-assignment-no-role-name-or-permission-snapshot — CONFIRMED (medium)
- log_role_assignment (audit.rs:117-141) and log_role_removal (144-168) read in
  full: details = `{"user_id", "role_id", "assigned_by"/"removed_by"}` only —
  no role name, no permission list.
- `resource_id: Some(user_id)` confirmed at EXACTLY line 135 and line 162 (not
  role_id) — auditor's line citations are exact.
- Verdict: fully reproduced, severity medium as claimed.

### 8. audit-logs-partition-maintenance-never-scheduled — CONFIRMED (medium)
- migrations/0001_v1_baseline.sql:275-319 `ensure_audit_logs_partition` read in
  full, comment at 319 matches verbatim.
- `grep -rn "ensure_audit_logs_partition" src/ --include="*.rs"` → zero matches
  (EXIT=1, confirmed absence).
- Only 3 schedulers actually spawned (src/main.rs:211-225): night_audit_scheduler,
  payment_receipt_scheduler, communications::scheduler — none reference audit
  partitions.
- `grep -n "DELETE FROM audit_logs\|TRUNCATE.*audit_logs\|DROP.*audit_logs"`
  across src/ and database/postgres/ → only upgrade-time index/legacy-table
  drops in pg18_4_to_v1.sql (lines 4269-4274, 4382-4383, 6085) — no retention
  policy, exactly as claimed.
- Verdict: fully reproduced, severity medium as claimed.

## Additional issues found (missed by the original audit)

1. **two_factor.rs: failed 2FA verification/disable/enable/regenerate attempts
   are unaudited; verify_2fa_code has ZERO audit logging at all (success or
   failure).** File: src/services/two_factor.rs. verify_2fa_code (220-246, read
   in full) never calls AuditLog on the success path (line 245) or the failure
   path (241-243) — contrast with the password-login flow (services/auth.rs)
   which audits every failure. disable_2fa's invalid-code branch (173-177) and
   enable_2fa's invalid-code branch (87-89) and regenerate_backup_codes'
   invalid-code branch (269-271) all return `Err` with NO audit call — only the
   rarer "challenge rejected" sub-case in enable_2fa (98-115) is audited. This
   means an attacker can brute-force TOTP/recovery codes against
   `/profile/2fa/verify`, `/2fa/disable`, or `/2fa/regenerate-backup-codes` with
   zero trace. Severity: high (asymmetric with the audited login-failure path
   for the same secret class).

2. **services/profile.rs update_user_profile is completely unaudited** — no
   AuditLog call anywhere in the 23-97 function (read in full), despite
   changing full_name/email/phone/avatar_url. Email change (48-88) is
   especially significant: it's the account-recovery channel, gated by its own
   guest/staff branching logic, yet leaves no trace — contrast with
   update_password (services/profile.rs:133, `log_password_changed`) and
   revoke_session (169-180) in the SAME file, which ARE audited. Severity:
   high.

3. **route_access_policies changes (the authorization-gating config itself)
   are audited with no diff** — services/rbac.rs update_route_policy (49-70,
   read in full) is the ONLY mutation path for route_access_policies
   (confirmed via repositories/rbac.rs:301-339: a blind UPDATE with no prior
   SELECT). The audit call (57-68) stores only `{"route_id": policy.route_id}`
   — not even the NEW required_permissions/required_roles, let alone the OLD
   values. Since this table defines which permissions/roles gate every route
   in the app, an admin (or compromised `permissions:manage` session) could
   silently loosen or tighten access on any route and the audit trail would
   show nothing but "route X was touched." Severity: high.

4. **The missing_seed_count validation gap (root cause of finding #1) silently
   drops ~25 permission rows on a fresh install, not just `audit:export`.**
   Cross-referenced every name in `expected_system_permissions`
   (data.sql:56-184, 128 entries) against the actual `INSERT INTO permissions`
   block (data.sql:414-517, 103 rows) — confirmed 25 names present in the
   expected list but never inserted: `permissions:read/create/update/delete`,
   15 `navigation_*` permissions (audit_log, bookings, company_ledger,
   complimentary, data_transfer, ekyc_admin, guest_config, loyalty,
   my_bookings, my_rewards, night_audit, rbac, reports, room_config,
   room_management, settings, timeline), `loyalty:read/manage`, `rooms:write`,
   `rewards:read`. Most are currently harmless dead references (the actual
   Rust permission checks for these resources use `<resource>:manage`, which
   IS seeded, and `has_permission`'s resource:manage fallback covers them —
   verified for `rooms:write` at src/routes/rooms.rs:97,116 and
   src/routes/rates.rs:57,94,113,150, all satisfied via `rooms:manage`).
   However at least one is an ACTIVE seed-grant no-op: data.sql:569 grants
   `navigation_room_management:read` to the `housekeeping` role via
   `... WHERE p.name IN (...)`, which silently inserts zero rows since that
   permission doesn't exist — currently benign only because the
   `room-management` route policy (data.sql line ~1057, `('room-management',
   ...)`) actually gates on `rooms:read`/`rooms:manage`, not on
   `navigation_room_management:read`. This is a landmine: any future change
   that starts checking these specific strings (as the CSV-export bug did for
   `audit:export`) will silently break on fresh installs the same way.
   Severity: medium (broadens finding #1's scope; distinct from the one
   actively-broken case).

5. **create_user grants initial roles with zero audit trail of which roles were
   granted** — services/users.rs create_user (30-77, read in full):
   `UserRepository::create_with_roles(pool, &input, &password_hash, &role_ids)`
   at line 61 assigns roles atomically with user creation, but the only audit
   event (63-74, action `user_created`) records `{"username", "email"}` only —
   no `role_ids`. No `log_role_assignment` call is made per granted role either,
   unlike post-creation role changes (replace_user_roles / assign_role_to_user)
   which ARE logged individually. You cannot reconstruct from the audit table
   which roles a user held at creation time. Severity: medium.

6. **audit_logs has no DB-level protection against UPDATE/DELETE** — the table
   definition (migrations/0001_v1_baseline.sql:1147-1158, read) has no trigger,
   rule, or restrictive GRANT preventing mutation of existing rows; confirmed
   `grep -c "^GRANT\|^REVOKE"` on the whole baseline is 0 — the entire schema
   has no privilege-separation model (one app role owns everything), so this is
   systemic rather than audit_logs-specific. Currently no code path issues
   UPDATE/DELETE against audit_logs (confirmed for finding #8). Severity: low
   (design-level observation, not a concrete exploitable gap given current
   code, but worth flagging for a compliance-grade audit trail).
