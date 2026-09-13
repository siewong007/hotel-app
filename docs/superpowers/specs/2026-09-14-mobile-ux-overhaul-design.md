# Mobile UX Overhaul — Design Spec

Date: 2026-09-14. Status: approved (design presented and confirmed by user).
Goal: make the whole app genuinely usable on phones (320–430px) without degrading
desktop productivity — "one system that works beautifully on every screen", not a
shrunken desktop site.

## Decisions (user)

- **Workspace:** commit directly on `master` in this checkout (no worktree).
- **Scope:** everything — staff shell, guest portal, kiosk check-in (`/guest-checkin`),
  public offers/legal pages.
- **PWA:** installable, no offline — manifest icons, standalone display, safe-area,
  theme-color. No service worker; no offline caching; no offline mutation.
- **Mobile nav:** bottom navigation `Home · Bookings · Guests · Ops · More`;
  hamburger drawer remains as the full-menu escape hatch.

## Approach

Shared-primitives-first (option A). The codebase already built the hard parts once —
this is an adoption + extension job, not a greenfield responsive pass:

| Already exists | Reuse |
|---|---|
| `DataTable.renderMobileCard` opt-in card list below `sm` | adopt on all DataTable consumers + migrate raw tables |
| `MuiDialog` theme override → full-screen sheet `<sm`, sticky title/actions | keep; fix content inside dialogs |
| `AppSidebar` temporary drawer `<md` + topbar hamburger | keep as escape hatch |
| Guest portal `BottomNavigation` (with reduced-motion + a11y treatment) | pattern to mirror for staff nav |
| `canAccessNavigationRoute` role/policy filter | identical filtering for bottom nav + More sheet |
| `UnifiedBookingModal` shared by 5 entry points; `CommandPalette`; `CheckoutInvoiceModals` | quick actions call these, never re-implement |
| Semantic tokens + `--hotel-*` vars, `StatusChip`, `PageHeader`, `EmptyState` | all new surfaces use these |

Rejected: per-page bespoke redesigns (inconsistent at ~50 routes) and a separate
mobile codebase (explicit non-goal).

## Audit findings (verified 2026-09-14 against local master @ 77001d4)

**Current mobile state:** sidebar→drawer and dialog→sheet conversions already land;
login is compacted; 3 tables have mobile cards (guests page, RBAC users, ledger
credits). Topbar compacts to a search icon on `xs`.

**Gaps:**

- No bottom/primary mobile navigation in the staff shell — every module hop is
  hamburger → drawer → scroll → tap (3+ taps).
- ~24 files render raw MUI `<Table>` with no card alternative; the 3 adopted
  `renderMobileCard`s are the exception. Raw-table pages include bookings, hk tasks,
  maintenance, payment approvals, ledger entries, audit log, jobs, vouchers,
  segments, comms, night audit, rate plans.
- No quick-action affordance on mobile (⌘K is desktop-centric).
- No filter-sheet pattern — pages mount desktop filter bars.
- `index.html` viewport lacks `viewport-fit=cover`; no safe-area handling anywhere.
- `manifest.json` is a stub: favicon-only icons, generic name, no maskable icon,
  `theme_color` `#1a73e8` doesn't match either theme.
- Touch targets at MUI defaults (<44px in places: icon buttons, pagination ‹ ›).
- No payroll/employees module exists (per consolidation audit — do not invent;
  RBAC UsersTab is the staff-account surface).
- `/timeline` rooms×dates grid untested at phone widths — likely needs a
  constrained fallback rather than a shrunken grid (decide at implementation).
- `ReceptionistDashboard` stacks on `xs` but shows full desktop density
  (5 KPI cards + multi panels); `ReportsAnalytics` uses a bespoke `--ink-*` skin.
- Forms mostly lack `inputMode`/`type` hints (tel/email/numeric keyboards).

## Design

### 1. Responsive foundation

- Breakpoints stay canonical: `sm`/`md` MUI defaults; new code uses
  `theme.breakpoints.down('sm')` for phone and `down('md')` for the nav shell —
  matching `DataTable`/`AppSidebar`/`RootLayout` today.
- `index.html`: `viewport` → `width=device-width, initial-scale=1, viewport-fit=cover`.
  Do NOT set `user-scalable=no` (accessibility).
