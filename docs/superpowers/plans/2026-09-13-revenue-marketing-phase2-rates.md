# Phase 2 — Rate Plans, Rate Calendar, and Bulk Rate Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the delivered-but-invisible rate-management API: a `/rates` workspace with a resolved rate calendar, rate-plan CRUD, per-plan band editing, and transactional bulk band upserts.

**Architecture:** The rate calendar is a read endpoint in `modules/revenue` (`GET /api/revenue/rate-calendar`) that resolves, per `(room_type, stay_date)`: the applicable plan rate (priority → validity window → day-of-week flags → rate band → `room_types.base_price` fallback), the online-channel `custom_price` overlay, and occupancy from the sold-booking predicate established in Phase 1. Editing targets the `room_rates` band layer only — `custom_price` remains exclusively owned by the online-inventory grid (no second editor for one field). Bulk editing is a new transactional `POST /api/room-rates/bulk` endpoint that upserts one band per room type.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL backend; React/TS/MUI/TanStack Query+Router frontend; live PostgreSQL tests opt-in via `DATABASE_URL`.

## Global Constraints

- New SQL goes in repositories; handlers stay thin; routes hold only guards.
- `revenue_range(from, to)` from `modules/revenue/validation.rs` is the shared range parser (max 366 days).
- Sold-status predicate (stay-date basis): `b.status NOT IN ('voided','comp_void','no_show')`.
- Occupying-status predicate (availability basis, from `list_online_inventory_range`): `b.status IN ('reserved','confirmed','checked_in','auto_checked_in','pending','pending_payment','pending_confirmation')`.
- Never edit shipped patches; new changes ride `0020_rates_route_policy.sql` registered in manifest.tsv, deploy.yml, deploy-staging.yml, deploy.sh, deploy-staging.sh, and `tests/postgres_patch_lifecycle.rs` bounds.
- No `rates:*` permission split this phase (Phase 6 owns permission resources). `/rates` route policy uses `revenue:read`; mutating endpoints keep `rooms:write`/`rooms:update`.
- Regenerate `docs/api/openapi.json` after adding routes: `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`.
- Frontend dates use `src/utils/date.ts`; currency via `formatCurrency(value, currency)`; all HTTP via `src/api/client.ts` (omit `/api` prefix).
- Live tests seed fixtures in a private ID band (`BASE = 997_000`), delete child-first, `OVERRIDING SYSTEM VALUE` inserts.

## Interfaces consumed (verified)

- `RateRepository::applicable_rate(pool, room_type_id, date, day_of_week)` — predicate: `rp.is_active`, `rr.effective_from <= date`, `(rr.effective_to IS NULL OR rr.effective_to >= date)`, `(rp.valid_from IS NULL OR <= date)`, `(rp.valid_to IS NULL OR >= date)`, dow flags (`$3 = 0..6` Mon..Sun), `ORDER BY rp.priority DESC LIMIT 1`. Fallback in `services/rates.rs::applicable_rate`: `room_types.base_price` as `is_base_rate: true`.
- `online_inventory_allocations(room_type_id, stay_date, walk_in_reserved_rooms, online_booking_enabled, custom_price)` — PK `(room_type_id, stay_date)`.
- `GET /api/rate-plans`, `POST /api/rate-plans`, `GET /api/rate-plans/{id}/with-rates`, `PATCH/DELETE /api/rate-plans/{id}` — all on `rooms:*` perms.
- `GET/POST /api/room-rates`, `GET /api/room-rates/by-plan/{id}`, `PATCH/DELETE /api/room-rates/{id}` — same.
- `GET /api/rate-management/room-types` — active room types for pickers.
- FE `useAuth().hasPermission("resource:action")` for gating UI.

---

### Task 1: Rate-calendar resolution endpoint (backend)

**Files:**
- Modify: `hotel-app-be/src/modules/revenue/models.rs` — append calendar models
- Modify: `hotel-app-be/src/modules/revenue/repository.rs` — append `rate_calendar`
- Modify: `hotel-app-be/src/modules/revenue/service.rs` — append `rate_calendar`
- Modify: `hotel-app-be/src/modules/revenue/handlers.rs` — append handler
- Modify: `hotel-app-be/src/modules/revenue/routes.rs` — append route
- Modify: `hotel-app-be/src/repositories/rate.rs:445` — deterministic tiebreak

