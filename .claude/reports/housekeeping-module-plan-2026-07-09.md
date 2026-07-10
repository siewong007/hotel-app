# Housekeeping Module — Implementation Plan (2026-07-09)

Status: DRAFT — not yet approved. Facts below verified in-session against the
working tree at commit 30e9560d (grep/read; line anchors may rot).

## Current state (verified)

- `housekeeping_tasks` table exists in `database/schema.sql:1299` (PG only) with
  rich columns (task_type, priority, status, assigned_to, scheduled_date,
  started_at, completed_at, notes, inspection_notes, items_used JSONB).
  **Zero reads/writes anywhere in src/ except data_transfer bulk export/import.**
- `maintenance_tickets` (schema.sql:1322) — same: orphaned, data_transfer only.
- **Neither table exists in `database/sqlite_migrations/`** → data_transfer
  export/import is broken at runtime in SQLite mode (pre-existing bug;
  services/data_transfer.rs:239-240 export both unconditionally).
- No `housekeeping:*` or `maintenance:*` permissions seeded anywhere.
  `room_status_transitions.requires_permission` values ('housekeeping',
  'maintenance:write', schema.sql:1260+) are **never read by any Rust code**.
- Only housekeeping action today: `services/rooms.rs:952
  update_room_status_handler`, guarded by generic `rooms:update`.
- FE: no feature module; only a Housekeeping section in RoomManagementPage's
  room context menu. SQLite seed has a 'housekeeping' role (001:584); PG
  data.sql does NOT seed that role (divergence). RBACManagementPage BUILTIN
  regex already anticipates a "housekeeping" role name.
- Vite proxy: all routes under `/api` — new endpoints need NO proxy change.

## Phase 0 — Schema parity + dead-table fix (prereq, small)

1. New `database/sqlite_migrations/015_housekeeping_maintenance.sql`:
   CREATE TABLE `housekeeping_tasks` + `maintenance_tickets` mirroring
   schema.sql:1299/1322 (SQLite types: INTEGER PRIMARY KEY AUTOINCREMENT,
   TEXT for JSONB/timestamps, follow existing 00x migration idioms).
   Column names MUST match PG exactly, column-by-column (lesson 2026-07-07).
2. Verify data_transfer export now succeeds on a scratch SQLite DB.
   (Coordinate with in-flight working-tree changes to data_transfer.*.)

## Phase 1 — Permissions + enforcement (small)

1. Seed in `database/data.sql` (both the role-grant list ~line 93-129 and the
   permissions catalog ~line 450, matching the `('night_audit:read', ...)` format):
   - `housekeeping:read`, `housekeeping:create`, `housekeeping:update`,
     `housekeeping:manage`
   - `maintenance:read`, `maintenance:write`, `maintenance:manage`
   - `navigation_housekeeping:read`
   Same seeds in the 015 sqlite migration. Idempotent inserts (ON CONFLICT /
   INSERT OR IGNORE per file conventions).
2. Enforce `room_status_transitions.requires_permission` in
   `update_room_status_handler`: after resolving target transition, if the
   matching transition row carries requires_permission, call
   `check_permission(pool, user_id, <value>)`; treat bare 'housekeeping' as
   'housekeeping:update'. Keep `rooms:update` as the base requirement
   (`rooms:manage` implies). NOTE: this tightens existing behavior — staff who
   only have `rooms:update` today would need the new permission for
   dirty/cleaning flips. Mitigate: grant housekeeping:* to the same roles that
   currently hold rooms:update in the seed.
3. OPEN QUESTION (user): seed a 'Housekeeping' role in PG data.sql to match
   SQLite's role id 4, or drop it from SQLite? Business decision.

## Phase 2 — Backend module (core)

New files, following the routes→handlers→service split (night_audit.rs is the
smallest template; rooms.rs the closest domain):

- `models/housekeeping.rs` — HousekeepingTask struct (explicit columns — never
  SELECT *), Create/Update inputs, list-filter query params.
