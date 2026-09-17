# Quick Diagnosis — where this harness leaks tokens, loses focus, and makes mistakes

Written 2026-07-05 by a Fable 5 session. Read this once per session before heavy work.
Every rule here is executable — no judgment required.

## Leak #1: Reading large files whole (biggest token leak)

The hot files are huge (measured 2026-09-17, all under `hotel-app-be/src/modules/`
since the domain-module migration): the V1 baseline SQL 10.7k lines,
`modules/bookings/lifecycle.rs` ~3.7k, `modules/payments/service.rs` ~3.1k,
`modules/analytics/repository.rs` ~2.5k, `modules/payments/repository.rs` ~2.3k,
`features/invoices/components/CheckoutInvoiceModal.tsx` ~2.2k, `src-tauri/src/postgres.rs` ~2.2k,
`features/admin/components/CustomerLedger/CustomerLedgerPage.tsx` ~2.2k,
`modules/ledgers/repository.rs` ~2.1k, `staging.sql` ~1.7k,
`seed.sql` ~1.7k. Reading one whole can burn 30–60k tokens in a single call. Handlers are
thin wrappers now — `modules/bookings/handlers.rs` is 268 lines, and `BookingsPage.tsx` was split
down to ~450, so neither is worth avoiding any more.

**Fix (mandatory procedure):**
1. For architecture, dependency, caller, or change-impact questions, start with
   `codegraph status .` and the relevant command from `.claude/refs/codegraph.md`.
   Do not substitute a broad repository search for this discovery step.
2. Before reading any `.rs`, `.tsx`, or `.sql` file, run `wc -l` on it (or Glob+Grep first).
3. If the file is >400 lines, NEVER Read it without `offset`/`limit`. Grep for the
   function name first to get a line number, then Read ±80 lines around it.
4. CLAUDE.md and `.claude/refs/*.md` already list known line anchors
   (e.g. `create_booking_handler` at modules/bookings/lifecycle.rs:1063 — that name also
   exists in `modules/bookings/handlers.rs` and `modules/guest_booking/handlers.rs`, so grep the
   qualified path). Start from those, but always verify — anchors rot as code moves.
5. If you need a broad sweep ("where is X handled across the repo"), delegate to an
   Explore subagent (see `model-dispatch.md`) instead of reading files yourself.

- ✅ Good: `grep -n "fn create_booking_handler" modules/bookings/lifecycle.rs` → Read offset 1063, limit 160.
- ❌ Bad: `Read modules/bookings/lifecycle.rs` with no limit "to get context" (3.7k lines).

## Leak #2: Dual-database contract violations (most common CI failure)

Postgres-only SQL will pass a plain `cargo check` locally and then fail CI
(`cargo check --all-features`, clippy `-D warnings`). Worse: SQL that compiles but
behaves differently (e.g. `NOW()`, `$1` vs `?1`, Decimal handling) ships silently.

**Fix (mandatory checklist for ANY SQL or schema change):**
1. Placeholders: use `param!(1)`, `param!(2)` — never literal `$1` or `?1`.
2. Time: use `sql_compat::current_timestamp()` / `current_date()` — never `NOW()` / `CURRENT_DATE`.
3. DB-divergent values: use `core/db.rs` helpers (`decimal_to_db`, `opt_decimal_to_db`, `generate_uuid`).
4. Schema changes: land in BOTH the baseline
   (`hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`, for fresh
   installs) AND a new catalog patch registered in `patches/manifest.tsv` (for
   installed databases). One without the other = incomplete task: a baseline-only
   change skips every live database, a patch-only change skips every fresh install.
   Then mirror to desktop (item 10 below). ("One engine without the other" here was
   a leftover from the removed SQLite/Postgres dual-engine era — corrected 2026-09-15.)
5. Before claiming done: `cargo check --all-features` MUST pass. This is the minimum
   bar; `cargo clippy --all-features -- -D warnings` is what CI actually runs.


## Leak #3: Forgetting cross-cutting wiring (silent runtime failures)

New features touch registration points that nothing forces you to remember. The
symptom is "it compiles but the endpoint 404s in dev" or "lint fails on CI only".

**Fix (new-endpoint checklist — run every item, in order):**
1. Route merged in `hotel-app-be/src/routes/mod.rs::create_router` (`.merge()`), or it's dead.
2. Handler guarded: `require_auth(&headers)` + `check_permission(pool, user_id, "<resource>:<action>")`.
3. Vite dev proxy: `/api/...` endpoints are ALREADY forwarded (`PROXY_PREFIXES` in
   `hotel-web-fe/vite.config.ts` covers `/api`, `/uploads`, `/health`, `/ws`), so a new
   endpoint needs no edit. Only a brand-new TOP-LEVEL prefix does — and that one also
   belongs in the desktop CORS allow-list (`hotel-desktop/src-tauri/src/commands.rs`).
4. Frontend calls go through `src/api/client.ts` (`ky` instance) — never `fetch`.
5. New page routes added in `src/routes/*.tsx` AND the lazy registry `src/navigation/routeRegistry.tsx` (not App.tsx).
6. Dates: never `toISOString().split(...)` / `.slice(...)` — ESLint `no-restricted-syntax`
   bans it and CI fails. Use helpers in `hotel-web-fe/src/utils/date.ts`.
7. Mutating handlers call `services/audit.rs`; free-text input goes through `utils/sanitization.rs::Sanitizer`.
8. Route added or removed → regenerate the API spec, or `tests/openapi_drift.rs` fails CI:
   `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`.
9. New catalog patch → register it in `patches/manifest.tsv`, `deploy/deploy.sh`,
   `deploy/deploy-staging.sh`, and BOTH `.github/workflows/deploy*.yml`; none fail loudly.
   See the patch paragraph in CLAUDE.md. Both patch tests read the committed manifest
   (`postgres_patch_catalog.rs` enforces manifest↔deploy parity, `postgres_patch_lifecycle.rs`
   builds synthetic catalogs), so no test bounds need hand-editing when the head moves.
10. New cross-request state (rate limits, caches, job registries, schedulers) → give it a
    Postgres home (`rate_limit_buckets`-style table, `pg_notify` invalidation, or a
    `core::leader::spawn_exclusive` lock) or write down why it is intentionally
    per-replica — process-local `HashMap`/`OnceLock` state silently multiplies across
    replicas.
11. Schema change → mirror it into the desktop bundle with `bun run sync:resources`, or
   desktop ships a stale baseline and an empty patch manifest. Nothing in CI catches this.

- ✅ Good: after adding `POST /api/bookings/{id}/release`, the diff also shows the regenerated
  `docs/api/openapi.json` entry — item 8 done.
- ❌ Bad: endpoint merged and clippy-clean, but CI's `openapi_drift` reports the route missing
  from the spec — item 8 skipped.

## Leak #4: doing everything in the main context

Long sessions die from accumulation — file dumps, test output, repeated re-reads. The fix
is structural: per `.claude/refs/model-dispatch.md`, the main session delegates scanning
and batch work, and receives conclusions + `file:line` only.
