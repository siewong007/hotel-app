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
- ~~2FA is fully broken (found 2026-07-26 by `tests/rbac_profile.rs`): `two_factor_challenges` has no CREATE TABLE anywhere (every `/profile/2fa/setup` 500s), and `core/auth.rs` `enable_2fa`/`update_recovery_codes` bind a JSON string against `users.two_factor_recovery_codes text[]`~~ — DONE 2026-07-26: table+patch shipped (commit 94def0549), and the follow-up write-only-table gap is closed the same day: challenges are stored SHA-256-hashed, `/profile/2fa/enable` now requires and atomically consumes an unexpired `challenge_code` (TOTP checked first so a typo never burns it); FE sends it from the setup response. Adversarial review also caught a lockout bug fixed in the same pass: setup displayed backup codes that enable then replaced — codes now exist only in the enable response and the FE shows them in a post-enable dialog. Scenario 9 covers hashed-at-rest, stale/expired/wrong-code rejection, and single-use consumption. VPS + existing desktop DBs still need `patches/2026-07-26-two-factor-challenges.sql` by hand (2026-07-26j pattern).
- ~~Rate plans cannot be created at all: `repositories/rate.rs` `create_rate_plan` binds `Option<Vec<String>>` against a `jsonb` column — every INSERT fails~~ — DONE 2026-07-26: bind wrapped in `sqlx::types::Json` (None → SQL NULL); `tests/guests_rates_loyalty.rs` now calls the real service (Some-path jsonb round-trip + None-path NULL asserted), 9/9 green 2x live + clippy `--all-features --all-targets` clean.
- Room-type prices decode as 0: `repositories/rate.rs:502` private `row_to_room_type` shadows the real `models::row_mappers` mapper; `numeric` decode fails and is swallowed to 0/None — confirmed live, DB 50.00 → returned 0 (chip spawned).

## P1 — decided, not yet executed