**Produces:**
- `GET /api/revenue/rate-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` → `RateCalendar`
- Consumed by Task 5 `getRateCalendar`.

- [ ] **Step 1: Add models to `modules/revenue/models.rs`**

```rust
/// One resolved cell of the staff rate calendar.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct RateCalendarCell {
    pub room_type_id: i64,
    pub stay_date: NaiveDate,
    /// Winning plan code ("BASE" when the base-rate fallback applies).
    pub rate_plan_code: String,
    /// Resolved plan/band rate before channel overlays.
    pub plan_rate: Decimal,
    /// True when no plan band matched and `room_types.base_price` was used.
    pub is_base_rate: bool,
    /// Online-channel per-date override (NULL when the cell uses the plan rate).
    pub custom_price: Option<Decimal>,
    /// What an online guest pays: custom_price ?? plan_rate.
    pub effective_rate: Decimal,
    /// Sellable physical rooms of this type (active, not maintenance/ooo).
    pub physical_rooms: i64,
    /// Rooms holding a sold-status booking covering this stay date.
    pub sold_rooms: i64,
    /// Physical rooms minus sold rooms (floored at 0).
    pub available_rooms: i64,
    /// Sold/physical as a percentage (0 when physical is 0).
    pub occupancy_pct: Decimal,
    pub online_booking_enabled: bool,
    pub walk_in_reserved_rooms: i64,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct RateCalendarRoomType {
    pub room_type_id: i64,
    pub code: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct RateCalendar {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub room_types: Vec<RateCalendarRoomType>,
    pub cells: Vec<RateCalendarCell>,
}
```

- [ ] **Step 2: Deterministic tiebreak in `RateRepository::applicable_rate`**

Change the `ORDER BY` to `ORDER BY rp.priority DESC, rr.id DESC` and add a comment:
"Within one plan, the most recently created band wins — bulk edits may leave overlapping bands, so resolution must be deterministic." This is an intentional behavior change: previously same-priority overlaps resolved arbitrarily. Document in the commit message.

- [ ] **Step 3: Add `rate_calendar` to `modules/revenue/repository.rs`**

One set-based query. The rate-resolution WHERE mirrors `RateRepository::applicable_rate` — add a comment saying the two must stay in sync.

