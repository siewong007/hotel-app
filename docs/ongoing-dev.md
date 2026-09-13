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

- FE test deserts (2026-08-25 update): loyalty and user settings suites are
  covered. Still open: dashboard 0/12, audit-log 0/3, customer-ledger 0/3,
  data-transfer 0/3, night-audit 0/3, onlineInventory 0/6 (several are
  placeholder barrels — real code lives under api/ and admin/); thin: rooms
  2/54, admin 7/53; remaining SettingsPage cards (hotel info, times, charges,
  support workflow, security, appearance) not yet split into sibling components.
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

## Decisions needed (user)

- Voided bookings leave their receivable open: `services/bookings.rs::void_booking`
  never touches the auto-posted company/city-ledger row — it stays `pending`
  with `void_at` NULL. Cascade the void to the ledger row, or keep manual
  reconciliation? (Money policy; `tests/ledger_service.rs` documents current
  behavior.)
- `GuestUpdateInput.is_active` is accepted by the API but never persisted — a
  silent no-op. Removing it changes the request contract.
- FE `CustomerLedger/helpers.ts::getLedgerUiStatus:81` has an unreachable
  `'draft'` branch: line 76 returns `'paid'` for any non-positive balance.
  Whether a zero-balance un-invoiced ledger should read "Draft" instead of
  "Paid" is a product call.
- Branch protection on master: no rule exists (verified via `gh api`
  2026-07-26). Pick required checks, review count, and admin bypass — or
  delegate with the policy stated.
- PayPal refunds/disputes: `PAYMENT.CAPTURE.REFUNDED` webhooks are
  signature-verified and audit-logged but never auto-applied. Auto-apply vs
  manual reconciliation is a money-policy call.
- PayPal conflict banner visibility: the Payment Approvals banner needs
  `audit:read`, which the `manager` role (the payment approvers) lacks. Grant
  managers `audit:read`, or add a narrower conflicts endpoint.
- Guest portal: forgot-password flow for self-registered guests, and the
  maximum advance-booking window.
