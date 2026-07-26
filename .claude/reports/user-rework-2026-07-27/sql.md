# User-domain SQL correctness & bootstrap-integrity audit

Scope: PostgreSQL side of the user domain (users, rbac, audit, auth, two_factor,
passkey — pre-migration `src/{models,repositories,core}`). Every claim below cites
a `file:line` actually opened this session. Absence claims name the exact grep run.

Baseline files: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`
(9619 lines), `data.sql` (1224 lines), `seed.sql` (385 lines),
`database/postgres/patches/` (11 files).

---

## 1. DDL for the core user-domain tables

All quoted from `migrations/0001_v1_baseline.sql`.

### `users` (line 3468)
```
id bigint NOT NULL                         -- GENERATED ALWAYS AS IDENTITY, START WITH 1000 (3516-3523)
uuid uuid DEFAULT gen_uuidv7() NOT NULL
username varchar(100) NOT NULL             -- CHECK lower(username)=username; CHECK ^[a-z0-9][a-z0-9_-]{2,99}$
email varchar(255) NOT NULL                -- CHECK lower(email)=email; CHECK email regex
password_hash varchar(255)                 -- nullable (passkey-only accounts)
full_name varchar(255), phone varchar(20), avatar_url text
user_type usertype DEFAULT 'staff'
guest_id bigint
is_active/is_verified/is_locked/is_super_admin boolean DEFAULT true/false/false/false
email_verification_token varchar(255), email_token_expires_at timestamptz
two_factor_enabled boolean DEFAULT false
two_factor_secret varchar(255)
two_factor_recovery_codes text[]
failed_login_attempts integer DEFAULT 0
locked_until timestamptz, last_login_at timestamptz, last_login_ip inet
password_changed_at timestamptz DEFAULT CURRENT_TIMESTAMP
created_at timestamptz DEFAULT CURRENT_TIMESTAMP   -- NOT NULL constraint absent (see Finding 7)
created_by bigint, updated_at timestamptz DEFAULT CURRENT_TIMESTAMP, updated_by bigint
deleted_at timestamptz                      -- soft-delete marker
```
FKs (grepped `ADD CONSTRAINT.*users` at lines 9471, 9479): `users_created_by_fkey`,
`users_updated_by_fkey` → `users(id)`, **no `ON DELETE` clause** (defaults to
`NO ACTION`/RESTRICT).

### `roles` (4184) / `permissions` (3826)
```
roles: id, name varchar(50) [CHECK lower + regex ^[a-z][a-z0-9_]*$], display_name varchar(100) NOT NULL,
       description text, is_system_role boolean DEFAULT false, priority integer DEFAULT 0,
       created_at, updated_at timestamptz
permissions: id, name varchar(100) [CHECK lower + regex ^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$],
       resource varchar(50) NOT NULL, action varchar(20) NOT NULL, description text,
       is_system_permission boolean DEFAULT false, created_at timestamptz
       CONSTRAINT valid_action CHECK (action IN 25 named verbs, line 3835)
```

### `role_permissions` (4172) / `user_roles` (4785) / `user_permissions` (4864)
All three are pure join tables, no surrogate id:
```
role_permissions: role_id, permission_id, granted_at, granted_by
                  PK (role_id, permission_id)                      -- line 5819
user_roles:       user_id, role_id, assigned_at, assigned_by, expires_at
                  PK (user_id, role_id)                            -- line 6099
user_permissions: user_id, permission_id, assigned_at, assigned_by
                  PK (user_id, permission_id)                      -- line 6091
