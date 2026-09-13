# Revenue & Marketing Module Redesign — Design Spec

Date: 2026-09-13
Status: Approved (owner reviewed audit + design decisions 2026-09-13)

## Goal

Turn today's scattered revenue and marketing capabilities into one cohesive
Revenue & Marketing workspace: a real revenue dashboard with hotel KPIs
(occupancy, ADR, RevPAR, room nights, channel share), a managed rates and
availability surface, a unified campaign model (promotions + vouchers + email
campaigns), rule-based guest segmentation wired into communications, and
honest analytics — built on shared backend services with no duplicated
discount, eligibility, or analytics engines.

## Decisions locked with owner

1. **Full program** — phases 0–6 below are all in scope.
2. **New `revenue` nav group** in the sidebar (order: finance → revenue →
   engagement → property → insights).
3. **Work around in-flight voucher-audit changes**: another session owns
   uncommitted edits to `src/modules/promotions/repository.rs`,
   `tests/promotions_admin.rs`, and untracked `database/seed_voucher_audit.sql`.
   Do not touch those files; if a task genuinely needs one, flag it first.

## Current state (audit summary, verified against the tree)

- `modules/promotions`: promotion + voucher model. `promotion_kind` ∈
  {deal, voucher}; statuses {draft, published, paused, archived} with guarded
  transitions + optimistic `version` + audit events. Targeting: room types
  only (`promotion_room_types`). Claim window, stay window, min/max nights,
  min subtotal, claim limit, per_guest_limit (=1 enforced). Claiming ANY
  promotion (deal or voucher) mints a guest-bound voucher — there is no
  auto-apply path.
- `vouchers` → `voucher_redemptions` (booking-level gross/discount/net) →
  `voucher_redemption_allocations` (per stay_date; **table exists but is never
  written** — only data_transfer references it).
- **Two discount engines**: `services/promotion_pricing.rs` (pure, fully
  tested, `#![allow(dead_code)]`, unused) vs `guest_booking/service.rs`
  `voucher_discount`/`settlement`/`complimentary_discount` (live).
- `rate_plans` (plan_type ∈ {standard, seasonal, promotional, corporate,
  group, package}; adjustment_type ∈ {percentage, fixed, override};
  day-of-week flags; min/max nights; advance booking; blackout dates;
  priority) + `room_rates` (plan × room_type × date band). Full CRUD at
  `/api/rate-plans`, `/api/room-rates` — **no frontend consumes it**.
- `online_inventory_allocations`: room_type × stay_date →
  walk_in_reserved_rooms, online_booking_enabled (online stop-sell),
  custom_price override. Managed by `modules/guest_booking` +
  `features/onlineInventory` grid (bulk edit + review dialog).
- `booking_channels` (8 channel types + commission defaults);
  `bookings.booking_channel_id` FK + `net_revenue`; `channel_net_revenue`
  repository (net-after-commission reports). Bookings also carry legacy
  `source`/`channel` varchars and `market_code`.
- `modules/communications`: `email_campaigns` (announcement|promotion;
  promotion_id FK required for promotion type; draft/scheduled/running/
  completed/cancelled/failed), templates, deliveries, suppressions,
  unsubscribe tokens, SMTP worker + scheduler, topic-consent audience
  (`count_audience_for_topic`: active guest + email + subscribed topic +
  not suppressed).
- `modules/loyalty`: programs, tiers, rules, rewards (min tier), redemptions;
  a reward can mint a promotion voucher (bridge via hardcoded slugs
  `welcome-deluxe-10`, `july-deluxe-20-loyalty` in promotions/service.rs).
- Analytics: `repositories/analytics.rs` (~2.4k lines), 15 report types
  (occupancy, revenue, channel_net_revenue, ota_commission,
  ota_monthly_statement, room_performance, guest_statistics, payment_status,
  complimentary, balance_sheet, journal_by_type, shift_report, rooms_sold,
  general_journal, daily_operations) + SQL views (occupancy_stats,
  hotel_occupancy_summary, revenue_summary, …). **No ADR, RevPAR, ALOS,
  room-nights, cancellation/no-show rates, direct-share metrics anywhere.**
  `AdminOverviewDashboard` computes occupancy/revenue client-side.
