# Phase 1 — Revenue Metrics Service + Revenue Overview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** First real revenue intelligence: a backend `modules/revenue` domain
serving stay-date-based KPIs (room revenue, occupancy, ADR, RevPAR, room
nights, ALOS, void/no-show rates, direct share) with previous-period deltas,
consumed by a new `/revenue` page under a new `revenue` nav group.

**Architecture:** New domain module `src/modules/revenue/` (mod, routes,
handlers, service, repository, models, validation per AGENTS.md layout).
Repository owns one aggregate SQL statement over `bookings` (spread across
stay nights via `generate_series`) plus a channel-mix query — no logic copied
from `repositories/analytics.rs`. Frontend `features/revenue/` consumes one
endpoint; MUI + recharts (already a dependency).

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL, React/TS/MUI/TanStack Query/Router,
recharts, bun.

Spec: `docs/superpowers/specs/2026-09-13-revenue-marketing-redesign-design.md`

## Global Constraints

- Commands run inside `.worktrees/revenue-marketing` (branch
  `revenue-marketing/2026-09-13`), `hotel-app-be/` or `hotel-web-fe/`.
- Backend gate: `cargo check --all-features` + `cargo clippy --all-features -- -D warnings`.
- Frontend gates: `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`.
- Money: `Decimal`; bind via `decimal_to_db`. Dates: `NaiveDate`; FE uses
  `src/utils/date.ts` — `toISOString().split/.slice` is lint-banned.
- SQL parameterized only. New `FromRow` over numeric/date needs one live-DB test.
- Booking "sold" set (documented): `status NOT IN ('voided','comp_void','no_show')`
  — pending states hold rooms and stay counted until auto-release voids them.
- Cancellations ARE voids (guest cancel → `void_booking_tx`); no `cancelled`
  status exists. `comp_void` counts as voided.
- Same-day stays exist (`check_out = check_in`): treat as 1 night, book revenue
  onto the check-in date (`generate_series(check_in, GREATEST(check_out-1, check_in))`).
- RevPAR denominator: `COUNT(rooms) WHERE status <> 'out_of_order'` — sellable
  inventory; `maintenance` rooms still count.
- Business dates: `hotel_today`, never chrono Local/Utc.
- New route ⇒ regen openapi: `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`.
- New permission + route ⇒ seed.sql checklists (permissions inserts, role
  grants lists, `expected_route_access_policies`, policy-count assertion) —
  mirror the `navigation_promotions:read` precedent exactly.
- seed.sql lives in the shared tree's edit set for the sibling session — but
  THIS worktree owns this branch; edit it here normally, flag the merge-order
  risk at handoff.
- Metric definitions also documented in `docs/architecture/architecture-flow.md`
  (append to the revenue section added in Phase 0).

## API Contract (shared by all tasks)

`GET /api/revenue/overview?from=YYYY-MM-DD&to=YYYY-MM-DD&room_type_id=<opt>&channel_id=<opt>`
permission `revenue:read`. `from`/`to` are STAY dates, `to` exclusive — but
for API ergonomics `to` is INCLUSIVE of the last stay night (documented);
max range 366 days, `from <= to`, else 422.

Response (JSON, decimals as strings via `Decimal` serde):

```json
{
  "range": {"from": "2026-09-01", "to": "2026-09-14"},
  "currency": "USD",
  "kpis": {
    "room_revenue": "12340.00", "room_nights_sold": 96, "occupancy_rate": "68.6",
    "adr": "128.54", "revpar": "88.20", "alos_nights": "2.7",
    "bookings_created": 34, "void_rate": "5.9", "no_show_rate": "2.1",
    "direct_share": "61.8"
  },
  "previous_period": { "from": "2026-08-18", "to": "2026-08-31",
    "kpis": { "...same keys...": "..." } },
  "deltas_pct": { "room_revenue": "12.4", "occupancy_rate": "-3.1", "...": "..." },
  "daily": [ { "date": "2026-09-01", "room_revenue": "800.00",
               "room_nights_sold": 7, "occupancy_rate": "70.0", "adr": "114.29" } ],
  "channels": [ { "channel_id": 3, "channel_name": "Direct", "channel_type": "direct",
                  "bookings": 21, "net_revenue": "6120.00", "share_pct": "49.6" } ]
}
```

`deltas_pct` entry is `null` when the previous-period value is 0 (no fake
100%). `channels[]` is booking-CREATION-date basis (attribution, not stay
spread) — documented in response docs. Empty dataset ⇒ zeros/null deltas,
HTTP 200.

---

### Task 1: Revenue module — models, validation, repository SQL

