-- ============================================================================
-- MIGRATION 017: DB-LEVEL BOOKING OVERLAP PREVENTION
-- ============================================================================
-- Description:
--   Adds an EXCLUDE constraint on the bookings table so PostgreSQL itself
--   rejects any two active reservations that overlap on the same room.
--   The application already enforces this via SELECT … FOR UPDATE inside
--   create_booking_handler, but the DB-level guard removes a class of bugs
--   from concurrent writers, manual SQL, imports, and admin tooling.
--
--   The constraint is partial: it applies only to statuses that *occupy* a
--   room. Statuses excluded:
--     - voided, no_show, completed, comp_cancelled — historical/terminal
--     - checked_out — the room has been released
--     - partial_complimentary, fully_complimentary — flagged separately
--
--   PostgreSQL does not support NOT VALID for EXCLUDE constraints, so any
--   pre-existing overlapping rows would cause CREATE to fail. The migration
--   surfaces violators with a clear NOTICE before raising, so the operator
--   can clean them up and rerun.
--
-- Postgres-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- btree_gist — required for EXCLUDE that mixes equality and range
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "btree_gist";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'btree_gist not available — booking overlap EXCLUDE will be skipped';
END
$$;

-- ----------------------------------------------------------------------------
-- Pre-flight: detect existing overlaps and surface them before failing
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_violation_count BIGINT;
    v_sample TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
        RAISE NOTICE 'btree_gist missing — skipping bookings overlap constraint';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_room_date_overlap'
    ) THEN
        RAISE NOTICE 'bookings_no_room_date_overlap already exists — nothing to do';
        RETURN;
    END IF;

    WITH active AS (
        SELECT id, room_id, check_in_date, check_out_date
        FROM bookings
        WHERE status IN ('pending', 'confirmed', 'checked_in', 'auto_checked_in')
          AND check_out_date > check_in_date
    ),
    -- NB: "overlaps" is a reserved SQL keyword and cannot be a CTE name.
    overlap_pairs AS (
        SELECT a.id AS a_id, b.id AS b_id, a.room_id
        FROM active a
        JOIN active b
          ON a.room_id = b.room_id
         AND a.id < b.id
         AND daterange(a.check_in_date, a.check_out_date, '[)')
             && daterange(b.check_in_date, b.check_out_date, '[)')
    )
    SELECT COUNT(*),
           string_agg(format('room %s: bookings %s and %s', room_id, a_id, b_id), '; ')
      INTO v_violation_count, v_sample
      FROM overlap_pairs;

    IF v_violation_count > 0 THEN
        RAISE EXCEPTION
            'Cannot add bookings_no_room_date_overlap: % overlapping active bookings exist. Sample: %',
            v_violation_count, v_sample
            USING HINT = 'Resolve the overlaps (void/move one of each pair), then rerun this migration.';
    END IF;

    EXECUTE $constraint$
        ALTER TABLE bookings
            ADD CONSTRAINT bookings_no_room_date_overlap
            EXCLUDE USING gist (
                room_id WITH =,
                daterange(check_in_date, check_out_date, '[)') WITH &&
            )
            WHERE (status IN ('pending', 'confirmed', 'checked_in', 'auto_checked_in'))
    $constraint$;

    RAISE NOTICE 'Added EXCLUDE constraint bookings_no_room_date_overlap';
END
$$;