```rust
/// Resolved staff rate calendar: per active room type × stay date, the
/// winning plan band (mirrors RateRepository::applicable_rate's predicate —
/// keep in sync), base-price fallback, online overlay, and occupancy.
/// `$1`/`$2` are inclusive date bounds.
pub async fn rate_calendar(
    pool: &DbPool,
    range: &RevenueRange,
) -> Result<(Vec<RateCalendarRoomType>, Vec<RateCalendarCell>), ApiError> {
    let rows = sqlx::query(
        r#"
        WITH dates AS (
            SELECT generate_series($1::date, $2::date, interval '1 day')::date AS stay_date
        ),
        rts AS (
            SELECT id, code, name, base_price FROM room_types WHERE is_active = true
        ),
        cells AS (
            SELECT rt.id AS room_type_id, d.stay_date, rt.base_price
            FROM rts rt CROSS JOIN dates d
        )
        SELECT c.room_type_id, rt.code, rt.name, c.stay_date,
               COALESCE(resolved.price, c.base_price) AS plan_rate,
               COALESCE(resolved.rate_plan_code, 'BASE') AS rate_plan_code,
               (resolved.price IS NULL) AS is_base_rate,
               a.custom_price AS custom_price,
               COALESCE(a.online_booking_enabled, true) AS online_booking_enabled,
               COALESCE(a.walk_in_reserved_rooms, 0) AS walk_in_reserved_rooms,
               phys.cnt AS physical_rooms,
               COALESCE(sold.cnt, 0)::bigint AS sold_rooms
        FROM cells c
        JOIN rts rt ON rt.id = c.room_type_id
        LEFT JOIN LATERAL (
            SELECT rr.price, rp.code AS rate_plan_code
            FROM room_rates rr
            JOIN rate_plans rp ON rr.rate_plan_id = rp.id
            WHERE rr.room_type_id = c.room_type_id
              AND rp.is_active = true
              AND rr.effective_from <= c.stay_date
              AND (rr.effective_to IS NULL OR rr.effective_to >= c.stay_date)
              AND (rp.valid_from IS NULL OR rp.valid_from <= c.stay_date)
              AND (rp.valid_to IS NULL OR rp.valid_to >= c.stay_date)
              AND CASE extract(isodow FROM c.stay_date)
                    WHEN 1 THEN rp.applies_monday
                    WHEN 2 THEN rp.applies_tuesday
                    WHEN 3 THEN rp.applies_wednesday
                    WHEN 4 THEN rp.applies_thursday
                    WHEN 5 THEN rp.applies_friday
                    WHEN 6 THEN rp.applies_saturday
                    ELSE rp.applies_sunday
                  END
            ORDER BY rp.priority DESC, rr.id DESC
            LIMIT 1
        ) resolved ON true
        LEFT JOIN online_inventory_allocations a
               ON a.room_type_id = c.room_type_id AND a.stay_date = c.stay_date
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::bigint AS cnt FROM rooms r
            WHERE r.room_type_id = c.room_type_id AND r.is_active = true
              AND COALESCE(r.status, 'available') NOT IN ('maintenance', 'out_of_order')
        ) phys ON true
        LEFT JOIN LATERAL (
            SELECT COUNT(*) AS cnt FROM bookings b
            JOIN rooms r ON r.id = b.room_id
            WHERE r.room_type_id = c.room_type_id
              AND r.is_active = true
              AND COALESCE(r.status, 'available') NOT IN ('maintenance', 'out_of_order')
              AND b.status NOT IN ('voided', 'comp_void', 'no_show')
              AND b.check_in_date <= c.stay_date AND b.check_out_date > c.stay_date
        ) sold ON true
        ORDER BY rt.name, c.stay_date
        "#,
    )
    .bind(range.from)
    .bind(range.to)
    .fetch_all(pool)
    .await
    .map_err(ApiError::from)?;
    // Row mapping: `row.get::<Decimal, _>("plan_rate")`,
    // `row.get::<Option<Decimal>, _>("custom_price")` — direct numeric→Decimal
    // binds, same convention as the other queries in this file (no ::text
    // casts). Build `room_types` via a `BTreeMap` keyed on room_type_id
    // (one entry per type, name-sorted by the ORDER BY). Compute in Rust:
    // `effective_rate = custom_price.unwrap_or(plan_rate)`,
    // `available_rooms = (physical_rooms - sold_rooms).max(0)`,
    // `occupancy_pct = sold_rooms * 100 / physical_rooms` (0 when physical = 0),
    // rounded to 1 decimal with `Decimal::round_dp(1)`.
}
```

- [ ] **Step 4: Service + handler + route**

- `service.rs::rate_calendar(pool, from, to)` → `revenue_range` validation → `RevenueRepository::rate_calendar`. No extra logic — repository already resolves everything; service keeps the range-validation seam.
- `handlers.rs::rate_calendar_handler(pool, Query)` mirroring `overview_handler`.
- `routes.rs`: `.route("/rate-calendar", get(rate_calendar))` behind the existing `revenue:read` guard.

- [ ] **Step 5: Compile**

