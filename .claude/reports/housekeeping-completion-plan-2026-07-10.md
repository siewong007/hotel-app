# Housekeeping Module Completion Plan — 2026-07-10

Authored by an opus Plan agent; saved by the commander (plan agents are read-only).

## 1. Verified current state (gaps a–e)

- **(a) maintenance_tickets — CONFIRMED gap.** Tables exist in both schemas: `database/schema.sql:1322` (Postgres) and `sqlite_migrations/015_housekeeping_maintenance.sql:24` (SQLite), identical columns. Permissions `maintenance:read/write/manage` seeded in both (`schema.sql:4982-4984`, `data.sql:468-470`, `015_...sql:60-62`). **No** `models/repositories/handlers/routes/services/maintenance.rs`. **No** FE maintenance types/service/hooks/UI.
- **(b) No tests — CONFIRMED gap.** BE `tests/` has no housekeeping/maintenance file. FE has no maintenance/housekeeping `*.test.ts`.
- **(c) Checkout → auto cleaning task — REFUTED (already wired).** `repositories/bookings/lifecycle.rs:2263-2277` calls `services::housekeeping::ensure_checkout_cleaning_task_for_room(&pool, new_room_id, user_id)` on checkout, best-effort with `log::warn!` on failure. Dedup guard via `has_open_task_tx`. No work needed.
- **(d) Audit + sanitization — REFUTED (already present).** `services/housekeeping.rs`: `create_task` sanitizes notes/inspection_notes via `Sanitizer::sanitize_notes` (`:25-29,148-149`), audits via `AuditLog::log_event` (`:167`); `update_task` sanitizes (`:96-97`) and audits both branches (`:219,244`). No work needed.
- **(e) FE board actions — PARTIAL.** `HousekeepingPage.tsx` supports inline per-room task create (`:157-187`) and status transitions (`:118-155`). Missing: maintenance visibility only.

## 2. Decisions

1. **Scope** = maintenance-tickets full CRUD (BE + FE tab) + BE & FE tests. Gaps c/d already done — do NOT re-touch. No scheduling/reporting/mobile.
2. **API surface** = `GET /maintenance` (filters), `GET /maintenance/{id}`, `POST /maintenance`, `PATCH /maintenance/{id}`. No delete (tickets terminate at `closed`). `ticket_number` = server-generated `MT-YYYYMM-NNNN`, monotonic per month, mirroring `services/invoice_numbers.rs`. Value sets from DDL CHECKs: priority `{low,medium,high,critical}` (default medium), status `{open,in_progress,on_hold,resolved,closed}` (default open); category has NO CHECK → `{electrical,plumbing,hvac,furniture,appliance,structural,other}` (default other).
3. **FE** = MUI Tabs (Board | Maintenance) inside `HousekeepingPage.tsx`; Board unchanged; no new TanStack route; no vite proxy change (single `/api` prefix already proxied).
4. **Permissions**: GETs → `maintenance:read`; POST/PATCH → `maintenance:write`; `maintenance:manage` unused. NOTE: resource uses `write`, NOT `create`/`update` (unlike housekeeping).
5. **Tests**: BE `hotel-app-be/tests/maintenance_tickets.rs` (sqlite-gated, `common::setup_test_db`); FE `hotel-web-fe/src/api/maintenance.service.test.ts` (mirror `bookings.service.test.ts`).

## 3. Work packages

### WP-1 — BE maintenance model + repository (data layer)
**Files (new):** `hotel-app-be/src/models/maintenance.rs`, `hotel-app-be/src/repositories/maintenance.rs`. **Files (edit):** `models/mod.rs` (add `pub mod maintenance;` + `pub use maintenance::*;`), `repositories/mod.rs` (add `pub mod maintenance;`).

