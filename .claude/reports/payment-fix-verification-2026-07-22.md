# Payment/Invoice column-fix verification — 2026-07-22

Independent verification (verifier did not write the code).

## A. Compile/lint/test gates
- `cargo check --all-features` → exit 0
- `cargo check --features sqlite --no-default-features` → exit 0
- `cargo clippy --all-features -- -D warnings` → exit 0
- `cargo test --all-features` → exit 0 (NOTE: does NOT compile the sqlite-only
  `sqlite_resource_tests`, so it cannot catch the checksum break below)
- `cargo test --features sqlite --no-default-features` → **FAILED, 203 passed / 3 failed**
  (before my checksum fix). All 3 failures root-cause to the un-updated
  `SQLITE_V1_CHECKSUM`:
  - `v1_baseline_checksum_is_immutable`: `119ae3… != 67f448…` (db.rs:310)
  - `resources_initialize_once_without_overwriting_customized_data`: "checksum does not match the immutable release artifact"
  - `non_empty_unversioned_database_is_rejected`: checksum guard fires before that path
  After correcting the constant to `119ae390dd283d601125f1736269dec7e806844d011cb253d4eda515517fa59b`,
  all 3 pass.

## BLOCKER FOUND (now fixed locally by verifier)
The immutable SQLite V1 baseline was modified (2 new room_types columns) but
`SQLITE_V1_CHECKSUM` in `src/core/db.rs:11` was NOT updated (db.rs is not in the
implementer's changeset). Effect: `apply_sqlite_resources` (db.rs:51) rejects any
fresh SQLite DB → **the backend cannot boot in SQLite mode, and 3 unit tests fail.**
Only the sqlite-only build catches this; `--all-features` stays green.
Verifier applied the one-line correction (db.rs:11) to unblock the smoke test.
This MUST be part of the committed fix.

The SQLite loader only ever applies `0001_v1_baseline.sql` (no gen-2 runner exists),
so editing the baseline + bumping the checksum is the only mechanism to add columns
to fresh SQLite DBs — the baseline header's "add a new generation migration instead"
is aspirational for SQLite. Editing the baseline is therefore defensible; the
checksum bump was the missing step.

## B. Schema correctness
- New columns `keycard_deposit_amount`, `service_charge_percentage` present in BOTH
  baselines (PG numeric(10,2)/numeric(5,2), SQLite REAL, both DEFAULT 0).
- Postgres payments/invoices INSERT+SELECT columns all exist in PG baseline
  (`reference_number` absent is correct — sqlite-branch-only column).
- SQLite columns validated by live execution (below).
- No column referenced on the wrong engine branch.

## C. Live SQLite end-to-end smoke test (scratch DB, port 3999)
All 6 endpoints 2xx after correcting the checksum + supplying valid fixtures:
- GET /api/payments/calculate/1 → 200 {subtotal 450, service_charge 45, keycard 50, total 545} (money math correct: 150×3 + 10% + 50)
- POST /api/payments → 200 (payment id 1, total 545, completed)
- GET /api/payments/booking/1 → 200
- POST /api/invoices/generate/1 → 200 (INV-202607-0001, total 545, paid 545, status paid)
- GET /api/invoices/preview/1 → 200
- GET /api/invoices → 200 (returns the invoice)

Two intermediate 500s were TEST-DATA artifacts, not code bugs:
1. date-only `check_in_date` string → "invalid datetime" decode (real bookings store full timestamps).
2. `invoices.guest_id` FK to `guests(id)` failed until a matching guests row existed.
   Root note: `create_generated_invoice`'s booking_details JOIN uses `users u ON b.guest_id = u.id`
   (payment.rs:1053) while `invoices.guest_id` FKs to `guests` — a PRE-EXISTING
   mismatch the code comments flag as out-of-scope. In real data where
   `bookings.guest_id → guests`, that users-JOIN will not find a matching user and
   invoice generation will 500. NOT introduced by this fix, but invoice generation
   is not actually reachable in a realistic single-schema setup. Worth a follow-up.

Non-fatal SQLite read-path nits (no 500):
- `billing_name`/`issue_date` return `""`/`2000-01-01` on read (sqlite invoices has
  no such columns; tolerant mapper degrades). Generate response has them (built in-memory).
- `number_of_nights`: generate returns 3 (date diff, billed subtotal 450=3×150),
  but preview/list return 2 — sqlite enriched read uses
  `CAST(julianday(ts2)-julianday(ts1) AS INTEGER)` which truncates 2.9→2 on
  timestamps with time-of-day. Postgres read uses `::date` diff (correct). Display-only.

## D. Patch files
- SQLite patch: PASS. On a fresh DB from the HEAD (pre-fix) baseline, adds both
  columns (exit 0); re-run errors "duplicate column name" exactly as documented.
- Postgres patch: **BLOCKED — no Postgres reachable** (no docker container; psql
  :5432 connection refused). Live idempotency (`ADD COLUMN IF NOT EXISTS`, applied
  twice) NOT executed. Static read of the file shows correct idempotent syntax.

## E. Diff inspection
- No unwrap-on-fallible, no raw `NOW()`, no stray literal placeholders outside
  cfg/sql_query! (lines 189/209 use `$1` in plain strings but `$N` is valid single-param
  syntax in BOTH engines — audit.rs precedent; cross-DB safe).
- Money math correct (verified live: 545 total).
- STALE COMMENT: payment.rs:1090-1091 still says the pricing columns are "NOT in
  either checked-in baseline schema (pre-existing drift)" — false now; this session
  added them. Cosmetic.
