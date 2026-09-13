# Phase 3 — Unified Campaigns

Promotions become the single campaign entity with a full lifecycle, channel and
loyalty-tier targeting, an approval gate on publish, a `/campaigns` workspace
(deals + vouchers as campaign types, `/promotions` redirects), and a per-campaign
performance report built on `voucher_redemptions` + `voucher_redemption_allocations`.

Non-goals (deferred or excluded per the spec): segment targeting lands in
Phase 4 with `guest_segments`; auto-applied deal discounts stay out; email
open/click attribution stays out; staff-side voucher redemption does not exist,
so channel targeting gates the guest-portal (direct) path only today.

## Semantics decided

- **Lifecycle is derived.** Stored `status` stays
  `{draft, published, paused, cancelled, archived}`; the API additionally
  exposes `lifecycle`: `draft|paused|cancelled|archived` pass through,
  `published` resolves to `scheduled` (claim_starts_at > now), `expired`
  (claim_ends_at < now), or `live`. Admin list filtering accepts lifecycle
  values and translates them to `(status, claim-window)` predicates.
- **Cancel is terminal.** `cancelled` is reachable from `draft|published|paused`,
  cannot be edited or re-published, and — because redemption requires
  `status='published'` — freezes outstanding vouchers exactly like `paused`,
  but permanently. `PromotionActionInput` gains an optional `reason` recorded
  in the audit event.
- **Approve gate.** Publish requires `promotions:approve`. `promotions:manage`
  implies it via the existing `<resource>:manage` derivation, so all current
  holders keep working; the new permission enables an approve-only role later.
- **Channel targeting** (`promotion_channels`): empty set = redeemable on every
  channel. Non-empty set gates guest claims (the portal always books on the
  direct channel) and redemption eligibility (`eligible_voucher` receives the
  booking channel and applies the same predicate, so a future staff-side
  redemption path inherits it for free).
- **Tier targeting** (`promotion_loyalty_tiers`): empty set = everyone. Non-empty
  set requires the guest's active `loyalty_accounts.current_tier_id` to be in
  the set at claim AND admin-issue time. It is an acquisition gate — once held,
  a voucher stays redeemable even if the guest later drops tier (same treatment
  as claim limits vs. redemption windows).
- **internal_code**: nullable ops/reference code, unique when present (partial
  index). **objective**: nullable CHECK list
  `('occupancy','acquisition','retention','upsell','loyalty','other')`.
  Both are staff-only — they do not appear on `PublicPromotion`.
- **Performance report** counts only real data: vouchers by status/source,
  applied vs reversed redemptions, discount/gross/net sums, distinct bookings
  and guests, per-night allocation sums, and channel mix of redeemed bookings.
  No fabricated impressions/clicks.

## Task 1 — schema, seed, patch 0021

Baseline (`0001_v1_baseline.sql`, pg_dump ordering — each edit goes to its own
section):

- `promotions_status_check` gains `'cancelled'`.
- `promotions` gains `internal_code varchar(64)` + `objective varchar(24)` with
  `promotions_objective_check` (list above, NULL allowed).
- New tables near `promotion_room_types`:
  `promotion_channels(promotion_id, booking_channel_id, created_at)` and
  `promotion_loyalty_tiers(promotion_id, loyalty_tier_id, created_at)`.
- PK section: composite PKs on both join tables.
- Index section: `promotions_internal_code_key` UNIQUE on
  `(internal_code) WHERE internal_code IS NOT NULL`; reverse-lookup indexes on
  both join tables mirroring `idx_promotion_room_types_room_type`.
- FK section: `promotion_id → promotions ON DELETE CASCADE`;
  `booking_channel_id → booking_channels`, `loyalty_tier_id → loyalty_tiers`
  `ON DELETE RESTRICT`.

`seed.sql` (one-shot bootstrap — every checklist that validates counts must be
updated): `promotions:approve` in the permission-names INSERT list and the
permission catalog row ('Approve and publish campaigns'); the `/promotions`
policy row becomes `('campaigns', '/campaigns', 'Campaigns', 'revenue',
'["promotions:read"]', ..., '["navigation_promotions:read","promotions:read"]',
..., '["guest"]', true, true)`.

