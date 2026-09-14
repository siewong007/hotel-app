# Nivo chart system + real-data dashboard — design spec

Date: 2026-09-14 · Status: approved by user · Owner: Devin session

## Goal

Replace all chart rendering with Nivo, centralize chart theming/behaviour in one
shared module, and rewire the Reports & Analytics dashboard from seeded sample
data to real backend aggregations (existing endpoints + a small set of new
read-only queries). No schema changes; no fabricated metrics.

## Audit summary

Chart surface in `hotel-web-fe` (verified by full-repo sweep — every `<svg>`
outside `Icon.tsx` and every chart-library import):

| Location | Was | Now | Data |
|---|---|---|---|
| Dashboard KPI cards ×6 | `Sparkline` hand-rolled SVG | `HotelSparkline` (Nivo line) | real daily series per KPI |
| Dashboard "Daily revenue trend" | `LineAreaChart` (sample) | `HotelLineChart` area, 2 series | real room + service revenue |
| Dashboard "Booking source mix" | `Donut` (sample) | `HotelPieChart` donut | real channel mix |
| Dashboard "Occupancy trend" | `LineAreaChart` (sample) | `HotelLineChart` area | real daily occupancy |
| Dashboard "Room type performance" | `BarRows` (occ real, rest sample) | `HotelBarChart` horizontal + metric toggle | real per-type rev/occ/ADR |
| Dashboard "Outstanding ageing" + drawer | `BarRows` (sample) | `HotelBarChart` horizontal | real invoice ageing |
| OccupancyDrawer "occupancy by type" | `BarRows` | `HotelBarChart` horizontal | real |
| `/revenue` `RevenueTrendChart` | recharts ComposedChart | stacked `HotelBarChart` + `HotelLineChart` | real (unchanged endpoint) |
| `/revenue` `ChannelMixTable` | MUI table | keep + inline share bar | real |

Not charts (unchanged): live tiles, room-status stat cells, revenue-state rows,
arrival/departure mini-lists, loyalty tier `LinearProgress`, insights
report-library tables (13 governed tabular reports — precision > visuals there).

## Backend changes (all read-only; `modules/` layout)

### `GET /revenue/overview` — additive response fields
- `kpis.service_revenue: Decimal` — `booking_services.total_price` where
  `status NOT IN ('void')` and `service_date::date` in range (booking-agnostic
  "other revenue").
- `daily[].other_revenue: Decimal` — same sum per service date.
- `room_types: RoomTypePerformance[]` — `{ room_type_id, name, rooms,
  nights_sold, occupancy_rate, adr, room_revenue }` from the existing
  stay-nights CTE `GROUP BY rt.id`; respects `channel_id` filter (ignored for
  `room_type_id` — the breakdown IS the room types).
- `pipeline: { booked, earned, collected, outstanding }`:
  - booked = `SUM(COALESCE(net_revenue, subtotal))` over sold-status bookings
    with `check_in_date > hotel_today` (value of future stays on the books)
  - earned = `kpis.room_revenue` (stay-date basis, already computed)
  - collected = `payments.amount` where `status='completed'` and
    `created_at::date` in range, minus `refund_amount` refunded in range
  - outstanding = `SUM(invoices.balance_due)` where `status IN
    ('issued','overdue') AND balance_due > 0` (point-in-time)

### `GET /revenue/receivables` — new route, `revenue:read`
- `buckets: [{ key, label, total }]` — Current (not yet due) / 1–30 / 31–60 /
  61–90 / 90+ days past `COALESCE(due_date, issue_date)`, over invoices with
  `balance_due > 0 AND status IN ('issued','overdue')`.
- `guests[]` / `companies[]` — top 5 debtors each: name (`billing_name` /
  joined `guests.nick_name` / `corporate_accounts.name`), `invoice_number`,
  `balance`, `bucket`, `due_date`, stay context (`room_number` via bookings).

