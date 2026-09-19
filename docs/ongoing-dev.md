# Ongoing Development

Single live tracker for open work. Keep entries to one line; **delete them when done**
rather than striking them through — shipped behavior belongs in
`docs/architecture/architecture-flow.md`, and detailed plans stay in `.claude/reports/`.

Last pruned 2026-09-19: security-eval L6 CSP-vs-PayPal (connect-src now
enumerates the PayPal origins in `nginx.conf`), the FE test-desert tier (all
five named pages now carry tests), the DONE/RESOLVED UI-consolidation items,
and the stale mobile-density session note. The same pass removed every shipped
plan under `docs/superpowers/plans/` plus the orphaned `.superpowers/sdd/`
ledgers — see that README's removal record.
Prior prune 2026-09-15 (doc-sync audit): the L4 `TOTP_ENCRYPTION_KEY` action was
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
  at `postgres:19beta3`). WHEN 19 GOES GA (Beta 4 ships 2026-09-24; GA targeted
  end of Oct 2026): bump images again and
  migrate data via pg_dump/pg_restore into a FRESH volume — beta on-disk formats
  have no supported upgrade path to GA, so the restore drill is mandatory either
  way. Desktop bundles ship their own postgres binaries: bump those resources in
  the same desktop release and rely on the existing pgdata version gate to refuse
  mismatched data dirs.
- Security-eval still OPEN (decisions/design): M10 least-privilege DB role
  rollout; L14 desktop signing certs; H5 import semaphore.

## P1 — decided, not yet executed

- (none)

## P2 — later

- Phone/tablet density backlog (migrated 2026-09-15 from the deleted
  `superpowers/reports/2026-09-14-mobile-ux-report.md`; priority order
  preserved). Verified fixed since: `/help/$slug` never mounting
  (`routes/help.tsx` renders `<Outlet/>` via `useChildMatches()`) and the `xs`
  staged-changes occlusion behind `MobileNavBar`. Remaining, unverified at the
  stated widths:
  1. `/housekeeping` at 320px — "+ New task" CTA clipped (pre-existing).
  2. `GuestProfilePage` — 5 inner tables still desktop-dense.
  3. `DataTransferPage` ~50 always-expanded cards; `RBACManagementPage`
     accordions; `AuditLogPage` stream cards.
  4. Staged-changes bar still occluded on 600–899px tablets (sm–md).
- Desktop postgres lags the server: bundle is `19beta2`
  (`CONFIGURED_POSTGRES_BUILD_IDENTITY`, `hotel-desktop/src-tauri/src/postgres.rs`)
  while every server/CI/compose pin is `19beta3`. Bump with the GA move above —
  it needs re-provisioning plus a pgdata rebuild, not just a constant edit.
- Desktop packaging: updater ARMED via GitHub Releases
  ([`hotel-desktop/UPDATER.md`](../hotel-desktop/UPDATER.md);
  `TAURI_SIGNING_PRIVATE_KEY` set — an absent key now *hard-fails* bundle
  builds). OS signing wired but certs pending (Windows PFX, Apple Developer
  ID + notarization — unsigned stays default). RPM shipped
  ([eval record](../.claude/reports/rpm-eval-2026-09-19.md)); first
  all-green full-bundle E2E completed 2026-09-19
  ([run ledger](../.claude/reports/desktop-build-e2e-2026-09-19.md));
  origin/proxy parity enforced by
  `hotel-desktop/scripts/origin-parity.test.mjs`. Still open: provision
  certs + verify a signed/notarized build end-to-end; session persistence
  across restarts stays an accepted limitation (SameSite boundary — fix is
  token-in-keychain work, a separate spec).
- Dependabot alert #13 (moderate): glib 0.18.5 in hotel-desktop/src-tauri
  (unsound VariantStrIter, fixed 0.20.0). Semver-pinned by the tauri/gtk stack —
  requires a coordinated tauri/gtk major upgrade with desktop regression
  testing, not a lockfile bump.
- Notifications v2 remaining: SMS channel (separate spec), DB-editable
  transactional templates, PDF receipts.
- UI/UX consolidation follow-ups (2026-09-14 pass; DONE/RESOLVED items pruned
  2026-09-19 — git history has the full entry). Still open:
  1. PARTIAL — bookings `CheckInDialog` composes rooms' `ReservedCheckInDialog`
     (one shared form, atomic check-in payload); `EnhancedCheckInModal` inside
     UnifiedBookingModal stays separate — a richer workflow (full guest
     editing, advisory, company creation) already on the same payload;
  2. PARTIAL — PageHeader adopted across admin/system pages + Guest
     Deliveries; EmptyState in AuditLogPage; StatusPill/EkycStatusCard/
     RoomStatusChip kept deliberately distinct (different semantics).
     DataTable adoption still wide open.
- gRPC migration in flight: tonic services + Connect-ES client for rooms,
  housekeeping, maintenance, and guests shipped behind per-context runtime
  flags (REST stays default/fallback); ~350 REST paths remain —
  `docs/grpc-migration/` is the working record.

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
