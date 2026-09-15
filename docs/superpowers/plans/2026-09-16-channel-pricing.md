# Channel Pricing & Distribution Cost — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: executing-plans (inline execution
> chosen by user). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Channel-specific selling-price rules + effective-dated commission +
booking-time revenue snapshots, feeding staff channels and the guest portal.

**Architecture:** `modules/booking_channels/` grows `pricing.rs` (pure resolver)
+ rule/mapping CRUD; portal and staff write paths consume one engine; snapshots
persist economics on `bookings`.

**Spec:** `docs/superpowers/specs/2026-09-16-channel-pricing-design.md`

## Global Constraints

- Rust: `snake_case` fns/vars, `PascalCase` types; repo verbs `find_by_id|list|insert|update|delete|exists`; service domain verbs.
- SQL via `param!(N)`/`current_timestamp()` helpers; plain `sqlx::query()` (no macros — runtime type checking only); new `FromRow` over numeric/date needs a live-PG fetch test.
- Schema changes: baseline (pg_dump shape; new cols LAST in CREATE TABLE; FKs in the ALTER section) **and** idempotent patch `0006` registered in `manifest.tsv` + `deploy/deploy.sh` + `deploy/deploy-staging.sh` + `.github/workflows/deploy.yml` + `deploy-staging.yml`; mirror via `bun run sync:resources`.
- Permissions: `<resource>:<action>`; `channels:manage` implies all `channels:*`. Seed checklists: `permissions` INSERT, `role_permissions` grants, `route_access_policies` + `expected_route_access_policies`.
- Never rewrite stored booking economics; snapshots are write-time only.
- Money: `Decimal` end-to-end, `round_dp(2)`; FE money via existing utils.
- FE: ky via `src/api/client.ts`; `useTranslation` namespaces; semantic tokens; no `toISOString().split` (use `src/utils/date.ts`).
- `bookings/` and `rooms/` FE files + `modules/bookings/*` carry uncommitted changes from a concurrent session — additive edits only, do not revert.
- Verify: `cargo check --all-features`, `cargo clippy --all-features -- -D warnings`, `cargo test --all-features` (needs `DATABASE_URL` for PG suites), `bun run typecheck && bun run lint:strict && bun run test`, openapi regen via `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`.

---

### Task 1: Schema — baseline + patch 0006 + registration

