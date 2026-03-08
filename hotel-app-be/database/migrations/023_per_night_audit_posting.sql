-- Migration: 023_per_night_audit_posting.sql
-- Description: Fix night audit to post per-night charges instead of whole-booking totals.
-- Previously, a multi-night booking was posted once with total_amount, so extended stays
-- and subsequent nights were missed. Now each night is tracked individually.

-- Track which (booking, date) combinations have been posted
CREATE TABLE IF NOT EXISTS night_audit_posted_nights (
    id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    audit_date DATE NOT NULL,
    room_rate DECIMAL(10,2) NOT NULL,       -- nightly rate posted
    room_charge DECIMAL(10,2) NOT NULL,     -- room charge (before tax)
    service_tax DECIMAL(10,2) NOT NULL,     -- tax amount
    total_posted DECIMAL(10,2) NOT NULL,    -- total for this night (room_charge + tax)
    audit_run_id BIGINT REFERENCES night_audit_runs(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    posted_by BIGINT,
    CONSTRAINT unique_booking_night UNIQUE (booking_id, audit_date)
);

CREATE INDEX IF NOT EXISTS idx_posted_nights_booking ON night_audit_posted_nights(booking_id);
CREATE INDEX IF NOT EXISTS idx_posted_nights_date ON night_audit_posted_nights(audit_date);
CREATE INDEX IF NOT EXISTS idx_posted_nights_audit_run ON night_audit_posted_nights(audit_run_id);

COMMENT ON TABLE night_audit_posted_nights IS 'Tracks per-night posting for each booking. Each row = one night of room charges posted by night audit.';

-- Update the run_night_audit function to use per-night posting
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
    v_tax_rate DECIMAL(5, 4) := 0.08;
    v_room_charge DECIMAL(10, 2);
    v_service_tax DECIMAL(10, 2);
BEGIN
    -- Check if audit already run for this date
    IF EXISTS (SELECT 1 FROM night_audit_runs WHERE audit_date = p_audit_date AND status = 'completed') THEN
        RAISE EXCEPTION 'Night audit already completed for date %', p_audit_date;
    END IF;

    -- Read tax rate from system_settings
    BEGIN
        SELECT CAST(value AS DECIMAL) / 100.0 INTO v_tax_rate
        FROM system_settings WHERE key = 'service_tax_rate';
    EXCEPTION WHEN OTHERS THEN
        v_tax_rate := 0.08;
    END;

    -- Create audit run record
    INSERT INTO night_audit_runs (audit_date, run_by, status)
    VALUES (p_audit_date, p_user_id, 'in_progress')
    RETURNING id INTO v_audit_run_id;

    -- Post per-night charges for all active bookings on this date
    -- that haven't had this specific night posted yet
    FOR v_booking IN
        SELECT b.id, b.booking_number, b.status, b.room_rate, b.total_amount,
               b.check_in_date, b.check_out_date, b.guest_id, b.room_id
        FROM bookings b
        WHERE b.status NOT IN ('pending', 'confirmed', 'cancelled', 'no_show', 'voided')
        AND b.check_in_date <= p_audit_date
        AND b.check_out_date > p_audit_date
        -- This specific night hasn't been posted yet
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = p_audit_date
        )
    LOOP
        -- Calculate per-night charges
        v_room_charge := ROUND(v_booking.room_rate / (1 + v_tax_rate), 2);
        v_service_tax := v_booking.room_rate - v_room_charge;

        -- Record this night as posted
        INSERT INTO night_audit_posted_nights
            (booking_id, audit_date, room_rate, room_charge, service_tax, total_posted, audit_run_id, posted_by)
        VALUES
            (v_booking.id, p_audit_date, v_booking.room_rate, v_room_charge, v_service_tax, v_booking.room_rate, v_audit_run_id, p_user_id);

        -- Record in audit details
        INSERT INTO night_audit_details (audit_run_id, booking_id, record_type, action, data)
        VALUES (v_audit_run_id, v_booking.id, 'booking', 'night_posted',
            jsonb_build_object(
                'status', v_booking.status,
                'room_rate', v_booking.room_rate,
                'night_date', p_audit_date,
                'room_charge', v_room_charge,
                'service_tax', v_service_tax,
                'check_in_date', v_booking.check_in_date,
                'check_out_date', v_booking.check_out_date
            )
        );

        v_bookings_posted := v_bookings_posted + 1;
        v_revenue := v_revenue + v_booking.room_rate;
    END LOOP;

    -- Also handle checked_out bookings for same-day checkout (hourly stays)
    FOR v_booking IN
        SELECT b.id, b.booking_number, b.status, b.room_rate, b.total_amount,
               b.check_in_date, b.check_out_date, b.guest_id, b.room_id
        FROM bookings b
        WHERE b.status = 'checked_out'
        AND b.check_in_date = p_audit_date
        AND b.check_out_date = p_audit_date
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = p_audit_date
        )
    LOOP
        v_room_charge := ROUND(v_booking.room_rate / (1 + v_tax_rate), 2);
        v_service_tax := v_booking.room_rate - v_room_charge;

        INSERT INTO night_audit_posted_nights
            (booking_id, audit_date, room_rate, room_charge, service_tax, total_posted, audit_run_id, posted_by)
        VALUES
            (v_booking.id, p_audit_date, v_booking.room_rate, v_room_charge, v_service_tax, v_booking.room_rate, v_audit_run_id, p_user_id);

        INSERT INTO night_audit_details (audit_run_id, booking_id, record_type, action, data)
        VALUES (v_audit_run_id, v_booking.id, 'booking', 'night_posted',
            jsonb_build_object(
                'status', v_booking.status,
                'room_rate', v_booking.room_rate,
                'night_date', p_audit_date,
                'check_in_date', v_booking.check_in_date,
                'check_out_date', v_booking.check_out_date
            )
        );

        v_bookings_posted := v_bookings_posted + 1;
        v_revenue := v_revenue + v_booking.room_rate;
        v_checkouts := v_checkouts + 1;
    END LOOP;

    -- Count today's check-ins and check-outs
    SELECT COUNT(*) INTO v_checkins FROM bookings
    WHERE status IN ('checked_in', 'auto_checked_in') AND check_in_date = p_audit_date;

    SELECT COUNT(*) INTO v_checkouts FROM bookings
    WHERE status = 'checked_out' AND check_out_date = p_audit_date;

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

COMMENT ON FUNCTION run_night_audit(DATE, BIGINT) IS
    'Runs night audit for a given date. Posts per-night room charges for all active bookings '
    'on the audit date that have not yet been posted for that specific night. Uses room_rate '
    '(nightly rate) instead of total_amount. Handles multi-night stays, extensions, and '
    'same-day hourly checkouts.';
