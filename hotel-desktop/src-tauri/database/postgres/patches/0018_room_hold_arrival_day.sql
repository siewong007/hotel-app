-- Hold a room for a reservation from its arrival day only.
--
-- Before this patch every room-holding booking marked its room reserved (or
-- reserved_dirty) at creation, whatever its check-in date, and a booking
-- created on an occupied room could leave it reading reserved. Staff then saw
-- rooms reserved for guests arriving days or months later. The room timeline
-- is the place for future stays; the room itself is held from the arrival day.
--
-- - reconcile_room_holds(room_id) is new: it recomputes the hold of one room
--   (or every active room) from today's arrivals, and never touches occupied,
--   cleaning, maintenance or out_of_order rooms.
-- - sync_room_status_with_booking() delegates reservation holds to it, so a
--   future booking no longer marks its room, and checkout keeps a room held
--   only for a guest arriving today.
-- - sync_all_room_statuses() counts a reservation only from its arrival day.
--
-- Fresh installs already carry these definitions from the V1 baseline; this
-- patch converges installed databases onto exactly those definitions. Each
-- function is replaced only when pg_get_functiondef matches the pre-0018 text
-- exactly (or it is missing, for the new function), is a no-op on the new
-- text, and raises on anything else. The constants are exact
-- pg_get_functiondef output, including its trailing newline.

DO $room_holds$
DECLARE
    found_definition text;
    reconcile_definition constant text := $fn_reconcile$CREATE OR REPLACE FUNCTION public.reconcile_room_holds(p_room_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(room_id bigint, room_number character varying, old_status character varying, new_status character varying)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_room RECORD;
    v_desired VARCHAR(20);
    v_in_house BOOLEAN;
    v_arrival_id BIGINT;
    v_arrival_in DATE;
    v_arrival_out DATE;
    v_reason TEXT;
BEGIN
    -- A reservation holds its room from its arrival day only. A room reads
    -- reserved (reserved_dirty while it still needs cleaning) when a
    -- room-holding booking has check_in_date <= CURRENT_DATE <= check_out_date;
    -- future stays stay on the timeline and never mark the room. Occupied,
    -- cleaning, maintenance and out_of_order rooms are never touched, except
    -- that an available or reserved room with a guest in house reads occupied.
    -- Idempotent: rooms already in the right state are skipped.
    FOR v_room IN
        SELECT r.id, r.room_number, r.status
        FROM public.rooms r
        WHERE r.is_active = true
          AND r.status IN ('available', 'reserved', 'dirty', 'reserved_dirty')
          AND (p_room_id IS NULL OR r.id = p_room_id)
        ORDER BY r.id
        FOR UPDATE OF r
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM public.bookings b
            WHERE b.room_id = v_room.id
              AND b.status IN ('checked_in', 'auto_checked_in', 'late_checkout')
              AND b.check_in_date <= CURRENT_DATE
              AND b.check_out_date >= CURRENT_DATE
        ) INTO v_in_house;

        v_arrival_id := NULL;
        v_arrival_in := NULL;
        v_arrival_out := NULL;
        SELECT b.id, b.check_in_date, b.check_out_date
          INTO v_arrival_id, v_arrival_in, v_arrival_out
          FROM public.bookings b
         WHERE b.room_id = v_room.id
           AND b.status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')
           AND b.check_in_date <= CURRENT_DATE
           AND b.check_out_date >= CURRENT_DATE
         ORDER BY b.check_in_date, b.id
         LIMIT 1;

        IF v_room.status IN ('available', 'reserved') AND v_in_house THEN
            v_desired := 'occupied';
            v_reason := 'Guest in house';
        ELSIF v_room.status IN ('available', 'reserved') THEN
            v_desired := CASE WHEN v_arrival_id IS NULL THEN 'available' ELSE 'reserved' END;
        ELSE
            v_desired := CASE WHEN v_arrival_id IS NULL THEN 'dirty' ELSE 'reserved_dirty' END;
        END IF;

        IF v_desired <> v_room.status THEN
            IF v_desired IN ('reserved', 'reserved_dirty') THEN
                v_reason := 'Arrival day - Booking #' || v_arrival_id;
            ELSIF v_desired IN ('available', 'dirty') THEN
                v_reason := 'No arrival today - reservation hold released';
            END IF;

            INSERT INTO public.room_status_change_log (room_id, from_status, to_status, trigger_source, booking_id, reason)
            VALUES (v_room.id, v_room.status, v_desired, 'reconcile_room_holds', v_arrival_id, v_reason);

            UPDATE public.rooms AS r
               SET status = v_desired,
                   status_notes = v_reason,
                   reserved_start_date = CASE WHEN v_desired IN ('reserved', 'reserved_dirty')
                       THEN v_arrival_in::timestamp AT TIME ZONE 'UTC' END,
                   reserved_end_date = CASE WHEN v_desired IN ('reserved', 'reserved_dirty')
                       THEN v_arrival_out::timestamp AT TIME ZONE 'UTC' END,
                   updated_at = CURRENT_TIMESTAMP
             WHERE r.id = v_room.id;

            room_id := v_room.id;
            room_number := v_room.room_number;
            old_status := v_room.status;
            new_status := v_desired;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$function$
