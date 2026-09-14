# Mobile UX density overhaul — implementation report

Date: 2026-09-14 · Branch: `mobile-ux/2026-09-14` (worktree `.worktrees/mobile-ux`)
Spec: `docs/superpowers/specs/2026-09-14-mobile-ux-density-design.md`
Plan: `docs/superpowers/plans/2026-09-14-mobile-ux-density.md`
Method: subagent-driven development — 17 implementation tasks, each independently
reviewed; 2 fix rounds (T7 language path, T9 booking-notes reachability).

Goal: "Desktop = productivity workspace / Mobile = focused operational interface."
No functionality, route, permission, or API contract was removed. All phone
changes are additive branches below MUI `sm` (600px); desktop DOM is preserved.

## What was delivered

### New shared primitives (`src/components/common/`)

| Component | Purpose |
|---|---|
| `ActionsMenu` | Desktop MUI `Menu` → phone `BottomSheet` list; sections, hidden/disabled/destructive items |
| `CollapsibleSection` | Accessible header + `Collapse`; `collapseOnPhone` for phone-only collapsing |
| `ResponsiveTabs` | Tabs → `Select` on phone (auto >4 tabs), scrollable option; desktop unchanged |
| `StickyActionBar` | Phone fixed bar above the 60px bottom nav; desktop static bar |
| `SearchAndFilters` | Phone: inline search + badged "Filters" → `FilterSheet`; desktop: inline grid |
| `PageHeader` props | `mobilePrimaryAction` + `overflowActions` for explicit phone action grouping |

### Surface reworks (the "Deep-8" from the audit)

