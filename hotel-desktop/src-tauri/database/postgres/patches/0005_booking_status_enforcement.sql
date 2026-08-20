-- Booking-status enforcement convergence.
--
-- Patch 1.4 widened bookings_status_check to accept 'pending_payment' and
-- 'pending_confirmation', but two other objects encode the same status list and
-- were left in their pre-vocabulary shape on installed databases:
--
--   * bookings_no_room_date_overlap -- the EXCLUDE constraint that prevents two
--     bookings from holding the same room over overlapping dates. With the old
--     predicate the two pending statuses fall outside the constraint, so the
--     database no longer refuses a double booking that the application believes
--     it has prevented.
--   * sync_room_status_with_booking() -- the trigger that reserves and releases
--     rooms. With the old status lists a booking in either pending status never
--     moves the room to 'reserved', and never holds it when a competing booking
--     is voided or no-showed.
--
-- Fresh installs already carry both current definitions from the V1 baseline;
-- this patch converges installed databases onto exactly those definitions.
--
-- Both replacements are driven from the recorded current definition text rather
-- than from hand-written DDL, so a patched database reproduces the baseline
-- rendering byte for byte instead of drifting on spelling. The constants are
-- exact pg_get_constraintdef / pg_get_functiondef output, including the trailing
-- newline pg_get_functiondef emits, because the guards compare them literally.
--
-- Rebuilding the exclusion constraint rebuilds its GiST index under an ACCESS
-- EXCLUSIVE lock on public.bookings, so run this in a maintenance window on a
-- large table. If existing rows already double-book a room in one of the two
-- pending statuses, ADD CONSTRAINT fails and the whole patch rolls back: that
-- conflict is real data that has to be resolved before the guard can be
-- restored.

DO $overlap$
DECLARE
    found_definition text;
    current_definition constant text := $overlap_current$EXCLUDE USING gist (room_id WITH =, daterange(check_in_date, check_out_date, '[)'::text) WITH &&) WHERE (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('pending_payment'::character varying)::text, ('pending_confirmation'::character varying)::text, ('confirmed'::character varying)::text, ('checked_in'::character varying)::text, ('auto_checked_in'::character varying)::text])))$overlap_current$;
    old_definition constant text := $overlap_old$EXCLUDE USING gist (room_id WITH =, daterange(check_in_date, check_out_date, '[)'::text) WITH &&) WHERE (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('confirmed'::character varying)::text, ('checked_in'::character varying)::text, ('auto_checked_in'::character varying)::text])))$overlap_old$;
BEGIN
    SELECT pg_get_constraintdef(constraint_row.oid)
    INTO found_definition
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
    WHERE schema_row.nspname = 'public'
      AND table_row.relname = 'bookings'
      AND constraint_row.conname = 'bookings_no_room_date_overlap';

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'bookings_no_room_date_overlap has incompatible definition: <missing>';
    ELSIF found_definition = old_definition THEN
        EXECUTE 'ALTER TABLE public.bookings DROP CONSTRAINT bookings_no_room_date_overlap';
        EXECUTE 'ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_room_date_overlap '
            || current_definition;
    ELSIF found_definition <> current_definition THEN
        RAISE EXCEPTION 'bookings_no_room_date_overlap has incompatible definition: %', found_definition;
    END IF;
END;
$overlap$;

DO $room_sync$
DECLARE
    found_definition text;
    current_definition constant text := $fn_current$CREATE OR REPLACE FUNCTION public.sync_room_status_with_booking()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$
$fn_current$;
    old_definition constant text := $fn_old$CREATE OR REPLACE FUNCTION public.sync_room_status_with_booking()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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

    ELSIF NEW.status IN ('confirmed', 'pending')
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
                  AND status IN ('confirmed', 'pending')
                  AND check_out_date > CURRENT_DATE
            ) THEN 'reserved'
            ELSE 'available'
        END INTO v_next_status;

        PERFORM update_room_status(NEW.room_id, v_next_status,
            'Booking no-show/voided - Booking #' || NEW.id, NULL, NULL, NULL);
    END IF;

    RETURN NEW;
END;
$function$
$fn_old$;
BEGIN
    SELECT pg_get_functiondef(routine_row.oid)
    INTO found_definition
    FROM pg_proc AS routine_row
    JOIN pg_namespace AS schema_row ON schema_row.oid = routine_row.pronamespace
    WHERE schema_row.nspname = 'public'
      AND routine_row.proname = 'sync_room_status_with_booking'
      AND routine_row.pronargs = 0;

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'sync_room_status_with_booking() has incompatible definition: <missing>';
    ELSIF found_definition = old_definition THEN
        EXECUTE current_definition;
    ELSIF found_definition <> current_definition THEN
        RAISE EXCEPTION 'sync_room_status_with_booking() has incompatible definition: %', found_definition;
    END IF;
END;
$room_sync$;
