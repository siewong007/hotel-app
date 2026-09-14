# Bookings + Online-Inventory Mobile Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `/online-inventory` fully usable on phones (view + single-cell
edit + bulk edit) and slim `/bookings` chrome + rows.

**Architecture:** Phone-only (`useIsPhone`, `down('sm')`) branches. Inventory:
extract shared editor fields, new `PhoneInventoryView` (room-type cards +
14-day strips) + BottomSheet editors + Select-mode bulk. Bookings: summary
cards → count-chip strip; rows → 2-line layout; detail panel gains a muted
metadata line so nothing becomes unreachable.

**Tech Stack:** React 19 + TS strict, MUI v9, Vitest, existing primitives
(`BottomSheet`, `StickyActionBar`, `useIsPhone`).

Spec: `docs/superpowers/specs/2026-09-14-bookings-inventory-mobile-design.md`

## Global Constraints

- Work only in `hotel-web-fe/`. All phone changes are `isPhone`/`xs` branches —
  desktop DOM stays byte-identical unless a task says otherwise.
- No new dependencies. Reuse `src/components/common/BottomSheet`,
  `StickyActionBar`, `useIsPhone` (`src/hooks/useIsPhone.ts`).
- All inventory edits funnel through `inv.stageCell` / `inv.stageMany` /
  `saveChanges` — never a new save path. Select mode clears on window change.
- Feature files use hardcoded English — match; do NOT add i18n keys.
- Phone-branch tests mock `useMediaQuery` (pattern:
  `src/components/common/ActionsMenu.test.tsx`,
  `src/features/rooms/components/RoomManagement/RoomManagementPage.test.tsx`).
- Files >400 lines: grep landmarks + bounded reads, never read whole.
- Gates per task: `bun run typecheck && bun run lint` exit 0 + focused vitest.
- Commit each task; conventional `feat(fe):` / `fix(fe):` messages.

---

### Task 1: `CellEditorForm` — extract shared cell-editor fields

**Files:**
- Create: `src/features/onlineInventory/components/CellEditorForm.tsx`
- Modify: `src/features/onlineInventory/components/CellEditorPopover.tsx`
- Test: `src/features/onlineInventory/components/CellEditorForm.test.tsx`

**Interfaces:**
- Consumes: `GridCellView`, `EditableCell`, `StagedEdit`, `CellKey` from
  `../types`; `useCurrency` for `symbol`.
- Produces: `CellEditorForm({ view, draft, onDraftChange, priceInvalid, overHeld, formatPrice })`
  — pure fields component (no Popover, no buttons except the hold stepper);
  popover keeps the draft state, footer buttons, and apply/reset calls.

- [ ] **1.** Read `CellEditorPopover.tsx` fully (194 lines). The fields to
  extract: Bookable-online `Switch` row, `Divider`, walk-in hold
  `IconButton`/`TextField` cluster + `overHeld` warning, custom-price
  `TextField` with `priceInvalid` + standard-rate helper text.
- [ ] **2.** `CellEditorForm.tsx`: move those four blocks verbatim into a
  `Stack spacing={2}`; props typed as above; `onDraftChange` receives
  `(patch: Partial<EditableCell>)` — the popover passes
  `(patch) => setDraft((d) => ({ ...d, ...patch }))`.
- [ ] **3.** `CellEditorPopover` now renders `<Stack spacing={2}>` with the
  title block, `<CellEditorForm …/>`, then the existing footer Stack (Reset /
  Cancel / Apply) — unchanged.
- [ ] **4.** Test: render `CellEditorForm` with a `GridCellView` fixture
  (shape: `key`, `room_type_id`, `room_type_name`, `stay_date`, `physical`,
  `saved`, `current`, `standard_price`, `effective_price`, `online_available`,
  `changed`, `is_reset`, `is_override`); assert the switch toggles via
  `onDraftChange`, hold stepper clamps at 0, invalid price surfaces
  `priceInvalid` helper text.
- [ ] **5.** Run `bunx vitest run src/features/onlineInventory` — existing
  `CellEditorPopover.test.tsx` (7 tests) must stay green.
- [ ] **6.** Gates + commit `feat(fe): extract shared inventory cell editor form`.

---

### Task 2: `BulkEditFields` — extract bulk-action field cluster

**Files:**
- Modify: `src/features/onlineInventory/components/BulkEditPanel.tsx`
- Test: extend `src/features/onlineInventory/components/BulkEditPanel.test.tsx`