**Files:**
- Modify: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`
- Create: `hotel-app-be/database/postgres/patches/0006_channel_pricing.sql`
- Modify: `hotel-app-be/database/postgres/patches/manifest.tsv`
- Modify: `deploy/deploy.sh` (file list ~L68 + install ~L337)
- Modify: `deploy/deploy-staging.sh` (same two lists)
- Modify: `.github/workflows/deploy.yml`, `.github/workflows/deploy-staging.yml` (bundle copy lists)
- Modify: `hotel-app-be/database/postgres/seed.sql` (permissions, grants, route policy, expected list, channel seed cols)
- Modify: `hotel-app-be/src/modules/data_transfer/service.rs` (export table list)

- [ ] Baseline: add `channel_pricing_rules`, `channel_commission_rules`, `channel_room_type_mappings`, `channel_rate_plan_mappings` (bodies + identity ALTERs + PK/FK ALTERs per pg_dump shape); `booking_channels` gains `abbreviation varchar(8)`, `code varchar(40)`, `integration_mode varchar(20) NOT NULL DEFAULT 'manual'` CHECK `('manual','channel_manager','api')`; `bookings` gains `channel_pricing_snapshot jsonb` (last column). Indexes: `(channel_id, room_type_id, effective_from, effective_to)` on both rule tables.
- [ ] Patch `0006`: same objects with `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`; `DO` guards for CHECK adds; permission inserts `channels:read|write|manage` (`is_system_permission true`); grants to `admin`,`super_admin`,`manager`; `route_access_policies` upsert for route `channels` (path `/channels`, nav group `revenue`, required `["channels:read"]`, nav `["navigation_revenue:read","channels:read"]`).
- [ ] `manifest.tsv`: `1⇥6⇥channel-pricing⇥sha256:<sha256 of file>⇥0006_channel_pricing.sql` (compute with `shasum -a 256` after writing; LF endings only).
- [ ] Deploy scripts + workflows: add `0006` to every patch list.
- [ ] `seed.sql`: permissions INSERT (`channels:read/write/manage`), manager grant list gains all three, `route_access_policies` row + `('channels')` in `expected_route_access_policies`, `booking_channels` INSERT gains `abbreviation`/`code`/`integration_mode` (set sensible codes: `direct`, `walk_in`, `phone`, `direct_website`, `booking_com`, `agoda`, `traveloka`, `expedia`, `hotels_com`, `airbnb`, `trip_com`, `other_ota`; abbreviations from the JSON setting: B.C, A.C, T.C, E.C, H.C, AB, TR, DW, OT; direct channels get their own).
- [ ] `data_transfer` export list: append the four new tables.
- [ ] `bun run sync:resources` in `hotel-desktop/` to mirror.
- [ ] Run `cargo test --all-features --test postgres_patch_catalog` — must pass (needs `psql` on PATH).

### Task 2: Backend models

**Files:** `hotel-app-be/src/modules/booking_channels/models.rs`

- [ ] Extend `BookingChannel` (+`abbreviation`, `code`, `integration_mode`) and `BookingChannelInput`/`Update`.
- [ ] New: `ChannelPricingRule`, `ChannelPricingRuleInput`/`Update`, `ChannelCommissionRule`, `ChannelCommissionRuleInput`/`Update`, `ChannelRoomTypeMapping`, `ChannelRatePlanMapping`, `ChannelMappingsInput`, `ChannelPricePreview{Request,Response}`, `ChannelMatrix{Cell,Row}`, `ChannelPriceBreakdown`, `NightlyChannelPrice`.
- [ ] `FromRow` impls matching existing style (`try_get`, `get_opt_decimal` for numerics).

### Task 3: Pricing engine (pure)

**Files:** Create `hotel-app-be/src/modules/booking_channels/pricing.rs`; `mod.rs` re-export.

- [ ] `pub enum ChannelRuleKind` (markup_percent|markup_fixed|discount_percent|fixed_price|net_rate) + `RuleScope { room_type_id: Option<i64>, rate_plan_id: Option<i64> }`, `PricedNight { date, source_rate, selling_price: Option<Decimal>, rule_id: Option<i64>, rule_label }`, `ChannelQuote { nights, selling_subtotal: Option<Decimal>, commission_base, commission_type/value/scope, commission_amount, net_revenue, snapshot: Value }`.
- [ ] `apply_rule(source: Decimal, rule) -> Option<Decimal>` (None for net_rate sell price); `clamp_and_round`; `select_rule(rules, date, room_type_id, rate_plan_id) -> Option<&rule>` implementing priority→specificity→created_at ordering; `commission_for(scope, type, value, base, nights)`; `resolve_quote(...)` combining per-night + commission + snapshot jsonb.
- [ ] Unit tests in-file (`#[cfg(test)]`): each rule type math, clamps, precedence, windows, net_rate semantics, commission scopes, rounding.

### Task 4: Repository

**Files:** `hotel-app-be/src/modules/booking_channels/repository.rs`

- [ ] Rules CRUD: `list_rules(channel_id)`, `insert_rule`, `update_rule`, `delete_rule`, `active_rules_for(channel_ids, from, to)`; same for commission rules; mappings `get_mappings`/`upsert_*_mapping`.
- [ ] `direct_booking_channel` already exists in guest_booking repository — reuse; add `channel_by_id`.
- [ ] Commission resolution: `commission_rule_for(channel_id, stay_date)` — dated rule else channel default.

### Task 5: Service + routes + handlers

**Files:** `service.rs`, `handlers.rs`, `routes.rs` in `modules/booking_channels/`; `src/routes/mod.rs` merge (already merged — same module).

- [ ] Permission gates: `channels:read` (GET incl. preview/matrix), `channels:write` (POST/PATCH), `channels:manage` (DELETE/activate). Replace `settings:update`/`analytics|reports` gates.
- [ ] Endpoints per spec §API surface. Preview resolves via engine using room type + optional plan source rates (reuse rate resolution from `rates`/`guest_booking` — expose a shared `source_rate_for(room_type_id, date, rate_plan_id)` helper; portal logic stays canonical).
- [ ] `AuditLog::log_event` per mutation with `reason`.
- [ ] Validation: percentage ≤100, positive values, window order, overlap detection → `409` with conflicting rule id (same scope + overlapping window → warn; allow different scope).
- [ ] `cargo check`, regen openapi: `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`.

