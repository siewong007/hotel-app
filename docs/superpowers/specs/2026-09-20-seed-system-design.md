# Deterministic Scenario Seed System — Design

> Status: pending user review · Date: 2026-09-20

## Goal

Replace `hotel-app-be/database/postgres/staging.sql` (one 1,706-line SQL file) with a
Rust seed binary that populates the database for every realistic application scenario:
`seed`, `seed --scenario <name>`, `seed --all`, `seed --reset`,
`seed --scenario <name> --reset`, `seed --list`.

User-selected decisions: pure-Rust seeder (no `.sql` fixture files); `staging.sql` is
deleted and `make db-seed`/CI repoint to the bin; every run wipes the seed band then
applies the selection; bare `seed` = `full`; work in the current checkout, uncommitted.

## Architecture

New bin target `seed` in `hotel-app-be`, auto-discovered by cargo:

```
src/bin/seed/
  main.rs              clap CLI → env guard → connect → one transaction → summary
  args.rs              clap derive: --scenario (repeatable/comma), --all, --reset,
                       --list, --ref-date, --database-url
  guard.rs             production detection + reset gate (pure fns, unit-testable)
  registry.rs          Scenario enum, scenario→module map, --list rendering
  engine.rs            txn prelude, wipe, module dispatch, sequence resync, counts
  wipe.rs              the shared band cleanup (ported from staging.sql §05)
  sections/*.rs        one file per fixture section; each exposes
                       `pub async fn seed(tx) -> Result<SectionCounts>`
```

Fixture SQL is ported **verbatim** from `staging.sql` into `const` raw strings inside the
section modules (proven against the DB triggers/constraints) — the port is a code move,
not a rewrite. Rust computes only what SQL cannot: the bcrypt password hash stays a
constant (`HotelStaging2026!`, same as today), `sha256:` token digests are computed in
SQL (`encode(sha256(...))`, as staging already does), and the seeded 2FA secret is
produced by calling `AuthService::encrypt_stored_totp_secret` from the linked
`hotel_app_be` lib (plaintext `JBSWY3DPEHPK3PXP` when `TOTP_ENCRYPTION_KEY` is unset —
`decrypt_stored_totp_secret` accepts non-`enc1:` rows — encrypted otherwise).

## Invariants (carried over from staging.sql)

- **Id band**: all seed rows live in `800000–899999`; uuid keys use `80000000-…`;
  999xxx stays reserved for ad-hoc fixtures. Identities are `GENERATED ALWAYS`, so
  inserts use `OVERRIDING SYSTEM VALUE`; a resync pass `setval`s every touched
  sequence to `GREATEST(max(id), 800000)`.
- **Determinism**: fixed ids, no `random()`, all stay/schedule dates derive from a
  single reference date. `--ref-date YYYY-MM-DD` pins it (sets `staging.ref_date`,
  same mechanism as `PGOPTIONS` today); default is the hotel business date.
- **Rerun semantics**: every run = wipe all seed-owned rows → apply selected modules.
  Never an append. `--reset` alone = wipe only. This matches staging.sql's contract.
- **One transaction**: advisory lock `pg_advisory_xact_lock(hashtext('hotel_app_staging_seed'))`,
  `SET LOCAL app.allow_audit_mutation='on'` (required for the users→audit_logs
  `ON DELETE SET NULL` during wipe), `SET LOCAL TIME ZONE` from `system_settings.timezone`
  (mirrors `core/db.rs`), temp table `staging_ref`, and a V1-install guard on
  `hotel_schema_revisions` generation 1 — all inside the single txn.
- **Trigger-real states**: rooms reach `occupied`/`reserved`/`dirty` via booking inserts
  + `sync_room_status_with_booking`; `maintenance`/`out_of_order`/`reserved_dirty`/
  `cleaning` go through `update_room_status()` so transitions journal into
  `room_status_change_log`/`room_history`. `payment_status` is produced by real
  `payments` rows (trigger `trg_sync_booking_payment_status`), with the app-only
  states `refunded`/`unpaid_deposit` applied by explicit final UPDATEs (as today).

## Module → coverage map

Each scenario is an ordered list of section modules; sections compose because ids are
fixed and every run replays dependencies (e.g. `payments` includes the booking
sections its payment rows reference).

| Module (file) | Content (source in staging.sql) |
|---|---|
| `core` | users+roles+permissions+teams (§10); amenities, room types, rooms, rate plans, room rates (§20); guests, companies, corporate accounts/contacts, prefs/notes/docs/reviews, segments, user_guests, notification subs, consent (§30) |
| `rooms_state` | `update_room_status` calls + room_events + online_inventory_allocations (§20/388) — extended: adds `reserved_dirty` (unused today) |
| `bookings_ops` | today-ops bookings 802101–802110 + booking_guests + history + services catalog + booking_services + their payments (§40/§50 split by purpose) |
| `bookings_matrix` | remaining lifecycle statuses 802111–802132 (pending_payment, pending_confirmation, no_show, voided, completed, comp variants, auto_checked_in, long-stay, adjacent, high-value, unpaid-past, maintenance-room, aging hold) + payments + modifications + room_changes |
| `bookings_history` | 802001–802045 completed filler + payments |
| `anonymous` | **new** — anonymous guest bookings: `guests` (first_name+email, last_name NULL per `validate_anonymous_guest`), `bookings.portal_request_id` (idempotency; `uq_bookings_guest_portal_request`), `pre_checkin_token` = `sha256:` of a documented token, statuses pending_payment/confirmed/voided, multi-booking guest |
| `availability` | **new** — sold-out date (all ECO rooms booked), one-room-left, same-room disjoint windows, allocation-blocked dates; stacked on `rooms_state` allocations |
| `finance` | invoices, city ledgers + ledger payments, receipt requests, retry capabilities, app-set payment_status fixups (§50) |
| `operations` | housekeeping board + maintenance tickets (§60) |
| `night_audit` | night_audit_runs/details/posted_nights + job_runs (§60) |
| `marketing` | promotions + join tables + vouchers + redemptions + allocations + email templates/campaigns/deliveries/suppressions (§50/70) |
| `loyalty` | members/accounts/memberships/transactions/rewards/redemptions/comp credits (§80) |
| `guest_access` | portal sessions (incl. known `stg-portal-token-a`), user_guests link, **new** self_checkin_events + support conversations/messages/events (schema-supported, unseeded today) |
| `auth_extra` | **new** — 2FA-enabled user (computed secret + hashed recovery codes), expired/revoked refresh tokens; locked/inactive/unverified users stay in `core` |
| `notifications` | staff_notifications + reads (§80) |
| `audit` | audit_logs markers + ensure_audit_logs_partition (§80) |
| `webhook_fixtures` | **new** — `pending`/`processing` payments with `payment_gateway='paypal'` and deterministic `gateway_payment_intent_id`/`transaction_id` (`STG-PAYPAL-ORDER-*`) so `apply_paypal_webhook_event` has replay targets; duplicate-delivery idempotency is exercised by the existing payment `idempotency_key`s |

