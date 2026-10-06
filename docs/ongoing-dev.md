# Ongoing Development

Single live tracker for open work. Keep entries short and **delete them when
done** rather than striking them through. Shipped behavior belongs in the
owning document (see [`README.md`](README.md)), and active plans live in
[`working-notes/`](working-notes/) until they merge.

Last pruned and re-verified against the code on 2026-10-05. That pass
retired every plan and report: the two September plans (seed system,
four-locale legal corpus and landing page), the gRPC phase records, the
19beta3 cutover runbook, and all of `.claude/reports/`. It also carried the
still-open findings from the July 2026 audits into this file. Earlier prune
notes are in `git log -- docs/ongoing-dev.md`.

## P0 — broken or security-relevant

- **Ledger summary does not net credit notes.** `get_ledger_summary`
  (`hotel-app-be/src/modules/ledgers/repository.rs`) sums `amount`/`paid_amount`/
  `balance_due` over every non-void row with no sign handling. A reversal
  therefore doubles the billed total and invents collected cash instead of
  netting to zero. The fix-gated test
  `tests/ledger_characterization.rs::postgres_create_ledger_reversal_nets_to_zero_in_summary`
  is `#[ignore]`d, and CI's stale-ignore check flags it once it starts passing.
  This is the last open money blocker from the July 2026 booking/payment/ledger
  audit (its B6).
- **PostgreSQL 19 track (H7, owner decision 2026-08-22: stay on the beta
  track).** Production, staging, CI and compose run `postgres:19beta3`.
  - **Blocker:** 19 Beta 4 (2026-09-24) reverted SQL/PGQ, which the V1
    baseline's `CREATE PROPERTY GRAPH public.hotel_graph` uses. Nothing can
    move off beta3, to beta4, the RC (expected early October 2026) or GA
    (possibly October 2026), until the baseline drops the graph and a catalog
    patch drops it from installed databases while they are still on beta3.
    That is a drop, not an additive patch, so it needs an explicit go-ahead.
  - **Then:** the dump-and-restore in
    [`guides/postgres-engine-upgrade.md`](guides/postgres-engine-upgrade.md),
    rehearsed on staging first. The desktop bundle (`19beta2`, see P2) moves
    in the same push.
- eKYC PII follow-up (from the 2026-08-22 history rewrite): production server
  copies of `uploads/ekyc/*` still need separate handling. Git history is
  clean, but deployed artifacts were not part of that rewrite.
- Security-eval items still open:
  - **M10 least-privilege DB role.** The backend still connects as
    `hotel_admin` (`deploy/docker-compose.prod.yml`). The role script
    `deploy/db-least-privilege.sql` exists but has not been rolled out.
  - **L14 desktop signing certificates.**
  - **H5 data-transfer import concurrency.** Nothing in
    `modules/data_transfer/` bounds concurrent imports.

## P1 — decided, not yet executed

- (none)

## P2 — later

- **Residue of the July 2026 user-domain audit** (re-verified 2026-10-05;
  every other finding from it is fixed):
  1. The `/users` and `/rbac` admin routes have no rate limiter.
  2. `user_roles.assigned_by` is never written: all six `INSERT INTO
     user_roles` sites omit it. "Who granted this role" depends on
     `audit_logs` (`team_members.added_by` *is* written).
  3. No UI creates, updates or deletes a permission, or edits a route access
     policy. `features/admin/components/rbac/PermissionsTab/` is exported but
     never mounted, and `AdminService.updateRouteAccessPolicy` has no caller.
  4. `NightAuditPage`'s run control is not permission-gated in the UI. The
     backend still enforces `night_audit:execute`.
- **Phone/tablet density backlog** (from the 2026-09-14 mobile report,
  priority order). PRs #193 and #194 (2026-09-26/29) were phone (`xs`) and
  coarse-pointer passes and did not touch these:
  1. `/housekeeping` at 320px: the "+ New task" CTA is clipped.
  2. `GuestProfilePage`: five inner tables are still desktop-dense.
  3. `DataTransferPage` (~50 always-expanded cards), `RBACManagementPage`
     accordions, and `AuditLogPage` stream cards.
  4. The staged-changes bar is still occluded on 600–899px tablets (`sm`–`md`).
- **Desktop PostgreSQL lags the server.** The bundle is `19beta2`
  (`CONFIGURED_POSTGRES_BUILD_IDENTITY`, `hotel-desktop/src-tauri/src/postgres.rs`),
  while every server, CI and compose pin is `19beta3`. Move it with the GA
  move (P0). That needs re-provisioning plus a pgdata rebuild, which the app
  automates via "Restore from backup", not just a constant edit.
