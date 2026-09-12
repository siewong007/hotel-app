# Online Inventory: 14-Day Pricing & Availability Matrix

Approved direction 2026-09-12. Replaces the single-date card list at
`/online-inventory` with a channel-manager-style grid (rows = room types,
columns = 14 days), single-cell + bulk editing, staged changes, and one atomic
commit. Quality bar: premium polish plus WCAG 2.1 AAA conformance.

## Current state (verified 2026-09-12)

- `hotel-web-fe/src/features/onlineInventory/` — `OnlineInventoryPage` renders one
  `InventoryRoomCard` per room type for ONE `stay_date`; `useOnlineInventory`
  batches edits client-side and fans out one `PUT` per changed room type via
  `Promise.allSettled` (partial saves possible).
- Backend `modules/guest_booking`: `GET /admin/online-inventory?stay_date=` →
  `Vec<OnlineInventoryAllocation>` for one date; `PUT
  /admin/online-inventory/{room_type_id}/{stay_date}` upserts one cell of
  `online_inventory_allocations` (absent row = defaults: open, 0 held, no custom
  price). Both guarded by `rooms:update`.
- Sole API caller is this feature — `rg` across `hotel-web-fe` and
  `hotel-desktop` finds no other consumer. The GET signature can change.
- Nightly rate resolution (`service.rs::nightly_rates`): `custom_price` →
  `applicable_rate` (priority-ordered `room_rates`/`rate_plans` row valid for the
  weekday) → `weekday_rate`/`weekend_rate`/`base_price` fallback. The grid reuses
  this exact precedence to display `standard_price`.
- The existing PUT is **not audited** — `AuditLog` is imported in
  `service.rs` (used for `guest_portal.booking_created`) but inventory changes
  emit only an `AvailabilityEvent`. Gap, fixed below.

## Backend

### `GET /admin/online-inventory?from=YYYY-MM-DD&to=YYYY-MM-DD`

`OnlineInventoryQuery` becomes `{ from, to }`. `to` is inclusive; reject
`to < from` and a span over 31 days with `400`. One row per
(active room_type × date), ordered by room-type name then date.

Response row adds two fields (additive; existing fields unchanged):

- `standard_price: Decimal` — effective rate *without* the custom override:
  `applicable_rate` for that date, else `weekend_rate`/`weekday_rate`/`base_price`
  fallback. Serialized the same way as `custom_price`.
- `is_override: bool` — an `online_inventory_allocations` row exists for the cell,
  even if it stores defaults. Drives the "where have I configured things" view.

Implementation: `Repository::list_online_inventory_range(pool, from, to)` — one
query over `generate_series($1, $2, interval '1 day')` crossed with active room
types, carrying the existing live-availability predicate (`rooms.is_active`,
status not maintenance/out_of_order, no overlapping active booking for that
single date), a `LEFT JOIN` on allocations, and a `LEFT JOIN LATERAL` rate-plan
pick per date using the same predicates/order as `applicable_rate`. Service
parses/validates dates, enforces the cap.

### `PUT /admin/online-inventory/bulk`

```rust
pub struct OnlineInventoryCellUpdate {
    pub room_type_id: i64,
    pub stay_date: String,          // YYYY-MM-DD, parsed in service
    pub reset: Option<bool>,        // true → delete the allocation row (back to defaults)
    pub walk_in_reserved_rooms: Option<i32>,
    pub online_booking_enabled: Option<bool>,
    pub custom_price: Option<Decimal>,
}
pub struct BulkUpdateOnlineInventoryRequest { pub cells: Vec<OnlineInventoryCellUpdate> }
```

- Reject: empty `cells`, `cells.len() > 500`, duplicate `(room_type_id,
  stay_date)` keys, `reserved < 0`, `custom_price <= 0` or `scale() > 2` — all
  `400`. `reset: true` ignores the optional fields; when `reset` is absent/false
  all three fields are required (`400` if any is missing) — the client always
  knows a cell's full state, so the backend never merges partial updates.