## Scenario registry

```
basic             core, rooms_state, bookings_ops
availability      core, rooms_state, availability
booking-lifecycle core, rooms_state, bookings_ops, bookings_matrix, anonymous
frontdesk         core, rooms_state, bookings_ops, operations
payments          core, rooms_state, bookings_ops, bookings_matrix, finance, webhook_fixtures
webhooks          core, rooms_state, bookings_ops, webhook_fixtures
authentication    core, auth_extra, guest_access
audit             core, rooms_state, bookings_ops, bookings_matrix, finance, night_audit, audit
notifications     core, notifications, marketing
edge-cases        core, rooms_state, bookings_ops, bookings_matrix, anonymous, availability
operations        core, rooms_state, bookings_ops, operations, night_audit
marketing         core, marketing
loyalty           core, rooms_state, bookings_ops, bookings_matrix, finance, loyalty
guest-access      core, anonymous, guest_access
full              every module in canonical order (bare `seed` and `--all` ≡ full)
```

`--scenario` accepts repeats and comma lists; modules are deduped and executed in
canonical order regardless of flag order.

## Reset safety

- Any run refuses when `APP_ENV`/`ENVIRONMENT` resolves to `production`/`prod`
  (APP_ENV wins, matching config precedence).
- `--reset` additionally requires an explicit dev signal: env resolves to
  `development|dev|local|test|staging`, **or** `DATABASE_URL` host is loopback
  (localhost/127.0.0.1/::1/unix socket). Docker service hosts (`db`, `postgres`) are
  allowed only when env is explicitly non-production. No override flag exists.
- Reset scope: seed-owned rows only (band + marker-tagged `job_runs` + email
  suppressions by domain). Bootstrap data, schema, and non-seed rows are untouched.
  Schema reset stays `make db-reset`'s job.

## Repo touch-points

- `Makefile`: `db-seed` → `cargo run --manifest-path hotel-app-be/Cargo.toml --bin seed -- --all`
  (add `db-seed-scenario` convenience? no — document `cargo run --bin seed` directly).
- `tests/postgres_patch_catalog.rs`: update the pinned `db-seed` Makefile line.
- `.github/workflows/ci.yml` staging job: `psql staging.sql` ×2 → `cargo run --bin seed -- --all` ×2
  (same count assertion).
- Docs: `hotel-app-be/database/README.md` (staging section → seed system, scenarios,
  reset, credentials, ref-date), `docs/development.md`, `docs/guides/staging-environment.md`,
  `README.md` (pointer only), `docs/features.md:83`, `CLAUDE.md` db-seed line,
  `.claude/rules/00-diagnosis.md:14`, `AGENTS.md` if it names staging.sql.
- `staging.sql` deleted.

## New fixtures beyond staging.sql

`reserved_dirty` room; anonymous bookings (+`portal_request_id`, `pre_checkin_token`,
multi-booking anon guest); `processing` + `void` payment rows; PayPal webhook replay
fixtures; 2FA-enabled user + token rows; self_checkin_events for B-STG-1030; support
conversations (all four statuses); edge bookings: same-day-adjacent, one-night,
sold-out-date, cancelled-frees-inventory pair.

## Explicitly unsupported (will be reported, not faked)

- Webhook/outbox/event persistence — no such tables; webhooks reconcile in place, SSE
  is transient broadcast (`realtime/hub.rs`). Only replay *fixtures* are seeded.
- `cancelled`/`expired` booking statuses — the model uses `voided` (and the unpaid-hold
  scheduler handles expiry); `blocked` room status — model uses `online_inventory_allocations`.
- Multi-room single reservation — `bookings.room_id` is scalar.
- Passkeys (WebAuthn credentials can't be fabricated meaningfully) and eKYC evidence
  rows (sensitive identity data — seeding would normalize fake verification records).
- `two_factor_challenges` rows (ephemeral setup challenges, pointless to seed).

## Testing

- `tests/seed_registry.rs` (no DB): scenario list, dependency resolution order/dedup,
  guard matrix (env combos × reset flag).
- `tests/seed_apply.rs` (`DATABASE_URL`-gated, `env!("CARGO_BIN_EXE_seed")`): apply on
  baseline DB → rerun identical counts → `--reset` empties band → `--list` exit 0.
- Existing gates: `cargo check/clippy/test --all-features` (CI-verbatim), markdown link
  check, `make db-mirror-check` (seeds dir isn't mirrored — no change needed there
  since we ship no .sql files).
