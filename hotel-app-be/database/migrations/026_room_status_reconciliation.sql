-- Keep denormalized room status in step with booking state.
--
-- Confirmed same-day reservations should reserve a room, not mark it occupied.
-- Occupied is reserved for actual checked-in stays. This prevents a later room
-- move from leaving a stale occupied status behind when the only remaining
-- bookings are future reservations.

CREATE OR REPLACE FUNCTION sync_room_status_with_booking() RETURNS TRIGGER AS $$
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
          AND v_current_room_status NOT IN ('maintenance', 'out_of_order', 'dirty', 'cleaning') THEN
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
$$ LANGUAGE plpgsql;