**Interfaces:**
- Consumes: `projectBulkAction`, `weekdayOf`, `BulkAction` from `../utils`.
- Produces: `BulkEditFields({ targets, onApply })` — everything currently
  between the header row and the `skipped` alert: weekday ToggleButtonGroup,
  Open/Close online, Hold, Price, ±%, ±amount, Clear-overrides buttons, and
  the skipped-cells `Alert`. `BulkEditPanel` keeps the Paper shell, the
  "N cells selected" header, `onClear` button, and renders `<BulkEditFields>`.

- [ ] **1.** Move the state (`days`, `hold`, `price`, `percent`, `amount`,
  `skipped`), `weekdayFilter`, `activeCount`, `run`, `numeric` into
  `BulkEditFields` (same file, second export). The weekday group + "in scope"
  caption move too; "N cells selected" + "Clear selection" stay in the panel.
- [ ] **2.** `BulkEditPanel` returns:
  `<Paper …>` header Stack (title + Clear selection) + `<BulkEditFields
  targets onApply/>` + `</Paper>`; keep `targets.length === 0 → null` guard.
- [ ] **3.** Field rows inside `BulkEditFields` must wrap cleanly at 320px:
  change the fields Stack to `direction={{ xs: 'column', sm: 'row' }}` with
  `alignItems: 'stretch'` on xs, fields `sx={{ width: { xs: '100%', sm: 88/120 } }}`.
  Desktop keeps the single wrapping row (sm+ path identical).
- [ ] **4.** Extend `BulkEditPanel.test.tsx`: render `<BulkEditFields>` directly,
  assert "Set hold" fires `onApply` with a `Map` produced by
  `projectBulkAction` for the given targets.
- [ ] **5.** Gates + commit `feat(fe): extract bulk-edit fields for sheet reuse`.

---

### Task 3: `PhoneInventoryView` — cards, day strips, sheet editors

**Files:**
- Create: `src/features/onlineInventory/components/PhoneInventoryView.tsx`
- Create: `src/features/onlineInventory/components/PhoneInventoryView.test.tsx`

**Interfaces:**
- Consumes: `CellEditorForm` (T1), `BulkEditFields` (T2), `BottomSheet`,
  `StickyActionBar`, `useIsPhone` not needed (page branches).
- Produces:
  ```ts
  interface PhoneInventoryViewProps {
    roomTypes: InventoryRoomTypeRow[];       // import from '../hooks/useOnlineInventory'
    dates: string[];                          // visibleDates
    cells: Map<CellKey, GridCellView>;
    today: string;
    selected: ReadonlySet<CellKey>;
    selectMode: boolean;                      // page-owned
    onToggleSelect(key: CellKey): void;       // page-owned toggler
    onOpenCell(key: CellKey): void;           // opens editor sheet
    formatPrice(value: string): string;
  }
  ```
  The page owns: `selectMode` state, `toggleSelect` (add/remove key in
  `sel.setSelected`/`sel.selected` — implement via a small page helper using
  `sel.setSelected([...new Set([...sel.selected, key])])` or removal), the
  editor-sheet open state, and the bulk-sheet open state. `useGridSelection`
  is reused — `selectCell`/`selectRange` unused on phone; `sel.setSelected` +
  `sel.clear` drive the tap-toggle model.

- [ ] **1.** `PhoneInventoryView`: map `roomTypes` → `Paper` card each:
  header row (`room_type_name` + code chip + "N free today" where N =
  `cells.get(cellKey(id, today))?.online_available`); then a horizontal
  scroll-snap strip (`display:flex; overflowX:auto; scrollSnapType:'x
  proximity'; scrollbarWidth:'none'`) of 14 day-cells (~64px): weekday short
  (`WEEKDAY_SHORT`), day num (`DAY_NUM` — reuse the Intl formatters by
  importing them or re-deriving; they're module-local in InventoryGrid so
  duplicate the two Intl lines in the new file — they're constants, not
  logic), `online_available` count or "Closed" lock row, plus the override/
  changed dot (same `position:absolute` 7px dot rule as `GridCell`: filled
  `primary.main` when `changed`, outlined when `is_override`).
- [ ] **2.** Day-cell tap behavior: `selectMode ? onToggleSelect(key) :
  onOpenCell(key)`. Selected cells get the `inset 0 0 0 2px primary` ring
  (same as GridCell). Today cell header tinted `alpha(primary.main,0.08)`.
