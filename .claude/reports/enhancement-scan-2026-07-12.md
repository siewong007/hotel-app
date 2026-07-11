# Enhancement Direction Scan — 2026-07-12

Method: 13-agent workflow (6 dimension scanners + 1 backlog re-verifier, each
scanner's findings adversarially re-derived by a fresh verifier agent). Every
finding below was CONFIRMED by independent re-derivation unless marked
otherwise. Line anchors verified 2026-07-12 — they rot; re-grep before use.
Supersedes nothing; extends `.claude/refs/enhancement-backlog.md` (2026-07-07),
whose items are ALL still open (see §5).

## 1. Urgent — stop the bleeding (all Small effort)

1. **Master CI has been red for ~16 consecutive pushes since 2026-06-25.**
   Root cause is constant the whole time: `checkin_booking_flow_for_booking`
   (hotel-app-be/src/services/bookings.rs:262, added 2026-06-25) now requires an
   IC/passport number, but ~10 fixtures in `hotel-app-be/tests/booking_service.rs`
   (both sqlite_tests and postgres_tests modules) never supply one. Verified via
   `gh run list --workflow=ci.yml --branch master --limit 25`: last green run
   2026-06-24. Every dual-DB/schema-smoke guardrail built into CI has been
   advisory noise for 17+ days. Fix: update fixtures (+ add one negative test
   for missing document), get master green.
2. **No branch protection on master.** `gh api .../branches/master/protection`
   → 404. PR #47's merge commit itself failed CI. After master is green, require
   the frontend/backend/backend-sqlite/backend-postgres-smoke checks.
3. **Payments endpoints have login-only auth — no RBAC check at all.** Every
   handler in `routes/payments.rs` (13 handlers incl. create/record/refund/
   revert/update/delete payment, generate_invoice) calls only `require_auth`,
   never `check_permission`, despite `payments:create/read/update/delete/manage`
   existing in seed data. Any authenticated user (e.g. housekeeping-only role)
   can create/delete payments and issue refunds. Mirror `routes/ledgers.rs`
   pattern.
4. **ammonia (the app-wide sanitizer) has a known mXSS bypass** —
   RUSTSEC-2026-0193, fixed in >=4.1.3; currently 4.1.2. One-line bump in
   hotel-app-be/Cargo.toml.
5. **desktop-build.yml has ZERO runs ever** (`gh run list` empty; the only git
   tag v0.1.0 predates the workflow). Commit 8be481d8's message claims it
   "completed" — it is wired but unproven. Trigger one workflow_dispatch run.

## 2. Money/auth trust track (P0/P1, Medium efforts)

- **No audit-trail on any payment or customer-ledger mutation.**
  services/payments.rs and services/ledgers.rs never call
  `AuditLog::log_event`; every other mutating service does. Combined with §1.3,
  money can move with zero forensic trail.
- **Zero tests on every money/auth-critical module.** Backend: no `#[test]` in
  repositories/ledger.rs (2335 ln), payment.rs (1100 ln), invoice_numbers.rs,
  rbac.rs (913 ln), auth.rs, nor their services; none of 24 handler files
  tested; no test constructs the router (auth/route wiring untested end to
  end). Frontend: 14 test files / 379 source files; 0 tests in bookings/,
  customer-ledger/, invoices/, auth/, rbac/ features. Start: invoice-number
  generation + ledger posting/void math (pure logic), then a create_router()
  oneshot test per domain, then unit tests on useBookingsPageState.ts /
  useCheckoutInvoiceModalState.ts (already-extracted hooks — testable without
  mounting the 2,696-line page).
- **Swallowed sqlx error inside a live Postgres transaction** at
  services/rooms.rs:216 (`let _ = sqlx::query(INSERT_ROOM_EVENT)` on `&mut **tx`
  in `complete_housekeeping_cleaning_tx`) — the exact 2026-07-10b incident
  class. Verifier confirmed the other 9 `let _ = sqlx::query` sites bind to
  `&pool` (safe-ish). Propagate or SAVEPOINT this one.
- **No schema-drift check between database/schema.sql and sqlite_migrations/**
  — the bug class that shipped 3 times. Protection today is incidental (tests
  replay sqlite migrations; smoke reapplies schema.sql) but nothing diffs the
  two DDLs. Add a script diffing table/column sets per table; wire into CI.
- **Sanitizer + rate-limit gaps (smaller):** ledger free-text fields
  (company_name, notes, billing_address…) bypass Sanitizer (services/ledgers.rs);
  guest-portal token-gated endpoints (get_booking, submit_precheckin,
  auto_checkin in routes/guest_portal.rs) have no rate limiter while their
  siblings do; `companies:*` permission doesn't exist at all (routes/companies.rs
  is login-only); GET /api/rbac/route-policies is require_auth-only; desktop
  `backup_database` IPC accepts an arbitrary webview-supplied path (currently
  uncalled from FE).

## 3. Product-direction candidates (business decisions — pick, don't drift)

Verified absent (greps in workflow transcript), in rough value order for a
small-hotel PMS:
1. **Outbound guest communications** — zero email/SMS capability anywhere
   (no lettre/SMTP/sendgrid/twilio in Cargo.toml or src). No booking
   confirmation, pre-arrival reminder, or receipt. Likely the single biggest
   product gap.
2. **Guest-portal online payment** — portal does pre-check-in/self-check-in,
   but all payment paths require staff auth; a guest cannot pay a deposit or
   settle a balance. Related: there is no real payment gateway anywhere —
   staff record already-completed payments (legit front-desk workflow; design
   the two together if pursued).
3. **OTA sync** — booking_channels is commission/source tagging only; no iCal
   import/export, no OTA API. Minimal viable: iCal feed per room type.
4. **Group/block bookings** — no schema linkage (no group_id/parent_booking_id
   in either DDL) and no consolidated invoice. CORRECTION from verification:
   FE UnifiedBookingModal.tsx DOES have a multi-room flow (RoomPickerSection,
   `createBookingsForSelectedRooms` lines 565-598) but it creates N independent
   bookings — the gap is linkage + one invoice, not the picking UI.
5. i18n — greenfield decision; ~708 hardcoded strings; only if target market
   needs it.
   (CORRECTION 2026-07-12: the OTA monthly statement report from the 2026-07-09
   plan SHIPPED — report_type dispatch at repositories/analytics.rs:827,
   channel_net_revenue.rs:1123, ModernReportsPage.tsx, and the ota_reference
   column via sqlite_migrations/016 + schema.sql:5990. The plan doc was deleted
   2026-07-12 as executed; do not treat it as open work.)

## 4. Debt-reduction track (schedule, don't interleave with features)

- **Execute or explicitly shelve the SQLite removal** —
  `.claude/reports/plan-remove-sqlite-2026-07-08.md` is a complete plan and the
  dual-DB tax keeps compounding: services/rooms.rs grew 83→92 raw sqlx::query
  calls (2445 ln, 3 sql_query! uses); lifecycle.rs is 4259 ln with ~78
  hand-duplicated cfg-gated query pairs and 1 sql_query! call. Killing sqlite
  deletes this entire risk class; keeping it means migrating both files to
  sql_query!. Either is better than the status quo.
- 61 runtime `SELECT *` remain (verifier: most decode via named-column
  row_mappers, blunting the guests.is_active failure mode — payment.rs and
  loyalty.rs first, rest is lower priority than the backlog assumed).
- FE: `AuthContext.tsx:3` imports the api barrel → all 19 service modules load
  in the root bundle despite 33 lazyRoute() entries. Import auth.service.ts
  directly; migrate 41 HotelAPIService call sites mechanically.
- FE `any` burn-down: 463 sites; dataTransfer.types.ts (51) still worst and
  types full-DB backup/restore payloads as `any[]` — type against real row
  shapes before any strict-mode push; then flip noImplicitAny alone.
- CI hardening: lint uses `--quiet` (lint:strict exists, unused anywhere);
  vitest coverage config is dead (no --coverage in CI, no thresholds); no
  cargo-audit/bun-audit/dependabot anywhere; version split 0.1.0 (be/fe) vs
  1.0.0 (desktop×3) with no sync check.

## 5. Backlog re-verification (2026-07-07 backlog → today)

ALL items STILL_OPEN: B1 auth/invoice tests (no test files); B2 N+1 eKYC
(anchor moved 892→905/1178/1606, pattern unchanged in auto_checkin.rs:71-80);
B3 rooms.rs audit (worse: 83→92); B4 CI lint/coverage; B5 SELECT * (61 hits;
lifecycle anchors now 1421/1988/3873/4204); B6 page characterization tests;
B7 any burn-down (420–463 by counting method; dataTransfer still #1); B8
desktop session persistence (no keychain/stronghold code); B9 desktop-build
unproven / sqlite decision pending / updater pubkey still placeholder / 16MB+
sidecar blobs still in git history (multiple: 16.4MB, 16.0MB darwin + 14.6MB
windows).

## 6. Docs/refs drift (one cleanup batch; agents actively misled today)

- **`.claude/refs/booking-workflow.md` + `ledger-workflow.md` describe a dead
  architecture** — logic they place in handlers/bookings.rs (264 ln now) and
  handlers/ledgers.rs (129 ln) lives in repositories/bookings/lifecycle.rs
  (create:1183, update:1615, auto_post_company_ledger:687) and
  repositories/ledger.rs; note services/bookings.rs also holds real logic
  (void_booking:51, manual_checkin:153) while services/ledgers.rs is pure
  passthrough. `.claude/rules/00-diagnosis.md:18` repeats the stale
  bookings.rs:537 anchor (rules edits = factual fix, allowed).
- deployment.md:462-468 claims docker-compose has a "configurable backup
  schedule" — no backup service exists in any compose file (false claim for
  operators). GET /health is a hardcoded 200 with no DB check (routes/
  mod.rs:66-68) while README documents it as the startup verification.
- ADR 004 claims "No token revocation" — refresh_tokens has
  is_revoked/revoked_at/revoked_by + 6 revocation call sites in services/auth.rs.
- hotel-app-be/.env.example documents Redis/Nginx/Prometheus/Grafana/REACT_APP_*
  none of which exist anywhere; hotel-app-be/README.md still ships the
  nonexistent mcp-server/ quick-start; root README tree lists
  database/migrations/ + seed-data/ (don't exist); `make fmt`/`make clean` are
  .PHONY no-ops; root .env.example missing SETTINGS_CACHE_TTL_SECS; no log
  rotation for daily backend-*.log files.

## 7. Refuted / corrected during verification (do not re-flag)

- REFUTED: "GET /api/search bypasses per-resource read permissions" —
  services/search.rs:38-71 gates every category via can_read → check_permission
  (bookings:read/guests:read/ledgers:read/rooms:read). Route layer is
  require_auth-only but the service layer filters correctly.
- CORRECTED: the "83 raw calls" baseline citation is enhancement-backlog.md:30,
  not CLAUDE.md; other `let _ = sqlx::query` sites are pool-bound, only
  rooms.rs:216 is tx-bound; FE multi-room booking UI exists (see §3.4).
- CONFIRMED-clean spot checks: no raw fetch() in FE, no hardcoded secrets found,
  JWT_SECRET min-length enforced, login IS rate-limited, rbac_cache has proper
  TTL+invalidation (single-instance only — documented limitation).