### Task 6: Booking snapshot on write

**Files:** `modules/bookings/lifecycle.rs` (INSERT ~L1169, UPDATE ~L1685), `modules/guest_booking/repository.rs` (`insert_booking_tx` ~L630), `modules/bookings/models.rs` (input fields).

- [ ] After computing totals: `resolve_quote` for `booking_channel_id` → bind `channel_pricing_snapshot`, `commission_amount`, `net_revenue`; `rate_plan_id` when a plan was applied.
- [ ] Update path: re-snapshot when dates/channel/daily_rates/room_rate change; preserve manual `commission_*_override` (add fields to `BookingUpdateInput`, `channels:write`-gated in handler).
- [ ] Snapshot JSON: `{rule_id, rule_type, rule_value, source_subtotal, selling_subtotal, commission_{type,value,scope}, commission_amount, net_revenue, resolved_at}`.
- [ ] Integration test (`tests/`, PG-gated): booking with channel persists snapshot; later rule edit doesn't move it.

### Task 7: Portal wiring

**Files:** `modules/guest_booking/service.rs` (`nightly_rates` ~L126).

- [ ] After `custom_price > base` resolution, apply Direct-Website channel rules per night (engine); no rules → identical output. Rates labeled with rule code when applied.

### Task 8: Analytics snapshot precedence

**Files:** `modules/analytics/channel_net_revenue.rs`

- [ ] `RawRevenueRow` gains `stored_commission_amount`, `stored_net_revenue`; `commission_for_row` prefers stored snapshot → override → dated rule → channel default → legacy rate.

### Task 9: Frontend `features/channels`

**Files:** create `hotel-web-fe/src/features/channels/{api.ts,types.ts,index.ts,constants.ts,pages/ChannelsPage.tsx,pages/ChannelDetailPage.tsx,components/{ChannelListTable,ChannelPricingRulesEditor,ChannelCommissionEditor,ChannelMappingsEditor,ChannelPricePreview,ChannelPricingMatrix}.tsx}`; modify `src/navigation/routeRegistry.tsx` (+lazy import, route `channels`, path `/channels`, navGroup `revenue`); i18n `en/ms/zh` `channels.json` + parity.

- [ ] `ChannelsApi` on `api` (ky) — channels CRUD + rules + commission + mappings + preview + matrix.
- [ ] List page → detail page (rules/commission/mappings/preview tabs) + matrix view.
- [ ] Money via existing format utils; status via `formatStatusLabel`; WCAG-safe tones.

### Task 10: Settings deprecation + booking-dialog preview

**Files:** `features/user/components/settings/SystemConfigurationCard.tsx`, `features/bookings/utils/bookingChannel.ts`, `features/admin/components/NightAuditReportViews.tsx`, `EditBookingDialog.tsx` (channel price hint).

- [ ] Chips read/write `booking_channels` API (name + abbreviation); JSON setting becomes read-fallback only.
- [ ] Booking dialogs show resolved channel price + est. net on channel select (call preview endpoint; `channels:read`-gated).

### Task 11: Tests

- [ ] BE unit (pricing.rs in-file) — Task 3.
- [ ] BE integration `tests/channel_pricing.rs` (PG-gated, early-return without `DATABASE_URL`): permission gates, rule CRUD, preview math, snapshot persistence, portal quote parity without rules.
- [ ] FE vitest: api service, rules editor validation, preview rendering.

### Task 12: Docs

- [ ] `docs/FEATURES.md` row; `.claude/refs/booking-workflow.md` snapshot note; `docs/architecture/ADRS.md` entry; `CLAUDE.md` module count (38→38, same module extended); `docs/ongoing-dev.md` remove/add as appropriate.

### Task 13: Verification

- [ ] `cargo check --all-features && cargo clippy --all-features -- -D warnings`
- [ ] `cargo test --all-features` (judge PG suites by wall-clock/per-suite counts)
- [ ] `bun run typecheck && bun run lint:strict && bun run test && bun run build`
- [ ] openapi drift test green after regen
