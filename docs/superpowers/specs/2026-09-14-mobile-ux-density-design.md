# Mobile UX Density — Deep-8 Rework Design

Date: 2026-09-14 · Branch: `mobile-ux/2026-09-14` (worktree `.worktrees/mobile-ux`)

## Goal

On phone-width viewports (`<sm`, MUI `xs`), the eight worst staff surfaces stop
showing every utility at once. Primary content and the primary action stay
visible; secondary controls move into sheets, menus, and collapsed sections —
with zero feature loss and desktop/tablet behavior preserved.

Scope was confirmed with the user: **deep rework of the top-8 surfaces + the
shared primitives they need + two cheap shell fixes.** Other pages stay as-is
(backlog recorded in the audit section).

## What already exists (do not rebuild)

- `useIsPhone()` — canonical `<sm` predicate (`src/hooks/useIsPhone.ts`).
- `BottomSheet` — swipeable bottom drawer (`components/common/BottomSheet.tsx`).
- `FilterSheet` — BottomSheet + Reset/Apply footer (`components/common/FilterSheet.tsx`).
- `MobileCardRow` + `DataTable.renderMobileCard` — card-list table swap.
- `StatStrip` — KPI cards become a horizontal snap-scroll strip on `xs`.
- `PageHeader` — canonical title/subtitle/actions header.
- Theme already forces every MUI `Dialog` → 100dvh sheet below `sm` with sticky
  title + actions (`theme/index.ts:497-553`).
- Exemplar phone filter bar: `BookingFiltersBar.tsx` (search + badged Tune
  button → FilterSheet + scrollable chips).
- `MobileNavBar`/`MobileMoreSheet`/`MobileQuickActions` — bottom nav + FAB.

## New shared primitives (all in `src/components/common/`, exported via barrel)

1. **`ActionsMenu`** — overflow menu that renders a MUI `Menu` on `sm+` and a
   `BottomSheet` list on phone. Props: `actions: ActionItem[]` where
   `ActionItem = { id, label, icon?, onClick, destructive?, disabled?, hidden?, section? }`;
   `trigger?` (default `MoreVert` IconButton, `aria-label` required via i18n);
   optional `title` for the sheet. Groups by `section` with overline headers on
   the sheet; destructive items render last with `error` color. Replaces the
   per-page `MoreVert` hand-rolls and any >2-icon row-action stacks.
2. **`CollapsibleSection`** — header row (title + optional badge/count +
   expand chevron) + `Collapse` body. Props: `title`, `subtitle?`, `badge?`,
   `defaultExpanded`, `collapseOnPhone?: boolean` (default `false`; when true
   the section starts collapsed only while `useIsPhone()`), `actions?`
   (header-right slot), `children`. For detail-page secondary sections and
   long-form section collapsing. State is uncontrolled after mount.
3. **`ResponsiveTabs`** — `tabs: { value, label, icon?, badge? }[]`, `value`,
   `onChange`. Renders MUI `Tabs variant="scrollable" scrollButtons="auto"` on
   `sm+`. On phone: `phoneMode="auto"` (default) renders a `Select` when
   `tabs.length > 4` else scrollable `Tabs`; `"select"` / `"scroll"` force.
   Keeps `TabPanel`/`getTabA11yProps` contract.
4. **`StickyActionBar`** — action row pinned above the bottom nav on phone
   (`position: fixed; bottom: calc(60px + var(--sab)); left/right 0`), inline
   `static` on `sm+`. Props: `primary` (ReactNode — the one prominent action),
   `secondary?`, `overflow?` (rendered through `ActionsMenu`). Only for forms
   where the submit would otherwise scroll off-screen.
5. **`SearchAndFilters`** — generalizes `BookingFiltersBar`: props `search`
   (ReactNode, the field), `children` (secondary filter controls rendered
   identically on both layouts), `activeFilterCount`, `onReset?`,
   `sheetTitle?`, `chips?` (optional scrollable chip row node). Phone: search +
   `Badge(count)` Tune IconButton → `FilterSheet`. Desktop: same controls in a
   responsive grid identical to `BookingFiltersBar`'s (`lg` 1.4fr+repeat).