**Files:**
- Create: `src/modules/revenue/mod.rs`, `models.rs`, `validation.rs`, `repository.rs`
- Create: `src/modules/revenue/service.rs`, `handlers.rs`, `routes.rs` (Task 2 wires)
- Modify: `src/modules/mod.rs` (register `pub mod revenue;`)

**Interfaces:**
- Produces: `RevenueOverviewQuery { from: Option<String>, to: Option<String>, room_type_id: Option<i64>, channel_id: Option<i64> }`
- Produces: `RevenueRepository::overview(pool, &RevenueOverviewParams) -> Result<RevenueOverviewRows, ApiError>`

- [ ] **Step 1: Failing validation tests**

`validation.rs`:

```rust
use chrono::NaiveDate;
use crate::core::error::ApiError;

/// Resolved stay-date window. `to` is the last counted night (inclusive);
/// SQL adds one day for the exclusive bound.
pub struct RevenueRange {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

const MAX_RANGE_DAYS: i64 = 366;

pub fn revenue_range(from: &str, to: &str) -> Result<RevenueRange, ApiError> {
    let parse = |value: &str, label: &str| {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| {
            ApiError::BadRequest(format!("{label} must be a YYYY-MM-DD date"))
        })
    };
    let (from, to) = (parse(from, "from")?, parse(to, "to")?);
    if from > to {
        return Err(ApiError::BadRequest("'from' must not be after 'to'".into()));
    }
    if (to - from).num_days() + 1 > MAX_RANGE_DAYS {
        return Err(ApiError::BadRequest(
            "Date range cannot exceed 366 days".into(),
        ));
    }
    Ok(RevenueRange { from, to })
}
```

Unit tests in the same file (`#[cfg(test)]`): rejects `to < from`, rejects
>366 days, rejects malformed dates, accepts 1-day and 366-day spans. Mirror
the style of `guest_booking::validation` range tests (already in repo:
`range_accepts_31_date_span_and_rejects_inverted`).

Run: `cargo test --all-features modules::revenue` → FAIL (module missing).

- [ ] **Step 2: models.rs — response DTOs**

```rust
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct RevenueOverviewQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub room_type_id: Option<i64>,
    pub channel_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RevenueKpis {
    pub room_revenue: Decimal,
    pub room_nights_sold: i64,
    /// Sold room-nights ÷ (sellable rooms × days) × 100, one decimal.
    pub occupancy_rate: Decimal,
    /// Room revenue ÷ room nights sold.
    pub adr: Decimal,
    /// Room revenue ÷ (sellable rooms × days).
    pub revpar: Decimal,
    /// Average length of stay (nights) for bookings overlapping the range.
    pub alos_nights: Decimal,
    /// Bookings CREATED in the range (booking-date basis).
    pub bookings_created: i64,
    /// Share of bookings created that ended voided/comp_void, one decimal.
    pub void_rate: Decimal,
    /// Share of bookings created that ended no_show, one decimal.
    pub no_show_rate: Decimal,
    /// Net revenue share of direct-type channels (direct/website/walk_in/phone).
    pub direct_share: Decimal,
}

#[derive(Debug, Serialize)]
pub struct RevenueDailyPoint {
    pub date: NaiveDate,
    pub room_revenue: Decimal,
    pub room_nights_sold: i64,
    pub occupancy_rate: Decimal,
    pub adr: Decimal,
}

#[derive(Debug, Serialize)]
pub struct RevenueChannelMix {
    pub channel_id: Option<i64>,
    pub channel_name: String,
    pub channel_type: String,
    pub bookings: i64,
    pub net_revenue: Decimal,
    pub share_pct: Decimal,
}

#[derive(Debug, Serialize)]
pub struct RevenueRangeInfo { pub from: NaiveDate, pub to: NaiveDate }

#[derive(Debug, Serialize)]
pub struct RevenueOverview {
    pub range: RevenueRangeInfo,
    pub currency: String,
    pub kpis: RevenueKpis,
    pub previous_period: RevenueRangeInfo,
    pub previous_kpis: RevenueKpis,
    /// KPI → pct change vs previous period; null where previous is zero.
    pub deltas_pct: serde_json::Value,
    pub daily: Vec<RevenueDailyPoint>,
    pub channels: Vec<RevenueChannelMix>,
}
```

- [ ] **Step 3: repository.rs — the aggregate query**

One `query_as::<_, KpiRow>` per range + one per-day query + one channel query.
Core stay-night CTE (parameterized `$1`/`$2` inclusive from/to; filters appended
by the same QueryBuilder pattern as `repositories/rate.rs`):