`database/postgres/patches/0021_campaign_targeting.sql` (idempotent, additive):
`ALTER TABLE … DROP/ADD` the status check, `ADD COLUMN IF NOT EXISTS` the two
columns + objective check, `CREATE TABLE IF NOT EXISTS` both joins (with PKs,
indexes, FKs inline since a patch creates them fresh), `INSERT … ON CONFLICT`
the `promotions:approve` permission + catalog row, `DELETE` the `promotions`
route policy and upsert the `campaigns` row. Grant backfill is unnecessary —
`manage` implies `approve`.

Registration (all six): `manifest.tsv` + sha256, `deploy/deploy.sh`,
`.github/workflows/deploy.yml`, `deploy/deploy-staging.sh`,
`.github/workflows/deploy-staging.yml`, and the FOUR hardcoded spots in
`tests/postgres_patch_lifecycle.rs` (two `BETWEEN` bounds, expected-revisions
list, `revisions.len()`).

Verify: `cargo test --test postgres_patch_catalog --test postgres_patch_lifecycle`.

## Task 2 — lifecycle, cancel, approve gate

Backend (`modules/promotions`):

- `models.rs`: `Promotion` and `PromotionInput` gain `internal_code`,
  `objective`, `booking_channel_ids: Vec<i64>`, `loyalty_tier_ids: Vec<i64>`;
  `Promotion` gains `lifecycle: String`. `PromotionActionInput` gains optional
  `reason` (trimmed, ≤500 chars). `PromotionListQuery.status` now also accepts
  lifecycle values.
- `lifecycle.rs` (new, tiny, unit-tested):
  `lifecycle_for(status, claim_starts_at, claim_ends_at, now)`.
- `validation.rs`: `internal_code` normalize (trim, ≤64, allow
  `[A-Za-z0-9_-]`), `objective` membership, id-list sanity (positive, dedup);
  `validate_status` extended so `scheduled|expired|live|cancelled` are accepted
  as filter values and mapped by the service to repo predicates.
- `service.rs`: `cancel_admin_promotion` via `transition_admin_promotion`
  (add `"cancelled" if matches!(current, "draft"|"published"|"paused")` arm —
  reason lands in audit `details`); `list_admin_promotions` translates lifecycle
  filters; every `Promotion` is stamped with `lifecycle` in `promotion_from_row`.
- `handlers.rs`: publish → `require_permission_helper("promotions:approve")`;
  new `cancel_admin_promotion_handler` under `promotions:manage`.
- `routes.rs`: `POST /admin/promotions/{id}/cancel`.
- `repository.rs`: `PROMOTION_COLUMNS` + the two columns;
  `promotion_from_row` gains channel/tier id vectors loaded like
  `room_type_ids`; `replace_channel_targets` / `replace_tier_targets`
  (delete + per-id insert inside the existing create/update tx);
  `set_status` unchanged; `list_admin` accepts an optional lifecycle predicate
  clause (status + claim-window comparison against `CURRENT_TIMESTAMP`).

Tests (unit, no DB): lifecycle table cases, transition legality incl. cancel
from each stored status and terminal-state rejection, filter mapping,
input validation for the new fields.

## Task 3 — targeting enforcement

