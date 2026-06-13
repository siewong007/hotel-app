# PostgreSQL 18 Upgrade Notes

This document describes the database changes introduced for PostgreSQL 18 and
how to deploy them safely.

## Required version

- **PostgreSQL 18.x** (already targeted; the desktop bundle pins
  `CONFIGURED_POSTGRES_MAJOR_VERSION = "18"` and refuses to start against an
  older data directory).
- SQLite mode is unaffected. PostgreSQL setup now lives in the consolidated
  `database/schema.sql` script; SQLite keeps its separate compatibility path.

## Required extensions

The PG18 extension section in `database/schema.sql` enables the following,
each guarded with `DO $$ EXCEPTION` so setup succeeds even on stripped-down
bundled builds:

| Extension | Purpose | Critical? |
|---|---|---|
| `pg_stat_statements` | Query-level performance visibility | No — observability only |
| `pg_trgm` | Trigram GIN indexes that accelerate `ILIKE '%…%'` searches | No — trigram indexes in `database/schema.sql` are guarded and skipped if the extension is missing |
| `btree_gin` | Reserved for mixed-type GIN indexes (currently unused) | No |

If you operate a hosted Postgres (RDS, Cloud SQL, Supabase, Neon, etc.) and
want trigram indexes for full search performance benefit, ensure
`pg_trgm` is in the cluster's `shared_preload_libraries` / available extension
list before deploying. No manual `CREATE EXTENSION` is needed; `schema.sql`
will create it.

## Deployment order

PostgreSQL setup is consolidated into the two active database scripts. Apply
schema first, then system data:

```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/data.sql
```

For desktop builds, the resource sync copies these two files into
`hotel-desktop/src-tauri/database/`, and the desktop launcher runs them in
that order on startup.

## What changed

### PG18 extensions and UUIDv7

- Enables `pg_stat_statements`, `pg_trgm`, `btree_gin` (best-effort).
- Adds `gen_uuidv7()`, a wrapper that prefers PG 18's native `uuidv7()` with
  a `gen_random_uuid()` fallback. **Existing UUID columns are not migrated.**
  Use `gen_uuidv7()` as the default for *new* UUID columns going forward to
  pick up time-ordered keys (better btree locality).
- Hardens `update_updated_at_column()` with `SET search_path = pg_catalog,
  public` to remove a known function-hijack vector.

### PG18 indexes

- Adds trigram (GIN) indexes for the columns that the app searches with
  `ILIKE '%…%'`:
  - `guests.full_name`, `guests.email`
  - `companies.company_name`
  - `bookings.booking_number`
  - `users.username`
- Adds `GIN(jsonb_path_ops)` on `audit_logs.details`.
- Adds BRIN indexes on append-only time series:
  - `audit_logs.created_at`
  - `night_audit_posted_nights.audit_date`
- Adds a covering btree on `bookings(room_id, status) INCLUDE
  (check_in_date, check_out_date, total_amount)` — accelerates the
  occupancy-check `SELECT … FOR UPDATE` inside `create_booking_handler`.
- **Drops three redundant indexes** on `bookings`:
  - `idx_bookings_check_in` (subsumed by `idx_bookings_dates`)
  - `idx_bookings_check_out` (subsumed by `idx_bookings_dates`)
  - `idx_bookings_occupancy_lookup` (subsumed by the new covering index)

  PG 18's improved multicolumn btree skip scan further reduces the value of
  the dropped single-column forms.

## Production deployment notes

### Backup first

```bash
pg_dump --format=custom --file=pre_pg18_indexes.dump $DATABASE_URL
```

### Lock behavior

The consolidated schema uses plain `CREATE INDEX` (not `CONCURRENTLY`) to keep
setup deterministic. For tables under heavy write load:

| Table | Estimated row count concern | Recommendation |
|---|---|---|
| `audit_logs` | Grows fast | The BRIN and GIN indexes are small; build is fast. Acceptable to take a brief `SHARE` lock at upgrade time. |
| `bookings` | Few thousand per hotel-year | Negligible build time. |
| `guests`, `companies`, `users` | Small | Negligible. |
| `night_audit_posted_nights` | One row per booking-night | Small. |