- One transaction: `lock_room_type_tx` once per distinct room type, then per-cell
  upsert-or-delete. Extract a tx-scoped `upsert_online_inventory_tx` so the
  single-cell PUT and bulk share it — the existing PUT keeps working.
- After commit, publish one `AvailabilityEvent` per affected room type spanning
  min..max changed dates (consumers refresh a range; over-notify is safe).
- `AuditLog::log_event_tx` inside the tx: action
  `online_inventory.bulk_updated`, `resource_type: "online_inventory"`, details
  `{cell_count, room_type_ids, date_min, date_max}`.
- Also audit the existing single-cell PUT while the code is open — intentional
  behavior addition per AGENTS "call from every mutating handler"; flagged here.
- Response: `Vec<OnlineInventoryAllocation>` for the affected room types over the
  affected min..max date span (bounded refetch reusing the range query).

### Registrations / drift

Route added in `modules/guest_booking/routes.rs` beside the existing pair, same
`rooms:update` wrapper. No schema change, no patch. `docs/api/openapi.json`
regenerates via `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test
openapi_drift` — expect the two additions and the `stay_date`→`from/to` change.

## Frontend

```
features/onlineInventory/
  api.ts        — getOnlineInventoryRange(from, to), bulkUpdateOnlineInventory(cells)
                  (old single-cell helper removed — no callers left)
  types.ts      — +standard_price: string, +is_override: boolean,
                  CellKey, EditableCell, CellUpdate, BulkUpdateRequest
  constants.ts  — GRID_DAYS = 14, DAY_MS helpers
  utils.ts      — dateRange(from, n), cellKey/diffCells (saved vs edit),
                  summarizeEdits (collapse contiguous runs for the review dialog),
                  projectBulkAction (selection × action × weekday filter → edits),
                  adjustedPrice (±% / ±amount, 2dp rounding)
  hooks/
    useOnlineInventory.ts  — range load, savedCells map, edits overlay,
                             stage/discard/save-merge, window navigation
    useGridSelection.ts    — anchor + Set<CellKey>, row/column/range selection
  components/
    InventoryGrid.tsx        — role="grid"; column headers = dates, row headers =
                               room types; roving tabindex, arrow-key navigation
    GridCell.tsx             — availability count + price; state treatments
    CellEditorPopover.tsx    — open/closed switch, hold stepper, price field with
                               "Standard rate for this date: RM X" context
    BulkEditPanel.tsx        — status / hold / set-price / adjust ±% or ±amount /
                               reset-to-defaults + Mon–Sun filter checkboxes
    ReviewChangesDialog.tsx  — per-room-type grouped summary → Confirm
    GridToolbar.tsx          — «14 ‹ Today › 14» + start-date picker +
                               "Overrides only" filter + Refresh + count of
                               selected cells
    InventorySummary.tsx     — kept; when a selection exists it shows selection
                               totals (room-nights), else window totals
  pages/OnlineInventoryPage.tsx — composition only
```

`InventoryRoomCard.tsx` is deleted (feature-local, no other callers).
Hardcoded English strings stay — this feature has no i18n today; that matches
its existing convention.

## Interaction model

- **Window**: 14 columns from a start date (default today). «14 / ‹ 1 / Today /
  1 › / 14 » plus a start-date picker. Navigating with staged edits fires the
  existing `useConfirm` discard dialog.
- **Cell**: bold online-available count; effective price beneath — custom price
  in a tinted pill, standard muted. Closed = lock icon + "Closed" text.
  Zero-available-but-open = warning treatment. Changed = accent dot + border.
  Override-but-unchanged = subtle marker so configured cells are findable.
- **Selection**: click selects a cell; Shift+click/arrows extend a rectangular
  range; pointer-drag marquees; clicking a row header selects that room type's
  14 cells, a column header all room types for that date.
- **Single-cell edit**: Enter/Space on the focused cell opens the popover;
  clicking an already-selected cell does the same (first click selects, second
  click edits). The popover holds: online switch, hold stepper (≥0, soft-warn
  when > physical), price
  field (blank = standard; helper shows the resolved `standard_price`). Apply
  stages the edit — nothing saves yet.
