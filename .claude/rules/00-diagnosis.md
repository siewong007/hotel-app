# Quick Diagnosis — where this harness leaks tokens, loses focus, and makes mistakes

Written 2026-07-05 by a Fable 5 session. Read this once per session before heavy work.
Every rule here is executable — no judgment required.

## Leak #1: Reading large files whole (biggest token leak)

The hot files in this repo are huge. `hotel-app-be/src/repositories/bookings/lifecycle.rs`
(~3.5k lines) and `repositories/ledger.rs` (~1.3k; handlers are thin wrappers now) are the worst; `database/postgres/migrations/0001_v1_baseline.sql` is large;
so are `BookingsPage.tsx` and `CustomerLedgerPage.tsx`. Reading one of these whole
can burn 30–60k tokens in a single call.

**Fix (mandatory procedure):**
1. For architecture, dependency, caller, or change-impact questions, start with
   `codegraph status .` and the relevant command from `.claude/refs/codegraph.md`.
   Do not substitute a broad repository search for this discovery step.
2. Before reading any `.rs`, `.tsx`, or `.sql` file, run `wc -l` on it (or Glob+Grep first).
3. If the file is >400 lines, NEVER Read it without `offset`/`limit`. Grep for the
   function name first to get a line number, then Read ±80 lines around it.
4. CLAUDE.md and `.claude/refs/*.md` already list known line anchors
   (e.g. `create_booking_handler` at repositories/bookings/lifecycle.rs:900). Start from those, but verify
   with Grep — anchors rot as code moves.
5. If you need a broad sweep ("where is X handled across the repo"), delegate to an
   Explore subagent (see `model-dispatch.md`) instead of reading files yourself.

- ✅ Good: `grep -n "fn manual_checkin_handler" handlers/bookings.rs` → Read offset 1780, limit 160.
- ❌ Bad: `Read handlers/bookings.rs` with no limit "to get context".

## Leak #2: Dual-database contract violations (most common CI failure)

Postgres-only SQL will pass a plain `cargo check` locally and then fail CI
(`cargo check --all-features`, clippy `-D warnings`). Worse: SQL that compiles but
behaves differently (e.g. `NOW()`, `$1` vs `?1`, Decimal handling) ships silently.

**Fix (mandatory checklist for ANY SQL or schema change):**
1. Placeholders: use `param!(1)`, `param!(2)` — never literal `$1` or `?1`.
2. Time: use `sql_compat::current_timestamp()` / `current_date()` — never `NOW()` / `CURRENT_DATE`.
3. DB-divergent values: use `core/db.rs` helpers (`decimal_to_db`, `opt_decimal_to_db`, `generate_uuid`).
4. Schema changes: update BOTH `hotel-app-be/database/postgres/` AND
   `hotel-app-be/database/README.md`). One engine without the other = incomplete task.
5. Before claiming done: `cargo check --all-features` MUST pass. This is the minimum
   bar; `cargo clippy --all-features -- -D warnings` is what CI actually runs.


## Leak #3: Forgetting cross-cutting wiring (silent runtime failures)

New features touch registration points that nothing forces you to remember. The
symptom is "it compiles but the endpoint 404s in dev" or "lint fails on CI only".

**Fix (new-endpoint checklist — run every item, in order):**
1. Route merged in `hotel-app-be/src/routes/mod.rs::create_router` (`.merge()`), or it's dead.
2. Handler guarded: `require_auth(&headers)` + `check_permission(pool, user_id, "<resource>:<action>")`.
3. New top-level API prefix added to the proxy list in `hotel-web-fe/vite.config.ts`,
   or the dev server won't forward it (production works, dev mysteriously fails).
4. Frontend calls go through `src/api/client.ts` (`ky` instance) — never `fetch`.
5. New page routes added in `src/routes/*.tsx` AND the lazy registry `src/navigation/routeRegistry.tsx` (not App.tsx).
6. Dates: never `toISOString().split(...)` / `.slice(...)` — ESLint `no-restricted-syntax`
   bans it and CI fails. Use helpers in `hotel-web-fe/src/utils/date.ts`.
7. Mutating handlers call `services/audit.rs`; free-text input goes through `utils/sanitization.rs::Sanitizer`.

- ✅ Good: after adding `/api/housekeeping` routes, vite.config.ts diff shows the new proxy entry.
- ❌ Bad: endpoint works via curl to :3030 but the FE dev server returns HTML 404 — item 3 skipped.

## Honorable mention: doing everything in the main context

Long sessions in this repo die from accumulation: file dumps, test output, repeated
re-reads. The fix is structural, not willpower — follow `model-dispatch.md`: the main
session delegates scanning/batch work to subagents and receives conclusions + file:line only.
