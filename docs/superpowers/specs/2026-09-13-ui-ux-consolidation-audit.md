# UI/UX Consolidation Audit

Date: 2026-09-13. Audited against local `master` (855abbee1, 0 behind origin/master).
Scope: `hotel-web-fe` staff app + guest-facing routes. Read-only audit — no code changed.

## 0. Context: in-flight redesigns this audit must not contradict

Several consolidation efforts were merged or approved **today**; they already own
part of this problem space:

| Effort | State | What it owns |
|---|---|---|
| Admin navigation redesign | merged | Sidebar + topbar shell, 9-group nav, ⌘K palette, breadcrumbs |
| Guest relations module | merged (backend `modules/guest_relations`) | `/guest-config` → Guest Relations workspace; GuestsPage.tsx already declared dead |
| Revenue & marketing (phase 0–4) | merged | `/revenue`, `/rates`, `/segments`, `/campaigns` group |
| Insights & administration | spec approved, partially landed (`modules/insights`, `/insights` catalog page) | `/insights` as canonical reporting surface; `modules/admin` for staff lifecycle, jobs, health |
| Voucher module redesign | planned | `/campaigns` (PromotionManagementPage) |
| Room-status card fills | dirty worktree (`rooms/config.ts`) | Do not touch |

## 1. Route inventory

### Staff app — sidebar routes (auth)

| Group | Route | Page component | Notes |
|---|---|---|---|
| overview (unlabeled) | `/` | DashboardRouter → ReceptionistDashboard (front desk) / ReportsAnalytics (admin+manager) | Same URL serves two different pages by role |
| operations | `/bookings` | BookingsPage (3.1k-line master/detail + 8 dialogs) | |
| operations | `/timeline` | RoomReservationTimeline | rooms × dates grid |
| operations | `/guest-config` | GuestConfigurationPage (1858 lines) | label "Guests" — path/label mismatch |
| operations | `/room-management` | RoomManagementPage (1083 lines, ~13 dialogs) | |
| operations | `/housekeeping` | HousekeepingPage (Board / Tasks / Maintenance tabs) | |
| operations | `/support` | SupportManagementPage (conversation queue) | |
| finance | `/company-ledger` | CustomerLedgerPage (in `features/admin`) | nav label "Ledger" |
| finance | `/payment-approvals` | PaymentApprovalsPage | |
| finance | `/night-audit` | NightAuditPage | |
| finance | `/complimentary` | ComplimentaryManagementPage | |
| engagement | `/loyalty` | LoyaltyPortal (997 lines) | |
| engagement | `/communications` | CommunicationsPage (tabs: Campaigns / Templates / Suppressions) | |
| revenue | `/campaigns` | PromotionManagementPage (vouchers/promos) | name collides with comms "Campaigns" tab |
| revenue | `/revenue` | RevenueOverviewPage | |
| revenue | `/rates` | RatesPage (Rate Calendar / Rate Plans) | |
| revenue | `/segments` | SegmentsPage | |
| property | `/online-inventory` | OnlineInventoryPage | |
| property | `/room-config` | RoomConfigurationPage | |
| insights (unlabeled) | `/insights` | ReportLibraryPage (server report catalog) | same icon as /reports |
| insights (unlabeled) | `/reports` | ModernReportsPage (14 built-in report types) | duplicate surface |
| administration | `/rbac` | RBACManagementPage (Users/Roles/Permissions) | = de-facto staff-account admin |
| administration | `/ekyc-admin` | EkycManagementPage | |
| administration | `/audit-log` | AuditLogPage | |
| administration | `/data-transfer` | DataTransferPage (import/export) | |
| administration | `/system-health` | SystemHealthPage | |
| administration | `/jobs` | JobsPage | |
| utility (unlabeled) | `/settings` | SettingsPage (1372 lines, 7 tabs) | lives in `features/user` |
| utility (unlabeled) | `/notifications` | NotificationsPage (outbound delivery feed) | same data as topbar bell |
| utility (unlabeled) | `/help` | HelpCenterPage | |

### Auth routes not in nav
`/profile` (UserProfilePage, 5 tabs), `/my-rewards` (LoyaltyDashboard, 1417 lines),
`/ekyc` (staff eKYC registration), `/enroll-two-factor`, `/admin-portal` (alias → dashboard).

### Guest-facing
Unauth kiosk: `/guest-checkin` (+ verify/form/confirm). Public: `/guest-portal`
(+ `?view=booking`), `/portal` → redirects to `/guest-portal` (already a redirect —
good precedent), `/offers`, `/legal/*` ×4, `/booking/recover-payment/$token`,
`/unsubscribe/$token`, landing `/` when signed out. Status: `/403`, `/423`, `/$`.

