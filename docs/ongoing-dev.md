# Ongoing Development

Single live tracker for open work. Replaces the deleted enhancement docs
(2026-07-17). Keep entries one line; delete when done; detailed plans stay in
`.claude/reports/`.

## P0 — broken or security-relevant

- Master CI red: `checkin_booking_flow` fixture missing IC/passport number (10+ test files).
- PII in git history: 3 eKYC ID-document JPGs under `uploads/` (needs `git filter-repo`; user call).
- CI lint breaker: `OnlineInventoryPage.tsx:22` banned `toISOString().slice` → use `formatLocalDate()`.
- `guest_portal.rs`: 5 literal `$1` sites need `param!`/`sql_query!` (dual-DB break).
- Guest-portal mutations missing audit logging (`verify_guest_booking`, `submit_precheckin_update`, `auto_checkin`).
- Payments endpoints: 13 handlers login-only, no `check_permission` (RBAC gap).
- Bump `ammonia` ≥ 4.1.3 (RUSTSEC-2026-0193 mXSS bypass).
- Portal token hygiene: invalidate pre-checkin tokens after submit; add portal logout/revoke; rate-limit `/guest_portal/me/*`; move pre-checkin tokens to 256-bit `generate_session_token`.
- Promotion list leaks staff user IDs (`created_by`/`updated_by` in `PROMOTION_COLUMNS`).

## P1 — decided, not yet executed

- SQLite removal (decided 2026-07-08) — plan: `.claude/reports/plan-remove-sqlite-2026-07-08.md`.
- Guest email notifications v1 — plan: `.claude/reports/guest-notifications-plan-2026-07-12.md`; blocked on decisions below.
- N+1 on `GET /bookings`: batch the per-booking eKYC summary query.
- Unit tests: auth session flow (login/JWT/refresh-cookie/logout) + invoice-number generation.
- `services/rooms.rs`: ~90 inline `sqlx::query` calls unaudited for dual-DB divergence.
- Eliminate runtime `SELECT *` (61 hits across repos).
- CI hardening: branch protection on master, `lint:strict`, vitest coverage threshold, dependency audit; prove `desktop-build.yml` with a `workflow_dispatch` run.
- Delete dead duplicate `src/routes/ekyc.rs` (never merged).
- Booking validation uses UTC; should use `system_settings.timezone` for local-day math.

## P2 — later

- Characterization tests for `BookingsPage.tsx` (~2.6k ln) and `CustomerLedgerPage.tsx` (~2.3k ln).
- `any`-type burn-down (463 sites; worst `dataTransfer.types.ts`).
- WebSocket: log lagged-event drops; FE reconnect backoff/jitter; honor Retry-After.
- Desktop: Windows/Linux CI packaging; upgrade embedded PostgreSQL 18.4 → 19 (src-tauri/pgsql/ bundle); automate `pgsql/` provisioning (fetch script); scheduled backups + retention; arm or hide the updater (`hotel-desktop/UPDATER.md`); consolidate hand-maintained origin/proxy lists; desktop session persistence (SameSite boundary).
- Portal test coverage: concurrent-booking race, integration tests, portal page components.

## Decisions needed (user)

- Notifications: email-only vs email+SMS; API provider (Resend/Postmark) vs SMTP; checkout-receipt trigger; reminders in v1?; provider-secret storage (env vs masked `system_settings`).
- Guest portal: forgot-password flow for self-registered guests?; max advance-booking window.

## Housekeeping

- 2026-07-17: both dirty worktrees resolved and removed — angry-ellis was superseded by master (user_id audit threading landed 2026-07-12); unruffled-hellman's refs rewrite + lesson were salvaged onto master. Patches in `.claude/backups/*.patch`.
- `pg18_4_to_v1.sql` is intentionally kept — wired into tests, Makefile, and desktop recovery messaging; docs no longer describe it as a workflow.
