# Audit Trail Completeness, Integrity & Traceability — User Domain

Scope: `src/services/audit.rs`, `src/repositories/audit.rs`, `src/models/audit.rs`,
`src/handlers/audit.rs`, `src/routes/audit.rs`, plus every audit call site reachable
from the unmigrated user domain (`auth`, `rbac`, `users`, `profile`, `two_factor`,
`passkey`). All line numbers were read this session; grep commands and their
literal output are included so absence claims are checkable.

All commands run from `hotel-app-be/` unless noted.

---

## 1. The audit API — every `pub fn` and its call count

### `AuditLog` (services/audit.rs, `impl` block lines 16–358)

| fn | sig (abridged) | line | callers outside audit.rs (grep count) |
|---|---|---|---|
| `log_event` | `(pool, AuditEvent) -> Result<(), ApiError>` — **always returns `Ok(())`** | 28 | 78 |
| `log_event_tx` | `(tx, AuditEvent) -> Result<(), ApiError>` — propagates DB errors | 50 | 29 |
| `log_login_success` | `(pool, user_id, method, ip, ua)` | 60 | 1 |
| `log_login_failure` | `(pool, username, reason, ip, ua)` | 88 | 7 |
| `log_role_assignment` | `(pool, admin_id, user_id, role_id)` | 117 | 2 |
| `log_role_removal` | `(pool, admin_id, user_id, role_id)` | 144 | 2 |
| `log_booking_created` | `(pool, user_id, booking_id, guest_id, room_id)` | 171 | 1 |
| `log_booking_updated` | `(pool, user_id, booking_id, changes)` | 199 | 1 |
| `log_booking_cancelled` | legacy name, `(pool, user_id, booking_id)` | 220 | **0** |
| `log_booking_voided_tx` | `(tx, user_id, booking_id)` | 240 | 3 |
| `log_ekyc_approved` | `(pool, admin_id, verification_id, guest_id)` | 260 | **0** |
| `log_ekyc_rejected` | `(pool, admin_id, verification_id, guest_id, reason)` | 287 | **0** |
| `log_password_changed` | `(pool, user_id)` — **no ip/user_agent params at all** | 316 | 1 |
| `log_settings_changed` | `(pool, admin_id, key, old, new)` | 332 | **0** |

Free functions (services/audit.rs, lines 405–571): `get_audit_logs`, `get_audit_actions`,
`get_audit_resource_types`, `export_audit_logs_csv`, `get_audit_users`,
`get_audit_category_counts`, `get_db_statements` — these are the read/export surface,
called 1:1 from `handlers/audit.rs` (verified by reading handlers/audit.rs:1–78 in full).

Verification command:
```
grep -n "^pub fn\|^pub async fn\|^    pub fn\|^    pub async fn" src/services/audit.rs
for fn in log_event log_event_tx log_login_success log_login_failure log_role_assignment \
  log_role_removal log_booking_created log_booking_updated log_booking_cancelled \
  log_booking_voided_tx log_ekyc_approved log_ekyc_rejected log_password_changed \
  log_settings_changed; do
  grep -rn "AuditLog::${fn}\b" src/ --include="*.rs" | grep -v "src/services/audit.rs" | wc -l
done
```
Output confirmed: `log_booking_cancelled`, `log_ekyc_approved`, `log_ekyc_rejected`,
`log_settings_changed` are **dead** (0 callers) — superseded by direct
`AuditLog::log_event`/`log_event_tx` calls in the migrated modules
(`modules/ekyc/service.rs`, `modules/settings/*`) which build the `AuditEvent`
inline instead. Not a defect, just naming drift left over from an earlier
refactor — flagged for cleanup, not reported as a finding (no user-facing impact).

`AuditRepository` (repositories/audit.rs, lines 17–291): `insert_event` (17),
`insert_event_tx` (52), `list_logs` (89), `list_actions` (173),
`list_resource_types` (180), `list_logs_for_export` (189), `list_users` (219),
`count_by_resource_type` (233), `list_db_statements` (266). **No `update_*` or
`delete_*` function exists on `AuditRepository`** (grep of the file's fn names,
confirmed by reading the full 412-line file this session) — the repository
offers no code path to mutate or remove a row once written.

