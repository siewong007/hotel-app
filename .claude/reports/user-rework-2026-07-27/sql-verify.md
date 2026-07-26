# Adversarial verification: User-domain data model / SQL correctness / bootstrap integrity

Session: 2026-07-27. Re-derived every claim from source; vendored sqlx-postgres-0.8.6
and sqlx-core-0.8.6 source was read directly (found under
`/Users/goaltosuceed/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`) to confirm
the runtime decode-mismatch mechanics rather than trusting the auditor's description.

## Verdicts

### audit-log-ip-address-inet-decode-mismatch — CONFIRMED (blocker)
- models/audit.rs:72 `AuditLogRow.ip_address: Option<String>` — confirmed verbatim.
- repositories/audit.rs:112-113 and 198-199 select `a.ip_address` with no cast, into
  `AuditLogRow` via `query_as` (lines 158, 210) — confirmed, no `::text`/`host()`.
- migrations/0001_v1_baseline.sql:1154 `ip_address inet,` inside `CREATE TABLE
  public.audit_logs` (1147-1158) — confirmed.
- Cargo.toml:30 sqlx features = runtime-tokio-rustls, postgres, macros, uuid, chrono,
  rust_decimal, json — no ipnetwork/ipnet — confirmed.
- Traced the actual runtime mechanics (not just cited, executed the logic by reading
  the crate source): sqlx-core-0.8.6/src/row.rs:111-133 `try_get` skips the
  `T::compatible` check ONLY when `value.is_null()` (line 118). For Postgres,
  `PgTypeInfo::is_null()` unconditionally returns `false`
  (sqlx-postgres-0.8.6/src/type_info.rs:1045-1047), so whenever the column value is
  NOT SQL-NULL, `!ty.is_null() && !T::compatible(&ty)` DOES evaluate, and
  `Option<String>::compatible` (sqlx-core/src/types/mod.rs:250-252) delegates to
  `String::compatible`, whose list (sqlx-postgres/src/types/str.rs:14-24) is
  `[TEXT, NAME, BPCHAR, VARCHAR, UNKNOWN, citext]` — INET is absent. Result: any row
  with a non-null `ip_address` returns `Err(Error::ColumnDecode{ mismatched_types })`
  when fetched via `query_as::<_, AuditLogRow>`. Rows where ip_address IS NULL decode
  fine (Option<T>::decode short-circuits on `value.is_null()` before any compatibility
  check), which is why this has never fired before now.
- core/auth.rs:396 `host(ip_address) AS ip_address` for `ActiveSessionRecord`
  (struct at 33-41, field at line 37) — confirmed the codebase already knows the
  fix pattern for a sibling `inet` column (refresh_tokens.ip_address, baseline:4044).
- handlers/webhooks.rs:93,121 — both inside the "PayPal webhook ignored" branches
  (unhandled event type at line 73-100; missing/malformed custom_id at 102-127) —
  confirmed `ip_address: Some(client_ip.to_string())` where `client_ip: IpAddr`
  (webhooks.rs:28) — `IpAddr::to_string()` never includes a port, so the INSERT's
  explicit `$6::inet` cast (repositories/audit.rs:35,71) succeeds and a genuine
  non-null `inet` value lands in the row — the SELECT-side bug is real and reachable
  via a path already merged (commit 214305432, confirmed present in `git log`).
  grep -rn "ip_address: Some(" src/ → exactly those 2 lines, confirmed.
- Route wiring confirmed live: routes/mod.rs:234 `.merge(audit::routes())`;
  services/audit.rs:417,457 call `list_logs`/`list_logs_for_export`.
  `grep -rln "list_logs\b" tests/` → empty (no test coverage), confirmed.
- Verdict: CONFIRMED as stated, severity blocker is justified — already-shipped code
  writes the poison row; the very next paginated/exported fetch that includes it 500s.

### bootstrap-missing-seed-check-dead — CONFIRMED (high)
- data.sql:1091 `missing_seed_count INTEGER;`, computed 1144-1162 (UNION ALL over
  expected_system_roles/expected_system_permissions/expected_system_settings/
  expected_route_access_policies vs. the real tables) — confirmed verbatim.