- Guests carry country, nationality, date_of_birth, marketing_opt_in,
  vip_status, guest_type, tags[], total_stays, total_spend — sufficient
  segment material with no new guest columns.
- Permissions today: `promotions:read|manage`, `vouchers:read|manage`,
  `communications:read|send|manage`, `analytics:read`, `reports:read|execute`,
  rates gated by `rooms:*`. No `revenue:*`, `rates:*`, `segments:*`,
  `promotions:approve`.
- FE nav groups: overview / operations / finance / engagement / property /
  insights / administration / utility. Promotions + communications under
  engagement; online-inventory under property; reports under insights.
- Docs: `docs/FEATURES.md` claims "Rates, rate plans" delivered (backend yes,
  UI no) — must be corrected, not copied.

## Architecture

### A1 — New backend domain `src/modules/revenue/`

Domain-module layout (`mod.rs routes.rs handlers.rs service.rs repository.rs
models.rs validation.rs` as needed). Owns:

- Revenue metrics queries (new SQL; reads `bookings`, `rooms`, `room_types`,
  `booking_channels`).
- Rate-calendar aggregation (reads `room_rates`, `rate_plans`,
  `online_inventory_allocations`, occupancy counts).
- `stay_restrictions` table (phase 5) and its enforcement hook used by
  `guest_booking` quote + staff booking create.
- Revenue alerts (threshold rules over the metrics service).

Rate-plan/room-rate CRUD stays in existing flat `routes/rates.rs` +
`services/rates.rs` + `repositories/rate.rs` (repointed at `rates:*`
permissions in phase 6). The revenue module reads through
`repositories/rate.rs`; nothing is duplicated.

### A2 — Promotions is the single campaign entity

No `campaigns` table. `promotions` gains (one additive patch):

- `status` CHECK extended with `'cancelled'`; **`scheduled` and `expired` are
  derived states** (published + `claim_starts_at > now`, and
  `claim_ends_at < now`) — no status-writer job.
- `internal_code varchar`, `objective text` (nullable).
- `promotion_channels (promotion_id, booking_channel_id)` —
  empty set = all channels (backward compatible).
- `promotion_loyalty_tiers (promotion_id, tier_id)` — empty = no tier gate.
- `segment_id bigint NULL → guest_segments` is added in the phase-4 patch
  (table must exist first).
- Publish gate gains `promotions:approve` permission (new seed row; roles
  holding `promotions:manage` are granted it by the same patch so existing
  flows keep working).

Eligibility evaluation stays in `guest_booking::eligible_voucher`/`quote`
(claim-window, stay-window, room-type, min nights, min subtotal) extended with
channel + tier + segment predicates — one eligibility path, not per-kind.

Campaign **preview** endpoint: `GET /api/admin/promotions/{id}/preview` →
eligible room types, stay window, channel/tier/segment gates, example
price-after-discount (via the shared engine), overlap warnings (other
published promotions whose stay window + room types intersect), stackability
note (one voucher per booking — current invariant).

Campaign **performance** endpoints under the promotions module:
`GET /api/admin/promotions/{id}/performance` and aggregate
`GET /api/admin/promotions/performance` — claims, redemptions, revenue,
discount given — sourced from `vouchers`/`voucher_redemptions` (real data).

### A3 — One discount engine

`services/promotion_pricing::calculate_promotion_pricing` becomes the single
calculator. `guest_booking` settlement keeps orchestration (complimentary
credits first, then voucher on the payable remainder) but delegates the
discount math; the engine's nightly allocation populates
`voucher_redemption_allocations` on redeem (new additive writes — the table
already exists). Delete `voucher_discount`'s math. Rounding:
midpoint-away-from-zero to minor units (engine) — totals match today's
behavior; document any edge delta in the task summary.

### A4 — Guest segments (dynamic evaluation)

`guest_segments (id, name, description, definition jsonb, status, member_count
cached, last_calculated_at, created_by/updated_by, timestamps)`.

`definition` = `{ "groups": [[{"field","op","value"}]] }` — OR between groups,
AND within. Whitelisted fields compile to parameterized predicates over
guests + booking aggregates + `loyalty_memberships` + voucher existence:
stay count, total spend, last stay date, upcoming booking, booking channel,
room type used, country/nationality, loyalty tier, voucher usage, marketing
opt-in, guest status. **No materialized membership table** — evaluated on
demand; `member_count` cached for list display.