- **Desktop signing.** The updater is armed through GitHub Releases
  ([`hotel-desktop/UPDATER.md`](../hotel-desktop/UPDATER.md)); an absent
  `TAURI_SIGNING_PRIVATE_KEY` hard-fails bundle builds. OS signing is wired
  but env-gated: Windows PFX and Apple Developer ID plus notarization
  credentials are still to be provisioned, and then a signed build must be
  verified end to end (go-live checklist row 6). Session persistence across
  desktop restarts stays an accepted limitation, because the refresh cookie
  cannot cross the SameSite boundary. Fixing that is token-in-keychain work
  and needs its own spec.
- **Dependabot alert #13** (moderate: glib 0.18.5 `VariantStrIter`
  unsoundness, `hotel-desktop/src-tauri`). It was dismissed 2026-09-04 as
  "not used — we ship macOS + Windows". Linux bundles (deb, AppImage, rpm)
  have shipped since 2026-09-19, so that reason no longer holds. It is still
  unfixable from here: gtk 0.18 pins glib `^0.18` across Tauri 2.x. Reopen
  the alert so its state is honest, and revisit when Tauri moves to GTK 4.
- **Notifications v2, remaining:** SMS channel (separate spec), DB-editable
  transactional templates, and a PDF attached to the checkout-receipt email.
  The email is HTML-only today. The staff-side `paymentReceiptPdf.ts` is a
  separate browser export.
- **UI/UX consolidation follow-ups** (2026-09-14 pass):
  1. PARTIAL. Bookings `CheckInDialog` composes rooms'
     `ReservedCheckInDialog` (one shared form, atomic check-in payload).
     `EnhancedCheckInModal` inside `UnifiedBookingModal` stays separate: it is
     a richer workflow on the same payload.
  2. PARTIAL. `PageHeader` is adopted across admin/system pages and Guest
     Deliveries, and `EmptyState` is in `AuditLogPage`.
     `StatusPill`/`EkycStatusCard`/`RoomStatusChip` stay deliberately distinct.
     `DataTable` adoption is still wide open.
- **gRPC edge routing.** Rooms, room types, housekeeping, maintenance and
  guests have gRPC-Web clients behind per-context flags (default off). The
  production edge does not route `/hotel.*`: neither `deploy/Caddyfile`'s
  `@backend` matcher nor the site matchers generated by
  `deploy/deploy{,-staging}.sh` include it. The flags therefore stay off
  outside development. See [`architecture/grpc.md`](architecture/grpc.md).
- **Seed summary differs on the first run.** On a fresh database `seed --all`
  prints 9 housekeeping tasks; every rerun prints 11. Two tasks are created by
  `update_room_status()` with sequence ids that sit below the 800000 band until
  the post-run sequence resync. The data is equivalent, but CI's rerun check
  compares only booking counts.
- **Staging has no demo-data path.** Staging deploys install the baseline and
  bootstrap `seed.sql` only. The `seed` binary is not in the backend image,
  and the staging PostgreSQL publishes no host port.

## Decisions needed (user)

- **Drop the SQL/PGQ `hotel_graph`** (see P0). This is a baseline structure
  change plus a drop patch, and it is the prerequisite for any move off
  19beta3.

Standing policy (decisions with no other home):

- **Branch protection on master.** Ruleset `master-protection` (id 21196959)
  is `enforcement: active`. It has a `pull_request` rule and a
  `required_status_checks` rule with 17 checks. Its bypass list is
  `RepositoryRole: always`, so repository admins can still push straight to
  master while everyone else must open a PR. Verified 2026-10-05 with
  `gh api repos/siewong007/hotel-app/rules/branches/master`; check again
  before assuming either way.
- **Guest portal forgot-password and max-booking-window: won't do.** Neither
  feature is wanted, so do not re-propose them as gaps.
- **Zero-balance un-invoiced ledger rows read "Draft", not "Paid".**
  `getLedgerUiStatus` returns `'draft'` for `balance <= 0` rows whose stored
  status never reached `'paid'`, matching the backend `ui_status='draft'`
  bucket. `LedgerEntriesTab` has a matching "Draft" filter pill. Reversal rows,
  whose status is hardcoded to `'paid'`, correctly stay "Paid".
