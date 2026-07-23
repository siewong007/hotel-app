-- Patch: guest portal booking statuses (PostgreSQL)
-- Date: 2026-07-23
--
-- Purpose: bring an already-initialized V1 database's booking status
-- constraint in line with the guest booking workflow. The portal creates a
-- booking in `pending_payment` and can then move it to
-- `pending_confirmation`; older databases permit neither value and return a
-- 500 error when the insert is attempted.
--
-- The two statuses appear in four schema objects, all of which this patch
-- brings in line with database/postgres/migrations/0001_v1_baseline.sql:
--   1. bookings_status_check                 (insert would otherwise fail)
--   2. bookings_no_room_date_overlap         (double-booking protection)
--   3. sync_room_status_with_booking()       (room marked reserved on booking)
--   4. COMMENT ON COLUMN bookings.status     (documentation only)
--
-- Safe to run more than once:
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-23-guest-booking-statuses.sql

BEGIN;

-- The `(value::character varying)::text` spelling below is deliberate: it is
-- how the V1 baseline stores these two expressions, so a patched database and
-- a freshly installed one produce byte-identical `pg_dump --schema-only`
-- output. Plain `status IN (...)` is semantically the same but renders
-- differently and shows up as noise in schema-drift comparisons.

-- 1. Allowed status vocabulary.
ALTER TABLE public.bookings
    DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_status_check
    CHECK (((status)::text = ANY (ARRAY[
        ('pending'::character varying)::text,
        ('pending_payment'::character varying)::text,
        ('pending_confirmation'::character varying)::text,
        ('confirmed'::character varying)::text,
        ('checked_in'::character varying)::text,
        ('auto_checked_in'::character varying)::text,
        ('checked_out'::character varying)::text,
        ('no_show'::character varying)::text,
        ('completed'::character varying)::text,
        ('comp_void'::character varying)::text,
        ('partial_complimentary'::character varying)::text,
        ('fully_complimentary'::character varying)::text,
        ('voided'::character varying)::text
    ])));

-- 2. Reservation overlap protection must treat the new statuses as occupying
--    the room, otherwise two guests can hold the same room and dates.
ALTER TABLE public.bookings
    DROP CONSTRAINT IF EXISTS bookings_no_room_date_overlap;

ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_no_room_date_overlap
    EXCLUDE USING gist (
        room_id WITH =,
        daterange(check_in_date, check_out_date, '[)'::text) WITH &&
    ) WHERE (((status)::text = ANY (ARRAY[
        ('pending'::character varying)::text,
        ('pending_payment'::character varying)::text,
        ('pending_confirmation'::character varying)::text,
        ('confirmed'::character varying)::text,
        ('checked_in'::character varying)::text,
        ('auto_checked_in'::character varying)::text
    ])));

-- 3. Room-status trigger: replaced verbatim from the V1 baseline so a booking
--    in pending_payment / pending_confirmation also flips the room to reserved.
CREATE OR REPLACE FUNCTION public.sync_room_status_with_booking() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_current_room_status VARCHAR(20);
    v_next_status VARCHAR(20);
    v_has_other_current_stay BOOLEAN;
BEGIN
    -- Skip room status changes for back-dated stays that have already ended.
    IF NEW.check_out_date < CURRENT_DATE
       AND NEW.status IN ('checked_in', 'auto_checked_in', 'checked_out', 'completed') THEN
        RETURN NEW;
    END IF;

    SELECT status INTO v_current_room_status FROM rooms WHERE id = NEW.room_id;

    SELECT EXISTS (
        SELECT 1 FROM bookings
        WHERE room_id = NEW.room_id
          AND id != NEW.id
          AND status IN ('checked_in', 'auto_checked_in', 'late_checkout')
          AND check_in_date <= CURRENT_DATE
          AND check_out_date >= CURRENT_DATE
    ) INTO v_has_other_current_stay;

    IF NEW.status IN ('checked_in', 'auto_checked_in', 'late_checkout')
       AND v_current_room_status != 'occupied' THEN
        PERFORM update_room_status(NEW.room_id, 'occupied',
            'Guest checked in - Booking #' || NEW.id, NULL,
            NEW.check_in_date, NEW.check_out_date);

    ELSIF NEW.status IN ('checked_out', 'completed')
          AND v_current_room_status = 'occupied' THEN
        PERFORM update_room_status(NEW.room_id, 'dirty',
            'Guest checked out - Needs cleaning - Booking #' || NEW.id,
            NULL, CURRENT_TIMESTAMP, NULL);

    ELSIF NEW.status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')
          AND NOT v_has_other_current_stay
          AND v_current_room_status NOT IN ('maintenance', 'out_of_order', 'dirty', 'cleaning', 'reserved_dirty') THEN
        PERFORM update_room_status(NEW.room_id, 'reserved',
            CASE
                WHEN NEW.check_in_date::date = CURRENT_DATE
                    THEN 'Same-day reservation - Booking #' || NEW.id
                ELSE 'Future reservation - Booking #' || NEW.id
            END,
            NULL, NEW.check_in_date, NEW.check_out_date);

    ELSIF NEW.status IN ('no_show', 'voided')
          AND v_current_room_status IN ('occupied', 'reserved') THEN
        SELECT CASE
            WHEN EXISTS (
                SELECT 1 FROM bookings
                WHERE room_id = NEW.room_id
                  AND id != NEW.id
                  AND status IN ('checked_in', 'auto_checked_in', 'late_checkout')
                  AND check_in_date <= CURRENT_DATE
                  AND check_out_date >= CURRENT_DATE
            ) THEN 'occupied'
            WHEN EXISTS (
                SELECT 1 FROM bookings
                WHERE room_id = NEW.room_id
                  AND id != NEW.id
                  AND status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')
                  AND check_out_date > CURRENT_DATE
            ) THEN 'reserved'
            ELSE 'available'
        END INTO v_next_status;

        PERFORM update_room_status(NEW.room_id, v_next_status,
            'Booking no-show/voided - Booking #' || NEW.id, NULL, NULL, NULL);
    END IF;

    RETURN NEW;
END;
$$;

-- 4. Documentation.
COMMENT ON COLUMN public.bookings.status IS 'Booking status: pending_payment, pending_confirmation, confirmed, checked_in, checked_out, voided, no_show, completed, comp_void, partial_complimentary, fully_complimentary';

COMMIT;