```
FKs all `ON DELETE CASCADE` off both sides (grepped lines 9103/9111, 9415/9423/9431,
9439/9447/9455).

### `audit_logs` (1147) / `audit_logs_default` (1172)
```
id bigint, user_id bigint, action varchar(100) NOT NULL, resource_type varchar(50) NOT NULL,
resource_id bigint, details jsonb, ip_address inet, user_agent text,
created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
PARTITION BY RANGE (created_at); PK (id, created_at) -- line 5067
```
FK: `audit_logs_user_id_fkey1 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL` (8071).

### `user_sessions` (4876) — note: unused by app code (see Finding 9 sibling note)
```
id bigint, session_id uuid DEFAULT gen_uuidv7(), user_id bigint NOT NULL,
ip_address inet, user_agent text, device_info jsonb,
started_at/last_activity_at timestamptz, expires_at timestamptz NOT NULL, is_active boolean
```
The actual session/refresh mechanism the app uses is a **different** table,
`refresh_tokens` (grepped `INSERT INTO refresh_tokens` at `core/auth.rs:287`) — the
`user_sessions` table defined here appears to be superseded schema. Not grepped
further (out of the four required repositories) — flagged for the implementation
phase to confirm before relying on either.

### `passkeys` (3710) / `passkey_challenges` (3694)
```
passkeys: id uuid, user_id bigint NOT NULL, credential_id bytea NOT NULL, public_key bytea NOT NULL,
          counter bigint DEFAULT 0, transports text[], device_type/device_name varchar,
          aaguid uuid, backup_eligible/backup_state boolean, created_at, last_used_at, is_active
passkey_challenges: id uuid, user_id bigint, challenge bytea NOT NULL,
          challenge_type varchar(20) CHECK IN ('registration','authentication'),
          expires_at timestamptz NOT NULL, created_at, used_at
```
Both `ON DELETE CASCADE` off `user_id` (8951, 8959).

### `two_factor_challenges` (4765)
```
user_id bigint NOT NULL, challenge_code varchar(255) NOT NULL, purpose varchar(50) NOT NULL,
expires_at timestamptz NOT NULL, created_at timestamptz DEFAULT CURRENT_TIMESTAMP
PK (user_id, purpose)                                    -- line 6043
FK user_id -> users(id) ON DELETE CASCADE                -- line 9383
```
This table (and the 2FA recovery-code bugs previously logged in
`.claude/rules/lessons.md` 2026-07-26p) is **confirmed fixed and still fixed** —
see Finding list below, "verified-fixed" note.

### `user_guests` (4824)
```
id bigint, user_id bigint NOT NULL, guest_id bigint NOT NULL,
relationship_type varchar(50) DEFAULT 'family', can_book_for/can_view_bookings/can_modify boolean,
notes text, linked_by bigint, created_at, updated_at
```
FKs: `user_guests_user_id_fkey`/`user_guests_guest_id_fkey` both `ON DELETE CASCADE`
(9407, 9391); `user_guests_linked_by_fkey` → `users(id)`, no `ON DELETE` (9399).

---

## 2. sqlx decode-type mismatches

Systematically compared every `#[derive(FromRow)]` / tuple `query_as` / `Row::get`
in `models/{user,rbac,audit,auth}.rs` and `repositories/{user,rbac,audit,auth}.rs`
(plus `core/auth.rs`, which is where most of the live 2FA/session/permission SQL
for this domain actually lives mid-migration) against the real column type.

### BLOCKER — `AuditLogRow.ip_address: Option<String>` decoded from a raw `inet` column, no cast
- `models/audit.rs:72` — `pub ip_address: Option<String>,`
- `repositories/audit.rs:112-113` (`list_logs`) and `repositories/audit.rs:198-199`
  (`list_logs_for_export`) — both `SELECT a.id, a.user_id, u.username, a.action,
  a.resource_type, a.resource_id, a.details, a.ip_address, a.user_agent,
  a.created_at` — **no `::text` cast** on `a.ip_address`.
- Column is `audit_logs.ip_address inet` (`migrations/…:1154`).
- `Cargo.toml:30` — `sqlx = {... features = ["runtime-tokio-rustls","postgres","macros","uuid","chrono","rust_decimal","json"] }`
  — **no `ipnetwork`/`ipnet` feature**.