If you operate at a scale where any of these are >10M rows, create the
trigram/GIN/BRIN indexes with `CREATE INDEX CONCURRENTLY` during a maintenance
window before applying `schema.sql`. The redundant index drops are
transaction-safe but will take an `ACCESS EXCLUSIVE` lock briefly.

### Rollback

If anything goes wrong, the indexes are additive and the drops are
reversible:

```sql
-- Re-create the dropped indexes (from 008_bookings.sql)
CREATE INDEX IF NOT EXISTS idx_bookings_check_in  ON bookings(check_in_date);
CREATE INDEX IF NOT EXISTS idx_bookings_check_out ON bookings(check_out_date);
CREATE INDEX IF NOT EXISTS idx_bookings_occupancy_lookup
    ON bookings(room_id, status, check_in_date, check_out_date)
    WHERE status = 'checked_in';

-- Drop new objects
DROP INDEX IF EXISTS idx_bookings_room_status_covering;
DROP INDEX IF EXISTS idx_night_audit_posted_nights_date_brin;
DROP INDEX IF EXISTS idx_audit_logs_created_at_brin;
DROP INDEX IF EXISTS idx_audit_logs_details_gin;
DROP INDEX IF EXISTS idx_users_username_trgm;
DROP INDEX IF EXISTS idx_bookings_booking_number_trgm;
DROP INDEX IF EXISTS idx_companies_company_name_trgm;
DROP INDEX IF EXISTS idx_guests_email_trgm;
DROP INDEX IF EXISTS idx_guests_full_name_trgm;

-- 015 objects (only do this if you really need to roll the function back)
DROP FUNCTION IF EXISTS gen_uuidv7();
```

## How to verify setup

```bash
psql "$DATABASE_URL" -f database/schema.sql

# Confirm new objects exist
psql "$DATABASE_URL" -c "\df gen_uuidv7"
psql "$DATABASE_URL" -c "\d+ audit_logs"  | grep -E "trgm|brin|gin"
psql "$DATABASE_URL" -c "\d+ bookings"    | grep -E "covering|trgm"
psql "$DATABASE_URL" -c "SELECT gen_uuidv7();"   # should return a v7-shaped UUID
```

Optionally check the planner now picks the new indexes:

```sql
EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM guests WHERE full_name ILIKE '%smith%' AND deleted_at IS NULL;
-- Expect: Bitmap Index Scan on idx_guests_full_name_trgm

EXPLAIN (ANALYZE, BUFFERS)
  SELECT 1 FROM bookings
  WHERE room_id = 1 AND status IN ('confirmed','pending','checked_in');
-- Expect: Index Only Scan on idx_bookings_room_status_covering
```

## Phase B (applied)

The three medium-risk follow-ups from the original Phase A delivery are now
included in `database/schema.sql`:

### Booking overlap exclusion

- Enables `btree_gist` defensively.
- Adds `bookings_no_room_date_overlap` — a partial `EXCLUDE USING gist`
  constraint that rejects any two bookings sharing the same `room_id` with
  overlapping `daterange(check_in_date, check_out_date, '[)')` when status
  is one of `pending`, `confirmed`, `checked_in`, `auto_checked_in`.
- Pre-flight `DO` block detects existing violators and raises with a clear
  hint *before* trying to create the constraint, since `EXCLUDE` does not
  support `NOT VALID`. If schema setup fails, fix the surfaced overlapping
  bookings (void/move one of each pair) and rerun.
- The application's existing `SELECT … FOR UPDATE` guard in
  `create_booking_handler` is now backed up by the DB.
- **Fix (PG 18.4 verification):** the pre-flight query used a CTE named
  `overlaps`, which is a reserved SQL keyword — it parsed only on bundled
  builds *without* `btree_gist` (where the block hit its early `RETURN`) and
  errored on any full Postgres. Renamed to `overlap_pairs`; the constraint now
  actually gets created on 18.4.

### UUIDv7 defaults