```sql
WITH stay_nights AS (
    SELECT b.id AS booking_id, gs::date AS stay_date,
           b.subtotal / b.nights_effective AS nightly_revenue,
           b.room_type_id, b.booking_channel_id
    FROM (
        SELECT b.*, GREATEST((b.check_out_date - b.check_in_date), 1) AS nights_effective
        FROM bookings b
        WHERE b.status NOT IN ('voided','comp_void','no_show')
    ) b
    CROSS JOIN LATERAL generate_series(
        b.check_in_date, GREATEST(b.check_out_date - 1, b.check_in_date)) AS gs
    WHERE gs::date BETWEEN $1 AND $2
      /* AND b.room_type_id = $3 / b.booking_channel_id = $4 when filtered */
)
SELECT COALESCE(SUM(nightly_revenue),0) AS room_revenue,
       COUNT(*) AS room_nights_sold, ...
```

Plus a second CTE `created` (bookings `created_at::date BETWEEN $1 AND $2`) for
`bookings_created`, `void_rate`, `no_show_rate`; `sellable_rooms` =
`SELECT COUNT(*) FROM rooms WHERE status <> 'out_of_order'` (a `COUNT` subquery
in the same statement). ADR/RevPAR/occupancy computed in Rust from the raw
sums — keep SQL to sums, arithmetic in service (single definition point,
easier to test).

Channel mix query: bookings created in range grouped by
`booking_channels` (LEFT JOIN; `NULL` channel → 'Direct'/'direct' fallback via
`COALESCE(bc.name,'Direct')`), summing `net_revenue` (fallback `subtotal`
when `net_revenue IS NULL` — `COALESCE(b.net_revenue, b.subtotal)`), excluding
voided/comp_void. `direct` share = `channel_type IN
('direct','website','walk_in','phone')` — verified against
`booking_channels_channel_type_check` (full enum: direct, ota, corporate,
walk_in, phone, website, channel_manager, other).

Daily series: same stay_nights CTE grouped by `stay_date`, ordered.

- [ ] **Step 4: Register the module**

`src/modules/mod.rs`: `pub mod revenue;` (alphabetical position).
`mod.rs` inside the module: `pub mod handlers; pub mod models; pub mod repository; pub mod routes; pub mod service; pub mod validation;` matching siblings.

- [ ] **Step 5: Verify**

Run: `cargo test --all-features modules::revenue` + `cargo check --all-features`
Expected: validation tests pass; check clean.

- [ ] **Step 6: Commit**

`feat(revenue): revenue overview metrics module (repository + models)`

---

### Task 2: Service, handler, route, permission

**Files:**
- Create: `src/modules/revenue/service.rs`, `handlers.rs`, `routes.rs`
- Modify: `src/routes/mod.rs` (merge router)
- Modify: `database/postgres/seed.sql` (permissions + route policy)

**Interfaces:**
- Consumes: Task 1 repository/models.
- Produces: `GET /revenue/overview` (router is nested under `/api` globally —
  confirm mount convention in `routes/mod.rs`).

- [ ] **Step 1: service.rs**

`RevenueService::overview(pool, query) -> Result<RevenueOverview, ApiError>`:
defaults `from = hotel_today - 29`, `to = hotel_today` when absent; calls
`revenue_range`; computes previous window `from - len .. from - 1`; runs both
KPI queries + daily + channels; derives ratios in one `fn kpis(sums) ->
RevenueKpis` (unit-testable pure function — division guards: 0 nights ⇒ 0,
not null); builds `deltas_pct` as `serde_json::json!` map with `Value::Null`
on zero previous.

- [ ] **Step 2: handlers.rs + routes.rs**

Thin handler: `require_permission_helper(&pool,&headers,"revenue:read")` →
`Query<RevenueOverviewQuery>` → service → `Json`. `routes.rs` exposes
`pub fn routes() -> Router<DbPool>` with `.route("/revenue/overview", get(..))`;
merge into `routes/mod.rs::create_router` where siblings merge.

- [ ] **Step 3: seed.sql — `revenue:read` + `navigation_revenue:read` + policy**

Mirror the `navigation_promotions:read` rows: permission inserts,
`('revenue:read', 'revenue', 'read', 'View revenue analytics', true)`-style
catalog row, grants added to admin/manager permission checklist arrays, and
`expected_route_access_policies` + `route_access_policies` row for route id
`revenue` requiring `revenue:read`. Grep seed.sql for every list containing
`navigation_promotions`/`promotions:read` and add the revenue equivalents
adjacent — the file is self-validating (RAISEs on mismatch), so run the
patch-catalog test to confirm: `cargo test --all-features postgres_seed` or
the seed-validation test (find its name via `grep -rn "seed" tests/ | head`).

- [ ] **Step 4: openapi regen + verify**

`HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`
then `cargo test --all-features --test openapi_drift` (clean pass).
`cargo clippy --all-features -- -D warnings` clean.

- [ ] **Step 5: Live-DB smoke**

`tests/revenue_overview.rs` (DATABASE_URL-gated, `996_xxx` band): seed room,
guest, two bookings across a stay boundary + one voided; call
`RevenueRepository::overview`; assert room_nights_sold/revenue sums and that
the voided booking contributes nothing to stay metrics but counts in
`void_rate`. Commit.

`feat(revenue): /api/revenue/overview endpoint with revenue:read permission`

---

### Task 3: Revenue Overview page + navigation

**Files:**
- Create: `src/features/revenue/{api.ts,types.ts,constants.ts,utils.ts,index.ts}`,
  `hooks/useRevenueOverview.ts`, `components/{RevenueKpiGrid,RevenueTrendChart,ChannelMixTable,RevenueFilters}.tsx`,
  `pages/RevenueOverviewPage.tsx`
- Create: `src/routes/revenue.tsx`
- Modify: `src/navigation/routeRegistry.tsx` (NavGroup union + lazy import + entry),
  `src/navigation/navGroups.ts` (order; labeled group)

**Interfaces:**
- Consumes: `/api/revenue/overview` contract above; `apiClient` from `src/api/client.ts`.
- Produces: route id `revenue`, nav group `revenue` placed after `finance`.

- [ ] **Step 1: Failing component test**

`RevenueKpiGrid.test.tsx` (Vitest + Testing Library, model on an existing
`*.test.tsx` in features): renders KPI labels + formatted values; renders
`—`/`null` delta as "no prior data"; empty daily array ⇒ empty-state text
not a crash.

- [ ] **Step 2: api.ts + types.ts + hook**

`fetchRevenueOverview(params)` → `apiClient.get('api/revenue/overview',
{ searchParams })` (check client API shape — `api.get/post` helpers used by
`promotionsApi.ts`; mirror it). `useRevenueOverview` wraps `useQuery` keyed on
the filter object.

- [ ] **Step 3: Components**

- `RevenueFilters`: from/to date pickers (existing project picker — check
  `features/reports` filter components first; reuse if one exists), room-type
  and channel selects fed by `/api/rate-management/room-types` and
  `/api/booking-channels` (both endpoints exist — reuse their services).
- `RevenueKpiGrid`: MUI Grid of KPI cards — value, prior delta with up/down
  coloring (reuse delta styling from dashboard components if one exists —
  check `features/dashboard/components`), `null` delta → muted "no prior".
- `RevenueTrendChart`: recharts `ComposedChart` — bars = room nights sold,
  line = occupancy %, second axis; reuse the palette constants in
  `features/dashboard/reports` if exported there.
- `ChannelMixTable`: name/type/bookings/net/share + direct-share summary row.
- Page: heading "Revenue Overview", date-range description ("Stay dates …"),
  loading skeleton, `error` → MUI Alert with retry, empty → EmptyState copy
  (no bookings in range).

- [ ] **Step 4: Route + registry + nav**

`src/routes/revenue.tsx` (2 lines, `RouteById id="revenue"`); registry entry
`{ id:'revenue', path:'/revenue', component: RevenueOverviewPage (lazyRoute),
animationType:'fade', visibility:'auth', icon: TrendingUpIcon (check MUI
icons already imported), navLabel:'Revenue', navGroup:'revenue',
accessControlled: true }`; add `'revenue'` to the `NavGroup` union AND
`NAV_GROUP_ORDER` (after `finance`); it is NOT in `LABEL_LESS_GROUPS`.

- [ ] **Step 5: Verify**

`bun run typecheck && bun run lint && bun run test` (new tests pass) +
`bun run build`. Commit:
`feat(revenue): revenue overview page under new revenue nav group`

---

### Task 4: Metric-definition docs

**Files:** Modify `docs/architecture/architecture-flow.md`

- [ ] Append to the revenue section: sold-status set, stay-date vs
  booking-date basis, ADR/RevPAR/occupancy/ALOS/void/no-show/direct-share
  formulas, RevPAR denominator rule, previous-period definition, the
  `net_revenue → subtotal` fallback, and the known limitation list (no
  pace/pickup, no forecast yet; pending bookings counted until voided).
- [ ] Commit: `docs(architecture): revenue metric definitions`

## Phase 1 done-when

- `/api/revenue/overview` returns documented metrics; live test proves
  voided-booking exclusion and night-spread math.
- `/revenue` renders real data with deltas, chart, channel mix; empty/error/
  loading states; `revenue:read` gates API and route policy.
- seed.sql self-validation + openapi_drift green; all four FE gates +
  clippy/check green.
