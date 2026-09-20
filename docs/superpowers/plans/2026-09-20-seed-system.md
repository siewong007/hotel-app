# Seed System Implementation Plan

> Implements `docs/superpowers/specs/2026-09-20-seed-system-design.md`. Uncommitted per user instruction.

## Tasks

1. **Test DB**: create `hotel_seed_dev` on the `hotel-db` container; `make db-baseline` against it (baseline + seed.sql + patches).
2. **Bin skeleton**: `src/bin/seed/{main,args,guard,registry,engine,wipe}.rs` + `sections/mod.rs`. CLI parses, `--list` prints, connects, runs prelude+wipe+resync in one txn against baseline (no sections yet), prints summary. `cargo check`.
3. **Core port**: `sections/core.rs` (users/rbac/teams), `rooms_state` (amenities/types/rooms/statuses/allocations/rates), `guests_crm` (guests/companies/corporate/segments/CRM rows) — staging.sql §10/20/30 verbatim port. Verify `seed --scenario basic`-shape runs.
4. **Booking sections**: `bookings_ops`, `bookings_matrix`, `bookings_history`, each carrying its own payments; `anonymous` (new: anon guests + `portal_request_id` + `pre_checkin_token`); `availability` (new: sold-out/one-left shaping).
5. **Business sections**: `finance`, `operations`, `night_audit`, `marketing`, `loyalty`, `guest_access` (+self_checkin_events, support), `auth_extra` (2FA user via lib encrypt fn, token rows), `notifications`, `audit`, `webhook_fixtures` (PayPal pending + deterministic order ids, `processing`/`void` payment rows).
6. **Wire registry + summary counts**; verify `--all`, reruns, `--reset`, `--scenario`, `--ref-date`.
7. **Repo repoint**: delete staging.sql; Makefile `db-seed`; `tests/postgres_patch_catalog.rs` pinned line; `.github/workflows/ci.yml` staging job.
8. **Docs**: database/README.md, docs/development.md, docs/guides/staging-environment.md, README.md pointer, docs/features.md, CLAUDE.md, .claude/rules/00-diagnosis.md.
9. **Tests**: `tests/seed_registry.rs` (no-DB unit), `tests/seed_apply.rs` (CARGO_BIN_EXE_seed, DATABASE_URL-gated).
10. **Verify**: `cargo check/clippy --all-features`, relevant `cargo test`, markdown link check, `make db-mirror-check`; rerun seed twice for idempotency; spot-check app reads (frontdesk list query).

## Conventions

- Id band 800000–899999; `OVERRIDING SYSTEM VALUE`; `staging_ref` temp table for dates; `param!`/`sql_compat` not needed (raw strings, Postgres-only).
- SQL ported verbatim from staging.sql; new rows extend the same id sub-bands.
- No new dependencies (clap/dotenvy/sqlx already present).