**Model** (`models/maintenance.rs`) — serde structs, exact snake_case field names (must match FE):
- `MaintenanceTicket { id:i64, room_id:Option<i64>, room_number:Option<String>, ticket_number:String, title:String, description:Option<String>, category:String, priority:String, status:String, assigned_to:Option<i64>, assigned_to_name:Option<String>, reported_by:Option<i64>, estimated_cost:Option<Decimal>, actual_cost:Option<Decimal>, estimated_hours:Option<Decimal>, actual_hours:Option<Decimal>, scheduled_date:Option<DateTime<Utc>>, started_at:Option<DateTime<Utc>>, resolved_at:Option<DateTime<Utc>>, resolution_notes:Option<String>, images:Option<serde_json::Value>, created_at:DateTime<Utc>, updated_at:DateTime<Utc> }` — derive Serialize,Deserialize,Debug,Clone; `rust_decimal::Decimal` as elsewhere in codebase.
- `CreateMaintenanceTicketRequest { room_id:Option<i64>, title:String, description:Option<String>, category:Option<String>, priority:Option<String>, assigned_to:Option<i64>, estimated_cost:Option<Decimal>, estimated_hours:Option<Decimal>, scheduled_date:Option<DateTime<Utc>>, images:Option<Value> }` (Deserialize).
- `UpdateMaintenanceTicketRequest { title:Option<String>, description:Option<String>, category:Option<String>, priority:Option<String>, status:Option<String>, assigned_to:Option<i64>, estimated_cost:Option<Decimal>, actual_cost:Option<Decimal>, estimated_hours:Option<Decimal>, actual_hours:Option<Decimal>, scheduled_date:Option<DateTime<Utc>>, resolution_notes:Option<String>, images:Option<Value> }` (Deserialize).
- `ListMaintenanceTicketsQuery { status:Option<String>, room_id:Option<i64>, assigned_to:Option<i64>, category:Option<String>, priority:Option<String>, page:Option<i64>, page_size:Option<i64> }` (Deserialize).
- `MaintenanceTicketListResponse { items:Vec<MaintenanceTicket>, total:i64, page:i64, page_size:i64 }` (Serialize).
- `MaintenanceTicketPatch { ... }` — internal struct mirroring Update fields (Clone), used by repo.

**Repository** (`repositories/maintenance.rs`) — follow `repositories/housekeeping.rs` conventions EXACTLY:
- `const TICKET_SELECT` joining `maintenance_tickets t LEFT JOIN rooms r ON r.id=t.room_id LEFT JOIN users u ON u.id=t.assigned_to`, selecting `r.room_number`, `u.full_name AS assigned_to_name`, all `t.*` columns (LEFT JOIN rooms because room_id nullable).
- `fn row_to_ticket(row) -> MaintenanceTicket`: `row.try_get(...).ok()` for nullables; decimals via `crate::models::row_mappers::get_opt_decimal`; `images` via dual-cfg pattern as `items_from_row` in `housekeeping.rs:50-66` (sqlite: Option<String> + serde_json::from_str; postgres: Option<Value>).
- `pub(crate) async fn next_ticket_number<'e,E: sqlx::Executor<'e,Database=DbDatabase>>(executor:E) -> Result<String,ApiError>`: `prefix=format!("MT-{}-", Local::now().format("%Y%m"))`, pattern `{prefix}%`; max suffix — SQLite `SELECT MAX(CAST(SUBSTR(ticket_number,11) AS INTEGER)) ... WHERE ticket_number LIKE ?1`, Postgres `SELECT MAX(CAST(SUBSTRING(ticket_number FROM 11) AS BIGINT)) ... LIKE $1` (suffix starts at char 11: "MT-YYYYMM-" is 10 chars); `format!("{}{:04}", prefix, max.unwrap_or(0)+1)`. Mirror `repositories/invoice_numbers.rs::max_invoice_sequence`.
- `find_ticket(pool,id) -> Option<MaintenanceTicket>` (`WHERE t.id = {}` with `crate::param!(1)`, like `housekeeping.rs:119`).
- `list_tickets(pool, status, room_id, assigned_to, category, priority, page_size, offset) -> (i64, Vec<MaintenanceTicket>)`: dual `sql_query!` WHERE with 5 nullable filters + LIMIT/OFFSET `param!(6)`/`param!(7)`; Postgres casts `$1::text,$2::bigint,$3::bigint,$4::text,$5::text` like `housekeeping.rs:140-184`. `ORDER BY t.created_at DESC`.
- `insert_ticket(pool, ticket_number, req, reported_by) -> MaintenanceTicket`: INSERT `(room_id, ticket_number, title, description, category, priority, assigned_to, reported_by, estimated_cost, estimated_hours, scheduled_date, images)` with `param!(1..12)`; decimals via `opt_decimal_to_db`; images via sqlite `.map(|v| v.to_string())` / postgres passthrough cfg (`housekeeping.rs:209-215`); `RETURNING id`; then `find_ticket`.
- `patch_ticket(pool, id, patch) -> MaintenanceTicket`: `UPDATE ... SET col=COALESCE(param, col)` per field; plus `started_at = CASE WHEN <status param>='in_progress' AND started_at IS NULL THEN <ts> ELSE started_at END`, `resolved_at = CASE WHEN <status param> IN ('resolved','closed') AND resolved_at IS NULL THEN <ts> ELSE resolved_at END`, `updated_at=<ts>` — `<ts>` = `CURRENT_TIMESTAMP` (pg) / `datetime('now')` (sqlite), like `housekeeping.rs:236-296`; then `find_ticket`.

