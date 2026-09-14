# Ongoing Development

Single live tracker for open work. Keep entries to one line; **delete them when done**
rather than striking them through — shipped behavior belongs in
`docs/architecture/architecture-flow.md`, and detailed plans stay in `.claude/reports/`.

Last pruned 2026-09-13: completed entries from the 2026-08-22 security re-audit,
the eKYC PII history rewrite, L4 TOTP-at-rest, the `any`-type burn-down, portal
component coverage, and the GitHub Action SHA-pinning sweep were verified in the
tree and removed per convention.

## P0 — broken or security-relevant

- eKYC PII follow-up (from the 2026-08-22 history rewrite): production server
  copies of `uploads/ekyc/*` still need separate handling — the git history is
  clean but deployed artifacts were not part of it.
- H7 DECIDED 2026-08-22: stay on the PostgreSQL 19 beta track per owner call (images
  at `postgres:19beta3`). WHEN 19 GOES GA (~Sept/Oct 2026): bump images again and
  migrate data via pg_dump/pg_restore into a FRESH volume — beta on-disk formats
  have no supported upgrade path to GA, so the restore drill is mandatory either
  way. Desktop bundles ship their own postgres binaries: bump those resources in
  the same desktop release and rely on the existing pgdata version gate to refuse
  mismatched data dirs.
- Security-eval still OPEN (decisions/design): M10 least-privilege DB role
  rollout; L6 CSP vs PayPal; L14 desktop signing certs; H5 import semaphore.
- L4 deploy action (from the resolved TOTP-at-rest item): generate
  `openssl rand -base64 32` and add `TOTP_ENCRYPTION_KEY` to the prod secrets
  file on next deploy.

## P1 — decided, not yet executed

- (none)

## P2 — later

- FE test deserts (2026-09-14 update): loyalty and user settings suites are
  covered, and every `*Page` now has at least smoke + axe coverage —
  AuditLogPage, NightAuditPage, SystemHealthPage, JobsPage,
  ReportLibraryPage, RevenueOverviewPage, SegmentsPage, DataTransferPage,
  ComplimentaryManagementPage, CommunicationsPage, OffersPage,
  PromotionManagementPage, RatesPage, UserProfilePage, EkycManagementPage,
  EkycRegistrationPage, RoomManagementPage, RoomConfigurationPage,
  RBACManagementPage, EnrollTwoFactorPage, EmailVerificationPage all gained
  focused test files this session (the axe runs also surfaced and fixed ~57
  unlabeled form controls/buttons). Still thin by depth rather than coverage:
  the big workflow pages (RoomManagementPage, EkycManagementPage,
  RBACManagementPage, DataTransferPage) only have render-level smoke — real
  workflow assertions remain follow-ups. Remaining SettingsPage cards
  (hotel info, times, charges, support workflow, security, appearance) not
  yet split into sibling components.
- Desktop packaging: Windows/Linux CI jobs; network-fetch pgsql provisioning
  (today Homebrew/source-local only); arm or hide the updater
  (`hotel-desktop/UPDATER.md`); consolidate hand-maintained origin/proxy lists;
  desktop session persistence across restarts (SameSite boundary).
- Dependabot alert #13 (moderate): glib 0.18.5 in hotel-desktop/src-tauri
  (unsound VariantStrIter, fixed 0.20.0). Semver-pinned by the tauri/gtk stack —
  requires a coordinated tauri/gtk major upgrade with desktop regression
  testing, not a lockfile bump.
- Notifications v2 remaining: SMS channel (separate spec), DB-editable
  transactional templates, PDF receipts.
