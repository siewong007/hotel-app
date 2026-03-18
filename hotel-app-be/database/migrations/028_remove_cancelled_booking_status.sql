-- ============================================================================
-- MIGRATION 028: REMOVE CANCELLED BOOKING STATUS
-- ============================================================================
-- Description: Remove 'cancelled' and 'comp_cancelled' booking statuses.
--              Delete all bookings with those statuses.
--              Cancel action now uses 'voided' status instead.
-- ============================================================================

-- Step 1: Delete all bookings with cancelled or comp_cancelled status
DELETE FROM bookings WHERE status IN ('cancelled', 'comp_cancelled');

-- Step 2: Drop and recreate the status constraint without cancelled/comp_cancelled
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
    'pending', 'confirmed', 'checked_in', 'checked_out',
    'no_show', 'completed',
    'partial_complimentary', 'fully_complimentary', 'voided'
));

-- Step 3: Update the room sync trigger to remove cancelled references
CREATE OR REPLACE FUNCTION sync_room_status_with_booking() RETURNS TRIGGER AS $$
DECLARE
    v_current_room_status VARCHAR(20);
    v_has_other_active_bookings BOOLEAN;
    v_has_upcoming_reservation BOOLEAN;
BEGIN
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

    -- no_show/voided -> available (if no other active bookings)
    ELSIF NEW.status IN ('no_show', 'voided')
        AND v_current_room_status IN ('occupied', 'reserved')
        AND NOT v_has_other_active_bookings THEN
        PERFORM update_room_status(NEW.room_id, 'available',
            'Booking no-show/voided - Booking #' || NEW.id, NULL, NULL, NULL);
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

-- Step 4: Update revenue_summary view to exclude voided instead of cancelled
CREATE OR REPLACE VIEW revenue_summary AS
SELECT date_trunc('month', b.check_in_date) as month, COUNT(*) as total_bookings,
    SUM(b.total_amount) as total_revenue, SUM(b.subtotal) as room_revenue, SUM(b.tax_amount) as tax_collected,
    AVG(b.total_amount) as average_booking_value,
    SUM(CASE WHEN b.payment_status = 'paid' THEN b.total_amount ELSE 0 END) as collected_revenue
FROM bookings b WHERE b.status NOT IN ('voided', 'no_show')
GROUP BY date_trunc('month', b.check_in_date) ORDER BY month DESC;