**SQL:** every placeholder via `crate::param!(n)` / `sql_query!`; NO `NOW()`, no literal `$1`/`?1`; decimals via `opt_decimal_to_db` + `get_opt_decimal`. **NO schema file changes.**
**Acceptance:** `cargo check --features sqlite --no-default-features`, `cargo check --all-features`, `cargo clippy --all-features -- -D warnings` all exit 0.
**DO-NOT:** no schema/migration edits; no delete fn; no whole-file reads >400 lines.

### WP-2 — BE maintenance service + handlers + routes (API layer)
**Files (new):** `services/maintenance.rs`, `handlers/maintenance.rs`, `routes/maintenance.rs`. **Files (edit):** `services/mod.rs`, `handlers/mod.rs`, `routes/mod.rs` (`pub mod maintenance;` each; `.merge(maintenance::routes())` in `create_router` ~line 130).

**Service** — mirror `services/housekeeping.rs`:
- `VALID_PRIORITIES=["low","medium","high","critical"]`, `VALID_STATUSES=["open","in_progress","on_hold","resolved","closed"]`, `VALID_CATEGORIES=["electrical","plumbing","hvac","furniture","appliance","structural","other"]`.
- `list_tickets(pool, params)`: validate status/category/priority filters (BadRequest otherwise); `normalize_pagination(params.page, params.page_size, 50, 200)`; repo; `MaintenanceTicketListResponse`.
- `get_ticket(pool,id)`: `find_ticket` → NotFound if none.
- `create_ticket(pool,user_id,req)`: room_id → validate via `repositories::housekeeping::room_exists` (reuse); defaults category=other, priority=medium; validate; sanitize title via `Sanitizer::sanitize_text`, description/resolution_notes via `Sanitizer::sanitize_notes`; `next_ticket_number`; `insert_ticket`; `AuditLog::log_event(pool, Some(user_id), "maintenance_ticket_created", "maintenance", Some(ticket.id), Some(json!({...})), None, None)` fire-and-forget.
- `update_ticket(pool,user_id,id,req)`: load existing (NotFound); validate enums; status transitions via `validate_status_transition`: `open→in_progress|on_hold|closed`, `in_progress→on_hold|resolved|closed`, `on_hold→in_progress|closed`, `resolved→closed|in_progress`, `x→x` no-op; sanitize free-text; patch; audit `"maintenance_ticket_updated"` with previous_status/status.

**Handlers** — thin, mirror `handlers/housekeeping.rs`. **Routes** — mirror `routes/housekeeping.rs` with `require_permission_helper`:
- `GET /maintenance` → `maintenance:read`; `GET /maintenance/{id}` → `maintenance:read`; `POST /maintenance` → `maintenance:write`; `PATCH /maintenance/{id}` → `maintenance:write`.

**Acceptance:** `cargo check --all-features` + clippy `-D warnings` exit 0; `grep -n "maintenance::routes" src/routes/mod.rs` shows the merge.
**DO-NOT:** no `maintenance:create`/`:update` permission strings; no skipped sanitization/audit; no vite change.

### WP-3 — FE maintenance types + service + hooks + queryKeys
**Files (new):** `src/types/maintenance.types.ts`, `src/api/maintenance.service.ts`, `src/features/housekeeping/hooks/useMaintenanceQueries.ts`. **Files (edit):** `src/api/queryKeys.ts` (add `maintenance` block mirroring `housekeeping` at `:66-70`: `all`, `list(params?)`, `detail(id)`).

