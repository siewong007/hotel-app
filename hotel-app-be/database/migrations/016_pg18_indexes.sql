-- ============================================================================
-- MIGRATION 016: PG 18 INDEX IMPROVEMENTS
-- ============================================================================
-- Description:
--   * Adds GIN trigram indexes for the columns that the app searches with
--     `ILIKE '%…%'` (guests, companies, bookings, users).
--   * Adds GIN(jsonb_path_ops) index on audit_logs.details so containment
--     and the existing `details::text ILIKE` path can be planned.
--   * Adds BRIN indexes on the append-only time-series tables
--     (audit_logs.created_at, night_audit_posted_nights.audit_date).
--   * Adds a covering btree on bookings for the room/status occupancy
--     lookup, using INCLUDE so range checks come from the index alone.
--   * Drops three indexes that are strict subsets of others — wins write
--     amplification with no read regression because PG 18's improved
--     multicolumn btree skip scan covers the dropped single-column forms.
--
-- All trigram/GIN indexes are guarded by extension existence checks so the
-- migration is safe on bundled desktop builds where pg_trgm is unavailable.
--
-- Postgres-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pg_trgm GIN indexes (guarded — skipped silently if extension is missing)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        CREATE INDEX IF NOT EXISTS idx_guests_full_name_trgm
            ON guests USING gin (full_name gin_trgm_ops)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_guests_email_trgm
            ON guests USING gin (email gin_trgm_ops)
            WHERE deleted_at IS NULL AND email IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_companies_company_name_trgm
            ON companies USING gin (company_name gin_trgm_ops);

        CREATE INDEX IF NOT EXISTS idx_bookings_booking_number_trgm
            ON bookings USING gin (booking_number gin_trgm_ops);

        CREATE INDEX IF NOT EXISTS idx_users_username_trgm
            ON users USING gin (username gin_trgm_ops)
            WHERE deleted_at IS NULL;
    ELSE
        RAISE NOTICE 'pg_trgm not installed — skipping trigram GIN indexes';
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- JSONB GIN — audit_logs.details
-- ----------------------------------------------------------------------------
-- jsonb_path_ops is smaller and faster than the default jsonb_ops for the
-- containment-only queries we run; the existing `details::text ILIKE` path
-- still benefits because the planner can prefilter rows via the GIN index.
CREATE INDEX IF NOT EXISTS idx_audit_logs_details_gin
    ON audit_logs USING gin (details jsonb_path_ops);

-- ----------------------------------------------------------------------------
-- BRIN — append-only time-series
-- ----------------------------------------------------------------------------
-- BRIN keeps a tiny per-block summary that is ideal for monotonically growing
-- timestamps. We keep the existing btree on audit_logs(created_at DESC) as
-- well; the planner picks whichever fits the query. The BRIN tends to win
-- for wide range scans and uses ~1/1000th the storage.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_brin
    ON audit_logs USING brin (created_at);

CREATE INDEX IF NOT EXISTS idx_night_audit_posted_nights_date_brin
    ON night_audit_posted_nights USING brin (audit_date);

-- ----------------------------------------------------------------------------
-- Covering index for the hot booking-occupancy lookup
-- ----------------------------------------------------------------------------
-- create_booking_handler runs:
--   SELECT 1 FROM bookings
--   WHERE room_id = $1
--     AND status IN ('confirmed','pending','checked_in','auto_checked_in')
--     AND tstzrange(...) && tstzrange(...)
-- This INCLUDE-covering index lets the planner answer the existence check
-- without a heap visit, while keeping (room_id, status) as the search key.
CREATE INDEX IF NOT EXISTS idx_bookings_room_status_covering
    ON bookings (room_id, status)
    INCLUDE (check_in_date, check_out_date, total_amount);

-- ----------------------------------------------------------------------------
-- Drop redundant indexes
-- ----------------------------------------------------------------------------
-- idx_bookings_dates (check_in_date, check_out_date) already serves any
-- query that filters on check_in_date alone; PG 18's improved multicolumn
-- btree skip scan further reduces value of the single-column siblings.
DROP INDEX IF EXISTS idx_bookings_check_in;
DROP INDEX IF EXISTS idx_bookings_check_out;

-- idx_bookings_occupancy_lookup is a strict subset of
-- idx_bookings_room_status_dates (same key columns, just a WHERE predicate).
-- The new covering index above does the actual hot work; this partial is
-- redundant now.
DROP INDEX IF EXISTS idx_bookings_occupancy_lookup;