- `env(safe-area-inset-*)` helpers in `index.css` (`--sat`, `--sab`) consumed by the
  bottom nav, FAB, sticky dialog actions, and shell padding.
- Theme (`theme/index.ts`): on `@media (pointer: coarse)` raise effective touch
  targets to ≥44px for `MuiIconButton`, `MuiButton` small, `MuiTab`, drawer/list
  items, pagination buttons — keeps desktop density, fixes phones+tablets.
- `useMediaQuery(theme.breakpoints.down('sm'))` helper `useIsPhone()` in
  `src/hooks` — one canonical phone predicate instead of ad-hoc queries.

### 2. Staff navigation

- New `src/components/layout/MobileNavBar.tsx`: `BottomNavigation` rendered `<md`
  inside `RootLayout` after the main column. Tabs:
  - **Home** → `/`
  - **Bookings** → `/bookings` (hidden if no access; falls back per role)
  - **Guests** → `/guest-config`
  - **Ops** → `/room-management` when accessible, else `/housekeeping`
  - **More** → opens `MobileMoreSheet` (`SwipeableDrawer` anchor=bottom) listing
    every other role-visible route grouped by `navGroups.ts` order/labels, plus
    Notifications, Profile, Help.
- All items filtered through `canAccessNavigationRoute` with the same
  `hasPermission/hasRole/getRoutePolicy` from `useAuth` — bottom nav visibility is
  always a subset of sidebar visibility.
- Active tab = `isNavItemActive` against current pathname; `aria-current="page"`.
- Content bottom padding `calc(64px + var(--sab))` on `<md` so the bar never
  covers content or sticky footers.
- i18n: new keys under `nav.*` (en + ms), matching existing `nav.json` pattern.

### 3. Quick actions

- `MobileQuickActions`: FAB (`SpeedDial`-style single button → bottom sheet, not a
  hover speed-dial) rendered `<sm` on the staff shell. Sheet lists role-filtered
  actions that invoke canonical surfaces only:
  - New booking → opens `UnifiedBookingModal` (same component as ⌘K entry)
  - Search → `CommandPalette` (existing global guest/booking search)
  - Today's arrivals / departures → `/bookings` with the existing filter preset
  - Check in / Check out / Collect payment → `/bookings` (+ deep link where a
    booking context exists)
  - Room status → `/room-management`; New task / Report issue → `/housekeeping`
  - New guest → guests page create flow
- Each action renders only when the user can reach its destination (same access
  check); the sheet shows a friendly empty state if none apply.
- FAB hidden on routes where it would collide (kiosk, guest portal — separate
  shells anyway) and suppressed while a dialog/sheet is open if needed.

### 4. Tables → mobile cards

- Adopt `renderMobileCard` on existing `DataTable` consumers missing it.
- Migrate raw MUI tables in priority order — bookings list first, then
  housekeeping TasksView, MaintenanceTab, PaymentApprovals, ledger entries,
  audit log, jobs, vouchers/promotions, segments, communications, night audit,
  rates. Where a full `DataTable` migration is unjustified, wrap the table in a
  `TableCardList`-style dual render (extract a tiny shared renderer if the same
  3-field+chip card shape repeats — likely: title / subtitle line / status chip /
  chevron).
- Mobile card contract: primary line (name/id), one secondary line (dates/room),
  status chip (text, never color-only), single tap → existing detail surface.
  Row actions that don't fit become the detail surface's job — mobile cards link
  out, they don't cram menus.

### 5. Search & filters

- New `FilterSheet` primitive (`components/common`): trigger button + bottom
  `SwipeableDrawer` hosting the page's existing filter controls, `Apply`/`Reset`
  footer, active filters echoed as removable `Chip`s.
- Adopt on: bookings, housekeeping, payment approvals, ledger, audit log,
  vouchers, comms — wherever a desktop filter bar exists. Desktop renders the bar
  unchanged; `<sm` renders the button+sheet.

### 6. Forms

- Full-screen dialog sheet already lands via theme; inside them: `inputMode` +
  `type` sweep on free-text fields (`tel`, `email`, `decimal`/`numeric`,
  `url`, `search`), `autoComplete` where obvious (name/email), `enterKeyHint` on
  single-submit forms.
- Keep existing tab/step structure of long flows (UnifiedBookingModal,
  EnhancedCheckInModal, SettingsPage) — already sectioned; ensure tab strips
  scroll horizontally on phone instead of wrapping/crushing.