- Read lines 1085-1224 (the whole final DO block) directly: after the
  `missing_seed_count` SELECT there is only a comment (1164-1166) and then the NEXT
  check (`unknown_route_permission_count`) begins — no `IF missing_seed_count > 0`
  anywhere in the file. `grep -n "missing_seed_count"` → exactly 2 lines (declare,
  compute), confirming it never appears in an IF/RAISE.
- Sibling checks DO raise: invalid_count (1138-1142), unknown_route_permission_count
  (1176-1180), unknown_route_role_count (1195-1199) — confirmed each has its RAISE
  EXCEPTION immediately following the SELECT...INTO.
- grep -rn "expected_system_roles\|expected_system_permissions\|
  expected_route_access_policies\|expected_system_settings" src/ → empty: nothing in
  Rust re-validates these either, so this really is the only would-be guard, and it's
  inert.
- Verdict: CONFIRMED as stated, no correction needed.

### user-roles-expires-at-never-enforced — PARTIAL (downgrade high → medium)
- migrations/0001_v1_baseline.sql:4790 `expires_at timestamp with time zone` inside
  `CREATE TABLE public.user_roles` (4785-4791) — confirmed.
- core/rbac_cache.rs:90-107 `resolve()` — confirmed both the permissions query
  (90-95) and roles query (103-107) filter only `WHERE ur.user_id = $1`, no
  expires_at predicate.
- core/auth.rs:450-468 (`get_user_permissions`) and 470-484 (`get_user_roles`) —
  confirmed, same gap, byte-for-byte matches auditor's line ranges.
- repositories/rbac.rs:223-237 (`get_user_roles`) and 480-498
  (`get_user_permissions`) — confirmed, same gap.
- repositories/user.rs:417-432 (`get_roles`) and 434-451 (`get_permissions`) — confirmed
  same gap; these two are unused elsewhere in this file's read path (not re-verified
  as fully dead, out of scope here) but the SQL itself is as described.
- grep -rn "INSERT INTO user_roles" src/ → repositories/rbac.rs:161,466;
  repositories/user.rs:127; repositories/auth.rs:266 — confirmed all 4 omit
  expires_at from the column list, so no code path ever writes a non-null value.
  Also confirmed via `grep -n "user_roles" data.sql seed.sql` — the two seed INSERTs
  (seed.sql:71,77) likewise omit expires_at.
- Correction: this is accurate as a "the column is fully wired for nothing" finding
  (identical shape to the user_permissions-table finding below, which the auditor
  rated medium), but the "high" severity oversells the current risk: NOTHING in the
  entire codebase or seed data ever sets a non-null expires_at today, so the
  "privilege-escalation-by-omission" impact is 100% prospective (requires an
  as-yet-unbuilt future feature or a manual DB edit before it means anything). There
  is no current path by which this creates a live privileged session that outlives
  its intended window. Rated medium to match the sibling "unused schema, needs a
  product decision" findings (role-display-name, user-permissions-table) rather than
  high, which the auditor reserved for issues with a live, already-shipped trigger
  (e.g. the audit-log ip_address bug, which real code exercises today).

### desktop-patches-directory-missing-all-files — CONFIRMED (medium)
- `ls` both patch directories directly: hotel-app-be has 12 dated patch files;
  hotel-desktop mirror has exactly 1 (`2026-07-26-pg19-native-physical-design.sql`,
  byte-size 13158 matching the source exactly).
