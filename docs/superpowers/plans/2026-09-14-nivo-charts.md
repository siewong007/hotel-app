# Nivo Charts + Real-Data Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: executing-plans. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all chart rendering to Nivo behind a shared design-system
module and rewire the Reports & Analytics dashboard to real backend data.

**Architecture:** Spec at `docs/superpowers/specs/2026-09-14-nivo-charts-design.md`.
Backend = additive fields on `revenue/overview` + `insights/overview`, plus new
`revenue/receivables`. Frontend = `src/components/charts/` shared module;
dashboard reports subsystem rewired to live queries.

**Tech Stack:** Rust/Axum/SQLx (runtime queries, no macros) · React 19 + Nivo
0.99 + MUI 9 + TanStack Query · bun.

## Global Constraints

- BE: plain `sqlx::query()` (no macros); `hotel_today()` for business dates;
  `param!`/`current_timestamp` helpers where applicable; decimal fields
  serialize as strings (mirror `RevenueDailyPoint`).
- FE: HTTP only via `src/api/client.ts`; dates via `src/utils/date.ts`
  (no `toISOString().split` — lint-banned); money via `utils/currency`.
- Nivo props must spread through wrappers — no feature-hiding abstraction.
- Charts must render in both theme modes and respect `prefers-reduced-motion`.
- Do NOT touch: `hotel-app-be/tests/guest_relations.rs`,
  `hotel-app-be/tests/payment_characterization.rs` (another session's work).
- Gates per phase: BE `cargo check --all-features` + `clippy -D warnings` +
  `test --all-features`; FE `typecheck && lint && test`; `build` at the end.
- Route addition requires `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --test
  openapi_drift` regen.

---

### Task 1: BE — extend `revenue/overview` models + queries

**Files:**
- Modify: `hotel-app-be/src/modules/revenue/models.rs`
- Modify: `hotel-app-be/src/modules/revenue/repository.rs`
- Modify: `hotel-app-be/src/modules/revenue/service.rs`

**Interfaces:**
- `RevenueKpis` += `service_revenue: Decimal`, `total_revenue: Decimal`
  (room + service)
- `RevenueDailyPoint` += `other_revenue: Decimal`
- New `RoomTypePerformance { room_type_id: i64, name: String, rooms: i64,
  nights_sold: i64, occupancy_rate: Decimal, adr: Decimal, room_revenue:
  Decimal }`
- New `RevenuePipeline { booked, earned, collected, outstanding: Decimal }`
- `RevenueOverview` += `room_types: Vec<RoomTypePerformance>`,
  `pipeline: RevenuePipeline`
- `StaySums` += `service_revenue: Decimal`
- `RevenueRepository::service_revenue(pool, range, room_type_id?, channel_id?)`
  → `booking_services` join bookings for channel/room-type filtering —
  `bs.status <> 'void' AND bs.service_date::date BETWEEN $1 AND $2`, optional
  `b.booking_channel_id`/`r.room_type_id` via JOIN bookings+rooms.
- `RevenueRepository::daily_service(pool, range, rt, ch)` →
  `Vec<(NaiveDate, Decimal)>` merged into `daily` by date in the service.
- `RevenueRepository::room_type_performance(pool, range, channel_id)` →
  stay_nights CTE `GROUP BY rt.id` + physical-room count per type
  (mirror `rate_calendar` phys subquery: active, not maintenance/ooo).
- `RevenueRepository::pipeline(pool, range, today)` → booked
  (`check_in_date > today`, sold status, `COALESCE(net_revenue, subtotal)`),
  collected (`payments status='completed'`, `created_at::date` in range, minus
  `COALESCE(refund_amount,0)` where `refunded_at::date` in range — separate
  SUMs, service subtracts), outstanding (`invoices balance_due > 0`,
  `status IN ('issued','overdue')`).

**Steps:**
- [ ] Extend `StaySums`, write `service_revenue` query, bind into `stay_sums`
  call site (run as separate query — `tokio::try_join!` with the rest) and
  store on a `side` struct — simpler: add `service_sums()` fn and a
  `ServiceSums { service_revenue }` result joined in `overview()`.
- [ ] Extend `kpis()` signature → `kpis(sums, days, direct_share,
  service_revenue)`; add `service_revenue` + `total_revenue` fields; update
  `deltas()` to include both keys.
- [ ] Extend `daily()` — second query `daily_service`, merge in service by
  `date` (fill 0 for missing days); `fill_daily` rounds `other_revenue`.
- [ ] Write `room_type_performance` + `pipeline` queries; wire into
  `overview()` via `try_join!`; `pipeline.earned = current.room_revenue`.
- [ ] Unit tests in `service.rs`: `kpis` with service revenue →
  `total_revenue = room + service`; `merge` daily service fills zeros.
- [ ] `cargo check --all-features && cargo test --all-features revenue` +
  `cargo clippy --all-features -- -D warnings`
- [ ] Commit: `feat(be): extend revenue overview with service revenue, per-type performance, and pipeline aggregates`

### Task 2: BE — `GET /revenue/receivables`

**Files:**
- Modify: `models.rs`, `repository.rs`, `service.rs`, `handlers.rs`,
  `routes.rs` (modules/revenue)

**Interfaces:**
- `ReceivablesBucket { key: &'static str, label: &'static str, total: Decimal }`
- `DebtorRow { name: String, invoice_number: String, balance: Decimal,
  bucket: String, due_date: Option<NaiveDate>, room: Option<String> }`
- `Receivables { as_of: NaiveDate, total: Decimal, buckets:
  Vec<ReceivablesBucket>, guests: Vec<DebtorRow>, companies: Vec<DebtorRow> }`
- `RevenueService::receivables(pool)` → hotel_today-anchored; bucket on
  `COALESCE(due_date, issue_date)`: Current = days_past_due <= 0, then 1–30,
  31–60, 61–90, 90+. Guest rows: `bill_to_guest_id IS NOT NULL`, join guests
  for name; company: `bill_to_corporate_id IS NOT NULL` join
  `corporate_accounts`; fallback `billing_name`. Top 5 by balance each.
  `room` via `bookings.room_id → rooms.room_number` (nullable).
- Route: `.route("/revenue/receivables", get(handlers::receivables))` +
  `require_permission_helper "revenue:read"`.

**Steps:**
- [ ] Models + SQL (single query returning all open invoices w/ joins; bucket
  in Rust — deterministic, unit-testable)
- [ ] `age_bucket(days: i64) -> &'static str` + unit tests on boundaries
  (0→Current, 1/30→1–30, 31/60→31–60, 61/90→61–90, 91→90+)
- [ ] Route + handler + openapi regen
- [ ] `cargo check/test/clippy`; commit: `feat(be): add receivables ageing endpoint`

### Task 3: BE — arrivals/departures rosters on `insights/overview`

**Files:**
- Modify: `modules/insights/models.rs`, `queries.rs`, `service.rs`

**Interfaces:**
- `RosterRow { booking_id: i64, guest_name: String, room_number:
  Option<String>, room_type: String, channel_name: String, eta: String,
  nights: i64, balance: Decimal, vip: bool }`
- `InsightsOverview` += `arrivals: Vec<RosterRow>`, `departures:
  Vec<RosterRow>`
- `queries::arrival_roster(pool, today)` — check_in = today, status
  `confirmed|pending`; `departure_roster` — check_out = today, status
  `checked_in|auto_checked_in|late_checkout`. ETA =
  `to_char(check_in_time,'HH24:MI')`; channel = `COALESCE(bc.name,'Direct')`;
  balance = `COALESCE((SELECT SUM(balance_due) FROM invoices i WHERE
  i.booking_id = b.id AND i.status IN ('issued','overdue')),0)`; vip =
  `g.vip_status IS NOT NULL`; room_number nullable (unassigned).

**Steps:**
- [ ] Models + queries + service wiring (parallel with existing calls via
  `tokio::try_join!`)
- [ ] `cargo check/test/clippy`; commit: `feat(be): expose arrival/departure rosters on insights overview`

### Task 4: FE — install Nivo, build `src/components/charts/`

**Files:**
- `package.json` (bun add/remove)
- Create: `src/components/charts/{index.ts,theme.ts,format.ts,states.tsx,
  HotelLineChart.tsx,HotelBarChart.tsx,HotelPieChart.tsx,HotelSparkline.tsx}`
- Create tests: `format.test.ts`, `theme.test.ts`

**Interfaces:**
- `useChartTheme(): { theme: NivoTheme, palette: string[], positive: string,
  negative: string, animate: boolean }`
- `compactMoney(symbol)(n)`, `money(symbol)(n)`, `pct(d?)(n)`, `int(n)`,
  `shortDate(iso)`
- `<ChartFrame height loading error empty onRetry>{children}</ChartFrame>`
- Wrappers take full Nivo prop types (`LineSvgProps` etc.), inject
  `theme`/`animate`/`margin` defaults, spread rest.

**Steps:**
- [ ] `bun add @nivo/core @nivo/line @nivo/pie @nivo/bar` (verify resolved
  versions ≥0.99.0 and lockfile diff is sane)
- [ ] Write theme hook — `useTheme().palette.mode` → `tokensFor(mode)`; nivo
  Theme: `text.fill`, `axis.ticks.text`, `grid.line.stroke`, `legends.text`,
  `tooltip.container` (bg/border/radius/shadow from tokens), `labels.text`,
  `dots.text`, `annotations.*` minimal set.
- [ ] Write format utils + unit tests (compact k/m rounding, zero-decimal
  currencies, pct decimals, ISO date → `d MMM`).
- [ ] Wrappers + states; vitest render smoke (jsdom): each chart renders an
  `svg` with role=img given data; `ChartFrame` swaps states.
- [ ] `bun run typecheck && bun run test`
- [ ] Commit: `feat(fe): add shared Nivo chart system (theme, format, states, wrappers)`

### Task 5: FE — migrate `/revenue` page

**Files:**
- Rewrite: `features/revenue/components/RevenueTrendChart.tsx` (keep filename +
  default export so the page test mock path is unchanged)
- Modify: `features/revenue/components/ChannelMixTable.tsx` (share bar)
- Modify: `features/revenue/pages/RevenueOverviewPage.test.tsx` if needed

**Steps:**
- [ ] Card keeps `CardHeader`; body = `HotelBarChart` (room nights, ~150px)
  over `HotelLineChart` (occupancy %, ~170px), shared date labels; rich
  tooltips (date, nights, revenue, ADR / occupancy + nights); `ChartFrame`
  empty state when `daily` is empty.
- [ ] ChannelMixTable: thin background bar behind share % (`Box` with width
  %, token `primary.subtle` — not a chart lib).
- [ ] `bun run test` (page test still passes via mock) + typecheck
- [ ] Commit: `feat(fe): migrate revenue trend chart to stacked Nivo charts`

### Task 6: FE — dashboard model + services rewiring

**Files:**
- Modify: `features/insights/types.ts` (+ rosters), `features/revenue/types.ts`
  (+ new fields, `Receivables`), `features/revenue/api.ts` (+`receivables`),
  `features/dashboard/components/reports/reportsModel.ts` (rewrite)
- Create: `features/dashboard/components/reports/useReportsData.ts` (3 queries)

**Steps:**
- [ ] Types for new response fields; `RevenueApi.receivables()`.
- [ ] `useReportsData(range, roomTypeId, channelId, canViewFinancials)` →
  `{ overviewQ, revenueQ (enabled: canViewFinancials), receivablesQ (same) }`.
- [ ] Rewrite `useReportsModel` — map real fields onto the existing
  `ReportsModel` shape where panels keep working; delete all seeded builders.
  `arrivals`/`departures`/`ageing`/`sources`/`roomTypes`/`revenueStates`/
  `guestBalances`/`companyBalances`/`daily`/`kpis` all real; `outstanding`
  KPI from receivables total; spark data from `daily` (no spark for
  outstanding — hide on that card).
- [ ] `prevOf` → compare against `previous_kpis` or a second overview call
  (shifted window) selected by compare mode.
- [ ] Unit-test the pure mapping fns.
- [ ] Commit: `feat(fe): wire reports dashboard model to real endpoints`

### Task 7: FE — migrate dashboard charts, panels, drawers, controls

**Files:**
- Modify: `ReportsAnalytics.tsx`, `drawers.tsx`, `reports.css`
- Replace: `charts.tsx` → `atoms.tsx` (keep `Money`, `Delta`, `Pill`,
  `cssVar`; drop `Sparkline`/`LineAreaChart`/`Donut`/`BarRows`/`useMeasure`)
- Update imports in both consumers.

**Steps:**
- [ ] Filters row → real controls: range `Seg` (7/30/90), MUI Selects for room
  type + channel (All default); remove Property/Status pills; keep Compare
  `Seg`.
- [ ] KPI cards → `HotelSparkline` with real series; outstanding card without
  sparkline.
- [ ] Revenue trend → `HotelLineChart` (room + service areas, legend,
  tooltip).
- [ ] Source mix → `HotelPieChart` donut, center metric, legend w/ share.
- [ ] Occupancy trend → `HotelLineChart` area, 0–100 axis.
- [ ] Room type perf → `HotelBarChart` horizontal + metric Seg
  (Revenue/Occupancy/ADR).
- [ ] Ageing panel + both drawer `BarRows` → `HotelBarChart` horizontal
  (fixed row height per bucket so drawer height is stable).
- [ ] Update the foot-note copy (no more "sample figures" for wired panels).
- [ ] `bun run typecheck && lint && test`
- [ ] Commit: `feat(fe): migrate reports dashboard to Nivo with real data`

### Task 8: Cleanup + docs + report

- [ ] `bun remove recharts`; verify no imports remain (grep).
- [ ] Remove dead CSS (`.barrow*`, `.donut-*`, `.ch-axis`, `.kpi-spark svg`
  as applicable).
- [ ] `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test
  openapi_drift` → commit regenerated spec.
- [ ] `bun run build`; full gates: FE three gates + build; BE check/test/clippy.
- [ ] Update `docs/DEPENDENCIES.md` if it lists recharts; write
  `docs/superpowers/reports/2026-09-14-nivo-chart-migration.md` (audit table,
  decisions, summary counts).
- [ ] Final commit.