- UI/UX consolidation follow-ups (audit: docs/superpowers/specs/2026-09-13-ui-ux-consolidation-audit.md;
  earlier sessions shipped dead-code removal, task-based nav regroup,
  /reports→/insights, ledger payment-dialog merge). Status after the
  2026-09-14 pass:
  1. DONE — GuestProfileDialog/GuestDetailsDialog already share
     GuestProfileParts in the guest-relations workspace;
  2. DONE — rooms + housekeeping now share `RoomStatusUpdateDialog`
     (transition-table-driven); rooms' simpler hardcoded-options dialog
     deleted, the dialog accepts any `{id, room_number, status}` room;
  3. PARTIAL — bookings `CheckInDialog` now composes rooms'
     `ReservedCheckInDialog` (one shared form), and the rooms workflow was
     moved onto the same atomic single-request check-in payload (dropped the
     separate updateBooking + payment_status push). `EnhancedCheckInModal`
     inside UnifiedBookingModal stays separate: it is a richer workflow
     (full guest editing, advisory, company creation) already using the
     atomic payload;
  4. DONE — /notifications retitled "Guest Deliveries" (nav "Deliveries")
     with a subtitle pointing staff alerts to the topbar bell;
  5. PARTIAL — PageHeader adopted across admin/system pages + Guest
     Deliveries; EmptyState in AuditLogPage; SupportStatusChip now delegates
     to StatusChip. Deliberately kept distinct: StatusPill (dot-pill idiom),
     EkycStatusCard (full card), RoomStatusChip/Badge (icons, tooltips,
     pulse — different semantics). DataTable adoption still wide open;
  6. RESOLVED — ReportsAnalytics --ink-* vars are scoped aliases onto
     --hotel-* tokens inside `.salim-reports`; the boundary is already
     correct, no further action.

## Decisions needed (user)

- ~~Voided bookings leave their receivable open~~ RESOLVED (cascade chosen):
  `void_booking_ledgers_tx` (repositories/bookings/lifecycle.rs) now voids
  every open, non-reversal, unpaid ledger row linked to the booking inside
  the same transaction — applied in all three void paths (staff void, guest
  self-cancel, unpaid-hold release). Rows with `paid_amount > 0` are left
  open for reconciliation (same guard as manual `void_ledger`) and counted
  in the response as `ledger_entries_with_payments`; `ledger_entries_voided`
  is also reported. Pinned by
  `postgres_void_booking_voids_unpaid_ledger_rows_but_keeps_paid_ones`.
- ~~`GuestUpdateInput.is_active` is accepted but never persisted~~ RESOLVED:
  already a deliberate, documented no-op (models/guest.rs — activation is an
  admin-only action via services/users.rs; approved 2026-08-22, removal
  deferred to the next contract bump). No action.
- ~~FE zero-balance un-invoiced ledgers read "Paid"~~ RESOLVED (Draft chosen):
  `getLedgerUiStatus` now returns `'draft'` for `balance <= 0` rows whose
  stored status never reached `'paid'` — matching the backend
  `ui_status='draft'` bucket exactly. A "Draft" filter pill was added to
  `LedgerEntriesTab` so the badge and filter agree. Reversal rows
  (status='paid' hardcoded) correctly stay "Paid".
- ~~Branch protection on master~~ RESOLVED: direct-push workflow on master is
  the chosen process; no ruleset wanted.
- PayPal refunds/disputes: `PAYMENT.CAPTURE.REFUNDED` webhooks are
  signature-verified and audit-logged but never auto-applied. Auto-apply vs
  manual reconciliation is a money-policy call. Investigation note: a
  REFUNDED event can only arrive when a refund is issued *outside* this
  system (PayPal dashboard/API) — in-system refunds go through
  `refund_deposit` and never call PayPal. Auto-apply would need capture-ID
  matching via `supplementary_data.related_ids` (refund events don't carry
  our `custom_id`) plus partial-refund handling; it would auto-write refund
  rows for actions taken around the system, so flagging may stay preferable.
- ~~PayPal conflict banner needed `audit:read`~~ RESOLVED: new narrow
  endpoint `GET /api/admin/payments/paypal-conflicts` gated by
  `payments:read` (handlers/payments.rs +
  `AuditRepository::list_recent_logs_by_actions` with a caller-pinned action
  set). Frontend now calls it once instead of fanning out over audit-logs,
  and the banner shows to managers — previously invisible to exactly the
  approvers it exists for.
- Guest portal: forgot-password flow for self-registered guests, and the
  maximum advance-booking window.
