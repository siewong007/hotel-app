-- Migration: Add booking history tracking
-- Version: 002
-- Description: Tracks booking status changes over time

-- Booking history table
CREATE TABLE IF NOT EXISTS booking_history (
    id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT REFERENCES bookings(id) ON DELETE CASCADE NOT NULL,
    status VARCHAR(20) NOT NULL,
    changed_by BIGINT REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for booking history
CREATE INDEX IF NOT EXISTS idx_booking_history_booking_id ON booking_history(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_history_created_at ON booking_history(created_at);

-- Function to track booking status changes
CREATE OR REPLACE FUNCTION track_booking_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO booking_history (booking_id, status, changed_by, notes)
        VALUES (NEW.id, NEW.status, current_setting('app.user_id', true)::BIGINT, 
                'Status changed from ' || OLD.status || ' to ' || NEW.status);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to track booking status changes
DROP TRIGGER IF EXISTS track_booking_status ON bookings;
CREATE TRIGGER track_booking_status
    AFTER UPDATE OF status ON bookings
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION track_booking_status_change();

