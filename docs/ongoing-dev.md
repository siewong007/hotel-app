# Ongoing Development

Single live tracker for open work. Keep entries to one line; **delete them when done**
rather than striking them through — shipped behavior belongs in
`docs/architecture/architecture-flow.md`, and detailed plans stay in `.claude/reports/`.

Last pruned 2026-09-15 (doc-sync audit): the L4 `TOTP_ENCRYPTION_KEY` action was
removed as obsolete — `deploy/deploy.sh:211` already generates and persists that
key via `ensure_secret_default` on every deploy, so the manual step it asked for
would have contradicted CLAUDE.md's "never hand-provision secrets on the host".
The resolved decision entries were pruned in the same pass (see that section).
Prior prune 2026-09-13: 2026-08-22 security re-audit entries, the eKYC PII
history rewrite, L4 TOTP-at-rest, the `any`-type burn-down, portal component
coverage, and the GitHub Action SHA-pinning sweep.

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

## P1 — decided, not yet executed

- (none)

## P2 — later

- FE test deserts (2026-09-18 update): loyalty and user settings suites are
  covered, every `*Page` has at least smoke + axe coverage, and the four big
  workflow pages (RoomManagementPage, EkycManagementPage, RBACManagementPage,
  DataTransferPage) now carry real interaction assertions —
  `pageManifest.workflowTests` is content-checked so a listed file must
  simulate user interaction or fail CI. Still thin by depth — next tier by
  component/test ratio stays as follow-ups: EkycRegistrationPage,
  CommunicationsPage, NightAuditPage, RoomConfigurationPage, LoyaltyPortal.
  SettingsPage cards are split into sibling components.
- Phone/tablet density backlog (migrated 2026-09-15 from the deleted
  `superpowers/reports/2026-09-14-mobile-ux-report.md` as that plan's artifacts
  were pruned; priority order preserved). Item 4 of the original five —
  `/help/$slug` never mounting — was **verified fixed**: `routes/help.tsx` now
  renders an `<Outlet/>` via `useChildMatches()`. Remaining, unverified at the
  stated widths:
  1. `/housekeeping` at 320px — "+ New task" CTA clipped (pre-existing).
  2. `GuestProfilePage` — 5 inner tables still desktop-dense.
  3. `DataTransferPage` ~50 always-expanded cards; `RBACManagementPage`
     accordions; `AuditLogPage` stream cards. (A session was actively editing
     these three files on 2026-09-15 — check `git log` before re-reporting.)
  4. Staged-changes bar still occluded on 600–899px tablets (sm–md); the `xs`
     occlusion behind `MobileNavBar` was fixed.
- Desktop postgres lags the server: bundle is `19beta2`
  (`CONFIGURED_POSTGRES_BUILD_IDENTITY`, `hotel-desktop/src-tauri/src/postgres.rs`)
  while every server/CI/compose pin is `19beta3`. Bump with the GA move above —
  it needs re-provisioning plus a pgdata rebuild, not just a constant edit.
- Desktop packaging (hardening landed 2026-09-18/19): **updater ARMED** via
  GitHub Releases — real pubkey + `releases/latest/download/latest.json`
  endpoint, `install_update`/`restart_app` commands, tag-gated
  `desktop-release` job publishes `latest.json` + installers, and a
  SystemHealthPage update card gated on `VITE_DESKTOP_UPDATER_ENABLED`
  (owner doc: [`hotel-desktop/UPDATER.md`](../hotel-desktop/UPDATER.md);
  secrets `TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]` are set, keypair generated
  2026-09-18). **Signing wired, certs pending** — Windows PFX/thumbprint and
  macOS keychain-sign/notarytool paths are all `env`-gated, so unsigned
  stays the default; note that an absent `TAURI_SIGNING_PRIVATE_KEY` now
  *hard-fails* bundle builds (updater signing is mandatory once configured)
  while absent cert secrets only mean unsigned OS-level artifacts. **RPM
  shipped** — default Linux bundle + `fedora:41` install smoke
  ([eval record](../.claude/reports/rpm-eval-2026-09-19.md)). Origin/proxy
  drift is enforced by `hotel-desktop/scripts/origin-parity.test.mjs`.
  E2E: the first three full-bundle dispatches failed (35354808394,
  35398662670, 35416174865) and every failure got a landed fix
  ([run ledger](../.claude/reports/desktop-build-e2e-2026-09-19.md))
  — final verification run 35425902135 **in progress**, not yet green.
  Still open: provision signing certs (Windows PFX, Apple Developer ID +
  notarization creds) then verify a signed/notarized build end-to-end;
  desktop session persistence across restarts stays an accepted limitation
  (SameSite boundary — the fix is token-in-keychain work, a separate spec).
- Dependabot alert #13 (moderate): glib 0.18.5 in hotel-desktop/src-tauri
  (unsound VariantStrIter, fixed 0.20.0). Semver-pinned by the tauri/gtk stack —
  requires a coordinated tauri/gtk major upgrade with desktop regression
  testing, not a lockfile bump.
- Notifications v2 remaining: SMS channel (separate spec), DB-editable
  transactional templates, PDF receipts.
- UI/UX consolidation follow-ups (the 2026-09-13 audit spec was removed with
  the shipped-plan cleanup — git history has it; earlier sessions shipped
  dead-code removal, task-based nav regroup,
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

Nothing open. The struck-through RESOLVED entries that used to live here were
pruned 2026-09-15 per this file's own "delete them when done" rule; git history
has the full text. Four had already been migrated to an owner doc — the
void→ledger cascade to `.claude/refs/{booking,ledger}-workflow.md`, both PayPal
decisions to `architecture/architecture-flow.md` §Payments, and the
`is_active` no-op to its code comment in `models/guest.rs`.

Three were decisions with no other home, kept here as standing policy:

- **Branch protection on master:** an active ruleset now exists — corrected
  2026-09-15 after a direct push was accepted with `remote: Bypassed rule
  violations … Changes must be made through a pull request`. Ruleset
  `master-protection` (id 21196959) is `enforcement: active` with a single
  `pull_request` rule and a `RepositoryRole` bypass set to `always`, so repo
  admins still push straight to master while everyone else must open a PR.
  The entry this replaces claimed "deliberately none; no ruleset wanted",
  which was true when written and is no longer. Verify with
  `gh api repos/siewong007/hotel-app/rules/branches/master` before assuming
  either way.
- **Guest portal forgot-password and max-booking-window:** won't do. Neither
  feature is wanted — do not re-propose them as gaps.
- **Zero-balance un-invoiced ledger rows read "Draft", not "Paid":**
  `getLedgerUiStatus` returns `'draft'` for `balance <= 0` rows whose stored
  status never reached `'paid'`, matching the backend `ui_status='draft'`
  bucket; `LedgerEntriesTab` carries a matching "Draft" filter pill. Reversal
  rows (status hardcoded `'paid'`) correctly stay "Paid".