## 2. Feature-to-screen map — duplicates

| Capability | Current locations | Duplicate? | Recommended canonical home |
|---|---|---|---|
| Guest search | GuestConfigurationPage search; `GuestSelector` (rooms, used only by UnifiedBookingModal); CommandPalette (global); ad-hoc pickers in VoucherIssueDialog, CompanyCheckInDialog, EkycCreateDialog, BookingFiltersBar | Yes — ≥5 implementations | One `GuestPicker` component fed by `searchGuests`; CommandPalette stays global |
| Guest profile / 360 | `GuestProfileDialog` (guests: Overview/Reservations/Duplicates tabs) + `GuestDetailsDialog` (rooms: Guest Info tab + more) | Yes — two profile dialogs | Guest Relations workspace (per approved spec); rooms keeps a lightweight contextual dialog linking to it |
| Booking creation | `UnifiedBookingModal` — already shared: BookingsPage, RoomManagementPage, GuestConfigurationPage, NightAuditReportViews, ⌘K "New booking" | Mostly consolidated already | Keep as canonical; ensure every entry point opens the same modal |
| Check-in | `CheckInDialog` (bookings), `ReservedCheckInDialog` (rooms), `EnhancedCheckInModal` (inside UnifiedBookingModal), `CompanyCheckInDialog` (ledger), `/guest-checkin` kiosk | Yes — 3 staff dialogs + kiosk | One check-in flow component; kiosk stays separate (unauth) |
| Payment collection | `PaymentDialog` (bookings); `CheckoutInvoiceModals` (shared: bookings, rooms, check-in modal, ledger); ledger `PaymentDialog` **and** `RecordCompanyPaymentDialog` (two company-pay dialogs in one feature); `PaymentInfoTab` (check-in); `/payment-approvals`; public recover-payment | Yes — especially ledger's twin dialogs | Folio/checkout = CheckoutInvoiceModals; company ledger = merge the two payment dialogs; approvals stay a queue |
| Room status | RoomManagementPage grid + `RoomStatusDialog`; Housekeeping BoardView lanes + `RoomStatusUpdateDialog`; ReceptionistDashboard room section; RoomReservationTimeline | Yes — 3 boards, 2 update dialogs | Rooms = operational truth; housekeeping board keyed off same status; receptionist dashboard read-only summary |
| Room status visuals | `RoomStatusChip` + `RoomStatusBadge` + `RoomStatusSummaryCard` + `housekeepingConfig` meta + `StatusChip` (shared) | Yes — 4+ parallel status systems | One status-token mapping + StatusChip |
| Reports / analytics | ReportsAnalytics (admin `/`); `/reports` ModernReportsPage (14 types); `/insights` ReportLibraryPage (server catalog); NightAuditReportViews; `reports/` dead pages | Yes — 3 living surfaces + dead code | `/insights` catalog = canonical (already decided); fold /reports views into catalog entries; admin dashboard keeps only decision KPIs |
| Dashboards | ReceptionistDashboard; ReportsAnalytics; dead: Dashboard, AdminDashboard, AdminOverviewDashboard, ReportsPage, AnalyticsDashboard, PersonalizedReportsPage, GuestsPage | Yes — 7 files, ~half dead | 2 living dashboards (ops board + admin KPIs); delete dead files |
| Notifications | NotificationCenter (topbar bell) + `/notifications` page — both read `useDeliveryFeed` (outbound guest deliveries) | Pair is fine; labeling is not | Keep bell→page; page is a *delivery log*, not staff inbox (insights spec plans staff notifications — rename then) |
| "Campaigns" | `/campaigns` = voucher/promo management; CommunicationsPage tab "Campaigns" = email campaigns | Yes — same word, two features | Rename comms tab to "Email campaigns" (or merge surfaces later) |
| Staff management | `/rbac` UsersTab only | No HR/payroll module exists | Do not invent; RBAC UsersTab is the staff-account home |
| Settings | `/settings` (7 tabs: Hotel, Charges & Tax, Reports, Guest Policies, Security, Appearance, Code Lists); `/room-config`; `/data-transfer` "System Configuration" categories; guest page has config aspects | Partially | Settings stays the config home; room-config stays domain-owned |
| eKYC | `/ekyc` (registration flow), `/ekyc-admin` (management), EkycCreateDialog (guest page) | Acceptable | Keep: capture vs review are different tasks |

## 3. Dead code (verified — no importers outside barrel `index.ts`)