Endpoints: CRUD + `POST /api/admin/segments/preview` (count + ≤10 masked
sample rows; gated `segments:read`). Communications audience gains
`segment_id`: eligible = segment members ∩ topic-subscribed ∩ not
suppressed (extends `count_audience_for_topic`, one code path).

### A5 — Metric definitions (single source, documented)

Stay-date basis: booking nights spread via
`generate_series(check_in_date, check_out_date - 1)`; nightly room revenue =
`subtotal / nights`. Booking-date basis: `created_at::date`.

| Metric | Definition |
|---|---|
| Room revenue | Σ `bookings.subtotal`, statuses confirmed→completed family (excl. voided/no-show-adjusted) |
| Net revenue | Σ `bookings.net_revenue` where present |
| GBV | Σ `bookings.total_amount` |
| Room nights sold | Σ nights (stay basis) |
| Available room nights | active `rooms` count × days in range |
| Occupancy | sold ÷ available |
| ADR | room revenue ÷ room nights sold |
| RevPAR | room revenue ÷ available room nights |
| ALOS | avg `nights` per booking |
| Cancellation rate | voided ÷ bookings created in period |
| No-show rate | no_show ÷ arrivals in period |
| Direct share | channel_type ∈ {direct, website, walk_in, phone} ÷ total |

Previous period = same-length window immediately before; each KPI returns
{value, previous, delta_pct}. All business-day math via `hotel_today`;
money via `Decimal`; parameterized SQL only (`param!`/`sql_compat`).

### A6 — Rates & availability UI + rate calendar

- `/rates` page: rate-plan list + editor covering ALL existing fields
  (plan_type, adjustment, DOW flags, min/max nights, advance booking,
  blackout dates, validity, priority, active) + room-rates editor.
  Extends `api/rates.service.ts` with the existing `/rate-plans`,
  `/room-rates`, `/rate-management/room-types` endpoints.
- Rate calendar: `GET /api/revenue/rate-calendar?from&to&room_type_id`
  → per room_type × day: resolved plan rate, `custom_price` overlay,
  online toggle, walk-in reserve, occupancy, restrictions (phase 5).
  Grid reuses `features/onlineInventory` patterns (selection, cell editor,
  bulk edit + review dialog). Bulk price/stop-sell writes go through a
  preview-first confirm flow.
- Price precedence (documented): `custom_price` (online override) →
  applicable `room_rates` band → rate-plan adjustment → base.

### A7 — Campaigns workspace (frontend)

`/campaigns` route (new) = rebuilt promotions workspace: unified list across
kinds with lifecycle filters (incl. derived scheduled/expired), editor with
targeting sections (room types, channels, loyalty tiers, segment), preview
panel, performance tab. `/promotions` redirects to `/campaigns` (old
bookmarks + `route_access_policies` keys preserved via a new policy row for
`campaigns` mirroring `promotions`). Vouchers remain a tab inside the
workspace.

### A8 — Marketing communications

Existing `modules/communications` stays the engine. Changes: campaign editor
gains a segment picker (uses A4 preview for count display); deliveries list
already shows sent/failed — no open/click tracking (not built; marked
unavailable in UI). Consent/suppression handling unchanged.

### A9 — Permissions (introduced with the patch that needs them)

- Phase 3 patch: `promotions:approve` (publish gate).
- Phase 4 patch: `segments:read`, `segments:manage`.
- Phase 6 patch: `revenue:read`, `rates:read`, `rates:manage`.
- Interim gates before dedicated permissions exist: `/api/revenue/*`
  endpoints gate on `analytics:read` (phase 1); `/api/rate-plans` etc. keep
  `rooms:*` (phase 2). Phase 6 grants `rates:*` to roles holding
  `rooms:manage`/`rooms:update` and `revenue:read` to roles holding
  `analytics:read`, then repoints route gates.
- `route_access_policies` rows for `/revenue`, `/rates`, `/campaigns`,
  `/segments` (added when each page lands so nav gating works immediately).
- Audit events already cover promotion lifecycle; add `rate.updated`/
  `rate_plan.*`/`restriction.*`/`segment.*`/`campaign.email_scheduled`
  events where missing.

### A10 — Revenue alerts