- Ran the auditor's exact command: `diff -rq hotel-app-be/database/postgres/patches/
  hotel-desktop/src-tauri/database/postgres/patches/` → 11 lines, each
  "Only in hotel-app-be/...", covering 2026-07-21-payments-approve-permission.sql
  through 2026-07-27-loyalty-bootstrap-data.sql — confirmed exactly.
- Minor clarification not present in the original finding: hotel-app-be actually has
  12 patches, not 11 — the auditor's evidence and count ("11 files") are about the
  MISSING set only, and is correct; the 12th patch (pg19-native-physical-design.sql)
  IS present in both trees and correctly excluded from the diff/count. Doesn't change
  the verdict.
- Confirmed baseline/data.sql/seed.sql are byte-identical between the two trees via
  `diff -q` on all three pairs (empty output on all three, exit 0).
- Verdict: CONFIRMED as stated, no severity change.

### duplicate-manage-permission-derivation-logic — CONFIRMED (medium)
- core/middleware.rs:30-59 `check_permission` — confirmed: first call to
  `AuthService::check_permission` (line 35) for the literal permission, then on
  failure (39-41 early-return skipped) splits at the first `:` (line 43) and calls
  `AuthService::check_permission` AGAIN for `"{resource}:manage"` (44-48).
- core/auth.rs:489-495 `AuthService::check_permission` is a 1-line delegate to
  `rbac_cache::has_permission` — confirmed.
- core/rbac_cache.rs:122-131 `has_permission` — confirmed it already computes
  `manage = permission.split_once(':').map(|(r,_)| format!("{r}:manage"))` and
  returns `permissions.contains(permission) || manage.is_some_and(|m|
  permissions.contains(&m))` on ITS single invocation — so middleware's first call
  (line 35) already returns true if the cached permission set contains
  `<resource>:manage`. If that first call returned false, `permissions` provably
  does not contain the literal permission NOR `<resource>:manage`, so middleware's
  second call (computing and checking exactly `<resource>:manage` again) can never
  flip to true. Confirmed as pure redundant work + duplicated business rule.
- Verdict: CONFIRMED as stated, no severity change (this is real, but purely a
  quality/maintenance issue, not a security bug — both copies agree today).

### role-display-name-never-updatable — PARTIAL (impact overstated; severity unchanged)
- repositories/rbac.rs:104 `let display_name = name.replace('_', " ");` inside
  `create_role` (99-118), bound into the INSERT (107,113) — confirmed.
- repositories/rbac.rs:525-545 `update_role` — confirmed `SET name = $1,
  description = $2, updated_at = NOW()` — no display_name in the SET clause.
- models/rbac.rs:19-23 `RoleInput { name, description }` — confirmed, no
  display_name field. Note also: models/rbac.rs:11-16 `Role` FromRow struct ALSO has
  no display_name field.
- New evidence not in the original finding: display_name is not just "never
  updated" — it is never SELECTed by any Rust query at all. Checked every
  `FROM roles` query in repositories/rbac.rs (lines 63-90 `find_all_roles`/
  `find_role_by_id`/`find_role_by_name`, plus 8 more call sites) — all explicitly
  list `id, name, description, created_at` (or a subset), never display_name.
  `grep -rn "display_name" src/` → only rbac.rs:104/107/113 (write) and
  repositories/night_audit.rs (an unrelated `NightAuditTypeSummary.display_name`
  field, models/night_audit.rs:66) — no read path exists anywhere for
  `roles.display_name`. Frontend `hotel-web-fe/src/types/rbac.types.ts:4-9`
  `Role { id, name, description, created_at }` also has no displayName field — the
  RBAC management UI cannot show this column even if the backend did return it.
- Correction: the auditor's impact — "An administrator... keeps the OLD
  display_name forever" as something visibly wrong in the RBAC UI — does not hold;
  no consumer (API response or frontend) ever surfaces `roles.display_name` for
  ordinary CRUD, so there is no user-visible drift today. The accurate framing is
  that `display_name` is functionally a write-only/dead column outside of
  data.sql's own system-role bootstrap validation (data.sql:283-293, which only
  checks `is_system_role IS TRUE` rows, i.e. seeded roles, not admin-created ones).
  Kept severity at medium since it's the same class of issue as the
  user-permissions-table finding (dead schema surface needing a decision), but the
  stated impact should be corrected.

### user-permissions-table-entirely-unused — CONFIRMED (medium)
- migrations/0001_v1_baseline.sql:4864-4869 `CREATE TABLE public.user_permissions
  (user_id, permission_id, assigned_at, assigned_by)` — confirmed.
- PK at 6089-6091 `user_permissions_pkey PRIMARY KEY (user_id, permission_id)` —
  confirmed.
- FKs at 9411-9431: `user_permissions_assigned_by_fkey` (plain, no cascade, →
  users(id)), `user_permissions_permission_id_fkey` (ON DELETE CASCADE →
  permissions(id)), `user_permissions_user_id_fkey` (ON DELETE CASCADE → users(id))
  — confirmed exactly 2 CASCADE FKs as the auditor stated.
- Index at 7563-7566 `idx_user_permissions_user_id` — confirmed.
- `grep -rn "FROM user_permissions|INTO user_permissions|UPDATE user_permissions"
  src/` → zero hits (command ran clean, no output, no glob-expansion error).
  Broader `grep -rln "user_permissions" src/` hits only core/auth.rs,
  repositories/rbac.rs, services/passkey.rs, services/auth.rs — verified every one
  of those is the substring inside the function name `get_user_permissions` (which
  reads role_permissions/user_roles, a different, real path), not the table.
- Verdict: CONFIRMED as stated, no correction needed.

## Missed findings (additional, same dimension)

1. `user_sessions` table (baseline:4876-4887, ip_address inet at 4880, device_info
   jsonb, is_active boolean) plus its dedicated maintenance function
   `cleanup_expired_sessions()` (baseline:212-223, updates user_sessions AND deletes
   from refresh_tokens) are BOTH entirely dead: `grep -rn "user_sessions" src/
   database/postgres/data.sql database/postgres/seed.sql` → zero hits, and
   `grep -rn "cleanup_expired_sessions" src/` → zero hits. This is the exact same
   "full schema, zero application code" shape as the reported user_permissions
   finding, for a DIFFERENT table the auditor did not check, and it additionally
   ships a cleanup function that nothing ever calls (same class as the
   2026-07-26 lesson's `sync_all_room_statuses` dead-function discovery — this repo
   has now shown that pattern twice). session tracking is done for real via
   `refresh_tokens` (core/auth.rs:391-404 `list_active_sessions`), so
   `user_sessions` is a superseded/duplicate mechanism, not a partially-wired one.

2. `passkeys.transports`, `.device_type`, `.aaguid`, `.backup_eligible`,
   `.backup_state` (baseline:3716-3721, all part of `CREATE TABLE public.passkeys`
   3710-3725) are never read or written: the `Passkey` FromRow struct
   (models/auth.rs:209-219) only has id/user_id/credential_id/public_key/counter/
   device_name/created_at/last_used_at, and the only INSERT
   (repositories/passkey.rs:148) lists `(user_id, credential_id, public_key,
   counter, device_name)` — leaving transports NULL, device_type NULL, aaguid NULL,
   backup_eligible/backup_state stuck at their column defaults (false) forever,
   regardless of what the authenticator actually reports at registration. (By
   contrast, `is_active` on the same table IS read —
   repositories/passkey.rs:182,197 — so that column is not dead; only the WebAuthn
   attestation-metadata columns are.) Lower severity than #1 (columns, not a whole
   table+function), but the same "data model promises a feature that isn't wired"
   shape as role-display-name and user_permissions.

3. Audit-log partition maintenance is a one-time bootstrap action with no recurring
   mechanism: `ensure_audit_logs_partition(date)` (baseline:275-...,319) is called
   exactly once, for the current month plus the next 11
   (baseline:9595-9607, `FOR offset_month IN 0..11 LOOP PERFORM
   public.ensure_audit_logs_partition(...)`), at V1 install time only.
   `grep -rn "ensure_audit_logs_partition" src/` → zero hits (no Rust caller), and
   `grep -n "pg_cron" database/postgres/migrations/0001_v1_baseline.sql
   database/postgres/data.sql` → zero hits (no recurring in-database scheduler
   either). Per the function's own COMMENT (baseline:319), late partition creation
   uses PG19 `SPLIT PARTITION`, which "takes exclusive locks and can move data" —
   i.e. it is deliberately NOT meant to run automatically/silently. Roughly 12
   months after any given install date, new `audit_logs` rows will silently start
   landing in the `audit_logs_default` DEFAULT partition with no error, and the
   eventual fix requires an exclusive-lock maintenance operation on a
   security-relevant, potentially large table. This is a bootstrap-integrity gap in
   the same spirit as the missing_seed_count finding: correct machinery exists but
   nothing keeps it running after day one.