- **types**: `MaintenancePriority`, `MaintenanceStatus`, `MaintenanceCategory` unions per §2.2; `MaintenanceTicket` with exact snake_case fields from WP-1 (money/hours as `number`, `images?:unknown`); request/query/list-response types mirroring `housekeeping.types.ts`.
- **service**: class `MaintenanceService` using `api` from `./client` (NEVER fetch): `listTickets(params={})` → `api.get('maintenance',{searchParams:...})`; `getTicket(id)`; `createTicket(input)` → post; `updateTicket(id,input)` → patch. Export like `housekeeping.service.ts`; register in `src/api/index.ts`.
- **hooks**: `useMaintenanceTickets(params, enabled)`, `useMaintenanceTicket(id)`, `useCreateMaintenanceTicket()`, `useUpdateMaintenanceTicket()` — mirror `useHousekeepingQueries.ts`; mutations invalidate `queryKeys.maintenance.all`.

**Acceptance:** `bun run typecheck` + `bun run lint` exit 0.
**DO-NOT:** no `fetch`; no `toISOString().split/slice`; field names MUST match BE serde exactly (§4).

### WP-4 — FE maintenance tab + UI in HousekeepingPage
**Files (new):** `src/features/housekeeping/components/MaintenanceTab.tsx`. **Files (edit):** `HousekeepingPage.tsx`.
- MUI `Tabs`/`Tab` ("Board", "Maintenance"), local useState. Board tab = existing JSX unchanged. Maintenance tab only shown when `hasPermission('maintenance:read')`.
- `MaintenanceTab.tsx`: table of tickets (ticket_number, title, category, priority chip, status chip, room_number, assigned_to_name). "New ticket" button (`maintenance:write`) → MUI Dialog: title (required), category Select (7), priority Select (4), optional room, description; submit via `useCreateMaintenanceTicket`. Row status actions (Start→in_progress, Resolve→resolved, Close→closed) via `useUpdateMaintenanceTicket`, gated on `maintenance:write`. Reuse chip patterns from `HousekeepingPage.tsx:32-61`.

**Acceptance:** typecheck + lint exit 0.
**DO-NOT:** no board behavior change; no new TanStack route; gate mutations behind `maintenance:write`.

### WP-5 — Tests (BE + FE)
**Files (new):** `hotel-app-be/tests/maintenance_tickets.rs`, `hotel-web-fe/src/api/maintenance.service.test.ts`.
- **BE** (mirror `tests/rooms_search.rs`: `mod common;` + sqlite-gated module, `common::setup_test_db()`; migrations auto-run). Seed room+room_type. Call service fns directly. Assert: (1) minimal create → `ticket_number` matches `^MT-\d{6}-0001$`, status=open, priority=medium, category=other; (2) second create → suffix 0002; (3) list filters by status and category; (4) resolved sets `resolved_at`; illegal transition open→resolved errors.
- **FE** (mirror `bookings.service.test.ts`): mock `./client`; assert listTickets forwards searchParams; createTicket posts to 'maintenance'.

**Acceptance:** `cargo test --features sqlite --no-default-features maintenance` exit 0; `bunx vitest run src/api/maintenance.service.test.ts` exit 0.

## 4. Integration checklist (commander)

- Sequencing: WP-1→WP-2; WP-3→WP-4; WP-5 after WP-2 (BE) / WP-3 (FE). BE and FE chains parallel.
- Field parity BE serde ↔ FE TS: `id, room_id, room_number, ticket_number, title, description, category, priority, status, assigned_to, assigned_to_name, reported_by, estimated_cost, actual_cost, estimated_hours, actual_hours, scheduled_date, started_at, resolved_at, resolution_notes, images, created_at, updated_at`; envelope `items, total, page, page_size`.
- Enum parity: priority `low|medium|high|critical`; status `open|in_progress|on_hold|resolved|closed`; category 7 values (no DDL CHECK — BE validation is the only guard). NOTE housekeeping priority set differs (`low/normal/high/urgent`) — do not conflate.
- Permissions: only `maintenance:read` / `maintenance:write` used.
- Wiring: `.merge(maintenance::routes())` present; `pub mod maintenance;` in 4 mod.rs files; queryKeys block; NO vite change.
- Global gates: cargo check --all-features, clippy -D warnings, sqlite tests, FE typecheck+lint+vitest all exit 0.