- `features/dashboard/components/Dashboard.tsx`
- `features/dashboard/components/AdminDashboard.tsx`
- `features/dashboard/components/AdminOverviewDashboard.tsx`
- `features/reports/components/ReportsPage.tsx`
- `features/reports/components/AnalyticsDashboard.tsx`
- `features/loyalty/components/PersonalizedReportsPage.tsx`
- `features/guests/components/GuestsPage.tsx` (also declared dead in guest-relations spec)

## 4. Navigation problems

- 9 nav groups; `overview`, `insights`, `utility` render without headings (label-less).
- `insights` + `reports` are sibling items with the **same icon** — two doors to reporting.
- `/campaigns` sits in `revenue` group; Communications (which contains email campaigns)
  sits in `engagement` — cross-group naming collision.
- `guest-config` path vs "Guests" label mismatch; `company-ledger` labeled "Ledger".
- `/admin-portal` is an alias route for `/` (dashboard) — legacy URL still routed.
- `features/admin` is a grab-bag: finance pages (CustomerLedger, NightAudit,
  PaymentApprovals, complimentary) live there while `features/{audit-log,rbac,
  night-audit,data-transfer,customer-ledger}` are 4-line barrel shims pointing back in.
- No quick-action affordance in topbar (⌘K only).

## 5. Design-system state

**Strong foundation already exists**: `theme/tokens.ts` semantic tokens (dark flagship
"cinematic charcoal + champagne", light counterpart), `--hotel-*` CSS vars published
by the MUI theme, `StatusChip`, `ConfirmProvider`, `EmptyState`, `PageHeader`,
`DataTable`, `MoneyText`, `DateText`, i18n nav labels, reduced-motion + focus rings.

**Adoption gaps:**
- `DataTable`: 3 users (guests page, ledger credits, RBAC users) vs ~30 raw MUI tables.
- `PageHeader`: ~7 users; most pages hand-roll `Typography h4/h5` titles.
- `EmptyState`: ~12 users.
- Parallel status components: `StatusPill` (ledger), `VoucherStatusChip`,
  `SupportStatusChip`, `EkycStatusCard`, `RoomStatusChip`/`Badge`/`SummaryCard`,
  housekeeping status meta — all beside shared `StatusChip`.
- `ReportsAnalytics` uses a **bespoke CSS system** (`reports.css`, `--ink-*` vars,
  `.kpi`/`.cpanel`/`.livetile` classes) — a second visual language beside MUI+tokens.
- In-flight `rooms/config.ts` adds literal-hex `cardFill`s — bypasses tokens
  (other session's work; flagging, not touching).
- No form library: every form is manual `useState` (SettingsPage = 1372 lines of it);
  validation patterns vary per dialog.
- Snackbar used in ~11 files for feedback; no unified toast pattern.

## 6. Cross-module workflow findings

- **Guest → Booking → Payment**: possible today but dialog-deep — guest page opens
  booking modal, bookings open checkout invoice, but there is no dedicated guest
  profile *page*; context lives in stacked modals. Guest-relations spec addresses this.
- **Booking → Room → Housekeeping**: rooms page can create bookings, check in,
  open invoices; housekeeping can't see booking context without leaving its board.
- **Revenue → drill-down**: ReportsAnalytics KPIs have drawers (outstanding,
  occupancy, revenue, flow) — the best drill-down pattern in the app; other
  dashboards/reports lack it.
- **Metric definitions**: insights spec already documented occupancy computed 3 ways,
  revenue 4 ways — `modules/insights` is the designated single definition site.

## 7. Priority recommendations (ranked)

1. **Delete dead code** (7 files, zero risk) — frees the namespace for consolidation.
2. **Resolve the reports triplication** per the approved insights spec: `/insights`
   catalog canonical; `/reports` entries become catalog cards or redirect.
3. **Merge the twin dialogs**: ledger `PaymentDialog`+`RecordCompanyPaymentDialog`;
   `GuestProfileDialog`+`GuestDetailsDialog`; `RoomStatusDialog`+`RoomStatusUpdateDialog`.
4. **Fix naming collisions**: comms "Campaigns" tab rename; `guest-config` path or
   label; "Ledger" → "Company Ledger".
5. **Fold `property` group** (2 items) into operations/administration; fold
   `admin-portal` alias into a redirect.
6. **Adopt shared primitives**: PageHeader/EmptyState/StatusChip/DataTable sweep
   (mechanical, per-page).
7. **Reconcile ReportsAnalytics' bespoke CSS** with tokens (or bless it as the
   dashboard skin and document the boundary).
8. **Room-status source of truth**: one status-update dialog used by rooms +
   housekeeping.
9. **Staff notifications vs delivery feed**: clarify when `modules/admin` staff
   notifications land (insights spec).