- Verified against the vendored sqlx-postgres 0.8.6 source
  (`~/.cargo/registry/src/index.crates.io-*/sqlx-postgres-0.8.6/src/types/str.rs:14-24`):
  `impl Type<Postgres> for str { fn compatible: [TEXT, NAME, BPCHAR, VARCHAR, UNKNOWN, citext] }`
  — `INET` is not in that list, and `sqlx-postgres-0.8.6/src/types/mod.rs:88-110`
  documents `INET`/`CIDR` as requiring the `ipnetwork` or `ipnet` feature
  (`IpNetwork`/`IpAddr`), not a bare `String`.
- sqlx's `Row::try_get` only runs the `Type::compatible` check when the value is
  **non-null**; a null `ip_address` decodes fine, a non-null one raises
  `Error::ColumnDecode` ("mismatched types … not compatible with SQL type inet"),
  which aborts the whole `fetch_all` for that page.
- **Same codebase already knows the fix and uses it elsewhere**:
  `core/auth.rs:396` — `SELECT id::text AS id, user_agent, host(ip_address) AS
  ip_address, … FROM refresh_tokens` — casts via `host()` specifically so
  `ActiveSessionRecord.ip_address: Option<String>` (`core/auth.rs:37`) decodes
  safely. `audit.rs` simply omits the equivalent cast.
- **Reachable today, not hypothetical**: grepped every `AuditEvent { ip_address:
  Some(...) }` construction site (`grep -rn "ip_address: Some(" src/`) — the only
  two hits are `handlers/webhooks.rs:93` and `handlers/webhooks.rs:121`
  (`paypal_webhook_ignored` events, written on every PayPal webhook of an
  unhandled type or with an unparseable `custom_id`), added by the already-merged
  commit `214305432 feat: add audit event support to PayPal webhook handler`
  (see repo git log). The instant one such webhook fires, that row's `ip_address`
  is non-null, and:
  - `GET /api/audit-logs` (`routes/audit.rs:22`, unfiltered or any filter matching
    that row) 500s.
  - `GET /api/audit-logs/export/csv` (`routes/audit.rs:30`) 500s the same way, and
    `services/audit.rs:492` (`row.ip_address.unwrap_or_default()`) never runs
    because the row never decodes.
  - Every other `AuditEvent` in the repo (login success/failure at
    `services/auth.rs:37,42,56,99,116,130,198,248` — all pass `None, None`) leaves
    `ip_address` null today, so the admin Audit Log page's brokenness depends
    entirely on whether a PayPal webhook has fired since deploy — untested,
    unguarded by any test (`grep -rln "list_logs\|AuditRepository::list"
    hotel-app-be/tests/` → no hits).
- **Fix**: add `::text` to both SELECTs (`a.ip_address::text AS ip_address`),
  matching the `host()` pattern already used in `core/auth.rs:396`.

### Verified FIXED (do not re-flag) — 2FA `text[]` bind and missing table
Per `.claude/rules/lessons.md` 2026-07-26p, re-verified live in this session:
- `core/auth.rs:794-819` (`enable_2fa`) and `core/auth.rs:841-862`
  (`update_recovery_codes`) bind `Vec<String>` (`recovery_code_hashes`, from
  `recovery_codes_for_storage` at `core/auth.rs:655`) directly against
  `users.two_factor_recovery_codes text[]` — no `array_to_json` shim. Grepped
  `array_to_json\|json_to_array` across `src/core/auth.rs` — zero hits.
- `two_factor_challenges` exists in the baseline (§1 above) with the composite PK
  the code expects (`ON CONFLICT (user_id, purpose)` at `core/auth.rs:746`).
- `TwoFactorDisableRequest.code` validation is `max = 32`
  (`models/auth.rs:148`), wide enough for the 23-char dashed recovery-code format.

