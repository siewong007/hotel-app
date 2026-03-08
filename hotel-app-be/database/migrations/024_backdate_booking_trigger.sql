-- Allow back-dated bookings (company ledger) to skip room status changes
-- When check_out_date is in the past, the stay already happened so room status should not change.

CREATE OR REPLACE FUNCTION sync_room_status_with_booking() RETURNS TRIGGER AS $$
DECLARE
    v_current_room_status VARCHAR(20);
    v_has_other_active_bookings BOOLEAN;
    v_has_upcoming_reservation BOOLEAN;
BEGIN
    -- Skip room status changes for back-dated bookings (check-out already passed)
    IF NEW.check_out_date < CURRENT_DATE AND NEW.status IN ('checked_in', 'checked_out') THEN
        RETURN NEW;
    END IF;

    SELECT status INTO v_current_room_status FROM rooms WHERE id = NEW.room_id;
    SELECT EXISTS (
        SELECT 1 FROM bookings
        WHERE room_id = NEW.room_id AND id != NEW.id
          AND status IN ('confirmed', 'pending', 'checked_in')
          AND check_out_date >= CURRENT_DATE
    ) INTO v_has_other_active_bookings;

    -- checked_in -> occupied
    IF NEW.status = 'checked_in' AND v_current_room_status NOT IN ('occupied') THEN
        PERFORM update_room_status(NEW.room_id, 'occupied',
            'Guest checked in - Booking #' || NEW.id, NULL,
            NEW.check_in_date, NEW.check_out_date);

    -- checked_out -> reserved (if upcoming booking) or dirty
    ELSIF NEW.status = 'checked_out' AND v_current_room_status = 'occupied' THEN
        SELECT EXISTS (
            SELECT 1 FROM bookings
            WHERE room_id = NEW.room_id
              AND id != NEW.id
              AND status IN ('confirmed', 'pending')
              AND check_in_date >= CURRENT_DATE
        ) INTO v_has_upcoming_reservation;

        IF v_has_upcoming_reservation THEN
            PERFORM update_room_status(NEW.room_id, 'reserved',
                'Guest checked out - Upcoming reservation - Booking #' || NEW.id,
                NULL, NULL, NULL);
        ELSE
            PERFORM update_room_status(NEW.room_id, 'dirty',
                'Guest checked out - Needs cleaning - Booking #' || NEW.id,
                NULL, CURRENT_TIMESTAMP, NULL);
        END IF;

    -- same-day booking -> occupied
    ELSIF NEW.status IN ('confirmed', 'pending')
        AND v_current_room_status IN ('available', 'reserved')
        AND NEW.check_in_date::date = CURRENT_DATE THEN
        PERFORM update_room_status(NEW.room_id, 'occupied',
            'Same-day booking - Guest arriving today - Booking #' || NEW.id,
            NULL, NEW.check_in_date, NEW.check_out_date);

    -- future booking -> reserved
    ELSIF NEW.status IN ('confirmed', 'pending')
        AND v_current_room_status = 'available'
        AND NEW.check_in_date::date > CURRENT_DATE THEN
        PERFORM update_room_status(NEW.room_id, 'reserved',
            'Future reservation - Booking #' || NEW.id, NULL,
            NEW.check_in_date, NEW.check_out_date);

    -- cancelled/no_show/voided -> available (if no other active bookings)
    ELSIF NEW.status IN ('cancelled', 'no_show', 'voided')
        AND v_current_room_status IN ('occupied', 'reserved')
        AND NOT v_has_other_active_bookings THEN
        PERFORM update_room_status(NEW.room_id, 'available',
            'Booking cancelled/no-show/voided - Booking #' || NEW.id, NULL, NULL, NULL);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_room_status_booking ON bookings;
CREATE TRIGGER trg_sync_room_status_booking
    AFTER INSERT OR UPDATE OF status, check_in_date
    ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION sync_room_status_with_booking();
