-- Migration: Fix run_night_audit to exclude pending and confirmed bookings from being posted

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
    -- Check if audit already run for this date
    IF EXISTS (SELECT 1 FROM night_audit_runs WHERE audit_date = p_audit_date AND status = 'completed') THEN
        RAISE EXCEPTION 'Night audit already completed for date %', p_audit_date;
    END IF;

    -- Create audit run record
    INSERT INTO night_audit_runs (audit_date, run_by, status)
    VALUES (p_audit_date, p_user_id, 'in_progress')
    RETURNING id INTO v_audit_run_id;

    -- Post all unposted bookings for this date, excluding pending/confirmed/cancelled/no_show
    FOR v_booking IN
        SELECT b.id, b.status, b.total_amount, b.check_in_date, b.check_out_date
        FROM bookings b
        WHERE b.is_posted = FALSE
        AND b.status NOT IN ('pending', 'confirmed', 'cancelled', 'no_show', 'voided')
        AND (
            (b.check_in_date <= p_audit_date AND b.check_out_date > p_audit_date)
            OR (b.status = 'checked_out' AND b.check_in_date <= p_audit_date AND b.check_out_date >= p_audit_date)
        )
    LOOP
        -- Update booking as posted
        UPDATE bookings
        SET is_posted = TRUE,
            posted_date = p_audit_date,
            posted_at = NOW(),
            posted_by = p_user_id
        WHERE id = v_booking.id;

        -- Record the posting detail
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

        IF v_booking.status IN ('checked_in', 'auto_checked_in') THEN
            v_checkins := v_checkins + 1;
            v_revenue := v_revenue + COALESCE(v_booking.total_amount, 0);
        ELSIF v_booking.status = 'checked_out' AND v_booking.check_out_date = p_audit_date THEN
            v_checkouts := v_checkouts + 1;
            v_revenue := v_revenue + COALESCE(v_booking.total_amount, 0);
        END IF;
    END LOOP;

    -- Get room statistics
    SELECT COUNT(*) INTO v_total_rooms FROM rooms;

    SELECT
        COUNT(*) FILTER (WHERE status = 'available' OR status = 'clean'),
        COUNT(*) FILTER (WHERE status = 'occupied'),
        COUNT(*) FILTER (WHERE status = 'reserved'),
        COUNT(*) FILTER (WHERE status IN ('maintenance', 'out_of_order')),
        COUNT(*) FILTER (WHERE status = 'dirty' OR status = 'cleaning')
    INTO v_rooms_available, v_rooms_occupied, v_rooms_reserved, v_rooms_maintenance, v_rooms_dirty
    FROM rooms;

    -- Also count rooms with checked_in bookings as occupied
    SELECT COUNT(DISTINCT r.id) INTO v_rooms_occupied
    FROM rooms r
    JOIN bookings b ON r.id = b.room_id
    WHERE b.status IN ('checked_in', 'auto_checked_in')
    AND b.check_in_date <= p_audit_date
    AND b.check_out_date > p_audit_date;

    -- Calculate occupancy rate
    IF v_total_rooms > 0 THEN
        v_occupancy_rate := ROUND((v_rooms_occupied::DECIMAL / v_total_rooms) * 100, 2);
    END IF;

    -- Update audit run with results
    UPDATE night_audit_runs
    SET status = 'completed',
        total_bookings_posted = v_bookings_posted,
        total_checkins = v_checkins,
        total_checkouts = v_checkouts,
        total_revenue = v_revenue,
        occupancy_rate = v_occupancy_rate,
        rooms_available = v_rooms_available,
        rooms_occupied = v_rooms_occupied,
        rooms_reserved = v_rooms_reserved,
        rooms_maintenance = v_rooms_maintenance,
        rooms_dirty = v_rooms_dirty,
        run_at = NOW()
    WHERE id = v_audit_run_id;

    RETURN v_audit_run_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION run_night_audit(DATE, BIGINT) IS 'Runs night audit for a given date. Only posts checked_in, auto_checked_in, and checked_out bookings - excludes pending, confirmed, cancelled, and no_show.';
