# Channel-Specific Room Pricing & Distribution Cost Management — Design

Status: approved 2026-09-16. Approach: full channel-manager-ready model ("Option C"),
built on the existing `booking_channels` registry.

## Context: current architecture (audited)

- `booking_channels`: channel registry — `name`, `channel_type`
  (`direct|ota|corporate|walk_in|phone|website|channel_manager|other`),
  `default_commission_type` (`none|percentage|fixed_amount`),
  `default_commission_value`, `default_commission_scope`
  (`per_booking|per_night`), `is_active`. Thin CRUD, `settings:update` gate.
  Seeded with 12 channels.
- `rate_plans` (adjustment_type `percentage|fixed|override`, weekday masks,
  validity windows, min/max nights, advance booking, blackouts, priority) +
  `room_rates` (plan × room type × price × effective band, bulk upsert).
  Staff-side only — never auto-applies on the guest portal.
- `room_types.base_price` + `weekday_rate`/`weekend_rate` +
  `service_charge_percentage`.
- `online_inventory_allocations.custom_price` (room_type × stay_date) — the only
  channel-specific price today, scoped to the direct website; the same table
  carries `online_booking_enabled` + `walk_in_reserved_rooms`.
- `promotions` + `promotion_channels` — vouchers already target channels;
  `calculate_promotion_pricing` is the shared per-night discount engine.
- `bookings`: `booking_channel_id` (canonical attribution), `ota_reference`,
  `source`/`channel` (legacy), `commission_rate` (legacy),
  `commission_{type,value,scope}_override`, `commission_amount`, `net_revenue`,
  `daily_rates` jsonb, `rate_override_weekday/weekend`, `rate_plan_id`.
  **Commission/snapshot/rate_plan_id columns are never written by app code** —
  only `staging.sql` populates them; `analytics/channel_net_revenue.rs`
  recomputes commission at report time (channel default → booking override →
  legacy `commission_rate`), so editing channel defaults retroactively changes
  history.
- Prices are tax-inclusive; `tourism_tax` is added for foreign guests
  (`tourism_tax_rate`); `service_tax_rate` exists but is only read by a FE
  calculator.
- Revenue module: overview KPIs + channel mix (`COALESCE(net_revenue, subtotal)`),
  rate calendar (`RateCalendarCell.plan_rate` before "channel overlays" —
  the overlay hook this feature adds).
- No OTA/channel-manager connectivity — `webhooks` is PayPal-only; OTA bookings
  are entered manually with `booking_channel_id` + `ota_reference`.
- Duplicate channel list: `system_settings.booking_channels` JSON (name +
  abbreviation chips in System Settings, booking filters, night-audit views)
  alongside the table. To be deprecated in favor of the table.

## Commercial model (fixed vocabulary)

| Term | Definition |
|---|---|
| source_rate | Per-night output of the existing pipeline (custom_price → rate-plan band → weekday/weekend → base_price) |
| selling_price | Per-night guest-facing price on a channel after the channel rule |
| net_rate | Per-night amount the hotel receives under net-rate agreements; channel sets its own sell price |
| commission | Channel cost: `% of selling price` or fixed `per_booking`/`per_night` |
| est. net revenue | `room_revenue − commission`; always labeled *estimated*, never "profit" |

Two independent dimensions per channel: **price derivation** (how selling price
differs from source rate) and **distribution cost** (commission/fee). Never
conflated.

Pricing rule types: `markup_percent`, `markup_fixed` (per night),
`discount_percent`, `fixed_price` (per night), `net_rate`.

## Data model