Run: `cargo check --all-features` in `hotel-app-be`. Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add hotel-app-be/src/modules/revenue/ hotel-app-be/src/repositories/rate.rs
git commit -m "feat(revenue): rate-calendar resolution endpoint"
```

---

### Task 2: Live-DB test for the rate calendar

**Files:**
- Create: `hotel-app-be/tests/rate_calendar.rs`

**Consumes:** `RevenueRepository::rate_calendar`, fixture pattern from `tests/revenue_overview.rs` (`BASE = 997_000`).

- [ ] **Step 1: Write the test**

Fixture (child-first deletes): room type `997_000` (base_price 100) with 2 rooms, room type `997_001` (base_price 80) with 1 room; plan `997_000` "Low" priority 10 with band 150 covering Oct 1-7; plan `997_001` "High" priority 20 with band 220 covering Oct 1-7, `applies_sunday = false`; `online_inventory_allocations` custom_price 260 on Oct 3 for type `997_000`; one `confirmed` booking Oct 2-4 in a `997_000` room.

Assertions on `RevenueRepository::rate_calendar(pool, range Oct 1-7)` filtered to `room_type_id = 997_000`:
- Oct 1 (Thu): `rate_plan_code == "HIGH"`, `plan_rate == 220` (priority wins).
- Oct 4 (Sun): `rate_plan_code == "LOW"`, `plan_rate == 150` (High excluded by dow flag).
- Oct 3: `custom_price == Some(260)`, `effective_rate == 260`.
- Oct 1: `sold_rooms == 0`; Oct 2-3: `sold_rooms == 1`; `available_rooms == physical_rooms - sold_rooms`.
- Room type `997_001` any date: `is_base_rate == true`, `plan_rate == 80`.
- `room_types` contains both fixture types; `cells.len()` covers 7 dates per type present.

- [ ] **Step 2: Run**

Run: `DATABASE_URL=$DATABASE_URL cargo test --all-features --test rate_calendar`
Expected: all pass (live DB available in this environment).

- [ ] **Step 3: Commit** — `test(revenue): live-db coverage for rate calendar resolution`

---

### Task 3: Bulk room-rate band upsert (backend)

**Files:**
- Modify: `hotel-app-be/src/models/rate.rs` — `BulkRoomRateInput`
- Modify: `hotel-app-be/src/repositories/rate.rs` — `upsert_room_rate_band_tx`
- Modify: `hotel-app-be/src/services/rates.rs` — `bulk_upsert_room_rates`
- Modify: `hotel-app-be/src/handlers/rates.rs` — thin handler
- Modify: `hotel-app-be/src/routes/rates.rs` — `POST /room-rates/bulk`
- Test: append to `hotel-app-be/tests/rate_calendar.rs`

**Produces:**
- `POST /api/room-rates/bulk` `{ rate_plan_id, room_type_ids: i64[], effective_from: "YYYY-MM-DD", effective_to: "YYYY-MM-DD", price: number }` → `200 RoomRate[]` (one per room type).
- Upsert rule: a band for `(rate_plan_id, room_type_id)` with *exactly* `[effective_from, effective_to]` gets `price` updated; otherwise a new band is inserted. Exact-match keeps repeated bulk runs idempotent; overlapping non-exact bands are allowed and resolve by `rr.id DESC` (Task 1 tiebreak).

- [ ] **Step 1: Model**

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct BulkRoomRateInput {
    pub rate_plan_id: i64,
    pub room_type_ids: Vec<i64>,
    pub effective_from: String,
    pub effective_to: String,   // inclusive, matching room_rates semantics
    pub price: f64,
}
```

- [ ] **Step 2: Repository `upsert_room_rate_band_tx(tx, plan_id, room_type_id, values)`**

```sql
UPDATE room_rates SET price = $4
WHERE rate_plan_id = $1 AND room_type_id = $2
  AND effective_from = $3 AND effective_to = $5
RETURNING id
```
If no row: `INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to) VALUES (...) RETURNING id`. Fetch and return the `RoomRate`.

- [ ] **Step 3: Service `bulk_upsert_room_rates(pool, user_id, input)`**

Validate: `room_type_ids` non-empty, dates parse, `effective_from <= effective_to`, `price` finite and `> 0`, plan exists (reuse `RateRepository::find_rate_plan`). Begin tx → per id call repo upsert → commit → one `AuditLog::log_event` `room_rates_bulk_upsert` with `{rate_plan_id, room_type_ids, effective_from, effective_to, price}`.

- [ ] **Step 4: Route** — `POST /room-rates/bulk` → `require_permission_helper(pool, headers, "rooms:write")`. Register before `{id}` routes (axum static-segment precedence makes this safe regardless, but keep grouping readable).

- [ ] **Step 5: Live test** (append to `tests/rate_calendar.rs`)

