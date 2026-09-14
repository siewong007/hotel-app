# Mobile UX Overhaul — Implementation Plan

> **For agentic workers:** implemented inline in-session; checkbox steps track progress.

**Goal:** make the app genuinely usable at 320–430px without degrading desktop —
shared primitives first, then adoption across surfaces.

**Spec:** `docs/superpowers/specs/2026-09-14-mobile-ux-overhaul-design.md`

**Architecture:** `hotel-web-fe` only. Extend existing groundwork (`DataTable.
renderMobileCard`, full-screen `MuiDialog` override `<sm`, sidebar→drawer `<md`,
guest-portal `BottomNavigation`, `canAccessNavigationRoute`). New primitives:
`useIsPhone`, `BottomSheet`, `MobileNavBar` + `MobileMoreSheet`,
`MobileQuickActions`, `FilterSheet`. Quick actions are pure navigation to
canonical deep links (e.g. `/bookings?create=1` opens `UnifiedBookingModal`).

## Global Constraints

- No new dependencies. No backend/route-path/API/permission changes.
- `git status --short` before every commit; stage only files this plan touched.
- Do NOT touch `src/features/rooms/config.ts` (another session's in-flight work).
- i18n parity: new `nav.*`/`common.*` keys go in BOTH `en/` and `ms/` JSON.
- Phone breakpoint = `theme.breakpoints.down('sm')`; shell breakpoint = `down('md')`
  (matches `AppSidebar`/`RootLayout`/`DataTable` today).
- Never `toISOString().split/.slice` (lint-banned) — use `src/utils/date.ts`.
- Gates per task: `bun run typecheck && bun run lint` in `hotel-web-fe/`;
  `bun run test` + `bun run build` before the final commit.

## Task 1: Foundation — viewport, safe-area, `useIsPhone`, `BottomSheet`

**Files:**
- Modify: `index.html` — `viewport-fit=cover`, `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style: black-translucent`, fix dead
  `/logo192.png` + `/favicon.ico` refs (icons created in Task 8).
- Modify: `src/index.css` — `:root` safe-area custom props
  (`--sat/--sab/--sal/--sar` from `env(safe-area-inset-*)`), `overflow-x: clip`
  guard on `body` as a last-resort horizontal-scroll fuse.
- Create: `src/hooks/useIsPhone.ts` — `useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })`.
- Modify: `src/hooks/index.ts` — export it.
- Create: `src/components/common/BottomSheet.tsx` — `SwipeableDrawer` anchor
  bottom: rounded top, drag handle, `maxHeight: 88dvh`, safe-area bottom padding,
  `aria-modal`, props `{ open, onClose, title?, children }`.
- Modify: `src/theme/index.ts` — `@media (pointer: coarse)` overrides lifting
  `MuiIconButton`/`MuiButton size small`/`MuiTab`/`MuiListItemButton` effective
  hit area to ≥44px (padding-based, no layout shift on desktop).
- Create: `src/components/common/BottomSheet.test.tsx` — renders title/children,
  calls onClose on backdrop.

- [ ] Steps: implement → `bun run typecheck && bun run lint` → commit `feat(fe): mobile foundation — safe-area, useIsPhone, BottomSheet, coarse-pointer targets`.

## Task 2: Staff mobile navigation

**Files:**
- Create: `src/components/layout/MobileNavBar.tsx` — `BottomNavigation` `<md`,
  fixed bottom, safe-area padding. Tabs: Home `/`, Bookings `/bookings`,
  Guests `/guest-config`, Ops → `/room-management` if accessible else
  `/housekeeping`, More → opens `MobileMoreSheet`. Hide any tab whose route
  fails `canAccessNavigationRoute`; if Bookings/Guests hidden, fill from
  `front_office`/`guests` group order so staff always get 4 destinations + More.
- Create: `src/components/layout/MobileMoreSheet.tsx` — `BottomSheet` listing
  remaining role-visible routes grouped by `navGroups.ts`, each row
  icon + label + chevron, plus Profile `/profile`, Notifications
  `/notifications`, Help `/help` (only if not already a tab).
- Modify: `src/router/RootLayout.tsx` — render `<MobileNavBar>` when `isNarrow`;
  add `pb: calc(64px + var(--sab))` to the main column `<md`; hamburger remains.
- Modify: `src/i18n/resources/en/nav.json` + `ms/nav.json` — `mobile.home`,
  `mobile.bookings`, `mobile.guests`, `mobile.ops`, `mobile.more`,
  `mobile.allSections` etc.
- Create: `src/components/layout/MobileNavBar.test.tsx` — tabs render, More
  opens sheet, inaccessible route hidden (mock `useAuth`).

- [ ] Steps: implement → gates → commit `feat(nav): staff bottom nav + role-filtered More sheet`.

## Task 3: Quick actions FAB + sheet

**Files:**
- Create: `src/components/layout/MobileQuickActions.tsx` — FAB `<sm` above the
  nav bar (`bottom: calc(72px + var(--sab))`), opens `BottomSheet` of
  role-filtered actions, each closing the sheet then navigating:
  New booking `/bookings?create=1` · Search (opens `useCommandPalette().open`) ·
  Today's arrivals `/bookings?filter=arrivals` (verify existing param support —
  else plain `/bookings`) · Check-in/out, Collect payment → `/bookings` ·
  Room status → `/room-management` · New task / Report issue → `/housekeeping` ·
  New guest → `/guest-config` (verify its create deep-link; else navigates).
- Modify: `src/router/RootLayout.tsx` — render `<MobileQuickActions>` `<sm`.
- i18n keys under `nav.mobile.*` / `common.actions.*` both locales.