- `repository.rs`: `guest_targeting_ok(pool, promotion_id, guest_id) ->
  Result<bool>` — one query returning whether tier set is empty OR the guest
  has an active `loyalty_members`+`loyalty_accounts` row with
  `current_tier_id` in the set; channel targeting is checked in the service
  against the direct channel id (`guest_booking::Repository::direct_booking_channel`
  — reuse, don't reimplement).
- `service.rs`: `ensure_guest_claimable` adds both checks (channel: direct id
  must be in the set when non-empty); `ensure_admin_issueable` /
  `issue_admin_voucher` add the tier check only.
- `guest_booking::repository::eligible_voucher` + `eligible_voucher_ids`:
  `VoucherEligibilityQuery` gains `booking_channel_id: i64`; add
  `(NOT EXISTS (SELECT 1 FROM promotion_channels pc0 WHERE pc0.promotion_id = p.id)
    OR EXISTS (… pc.booking_channel_id = $n))` to both queries. Callers in
  `guest_booking/service.rs` resolve the direct channel once per request
  (`direct_booking_channel` already called at the create sites — hoist it into
  the quote path).
- `GET /admin/promotions/targeting-options` (gated `promotions:read`) returning
  `{ channels: [{id,name,channel_type}], loyalty_tiers: [{id,code,name}] }` —
  the `/api/booking-channels` list needs `analytics:read`/`reports:execute`,
  which a campaigns editor may not hold, so this is the correct boundary.

Tests: unit — none meaningful; live DB in Task 4's test file — claim blocked
when tier set excludes the guest, claim blocked when channel set excludes
direct, eligible_voucher respects the channel predicate.

## Task 4 — performance report

- `GET /admin/promotions/{id}/performance` gated `promotions:read`. Response:
  ```
  { promotion_id, currency,
    vouchers: { total, available, redeemed, revoked, expired, by_source },
    redemptions: { applied, reversed, discount_amount, gross_subtotal,
                   net_total, bookings, guests, conversion_rate },
    per_night: { nights, discount_amount, net_amount },
    channel_mix: [{ channel_id, name, channel_type, redemptions, net_total }] }
  ```
  All sums over `voucher_redemptions.status='applied'` (+ `vouchers` table for
  the claim funnel, + `voucher_redemption_allocations` for per-night);
  `conversion_rate = applied/NULLIF(total_vouchers,0)` → `null` at zero.
- Repository method + `FromRow` structs in the promotions module.
- Live test `tests/promotion_performance.rs` (new file — `promotions_admin.rs`
  is another session's dirty file): build a booking through the existing
  guest_booking redeem path or direct inserts, assert the funnel numbers,
  channel mix row, and that reversed redemptions are excluded.

## Task 5 — `/campaigns` workspace (frontend)

- `routes/campaigns.tsx` → `PromotionManagementPage` (keep filename; update the
  page title to "Campaigns"); `routes/promotions.tsx` becomes a
  `beforeLoad` redirect to `/campaigns`.
- `routeRegistry.tsx`: the promotions entry becomes `id 'campaigns'`,
  `path '/campaigns'`, `navLabel 'Campaigns'`, `navGroup 'revenue'`,
  `breadcrumbLabel 'Campaigns'`. Reuse `LocalOfferIcon`. Keep `CampaignIcon`
  on communications.
- i18n: `en/ms` `nav.json` — the campaigns item label (en "Campaigns",
  ms "Kempen").
- `PromotionAdminTable`: status chip renders `lifecycle` (map live/scheduled/
  expired/cancelled colors); new Cancel action (confirm + optional reason)
  beside pause/archive; publish button disabled/hidden without
  `promotions:approve` (check the auth context permission API used by the
  revenue page).
- `PromotionEditorDialog`: new fields — internal_code, objective select,
  channel multi-select, loyalty-tier multi-select (both option lists from
  `targeting-options`); room-type targeting unchanged.
- New `CampaignPerformanceDrawer` under `features/promotions/components/`
  (the API stays `promotionsApi`): funnel chips, gross/discount/net, conversion
  %, channel-mix table — opened per row in the campaigns table.
- `types.ts`/`api.ts`: mirror the new fields + performance response.
- Tests: lifecycle chip mapping, editor submits new targeting fields, cancel
  calls the endpoint with reason, performance drawer renders sums (mock API).
  Use existing test conventions (`toBeTruthy()`, no jest-dom).

## Task 6 — checkpoint

`cargo check --all-features`, `clippy -D warnings`, module unit tests,
live PG tests (promotion lifecycle/targeting/performance), patch catalog +
lifecycle, `HOTEL_APP_UPDATE_OPENAPI=1 … openapi_drift`, FE
`typecheck`/`lint --max-warnings=0`/`test`/`build`. One commit per task.