`PageHeader` gains an optional **`mobilePrimaryAction` + `overflowActions`**
prop set: on phone it renders `mobilePrimaryAction ?? first action` plus an
`ActionsMenu` for the rest instead of wrapping the full action row. Desktop
unchanged.

## Shell fixes (small, affects every page — veto-able)

- `AppTopbar`: below `sm`, drop the standalone Logout icon and LanguageSwitcher
  (both already reachable: logout via `UserMenu` → Sign Out; language inside
  `UserMenu`/`MobileMoreSheet`). Add a compact search IconButton that opens the
  CommandPalette — today phone users have no search affordance except
  FAB→sheet→Search. Result: title + search + bell + avatar at 320px.
- `MobileMoreSheet`: group headers stay, but each `navSection` renders inside a
  collapsed-by-default `CollapsibleSection` (first 2 sections expanded) so the
  ~25-row list stops being a scroll wall; keep Profile row at bottom.

## Per-surface design (rank order from the audit)

### 1. `/room-management` — RoomManagementPage + RoomCard + RoomContextMenu

- **Header filter bar** (`RoomManagementHeader.tsx`): today 6 status pills + 3
  attribute chips + floor chips + search + sort, all inline. Phone: adopt
  `SearchAndFilters` — room-# search inline, everything else (status pills,
  attribute chips, floor chips, attention-first toggle) moves into the
  `FilterSheet` with an active-count badge. Desktop row unchanged.
- **RoomCard**: add a compact phone variant — the card keeps room #, type,
  status line, and ONE primary action (Check out / Check in / Mark clean /
  New booking by status); all other actions + notes move into a `More`
  affordance that opens the same context menu. Occupied cards show guest name
  + dates only (phone/cleaning-preference/notes go to the menu/detail).
- **RoomContextMenu**: on phone render the identical item model inside a
  `BottomSheet` (grouped Booking / Housekeeping / Room sections; the 180px
  aside facts fold into a sheet header block) instead of a `minWidth:460`
  anchored `Menu`. Desktop keeps the Menu. Same handlers, presentation-only
  swap.
- Grid `xs:2` stays (two columns of compact cards); cards get slightly
  reduced fixed height on phone.

### 2. `/bookings` — list + NEW `/bookings/$bookingId` detail route

- **New route** `routes/bookings.$bookingId.tsx` following
  `routes/guest-relations/guests/$guestId.tsx`: lazy page, `ProtectedRoute
  routeId="bookings"` (reuses the seeded `bookings` route-access policy — no
  seed change; detail routes are standalone file routes, NOT registry entries),
  params via `Route.useParams()`. Page component reuses the
  `BookingDetailsPanel` content inside a page shell (`PageHeader` w/ back →
  `/bookings`, status context).
- **BookingsPage**: row tap navigates to `/bookings/$id` on **all** sizes
  (user's explicit choice — desktop loses the inline panel but gains
  deep-linking); remove the auto-open-first-row `BookingDetailsPanel` from the
  list page. The list keeps `BookingFiltersBar` + summary scroll strip as-is.
- **Detail actions** (up to 9 conditional buttons): on the detail page render
  primary lifecycle action (Check in / Check out) as a prominent button,
  frequent actions (Payment, Edit) as secondary, the rest (Workflow, Invoice,
  Release, Void, Reactivate — permission-gated as today) inside `ActionsMenu`.
  Destructive (Void) stays last + confirm dialog as today.

### 3. `UnifiedBookingModal` (shared create-booking dialog)

- Remove the paper `sx` `maxWidth/maxHeight` override that defeats the theme's
  full-screen phone sheet.
