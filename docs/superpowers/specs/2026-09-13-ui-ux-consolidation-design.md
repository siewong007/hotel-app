# UI/UX Consolidation — Design Spec

Date: 2026-09-13. Status: pending user review.
Audit: `2026-09-13-ui-ux-consolidation-audit.md` (same directory).
Scope this session (user-approved "Phase 3 core"): dead-code deletion,
task-based nav regroup, label fixes, ledger payment-dialog merge,
reports consolidation onto `/insights`.

## Decisions (user)

- `/insights` is the canonical reporting surface (aligns with approved
  insights-administration spec); `/reports` becomes a redirect.
- Regroup the sidebar around staff tasks (not the current 9 groups).
- Merge only the twin **ledger payment** dialogs this session; guest-profile
  and room-status dialog merges are documented as follow-up.
- `/admin-portal` stays an alias — it is the cross-document entry URL for the
  staff app (login redirect, route guards, guest-document boundary). Do NOT
  redirect it.

## Navigation — before / after

Before (9 groups): overview · operations(Bookings, Timeline, Guests, Rooms,
Housekeeping, Support) · finance(Ledger, Payment Approvals, Night Audit,
Complimentary) · engagement(Loyalty, Communications) · revenue(Campaigns,
Revenue, Rates, Segments) · property(Online Inventory, Room Config) ·
insights(Insights, Reports) · administration(RBAC, eKYC, Audit Log, Data
Transfer, System Health, Jobs) · utility(Settings, Notifications, Help).

After (8 groups; overview/insights/utility stay label-less):

| Group | Items |
|---|---|
| overview | Overview `/` |
| front_office "Front Office" | Bookings · Timeline · Rooms · Housekeeping |
| guests "Guests" | Guests · Support · Loyalty |
| revenue "Revenue & Marketing" | Revenue · Rates · Campaigns · Segments · Communications · Online Inventory |
| finance "Finance" | Company Ledger · Payment Approvals · Night Audit · Complimentary Nights |
| insights | Insights `/insights` |
| administration "Administration" | Access Control · eKYC Admin · Hotel Settings · Audit Log · Data Transfer · System Health · Jobs |
| utility | Notifications · Help |

Rationale: Front Office = the daily desk loop (bookings, arrivals board,
room status, housekeeping board). Guests = guest-relations cluster per the
approved guest-relations spec (profiles, support queue, loyalty). Revenue &
Marketing absorbs Communications (email campaigns) and Online Inventory
(channel distribution) — both are acquisition/distribution surfaces.
Administration absorbs Hotel Settings (it is property configuration, not a
personal utility) and Room Config moves here too? — no: Room Config is
property *data setup*; Data Transfer already groups it under "System
Configuration". Decision: `room-config` → administration. (Keeps revenue
focused on selling, admin on configuring.)

Wait — room-config placement: putting it in Administration hides a frequently
used setup screen. Alternative: keep it in Front Office? It's not daily ops.
Decision: Administration — consistent with "System Configuration" taxonomy in
Data Transfer.

NavGroup union becomes:
`'overview' | 'front_office' | 'guests' | 'revenue' | 'finance' | 'insights' | 'administration' | 'utility'`
(`operations`, `engagement`, `property` removed).

- `route_access_policies` DB untouched — grouping is frontend-only; the RBAC
  nav editor reads groups from the registry.
- i18n: `groups.front_office` + `groups.guests` added to en/ms `nav.json`;
  dead group keys (operations/engagement/property) removed from both.
- `navGroups.test.ts` updated for new group ids.

## Label fixes

- `/guest-config` breadcrumbLabel "Guest Management" → "Guests" (matches nav).
- `/company-ledger` navLabel "Ledger" → "Company Ledger".
- Communications tab "Campaigns" → "Email Campaigns" (disambiguates vs
  `/campaigns` voucher/promo management).
- `/reports` nav entry removed; route redirects to `/insights`.

## Reports consolidation

Catalog coverage verified: `modules/insights/report_catalog.rs` serves 16
report ids ⊃ all 14 `ModernReportsPage` ReportTypes. Redirect loses only the
print-preview flow, so first port it:

1. Move `features/reports/utils/reportTypography.ts` (+test) →
   `features/insights/utils/reportTypography.ts` (it's the report-print
   settings bridge the /settings "Reports" tab feeds).
2. Add `features/insights/utils/reportEnvelopePrint.ts` — builds printable
   HTML from a `ReportEnvelope` (title, range, KPI grid, section tables)
   styled by `createReportPrintStyles`; opens the print window (same pattern
   as ModernReportsPage.handlePrint).
3. ReportShell gets a Print icon-button in the title row (visible when an
   envelope is loaded).
4. `routes/reports.tsx` → `throw redirect({ to: '/insights' })` (same pattern
   as `/promotions → /campaigns`).
5. Delete `features/reports/` entirely: ModernReportsPage, ReportsPage,
   AnalyticsDashboard, reportViews/*, hooks/* (verify `useReportData` has no
   outside callers first), index.ts. Remove `reports` route def + lazy import
   from registry; remove `ModernReportsPage` from `api` index if referenced.

## Ledger payment dialogs → one `RecordPaymentDialog`

Today: `PaymentDialog` (per-entry, `POST ledgers/{id}/payments`, history tab
with edit-date/delete) and `RecordCompanyPaymentDialog` (per-company
multi-entry, `POST ledgers/company-payments`, credit-on-account overflow).
Same task, two granularities, two endpoints — both preserved:

- One component `components/RecordPaymentDialog.tsx` with
  `mode: 'entry' | 'company'`.
- Shared inner `PaymentFields` grid (amount, method, reference, receipt,
  date, notes) parameterized over the two existing form shapes — parent state
  objects unchanged, so handlers and idempotency logic are untouched.
- `entry` mode keeps the Record/History tabs and over-payment block.
- `company` mode keeps the entry multi-select and overflow warnings.
- CustomerLedgerPage renders one dialog with mode derived from which open-
  state is set; `PaymentDialog.tsx` deleted.

## Dead code deletion (verified: no non-barrel importers)

`features/dashboard/components/{Dashboard,AdminDashboard,AdminOverviewDashboard}.tsx`,
`features/loyalty/components/PersonalizedReportsPage.tsx`,
`features/guests/components/GuestsPage.tsx` (+ barrel exports in each
`features/*/index.ts`; `features/reports` handled above).

## Explicit non-goals this session

- Guest-profile dialog merge, room-status dialog merge, check-in triplication
  (documented for follow-up — the room-status one collides with the in-flight
  `rooms/config.ts` work anyway).
- DataTable/PageHeader/EmptyState adoption sweep; ReportsAnalytics `--ink-*`
  ↔ token reconciliation; form-library introduction.
- No backend, permission, route-path, or API-shape changes. No new deps.

## Follow-up backlog (ranked, for `docs/ongoing-dev.md`)

1. Guest profile: converge `GuestProfileDialog`/`GuestDetailsDialog` into the
   guest-relations workspace; contextual dialogs link out.
2. Room status: one update dialog for rooms + housekeeping (after the
   in-flight room-card work lands).
3. Check-in: unify the three staff dialogs around one flow.
4. Notifications: when `modules/admin` staff notifications land, split
   "delivery log" vs "staff inbox" labeling.
5. Shared-primitive adoption sweep + `ReportsAnalytics` token reconciliation.