Server-computed from the metrics service (no stored alert rows v1):
forward-occupancy low (next 14d), cancellation spike vs previous period,
ADR drop, promotion low conversion (claims vs redemptions), published
promotions past claim window, room types lacking future rate coverage,
high-occupancy dates priced below plan median. Response item:
{type, severity, title, detail, affected, action_path} — panel on
Revenue Overview, each links to the management page.

## Schema changes (patch catalog, additive only)

- **Patch N (phase 3)**: promotions columns + `promotion_channels` +
  `promotion_loyalty_tiers` + status CHECK update + `promotions:approve`
  permission/role grants.
- **Patch N+1 (phase 4)**: `guest_segments` + `promotions.segment_id` +
  `email_campaigns.segment_id` + `segments:*` permissions.
- **Patch N+2 (phase 5)**: `stay_restrictions` (+ indexes on
  room_type/stay_date).
- **Patch N+3 (phase 6)**: `revenue:read`, `rates:*` permissions + role
  grants + `route_access_policies` rows.
- Every patch: `patches/manifest.tsv`, `deploy.yml`, `deploy.sh`,
  `deploy-staging.*`, `postgres_patch_lifecycle.rs` bounds/list — all
  registration points, per CLAUDE.md.

## API surface (new/changed)

- `GET /api/revenue/overview?from&to&basis=stay|booking` → KPIs + series +
  comparisons
- `GET /api/revenue/alerts`
- `GET /api/revenue/rate-calendar?from&to&room_type_id`
- `POST /api/revenue/rate-calendar/bulk` (preview then commit, same tx)
- `GET /api/admin/promotions/{id}/preview`, `…/performance`, aggregate
  performance list
- `POST /api/admin/promotions/{id}/cancel` (new transition)
- `GET|POST /api/admin/segments`, `…/{id}` PUT/DELETE,
  `POST /api/admin/segments/preview`
- `email_campaigns` create/update accept `segment_id`
- All under `/api` (no proxy changes); openapi.json regenerated per task.

## Non-goals (explicit)

- No auto-applied deal discounts at quote time (claim→voucher→redeem stays
  the only redemption path; auto-apply is a documented future extension).
- No email open/click tracking; no ROI/CPA (no cost data — UI shows
  "unavailable", never fabricated numbers).
- No materialized segment membership; no ML/auto-pricing (alerts are
  threshold-based recommendations only).
- No channel-manager integration; no new dependencies.

## Testing

- Backend: integration tests are `DATABASE_URL`-gated; each phase adds tests
  beside existing ones (`promotions_admin.rs` pattern — note: that file is
  owned by the in-flight session; new tests go in new files). Metric
  correctness tests use seeded fixtures; one live-fetch test per new
  `FromRow` over date/numeric columns (project rule).
- Frontend: Vitest + Testing Library beside each new feature; typecheck,
  lint, test are three gates.
- Functional matrix: rate CRUD + validity windows, campaign lifecycle +
  invalid-transition rejection, eligibility (channel/tier/segment), preview
  output, voucher redemption totals unchanged, segment preview counts,
  metrics vs hand-computed fixtures, permission denials, audit rows.

## Phase plan

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 Consolidation | promotion_pricing wired into quote/redeem; allocations written; attribution doc | — |
| 1 Revenue metrics + Overview | `modules/revenue` metrics + alerts v1; `/revenue` page; nav group added | 0 |
| 2 Rates UI + calendar | `/rates` page; rate-calendar endpoint + grid; bulk edit w/ preview | 1 |
| 3 Campaign unification | promotions patch (status/targeting/approve); `/campaigns` workspace; preview + performance endpoints | 0 |
| 4 Segments + comms | `guest_segments` + evaluation + preview; comms `segment_id`; `/segments` page | 3 |
| 5 Restrictions + alerts v2 | `stay_restrictions` + enforcement + calendar editing; full alert set | 2 |
| 6 Hardening | permission migration, audit gaps, tests, docs (`FEATURES.md` fix, `docs/REVENUE_MARKETING.md`, architecture-flow update) | all |

Each phase = its own detailed implementation plan (written just-in-time),
ends green on `cargo check --all-features`, `cargo clippy --all-features --
-D warnings`, affected `cargo test`, and FE `typecheck`/`lint`/`test`.