---

## 2. FAILURE POLICY — does `log_event` swallow DB errors?

**Yes, unconditionally.** `services/audit.rs:28-48`:
```rust
pub async fn log_event(pool: &DbPool, event: AuditEvent<'_>) -> Result<(), ApiError> {
    ...
    let result = AuditRepository::insert_event(pool, event, Utc::now()).await;
    if let Err(e) = &result {
        log::warn!("Audit log failed (table may not exist): {} - Action: {}, Resource: {}", ...);
    }
    // Return Ok even if insert fails - don't block operations due to audit log issues
    Ok(())
}
```
Line 46's comment is accurate: **`log_event` cannot return `Err` regardless of what
happens in Postgres.** The only visible trace of a failed write is a `log::warn!`
line — no metric, no alert, no retry, no dead-letter table.

By contrast, `log_event_tx` (lines 50-57) **does** propagate the error
(`.map_err(ApiError::from)`), because it runs inside the caller's own DB
transaction — an audit-insert failure there aborts the whole transaction (the
booking/ledger domains rely on this for `log_booking_voided_tx`,
`communications`, `promotions`, `loyalty`, `guest_booking` — all migrated
modules use `log_event_tx` extensively, see the full call list below).

**The user domain never uses the transactional variant.** Grep of every
`AuditLog::` call site in `src/services/{auth,rbac,users,profile,two_factor}.rs`
and `src/services/passkey.rs`:
```
grep -rn "AuditLog::" src/services/{auth,rbac,users,profile,two_factor,passkey}.rs
```
— every hit is `AuditLog::log_event(`, `log_login_success(`, `log_login_failure(`,
`log_role_assignment(`, `log_role_removal(`, or `log_password_changed(`; **zero**
hits for `log_event_tx` or any `_tx` suffix. All of these ultimately call the
non-transactional `Self::log_event`, so **every audit write in the user, auth,
and RBAC domains can silently vanish on a DB error while the underlying mutation
(role removal, user deletion, password change, 2FA disable) still commits.**

### `let _ = AuditLog::…` / `.ok()` sites, user domain only

Counted with `grep -c "let _ = AuditLog::" <file>`:

| File | `let _ =` sites |
|---|---|
| `src/services/auth.rs` | 7 |
| `src/services/rbac.rs` | 5 |
| `src/services/users.rs` | 3 |
| `src/services/profile.rs` | 2 |
| `src/services/two_factor.rs` | 5 |
| `src/services/passkey.rs` | 0 (calls `AuditLog` **zero** times at all — see §3) |
| **Total** | **22** |

Because `log_event`/`log_login_success`/`log_login_failure`/`log_role_assignment`/
`log_role_removal`/`log_password_changed` can never return `Err` in the first
place (they all bottom out in `log_event`), the `let _ =` at every one of these
22 sites is cosmetically discarding a `Result` that was already unconditionally
`Ok`. The real swallow happens once, inside `log_event` itself — the call-site
`let _ =` is not an additional independent bug, it is a symptom of the same root
cause (and would still swallow a real error even if `log_event`'s own policy were
fixed later, so both layers matter).

---

## 3. COVERAGE MATRIX — every mutating user-domain endpoint

`resource_id` semantics vary by action — noted per row rather than assumed uniform.

