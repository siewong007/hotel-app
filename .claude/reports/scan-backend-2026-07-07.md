# Backend Code-Health Scan — 2026-07-07

Scope: `hotel-app-be/` only. Desktop/packaging and prior security topics
(auth-token-storage, SQL-injection, audit-logging) explicitly excluded per
task instructions — not re-scanned.

## 1. Handler monoliths / layering

`wc -l` on every file in `src/handlers/`, `src/repositories/`, `src/services/`.

Handlers total 2,620 lines across 21 files — largest: `ekyc.rs` (331),
`bookings.rs` (264), `rbac.rs` (232), `rooms.rs` (215), `rates.rs` (196). None
exceed ~330 lines; handlers are thin.

Repositories total 20,478 lines — 8 largest:
- `src/repositories/analytics.rs` — 2,679
- `src/repositories/ledger.rs` — 2,335
- `src/repositories/rooms_queries.rs` — 1,627
- `src/repositories/guest.rs` — 1,586
- `src/repositories/ekyc.rs` — 1,383
- `src/repositories/night_audit.rs` — 1,258
- `src/repositories/payment.rs` — 1,103
- `src/repositories/rbac.rs` — 913

Services total 11,410 lines — largest: `src/services/rooms.rs` (2,247),
`src/services/ekyc.rs` (1,409), `src/services/audit.rs` (828),
`src/services/guests.rs` (901), `src/services/passkey.rs` (714).

Inline-SQL counts (`grep -c "sqlx::query\|sql_query!"`):
- `src/handlers/`: **0** matches for both macros — handlers are clean,
  layering is respected (all SQL lives below the handler layer).
