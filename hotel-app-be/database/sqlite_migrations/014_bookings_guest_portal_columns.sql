-- Booking queries select these columns explicitly (repositories/guest_portal.rs
-- BOOKING_SELECT, repositories/booking.rs find_by_id) but they were never added
-- to the SQLite bookings table; fresh databases failed the guest-portal
-- pre-check-in flow with "no such column". Types mirror database/schema.sql
-- (DECIMAL -> REAL, BOOLEAN -> INTEGER, TIMESTAMPTZ -> TEXT).
ALTER TABLE bookings ADD COLUMN room_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN subtotal REAL NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN remarks TEXT;
ALTER TABLE bookings ADD COLUMN discount_percentage REAL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN rate_override_weekday REAL;
ALTER TABLE bookings ADD COLUMN rate_override_weekend REAL;
ALTER TABLE bookings ADD COLUMN pre_checkin_completed INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN pre_checkin_completed_at TEXT;
ALTER TABLE bookings ADD COLUMN pre_checkin_token TEXT;
ALTER TABLE bookings ADD COLUMN pre_checkin_token_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_pre_checkin_token ON bookings(pre_checkin_token) WHERE pre_checkin_token IS NOT NULL;