- [ ] **3.** Editor sheet: in the PAGE (not the view) —
  `const [sheetKey, setSheetKey] = useState<CellKey|null>(null)`;
  `onOpenCell = (key) => setSheetKey(key)`; render
  `<BottomSheet open={sheetKey!==null} onClose={…} title={…}>` containing
  `<CellEditorForm view={cells.get(sheetKey)} draft onDraftChange …>` +
  footer buttons replicated from the popover (Reset when `is_override`,
  Cancel, Apply → `inv.stageCell(key, {type:'set',value:draft})`).
  Draft state lives in the page-level sheet wrapper — mirror the popover's
  `useState<EditableCell>` + re-seed-on-view-change effect. Extract that
  wrapper as `CellEditorSheet.tsx` in the same folder to keep the page lean.
- [ ] **4.** Bulk sheet: `const [bulkOpen, setBulkOpen] = useState(false)`;
  `StickyActionBar` visible in select mode (`N selected` + primary "Edit
  selected" opens sheet + "Done" exits select mode and `sel.clear()`);
  `BottomSheet` hosting `<BulkEditFields targets={selectedViews}
  onApply={inv.stageMany}/>` — reuse the page's existing `selectedViews` memo.
- [ ] **5.** Test (`useMediaQuery` mocked true): renders room-type cards; tap
  a day cell in normal mode → `onOpenCell` called with `roomType:date`;
  select mode → toggling marks two cells and fires `onToggleSelect`;
  "N free today" reads from `cells`.
- [ ] **6.** Gates + commit `feat(fe): phone inventory cards and sheet editors`.

---

### Task 4: Wire the page — phone branch + compact toolbar

**Files:**
- Modify: `src/features/onlineInventory/pages/OnlineInventoryPage.tsx`
- Modify: `src/features/onlineInventory/components/GridToolbar.tsx`
- Modify: `src/features/onlineInventory/pages/OnlineInventoryPage.test.tsx` (if present — check)

**Interfaces:**
- Consumes: `PhoneInventoryView`, `CellEditorSheet` (T3); page already owns
  `sel`, `inv`, `selectedViews`, `editorKey`/`editorAnchor`,
  `changeStart`, `refreshInventory`.

- [ ] **1.** `OnlineInventoryPage`: `const isPhone = useIsPhone();` +
  `const [selectMode, setSelectMode] = useState(false)`. When `isPhone`:
  render `PhoneInventoryView` instead of `InventoryGrid` + `BulkEditPanel`;
  hide the 2-line header description on `xs`; `CellEditorPopover` still
  mounted but unreachable (no anchor) — simplest is `{!isPhone &&
  <CellEditorPopover …/>}` and `{isPhone && <CellEditorSheet …/>}`.
- [ ] **2.** `toggleSelect` page helper:
  ```ts
  const toggleSelect = (key: CellKey) => {
    const next = new Set(sel.selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    sel.setSelected(next);
  };
  ```
- [ ] **3.** `GridToolbar`: on `isPhone` render a single nowrap row —
  `<ChevronLeftIcon/>` (prev day), `<ChevronRightIcon/>` (next day), the date
  `TextField` (flex 1), `Today` button (when start≠today), `RefreshIcon`
  IconButton, `Overrides only` chip, and a `Select`/`Done` toggle button
  (`aria-pressed`). Window-jump (±GRID_DAYS) IconButtons move behind nothing —
  drop them on phone only (date picker covers it). Desktop row unchanged.
  New props: `selectMode?: boolean; onToggleSelectMode?: () => void` — render
  the toggle only when provided (keeps desktop and other callers untouched).
- [ ] **4.** Entering/exiting select mode or changing the window calls
  `sel.clear()`; the bulk `StickyActionBar` lives in the page:
  `selectMode && sel.selected.size > 0` → bar with `{N} selected` +
  "Edit selected" (`setBulkOpen(true)`) + "Done" (exit mode).
- [ ] **5.** Tests: phone-mode render shows room cards not the grid
  (`queryByRole('grid')` null, cards present); toolbar Select toggles
  select mode; select-mode tap + "Edit selected" opens the bulk sheet.
- [ ] **6.** Gates + commit `feat(fe): wire phone inventory view and select mode`.

---

### Task 5: `/bookings` — compact summary chips + slim rows + sort icon

**Files:**
- Modify: `src/features/bookings/components/Bookings/BookingSummarySection.tsx`
- Modify: `src/features/bookings/components/Bookings/BookingListPanel.tsx`
- Test: `src/features/bookings/components/Bookings/BookingListPanel.test.tsx`
  (create if absent — check for an existing test first)

**Interfaces:**
- Consumes: `BookingSummaryStats`, `BookingView`, `SummaryStatCard` from
  `bookingPageUtils`; `getBookingStatusText`, `formatShortDate`, `getNights`,
  `getBookingTotal`, `getBookingBalance`, `getGuestInitials`, `statusDotColor`
  already imported in `BookingListPanel`.
- Produces: none new — presentational only.

- [ ] **1.** `BookingSummarySection`: `const isPhone = useIsPhone();` — on
  phone replace the 230px-card grid with a horizontal chip row
  (`display:flex; overflowX:auto; gap:8px; scrollbarWidth:'none'`): one
  `Chip` per `summaryStatCards` entry — `label={`${stat.title} ${stat.value}`}`
  becomes too wide; use short labels: Arriving, In-house, Departing,
  Upcoming, `Due ${formatCurrency(normalOutstandingDue)}`,
  `Company ${formatCurrency(companyOutstandingDue)}`. Add a `shortTitle`
  field to each `SummaryStatCard` literal (desktop cards keep `title`).
  `onClick` → `onSelectView(stat.view)`; active = `variant:'filled'` +
  `color:'primary'`; alert chips keep `stat.color` border. Take-payment card
  below stays unchanged.
- [ ] **2.** `BookingListPanel` phone row (`isPhone`): avatar 40px; line 1 =
  name (fontWeight 800, `noWrap`+ellipsis) + colored `• status` text; line 2 =
  `Room {room_number||'-'} · {room_type||'Room'} · {formatShortDate(in)} →
  {formatShortDate(out)} · {getNights}N`; right = total (subtitle2, 800) +
  `Due RMx`/`✓ Paid` line. Whole Box is the `onOpenBooking` target; keep
  `opacity` for voided. Channel/billing/night-audit chips + folio — removed
  from phone rows (Task 6 keeps them reachable on detail).
- [ ] **3.** Sort button: `endIcon={<FilterIcon/>}` → `SwapVertIcon`
  (`@mui/icons-material/SwapVert`), label logic unchanged.
- [ ] **4.** Test: phone-mode render of `BookingListPanel` shows guest name,
  room line, status; channel chip/folio absent; click → `onOpenBooking`.
  Summary test: phone renders chips, click selects view.
- [ ] **5.** Gates + commit `feat(fe): slim bookings summary and list rows on phones`.

---

### Task 6: `BookingDetailsPanel` — secondary metadata line

**Files:**
- Modify: `src/features/bookings/components/Bookings/BookingDetailsPanel.tsx`
  (~:170-190 — the header block already renders `invoice_number ||
  folio_number || booking_number` at :181)
- Test: extend `src/features/bookings/pages/BookingDetailPage.test.tsx` or the
  panel's existing test (check which exists).

**Interfaces:**
- Consumes: `getBookingChannelInfo` (`../../utils/bookingChannel`),
  `getBillingChipLabel` (`../../utils/bookingPageUtils`),
  `isNightAuditInvolved` (same util), booking fields.
- Produces: none.

- [ ] **1.** Below the existing folio/invoice line, add a muted caption row
  (renders on ALL sizes — it's a detail page): channel abbreviation chip (if
  `getBookingChannelInfo(booking)`), billing label (if
  `getBillingChipLabel(booking)`), "Night audit" chip (if
  `isNightAuditInvolved(booking)`). Same chip styles the list used (height
  22, `size="small"`); wrap in `Stack direction="row" spacing={0.75}
  flexWrap:'wrap'`. Render nothing when all three are absent.
- [ ] **2.** Test: panel renders channel chip + night-audit chip for a
  fixture carrying those fields.
- [ ] **3.** Gates + commit `feat(fe): booking detail secondary metadata line`.

---

### Task 7: Gates + 6-width screenshots + report append

- [ ] **1.** `cd hotel-web-fe && bun run typecheck && bun run lint &&
  bun run test` — flake rule: 5s-timeout failures re-run per-file with
  `--testTimeout 30000`.
- [ ] **2.** Re-run `/tmp/mobile-shots.mjs` (edit ROUTES to just
  `/bookings` + `/online-inventory`; note `/api/auth/refresh` limit is
  10/300s — the script loads each route once and swaps metrics, keep that).
  Output → `/tmp/hotel-mobile-shots-out/`. Verify: no doc-level overflow,
  inventory cards render, booking rows are 2-line.
- [ ] **3.** Append a "Follow-up pass 2" section to
  `docs/superpowers/reports/2026-09-14-mobile-ux-report.md`: what changed,
  evidence, and update the ranked backlog (remove the OnlineInventory
  touch-gap + bookings rows items; keep the rest).
- [ ] **4.** Commit `docs: mobile-ux follow-up — bookings + inventory`.