- `repositories/housekeeping.rs` — SQL via `sql_query!`/`param!`/
  `current_timestamp()`; Decimal/JSON helpers from core/db.rs.
- `handlers/housekeeping.rs` + `routes/housekeeping.rs`, merged in
  `routes/mod.rs::create_router`.

Endpoints (all `require_auth` + `check_permission`):
| Method/Path | Perm | Behavior |
|---|---|---|
| GET /api/housekeeping/tasks | housekeeping:read | filter by status/room/assigned_to/date; paginated |
| POST /api/housekeeping/tasks | housekeeping:create | create task (validates room exists, sanitizes notes) |
| PATCH /api/housekeeping/tasks/:id | housekeeping:update | assign / start (stamps started_at) / complete (stamps completed_at) / void |
| GET /api/housekeeping/board | housekeeping:read | rooms grouped by status + their open task, for the FE board |

Rules:
- Task status machine: pending → in_progress → completed; void from
  pending/in_progress. Reject invalid jumps.
- Completing a `cleaning` task triggers the room transition dirty→available /
  reserved_dirty→reserved by REUSING the logic in services/rooms.rs
  update_room_status_handler (extract shared fn; do not duplicate the
  reserved_dirty/active-booking guards or trigger-bypass marker).
- Every mutation: `services/audit.rs` entry; free text through
  `Sanitizer`; transactions for task-complete + room-status pairs.
- add `housekeeping` to services/audit.rs:393's entity list if it's an
  allowlist (verify — anchor unverified for semantics).

## Phase 3 — Auto-queue on checkout (small, behavior decision)

Where checkout sets room → dirty (repositories/bookings/lifecycle.rs), insert a
pending `housekeeping_tasks` row (task_type 'checkout_clean', normal priority)
in the same transaction — idempotent per booking (skip if an open task exists
for the room).
OPEN QUESTION (user): always-on, or behind a system_settings toggle
(`housekeeping_auto_tasks`)? Recommend always-on; rows are cheap and the board
is useless without a feed.

## Phase 4 — Frontend

- `src/api/housekeeping.service.ts` — via `client.ts` ky instance only.
- `src/features/housekeeping/` — HousekeepingPage: task board (columns by
  status), filters (floor/assigned/priority), assign/start/complete actions,
  MUI components; types in `src/types/`.
- Routing (BOTH, per CLAUDE.md): `src/routes/housekeeping.tsx` + entry in
  `src/navigation/routeRegistry.tsx` (lazy), gated on
  `navigation_housekeeping:read`.
- Dates via `src/utils/date.ts` helpers (toISOString().split is lint-banned).
- No vite.config.ts change needed (endpoints live under /api).

## Out of scope (this plan)

- Maintenance-tickets module (Phase 0/1 create its table + perms; CRUD module
  is a separate follow-up).
- Mobile/housekeeper-app UX, supplies inventory (items_used stays free-form),
  scheduling/shift management.

## Verification gates (per rules/00-diagnosis + lessons)

1. Every column in new SQL confirmed against BOTH DDLs, column-by-column.
2. `cargo check --all-features` then `cargo clippy --all-features -- -D warnings`.
3. Smoke test on scratch SQLite: migrations auto-run, seed a room + session
   row, curl each new endpoint (lesson 2026-07-07 — compile does not catch
   column drift).
4. FE: `bun run typecheck && bun run lint && bun run test`.
5. Walk Leak #3 checklist item-by-item (route merged, auth, proxy n/a, ky
   client, routeRegistry+routes file, date helpers, audit+sanitizer).
6. Security-sensitive (RBAC + SQL) → per model-dispatch, implementation and/or
   review at opus tier; reviewer ≠ implementer.

## Suggested sequencing / delegation

- Phase 0+1 together (one PR-sized change; schema + seeds + enforcement).
- Phase 2 next (backend module), Phase 3 rides with it, Phase 4 last.
- Estimated: P0+1 small; P2 the bulk; P4 medium.