- ~~Company-ledger statement void filter is a no-op: `repositories/analytics.rs` (~2241, ~2321) filters `status NOT IN ('voided')` but the legal value is `'void'`~~ — DONE 2026-07-26: both literals fixed to `'void'` (a src/-wide sweep found no other `customer_ledgers` `'voided'` literals; remaining ones target `bookings`, where it's valid); `tests/audit_analytics_settings.rs` now seeds a `status='void'` row and asserts exclusion from both statement shapes — verified failing against the old literal, then 2x green + clippy `--all-features --all-targets` clean.
- ~~Manual room-status updates skip validation: `services/rooms.rs::update_room_status_handler` never calls `validate_room_status_transition()` and doesn't auto-create a cleaning task when flipping to `dirty` (unlike the booking-trigger path)~~ — DONE 2026-07-26: handler now runs the same `validate_room_status_transition()` SQL function on the final target (undefined/disallowed → 400) and auto-creates a deduped pending cleaning task on `dirty`/`reserved_dirty`; two matrix rows the handler's own auto-flips need (`occupied→reserved_dirty`, `reserved_dirty→available`) added to the baseline auto-seed (+ desktop mirror) with idempotent patch `2026-07-26-room-status-transition-rows.sql` (applied to dev DB; VPS/desktop DBs need it by hand). Verified: fresh-vs-patched scratch 19beta2 dump-diff EMPTY, `tests/rooms_housekeeping.rs` 6/6 green 2x live, clippy `--all-features --all-targets` clean.
- ~~FE `guests.service.ts:81` double-wraps 401s~~ — DONE 2026-07-26: `toGuestApiError` now passes `APIError` instances through, so the 401/session-expired error reaches callers with its statusCode; test updated to assert 401 (typecheck/lint/28 tests green).
- Business-day math via `Utc::now().date_naive()` (same class as the fixed `chrono::Local` sites, found by the 2026-07-26 review): `modules/loyalty/service.rs:641` (reward valid_from/valid_to — off by one day 00:00–08:00 local at UTC+8), `repositories/channel_net_revenue.rs:960`, `repositories/payment.rs:1033` (response-only), `modules/guest_booking/repository.rs:53,56` — thread `hotel_today` in the same way.

## P2 — later

- `any`-type burn-down: 337 grep sites as of 2026-07-27 (`grep -rn ": any\|as any" src --include="*.ts*"`), of which 43 in generated `routeTree.gen.ts` and 109 in test files → 185 hand-written non-test sites. Top-10 offender pages + `dataTransfer.types.ts` cleaned 2026-07-26; dead `useBookingsPageState`/`useCheckoutInvoiceModalState` hooks + tests deleted same day. Worst remaining: `RoomEventDialog.tsx`/`RoomConfigurationPage.tsx` (10 each), `LoyaltyDashboard.tsx` (9).
- Desktop: Windows/Linux CI packaging; upgrade embedded PostgreSQL 18.4 → 19 in `src-tauri/pgsql/` (ask-first dir; requires a source build — Homebrew ships no PG19); network-fetch pgsql provisioning (today Homebrew-local only); arm or hide the updater (`hotel-desktop/UPDATER.md`); consolidate hand-maintained origin/proxy lists; desktop session persistence (SameSite boundary).
- Desktop robustness: `postgres.rs` hardcodes port 5433 and treats ANY listener there as its own instance — a foreign postgres (e.g. a docker container publishing 5433) yields a confusing "password authentication failed" instead of a clear port-conflict error (found 2026-07-26 testing the CI artifact locally); probe the data-dir/pidfile or verify server identity before adopting a running server.
- Portal test coverage: portal page component tests + broader portal integration tests (the concurrent double-booking race is covered — `tests/booking_service.rs::postgres_guest_portal_race_tests`).

## Decisions needed (user)

- Voided bookings leave their receivable open: `services/bookings.rs::void_booking` never touches the auto-posted company/city-ledger row — it stays `pending` with `void_at` NULL. Cascade the void to the ledger row, or keep manual reconciliation? (money-policy; `tests/ledger_service.rs` documents current behavior).
- Dead-code cleanup batch: DONE 2026-07-27 for the backend — every `#[allow(dead_code)]`/`#[allow(unused_imports)]` in `hotel-app-be/src` was removed and the code it hid deleted (~2.6k lines, incl. the whole legacy `routes|handlers|services|repositories|models::loyalty`+`models::rewards` stack, `utils/validation.rs`, `repositories/room.rs`, the `sql_compat`/`core::db` SQLite-era shims, and `AuthService::generate_jwt`). Remaining suppressions are narrow and documented (test-only items + `promotion_pricing`, which `tests/promotion_pricing.rs` covers but no production path calls). Still open, and deliberately NOT auto-decided:
  - `GuestUpdateInput.is_active` — accepted by the API, never persisted (silent no-op, not dead code; removing it changes the request contract).
  - Unreachable `'draft'` branch in FE `CustomerLedger/helpers.ts::getLedgerUiStatus:81` — line 76 returns `'paid'` for any non-positive balance, so line 80 always fires first. Whether a zero-balance un-invoiced ledger *should* read "Draft" instead of "Paid" is a product call.
- Branch protection on master: no rule exists (verified via `gh api` 2026-07-26); pick required checks / review count / admin bypass, or delegate with the policy stated.
- PayPal refunds/disputes: `PAYMENT.CAPTURE.REFUNDED` webhooks are signature-verified and audit-logged but never auto-applied — auto-apply vs manual reconciliation is a money-policy call.
- PayPal conflict banner visibility: the Payment Approvals banner needs `audit:read`, which the `manager` role (the payment approvers) lacks — grant managers `audit:read`, or add a narrower conflicts endpoint.
- Notifications v2: v1 shipped (SMTP via lettre, env-var secrets, booking-confirmation trigger, campaigns, guest preferences). Still open: SMS channel?, checkout-receipt trigger, pre-arrival reminders.
- Guest portal: forgot-password flow for self-registered guests?; max advance-booking window.

## Housekeeping

- 2026-07-17: both dirty worktrees resolved and removed — angry-ellis was superseded by master (user_id audit threading landed 2026-07-12); unruffled-hellman's refs rewrite + lesson were salvaged onto master. Patches in `.claude/backups/*.patch`.
- 2026-07-26: characterization tests for `BookingsPage.tsx` and `CustomerLedgerPage.tsx` landed (28 tests: `src/features/bookings/components/Bookings/BookingsPage.test.tsx`, `src/features/admin/components/CustomerLedger/CustomerLedgerPage.test.tsx`) — pin rendering/filter-sort-pagination params/modal opens/permission gating ahead of any refactor.
- `pg18_4_to_v1.sql` is intentionally kept — wired into tests, Makefile, and desktop recovery messaging; docs no longer describe it as a workflow.