| # | Action | Audited? | Evidence (file:line) |
|---|---|---|---|
| 1 | Create user | **YES** | `services/users.rs:63-74`, action `"user_created"` |
| 2 | Update user (any field) | **YES** (see §4 for quality gap) | `services/users.rs:154-165`, action `"user_updated"` |
| 3 | Delete user | **YES** | `services/users.rs:195-206`, action `"user_deleted"` |
| 4 | Activate user | **PARTIAL** — folded into #2, indistinguishable | `services/users.rs:79-169` (`update_user`); no separate action name for `is_active: true` |
| 5 | Deactivate user | **PARTIAL** — same as #4 | same as #4; `is_active: false` produces the identical `"user_updated"` action |
| 6 | Assign role to user | **YES** | `services/rbac.rs:93` (`assign_role_to_user`) and `:171` (`replace_user_roles` diff), action `"role_assigned"` |
| 7 | Revoke role from user | **YES** | `services/rbac.rs:106` (`remove_role_from_user`) and `:174` (`replace_user_roles` diff), action `"role_removed"` |
| 8 | Create role | **NO** | `services/rbac.rs:15-17` (`create_role`) — no `AuditLog` call in the function |
| 9 | Update role | **NO** | `services/rbac.rs:192-216` (`update_role`) — no `AuditLog` call |
| 10 | Delete role | **NO** | `services/rbac.rs:218-241` (`delete_role`) — no `AuditLog` call |
| 11 | Grant permission to role | **NO** | `services/rbac.rs:111-120` (`assign_permission_to_role`) — no `AuditLog` call |
| 12 | Revoke permission from role | **NO** | `services/rbac.rs:122-132` (`remove_permission_from_role`) — no `AuditLog` call |
| 13 | Replace a role's whole permission set | **NO** | `services/rbac.rs:134-149` (`replace_role_permissions`) — no `AuditLog` call |
| 14 | Create permission | **NO** | `services/rbac.rs:72-84` (`create_permission`) — no `AuditLog` call |
| 15 | Update permission | **NO** | `services/rbac.rs:243-267` (`update_permission`) — no `AuditLog` call |
| 16 | Delete permission | **NO** | `services/rbac.rs:269-291` (`delete_permission`) — no `AuditLog` call |
| 17 | Password change (self-service) | **YES** (no ip/ua — see §4) | `services/profile.rs:133`, action `"password_changed"` |
| 18 | Password reset (admin-initiated, via `update_user`) | **PARTIAL** — folded into #2 | `services/users.rs:141` `changed_user_fields` appends `"password"` to `changed_fields`; no distinct action, no "reset by admin" marker |
| 19 | 2FA setup initiated | **YES** (extra, not asked but present) | `services/two_factor.rs:50-61`, action `"two_factor_setup_initiated"` |
| 20 | 2FA enable | **YES** | `services/two_factor.rs:122-133`, action `"two_factor_enabled"` |
| 21 | 2FA disable | **YES** | `services/two_factor.rs:186-197`, action `"two_factor_disabled"` |
| 22 | 2FA recovery-code regeneration | **YES** | `services/two_factor.rs:278-289`, action `"two_factor_backup_codes_regenerated"` |
| 23 | Passkey add (`register_finish`) | **NO** | `services/passkey.rs:114-195` — mutates via `PasskeyRepository::insert_passkey` (182-190), zero `AuditLog` calls in the whole 723-line file |
| 24 | Passkey remove (`delete_passkey`) | **NO** | `services/passkey.rs:36-46` |
| 25 | Passkey rename (`update_passkey`) | **NO** | `services/passkey.rs:48-59` |
| 26 | Login success (password) | **YES** (ip/ua always `None` — see §4, BLOCKER-tier bug) | `services/auth.rs:248` |
| 27 | Login success (passkey) | **NO** | `services/passkey.rs:243-337` (`login_finish`) mints a full session (roles, permissions, refresh token, access token — lines 300-323) with **zero** `AuditLog` call anywhere in the function |
| 28 | Login failure (password) | **YES** (ip/ua always `None`) | `services/auth.rs:37,42,56,99,116,130,198` (7 distinct failure branches) |
| 29 | Login failure (passkey) | **NO** | `services/passkey.rs` — `login_start` (197-238) and `login_finish` (243-337) each have multiple `Err(...)` returns (user not found, no passkeys, invalid/expired challenge, invalid passkey, sign-counter replay, invalid signature) and **none** call `AuditLog::log_login_failure` or any audit event |
| 30 | Logout | **NO** | `services/auth.rs:363-370` (`logout`) — the entire function body is a single `AuthService::revoke_refresh_token` call and a `?`; no audit call |
| 31 | Token refresh | **NO** | `services/auth.rs:289-361` (`refresh_token`) — full 73-line function read; zero `AuditLog` calls |