```sql
channel_pricing_rules                  -- selling-price derivation
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id bigint NOT NULL REFERENCES booking_channels(id),
  room_type_id bigint REFERENCES room_types(id),     -- NULL: all room types
  rate_plan_id bigint REFERENCES rate_plans(id),     -- NULL: any source rate
  rule_type varchar(24) NOT NULL CHECK (rule_type IN
    ('markup_percent','markup_fixed','discount_percent','fixed_price','net_rate')),
  value numeric(12,2) NOT NULL,
  effective_from date NOT NULL,
  effective_to date,                                  -- NULL: open-ended
  min_price numeric(10,2), max_price numeric(10,2),   -- per-night guardrails
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  reason text,
  created_by bigint, updated_by bigint,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (value >= 0),
  CHECK (rule_type <> 'discount_percent' OR value <= 100),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)

channel_commission_rules               -- effective-dated commission overrides
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id bigint NOT NULL REFERENCES booking_channels(id),
  commission_type varchar(24) NOT NULL CHECK (commission_type IN
    ('percentage','fixed_amount')),
  value numeric(10,2) NOT NULL CHECK (value >= 0),
  scope varchar(20) NOT NULL DEFAULT 'per_booking'
    CHECK (scope IN ('per_booking','per_night')),
  effective_from date NOT NULL, effective_to date,
  priority integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
  reason text, created_by bigint, updated_by bigint,
  created_at/updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (commission_type <> 'percentage' OR value <= 100),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
  -- booking_channels.default_commission_* remains the fallback

channel_room_type_mappings             -- channel-manager readiness (inert)
  channel_id, room_type_id, external_room_id varchar(100),
  external_room_name varchar(160), is_enabled bool NOT NULL DEFAULT true,
  last_synced_at timestamptz, sync_status varchar(20),
  UNIQUE(channel_id, room_type_id), audit cols, PK id

channel_rate_plan_mappings             -- same for rate plans
  channel_id, rate_plan_id, external_rate_plan_id varchar(100),
  external_rate_plan_name varchar(160), is_enabled, last_synced_at, sync_status,
  UNIQUE(channel_id, rate_plan_id), audit cols, PK id

ALTER booking_channels ADD
  abbreviation varchar(8),            -- chip labels (replaces settings JSON)
  code varchar(40),                   -- stable integration key
  integration_mode varchar(20) NOT NULL DEFAULT 'manual'
    CHECK (integration_mode IN ('manual','channel_manager','api'));

ALTER bookings ADD channel_pricing_snapshot jsonb;   -- resolved economics at write
```

Existing `bookings.commission_amount`, `net_revenue`,
`commission_{type,value,scope}_override` are populated by this feature;
`bookings.rate_plan_id` starts being written. Mapping `sync_status`/
`last_synced_at` stay inert until an integration exists.

## Resolution algorithm — `modules/booking_channels/pricing.rs` (pure)

```
per stay night:
  1. source_rate = custom_price? > rate-plan band > weekday/weekend > base_price
     (existing resolvers — portal already implements this for the direct channel)
  2. winning rule: active ∧ channel match ∧ date ∈ [effective_from, effective_to]
     ∧ (room_type NULL ∨ match) ∧ (rate_plan NULL ∨ match)
     ORDER BY priority DESC, specificity DESC
       (room+plan = 3 > room = 2 > plan = 1 > channel-wide = 0), created_at DESC
     LIMIT 1
  3. apply rule → clamp [min_price, max_price] → round 2dp
       markup_percent:   source × (1 + v/100)
       markup_fixed:     source + v
       discount_percent: source × (1 − v/100)
       fixed_price:      v
       net_rate:         selling_price = NULL (channel-managed), net = v
stay:
  4. promotions on payable nights via existing calculate_promotion_pricing
     (promotion_channels already restricts by channel)
  5. commission_base = room revenue after discounts
     (excludes tourism tax, extra-bed charge, services)
  6. commission = effective-dated rule > channel default
     net_revenue = commission_base − commission
     net_rate channel + recorded sell price → commission = max(0, sell − net×n);
     without a sell price → commission NULL, net = net_rate × nights
```

Rule order is deliberate: channel rule → promotion → commission, so commission
is computed on the amount actually charged.

## Write paths

- **Guest portal**: `nightly_rates()` passes the Direct-Website channel through
  the engine (`direct_booking_channel()` already exists). `custom_price` keeps
  top precedence. No rules → byte-identical output.
- **Staff create**: when `booking_channel_id` is set and no explicit
  `daily_rates`/`room_rate_override` is supplied, the server resolves channel
  prices per night and persists them; explicit staff prices always win.
  Snapshot `channel_pricing_snapshot` + `commission_amount` + `net_revenue` +
  `rate_plan_id` on every insert with a channel.
- **Staff update**: re-resolve + re-snapshot only when dates/channel/rates
  change. `commission_*_override` becomes writable on the update input
  (`channels:write`-gated) and wins over the snapshot in reports.
- **Cancel/void**: snapshot retained as recorded; report filters already exclude
  voided rows. OTA-statement reconciliation is a later phase (`ota_statement`).

## API surface (`/api` prefix)

- `GET/POST /booking-channels` + `PUT/DELETE /booking-channels/{id}` (existing;
  gate moves to `channels:*`), extended fields on the model.
- `GET/POST /booking-channels/{id}/pricing-rules`,
  `PATCH/DELETE /channel-pricing-rules/{id}`.
- `GET/POST /booking-channels/{id}/commission-rules`,
  `PATCH/DELETE /channel-commission-rules/{id}`.