Call `services::rates::bulk_upsert_room_rates` twice: first inserts 2 bands (two fixture types); second identical call updates the same rows (assert same `id`s, price changed — proving idempotent exact-match upsert). Third call with a different `effective_to` inserts new bands (count grows). Rejects: empty `room_type_ids`, inverted range, nonexistent plan → `ApiError::BadRequest`/`NotFound`.

- [ ] **Step 6: Verify + commit**

Run: `cargo check --all-features && DATABASE_URL=$DATABASE_URL cargo test --all-features --test rate_calendar`
Commit: `feat(rates): transactional bulk room-rate band upsert`

---

### Task 4: `/rates` route policy + patch 0020

**Files:**
- Create: `hotel-app-be/database/postgres/patches/0020_rates_route_policy.sql`
- Modify: `hotel-app-be/database/postgres/patches/manifest.tsv`
- Modify: `hotel-app-be/database/postgres/seed.sql` — `route_access_policies` row + checklist
- Modify: `.github/workflows/deploy.yml`, `.github/workflows/deploy-staging.yml`, `deploy/deploy.sh`, `deploy/deploy-staging.sh`
- Modify: `hotel-app-be/tests/postgres_patch_catalog.rs`, `hotel-app-be/tests/postgres_patch_lifecycle.rs` — head 0020

- [ ] **Step 1: Patch** — mirror `0019_revenue_read_permission.sql` structure: idempotent `INSERT INTO route_access_policies (route_path, permission, ...) VALUES ('/rates', 'revenue:read', ...) ON CONFLICT DO NOTHING` matching the exact column set used by 0019 (read that file first and copy its shape verbatim, changing only values).

- [ ] **Step 2: seed.sql** — add the `/rates` row beside the `/revenue` row added in Phase 1 and bump its route-policy checklist.

- [ ] **Step 3: Registrations** — manifest row `0020<TAB>rates_route_policy.sql<TAB><sha256 of file>`, deploy files/workflows append patch 20 lines mirroring patch 19, lifecycle test bounds 2→20 / expected-revision list / `revisions.len()`.

- [ ] **Step 4: Tests**

Run: `cargo test --all-features --test postgres_patch_catalog --test postgres_patch_lifecycle`
Expected: green (lifecycle runs against live PG when `DATABASE_URL` set).

- [ ] **Step 5: OpenAPI regen** (routes changed in Tasks 1+3)

Run: `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift` then plain `cargo test --test openapi_drift`.

- [ ] **Step 6: Commit** — `feat(rates): /rates route access policy and patch 0020`

---

### Task 5: Frontend `rates` feature + `/rates` page

**Files:**
- Create: `hotel-web-fe/src/features/rates/{types.ts,api.ts,constants.ts,index.ts}`
- Create: `hotel-web-fe/src/features/rates/hooks/{useRatePlans.ts,useRateCalendar.ts}`
- Create: `hotel-web-fe/src/features/rates/components/{RateCalendarGrid.tsx,RateCellPopover.tsx,RatePlanTable.tsx,RatePlanDialog.tsx,RoomRatesEditor.tsx,BulkRateDialog.tsx}`
- Create: `hotel-web-fe/src/features/rates/pages/RatesPage.tsx`
- Create: `hotel-web-fe/src/features/rates/components/BulkRateDialog.test.tsx`
- Create: `hotel-web-fe/src/routes/rates.tsx`
- Modify: `hotel-web-fe/src/navigation/routeRegistry.tsx`, `navGroups.ts` (no new group — `revenue` already exists)
- Modify: `hotel-web-fe/src/i18n/resources/{en,ms}/nav.json` (`routes.rates.label`)
- Modify: `hotel-web-fe/src/routeTree.gen.ts` — regenerated by `bun run build`

**Consumes:** `GET revenue/rate-calendar`, `GET rate-plans`, `GET rate-plans/{id}/with-rates`, `POST/PATCH/DELETE rate-plans`, `POST/PATCH/DELETE room-rates`, `POST room-rates/bulk`, `GET rate-management/room-types`.

- [ ] **Step 1: `types.ts` + `api.ts`** — mirror backend DTOs (`RateCalendarCell` fields exactly as Task 1). `api.ts` uses `api.get/post/patch/delete` from `src/api/client.ts`, paths without `/api`.

