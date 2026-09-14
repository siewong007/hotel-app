# Mobile UX Density — Deep-8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On phone-width viewports (`<sm`), the 8 worst-density staff surfaces
use progressive disclosure — primary content/actions visible, secondary grouped
into sheets/menus/collapsed sections — with zero feature loss and desktop
unchanged. Spec: `docs/superpowers/specs/2026-09-14-mobile-ux-density-design.md`.

**Architecture:** Five new shared primitives in `src/components/common/` (+
PageHeader extension) applied per surface. All phone branching via the existing
`useIsPhone()` hook (`theme.breakpoints.down('sm')`). Shell gets two small
fixes. Bookings gains a real `/bookings/$bookingId` detail route.

**Tech Stack:** React 19 + TS strict (`lib: ES2024`), MUI v9, TanStack
Router/Query, `ky` via `src/api/client.ts`, Vitest + Testing Library, `bun`.

## Global Constraints

- Work only inside `hotel-web-fe/` of this worktree
  (`/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app/.worktrees/mobile-ux/`).
  Quote every path — the volume name contains a trailing space.
- No new dependencies. MUI + existing shared components only.
- Phone predicate: `useIsPhone()` — never raw `useMediaQuery` for `<sm`
  branching (shell-level `md` splits may keep `theme.breakpoints.down('md')`).
- Every MUI `Dialog` already becomes a 100dvh sheet below `sm` via theme — do
  NOT add `fullScreen` props or width hacks that fight it.
- Shared components (`components/common`, `components/layout`) must use
  `useTranslation('common')` / `('nav')` for user-visible strings; add keys to
  BOTH `src/i18n/resources/en/common.json` and `ms/common.json` (and `nav.json`
  where nav-scoped). Feature pages follow local convention (hardcoded English
  is the norm there — match the file's existing style).
- Never `toISOString().split/.slice` for dates — lint-banned. Use
  `src/utils/date.ts` helpers.
- All HTTP via `src/api/client.ts` (`ky`). Never `fetch`.
- Desktop (`≥md`) and tablet (`sm`–`md`) visuals/workflows unchanged.
- No route/permission/API/response-shape changes — except the additive
  `/bookings/$bookingId` route, which reuses the existing `bookings` policy.
- `EnhancedCheckInModal` is dead code — do not touch it.
- Verification gate per task: `cd hotel-web-fe && bun run typecheck &&
  bun run lint && bun run test` — all three must exit 0.
- Commit after each task with `feat(fe): <what>` style.

## Conventions for the new primitives

- Files: `src/components/common/<Name>.tsx`, test `…/<Name>.test.tsx`.
- Barrel-export from `src/components/index.ts` beside existing exports
  (`BottomSheet`, `FilterSheet`, `PageHeader`, `StatStrip` block ~line 28-38).
- Phone-mode tests mock `useMediaQuery` exactly as
  `src/features/guestPortal/components/PortalSupportWidget.test.tsx` does:
  `vi.mock('@mui/material', async (importOriginal) => { const actual = await
  importOriginal(); return { ...actual, useMediaQuery: () => mocks.isPhone }; })`
  with a `vi.hoisted` `mocks` object. Tests run WITHOUT an `I18nProvider`
  (existing `BottomSheet.test.tsx` proves `useTranslation` falls back to en).
- i18n keys to add (en + ms `common.json`, under `"actions"`):
  `"moreActions": "More actions"` / ms `"Tindakan lain"`;
  `"expand": "Expand"` / ms `"Kembangkan"`;
  `"collapse": "Collapse"` / ms `"Runtuhkan"`;
  `"openFilters": "Open filters"` / ms `"Buka penapis"`;
  `"actions": "Actions"` / ms `"Tindakan"`;
  `"sections": "Sections"` / ms `"Bahagian"`.
  And in `nav.json` (en + ms): `"mobile.backToList": "Back to list"` /
  ms `"Kembali ke senarai"`.

---

### Task 1: `ActionsMenu`

**Files:**
- Create: `hotel-web-fe/src/components/common/ActionsMenu.tsx`
- Test: `hotel-web-fe/src/components/common/ActionsMenu.test.tsx`
- Modify: `hotel-web-fe/src/components/index.ts` (barrel, after FilterSheet block)
- Modify: `hotel-web-fe/src/i18n/resources/en/common.json`, `ms/common.json`

**Interfaces:**
- Produces (used by Tasks 6, 7, 9, 11, 16, 17):
```ts
export interface ActionMenuItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  /** Group key — renders overline section headers in the phone sheet. */
  section?: string;
}
export interface ActionsMenuProps {
  actions: ActionMenuItem[];
  /** Default: MoreVert IconButton with aria-label t('common:actions.moreActions'). */
  trigger?: React.ReactNode;
  /** Title of the BottomSheet on phone. Defaults to t('common:actions.actions'). */
  title?: React.ReactNode;
  /** aria-label for the trigger when the default is used. */
  triggerLabel?: string;
}
```

- [ ] **Step 1: failing test**

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});
import { ActionsMenu } from './ActionsMenu';