- No new form library (per AGENTS.md dependency policy).

### 7. Dashboards

- `ReceptionistDashboard`: on `<sm`, KPI grid → 2-col compact cards; Today
  sections (arrivals/departures) stay first-class; secondary panels collapse into
  `Accordion`s or move behind "View all" → full routes. Cap: today's priorities
  visible within ~2 viewports.
- `ReportsAnalytics`: mobile = compact KPI carousel (horizontal scroll-snap,
  token-aligned) + collapsed panels; drill-down drawers already exist and become
  bottom sheets via the same Sheet primitive.
- No new chart lib; recharts stays, `ResponsiveContainer` with a mobile min-height
  and simplified axes/legend on phone.

### 8. Per-surface sweep

- **Rooms** (`/room-management`): card grid already exists — verify card actions
  ≥44px, status text+chip legible, filters → FilterSheet.
- **Housekeeping**: Board lanes → vertically stacked sections or a tab switcher
  on `<sm`; task cards already exist (RoomTaskCard) — extend.
- **Timeline** (`/timeline`): inspect at phone width; expected outcome is a
  horizontal-scroll grid with sticky room column + day jump, OR a "best on a
  larger screen" notice with the data reachable via bookings — decide on
  inspection, document whichever ships.
- **Guest portal / kiosk / offers / legal**: same audit+fix pass (portal already
  has bottom nav; verify kiosk form steps, offers cards, legal prose at 320px).
- **Admin/finance pages**: card-list tables + FilterSheet; these are
  desktop-primary but must not overflow/clip on phone.

### 9. PWA

- `manifest.json`: real name, `short_name`, `display: standalone`, `start_url`,
  `scope`, `orientation: any`, `theme_color`/`background_color` matching the dark
  flagship theme, `lang: en`, icons: 192, 512, maskable 512, apple-touch-icon 180.
- `index.html`: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`,
  `theme-color` matching manifest. No service worker — all hotel data stays live.

### 10. Performance

- Routes already lazy via `lazyRoute`; add `preloadRoute` on bottom-nav
  touchstart (pattern exists in registry).
- Mobile card lists reuse existing pagination; no dataset growth.
- Skeletons exist in DataTable mobile branch; extend the same pattern to new
  card lists. No new dependencies.

### 11. Accessibility & dark theme

- Bottom nav labels always visible; icon+text; `aria-current`.
- Sheets: `aria-modal`, labelled, swipe-down/backdrop dismiss, focus return.
- Status = chip with text (existing `StatusChip`), never color alone.
- Focus rings and reduced-motion already in theme — verify on new components.
- Dark flagship theme is the default; check new surfaces (bottom bar, sheets,
  FAB) against tokens — no hardcoded colors.

## Non-goals

- No backend/API/permission/schema changes. No new npm dependencies.
- No offline mode, service worker, or background sync.
- No payroll/HR/employee module (does not exist — don't invent it).
- No `/guest-portal` redesign — verify + fix only; it has its own approved shell.
- No re-implementation of workflows that already have a canonical component —
  mobile links to or opens them.
- Desktop layout changes beyond the coarse-pointer touch-target override.

## Rollout order

1. Foundation: viewport, safe-area, `useIsPhone`, touch targets, Sheet primitive.
2. Mobile nav + More sheet + Quick actions.
3. Table→card migration, high-traffic first (bookings → housekeeping →
   maintenance → approvals → ledger → audit → the rest).
4. FilterSheet adoption + form input hints.
5. Dashboards (receptionist then admin).
6. Guest-facing surfaces verify/fix.
7. PWA manifest/icons.
8. Gates + audit report (`typecheck`, `lint`, `test`, `build` after each phase).

## Verification

- `bun run typecheck && bun run lint && bun run test` + `bun run build` per phase
  (from `hotel-web-fe/`).
- New primitives get Vitest+RTL tests following existing test style; axe a11y
  check where an existing suite covers shell components.
- Manual width review (320/360/375/390/414/430) documented per page class —
  reasoned from rendered layout since no device lab exists here; overflow-safe
  CSS (`min-width:0`, `100dvh`, `max-width:100%`) is the mechanical guarantee.
- Final report: audit findings, redesigned components/pages, nav architecture,
  workflow deltas, breakpoints, perf + a11y + PWA notes, remaining issues ranked.
