# Ongoing Development

Single live tracker for open work. Replaces the deleted enhancement docs
(2026-07-17). Keep entries one line; delete when done; detailed plans stay in
`.claude/reports/`.

2026-07-26 sweep: every P0 except the PII history rewrite, and all but the two
P1 lines below, were verified done (13-agent evidence pass + adversarial
review) — the shipped behavior is documented in
`docs/architecture/architecture-flow.md`. What remains here is the true
leftover set.

## P0 — broken or security-relevant

- PII in git history: 3 eKYC ID-document JPGs under `uploads/` (needs `git filter-repo`; user call — destructive history rewrite).

## P1 — decided, not yet executed

- Business-day math via `Utc::now().date_naive()` (same class as the fixed `chrono::Local` sites, found by the 2026-07-26 review): `modules/loyalty/service.rs:641` (reward valid_from/valid_to — off by one day 00:00–08:00 local at UTC+8), `repositories/channel_net_revenue.rs:960`, `repositories/payment.rs:1033` (response-only), `modules/guest_booking/repository.rs:53,56` — thread `hotel_today` in the same way.

## P2 — later

- Characterization tests for `BookingsPage.tsx` (~2.6k ln) and `CustomerLedgerPage.tsx` (~2.3k ln).
- `any`-type burn-down (463 sites; worst `dataTransfer.types.ts`).
- Desktop: Windows/Linux CI packaging; upgrade embedded PostgreSQL 18.4 → 19 in `src-tauri/pgsql/` (ask-first dir; requires a source build — Homebrew ships no PG19); network-fetch pgsql provisioning (today Homebrew-local only); arm or hide the updater (`hotel-desktop/UPDATER.md`); consolidate hand-maintained origin/proxy lists; desktop session persistence (SameSite boundary).
- Portal test coverage: portal page component tests + broader portal integration tests (the concurrent double-booking race is covered — `tests/booking_service.rs::postgres_guest_portal_race_tests`).

## Decisions needed (user)

- Branch protection on master: no rule exists (verified via `gh api` 2026-07-26); pick required checks / review count / admin bypass, or delegate with the policy stated.
- PayPal refunds/disputes: `PAYMENT.CAPTURE.REFUNDED` webhooks are signature-verified and audit-logged but never auto-applied — auto-apply vs manual reconciliation is a money-policy call.
- PayPal conflict banner visibility: the Payment Approvals banner needs `audit:read`, which the `manager` role (the payment approvers) lacks — grant managers `audit:read`, or add a narrower conflicts endpoint.
- Notifications v2: v1 shipped (SMTP via lettre, env-var secrets, booking-confirmation trigger, campaigns, guest preferences). Still open: SMS channel?, checkout-receipt trigger, pre-arrival reminders.
- Guest portal: forgot-password flow for self-registered guests?; max advance-booking window.

## Housekeeping

- 2026-07-17: both dirty worktrees resolved and removed — angry-ellis was superseded by master (user_id audit threading landed 2026-07-12); unruffled-hellman's refs rewrite + lesson were salvaged onto master. Patches in `.claude/backups/*.patch`.
- `pg18_4_to_v1.sql` is intentionally kept — wired into tests, Makefile, and desktop recovery messaging; docs no longer describe it as a workflow.