### Other structs checked, no mismatch found
- `User` (`models/user.rs:10-27`): `id i64`↔bigint, `two_factor_recovery_codes:
  Option<Vec<String>>`↔`text[]` (correct, unlike the audit case — no cast needed
  since `Vec<String>` **is** in sqlx's compatible-type list for `TEXT[]`),
  `user_type: Option<UserType>` — enum mapping not verified against the
  `usertype` Postgres enum in this pass (would need `core/constants.rs`, out of
  the 4-file scope; flag as unverified).
- `Role` (`models/rbac.rs:11-16`) intentionally has only 4 of the table's 8
  columns (`id, name, description, created_at`) — every query that builds a
  `Role` explicitly lists exactly those 4 columns (`repositories/rbac.rs:64-69,
  78-79, 88-90, 105-110, 224-231, 531-537`), so there is no decode mismatch, but
  see Finding 6 (display_name is permanently orphaned by this design).
- `Permission` (`models/rbac.rs:26-34`): same pattern, 6 explicit columns,
  matches every query (`repositories/rbac.rs:122-127, 139-146, 246-251,
  484-492, 597-603`).
- `RouteAccessPolicyRow` (`repositories/rbac.rs:14-27`) decodes the six jsonb
  array columns as `String` — verified safe because both queries explicitly
  `::text`-cast them (`repositories/rbac.rs:282-287, 332-337`), unlike the
  audit_logs case.
- `Passkey`/`PasskeyInfoRow` (`models/auth.rs:209-239`): `counter: i64`↔bigint,
  `credential_id/public_key: Vec<u8>`↔bytea — correct. (`PasskeyInfo.credential_id:
  String` is never used as a `FromRow` target against SQL — only against
  `PasskeyInfoRow` after re-encoding in `services/passkey.rs:26` — confirmed via
  `grep -rn "PasskeyInfo\b" src/`.)
- `AuthRepository::login_lock_state`/`two_factor_state`
  (`repositories/auth.rs:63-74, 129-138`): tuple decode
  `(Option<bool>, Option<DateTime<Utc>>, Option<i32>)` / `(Option<bool>,
  Option<String>)` matches `is_locked boolean, locked_until timestamptz,
  failed_login_attempts integer` / `two_factor_enabled boolean, two_factor_secret
  varchar` exactly.

---

## 3. Placeholder / bind-count audit

Manually walked every raw SQL string in `repositories/{user,rbac,audit,auth}.rs`
(an automated `$N`-vs-`.bind()` heuristic script was tried first but produced
false positives on queries built through an intermediate `let query = …` variable
or through the `build_*_where_clause`/`bind_*_filters` dynamic-SQL pair — those
needed manual reading instead).

**No live placeholder/bind mismatch found** in any of the four files. Specific
things checked and confirmed consistent:
- `repositories/rbac.rs:301-358` (`update_route_access_policy`): 10 named `$N`
  placeholders (`$1`..`$10`), 10 `.bind()` calls in the same order.
- `repositories/audit.rs:89-171` (`list_logs`): `count_query`/`data_query` are
  built with a shared `bind_index` counter from `build_log_where_clause`
  (line 294-352); the **hand-written** bind sequence for `count_sqlx`
  (lines 128-150) and the **helper-driven** bind sequence for `data_sqlx` via
  `bind_log_filters` (line 157-161, helper at 382-412) are two independently
  written copies of the same seven-branch order (user_id, action, resource_type,
  start_date, end_date, search, category_types) — currently identical, but see
  Finding 5b (duplication risk, not a live bug).
- `repositories/user.rs:227-243, 247-294` use the `param!()` macro
  (`param!(1)`..`param!(5)`) instead of literal `$N` — each call site's bind
  count matches its `param!` count exactly (2-for-2, 5-for-5).

---

## 4. Missing tables / functions referenced by user-domain SQL

Grepped every bare table/function name found in the four repository files plus
`core/auth.rs` and `core/rbac_cache.rs` against `CREATE TABLE`/`CREATE FUNCTION`
in the baseline. All resolved:

| Referenced (file:line) | Exists as | Baseline line |
|---|---|---|
| `two_factor_challenges` (`core/auth.rs:744,777`) | `CREATE TABLE` | 4765 |
| `refresh_tokens` (`core/auth.rs:287,313,343,399`) | `CREATE TABLE` (not opened this pass — outside the 4 required files, but existence confirmed via successful `grep -n "CREATE TABLE public.refresh_tokens"` ) | — |
| `pg_stat_statements` (`repositories/audit.rs:271`) | Postgres extension view, not app-owned — not applicable to the missing-table class | — |
| `route_access_policies` (`repositories/rbac.rs:289,314`) | `CREATE TABLE` | 4466 |
| `user_roles`, `role_permissions`, `permissions`, `roles`, `users` | all present | §1 |

No orphaned-reference class of bug (the `room_events`/`sync_all_room_statuses`
class from `lessons.md` 2026-07-10b/2026-07-26) found in this domain's four files.

**Inverse finding** — a table with full DDL but **zero SQL referencing it**:
`user_permissions` (baseline line 4864, PK + 2 `ON DELETE CASCADE` FKs + an index
at line 7566) is never selected from, inserted into, updated, or deleted anywhere
in `src/` — `grep -rn "FROM user_permissions\|INTO user_permissions\|UPDATE
user_permissions" src/` (excluding the unrelated function name
`get_user_permissions`) returns zero hits. See Finding 9.

---

## 5. Bootstrap integrity — the self-validating `data.sql` transaction

`data.sql` runs exactly once per fresh V1 database (guarded by a
`hotel_schema_revisions` check at lines 16-27, inside one `BEGIN…COMMIT`,
lines 11/1224). It cross-checks four "expected_*" temp tables against the real
tables at the end, in a single `DO $$ … $$` block (lines 1087-1222):

| Check | Computed | Enforced? |
|---|---|---|
| Invalid system-owned records (regex/priority/jsonb-shape) | `invalid_count` (1096-1136) | **Yes** — `RAISE EXCEPTION` at 1138-1142 |
| Missing seed rows (`expected_system_roles`, `expected_system_permissions`, `expected_system_settings`, `expected_route_access_policies` vs actual) | `missing_seed_count` (1144-1162) | **NO — see Finding 2, dead check** |
| Route policy → permission references unknown | `unknown_route_permission_count` (1168-1174) | **Yes** — 1176-1180 |
| Route policy → role references unknown | `unknown_route_role_count` (1182-1193) | **Yes** — 1195-1199 |
| Obsolete-but-assigned system roles | `obsolete_assigned_role_count` (1201-1214) | Intentionally only `RAISE NOTICE` (1216-1220), not an error — by design, per the comment at 947-948 (quarantine-and-keep policy) |

**The action-verb allowlist is duplicated 4 times**, not the ~5 the older
`lessons.md` 2026-07-15 entry describes (that count predates the 2026-07-26c
baseline rewrite to a single pg_dump-style file — re-verified here, the older
"3 idempotent ALTER…ADD CONSTRAINT re-assertions in schema.sql" no longer exist;
`grep -n "valid_action" migrations/0001_v1_baseline.sql` → exactly one hit):
1. `permissions_valid_action` CHECK constraint, baseline line 3835.
2. `data.sql:314-320` (quarantine CASE expression, "Invalid action" reason).
3. `data.sql:331-337` (quarantine WHERE clause, same list).
4. `data.sql:1114-1120` (final DO-block validation, same list).
All four currently list the same 25 verbs (verified by direct comparison of the
four literal lists). They are **plain text duplicates with no single source of
truth** — a future edit to one and not the others either (a) makes the CHECK
constraint reject a value the bootstrap validation would have accepted (data.sql
fails on `INSERT`, not on the final DO block), or (b) makes the bootstrap
validation reject/quarantine a value the CHECK constraint allowed (silent
quarantine of a legitimately-seeded permission on the very install that seeded
it).

### Checklist: what a rework must touch to add one permission / one new action verb / one nav route

**To add a permission using an existing action verb** (e.g. `teams:read`):
1. Add the actual `INSERT INTO permissions (...)` row (in `data.sql`'s permission
   seed block, or a dated `patches/` file for existing DBs).
2. Add the name to `expected_system_permissions` (`data.sql:51-185`) — nominally
   required for the missing-seed check, though today that check is dead
   (Finding 2), so this step currently has **no enforcement** if skipped; still
   required for a semantically correct install.
3. `INSERT INTO role_permissions` for every role that should hold it.
4. If it gates a nav route, add it to that route's `required_permissions`/
   `nav_permissions` jsonb arrays in `route_access_policies` — **this IS
   enforced**: `unknown_route_permission_count` (data.sql:1168-1180) raises if a
   route references a permission name that doesn't exist, but does **not** raise
   if a permission exists but no route references it.
5. Ship a dated `database/postgres/patches/YYYY-MM-DD-*.sql` for already-deployed
   databases (`data.sql` never re-runs against an existing V1 DB — line 16-27).
6. Mirror steps 1-5 into `hotel-desktop/src-tauri/database/postgres/` — verified
   this session that `data.sql`/`seed.sql`/the baseline are currently
   byte-identical mirrors (`diff` empty), but **11 of 11 patch files in
   `hotel-app-be/database/postgres/patches/` are absent from
   `hotel-desktop/src-tauri/database/postgres/patches/`** — see Finding 4.

**To add a brand-new action verb** (not in the current 25): update all 4 places
in the table above, in the same commit, in this order: baseline CHECK
constraint first (so a fresh install's `INSERT` succeeds), then all 3 `data.sql`
copies (so the same install's validation doesn't immediately quarantine what it
just inserted).

**To add a nav route**: insert into `route_access_policies` (`ON CONFLICT
(route_id) DO UPDATE`, pattern at `data.sql:1021-1038` or `1047-1085`) **and**
add its `route_id` to `expected_route_access_policies`
(`data.sql:237-268`) — again, the "did you forget the expected-list entry" gap
is only silently absorbed because of Finding 2, not because it's by design.

---

## 6. Indices, N+1, and `check_permission` query count

### Indices present (grepped `CREATE INDEX` for every user-domain table)
`users`: partial indices on `username`, `email`, `is_active`
(all `WHERE deleted_at IS NULL`), `guest_id`, `user_type`, plus a trigram GIN on
`username` (baseline lines 7601-7636) — matches every `WHERE ... AND deleted_at
IS NULL` predicate used in `repositories/user.rs` (lines 24, 39, 50, 60, 80, 159,
194, 218).
`role_permissions`: PK `(role_id, permission_id)` (5819) + standalone indices on
both `role_id` (7321) and `permission_id` (7314).
`user_roles`: PK `(user_id, role_id)` (6099) + standalone indices on both
`user_id` (7580) and `role_id` (7573).
`user_permissions`: PK `(user_id, permission_id)` (6091) + standalone index on
`user_id` only (7566) — moot, see Finding 9 (table is unused).
`audit_logs`: `action`, `created_at` (btree + brin), `details` (gin trgm),
`(resource_type, resource_id)`, `user_id` (6201-6278) — declared `ON ONLY` on the
partitioned parent, which Postgres auto-propagates to every partition created
via `CREATE TABLE … PARTITION OF` (`ensure_audit_logs_partition`, baseline
line 275-312) — not a gap.

**Redundant indices (Finding 8, low severity)**: `idx_user_roles_user_id`
(7580) and `idx_role_permissions_role_id` (7321) each duplicate the leading
column of their table's own PK-backed index (`user_roles_pkey (user_id,
role_id)`, `role_permissions_pkey (role_id, permission_id)`) — a btree PK index
already serves `WHERE user_id = $1` / `WHERE role_id = $1` efficiently without
the extra single-column index. Pure write/storage overhead, zero read benefit.
(`idx_user_roles_role_id` and `idx_role_permissions_permission_id` are **not**
redundant — they serve the reverse-direction lookups the PK's column order can't.)

### N+1
- `services/users.rs:22-28` (`users()`, backs the admin Users list) calls
  `UserRepository::list_all` once and returns roles/permissions as empty
  vectors — no N+1, because it doesn't join roles at all for that endpoint.
- `models/rbac.rs:87-94` (`RbacSnapshot`) is explicitly documented and built to
  avoid N+1 for the RBAC admin UI: `find_all_roles` + `find_all_permissions` +
  `role_permission_assignments` + `user_role_assignments` are each a single
  bulk query (`repositories/rbac.rs:64, 122, 265, 361`), joined client-side.
- No loop calling `check_permission`/`get_user_roles`/`get_user_permissions`
  per-row was found in the four files.

### Is `check_permission` one query or many?
`core/middleware.rs:30-59` → `AuthService::check_permission`
(`core/auth.rs:489-495`) → `rbac_cache::has_permission`
(`core/rbac_cache.rs:122-132`) → `resolve()` (`core/rbac_cache.rs:84-119`).
- **Cache hit** (default TTL 30s, `core/rbac_cache.rs:30-34`): **zero** SQL
  queries — two in-memory `HashSet::contains` calls.
- **Cache miss**: exactly **two** SQL queries per user (the DISTINCT permission-name
  join, `rbac_cache.rs:90-101`, and the role-name join, `rbac_cache.rs:103-113`),
  cached together and shared by every subsequent permission/role check for that
  user until the TTL or `invalidate_all()`/`invalidate_user()` fires.
- **Finding 5a (medium, maintainability)**: `middleware::check_permission`
  (`core/middleware.rs:30-59`) calls `AuthService::check_permission` up to
  **twice** — once for the literal permission, once for `<resource>:manage` if
  the first returns false (lines 43-53). This is dead-weight: `rbac_cache::
  has_permission` (`core/rbac_cache.rs:122-131`) **already** computes and checks
  `<resource>:manage` internally on the first call (`let manage = permission
  .split_once(':')…`). The middleware's second call can never succeed when the
  first one didn't, because both read the same cached HashSet with the same
  derivation logic — implemented independently in two places
  (`core/middleware.rs:43-53` and `core/rbac_cache.rs:127-131`), risking silent
  divergence if one is edited without the other.

---

## 7. Referential integrity on delete

**User deletion is soft-delete only** — confirmed no hard delete path exists
anywhere: `grep -rn "DELETE FROM users\|DELETE FROM public.users"
hotel-app-be/src hotel-app-be/database hotel-app-be/scripts` → zero hits.
`services/users.rs:171-210` (`delete_user`) calls
`AuthService::revoke_all_user_tokens` first (so a compromised session can't be
used mid-retry), then `UserRepository::soft_delete`
(`repositories/user.rs:176-207`), which in one transaction:
1. `DELETE FROM user_roles WHERE user_id = $1` (182-186) — hard-deletes the
   role memberships (not soft).
2. `UPDATE users SET is_active=false, deleted_at=CURRENT_TIMESTAMP,
   updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND deleted_at IS NULL` (188-200).
Then (outside the transaction, best-effort) `services/users.rs:195-206` writes
a `user_deleted` audit event via `let _ = AuditLog::log_event(...)` — errors
swallowed, but since it runs after the transaction commits, a failure here
cannot poison an in-flight transaction (contrast with the `room_events` class
of bug in `lessons.md` 2026-07-10b, which does not apply here).

**If a hard delete were ever added**, the FK graph would immediately block it in
most cases:
- `audit_logs.user_id` → `ON DELETE SET NULL` (8071) — audit rows survive,
  losing the actor's identity (acceptable/intentional for an audit trail).
- `user_roles`, `user_permissions`, `passkeys`, `passkey_challenges`,
  `two_factor_challenges`, `user_guests`, `user_sessions`, `refresh_tokens`
  (confirmed via `role_permissions_role_id_fkey`-style grep sweep, §1) all
  `ON DELETE CASCADE` — clean.
- `users.created_by`/`updated_by` (self-referential, 9471/9479) and every
  business table's actor columns (`bookings.created_by`, `payments.created_by`,
  `guests.created_by`, `invoices.created_by`, `customer_ledgers.*_by`, etc. —
  dozens, grepped in the full FK sweep) have **no `ON DELETE` clause**, i.e.
  default `RESTRICT`/`NO ACTION`: a hard delete of any user who ever created a
  booking, payment, guest, or ledger row would fail outright with a FK
  violation. Since no code path attempts this today, it's a design note for
  the rework rather than a live bug — but it means "hard delete a user" is not
  just unimplemented, it is **structurally blocked** by the current FK graph
  and would need an explicit soft-delete-forever or anonymize-on-delete design
  if ever requested.

---

## Findings (ranked, most severe first)

1. **BLOCKER** — `audit_logs.ip_address` (`inet`) decoded into `Option<String>`
   with no cast in `repositories/audit.rs:112-113,198-199` /
   `models/audit.rs:72`; live once any PayPal webhook audit event fires
   (`handlers/webhooks.rs:93,121`) — breaks `GET /api/audit-logs` and
   `/api/audit-logs/export/csv` entirely for any query touching that row.
2. **HIGH** — `data.sql`'s bootstrap self-validation computes
   `missing_seed_count` (line 1091, 1144-1162) but never checks it — the
   "did we actually seed everything we declared expected" guard is dead code,
   unlike its three sibling checks which all `RAISE EXCEPTION`.
3. **HIGH** — `user_roles.expires_at` (baseline line 4790, meant for temporary
   role assignments) is never read by any permission/role query in
   `core/rbac_cache.rs:90-113`, `core/auth.rs:450-484`,
   `repositories/rbac.rs:223-237,480-498`, or `repositories/user.rs:417-451` —
   a temporary role grant, if the column is ever populated by a future feature
   or a manual edit, would never actually expire.
4. **MEDIUM** — `hotel-desktop/src-tauri/database/postgres/patches/` is missing
   all 11 files present in `hotel-app-be/database/postgres/patches/` (verified
   `diff -rq`), reproducing the exact class of gap `lessons.md` 2026-07-26j
   already hit once for a smaller patch set.
5. **MEDIUM** — the `<resource>:manage`-implies-all derivation is implemented
   independently in `core/middleware.rs:43-53` and `core/rbac_cache.rs:127-131`;
   the middleware copy is dead weight (can never succeed where the cache's own
   check didn't) and the duplication risks silent divergence.
6. **MEDIUM** — `roles.display_name` can only ever be set once, at creation
   (`repositories/rbac.rs:104` derives it from `name`); `update_role`
   (`repositories/rbac.rs:525-545`) never updates `display_name`, so renaming a
   role leaves its display name permanently stale/inconsistent with the new name.
7. **MEDIUM** — `user_permissions` table (direct per-user permission grants,
   full PK/FK/index machinery) has zero application code referencing it
   anywhere in `src/` — a modeled-but-unimplemented feature.
8. **LOW** — `users.created_at`/`updated_at` are nullable in the DDL (DEFAULT
   only, no `NOT NULL`, baseline lines 3493/3495) but `User`/`UserProfile`
   (`models/user.rs:25-26,111-112`) decode them as non-`Option<DateTime<Utc>>` —
   safe under every current app write path, but unenforced by the schema.
9. **LOW** — three redundant single-column indices duplicate their table's own
   PK-leading column: `idx_user_roles_user_id` (7580), `idx_role_permissions_role_id`
   (7321), and `idx_user_permissions_user_id` (7566, doubly moot per Finding 7).
10. **LOW** — `UserRepository::get_roles`/`get_permissions`/`has_permission`
    (`repositories/user.rs:417-475`) are dead code — zero callers anywhere in
    `src/` or `tests/` — and duplicate logic that lives (and is actually used,
    cached) in `core/rbac_cache.rs`.
11. **NIT** — `repositories/rbac.rs:534` uses `NOW()` directly in
    `UPDATE roles … SET updated_at = NOW()`, violating the repo's own
    documented convention (CLAUDE.md Leak #2 / `core/sql_compat.rs:10-17`
    still exists and defines `current_timestamp()`) — functionally harmless
    under Postgres-only operation, but a style/consistency violation.