**Summary: 15 of 31 matrix rows are fully audited, 2 are partially audited
(activate/deactivate, admin password reset — folded into an undifferentiated
"user_updated"), and 14 have zero audit trail.** The 14 unaudited rows include
every RBAC role/permission CRUD operation and the entire passkey subsystem
(add/remove/rename/login-success/login-failure), plus logout and token refresh.

---

## 4. CONTENT QUALITY

**Schema supports actor, target, IP, user agent, and JSON details** (see §5 DDL).
In practice, for the user domain:

- **Actor (`user_id` column)**: populated correctly everywhere audited — e.g.
  `log_role_assignment` sets `user_id: Some(admin_id)` (services/audit.rs:132),
  i.e. the *actor*, while `resource_id: Some(user_id)` (line 135) is the
  *target*. This actor/target split is correct and consistent across
  `log_role_assignment`/`log_role_removal`/`log_event`-based calls in
  users.rs/rbac.rs/two_factor.rs.

- **Target entity id (`resource_id`)**: present, but its meaning is
  action-dependent with no enforced contract: for `role_assigned`/`role_removed`
  it is the **user_id** being changed (services/audit.rs:135,162), not the
  role_id — the role_id only appears inside the free-text `details` JSON
  (services/audit.rs:123-127,150-154). This means "show me the full history of
  role X" cannot use the `(resource_type, resource_id)` index at all; it would
  require a `details @>` / text search over the whole `user_role` category.

- **IP address / user agent: effectively never captured for the user domain.**
  Every user-domain `AuditEvent` is built with `..Default::default()` (which
  zeroes `ip_address`/`user_agent` per the `#[derive(Default)]` on
  `AuditEvent`, models/audit.rs:30-39) **except** the login call sites, which
  explicitly pass literal `None, None` — see the two verified examples below.
  This is the single highest-impact content gap: **"who did this and from where"
  cannot be answered for any user-domain security action.**

  1. **Login** — `routes/auth.rs:66-80` extracts the real client IP
     (`extract_client_ip`) and User-Agent header and passes them into
     `handlers::auth::login_handler` (handlers/auth.rs:58-69), which forwards
     them into `svc::login(&pool, req, ip_address.as_deref(), user_agent.as_deref())`
     (handlers/auth.rs:66). Inside `services/auth.rs::login` (the function that
     receives those two parameters), **every one of the 7**
     `AuditLog::log_login_failure(pool, &req.username, "...", None, None)` calls
     (lines 37, 42, 56, 99, 116, 130, 198) and the one
     `AuditLog::log_login_success(pool, user.id, login_method, None, None)`
     call (line 248) hardcode literal `None, None` for the ip/user_agent
     parameters **instead of forwarding the function's own `ip_address`/
     `user_agent` arguments**, which are used only once in the whole function —
     to call `AuthService::store_refresh_token(pool, user.id, &refresh_token,
     30, ip_address, user_agent)` (line 228). The real values are computed,
     threaded three layers deep, and then thrown away right before the one
     place they would matter most for the audit trail.

  2. **Password change** — `routes/profile.rs:69` computes
     `let ip = extract_client_ip(&headers, peer_addr);` for rate-limiting, but
     line 81's call to `handlers::profile::update_password_handler` does not
     pass it through, and `services/profile.rs::update_password` calls
     `AuditLog::log_password_changed(pool, user_id)` (line 133) — a function
     whose signature (services/audit.rs:316) has no ip/user_agent parameters
     at all, so there is no way to pass them even if the caller wanted to.

  3. **Everything else** — `create_user_handler`/`update_user_handler`
     (handlers/users.rs:20-26, 28-36) don't even take a `HeaderMap` parameter,
     so for user create/update/delete and every RBAC role/permission
     endpoint, IP/User-Agent is not merely dropped in transit — it is
     structurally unavailable at the handler layer in the first place.