const actions = [
  { id: 'edit', label: 'Edit', onClick: vi.fn() },
  { id: 'del', label: 'Delete', onClick: vi.fn(), destructive: true },
];

describe('ActionsMenu', () => {
  beforeEach(() => { mocks.isPhone = false; });
  afterEach(cleanup);

  it('desktop: opens a Menu and runs the action', () => {
    render(<ActionsMenu actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(actions[0].onClick).toHaveBeenCalledTimes(1);
  });

  it('phone: opens a bottom sheet listing actions', () => {
    mocks.isPhone = true;
    render(<ActionsMenu actions={actions} title="Booking actions" />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByText('Booking actions')).toBeTruthy();
    fireEvent.click(screen.getByText('Edit'));
    expect(actions[0].onClick).toHaveBeenCalledTimes(1);
  });

  it('hides hidden items and renders destructive last', () => {
    mocks.isPhone = true;
    render(<ActionsMenu actions={[...actions, { id: 'x', label: 'Nope', onClick: vi.fn(), hidden: true }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByText('Nope')).toBeNull();
    const texts = screen.getAllByRole('button').map((b) => b.textContent);
    expect(texts.indexOf('Delete')).toBeGreaterThan(texts.indexOf('Edit'));
  });
});
```

- [ ] **Step 2: implement** — `IconButton` trigger; `isPhone = useIsPhone()`.
  Phone: `<BottomSheet open onClose title>` + `List` of `ListItemButton`s
  (icon via `ListItemIcon` when present; `section` grouping with overline
  `Typography` headers; `destructive` → `color: 'error.main'` text, sorted
  last; `disabled` → disabled). Desktop: `Menu anchorEl` + `MenuItem`s.
  Filter `hidden` items up front; if all hidden render nothing. Clicking an
  item calls `onClose()` then `action.onClick()`.

- [ ] **Step 3:** add i18n keys (both locales), barrel export
  `export { ActionsMenu } from './common/ActionsMenu'; export type {
  ActionsMenuProps, ActionMenuItem } from './common/ActionsMenu';`

- [ ] **Step 4:** `bun run test` (file passes) + `bun run typecheck` + `bun run lint` → commit.

---

### Task 2: `CollapsibleSection`

**Files:**
- Create: `hotel-web-fe/src/components/common/CollapsibleSection.tsx`
- Test: `hotel-web-fe/src/components/common/CollapsibleSection.test.tsx`
- Modify: `hotel-web-fe/src/components/index.ts`

**Interfaces:**
```ts
export interface CollapsibleSectionProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-of-title element (e.g. count chip). */
  badge?: React.ReactNode;
  /** Further header-right controls rendered before the chevron. */
  actions?: React.ReactNode;
  /** Initial expanded state. Default true. */
  defaultExpanded?: boolean;
  /** When true the section STARTS collapsed only while useIsPhone() is true
      (evaluated once at mount). */
  collapseOnPhone?: boolean;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}
```

- [ ] **Step 1: failing test** — same useMediaQuery mock. Cases: (a) expanded
  by default shows children + `aria-expanded="true"` on header button;
  (b) `collapseOnPhone` + `isPhone=true` starts collapsed, children absent,
  chevron button labelled `Expand`; (c) clicking header toggles; (d)
  `collapseOnPhone` + `isPhone=false` starts expanded.

- [ ] **Step 2: implement** — header = `Box role="button" tabIndex=0` (or
  `ButtonBase`) with `aria-expanded`, title `Typography variant="subtitle2"`
  weight 700, optional badge, actions (`e.stopPropagation()` on their click),
  `ExpandMoreIcon` rotated 180° when open; body in MUI `Collapse`. Initial
  state `useState(() => collapseOnPhone ? !useIsPhoneInitial : defaultExpanded)`
  — capture `useIsPhone()` once via `useRef(useIsPhone())` is wrong (hook must
  run unconditionally); instead `const isPhone = useIsPhone();` then
  `useState(() => (collapseOnPhone && isPhone) ? false : defaultExpanded)`.

- [ ] **Step 3:** barrel export + gates + commit.

---

### Task 3: `ResponsiveTabs`

**Files:**
- Create: `hotel-web-fe/src/components/common/ResponsiveTabs.tsx`
- Test: `hotel-web-fe/src/components/common/ResponsiveTabs.test.tsx`
- Modify: `hotel-web-fe/src/components/index.ts`

**Interfaces:**
```ts
export interface ResponsiveTabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: number | React.ReactNode;
  disabled?: boolean;
}
export interface ResponsiveTabsProps {
  tabs: ResponsiveTabItem[];
  value: string;
  onChange: (value: string) => void;
  /** 'auto' (default): Select on phone when >4 tabs else scrollable Tabs.
      'select' | 'scroll' force. */
  phoneMode?: 'auto' | 'select' | 'scroll';
  ariaLabel?: string;
}
```

- [ ] **Step 1: failing test** — cases: (a) desktop renders `role="tablist"`
  with all tabs, click fires `onChange(value)`; (b) phone + 6 tabs + `auto` →
  renders a `Select`-backed control (`role="combobox"` or MUI Select button),
  no tablist; (c) phone + 3 tabs + `auto` → still scrollable `Tabs`;
  (d) `phoneMode="select"` forces select at 3 tabs.

- [ ] **Step 2: implement** — `isPhone` branch: select mode → `FormControl
  size="small" fullWidth` + `Select` (aria-label `ariaLabel ??
  t('common:actions.sections')`, `MenuItem` per tab incl. `Badge` on
  `badge`); scroll mode → `Tabs variant="scrollable" scrollButtons="auto"
  allowScrollButtonsMobile` mapping `Tab`s (`value`, wrapped label+icon+`Badge`).
  `onChange` adapters differ per control — normalize to `(value)`.

- [ ] **Step 3:** barrel + gates + commit.

---

### Task 4: `StickyActionBar`

**Files:**
- Create: `hotel-web-fe/src/components/common/StickyActionBar.tsx`
- Test: `hotel-web-fe/src/components/common/StickyActionBar.test.tsx`
- Modify: `hotel-web-fe/src/components/index.ts`

**Interfaces:**
```ts
export interface StickyActionBarProps {
  /** The one prominent action (usually a contained Button). */
  primary: React.ReactNode;
  /** Optional leading summary/context (e.g. price total) — truncates. */
  summary?: React.ReactNode;
  /** Optional extra inline action(s) (outline/soft buttons). */
  secondary?: React.ReactNode;
  /** Optional ActionsMenuProps for overflow. */
  overflowActions?: ActionMenuItem[];
}
```

- [ ] **Step 1: failing test** — cases: (a) renders primary + summary;
  (b) on phone (`isPhone=true`) the bar carries `position: fixed` style
  (assert via `toHaveStyle` or computed sx on the root Box);
  (c) `overflowActions` renders a "More actions" trigger.

- [ ] **Step 2: implement** — `Paper elevation={0}` root: `sx` phone →
  `position:'fixed', bottom:'calc(60px + var(--sab))', left:0, right:0,
  zIndex: theme.zIndex.appBar - 1, borderTop, px:2, py:1.25,
  display:'flex', gap:1.25, alignItems:'center'`; `sm+` →
  `position:'static', border:'1px solid', borderRadius:2`. Layout:
  `summary` (`flex:1, minWidth:0, Typography` ellipsis) then `secondary`,
  `primary`, optional `ActionsMenu`. Import `MOBILE_NAV_HEIGHT` value — it is
  `60` (`components/layout/MobileNavBar.tsx:16`); hardcode `60` with a comment
  rather than import (layout → common import direction stays clean).

- [ ] **Step 3:** barrel + gates + commit.

---

### Task 5: `SearchAndFilters`

**Files:**
- Create: `hotel-web-fe/src/components/common/SearchAndFilters.tsx`
- Test: `hotel-web-fe/src/components/common/SearchAndFilters.test.tsx`
- Modify: `hotel-web-fe/src/components/index.ts`

**Interfaces:**
```ts
export interface SearchAndFiltersProps {
  /** The controlled search field (rendered full-width both layouts). */
  search: React.ReactNode;
  /** Secondary filter controls — rendered inline in the desktop grid and
      inside the FilterSheet on phone. Supply controlled inputs; the sheet
      changes presentation only. */
  children: React.ReactNode;
  /** Count shown on the filter button badge. */
  activeFilterCount?: number;
  onReset?: () => void;
  sheetTitle?: React.ReactNode;
  /** Optional chip/view-selector row rendered under the controls both ways
      (scrollable on phone — same pattern as BookingFiltersBar chipsRow). */
  chipsRow?: React.ReactNode;
}
```

- [ ] **Step 1: failing test** — cases: (a) desktop renders search + children
  inline, no filter button; (b) phone renders search + `Open filters` button
  with badge count, children NOT in DOM until sheet opens; (c) opening sheet
  shows children + `Reset` calls `onReset`.

- [ ] **Step 2: implement** — copy the structure of
  `features/bookings/components/Bookings/BookingFiltersBar.tsx:214-253`:
  phone → `Box p:1.5 borderBottom` + `Stack direction=row` (search `flex:1`,
  `Badge badgeContent={activeFilterCount}` wrapping `IconButton` with
  `TuneIcon`, `borderRadius:2, border:'1px solid divider'`) + optional
  `chipsRow` (apply the same `mx:-1.5,px:1.5,overflowX:auto,scrollbarWidth:'none'`
  phone chip-scroll sx) + `FilterSheet`. Desktop → `Box p:2 borderBottom` +
  `display:grid, gridTemplateColumns:{xs:'1fr', sm:'repeat(2,minmax(0,1fr))',
  `gridTemplateColumns` copied verbatim from `BookingFiltersBar.tsx:247`:
  `{ xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 1.4fr)
  repeat(4, minmax(0, 1fr))' }`. Pages with more than 4 secondary filters
  simply wrap to a second implicit grid row — no extra code needed.
  `useIsPhone()` decides which layout renders.

- [ ] **Step 3:** barrel + gates + commit.

---

### Task 6: `PageHeader` mobile action overflow

**Files:**
- Modify: `hotel-web-fe/src/components/common/PageHeader.tsx`
- Test: `hotel-web-fe/src/components/common/PageHeader.test.tsx` (create)

**Interfaces:**
```ts
// additions to PageHeaderProps:
/** Phone: replaces the wrapped actions row. Rendered as the single visible
    action; defaults to the first child of `actions` — pass explicitly when
    `actions` is not a single element array. */
mobilePrimaryAction?: React.ReactNode;
/** Phone: remaining actions rendered via ActionsMenu (⋮). When provided AND
    isPhone, the actions row shows mobilePrimaryAction + ActionsMenu only. */
overflowActions?: ActionMenuItem[];
```

- [ ] **Step 1: failing test** — (a) desktop renders all `actions` children;
  (b) phone + `overflowActions` renders `mobilePrimaryAction` + a
  `More actions` trigger, other action nodes NOT rendered; (c) phone without
  `overflowActions` keeps current wrap behavior (regression check).

- [ ] **Step 2: implement** — inside PageHeader: `const isPhone = useIsPhone();`
  when `isPhone && overflowActions` → render
  `<Box sx={{display:'flex',gap:1,alignItems:'center'}}>{mobilePrimaryAction}
  <ActionsMenu actions={overflowActions} /></Box>` instead of the actions box.
  Import `ActionsMenu` (common→common import, fine).

- [ ] **Step 3:** gates + commit.

---

### Task 7: Shell — AppTopbar slimming + search; MobileMoreSheet grouping

**Files:**
- Modify: `hotel-web-fe/src/components/layout/AppTopbar.tsx`
- Modify: `hotel-web-fe/src/components/layout/MobileMoreSheet.tsx`
- Modify: `hotel-web-fe/src/i18n/resources/en/nav.json`, `ms/nav.json`
- Test: `hotel-web-fe/src/components/layout/MobileNavBar.test.tsx` (existing —
  keep green; update only if assertions break)

**Steps:**
- [ ] **1.** `AppTopbar`: wrap the `LanguageSwitcher` + `UserMenu` + logout
  `Tooltip/IconButton` block so that below `sm` only `UserMenu` renders —
  concretely: `LanguageSwitcher` gets `sx={{display:{xs:'none',sm:'inline-flex'}}}`
  (it already accepts `size`/`color`; wrap in a `Box` if it lacks `sx`), and
  the logout `IconButton` gets `display:{xs:'none',sm:'inline-flex'}` (Sign Out
  remains inside `UserMenu`). ADD a search `IconButton` visible only on
  `xs` (`display:{xs:'inline-flex',sm:'none'}`, `SearchIcon`,
  `aria-label={tNav('aria.search')}`) calling `openPalette` — placed before
  `NotificationCenter`. Net phone chrome: title · search · bell · avatar.
- [ ] **2.** `MobileMoreSheet`: wrap each `section.items` list in
  `CollapsibleSection` — `title={groupLabel(section.group)}`, `collapseOnPhone`
  false; instead control per-section: `defaultExpanded={index < 2}` for labeled
  sections; unlabeled sections stay always-expanded (render items directly).
  Section header typography keeps the existing overline style (pass as `title`).
- [ ] **3.** i18n: `nav.json` en+ms `"mobile.backToList"` key.
- [ ] **4.** Gates + commit.

---

### Task 8: `/room-management` — filters → `SearchAndFilters`

**Files:**
- Modify: `hotel-web-fe/src/features/rooms/components/RoomManagement/components/RoomManagementHeader.tsx`
- Modify: `hotel-web-fe/src/features/rooms/components/RoomManagement/hooks/useRoomManagementFilters.ts` (only if filter-state shape needs exposing — likely not)

**Context:** `RoomManagementHeader.tsx:182-358` renders inline: 6 status
ToggleButtons + 3 attribute chips + floor chips + room# search +
attention-first toggle. Filter state lives in the hook
(`useRoomManagementFilters.ts:203-210` has the status options).

**Steps:**
- [ ] **1.** Read `RoomManagementHeader.tsx` fully (≤400 lines) — identify the
  props/state for: status toggle group, attribute chips (Smoking/Daily/No
  cleaning), floor chips, room# search, attention-first sort.
- [ ] **2.** Refactor the phone layout to `SearchAndFilters`: `search` = the
  existing room# TextField (full-width on phone); `children` = status
  ToggleButtonGroup (make it `orientation` wrap/`flexWrap:'wrap'` inside the
  sheet), attribute chips, floor chips, attention-first toggle;
  `activeFilterCount` = # of non-default selections; `onReset` = existing
  clear-filters handler if present else reset each filter. Keep the SAME
  controlled values/handlers — presentation change only. `chipsRow` = the
  status pills duplicated? NO — status pills live in the sheet; chipsRow only
  if the audit's quick-view pattern exists here (it doesn't — omit `chipsRow`).
- [ ] **3.** Desktop keeps the current inline row exactly (`isPhone` branch).
- [ ] **4.** Gates + commit.

---

### Task 9: `/room-management` — RoomCard compact + context menu → BottomSheet

**Files:**
- Modify: `hotel-web-fe/src/features/rooms/components/RoomManagement/components/RoomCard.tsx`
- Modify: `hotel-web-fe/src/features/rooms/components/RoomManagement/components/RoomContextMenu.tsx`
- Modify: `hotel-web-fe/src/features/rooms/components/RoomManagement/RoomManagementPage.tsx` (menu model at `:569-640`)

**Steps:**
- [ ] **1. RoomCard** (`RoomCard.tsx:183-660`): `const isPhone = useIsPhone();`
  on phone render a compact variant — keep room number, type code, status
  line, guest name + dates when occupied, ONE primary action button per status
  (occupied→Check out; reserved-today→Check in; dirty/reserved_dirty→Mark
  clean; available→New booking) + ONE `More` icon affordance that invokes the
  existing context-menu open. Everything else (SMOKING/OVERDUE/FREE GIFT
  badges, phone, cleaning pref, notes) is hidden on the phone card — still
  reachable via the menu/dialogs. Keep `xs:2` grid; reduce min-height ~150px.
- [ ] **2. RoomContextMenu** (`RoomContextMenu.tsx:73`): extract the menu
  content into a data model (the page builds it at
  `RoomManagementPage.tsx:569-640`): `sections: { label?, items:
  {id,label,icon,onClick,disabled?}[] }[]` + `header` (room #, status pill,
  primary button) + `aside` facts (rate, booking dates, housekeeping).
  Desktop: render as today (`Menu`, minWidth 460 w/ aside). Phone: render
  `BottomSheet` — header block = room + status + aside facts folded inline as
  caption rows; each section as `List` + overline group label. Same handlers.
  Implement by branching in the component's return: `isPhone ? <BottomSheet…/>
  : <Menu…/>`.
- [ ] **3.** Gates + commit.

---

### Task 10: `/bookings/$bookingId` detail route + page

**Files:**
- Create: `hotel-web-fe/src/routes/bookings.$bookingId.tsx`
- Create: `hotel-web-fe/src/features/bookings/pages/BookingDetailPage.tsx`
- Test: `hotel-web-fe/src/features/bookings/pages/BookingDetailPage.test.tsx`

**Interfaces:**
- Consumes: `BookingService.getBookingById(id)` (`src/api/bookings.service.ts:196`),
  `BookingDetailsPanel` (props at
  `features/bookings/components/Bookings/BookingDetailsPanel.tsx:49-64` —
  `booking: BookingWithDetails` + 9 action callbacks + `onClose`).
- Produces: route `/bookings/$bookingId`.

**Steps:**
- [ ] **1.** Check whether `getBookingById` returns `Booking` or
  `BookingWithDetails` — the panel needs `BookingWithDetails`. If it returns
  the leaner `Booking`, fetch the full row via the same call the list uses
  (`getAllBookings`/`getBookingsPage` + find by id) or extend the service
  ONLY if an endpoint exists (check `hotel-app-be` routes for a
  `GET /bookings/{id}` that returns details — grep
  `bookings/:id`/`bookings/{id}` in `hotel-app-be/src/routes`). Prefer the
  endpoint that already powers the list's detail objects.
- [ ] **2.** `BookingDetailPage`: TanStack Query fetch by param; loading →
  `LoadingSpinner`; error/404 → `EmptyState` w/ back link. Renders
  `PageHeader` (title = guest name / booking ref, `mobilePrimaryAction` =
  back handled by a `Button startIcon=ArrowBack` navigate('/bookings') —
  actually put Back as the left control: prepend a back `IconButton` via
  header composition or simply a "← Bookings" text button above PageHeader)
  then `<BookingDetailsPanel booking={b} isAdmin={isAdmin} onClose={back}
  {...action callbacks}/>` — the callbacks must open the SAME dialogs the
  list page opens today: lift the dialog-mounting logic from `BookingsPage`
  into the page (CheckIn, Payment, Workflow, Edit, Invoice, Release, Void,
  Reactivate dialogs + their services). This is the biggest lift — factor a
  shared hook `useBookingActions(booking)` in
  `features/bookings/hooks/useBookingActions.ts` (create) that both
  `BookingsPage` and `BookingDetailPage` call, returning `{ callbacks,
  dialogs }` where `dialogs` is the `<>` fragment of mounted dialog elements.
  Extract verbatim from BookingsPage — no behavior changes.
- [ ] **3.** Detail action grouping: modify `BookingDetailsPanel`
  (`:206-240` holds the ≤9 conditional buttons). On `isPhone`: the first
  available lifecycle action (Check in OR Check out) stays a full-width
  contained `Button`; `Payment` + `Edit` become outlined buttons; the rest
  (Workflow, Invoice, Release, Void, Reactivate — same permission/condition
  gates as today) move into `ActionsMenu` with `Void` marked `destructive`.
  Desktop keeps the current button row untouched.
- [ ] **4.** Route file: mirror `routes/guest-relations/guests/$guestId.tsx`
  exactly — `createFileRoute('/bookings/$bookingId')`, `ProtectedRoute
  routeId="bookings"`, `AnimatedRoute fade`, `ComponentErrorBoundary`,
  `Suspense` + `CircularProgress`, `Route.useParams()`. NOTE: file routes
  regenerate `routeTree.gen.ts` — after creating the file run
  `bun run typecheck`; if `routeTree.gen.ts` is stale, run the project's
  codegen (TanStack router plugin regenerates on dev/build — check
  `routeTree.gen.ts` updates or run `bunx tsr generate` if configured;
  look at `vite.config.ts` plugins first).
- [ ] **5.** Test: mock `@tanstack/react-router` params + `api` client;
  assert page fetches by id and renders panel content; row-level nav covered
  in Task 11.
- [ ] **6.** Gates + commit.

---

### Task 11: `/bookings` — navigate to detail; drop auto-open panel

**Files:**
- Modify: `hotel-web-fe/src/features/bookings/components/Bookings/BookingsPage.tsx`
- Modify: `hotel-web-fe/src/features/bookings/components/Bookings/BookingListPanel.tsx`

**Steps:**
- [ ] **1.** In `BookingsPage` (`:60` main; details auto-open at `:124,:356-360`):
  row selection → `navigate('/bookings/' + bookingId)` instead of
  `setSelectedBooking`. Remove the always-mounted `BookingDetailsPanel` from
  the page and the `bookingDetailsOpen` state. Keep `useBookingActions` hook
  usage ONLY if dialogs are still needed on the list page — they are NOT
  (actions live on detail page now), EXCEPT any dialogs triggered from
  list-level chrome (e.g. `?create=1` UnifiedBookingModal stays).
- [ ] **2.** `BookingListPanel`: row `onClick` → the navigate callback passed
  in (keep prop-driven). Selected-row highlight: use `bookingId` param… the
  list page has no param; drop the highlight or keep `selected` state locally.
- [ ] **3.** After mutation dialogs on the detail page complete (check-in
  etc.), list data must refresh when returning — TanStack Query
  invalidation already handles this IF the shared hook invalidates the same
  query keys; verify in `useBookingActions` extraction.
- [ ] **4.** Gates + commit.

---

### Task 12: `UnifiedBookingModal` — collapsible sections + phone summary

**Files:**
- Modify: `hotel-web-fe/src/features/rooms/components/UnifiedBooking/UnifiedBookingModal.tsx`
- Modify: `hotel-web-fe/src/features/rooms/components/UnifiedBooking/components/BookingModalFooter.tsx`
- Modify: `hotel-web-fe/src/features/rooms/components/UnifiedBooking/components/BookingSummaryAside.tsx` (or page file — verify path)
- Modify: `hotel-web-fe/src/features/rooms/components/GuestSelector.tsx`

**Context:** modal at `UnifiedBookingModal.tsx:1036-1274`; paper sx override
`:1044-46`; body grid `:1068`; aside hidden `xs` (`BookingSummaryAside.tsx:62`);
sections: RoomPicker → BookingMode → ReservationType → Guest → Stay →
RatePayment → Notes.

**Steps:**
- [ ] **1.** Remove the paper `sx` `maxWidth/maxHeight` override so the theme's
  full-screen sheet applies on phone (verify desktop keeps `min(1040px,100%)`
  width — apply the width via `sm+` breakpoint: `sx={{ width: { xs: '100%',
  sm: 'min(1040px,100%)' }, maxWidth: { xs: 'none', sm: … } }}` — actually
  keep the desktop value at `sm` and let the theme own `xs`).
- [ ] **2.** Wrap sections in `CollapsibleSection collapseOnPhone`: expanded
  always — Booking mode, Guest, Stay. Collapsed on phone — Reservation type
  details, Rate & payment extras, Notes. Sections without a clear title get a
  `title` prop (existing section titles reused).
- [ ] **3.** Phone price feedback: the modal already computes the total that
  feeds `BookingSummaryAside`. Embed a compact total row INTO
  `BookingModalFooter` shown only on `xs` — footer is already sticky via the
  theme's `DialogActions` override, so this is the lightest correct surface:
  `BookingModalFooter` gains `sx={{ flexDirection: { xs: 'column', sm: 'row' } }}`
  plus an `xs`-only summary line (e.g. `Total: RM 540 · 3 nights`) driven by
  the same computed value — no duplicated math.
- [ ] **4.** Hide `Esc`/`⌘` kbd hints below `sm` (`display:{xs:'none',sm:'flex'}`).
- [ ] **5.** `GuestSelector` new-guest form (`:305-484`, 12 fields): wrap
  non-required address/company block (address, city, state, postal, country,
  company autocomplete) in `CollapsibleSection title="Additional details"
  collapseOnPhone`. Required: name, phone/email per validation, IC/passport,
  tourism type — stay visible.
- [ ] **6.** Gates + commit.

---

### Task 13: `CheckoutInvoiceModal` — collapsible money sections

**Files:**
- Modify: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx`

**Context:** `CheckoutInvoiceModal.tsx:813-2374`; step-1 charges `:1031-1132`,
deposit cluster `:1234-1432`, payments `:1514-1574` (5-field `size={4}` grid),
record-payment `:1860-1936`; step-2 `:1984-2316`; actions `:2319-2374`.

**Steps:**
- [ ] **1.** `const isPhone = useIsPhone();` — wrap step-1 blocks in
  `CollapsibleSection`: Charges (defaultExpanded true), Payments (true),
  Deposit adjustments (refund/waive/forfeit sub-forms) (`collapseOnPhone`),
  Record payment (already collapsed — keep).
- [ ] **2.** Per-payment inline edit grid `size={4}` → `xs:12` (find the
  `Grid`/`size` props at `:1514-1574`; change to `size={{xs:12,sm:4}}`).
- [ ] **3.** Deposit sub-forms: each refund/waive/forfeit field row → stack
  `xs:12`; the reason/amount/button triples become column Stacks on phone.
- [ ] **4.** Per-night Room+Tax rate-edit rows `:1031-1132`: keep visible;
  inputs stack `xs:12` where they are multi-column today.
- [ ] **5.** Gates + commit.

---

### Task 14: `/` admin — ReportsAnalytics progressive disclosure

**Files:**
- Modify: `hotel-web-fe/src/features/dashboard/components/reports/ReportsAnalytics.tsx`
- Modify: `hotel-web-fe/src/features/dashboard/components/reports/reports.css` (media queries)
- Modify: `hotel-web-fe/src/features/dashboard/components/reports/drawers.tsx` (if separate)

**Context:** custom CSS subsystem (`reports.css` @media 640/720/1100);
`ReportsAnalytics.tsx:128-317`; drawers `width:min(540px,100vw)`.

**Steps:**
- [ ] **1.** `const isPhone = useIsPhone();` (component is MUI-compatible even
  though styling is CSS — hook works).
- [ ] **2.** Dead `FPills`: `display:none` under the existing 640px media
  query in `reports.css` (comment: decorative pills, hidden on phones) —
  OR render `{!isPhone && …}` in JSX. Prefer JSX: explicit.
- [ ] **3.** Live tiles (6) + KPI cards (6): under 640px make each strip
  horizontally scrollable (CSS: `display:flex; overflow-x:auto; scroll-snap`)
  matching `StatStrip` behavior — edit `reports.css` media blocks, keep data.
- [ ] **4.** Panels: wrap each of the 5 chart/list panels in
  `CollapsibleSection` — first panel expanded, others `collapseOnPhone`
  (component works inside CSS-styled markup).
- [ ] **5.** Drawers: `drawers.tsx` — on `isPhone` render `BottomSheet`
  instead of side drawer (same children; title = drawer title). Inner tables
  left as-is.
- [ ] **6.** Gates + commit.

---

### Task 15: `/` receptionist — ReceptionistDashboard grouped rooms

**Files:**
- Modify: `hotel-web-fe/src/features/dashboard/components/ReceptionistDashboard.tsx`

**Context:** title "Admin Dashboard" (`~:528`); 4 stat cards `xs:6`
(`:544-628`); activity cards `:630-769` (already truncated to 5 + View all);
room grid `:771-1008` (`xs:4` tiles + 5-chip legend); dialogs
`RoomEventDialog` + check-in `Dialog` `:1027`.

**Steps:**
- [ ] **1.** Title: "Admin Dashboard" → role-appropriate label (check the
  component's actual title string; likely "Front Desk" — match whatever the
  kicker/context line already says; if a `t()` key exists use it).
- [ ] **2.** Room grid on phone: `isPhone` → replace the `xs:4` tile grid with
  status-grouped `CollapsibleSection`s — group rooms by their existing status
  categories (use the same status constants the grid/legend uses), sections:
  statuses needing attention first (e.g. dirty/maintenance/overdue),
  expanded; Occupied/Vacant collapsed. Each room = slim row (room # +
  `StatusChip` + guest name if occupied) tapping into the existing
  `RoomEventDialog` open handler — reuse the same `onRoomClick`/dialog state.
- [ ] **3.** Keep stat cards + activity cards as-is (already adapted).
- [ ] **4.** Gates + commit.

---

### Task 16: `/company-ledger` — master→detail + grouped row actions

**Files:**
- Modify: `hotel-web-fe/src/features/admin/components/CustomerLedger/CustomerLedgerPage.tsx`
- Modify: `hotel-web-fe/src/features/admin/components/CustomerLedger/components/LedgerEntriesTab.tsx`

**Context:** page `:153` (2125 lines; render `:1544`); two-pane grid
`xs:1fr / md:380px 1fr` `:1665`; company list `CompanyListPane.tsx`; status
buttons `LedgerEntriesTab.tsx:171-200`; mobile cards `:218-238` with 5 row
actions.

**Steps:**
- [ ] **1.** Phone master→detail: `isPhone` → when no company selected show
  only `CompanyListPane`; when selected show only the detail pane with a
  `← Companies` back button (`tNav('mobile.backToList')` or feature string)
  clearing the selection. Same selection state, presentation-only.
- [ ] **2.** Entry-status 7-button row → horizontally scrollable `Stack
  direction="row"` chips on phone (same click handlers; pattern =
  `BookingFiltersBar` chipsRow sx).
- [ ] **3.** `LedgerEntriesTab` mobile card footer: Pay stays a button;
  invoice/edit/print/void → `ActionsMenu` (`destructive` for void).
- [ ] **4.** Gates + commit.

---

### Task 17: `/room-config` — persistent actions + filter sheet

**Files:**
- Modify: `hotel-web-fe/src/features/rooms/components/RoomConfigurationPage.tsx`

**Context:** filters `:855-897`; group headers `:942-1089` (4 IconButtons);
room card hover-gated actions `:684,697-727`; drawer pricing `:1320`.

**Steps:**
- [ ] **1.** Room card actions: remove the `display:none`→hover reveal on
  `xs` — instead render a persistent `ActionsMenu` trigger on each card
  (Edit/Delete + any existing items; keep hover reveal for `sm+` unchanged
  but ALSO add the menu for `sm+`? — decision: keep desktop hover behavior
  exactly, add persistent menu only on `xs`… but hover is also broken on
  touch at `sm`; simplest robust rule: persistent `ActionsMenu` at ALL sizes
  in the card corner, keep hover CSS removed. Choose persistent-everywhere:
  it is an a11y fix, not just phone.)
- [ ] **2.** Group header: on `isPhone`, right column collapses to
  avail-count text + `ActionsMenu` (hide/duplicate/edit/delete).
- [ ] **3.** Filters (`:855-897`): `SearchAndFilters` on phone — search inline;
  status chips + By-type/floor toggle into sheet.
- [ ] **4.** Drawer pricing `gridTemplateColumns:'1fr 1fr 1fr'` →
  `{xs:'1fr',sm:'1fr 1fr 1fr'}`.
- [ ] **5.** Gates + commit.

---

### Task 18: Headless-Chrome screenshot verification

**Files:**
- Create (uncommitted scratch): `scripts/mobile-shots.mjs` at worktree root —
  or `/tmp/mobile-shots.mjs` to guarantee no commit.

**Steps:**
- [ ] **1.** Script: Node ≥22 built-in `fetch`+`WebSocket`. Launch
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new
  --remote-debugging-port=9222 --user-data-dir=/tmp/hotel-mobile-shots
  --window-size=390,844`; CDP: `Network.setCookie` for the refresh cookie
  (obtain once via `curl -i -X POST :3030/api/auth/login -d
  '{"username":"admin","password":"MobileAudit!2026"}'` → `Set-Cookie`), then
  `Page.navigate` per route, wait for network-idle-ish (fixed 4-6s delay),
  `Emulation.setDeviceMetricsOverride` per width
  [320,360,375,390,414,430] × height 844, `Page.captureScreenshot` → PNG in
  `.claude/reports/mobile-shots/<route>-<width>.png`.
- [ ] **2.** Routes to shoot (staff app on :3000): `/` (admin view),
  `/bookings`, `/bookings/<id>` (pick a real id from
  `GET /api/bookings?page=1`), `/room-management`, `/room-config`,
  `/company-ledger`, `/housekeeping` (control — already adapted), plus open
  states where scriptable (skip dialogs — document instead).
- [ ] **3.** Review shots for: no horizontal overflow, primary action visible,
  chrome ≤2 rows before content. Attach notable shots to final report.

---

### Task 19: Final gates + report

- [ ] **1.** `cd hotel-web-fe && bun run typecheck && bun run lint &&
  bun run test && bun run build` — all green.
- [ ] **2.** Write `docs/superpowers/reports/2026-09-14-mobile-ux-report.md`:
  audit table (from spec), per-surface before/after, primitives added,
  screenshots index, remaining backlog ranked (spec's backlog list updated
  with anything found mid-implementation), verification evidence.
- [ ] **3.** Commit docs. Summarize for user.
