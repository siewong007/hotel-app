# Admin Notification Center — Design

Date: 2026-08-26
Status: Approved by owner
Scope: one new backend read endpoint; new frontend feature (bell + full page).
No schema changes, no patches, no new permissions.

## Goal

Give staff a single notification center showing recent outbound guest-email
activity from the durable outbox, grouped into priority tabs derived from the
delivery kind (no new priority column): **Transactional** (service mail) vs
**Marketing** (campaigns/birthday). Reached via a bell in the admin shell and
a full page.

## Backend

### Endpoint

`GET /api/admin/communications/deliveries`

- Permission: `communications:read` (existing).
- Query params:
  - `tier`: `all | transactional | marketing` (default `all`). Tier is derived
    server-side from `validation::TRANSACTIONAL_KINDS`; marketing = every other
    kind currently in `email_deliveries_kind_check`
    (`campaign`, `birthday_voucher`).
  - `status`: optional exact match on delivery status.
  - `page` (1-based), `page_size` (default 20, clamped 1–100).
- Response:
  ```json
  {
    "items": [ { ...DeliverySummary... , "tier": "transactional" } ],
    "total": 123,
    "unread": 4
  }
  ```
  - `DeliverySummary` reuse is mandatory: raw recipient addresses never leave
    the API (`EmailDelivery` is deliberately not `Serialize`).
  - `tier` echoed per item so the FE does not duplicate kind lists.
  - `unread` = COUNT where status IN ('queued','sending') — independent of the
    tier/status filters (it drives the global bell badge).

### Repository

New `CommunicationsRepository::list_deliveries_page(pool, tiers, status,
limit, offset)` returning `(Vec<EmailDelivery>, total, unread)`. Tier filter is
a kind IN-list computed from `TRANSACTIONAL_KINDS` / its complement. Single
round-trip for page + totals per existing repo patterns.

Routes/handlers follow module conventions (thin handler, permission helper,
validation of params).

## Frontend

- Feature folder `src/features/notifications/` (api, components, hooks,
  types) with its service going through `src/api/client.ts`.
- **Bell + popover** in the admin shell bar: MUI `Badge` (unread, cap 99)
  opening a ~420px panel. Tabs: All / Transactional / Marketing. Latest 10
  items, status chips, relative timestamps (`utils/date` helpers only — no
  `toISOString().split`, lint-banned). TanStack Query: refetchInterval 60s
  idle, 15s while open.
- **Full page `/notifications`** ("View all" link from panel): same tabs plus
  status filter select and pagination. Registered in BOTH `src/routes/*.tsx`
  and `src/navigation/routeRegistry.tsx` (sidebar under Communications);
  visibility gated by `communications:read`.
- Status chip colors mirror existing delivery-status conventions in the
  communications feature.

## Testing

- BE integration (DATABASE_URL-gated, live PG):
  - tier split matches `TRANSACTIONAL_KINDS` exactly;
  - masking (recipient address never appears raw);
  - `unread` counts queued+sending regardless of filters;
  - pagination math (`total` vs returned page length).
- FE (Vitest, Style-A mocks): badge shows unread, tab switch changes query
  key/filters, empty state renders, page pagination wiring.

## Implementation deviations (recorded)

- Nav entry uses `accessControlled: false` + `visibility: 'auth'`: avoids
  seed.sql route-policy surgery while the feed endpoint still enforces
  `communications:read` (unauthorized staff see a friendly empty page).

## Out of scope

Staff-operational alerts, push/real-time updates, per-user read-state, SMS,
any write operations.