- Body sections wrapped in `CollapsibleSection` on phone: stay open —
  Booking mode + Guest + Stay; collapsed on phone — Reservation type detail,
  Rate & payment extras, Notes. Desktop unchanged (all expanded).
- **Restore price feedback on phone**: `BookingSummaryAside` is `xs:none`;
  instead render a compact sticky summary strip (rate × nights → total) inside
  `StickyActionBar` above the footer on `xs`, driven by the same computed
  totals — no duplicated math.
- Footer `Esc/⌘` kbd hints hidden below `sm`.
- New-guest 12-field subform gets `CollapsibleSection` "Additional guest
  details" (optional fields collapsed: address/city/state/postal/country/
  company) — required fields stay visible.

### 4. `CheckoutInvoiceModal` (shared checkout/invoice flow)

- Wrap the long Step-1 blocks in `CollapsibleSection` on phone: Charges
  (expanded), Payments (expanded), Deposit adjustments (collapsed), Record
  payment (already a collapse — keep, default collapsed).
- The per-payment 5-field inline edit grid (`size={4}` fixed) → `xs:12`
  stacking rows.
- Deposit refund/waive/forfeit sub-forms → each inside collapsed section;
  fields stack `xs:12`.
- Footer actions unchanged (Cancel/Print/Proceed) — sticky via theme already.

### 5. `/` admin view — ReportsAnalytics

- The 5 decorative `FPills` (no onClick) are removed on phone only (hidden
  `xs`), keeping the working Compare segmented control; desktop keeps the pills
  (still decorative — flagged in final report as dead UI to either wire or
  remove globally later).
- Live strip + 6 KPI cards → `xs` horizontal snap-scroll strips (same data,
  fewer stacked rows).
- The 5 chart/list panels gain `CollapsibleSection` headers, first expanded,
  rest collapsed on phone.
- The 4 side drawers → `BottomSheet` on phone (same content), keeping side
  drawers ≥sm. Their inner tables render `MobileCardRow`-style rows or keep
  narrow tables — whichever is already readable; no table redesign.

### 6. `/` receptionist view — ReceptionistDashboard

- Fix title: "Admin Dashboard" → "Front Desk" (or role-appropriate label).
- Room grid: on phone, collapse to a status-summarized compact view — rooms
  grouped by status into `CollapsibleSection`s (attention statuses expanded
  first), each room a slim list row (number + status + guest) opening the same
  `RoomEventDialog`. "View all" semantics preserved — nothing removed, just
  grouped. Desktop grid unchanged.
- Activity cards keep the existing 5-item + "View all" truncation.
- Check-in dialog: payment/deposit conditional sections stack `xs:12`
  (they already do — verify only).

### 7. `/company-ledger` — CustomerLedgerPage

- Phone: two-pane becomes master→detail — company list fills the screen;
  tapping a company navigates (local state) to the detail view with a back
  button (`← Companies`), reusing the existing detail pane content. Desktop
  two-pane unchanged.
- The 7 entry-status buttons → scrollable chip row on phone (same handler).
- Row actions in `LedgerEntriesTab` mobile cards: 5 icons → primary (Pay) +
  `ActionsMenu` (invoice, edit, print, void).
- Summary strips keep stacking (already `xs` 1-col) — acceptable.

### 8. `/room-config` — RoomConfigurationPage

- Remove `:hover`-gated room-card actions — phone cards get a persistent
  `ActionsMenu` trigger (Edit / Delete / per-card actions); desktop keeps
  hover reveal AND gains the same menu (a11y improvement, not just phone).
- Group headers: right column (progress bar + 4 icon buttons) collapses to
  count + `ActionsMenu` on phone.
- Filter row (search + 4 status chips + By type/floor toggle) →
  `SearchAndFilters` on phone.
- Room Type drawer Pricing grid `1fr 1fr 1fr` → `xs:1fr` stacking.

## i18n