$fn_reconcile$;
    trigger_current constant text := $fn_trigger_current$CREATE OR REPLACE FUNCTION public.sync_room_status_with_booking()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_current_room_status VARCHAR(20);
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
        -- A guest arriving today keeps the room held while it is cleaned.
        PERFORM reconcile_room_holds(NEW.room_id);

    ELSIF NEW.status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation') THEN
        -- A reservation holds its room from its arrival day only; future
        -- stays leave the room alone and never overwrite an in-house stay.
        PERFORM reconcile_room_holds(NEW.room_id);

    ELSIF NEW.status IN ('no_show', 'voided') THEN
        IF v_current_room_status = 'occupied' AND NOT v_has_other_current_stay THEN
            PERFORM update_room_status(NEW.room_id, 'available',
                'Booking no-show/voided - Booking #' || NEW.id, NULL, NULL, NULL);
        END IF;
        PERFORM reconcile_room_holds(NEW.room_id);
    END IF;

    RETURN NEW;
END;
$function$
$fn_trigger_current$;
    trigger_old constant text := $fn_trigger_old$CREATE OR REPLACE FUNCTION public.sync_room_status_with_booking()
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
$fn_trigger_old$;
    sync_all_current constant text := $fn_sync_all_current$CREATE OR REPLACE FUNCTION public.sync_all_room_statuses(p_user_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(room_id bigint, room_number character varying, old_status character varying, new_status character varying)
 LANGUAGE plpgsql
AS $function$
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
    -- (available, occupied, reserved) are recomputed. A reservation holds its
    -- room from its arrival day only, as in reconcile_room_holds().
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
               AND b.check_in_date <= CURRENT_DATE
               AND b.check_out_date >= CURRENT_DATE
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
$function$
$fn_sync_all_current$;
    sync_all_old constant text := $fn_sync_all_old$CREATE OR REPLACE FUNCTION public.sync_all_room_statuses(p_user_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(room_id bigint, room_number character varying, old_status character varying, new_status character varying)
 LANGUAGE plpgsql
AS $function$
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
$function$
$fn_sync_all_old$;
BEGIN
    SELECT pg_get_functiondef(routine_row.oid)
    INTO found_definition
    FROM pg_proc AS routine_row
    WHERE routine_row.oid = to_regprocedure('public.reconcile_room_holds(bigint)');

    IF found_definition IS NULL THEN
        EXECUTE reconcile_definition;
    ELSIF found_definition <> reconcile_definition THEN
        RAISE EXCEPTION 'reconcile_room_holds(bigint) has incompatible definition: %', found_definition;
    END IF;

    SELECT pg_get_functiondef(routine_row.oid)
    INTO found_definition
    FROM pg_proc AS routine_row
    WHERE routine_row.oid = to_regprocedure('public.sync_room_status_with_booking()');

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'sync_room_status_with_booking() has incompatible definition: <missing>';
    ELSIF found_definition = trigger_old THEN
        EXECUTE trigger_current;
    ELSIF found_definition <> trigger_current THEN
        RAISE EXCEPTION 'sync_room_status_with_booking() has incompatible definition: %', found_definition;
    END IF;

    SELECT pg_get_functiondef(routine_row.oid)
    INTO found_definition
    FROM pg_proc AS routine_row
    WHERE routine_row.oid = to_regprocedure('public.sync_all_room_statuses(bigint)');

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'sync_all_room_statuses(bigint) has incompatible definition: <missing>';
    ELSIF found_definition = sync_all_old THEN
        EXECUTE sync_all_current;
    ELSIF found_definition <> sync_all_current THEN
        RAISE EXCEPTION 'sync_all_room_statuses(bigint) has incompatible definition: %', found_definition;
    END IF;
END;
$room_holds$;

COMMENT ON FUNCTION public.reconcile_room_holds(p_room_id bigint) IS 'Recomputes the reservation hold of one room (or every active room when p_room_id is NULL): a room is reserved/reserved_dirty only on the arrival day of a room-holding booking, otherwise available/dirty. Occupied, cleaning, maintenance and out_of_order rooms are left alone. Returns the rooms it changed.';