- Flips the `DEFAULT` on every UUID column that previously used
  `uuid_generate_v4()` to `gen_uuidv7()` (added in `015`).
- Tables touched: `refresh_tokens`, `passkeys`, `passkey_challenges`,
  `corporate_accounts`, `room_status_change_log`, `booking_modifications`,
  `booking_history`, `booking_services`, `users.uuid`, `guests.uuid`,
  `bookings.uuid`, `user_sessions.session_id`, `payments.uuid`,
  `invoices.uuid`.
- Existing rows are not migrated — only new inserts pick up the v7 prefix.
  Mixed v4/v7 values are harmless; both are 128-bit `uuid` values.

### Virtual generated columns

- Adds `bookings.tourism_billable_amount` as a **VIRTUAL** generated column
  (PG 18 feature): `CASE WHEN is_tourist THEN COALESCE(tourism_tax_amount,
  0) ELSE 0 END`. Read-only, no storage, no write cost.
- Lets reporting queries replace duplicated `CASE` expressions with a
  single column reference.
- **Now wired in:** the general-journal report (`handlers/analytics.rs`)
  selects `b.tourism_billable_amount` instead of a bare
  `COALESCE(b.tourism_tax_amount, 0)`, so non-tourist bookings can never post
  tourism tax into the journal.

### Audit log partitioning

- Converts `audit_logs` into a `RANGE`-partitioned table (one partition per
  calendar month on `created_at`), the deferred audit partitioning follow-up.
  An atomic rename -> recreate -> copy -> drop rewrite during schema setup;
  preserves existing `id`s via `OVERRIDING SYSTEM VALUE` and
  backfills any NULL `created_at`.
- `id` switches to `GENERATED ALWAYS AS IDENTITY` (PK becomes `(id,
  created_at)` — required because the partition key must be in every unique
  constraint; no FK references `audit_logs.id`, so this is transparent). The
  old `audit_logs_id_seq` is dropped.
- Ships a `DEFAULT` partition (no insert is ever rejected), pre-creates the
  current month + next 11, and adds `ensure_audit_logs_partition(date)` for a
  maintenance job/deploy to roll partitions forward.
- Verified end-to-end on bundled **PostgreSQL 18.4**: fresh-install apply,
  data-preserving upgrade from a populated table, insert routing, the DEFAULT
  catch-all, and identity advancement.

## Application-code wiring (PG 18.4 pass)

- `core::db::generate_uuid()` now emits **UUIDv7** (`Uuid::now_v7()`) to match
  the `gen_uuidv7()` column defaults from `018` — app-generated PKs get the
  same time-ordered btree locality. Random-token / booking-suffix call sites
  intentionally keep `Uuid::new_v4()`.
- Literal `NOW()` in `core/auth.rs` and `handlers/passkey.rs` replaced with the
  standard `CURRENT_TIMESTAMP`; the two passkey-challenge expiries that used
  `NOW() + INTERVAL '5 minutes'` now bind a chrono-computed timestamp so the
  queries are portable to SQLite.
- Driver/lib bumps within semver: `uuid 1.19→1.23.2`, `chrono 0.4.43→0.4.44`,
  `rust_decimal 1.40→1.42`. `sqlx` stays at `0.8.6` (already the latest 0.8.x;
  `0.9` is a breaking pre-1.0 major and is out of scope for this pass).

## Remaining manual follow-up (not applied — high-risk)

1. **Drop the parallel `id BIGINT` + `uuid UUID` pattern** on user/guest/
   booking tables in favor of a single UUID PK. **Deliberately not done** — it
   rewrites every PK and the FKs that reference them across the whole schema,
   plus the `i64`-typed id handling throughout the Rust code, for no benefit at
   current scale. This belongs in its own dedicated, separately-reviewed change
   rather than bundled into a compatibility pass.

Items 2 (audit partitioning) and 3 (`GENERATED ALWAYS AS IDENTITY`) from the
previous revision of this list are now done: partitioning via `020`, and
IDENTITY is adopted in `020` and is the go-forward standard for new tables.
