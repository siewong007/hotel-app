-- Patch: sync_all_room_statuses() bulk reconciliation function (PostgreSQL)
-- Date: 2026-07-26
--
-- Purpose: bring an already-initialized V1 database in line with
-- database/postgres/migrations/0001_v1_baseline.sql, which now creates
-- sync_all_room_statuses(p_user_id). Without the function, the
-- POST /api/rooms/sync-statuses endpoint (HousekeepingPage "Sync statuses"
-- button) fails at runtime with "function sync_all_room_statuses(bigint)
-- does not exist".
--
-- The body below is verbatim from the V1 baseline so a patched database and a
-- freshly installed one produce identical pg_dump --schema-only output.
--
-- Safe to run more than once:
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-26-sync-all-room-statuses-function.sql

CREATE OR REPLACE FUNCTION public.sync_all_room_statuses(p_user_id bigint DEFAULT NULL::bigint) RETURNS TABLE(room_id bigint, room_number character varying, old_status character varying, new_status character varying)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_room RECORD;
    v_desired VARCHAR(20);
    v_res_start DATE;
    v_res_end DATE;
BEGIN
    -- Bulk reconciliation of rooms.status against bookings. Mirrors the policy
    -- of the sync_room_status_with_booking() trigger: housekeeping and
    -- maintenance states (dirty, cleaning, reserved_dirty, maintenance,
    -- out_of_order) are never overridden; only the booking-derived states
    -- (available, occupied, reserved) are recomputed.
    FOR v_room IN
        SELECT r.id, r.room_number, r.status
        FROM rooms r
        WHERE r.is_active = true
          AND r.status IN ('available', 'occupied', 'reserved')
        ORDER BY r.id
    LOOP
        v_res_start := NULL;
        v_res_end := NULL;

        IF EXISTS (
            SELECT 1 FROM bookings b
            WHERE b.room_id = v_room.id
              AND b.status IN ('checked_in', 'auto_checked_in', 'late_checkout')
              AND b.check_in_date <= CURRENT_DATE
              AND b.check_out_date >= CURRENT_DATE
        ) THEN
            v_desired := 'occupied';
        ELSE
            SELECT b.check_in_date, b.check_out_date
              INTO v_res_start, v_res_end
              FROM bookings b
             WHERE b.room_id = v_room.id
               AND b.status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')
               AND b.check_out_date > CURRENT_DATE
             ORDER BY b.check_in_date
             LIMIT 1;
            IF FOUND THEN
                v_desired := 'reserved';
            ELSE
                v_desired := 'available';
            END IF;
        END IF;

        IF v_desired <> v_room.status THEN
            PERFORM update_room_status(v_room.id, v_desired,
                'Bulk status sync from bookings', p_user_id, v_res_start, v_res_end);
            room_id := v_room.id;
            room_number := v_room.room_number;
            old_status := v_room.status;
            new_status := v_desired;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;