- **Bulk panel**: enabled when ≥1 cell selected. Actions: Open, Close, Set hold
  to N, Set price to X, Adjust price by ±% or ±amount, Reset to defaults. An
  "Only these weekdays" checkbox row filters the selection before projecting
  (e.g. "close all Fridays"). Adjustments that would push a cell ≤ 0 are
  excluded and reported in the panel. Apply → stages edits.
- **Commit**: floating bar "N cells changed" → Discard / Review & apply →
  `ReviewChangesDialog` groups by room type and collapses contiguous dates with
  identical values ("Deluxe King: Jul 3–9 → RM 250 (std RM 280); Jul 11 →
  closed") → Confirm fires ONE `bulkUpdateOnlineInventory` call → success
  snackbar ("N cells updated"), merged into `savedCells`.

## Data flow & errors

- `useOnlineInventory(from, to)`: fetch → `savedCells: Map<CellKey, …>`;
  `edits: Map<CellKey, EditableCell>` overlays it; `cells` = saved ⊕ edits.
  Staging a value equal to the saved one removes the edit.
- Save: success → merge returned rows, clear edits. Failure → server-side atomic,
  edits retained, error `Alert` shown. Load failure → alert + retry.
- Client validation mirrors the server (reserved ≥ 0 integer, price > 0 and ≤
  2dp) so invalid input never ships.
- Physical availability is read-only and can go stale between load and save;
  the returned rows simply refresh the view — same optimistic model as today.

## WCAG 2.1 AAA bar

- Real `grid` pattern: `role="grid"`/`row`/`gridcell`/`columnheader`/`rowheader`,
  roving `tabindex`, full arrow-key navigation, `aria-selected`, per-cell
  `aria-label` ("Deluxe King, Friday 4 July: 3 online at RM 280, modified").
- ≥7:1 contrast for all text — verify tinted states (custom-price pill, closed,
  changed) against the theme; `text.primary` on `background.paper` is already
  ~15:1.
- ≥44×44px targets for cells and all controls; visible `:focus-visible` ring;
  `prefers-reduced-motion` honored for transitions.
- No state by color alone (icons + text); review-before-commit covers WCAG 3.3.4
  error prevention for financial data; save result announced via live region.

## Testing

- `utils.test.ts`: `dateRange`, `diffCells`, `summarizeEdits` run-collapsing,
  `projectBulkAction` incl. weekday filter, `adjustedPrice` rounding/clamps.
- Hook test: stage → unstage → discard → save-merge.
- Component tests: grid renders room-types × 14; keyboard navigation; cell editor
  staging; bulk-panel validation and exclusion reporting; review-dialog content.
- Backend: unit tests for bulk validation (empty/over-cap/duplicates/price
  rules/reset); a `DATABASE_URL`-gated repository test that fetches a range row
  and round-trips a bulk upsert + reset-delete (per the FromRow live-fetch rule).
- `docs/api/openapi.json` regenerated; three FE gates (`typecheck`, `lint`,
  `test`) plus `bun run build`; backend `cargo check --all-features`,
  `cargo clippy --all-features -- -D warnings`, `cargo test --all-features`.

## Intentional behavior changes (flagged per AGENTS)

1. `GET` param `stay_date` → `from`/`to` (sole caller updated; openapi regen).
2. Response adds `standard_price`, `is_override` — additive.
3. New `PUT /admin/online-inventory/bulk`; single-cell PUT retained and now
   audited (new audit rows — the only runtime-visible change to that endpoint).
4. `reset: true` = row DELETE — new semantic, previously only upserts existed.
5. `InventoryRoomCard` deleted; page UI replaced wholesale.

## Out of scope

- Schema changes / patch catalog entries — none needed.
- Rate-plan administration (`room_rates`, `rate_plans`) — the grid only displays
  the resolved standard rate.
- Guest-facing booking widget, availability socket protocol, desktop shell.