- [ ] Steps: verify each target route's deep-link support by grep first;
  implement; gates; commit `feat(nav): mobile quick-actions sheet`.

## Task 4: Table→card adoption (high-traffic)

Pattern: pass `renderMobileCard` where `DataTable` is already used; for raw MUI
tables add `{isPhone ? <cards> : <Table>}` using a shared card row shape
(`ListItemButton`-style: title / secondary line / `StatusChip` / chevron).

**Priority files (each gets a mobile card renderer + `useIsPhone` switch):**
- `src/features/bookings/components/Bookings/BookingsPage.tsx` (booking list)
- `src/features/housekeeping/components/TasksView.tsx`, `MaintenanceTab.tsx`
- `src/features/admin/components/PaymentApprovalsPage.tsx`
- `src/features/admin/components/CustomerLedger/components/LedgerEntriesTab.tsx`
- `src/features/admin/components/AuditLogPage.tsx`
- `src/features/promotions/components/VoucherAdminTable.tsx`, `PromotionAdminTable.tsx`
- `src/features/segments/pages/SegmentsPage.tsx`
- `src/features/communications/pages/CommunicationsPage.tsx`
- `src/features/admin/system/JobsTable.tsx`
- `src/features/admin/components/complimentary/ComplimentaryBookingsTable.tsx`
- `src/features/ekyc/components/EkycManagementPage.tsx`
- `src/features/admin/components/NightAuditReportViews.tsx` / `NightAuditPage.tsx`
- `src/features/rates/components/RatePlanTable.tsx`, `revenue/components/ChannelMixTable.tsx`
- `src/features/admin/components/DataTransferPage.tsx`
- `src/features/insights/components/ReportShell.tsx`
- `src/features/loyalty/components/LoyaltyPortal.tsx`, `LoyaltyDashboard.tsx`
- `src/features/guests/components/GuestProfileDialog.tsx` (in-dialog table)
- `src/features/guestPortal/components/dashboard/PortalDashboardSections.tsx`
- `src/features/rooms/components/RoomRatesEditor.tsx`
- `src/features/admin/components/CustomerLedger/CustomerLedgerPage.tsx` + `CompanyInvoiceDialog.tsx`

Create `src/components/data-table/MobileCardRow.tsx` only if ≥3 sites share the
same shape (expected: yes — title/secondary/chip/chevron).

- [ ] Steps: implement per file (commit in 3 batches: front-office, finance/admin,
  revenue/guest); `typecheck`+`lint` per batch; commit `feat(fe): mobile card
  lists for <batch>`.

## Task 5: FilterSheet + form input hints

**Files:**
- Create: `src/components/common/FilterSheet.tsx` — button + `BottomSheet`
  hosting children + Apply/Reset + active-filter `Chip` row.
- Adopt on: `BookingsPage` (BookingFiltersBar), `TasksView`, `PaymentApprovalsPage`,
  `LedgerEntriesTab`/`CustomerLedgerPage`, `AuditLogPage`, `CommunicationsPage`.
- Input hints sweep (`inputMode`/`type`/`autoComplete`): `GuestFormDialog`,
  `UnifiedBookingModal`, `EnhancedCheckInModal` + `checkIn/*`, `PaymentDialog`,
  `CheckoutInvoiceModals`, `LoginPage`, `RegisterPage`, `SettingsPage`,
  `GuestCheckInForm` (kiosk), `CompleteProfilePage`.

- [ ] Steps: implement; gates; commit `feat(fe): mobile filter sheets + keyboard hints`.

## Task 6: Dashboards

- `ReceptionistDashboard`: `<sm` → KPI 2-col compact cards, arrivals/departures
  keep top priority with "View all" → `/bookings`, secondary panels →
  `Accordion`s.
- `ReportsAnalytics`: phone → KPI horizontal scroll-snap strip + collapsed
  sections; keep bespoke skin, only re-flow it (token reconciliation stays
  out of scope per consolidation spec).

- [ ] Steps: implement; gates; commit `feat(dashboard): mobile-prioritized dashboards`.

## Task 7: Rooms / housekeeping / timeline / guest surfaces

- `RoomManagementPage` + `RoomCard`: verify ≥44px actions + legible status on
  phone; fix what's deficient.
- `HousekeepingPage` board: `<sm` → stacked sections or tab switch.
- `RoomReservationTimeline`: inspect; horizontal scroll + sticky room col,
  else phone fallback notice.
- Kiosk (`guest-checkin/*`), `/offers`, `/legal/*`, `GuestPortalShell`: fix
  overflow/clipping at 320–430px.

- [ ] Steps: inspect → implement minimal fixes; gates; commit `feat(fe): phone fixes for rooms/hk/kiosk/guest surfaces`.

## Task 8: PWA

- `public/manifest.json`: real name/description, `display: standalone`,
  `start_url: /`, `scope: /`, `theme_color`/`background_color` = dark theme
  tokens, `icons`: 192/512/maskable-512 PNG + apple-touch 180.
- Generate PNGs from `hotel-desktop/src-tauri/icons/icon.png` via `sips`
  (macOS built-in; `sips -z H W`); copy a `favicon.ico` from desktop `icon.ico`
  so `index.html` refs stop 404ing. Add `icons/` under `public/`.
- No service worker.

- [ ] Steps: generate icons, manifest, index.html meta; `bun run build`;
  commit `feat(pwa): installable manifest + icons (no offline)`.

## Task 9: Final gates + report

- `bun run typecheck && bun run lint && bun run test && bun run build`.
- Update spec status → implemented; append remaining-issues backlog.
- Final report per spec's Verification section; commit; `git push origin master`.
