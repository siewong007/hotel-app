# Chart system migration — Recharts + custom SVG → Nivo

Date: 2026-09-14 · Spec: `docs/superpowers/specs/2026-09-14-nivo-charts-design.md` · Plan: `docs/superpowers/plans/2026-09-14-nivo-charts.md`

## Summary

- **Charts audited:** 8 chart surfaces (1 recharts composed chart, 7 custom SVG/CSS primitives across the Reports & Analytics dashboard and its drawers). Non-chart visuals (live tiles, loyalty tier progress, room timelines, insights report tables) were audited and deliberately excluded.
- **Migrated:** 8/8.
- **Redesigned:** 5 (KPI sparklines, daily revenue trend, source mix donut, occupancy trend, revenue page dual-axis chart → two stacked charts).
- **Consolidated:** 0 — no redundant charts existed.
- **Removed:** 0 chart surfaces; the hand-rolled `Sparkline`/`LineAreaChart`/`Donut`/`BarRows` primitives were deleted.
- **Backend changes required:** 3 (revenue overview extension, new receivables endpoint, insights rosters) — all implemented.
- **Follow-up work:** none blocking; see notes.
- **Old dependencies removed:** `recharts` (was the only chart lib).
- **New dependencies added:** `@nivo/core`, `@nivo/line`, `@nivo/pie`, `@nivo/bar` (all 0.99.x, React 19-compatible). No other Nivo packages — no data supports scatter/radar/heatmap/treemap/funnel/geo.

## Inventory → outcome

| Location | Existing Chart | Problem | Recommended Chart | New Information | Data Changes Needed | Status |
|----------|----------------|---------|-------------------|------------------|---------------------|--------|
| Reports & Analytics — 6 KPI cards | `Sparkline` (custom SVG) | Seeded RNG series; random gradient ids; decorative | `HotelSparkline` (Nivo line) | Real daily series per metric | `revenue/overview` daily | Migrated + real data |
| Dashboard — Daily revenue trend | `LineAreaChart` 2-series | No tooltip, no a11y, NaN at n=1, sample data | `HotelLineChart` 2-series area | Real room + service revenue, per-slice occupancy in tooltip | `daily[].other_revenue` added | Migrated + real data |
| Dashboard — Booking source mix | `Donut` + HTML legend | No tooltips, sample data, dasharray edge cases | `HotelPieChart` donut + legend | Real net-revenue share + bookings per channel | `channels[]` reused | Migrated + real data |
| Dashboard — Occupancy trend | `LineAreaChart` | Sample data, no a11y | `HotelLineChart` area, fixed 0–100 axis | Real daily occupancy, rooms-sold in tooltip | `daily[].occupancy_rate` | Migrated + real data |
| Dashboard — Room type performance | `BarRows` CSS | ADR/revenue sample; no keyboard | `HotelBarChart` horizontal | Real per-type ADR + revenue + rooms | `room_types[]` added | Migrated + real data |
| Dashboard — Outstanding ageing + OutstandingDrawer | `BarRows` | All sample | `HotelBarChart` horizontal, semantic ageing colors | Real invoice ageing, invoice counts, debtor tables | New `GET /revenue/receivables` | Migrated + real data |
| OccupancyDrawer — occupancy by type | `BarRows` | OK but inconsistent tech | `HotelBarChart` horizontal, 0–100 scale | Tooltip with rooms count | Reused | Migrated |
| `/revenue` — `RevenueTrendChart` | recharts ComposedChart, dual axis | No legend, two units on one plot | Two stacked: `HotelBarChart` (room nights) + `HotelLineChart` (occupancy) | Richer tooltips (date, revenue, ADR) | Reused | Redesigned + migrated |
| `/revenue` — `ChannelMixTable` | MUI table | Fine — precision table, not a chart | Unchanged | — | — | Retained (not a chart) |
| Arrivals / departures panels + FlowDrawer | `MiniList` + tables | Named rosters were hardcoded samples | Unchanged (lists, not charts) | Real rosters w/ guest, room, type, source, ETA, nights, balance, VIP | `insights/overview` rosters added | Real data |

## Architecture

`hotel-web-fe/src/components/charts/` — shared system:

- `theme.ts` — `useChartTheme()`: maps `DesignTokens` (per light/dark mode) to Nivo's theme (text, axis, grid, legend, tooltip, crosshair) + categorical palette + `prefers-reduced-motion` → `animate={false}`.
- `format.ts` — `fmtMoney`, `fmtCompactMoney`, `fmtPct`, `fmtInt`, `fmtShortDate` over existing currency/date utils.
- `states.tsx` — `ChartLoading`/`ChartEmpty`/`ChartError`/`ChartStateGate`.
- `HotelLineChart`, `HotelBarChart`, `HotelPieChart`, `HotelSparkline` — thin wrappers applying the theme and sensible defaults; all Nivo props pass through.

## Backend additions (`hotel-app-be`)

- `GET /revenue/overview` extended: `kpis.service_revenue`, `kpis.total_revenue`, `daily[].other_revenue`, `room_types[]`, `pipeline{booked,earned,collected,outstanding}` (`revenue:read`).
- `GET /revenue/receivables` (new): ageing buckets (Current/1–30/31–60/61–90/90+) from open invoices by `COALESCE(due_date, issue_date)`, top guest/company debtors (`revenue:read`).
- `GET /insights/overview` extended: `arrivals[]`/`departures[]` rosters — guest, room, type, channel, ETA/checkout time, nights, folio balance, VIP (`analytics:read`).

No schema changes; `docs/api/openapi.json` regenerated.

## Controls (now real)

- Range: 7/30/90 days → `revenue/overview` `from`/`to`.
- Room type + Source selects → `room_type_id`/`channel_id` params (options from loaded data).
- Compare: "Prev period" uses `previous_kpis`; "Last month"/"Last year" issue a second overview call on the shifted window with identical filters.
- Decorative Property/Status pills removed (single property; no status dimension exists).

## Notes / follow-up

- `Outstanding` KPI is point-in-time: no sparkline and "· no prior" delta — honest, not a gap.
- RevPAR sparkline derives per-day sellable rooms from the range aggregate (`nights_sold ÷ occupancy ÷ days`); zero → spark hidden.
- `useDashboardAnalytics` and `useBookingStats` remain for other features; the reports model now reads `insights/overview` + `revenue/overview` + `revenue/receivables` directly.
- `PortalBookingPageAnonymous` test flaked once under the full suite (timing, `waitFor` timeout); passes standalone and is unrelated to this change.
