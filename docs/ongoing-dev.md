# Ongoing Development

Single live tracker for open work. Keep entries to one line; **delete them when done**
rather than striking them through — shipped behavior belongs in
`docs/architecture/architecture-flow.md`, and detailed plans stay in `.claude/reports/`.

Last pruned 2026-08-02: completed P0/P1 items (2FA, rate-plan creation, room-type price
decoding, ledger void filter, room-status validation, guest 401 wrapping) were verified
fixed in the tree and removed.

## P0 — broken or security-relevant

- PII in git history: 3 eKYC ID-document JPGs under `hotel-app-be/uploads/ekyc/`, added in `be37c5394` and still present in the working tree. Needs `git filter-repo`; user call, because it is a destructive history rewrite.

## P1 — decided, not yet executed

- Business-day math still using `Utc::now().date_naive()` instead of `hotel_today`: `modules/loyalty/service.rs:641` (reward valid_from/valid_to — off by one day 00:00–08:00 local at UTC+8), `repositories/channel_net_revenue.rs:960`, `repositories/payment.rs:1033` (response-only), `modules/guest_booking/repository.rs:53,56`.

## P2 — later

- `any`-type burn-down: 337 grep sites as of 2026-07-27 (`grep -rn ": any\|as any" src --include="*.ts*"`), of which 43 are in generated `routeTree.gen.ts` and 109 in tests → 185 hand-written non-test sites. Worst remaining: `RoomEventDialog.tsx` / `RoomConfigurationPage.tsx` (10 each), `LoyaltyDashboard.tsx` (9).
- Desktop packaging: Windows/Linux CI jobs; network-fetch pgsql provisioning (today Homebrew/source-local only); arm or hide the updater (`hotel-desktop/UPDATER.md`); consolidate hand-maintained origin/proxy lists; desktop session persistence across restarts (SameSite boundary).
- Desktop robustness: `postgres.rs` hardcodes port 5433 and treats any listener there as its own instance — a foreign postgres yields "password authentication failed" instead of a clear port-conflict error. Probe the data-dir/pidfile or verify server identity before adopting a running server.
- Portal test coverage: portal page component tests and broader portal integration tests. (The concurrent double-booking race is already covered by `tests/booking_service.rs::postgres_guest_portal_race_tests`.)
- Documentation: no OpenAPI schema — the endpoint table in `README.md` is hand-maintained and drifts.

## Decisions needed (user)

- Voided bookings leave their receivable open: `services/bookings.rs::void_booking` never touches the auto-posted company/city-ledger row — it stays `pending` with `void_at` NULL. Cascade the void to the ledger row, or keep manual reconciliation? (Money policy; `tests/ledger_service.rs` documents current behavior.)
- `GuestUpdateInput.is_active` is accepted by the API but never persisted — a silent no-op. Removing it changes the request contract.
- FE `CustomerLedger/helpers.ts::getLedgerUiStatus:81` has an unreachable `'draft'` branch: line 76 returns `'paid'` for any non-positive balance. Whether a zero-balance un-invoiced ledger should read "Draft" instead of "Paid" is a product call.
- Branch protection on master: no rule exists (verified via `gh api` 2026-07-26). Pick required checks, review count, and admin bypass — or delegate with the policy stated.
- PayPal refunds/disputes: `PAYMENT.CAPTURE.REFUNDED` webhooks are signature-verified and audit-logged but never auto-applied. Auto-apply vs manual reconciliation is a money-policy call.
- PayPal conflict banner visibility: the Payment Approvals banner needs `audit:read`, which the `manager` role (the payment approvers) lacks. Grant managers `audit:read`, or add a narrower conflicts endpoint.
- Notifications v2: v1 shipped (SMTP via lettre, env-var secrets, booking-confirmation trigger, campaigns, guest preferences). Still open: SMS channel, checkout-receipt trigger, pre-arrival reminders.
- Guest portal: forgot-password flow for self-registered guests, and the maximum advance-booking window.