- `src/repositories/`: `sqlx::query` = 680, `sql_query!` = 42.
- `src/services/`: `sqlx::query` = 84, `sql_query!` = 0, concentrated almost
  entirely in one file: `src/services/rooms.rs` has 83 of the 84
  (`src/services/night_audit_scheduler.rs` has the remaining 1). This is a
  layering inconsistency — every other service delegates SQL to a
  `repositories/` module; `rooms.rs` embeds ~83 raw `sqlx::query` calls
  directly in the service layer, and none use `sql_query!` (worth checking
  those don't have hidden PG/SQLite divergence bugs — not fully audited here).
  Effort **L**, Risk **med** (architecture-debt + latent dual-DB risk
  concentrated in one file makes future edits there error-prone).

Analytics.rs (2,679 lines) and ledger.rs (2,335 lines) are the two largest
files in the whole backend and are natural candidates for splitting into
sub-modules (mirroring the `repositories/bookings/` split already done for
booking lifecycle code). Effort **M**, Risk **low** (pure refactor,
mechanical, no behavior change if done carefully).

## 2. Test coverage reality

`#[test]` in `src/`: 153. `#[tokio::test]` in `src/`: 4. Dedicated `tests/`
integration dir: 15 files, 81 test functions.

Files under `src/` containing tests (repo-visible domains): `core/*`,
`models/booking.rs`, `modules/ekyc/validation.rs`, `repositories/booking_list.rs`,
`repositories/bookings/{checkin_advisory,lifecycle}.rs`, `repositories/data_transfer.rs`,
`repositories/ekyc.rs`, `repositories/search.rs`, `services/{audit,auto_checkin,
bookings,data_transfer,ekyc,guest_portal,guests,night_audit}.rs`, `utils/*`.

Domains with **zero** `#[test]`/`#[tokio::test]` anywhere in `src/` (verified
by exact grep on each file):
- `src/repositories/ledger.rs` (2,335 lines) — 0
- `src/services/ledgers.rs` — 0
- `src/handlers/ledgers.rs` — 0
- `src/repositories/payment.rs` (1,103 lines) — 0
- `src/services/payments.rs` — 0
- `src/handlers/payments.rs` — 0
- `src/repositories/invoice_numbers.rs` — 0
- `src/services/invoice_numbers.rs` — 0
- `src/repositories/auth.rs` — 0
- `src/services/auth.rs` — 0
- `src/handlers/auth.rs` — 0

However `tests/` integration suite DOES cover ledgers and payments indirectly:
`tests/ledger_filters.rs`, `tests/ledger_transaction_tests.rs`,
`tests/company_ledger_idempotency.rs`, `tests/deposit_refund_revert.rs`,
`tests/payment_record.rs`, `tests/guest_credits.rs`. So ledgers/payments are
NOT untested overall — the gap is unit-level coverage in the source files
themselves.

**Auth and invoices have no dedicated test file at all** — `tests/` has no
`auth_*.rs`/`login_*.rs`/`invoice_*.rs`; the only auth-adjacent coverage is
`tests/rbac_dynamic.rs` (permission checks, not login/JWT/password flow) and
incidental mentions of "invoice" inside `tests/ledger_filters.rs` and
`tests/status_vocabulary.rs`. No test exercises `handlers/auth.rs` login,
refresh, or password-reset flows, nor `repositories/invoice_numbers.rs`
generation logic directly. Effort **M**, Risk **high** (auth is the highest-
consequence untested surface in the backend; recommend a dedicated
`tests/auth_flow.rs`).

## 3. TODO/FIXME/HACK/unimplemented!/todo!

`grep -rn "TODO\|FIXME\|HACK\|unimplemented!\|todo!" src/` → **0 matches**.
Codebase is clean of these markers — checked, found CLEAN.

## 4. `.unwrap()`/`.expect(` density

Non-test-directory raw counts: `.unwrap(` = 71, `.expect(` = 26 (includes
`#[cfg(test)]` blocks embedded in non-`tests/` files, which grep can't
exclude by directory alone).

Per-directory `.unwrap(` counts: `handlers/`=1, `services/`=12,
`repositories/`=12, `core/`=15, `models/`=13, `modules/`=6, `utils/`=11.

Spot-checked 5 non-test-module unwraps in request-handling paths:
1. `src/handlers/audit.rs:52` — `.body(...).unwrap()` building an
   `axum::response::Response` from a `Body::from(csv_content)`; this variant
   of `.body()` only errors on invalid header values, none of which are
   user-controlled here (headers are static/filename-derived from a fixed
   pattern). Low risk but not provably infallible — Effort **S**, Risk **low**.
2. `src/core/middleware.rs:19` — `auth_header.strip_prefix("Bearer ").unwrap()`
   — **safe**: guarded by an explicit `starts_with("Bearer ")` check three
   lines above (lines 13-16) that early-returns `Unauthorized` first. Checked,
   found CLEAN.
3. `src/core/rate_limiter.rs:63` — `self.timestamps.first().unwrap()` in the
   `else` branch of a length check (`len() >= max_requests`, and
   `max_requests` is a `u32` config value); only reachable when
   `timestamps` is non-empty. Checked, found CLEAN.
4. `src/services/guest_portal.rs:169` — `Regex::new(...).unwrap()` compiling
   a static email-validation pattern at call time (not request-data-derived);
   panics only on a hardcoded-wrong regex literal, would fail at first call
   in any environment, not runtime-data-dependent. Effort **S** (could hoist
   to a `once_cell`/`Lazy` static for cheapness), Risk **low**.
5. `src/core/error.rs:154` — `HeaderValue::from_str(&secs.to_string()).unwrap()`
   formatting a numeric `Retry-After` header value from a `u64`; a
   stringified integer is always a valid header value. Checked, found CLEAN.

No runtime-panic-on-user-input unwraps found in the 5 spot-checked; did NOT
exhaustively audit all 71+26 occurrences (out of scope given time budget) —
**unverified** beyond the 5 checked.

## 5. Recent-work risk (commits + untracked migration)

- `dcedf726` "add booking queries" (2026-07-07 23:32) adds
  `database/sqlite_migrations/014_bookings_guest_portal_columns.sql` (17
  lines, 10 `ALTER TABLE bookings ADD COLUMN` + 1 index). **This file is now
  COMMITTED** (was untracked at task-start per the git status snapshot, but
  is no longer untracked as of this scan — `git status` shows a clean
  working tree for this file). Verified every added column
  (`room_rate`, `subtotal`, `remarks`, `discount_percentage`,
  `rate_override_weekday`, `rate_override_weekend`, `pre_checkin_completed`,
  `pre_checkin_completed_at`, `pre_checkin_token`,
  `pre_checkin_token_expires_at`) against `database/schema.sql`'s
  `CREATE TABLE bookings` (schema.sql:1673-1764ish) — **all 10 columns
  already exist on the PostgreSQL side**. No divergence. Checked, found CLEAN.
- `59c1e078` "Add guest portal sessions and history endpoints" — re-checked
  the exact bug class from the 2026-07-07 lesson
  (`invoices.bill_to_guest_id` vs `guest_id`, `payments.transaction_id` vs
  `reference_number`, `guests.is_active`). All three are now handled
  correctly via `sql_query!`:
  - `src/repositories/guest_portal_session.rs:253` —
    `invoice_guest_col = sql_query!(postgres: "bill_to_guest_id", sqlite: "guest_id")`
  - `src/repositories/guest_portal_session.rs:252` —
    `payment_ref_col = sql_query!(postgres: "transaction_id", sqlite: "reference_number")`
  - `database/sqlite_migrations/013_guests_is_active.sql:4` adds
    `guests.is_active` to SQLite; PG has it via
    `database/schema.sql:686` (`ALTER TABLE guests ADD COLUMN IF NOT EXISTS
    is_active ...`).
  Checked, found CLEAN — the previously-identified bug class was fixed and
  has not regressed.

## 6. Error handling

Unified error type exists: `src/core/error.rs` (175 lines),
`pub enum ApiError` with variants `Database`, `Unauthorized`, `Forbidden`,
`BadRequest`, `NotFound`, `Conflict`, `Internal`, `TooManyRequests`,
`TooManyRequestsRetryAfter` (error.rs:12-30).
`grep -rn "StatusCode, String" src/` → **0 matches** — no ad-hoc
`(StatusCode, String)` handler returns found anywhere. Checked, found CLEAN;
no enhancement item needed here.

## 7. Performance smells

`grep -rn "SELECT \*" src/` → 58 raw matches, but most are inside
`#[cfg(test)]` modules (e.g. all 14 in `src/repositories/booking_list.rs` are
test-only invocations of `build_booking_list_query` with a literal
placeholder base query — the real production caller,
`src/repositories/bookings_queries.rs:10` (`GET_BOOKINGS_BASE_QUERY`), uses
an explicit column list, not `SELECT *`).

Genuine **runtime** `SELECT *` (manually confirmed by locating the enclosing
`fn`, not just line proximity to a `#[cfg(test)]` marker):
- `src/repositories/bookings/lifecycle.rs:1406` — inside
  `create_booking_handler` (fn starts line 1171), fetch just-inserted row by
  `booking_number`.
- `src/repositories/bookings/lifecycle.rs:1967` — inside
  `update_booking_handler` (fn starts line 1599).
- `src/repositories/bookings/lifecycle.rs:3842`/`3844` — inside
  `checkin_booking_tx` (fn starts line 3806), PG/SQLite variants (`?1`/`$1`).
- `src/repositories/bookings/lifecycle.rs:4173` — inside
  `confirm_reactivated_booking_and_reserve_room` (fn starts line 4124).
- `src/repositories/payment.rs` — 6 occurrences (invoices/payments lookups,
  e.g. lines 594, 749, 762, 1024), all single-row lookups by id/booking_id.
- `src/repositories/rate.rs` — 7 occurrences, `src/repositories/loyalty.rs` —
  10, `src/modules/loyalty/repository.rs` — 7: mostly single-row/small-table
  lookups (rate plans, room types, loyalty programs/tiers/rewards).
- `src/repositories/passkey.rs:181,195`, `src/repositories/ekyc.rs:479,493`,
  `src/repositories/guest_portal_session.rs` (2, one is a comment noting the
  team deliberately avoided `SELECT *` for `Guest` decode — see line 194-195),
  `src/repositories/data_transfer.rs:116` (dynamic table export, `SELECT *`
  used deliberately for generic CSV/export dump), `src/services/rooms.rs:1459`
  (`SELECT * FROM sync_all_room_statuses()` — function-call result, not a table).

None of these decode into a struct known to have PG/SQLite column-name
divergence today (checked against item 5's findings) — but `SELECT *` is
lint-banned for *new* code per lessons.md and every occurrence above is
pre-existing code, not flagged as newly broken. Effort **M** to replace with
explicit column lists repo-wide, Risk **low** (no active bug found, but each
future schema-divergence introduces silent risk as long as `SELECT *`
remains).

**N+1 confirmed** on the bookings list endpoint: `GET /bookings` →
`get_bookings_handler` (`src/repositories/bookings/lifecycle.rs:880-892`)
calls `crate::services::auto_checkin::attach_booking_ekyc_summaries(&pool,
&mut bookings)` (line 892) AFTER the paginated query returns, and that
function (`src/services/auto_checkin.rs:71-89`) loops over every booking in
the page and calls `guest_ekyc_summary(pool, booking.guest_id)` (line 76,
→ `EkycRepository::latest_guest_summary_record`, a DB query per call) plus
`apply_booking_constraints(...)` (line 77) for EACH booking — i.e. up to
`page_size` (default 50, max 500 per `normalize_pagination(params.page,
params.page_size, 50, 500)` at lifecycle.rs:883) extra DB round-trips per
list request. Effort **M** (batch the eKYC summary lookup by `guest_id IN
(...)`), Risk **med** (real latency multiplier on the most-used list
endpoint at high page sizes; not a correctness bug).

Did not find additional N+1 patterns in `ledgers.rs`/`payments.rs` list
handlers via grep spot-check (no per-row loop-with-query pattern found in
`src/handlers/ledgers.rs` or `src/handlers/payments.rs` themselves — both are
thin handlers delegating to repositories; did not deep-audit the repository
list-query implementations for the same pattern). **Unverified**: whether
`repositories/ledger.rs` or `repositories/analytics.rs` (2,335/2,679 lines,
not read in full per Leak #1) contain similar post-query per-row loops.

## Summary of what was checked and found CLEAN
- Handlers contain zero inline SQL (layering intact).
- TODO/FIXME/HACK/unimplemented!/todo! — zero occurrences.
- `middleware.rs:19` and `rate_limiter.rs:63` unwraps — both provably safe.
- Unified `ApiError` type used consistently; zero ad-hoc `(StatusCode, String)`.
- The two flagged recent commits (`dcedf726`, `59c1e078`) do NOT reintroduce
  the PG/SQLite column-divergence bug class from the 2026-07-07 lesson; the
  previously-untracked migration file is now committed and matches schema.sql.

## Not verified (out of time/scope budget)
- Full audit of all 71 `.unwrap(`/26 `.expect(` sites (only 5 spot-checked).
- Whether `src/services/rooms.rs`'s 83 inline `sqlx::query` calls contain any
  PG/SQLite divergence bugs (not individually checked for `sql_query!`/`$1`
  vs `?1` correctness).
- N+1 patterns inside `repositories/ledger.rs` and `repositories/analytics.rs`
  (2,335 / 2,679 lines — not read in full per Leak #1 budget).