New user-visible strings (ActionsMenu "More actions", sheet titles, "Back to
companies", etc.) go through `useTranslation` — keys added to both `en` and
`ms` resource files, matching existing `common`/`nav` namespaces. No hardcoded
labels in shared components.

## Behavior guarantees

- No route path, permission, API, or data changes — except the **new**
  `/bookings/$bookingId` route (additive, reuses `bookings` policy).
- Desktop (`≥md`) visuals and workflows unchanged; tablet (`sm–md`) unchanged
  except where noted.
- `EnhancedCheckInModal` is dead code — left untouched, flagged in report.
- Guest-bundle F1–F4 latent gaps (enroll-2FA missing route, recover-payment
  bundle, StatusPage loop, orphaned PaymentsSection) — reported, not fixed.

## Verification

- `bun run typecheck && bun run lint && bun run test` green in `hotel-web-fe`.
- jsdom phone-mode tests for the components that branch on `isPhone`
  (matchMedia mock precedent: `PortalSupportWidget.test.tsx`): at minimum
  `ActionsMenu`, `CollapsibleSection`, `ResponsiveTabs`, `SearchAndFilters`,
  and one integration check that BookingsPage row-tap navigates.
- Headless-Chrome screenshot pass at 320/360/375/390/414/430 for the 8
  surfaces before/after (throwaway Node CDP script, uncommitted), attached to
  the final report.
- Manual checklist per surface: primary action visible, no horizontal scroll,
  no hover-gated controls, filters discoverable with count badge.

## Audit — ranked density findings (basis for the Deep-8)

Source: 9 parallel read-only audits of every route group, 2026-09-14.

| Rank | Surface | Route | Worst problem |
|---|---|---|---|
| 1 | RoomManagement | `/room-management` | ~50%-viewport inline filter chrome; 8-element 170px cards; 460px-wide context menu clips |
| 2 | Bookings | `/bookings` | Auto-open detail panel doubles page length; ≤9 action buttons |
| 3 | UnifiedBookingModal | shared dialog | 7 sections at once; zero price feedback on phone; defeats full-screen theme |
| 4 | CheckoutInvoiceModal | shared dialog | 2400 lines, zero mobile adaptation, nested money sub-forms |
| 5 | ReportsAnalytics | `/` (admin) | ~19 stacked blocks incl. 5 dead filter pills; non-MUI CSS subsystem |
| 6 | ReceptionistDashboard | `/` (front desk) | Unbounded all-rooms 3-col tile grid; "Admin Dashboard" title bug |
| 7 | CustomerLedger | `/company-ledger` | Two-pane → endless stack; 7-button status bar; 5 icon row actions |
| 8 | RoomConfiguration | `/room-config` | Zero responsive code; hover-gated actions undiscoverable on touch |

Backlog (not in this pass, ranked): GuestProfilePage inner tables (5
unmigrated tables + 7 tabs), SupportManagementPage stacked panes + 7-action
header, OnlineInventoryPage touch-unreachable cell editor (functional bug),
RateCalendarGrid/RatePlanDialog fixed grids, GuestRelationsPage duplicated
stat/chip filters, DataTransferPage ~50 expanded cards, RBACManagementPage
expanded accordions, AuditLogPage sparkline cards, EditBookingDialog 15
ungrouped fields, InteractionsTab always-open composer, SettingsPage
Guest-Policies card (~15 controls), PreferencesTab 7 expanded editors,
SegmentsPage rule-builder row overflow, LoyaltyPortal RewardDialog field
pairs, EkycRegistrationPage stepper/grid, PromotionManagementPage filter
stack, HousekeepingPage task/maintenance inline filters, NightAudit nested
papers, PaymentApprovalsPage, CommunicationsPage header, CompanyCheckInDialog
17 fields, PromotionEditorDialog 24 fields, GuestFormDialog 15 fields,
RegisterPage 8 fields, GuestCheckInForm/Verify polish, PortalBookingPage
review scroll, IdentitySection 10-field + 4-upload single scroll.
