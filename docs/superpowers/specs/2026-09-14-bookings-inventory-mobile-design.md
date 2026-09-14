# Mobile redesign — `/bookings` list + `/online-inventory`

Date: 2026-09-14 · Branch: `mobile-ux/2026-09-14` (worktree `.worktrees/mobile-ux`)
Follow-up to the mobile-UX density pass (spec `2026-09-14-mobile-ux-density-design.md`).
Both reworks are phone-only (`<sm`) branches; desktop rendering is untouched.
No API, permission, or staged-edit behavior changes.

## Scope

User-confirmed scope:

- **Online inventory**: view + edit + **bulk edit** on phones (full parity,
  including the staged-edit → review → save pipeline).
- **Bookings**: both problems — too much chrome above the list AND rows too
  tall/busy.

## `/online-inventory` — phone layout

### Current phone problems

- `InventoryGrid` is a ~1520px-min-width ARIA matrix (14 date columns);
  horizontal scroll only.
- Cell editing is double-click / keyboard-Enter / marquee-select —
  **no touch path exists** (functional gap, not just clutter).
- `CellEditorPopover` is an anchored `Popover`; `BulkEditPanel` renders inline
  below the grid.

### Phone structure (`isPhone`)

Header: title kept; the two-line description hidden on `xs`.
Toolbar (`GridToolbar`): compress to one row — window prev/next + "Today" +
refresh + overrides-only toggle + a new **Select** mode toggle.

Body: per room type, a card:

```
Deluxe (DLX)              12 free today
Su  M   T   W   T   F   S  …   ← 14-day strip, scroll-snap, ~64px cells
14  15  16  17  18  19  20
12  12  10  ●8  12  12  12     ← online_available; ● = override/staged-change
```

- Day cell shows weekday letter, day number, `online_available`; a marker for
  `is_override` or `changed`; today highlighted (same treatment as the grid's
  `alpha(primary, 0.08)` header).
- **Single-cell edit**: tap a day cell → `BottomSheet` hosting the cell
  editor. Extract `CellEditorPopover`'s inner form (online switch, walk-in
  hold stepper, custom price, reset-to-standard) into a shared
  `CellEditorForm` used by both the desktop `Popover` and the phone
  `BottomSheet`. `onApply` → `inv.stageCell` unchanged.
- **Bulk edit**: "Select" in the toolbar toggles multi-select mode. In select
  mode, tapping day cells toggles them in `sel.selected` (cells are keyed
  `roomTypeId:date` — selection may span room types). A `StickyActionBar`
  shows "N selected · Edit selected" → `BottomSheet` hosting
  `BulkEditPanel`'s fields (weekday filter, hold, price, ±%, ±amount) →
  `inv.stageMany`. Clear/done exits select mode.
- Staged changes keep the existing floating "N cells changed / Discard /
  Review & apply" bar (already `xs`-aware) → `ReviewChangesDialog`
  (theme full-screens it on phone).
- `InventorySummary` stays (already a compact strip); loading/empty/error
  states unchanged.
- Date-window change with unsaved edits keeps the existing confirm-discard
  dialog; select mode clears on window change.

### Desktop

`InventoryGrid`, `CellEditorPopover` (Popover), `BulkEditPanel` (inline),
`useGridSelection`, `useOnlineInventory` — all unchanged. The new
`CellEditorForm` extraction must keep the Popover pixel-identical.

### New/changed files

- `components/PhoneInventoryView.tsx` (new): room-type cards + day strips +
  select-mode orchestration; consumes `inv.*` and `sel.*` — no new state
  management.
- `components/CellEditorForm.tsx` (new): shared fields extracted from
  `CellEditorPopover`; Popover wraps it in `Popover`, phone wraps it in
  `BottomSheet`.
- `components/BulkEditPanel.tsx`: extract its field cluster into
  `BulkEditFields`; the desktop panel wraps it in its existing `Paper`,
  the phone sheet wraps it in `BottomSheet`.
- `OnlineInventoryPage.tsx`: `isPhone` branch rendering
  `PhoneInventoryView` + phone toolbar treatment; selection/editor state
  stays page-level.
- `GridToolbar.tsx`: compact phone row + Select-mode toggle.

## `/bookings` — phone layout

### Current phone problems

- `BookingSummarySection`: 4–6 stat cards at `minmax(230px,1fr)` in a
  scroll-snap strip — heavy, and duplicates the view selector chips already
  inside `BookingFiltersBar` (`viewCounts`).
- `BookingListPanel` rows: avatar + name + a wrapping chip stack (channel,
  billing, status text, night-audit) + room/dates line + price + due + folio —
  ~120–140px per row, hard to scan.
- Sort toggle uses a Filter icon (misleading).

### Phone changes (`isPhone`)

- **Summary strip** → compact chip row (~44px): `Arriving 3`, `In-house 12`,
  `Departing 2`, `Upcoming N`, plus `Due RMx` / `Company RMx` chips only when
  those balances are positive. Same `onSelectView(view)` wiring, active view
  highlighted. The "Take payment" alert card stays exactly as-is.
- **Rows** → slim 2-line layout (~64–72px): 40px avatar, guest name +
  colored status text, line 2 `Room N · type · in→out · nN`; right column =
  total + `Due RMx`/`Paid`. Whole row remains the `onOpenBooking` tap target.
  Voided rows keep `opacity:0.55`.
- Moved off phone rows: channel chip, billing chip, night-audit badge, folio
  number. To keep them reachable, `BookingDetailsPanel` gains a compact
  secondary-metadata line in its header area (channel abbreviation + billing
  label + night-audit chip + folio — small muted row; renders on all sizes,
  it's a detail page).
- **Sort button**: swap Filter icon for a sort icon (`SwapVert`/`Sort`),
  label unchanged.
- `BookingFiltersBar`, pagination, view counts — unchanged.

### Desktop

Summary card grid, rows, filter bar — byte-identical (all changes are
`isPhone`/`xs` branches).

## Constraints

- Phone = `useIsPhone()` (`down('sm')`) for JSX branches; existing pattern.
- Reuse `BottomSheet`, `StickyActionBar`, `CollapsibleSection` primitives;
  no new dependencies, no new UI paradigm.
- All edits funnel through `stageCell`/`stageMany`/`saveChanges` and the
  existing confirm/review dialogs — no new save path.
- i18n: new visible strings go through `t()` keys where the surrounding file
  uses i18n (inventory/bookings features are largely hardcoded English —
  match each file's existing convention).
- Tests: phone branches need `useMediaQuery` mock (pattern from
  `ActionsMenu.test.tsx` / `RoomManagementPage.test.tsx`).

## Out of scope

- Guest-profile inner tables, support panes, and the rest of the deferred
  backlog from the main report.
- Any backend or `useOnlineInventory`/`useGridSelection` internals beyond the
  small selection-mode additions the view needs.