- **BEFORE/AFTER values: absent for the most common mutation.**
  `services/users.rs::changed_user_fields` (lines 234-272) returns only a
  `Vec<&'static str>` of field *names* that changed — `"username"`, `"email"`,
  `"full_name"`, `"phone"`, `"is_active"`, `"password"` — never the old or new
  values. The resulting audit row (`services/users.rs:154-165`) stores
  `{"changed_fields": ["is_active"]}`. **You cannot tell from the audit table
  alone whether that was an activation or a deactivation, nor what the old
  username/email/phone was**, without cross-referencing the user's *current*
  live state (itself potentially overwritten by a later change).

- **Role/permission identity not snapshotted.** `log_role_assignment`/
  `log_role_removal` (services/audit.rs:117-168) record only the numeric
  `role_id` in `details` (e.g. `{"user_id":.., "role_id":.., "removed_by":..}`,
  lines 150-154) — never the role's name or the permission set it carried at
  that moment. If the role is later renamed, edited, or deleted (itself
  unaudited per §3 rows 9-10), the historical audit row's `role_id` becomes an
  orphaned or misleading reference with no way to answer "what permissions did
  removing this role actually take away."

**Direct answer to "who removed my permission and what was it before":**
partially answerable only for direct role-to-user changes (you get *which*
`role_id` was removed and by *which* admin `user_id*, from `role_removed` rows),
but **not** for the actual permission set that role carried (no snapshot), and
**not at all** for direct role/permission CRUD (§3 rows 8-16 are unaudited, so a
role's permission set changing shape over time — as opposed to a user losing a
role — leaves no trail whatsoever).

---

## 5. TABLE SHAPE — `audit_logs` DDL

Read from `database/postgres/migrations/0001_v1_baseline.sql`.

```sql
-- lines 1147-1158
CREATE TABLE public.audit_logs (
    id bigint CONSTRAINT audit_logs_id_not_null1 NOT NULL,
    user_id bigint,
    action character varying(100) NOT NULL,
    resource_type character varying(50) NOT NULL,
    resource_id bigint,
    details jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
)
PARTITION BY RANGE (created_at);
```
- **Partitioned** by month on `created_at` (comment at line 1165); a `DEFAULT`
  partition `audit_logs_default` catches any row outside a pre-created range
  (lines 1172-1182, attached at line 5035).
- **PK**: `(id, created_at)` (line 5066-5067) — required because Postgres range
  partitioning must include the partition key in every unique/primary key.
- **FK**: `audit_logs_user_id_fkey1 FOREIGN KEY (user_id) REFERENCES users(id)
  ON DELETE SET NULL` (lines 8067-8071) — deleting a user does not delete their
  audit history, it nulls the actor reference (correct, preserves the trail).
- **Indices** (lines 6198-6278, each declared `ON ONLY` the parent + mirrored
  onto the default partition):
  - `idx_audit_logs_action` — btree(action)
  - `idx_audit_logs_created_at` — btree(created_at DESC)
  - `idx_audit_logs_created_at_brin` — BRIN(created_at) (cheap, good for large
    append-only date-range scans)
  - `idx_audit_logs_details_trgm` — GIN trigram on `details::text` (supports
    the free-text `search` query param's `ILIKE`)
  - `idx_audit_logs_resource` — btree(resource_type, resource_id)
  - `idx_audit_logs_user_id` — btree(user_id)

  **Can you query by actor, by target, and by date range without a seq scan?**
  Yes for actor (`idx_audit_logs_user_id`), yes for date range (both the btree
  DESC and the BRIN index), and yes for target **only when you already know
  the correct `resource_type`** (`idx_audit_logs_resource` is a composite on
  `(resource_type, resource_id)`, not `resource_id` alone) — which, per §4,
  fails for role/permission target lookups since `resource_id` there holds the
  affected *user's* id, not the role's id.

- **Retention/partitioning maintenance**: `ensure_audit_logs_partition(p_month
  date)` (baseline lines 275-316) is the only mechanism that pre-creates a
  month's partition (via `SPLIT PARTITION ... FOR VALUES FROM ... TO ...`,
  moving matching rows out of `audit_logs_default`). Its own comment (line 319)
  says: *"Pre-create months during maintenance because splitting takes
  exclusive locks and can move data."* Grep for any Rust caller:
  ```
  grep -rn "ensure_audit_logs_partition" src/ --include="*.rs"
  ```
  → **zero matches.** No cron, scheduled task, or `tokio::spawn` in `src/`
  calls this function (confirmed by listing every file containing
  `tokio::spawn|cron|scheduled` and finding none audit-related — the hits are
  `communications`, `night_audit`, `maintenance`, `housekeeping`, `payment_receipt_scheduler`,
  none of them touching `audit_logs` partitions). **Nothing in the running
  application ever pre-creates a monthly partition** — new rows outside any
  already-existing partition range simply accumulate in `audit_logs_default`
  indefinitely unless an operator manually runs the function.
- **No retention/deletion policy**: grepped `src/` and `database/postgres/` for
  `DELETE FROM audit_logs`, `TRUNCATE ... audit_logs`, `DROP TABLE ...
  audit_logs` (excluding the unrelated `pg18_4_to_v1.sql` upgrade-time
  index/legacy-table drops) — **zero matches**. The table grows forever with
  no automated pruning.
- **Append-only from the Rust side**: confirmed no `UPDATE audit_logs` or
  `UPDATE public.audit_logs` anywhere in `src/` or `database/postgres/` (grep,
  zero matches), and `AuditRepository` (repositories/audit.rs) defines no
  `update_*`/`delete_*` method. There is no explicit `REVOKE`/`GRANT` scoping
  DML on `audit_logs` to a restricted DB role (grep for
  `GRANT.*audit_logs`/`REVOKE.*audit_logs` in the baseline — zero matches), so
  append-only-ness here is an application-code convention, not a
  database-enforced guarantee — a future bug or a raw `sqlx::query` elsewhere
  in the codebase *could* mutate/delete rows and nothing at the DB layer would
  stop it.
- **Dead/stale artifact**: `services/audit.rs:705-725` defines a constant
  `AUDIT_LOGS_MIGRATION` (a plain, non-partitioned `CREATE TABLE IF NOT
  EXISTS audit_logs (...)` with different index names, e.g. `idx_audit_logs_user_id`
  without the partition-aware naming). Grep confirms **zero callers**
  (`grep -rn "AUDIT_LOGS_MIGRATION" src/` → only its own definition). It is
  dead code, and it actively misdescribes the real (partitioned) production
  schema — a maintainer reading it as "the" migration would be misled.

---

## 6. THE READ SURFACE — `routes/audit.rs`

All 7 routes (lines 22-31) are permission-gated via
`require_permission_helper(&pool, &headers, "audit:read")` — `get_audit_logs`,
`get_audit_actions`, `get_audit_resource_types`, `get_audit_users`,
`get_audit_category_counts`, `get_db_statements` — except
`export_audit_logs_csv`, which additionally requires `"audit:export"`
(routes/audit.rs:81) and captures the actor `user_id` from the permission
check (`let user_id = require_permission_helper(...)`) specifically so it can
write an audit row for the export itself.

- **Filterable**: yes — `AuditLogQuery` (models/audit.rs:9-23) supports
  `user_id`, `action`, `resource_type`, `category`, `start_date`, `end_date`,
  free-text `search`, pagination, and sort.
- **Exportable**: yes, CSV (`/audit-logs/export/csv`), and the export action
  itself **is** audited — `services/audit.rs:503-514` writes an
  `"audit_logs_exported"` event with the query parameters and row count as
  `details`, after the CSV has already been built.
- **Is reading itself audited?** **No** — `get_audit_logs` and the four other
  plain-read endpoints never call `AuditLog` (confirmed by reading
  `handlers/audit.rs` in full, 78 lines — the only `AuditLog`/audit_service
  interaction is the read functions themselves, not a logging call). Only the
  CSV export path produces its own audit row.

### BLOCKER: `audit:export` permission does not exist on a fresh V1 install

`database/postgres/data.sql:58` lists `('audit:export')` in the
`expected_system_permissions` temp table (the aspirational allowlist used by
the bootstrap-validation block), and line 1152 even builds a `missing_seed_count`
that would include `'permission:audit:export'` if the row is absent from the
real `permissions` table:
```sql
-- data.sql:1144-1162
SELECT COUNT(*) INTO missing_seed_count FROM (
    ...
    SELECT 'permission:' || expected.name AS seed_key
    FROM expected_system_permissions expected
    WHERE NOT EXISTS (SELECT 1 FROM permissions actual WHERE actual.name = expected.name)
    ...
) missing_seed_records;
```
**But `missing_seed_count` is declared (line 1091) and computed (1144-1162) and
then never checked** — grep of the whole file for the variable name:
```
grep -n "missing_seed_count" database/postgres/data.sql
```
returns only the declaration and the `SELECT ... INTO` — **there is no `IF
missing_seed_count > 0 THEN RAISE EXCEPTION` anywhere in data.sql.** The
bootstrap-validation transaction (which does correctly `RAISE EXCEPTION` for
`invalid_count`, `unknown_route_permission_count`, and
`unknown_route_role_count` — lines 1138-1141, 1176-1180, 1195-1199) silently
lets a *missing* system permission/role/setting/route-policy through.

The actual `INSERT INTO permissions` block never creates an `audit:export` row
(grep of `data.sql` for the literal string `audit` shows `audit:read` inserted
at line 498, but no matching insert for `audit:export`). Since `admin`/
`super_admin` acquire their permissions via
`SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name IN
('admin','super_admin')` (data.sql:534) — a cross join against *rows that
exist* — a permission that was never inserted cannot be granted to anyone,
including super_admin. Also confirmed no `audit:manage` permission exists
anywhere (the `<resource>:manage` implication in
`core/middleware.rs:44` cannot rescue this either, since there is no
`audit:manage` row to imply from).

**This is a genuine regression relative to upgraded databases**: the legacy
upgrade script `database/postgres/upgrade/pg18_4_to_v1.sql:350-363` *does*
insert `audit:export` and grant it to the `admin` role — but that script only
runs for databases that went through the pg18→V1 upgrade path, not for a fresh
V1 install via `0001_v1_baseline.sql` + `data.sql` + `seed.sql` (the documented
"one-time V1 initialization" procedure per CLAUDE.md). **Net effect: on any
brand-new deployment, `GET /audit-logs/export/csv` is permanently
`403 Forbidden` for every role, including super_admin — a shipped, permission-
gated feature that is unreachable by design on first install, and the exact
class of bug the bootstrap-validation transaction was built to catch but
doesn't, because the check it computes is never wired to a `RAISE EXCEPTION`.**

---

## Commands run this session (for reproducibility)

```
wc -l hotel-app-be/src/{services,repositories,models,handlers,routes}/audit.rs
grep -n "^pub fn\|^pub async fn" hotel-app-be/src/repositories/audit.rs
grep -rn "AuditLog::" hotel-app-be/src --include="*.rs" | grep -v services/audit.rs
grep -n "AuditLog\|audit" hotel-app-be/src/{handlers,repositories}/{auth,passkey,rbac,users,profile,two_factor}.rs
grep -c "let _ = AuditLog::" hotel-app-be/src/services/{auth,rbac,users,profile,two_factor,passkey}.rs
grep -n "audit_logs" hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql
grep -n "audit:export" hotel-app-be/database/postgres/{data.sql,seed.sql} hotel-app-be/database/postgres/upgrade/pg18_4_to_v1.sql
grep -n "missing_seed_count" hotel-app-be/database/postgres/data.sql
grep -rn "ensure_audit_logs_partition" hotel-app-be/src --include="*.rs"
grep -rn "DELETE FROM audit_logs\|UPDATE audit_logs\|TRUNCATE.*audit_logs" hotel-app-be/src hotel-app-be/database/postgres
grep -rn "AUDIT_LOGS_MIGRATION" hotel-app-be/src --include="*.rs"
```