### `GET /insights/overview` — additive fields (`analytics:read`)
- `arrivals[]`, `departures[]` — rosters mirroring `daily_operations` report
  statuses (arrivals: `check_in_date = today` + confirmed/pending; departures:
  `check_out_date = today` + checked_in/auto_checked_in/late_checkout) with
  `guest_name`, `room_number`, `room_type`, `channel_name`, `check_in_time`/
  `check_out_time` (ETA), `nights`, `balance` (invoice balance_due for the
  booking, 0 when none), `vip` (`guests.vip_status IS NOT NULL`).

No DB migration needed — all queries read existing columns.

## Frontend chart system — `src/components/charts/`

- `useChartTheme()` (`theme.ts`): MUI `useTheme().palette.mode` →
  `tokensFor(mode)` → `{ nivoTheme, palette, grid, axis, positive, negative }`.
  Nivo `Theme` maps text/axis ticks/grid/legends/tooltip container to the
  `chart.*` + `text.*` + `surfaces.*` tokens. `useMediaQuery('(prefers-
  reduced-motion: reduce)')` → `animate={false}`.
- `format.ts` — `compactMoney(symbol)`, `money(symbol)`, `pct`,
  `int`, `shortDate` formatters built on `utils/currency` + `utils/date`.
- `states.tsx` — `ChartLoading` (Skeleton), `ChartEmpty` (icon + message),
  `ChartError` (Alert + retry), `ChartFrame` (fixed-height box wrapping states).
- `HotelLineChart` / `HotelBarChart` / `HotelPieChart` / `HotelSparkline` —
  thin wrappers injecting theme/motion/a11y defaults then spreading all
  remaining Nivo props through (no feature-hiding abstraction).

Deps: add `@nivo/core @nivo/line @nivo/pie @nivo/bar` (0.99.x — React 19
supported per upstream changelog); remove `recharts`.

## Dashboard rewiring (`features/dashboard/components/reports/`)

`useReportsModel` becomes: `insights/overview` (live tiles + rosters) +
`revenue/overview` with the dashboard range/filters (KPIs, daily, channels,
room types, pipeline) + `revenue/receivables` (ageing + debtors). The
`useBookingStats` call is dropped. All seeded constants (`buildDaily`,
`SOURCES`, `AGEING`, `GUEST_BAL`, `COMPANY_BAL`, `ARRIVALS`, `DEPARTURES`,
`ROOM_TYPES_SAMPLE`) are deleted.

Controls become real:
- Date range presets (7/30/90 days) → `from/to`.
- Room type + channel selects → `room_type_id`/`channel_id` (options from
  `RoomsService.getRoomTypes` + `ReportsService.getBookingChannels`).
- Compare: `prev` uses `previous_kpis`; `month`/`year` issue a second
  overview call on the shifted window (real baselines).
- Decorative Property/Status pills removed.

Charts migrate per the audit table; every panel gets a real tooltip, legend
where multi-series, and empty/loading states via `ChartFrame`. The "Finance
only" `Locked` pattern stays: revenue queries run `enabled:
hasPermission('revenue:read')`; panels degrade to locked/empty for users
without it (audience is admin/manager — they have it).

## Revenue page

`RevenueTrendChart` → card containing two stacked Nivo charts sharing the date
axis: `HotelBarChart` (room nights) over `HotelLineChart` (occupancy %).
Tooltip rows include room revenue + ADR. `ChannelMixTable` keeps the table and
gains an inline share bar in the Share column.

## Testing

- Rust: unit tests for new service math (ageing bucketing, pipeline rules);
  repository queries get one live-PG fetch test each per AGENTS.md
  (DATABASE_URL-gated, matching existing test conventions).
- FE: unit tests for `format.ts`, `theme.ts`, and the reports model
  transforms; update `RevenueOverviewPage.test.tsx` mock (same import path).
- Gates: `cargo check/test/clippy --all-features`, `HOTEL_APP_UPDATE_OPENAPI=1
  cargo test --test openapi_drift`, `bun run typecheck && lint && test && build`.

## Out of scope (documented follow-ups)

- Per-report charts in the insights library (envelopes carry no series hints).
- Booking pace / lead-time distribution / forecast lines (no backend data).
- Payroll visualizations (no payroll domain exists).
