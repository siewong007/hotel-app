-- Migration: Update room status sync to handle same-day bookings
-- When a booking is created with check_in_date = TODAY, set room to 'occupied'

-- Drop and recreate the trigger function with updated logic
CREATE OR REPLACE FUNCTION sync_room_status_with_booking() RETURNS TRIGGER AS $$
DECLARE
    v_current_room_status VARCHAR(20);
    v_has_other_active_bookings BOOLEAN;
BEGIN
    SELECT status INTO v_current_room_status FROM rooms WHERE id = NEW.room_id;
    SELECT EXISTS (SELECT 1 FROM bookings WHERE room_id = NEW.room_id AND id != NEW.id
        AND status IN ('confirmed', 'pending', 'checked_in') AND check_out_date >= CURRENT_DATE) INTO v_has_other_active_bookings;

    -- When booking is checked_in: room -> occupied
    IF NEW.status = 'checked_in' AND v_current_room_status NOT IN ('occupied') THEN
        PERFORM update_room_status(NEW.room_id, 'occupied', 'Guest checked in - Booking #' || NEW.id, NULL, NEW.check_in_date, NEW.check_out_date);

    -- When booking is checked_out: room -> dirty
    ELSIF NEW.status = 'checked_out' AND v_current_room_status = 'occupied' THEN
        PERFORM update_room_status(NEW.room_id, 'dirty', 'Guest checked out - Needs cleaning - Booking #' || NEW.id, NULL, CURRENT_TIMESTAMP, NULL);

    -- NEW: When booking is confirmed/pending AND check_in = TODAY: room -> occupied
    -- This handles same-day bookings where guest is expected to arrive today
    ELSIF NEW.status IN ('confirmed', 'pending') AND v_current_room_status IN ('available', 'reserved') AND NEW.check_in_date::date = CURRENT_DATE THEN
        PERFORM update_room_status(NEW.room_id, 'occupied', 'Same-day booking - Guest arriving today - Booking #' || NEW.id, NULL, NEW.check_in_date, NEW.check_out_date);

    -- When booking is confirmed/pending AND check_in > TODAY: room -> reserved (future reservation)
    ELSIF NEW.status IN ('confirmed', 'pending') AND v_current_room_status = 'available' AND NEW.check_in_date::date > CURRENT_DATE THEN
        PERFORM update_room_status(NEW.room_id, 'reserved', 'Future reservation - Booking #' || NEW.id, NULL, NEW.check_in_date, NEW.check_out_date);

    -- When booking is cancelled/no_show: room -> available (if no other active bookings)
    ELSIF NEW.status IN ('cancelled', 'no_show') AND v_current_room_status IN ('occupied', 'reserved') AND NOT v_has_other_active_bookings THEN
        PERFORM update_room_status(NEW.room_id, 'available', 'Booking cancelled/no-show - Booking #' || NEW.id, NULL, NULL, NULL);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger (it uses the updated function automatically)
DROP TRIGGER IF EXISTS trg_sync_room_status_booking ON bookings;
CREATE TRIGGER trg_sync_room_status_booking
    AFTER INSERT OR UPDATE OF status, check_in_date
    ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION sync_room_status_with_booking();

-- Also create a function to update existing bookings with today's check-in date
-- This can be called manually or via a scheduled job
CREATE OR REPLACE FUNCTION update_rooms_for_todays_checkins() RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    v_booking RECORD;
BEGIN
    -- Find all confirmed/pending bookings with check_in_date = today where room is not yet occupied
    FOR v_booking IN
        SELECT b.id, b.room_id, b.check_in_date, b.check_out_date
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        WHERE b.check_in_date = CURRENT_DATE
        AND b.status IN ('confirmed', 'pending')
        AND r.status NOT IN ('occupied', 'maintenance', 'out_of_order')
    LOOP
        PERFORM update_room_status(
            v_booking.room_id,
            'occupied',
            'Same-day booking - Guest arriving today - Booking #' || v_booking.id,
            NULL,
            v_booking.check_in_date,
            v_booking.check_out_date
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_rooms_for_todays_checkins() IS 'Updates room status to occupied for all bookings with check_in_date = today. Can be called at midnight or when needed.';