- `GET/PUT /booking-channels/{id}/mappings` (room-type + rate-plan external IDs).
- `POST /channel-pricing/preview` — {channel_id, room_type_id, rate_plan_id?,
  check_in, check_out} → nightly ladder (source → rule → sell → commission →
  est. net).
- `GET /channel-pricing/matrix?date=&rate_plan_id=` — room_types × channels
  resolved sell price + rule summary per cell.

## Frontend — `features/channels` + `/channels` (nav group `revenue`)

- Channel list: type, pricing summary, commission summary, status, updated_at.
- Channel detail: pricing-rules table (scope chips, window, priority, toggle),
  commission section (defaults + dated overrides), mappings tab (external IDs —
  labeled "integration"), preview calculator.
- Matrix view: room types × channels for a selected date; cell click opens the
  rule editor scoped to that intersection. Delivers the hybrid model: channel
  default → scoped rules → `fixed_price` overrides.
- System Settings chips read/write `booking_channels` (incl. `abbreviation`);
  the `system_settings.booking_channels` JSON stops being written.
- Booking dialogs: resolved channel price + est. net shown on channel select.
  (`bookings/` files may carry concurrent-session edits — additive changes only.)

## Permissions & audit

- New resource `channels`: `channels:read`, `channels:write`, `channels:manage`
  (`:manage` implies all). Seed grants: admin + super_admin (blanket), manager
  (all three — the revenue-manager role). Route policy `channels` →
  required `["channels:read"]`, nav `["navigation_revenue:read","channels:read"]`,
  added to `expected_route_access_policies`.
- DB CHECKs bound values; service validates percentages, dates, positive
  prices; overlapping windows at the same scope → warning, not hard-block
  (priority resolves); >30% swings flagged in preview.
- `AuditLog` events on every rule/commission/mapping/channel mutation incl.
  `reason`; booking snapshots are the financial audit trail.

## Reporting

`channel_net_revenue.rs` precedence: stored snapshot (`commission_amount`/
`net_revenue` non-null) → `commission_*_override` → dated commission rules →
channel default → legacy `commission_rate`. Revenue overview channel mix gains
real net revenue automatically (`COALESCE(net_revenue, subtotal)`).

## Performance

Rules fetched once per request (`channel_id IN (...)` + window overlap),
resolved in memory per night. Index `(channel_id, room_type_id,
effective_from, effective_to)` on both rule tables; `UNIQUE(channel_id, x_id)`
on mappings doubles as lookup index. Matrix bounded by channels × room types.
No cache layer initially.

## Migration & delivery

- Baseline: new tables (pg_dump shape — bodies, identity ALTERs, PKs, then FK
  ALTERs), `booking_channels` + `bookings` column adds go **last** in their
  CREATE TABLEs, indexes.
- Patch `0006_channel_pricing.sql` (idempotent `IF NOT EXISTS` / guarded),
  registered in `manifest.tsv`, `deploy/deploy.sh` (file list + install),
  `deploy/deploy-staging.sh` (same), `.github/workflows/deploy.yml` and
  `deploy-staging.yml` bundle steps. `tests/postgres_patch_catalog.rs`
  enforces the parity.
- Desktop: `bun run sync:resources` mirrors `database/postgres/` into
  `hotel-desktop/src-tauri/database/postgres/`.
- Seed: `channels:*` permissions + grants + route policy + expected list;
  `booking_channels` seed INSERT gains the new columns.
- `data_transfer` export list gains the four new config tables
  (import order after booking_channels/room_types/rate_plans).
- No backfill: snapshots are write-time; legacy rows keep report-time
  resolution.

## Acceptance criteria

- Admin configures Booking.com = `markup_percent 10` + `percentage 15`
  commission → matrix/preview show base 300 → sell 330 → commission 49.50 →
  est. net 280.50.
- Guest portal quotes are unchanged while the Direct Website channel has no
  rules; adding a Direct rule changes portal prices accordingly.
- Staff OTA booking created with a channel snapshots commission + net;
  editing rules afterwards does not alter the stored booking.
- Manual `commission_*_override` on a booking beats the snapshot in reports.
- `channels:*` permissions gate every mutating endpoint; audit events record
  who/what/when with optional reason.
- New channels require zero schema changes.

## Out of scope (integration-ready, not built)

Live OTA/channel-manager sync, rate/availability push, reservation import,
OTA statement reconciliation import, multi-currency settlement, occupancy-tier
pricing rules. Mapping tables and `integration_mode` carry the schema for it.