-- Step 5: Update night audit functions to use voided instead of cancelled
CREATE OR REPLACE FUNCTION get_unposted_bookings(p_audit_date DATE)
RETURNS TABLE (
    booking_id BIGINT,
    booking_number VARCHAR,
    guest_name TEXT,
    room_number VARCHAR,
    check_in_date DATE,
    check_out_date DATE,
    status VARCHAR,
    total_amount DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id as booking_id,
        b.booking_number,
        g.first_name || ' ' || g.last_name as guest_name,
        r.room_number,
        b.check_in_date,
        b.check_out_date,
        b.status,
        b.total_amount
    FROM bookings b
    JOIN guests g ON b.guest_id = g.id
    JOIN rooms r ON b.room_id = r.id
    WHERE b.is_posted = FALSE
    AND (
        (b.check_in_date <= p_audit_date AND b.check_out_date > p_audit_date)
        OR (b.check_out_date = p_audit_date AND b.status = 'checked_out')
        OR (DATE(b.created_at) = p_audit_date OR DATE(b.updated_at) = p_audit_date)
    )
    AND b.status NOT IN ('voided', 'no_show', 'confirmed', 'pending')
    ORDER BY b.check_in_date;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION run_night_audit(
    p_audit_date DATE,
    p_user_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
    v_audit_run_id BIGINT;
    v_bookings_posted INTEGER := 0;
    v_checkins INTEGER := 0;
    v_checkouts INTEGER := 0;
    v_revenue DECIMAL(12, 2) := 0;
    v_rooms_occupied INTEGER := 0;
    v_rooms_available INTEGER := 0;
    v_rooms_reserved INTEGER := 0;
    v_rooms_maintenance INTEGER := 0;
    v_rooms_dirty INTEGER := 0;
    v_total_rooms INTEGER := 0;
    v_occupancy_rate DECIMAL(5, 2) := 0;
    v_booking RECORD;
BEGIN
    INSERT INTO night_audit_runs (audit_date, run_by, status)
    VALUES (p_audit_date, p_user_id, 'in_progress')
    RETURNING id INTO v_audit_run_id;

    FOR v_booking IN
        SELECT b.id, b.status, b.total_amount, b.check_in_date, b.check_out_date
        FROM bookings b
        WHERE b.is_posted = FALSE
        AND b.status NOT IN ('pending', 'confirmed', 'voided', 'no_show')
        AND (
            (b.status IN ('checked_in', 'auto_checked_in') AND b.check_in_date <= p_audit_date AND b.check_out_date > p_audit_date)
            OR (b.status = 'checked_out' AND b.check_in_date = p_audit_date)
        )
    LOOP
        UPDATE bookings
        SET is_posted = TRUE,
            posted_date = p_audit_date,
            posted_at = NOW(),
            posted_by = p_user_id
        WHERE id = v_booking.id;

        INSERT INTO night_audit_details (audit_run_id, booking_id, record_type, action, data)
        VALUES (v_audit_run_id, v_booking.id, 'booking', 'posted',
            jsonb_build_object(
                'status', v_booking.status,
                'total_amount', v_booking.total_amount,
                'check_in_date', v_booking.check_in_date,
                'check_out_date', v_booking.check_out_date
            )
        );

        v_bookings_posted := v_bookings_posted + 1;

        IF v_booking.status = 'checked_in' THEN
            v_checkins := v_checkins + 1;
            v_revenue := v_revenue + COALESCE(v_booking.total_amount, 0);
        ELSIF v_booking.status = 'checked_out' AND v_booking.check_out_date = p_audit_date THEN
            v_checkouts := v_checkouts + 1;
        END IF;
    END LOOP;

    SELECT COUNT(*) INTO v_total_rooms FROM rooms;

    SELECT
        COUNT(*) FILTER (WHERE status = 'available' OR status = 'clean'),
        COUNT(*) FILTER (WHERE status = 'occupied'),
        COUNT(*) FILTER (WHERE status = 'reserved'),
        COUNT(*) FILTER (WHERE status IN ('maintenance', 'out_of_order')),
        COUNT(*) FILTER (WHERE status = 'dirty' OR status = 'cleaning')
    INTO v_rooms_available, v_rooms_occupied, v_rooms_reserved, v_rooms_maintenance, v_rooms_dirty
    FROM rooms;

    SELECT COUNT(DISTINCT r.id) INTO v_rooms_occupied
    FROM rooms r
    JOIN bookings b ON r.id = b.room_id
    WHERE b.status = 'checked_in'
    AND b.check_in_date <= p_audit_date
    AND b.check_out_date > p_audit_date;

    IF v_total_rooms > 0 THEN
        v_occupancy_rate := (v_rooms_occupied::DECIMAL / v_total_rooms) * 100;
    END IF;

    UPDATE rooms
    SET last_posted_status = status, last_posted_date = p_audit_date;

    UPDATE night_audit_runs
    SET status = 'completed',
        total_bookings_posted = v_bookings_posted,
        total_checkins = v_checkins,
        total_checkouts = v_checkouts,
        total_revenue = v_revenue,
        total_rooms_occupied = v_rooms_occupied,
        total_rooms_available = v_rooms_available,
        occupancy_rate = v_occupancy_rate,
        rooms_available = v_rooms_available,
        rooms_occupied = v_rooms_occupied,
        rooms_reserved = v_rooms_reserved,
        rooms_maintenance = v_rooms_maintenance,
        rooms_dirty = v_rooms_dirty
    WHERE id = v_audit_run_id;

    RETURN v_audit_run_id;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Update booking status comment
COMMENT ON COLUMN bookings.status IS 'Booking status: pending, confirmed, checked_in, checked_out, no_show, completed, partial_complimentary, fully_complimentary, voided';
