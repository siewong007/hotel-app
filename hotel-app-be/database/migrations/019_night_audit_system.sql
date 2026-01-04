-- Migration: Night Audit Posting System
-- This migration adds support for the night audit process where daily data
-- is "posted" and becomes the permanent record for reporting purposes.

-- 1. Add posted fields to bookings table
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS is_posted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS posted_date DATE,
ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS posted_by BIGINT REFERENCES users(id);

-- 2. Create night_audit_runs table to track audit history
CREATE TABLE IF NOT EXISTS night_audit_runs (
    id BIGSERIAL PRIMARY KEY,
    audit_date DATE NOT NULL UNIQUE,  -- The business date being audited
    run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_by BIGINT REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'completed',  -- completed, failed, rolled_back

    -- Statistics captured during the audit
    total_bookings_posted INTEGER DEFAULT 0,
    total_checkins INTEGER DEFAULT 0,
    total_checkouts INTEGER DEFAULT 0,
    total_revenue DECIMAL(12, 2) DEFAULT 0,
    total_rooms_occupied INTEGER DEFAULT 0,
    total_rooms_available INTEGER DEFAULT 0,
    occupancy_rate DECIMAL(5, 2) DEFAULT 0,

    -- Room status snapshot
    rooms_available INTEGER DEFAULT 0,
    rooms_occupied INTEGER DEFAULT 0,
    rooms_reserved INTEGER DEFAULT 0,
    rooms_maintenance INTEGER DEFAULT 0,
    rooms_dirty INTEGER DEFAULT 0,

    notes TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create night_audit_details table for detailed posting records
CREATE TABLE IF NOT EXISTS night_audit_details (
    id BIGSERIAL PRIMARY KEY,
    audit_run_id BIGINT NOT NULL REFERENCES night_audit_runs(id) ON DELETE CASCADE,
    booking_id BIGINT REFERENCES bookings(id),
    room_id BIGINT REFERENCES rooms(id),

    record_type VARCHAR(50) NOT NULL,  -- booking, room_status, revenue, etc.
    action VARCHAR(50) NOT NULL,       -- posted, checked_in, checked_out, etc.

    -- Snapshot of data at time of posting
    data JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_bookings_is_posted ON bookings(is_posted);
CREATE INDEX IF NOT EXISTS idx_bookings_posted_date ON bookings(posted_date);
CREATE INDEX IF NOT EXISTS idx_night_audit_runs_audit_date ON night_audit_runs(audit_date DESC);
CREATE INDEX IF NOT EXISTS idx_night_audit_details_audit_run_id ON night_audit_details(audit_run_id);
CREATE INDEX IF NOT EXISTS idx_night_audit_details_booking_id ON night_audit_details(booking_id);

-- 5. Add room status snapshot fields
ALTER TABLE rooms
ADD COLUMN IF NOT EXISTS last_posted_status VARCHAR(50),
ADD COLUMN IF NOT EXISTS last_posted_date DATE;

-- 6. Create function to get unposted bookings for a date
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
        -- Bookings that are active on the audit date
        (b.check_in_date <= p_audit_date AND b.check_out_date > p_audit_date)
        OR
        -- Bookings that checked out on the audit date
        (b.check_out_date = p_audit_date AND b.status = 'checked_out')
        OR
        -- Bookings that were created/modified on the audit date
        (DATE(b.created_at) = p_audit_date OR DATE(b.updated_at) = p_audit_date)
    )
    AND b.status NOT IN ('cancelled', 'no_show')
    ORDER BY b.check_in_date;
END;
$$ LANGUAGE plpgsql;

-- 7. Create function to run night audit
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

    -- Post all unposted bookings for this date
    FOR v_booking IN
        SELECT b.id, b.status, b.total_amount, b.check_in_date, b.check_out_date
        FROM bookings b
        WHERE b.is_posted = FALSE
        AND (
            (b.check_in_date <= p_audit_date AND b.check_out_date > p_audit_date)
            OR (b.check_out_date = p_audit_date AND b.status = 'checked_out')
            OR (DATE(b.created_at) = p_audit_date)
        )
        AND b.status NOT IN ('cancelled', 'no_show')
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

        IF v_booking.status = 'checked_in' THEN
            v_checkins := v_checkins + 1;
            v_revenue := v_revenue + COALESCE(v_booking.total_amount, 0);
        ELSIF v_booking.status = 'checked_out' AND v_booking.check_out_date = p_audit_date THEN
            v_checkouts := v_checkouts + 1;
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
    WHERE b.status = 'checked_in'
    AND b.check_in_date <= p_audit_date
    AND b.check_out_date > p_audit_date;

    -- Calculate occupancy rate
    IF v_total_rooms > 0 THEN
        v_occupancy_rate := (v_rooms_occupied::DECIMAL / v_total_rooms) * 100;
    END IF;

    -- Update room posted status
    UPDATE rooms
    SET last_posted_status = status, last_posted_date = p_audit_date;

    -- Update audit run with statistics
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

-- 8. Create view for night audit summary
CREATE OR REPLACE VIEW night_audit_summary AS
SELECT
    nar.id,
    nar.audit_date,
    nar.run_at,
    u.username as run_by_username,
    nar.status,
    nar.total_bookings_posted,
    nar.total_checkins,
    nar.total_checkouts,
    nar.total_revenue,
    nar.occupancy_rate,
    nar.rooms_available,
    nar.rooms_occupied,
    nar.rooms_reserved,
    nar.rooms_maintenance,
    nar.rooms_dirty,
    nar.notes,
    nar.created_at
FROM night_audit_runs nar
LEFT JOIN users u ON nar.run_by = u.id
ORDER BY nar.audit_date DESC;

COMMENT ON TABLE night_audit_runs IS 'Tracks each night audit run with statistics';
COMMENT ON TABLE night_audit_details IS 'Detailed records of what was posted in each audit';
COMMENT ON COLUMN bookings.is_posted IS 'Whether this booking has been included in a night audit';
COMMENT ON COLUMN bookings.posted_date IS 'The business date when this booking was posted';