| Rank | Surface | Before (phone) | After |
|---|---|---|---|
| 1 | `/room-management` | ~50% viewport of inline pills/chips/search/sort; 8-element 250×170 cards; 460px context menu clipped | Search + badged Filter button → sheet (status/attr/floor/sort); compact ~150px cards (room#, type, status, guest+dates, 1 primary action + More); menu → `BottomSheet` w/ header + caption facts + sectioned list |
| 2 | `/bookings` | Auto-opened first booking's full detail under the list (~2× page length); ≤9 action buttons | Rows navigate to new `/bookings/$bookingId` route (all sizes); detail = primary lifecycle CTA + Payment/Edit outlined + `ActionsMenu` (Void destructive); `?booking_id=` legacy links redirect |
| 3 | `UnifiedBookingModal` | 7 sections at once; price summary hidden `xs`; own sx defeated full-screen theme | Theme's 100dvh sheet restored on xs; Mode/Guest/Stay expanded, ReservationType/RatePayment/Notes `collapseOnPhone`; xs footer shows "N nights · Total RM x" (same `calculateTotal`); kbd hints hidden |
| 4 | `CheckoutInvoiceModal` | 2402 lines, zero mobile adaptation | Charges+Payments expanded, Deposit adjustments `collapseOnPhone`, Record payment stays collapsed; `PhoneCollapsibleSection` helper keeps desktop DOM identical; payment edit grid + deposit sub-forms stack `xs:12` |
| 5 | `/` admin (ReportsAnalytics) | ~19 stacked blocks incl. 5 dead filter pills; 4 full-screen side drawers | Dead pills hidden on phone; live tiles + KPIs → CSS snap-strips ≤640px; 5 chart panels `collapseOnPhone` (first expanded); drawers → `BottomSheet` |
| 6 | `/` front desk (ReceptionistDashboard) | Unbounded all-rooms `xs:4` tile grid; title bug "Admin Dashboard" | Title → "Front Desk"; rooms grouped by status into `CollapsibleSection`s — attention statuses expanded, routine collapsed; slim `MobileCardRow` rows → same `RoomEventDialog` |
| 7 | `/company-ledger` | Two-pane → endless stack; 7-button status bar; 5 icon actions per card | Phone master→detail w/ "← Companies" back (`nav.mobile.backToList`); status row → scrollable chips; card footer = Pay + `ActionsMenu` (void destructive) |
| 8 | `/room-config` | Zero responsive code; actions hover-gated (undiscoverable on touch) | Persistent `ActionsMenu` per room card at ALL sizes (a11y fix); group headers collapse to count + menu on phone; filters → `SearchAndFilters`; drawer pricing grid stacks `xs` |

### Shell (applies to every page)

- Phone topbar: title · search · bell · avatar (was: + language + standalone
  logout). Sign Out remains in `UserMenu`; language moved to a labeled
  "Language" section at the foot of the More sheet (review-found fix).
- `MobileMoreSheet`: ~25 flat rows → labeled groups, first two expanded,
  rest `CollapsibleSection`; Profile row + language section uncollapsed.

### Bookings architecture

- New route `/bookings/$bookingId` (file route, `ProtectedRoute
  routeId="bookings"` — no seed/policy change; detail routes bypass
  `routeRegistry` per `guest-relations` precedent).
- `useBookingActions` + `BookingActionDialogs` extracted from `BookingsPage`
  verbatim — shared by list and detail, verified behavior-preserving by review.
- `routes/bookings.tsx` gained a conditional `<Outlet/>` (`useChildMatches`).

## Verification evidence

- `bun run typecheck` ✅ · `bun run lint` ✅ · `bun run build` ✅ (10.73s,
  `BookingDetailPage` code-splits to its own chunk).
- `bun run test`: 1634/1640 pass. The 6 failures are 5s-timeout flakes caused
  by external-SSD I/O contention; all 7 affected files pass in isolation
  (113/113) — same flake noted at Task 1.
- Focused suites green throughout: rooms 29, bookings 61, invoices 44 +
  60 consumer, dashboard 6, admin/ledger 106, layout 18, i18n parity.
- New tests: ActionsMenu 3, CollapsibleSection 5, ResponsiveTabs 5,
  StickyActionBar 4, SearchAndFilters 3, PageHeader 4, RoomContextMenu 6,
  RoomManagementPage 4, BookingDetailPage 4 (+3 nav, +1 ref-pin).
- **42/42 headless-Chrome screenshots** at 320/360/375/390/414/430 × 844
  (`/tmp/hotel-mobile-shots-out/`, worktree dev server :3100, authenticated):
  zero document-level horizontal overflow on every reworked route.

## Screenshots

| Route | Files |
|---|---|
| `/` admin | `dashboard-*.png` (or per script naming) |
| `/bookings` | `bookings-{320…430}.png` |
| `/bookings/996002` | `bookings-996002-{320…430}.png` |
| `/room-management` | `room-management-{320…430}.png` |
| `/room-config` | `room-config-{320…430}.png` |
| `/company-ledger` | `company-ledger-{320…430}.png` |
| `/housekeeping` (control) | `housekeeping-{320…430}.png` |

Screenshots live outside the repo (`/tmp/hotel-mobile-shots-out/`); the CDP
script is `/tmp/mobile-shots.mjs`. Re-run note: `/api/auth/refresh` is
rate-limited 10/300s — the script loads each route once and swaps device
metrics per width; keep that pattern.

## Remaining mobile UX issues — ranked backlog

Not in this pass (spec's deferred list + findings discovered mid-implementation):

**Functional gaps (touch can't reach features):**
1. `OnlineInventoryPage` — per-cell editing is double-click/marquee mouse-only.
2. ~~Room card hover actions~~ — **fixed this pass** (persistent ActionsMenu).
3. `HousekeepingPage` at 320px — "+ New task" CTA + "Maintenance" tab clip at
   the right edge (pre-existing; found on the control route).

**High-density surfaces not yet reworked:**
4. `GuestProfilePage` — 5 unmigrated inner tables + up to 7 tabs + 4 header actions.
5. `SupportManagementPage` — stacked list/detail panes, 7-action detail header.
6. `RateCalendarGrid`/`RatePlanDialog` — 1468px matrix scroll-only; fixed `1fr 1fr` dialog grid.
7. `GuestRelationsPage` — 9 StatStrip cards duplicate 9 identical filter chips.
8. `DataTransferPage` — ~50 always-expanded category cards.
9. `RBACManagementPage` — all permission accordions expanded under stacked panes.
10. `AuditLogPage` — 5 tall sparkline stream cards crowd out the log.

**Form density:**
11. `EditBookingDialog` 15 ungrouped fields · `PromotionEditorDialog` 24 ·
    `CompanyCheckInDialog` 17 · `GuestFormDialog` 15 · `RegisterPage` 8 ·
    `IdentitySection` 10-field + 4-upload single scroll.

**Smaller:**
12. `InteractionsTab` always-open composer · `SettingsPage` Guest-Policies
    (~15 controls) · `PreferencesTab` 7 expanded editors · `SegmentsPage`
    rule-builder row overflow · `LoyaltyPortal` RewardDialog pairs ·
    `EkycRegistrationPage` stepper/grid · `PromotionManagementPage` filter
    stack · `HousekeepingPage` inline filters · `NightAudit` nested papers ·
    `PaymentApprovalsPage` · `CommunicationsPage` header ·
    `GuestCheckInForm`/`Verify` polish · `PortalBookingPage` review scroll.

**Visual nits from the 6-width pass (cosmetic):**
13. Compare segmented-control labels wrap 2 lines at 320 (`/`).
14. Eyebrow date wraps mid-date ≤375 (`/bookings`); check-out date wraps at
    320 (`/bookings/:id`); FAB overlaps charge text near fold.
15. Header title wraps ≤360; status chips wrap 3+1 (`/room-management`).
16. Room-type row dense ≥390 (`/room-config`).

**Pre-existing bugs found (not this branch's):**
17. `/help/$slug` never mounts — `routes/help.tsx` renders `RouteById` with no
    `<Outlet/>`; the child route is unreachable. Same conditional-Outlet fix
    as `/bookings` applies.
18. `/bookings?room=<n>` link target is emitted by RoomManagement but never
    read by the bookings page.

## Deferred minors (progress.md ledger)

`ActionsMenu` custom trigger lacks `aria-haspopup`/`aria-expanded` (affects
T10/T17 callers); `CollapsibleSection` `unmountOnExit` drops in-section
state on collapse and remounts children on breakpoint cross (all current
consumers are controlled); `ResponsiveTabs` lacks tab id/`aria-controls`
linkage; `StickyActionBar` consumers must self-pad ~30px+; sm–md band quirks
(static bar + bottom nav coexist; no total surface in booking modal);
`SearchAndFilters` borderBottom abuts Paper/card borders (~2px); ms
`"Lagi tindakan"` may prefer `"Tindakan lain"`; `/company-ledger` back doesn't
strip `?company_id`; `RoomCard` phone labels "Mark clean" vs desktop "Mark
available" (same handler); comment "Same gate the card used" overstates the
`booking ?? reservedBooking` gate.

## Notes for merge

- One product behavior change: bookings no longer auto-opens the first row's
  detail inline — row click navigates (all sizes). Deep links
  `?booking_id=`/`?search=` preserved.
- `useCustomerLedgerWorkspace` gained `autoSelect` param (default true);
  phone passes false so the list view can show.
- Dev-environment note: the backend process serving :3030 was found hung
  mid-session and was restarted from `hotel-app-be/target/debug/hotel-app-be`
  (same binary/dir; frontend-only branch so no rebuild needed). A second Vite
  instance on :3100 serves the worktree for screenshot verification.
- No new dependencies; no seed/policy/route-registry changes; backend and
  desktop untouched.