- [ ] **Step 2: `hooks`** — `useRateCalendar()` holds `from`/`to` window state (default today → today+13), TanStack query keyed `['rate-calendar', from, to]`; `useRatePlans()` queries + mutations invalidating `['rate-plans']`, `['room-rates']`, `['rate-calendar']`.

- [ ] **Step 3: `RateCalendarGrid`** — room_type × date matrix borrowing `InventoryGrid`'s sticky-header/table structure but read-mostly: each cell shows `effective_rate` (formatted via `formatCurrency`), a thin occupancy bar (`sold_rooms/physical_rooms`), and markers: `custom_price` set → accent dot; `is_base_rate` → muted text; `online_booking_enabled == false` → "offline" chip tint. Click → `RateCellPopover` with the resolution breakdown (winning plan code, plan rate, override, occupancy, reserved). Window paging: prev/next 14-day buttons + `ModernDatePicker` bounds. Cap grid at 31 displayed days (frontend slices the ≤366-day response window into pages rather than refetching).

- [ ] **Step 4: `RatePlanTable` + `RatePlanDialog`** — table: name, code, plan_type, adjustment (`type`+`value`), validity, dow chips, min/max nights, priority, active switch (PATCH `is_active`), edit/delete actions. Dialog edits every `RatePlanInput` field incl. dow checkboxes and `blackout_dates` (comma-separated date list → `Vec<String>`). All mutations gated `hasPermission('rooms:write')`.

- [ ] **Step 5: `RoomRatesEditor`** — inside plan edit (expandable row or side panel): lists `with-rates` bands, inline add/edit/delete band rows (`price`, `effective_from`, `effective_to`).

- [ ] **Step 6: `BulkRateDialog`** — plan select, room-type multiselect, `effective_from`/`to` pickers, price input; POST `room-rates/bulk`; success → invalidate `room-rates` + `rate-calendar`.

- [ ] **Step 7: `RatesPage`** — `PageHeader` + tabs via search param (`?tab=calendar|plans`, `validateSearch`); Plans tab rendered only when `hasPermission('rooms:read')`; edit affordances additionally gated on `rooms:write`.

- [ ] **Step 8: Route + registry** — `routes/rates.tsx` `createFileRoute('/rates')`; registry entry `{ id: 'rates', path: '/rates', navLabel: 'Rates', group: 'revenue', icon: PriceChangeIcon, access: { permission: 'revenue:read' } }` (match the exact registry field shape used by the `revenue` entry — copy it). Add `routes.rates.label` to en/ms nav.json ("Rates" / "Kadar").

- [ ] **Step 9: Test** — `BulkRateDialog.test.tsx`: renders fields, blocks submit on empty room types / inverted range / non-positive price, submits a well-formed payload. Use `toBeTruthy()` assertions (no jest-dom).

- [ ] **Step 10: Verify + commit**

Run: `bun run typecheck && bunx eslint src/features/rates src/routes/rates.tsx --max-warnings=0 && bun run test -- src/features/rates src/navigation && bun run build`
Commit: `feat(rates): rate calendar, plan management, and bulk editing UI`

---

### Task 6: Phase checkpoint

- [ ] `cargo check --all-features` + `cargo clippy --all-features -- -D warnings` — clean
- [ ] `cargo test --all-features --test rate_calendar --test revenue_overview --test postgres_patch_catalog --test postgres_patch_lifecycle --test openapi_drift` — green
- [ ] `bun run typecheck && bun run lint && bun run test` — clean
- [ ] `bun run build` — `routeTree.gen.ts` regenerated + committed
- [ ] Update `docs/superpowers/specs` Phase-2 section status note (status line only; full docs cleanup is Phase 6)

## Explicitly out of scope (this phase)

- Editing `custom_price` from the calendar (owned by online-inventory grid).
- Stay restrictions overlay columns (Phase 5 — the calendar cell shape leaves room for a `restrictions` field).
- `rates:*` permission split (Phase 6).
- Splitting/merging overlapping bands on upsert (documented semantics only).
