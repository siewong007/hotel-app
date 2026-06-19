-- Channel net revenue / OTA commission report support.
-- SQLite is projection-only for this report because night audit posting is PostgreSQL-only.

CREATE TABLE IF NOT EXISTS booking_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    channel_type TEXT NOT NULL DEFAULT 'ota'
        CHECK (channel_type IN ('direct', 'ota', 'corporate', 'walk_in', 'phone', 'website', 'channel_manager', 'other')),
    default_commission_type TEXT NOT NULL DEFAULT 'none'
        CHECK (default_commission_type IN ('none', 'percentage', 'fixed_amount')),
    default_commission_value NUMERIC NOT NULL DEFAULT 0 CHECK (default_commission_value >= 0),
    default_commission_scope TEXT NOT NULL DEFAULT 'per_booking'
        CHECK (default_commission_scope IN ('per_booking', 'per_night')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (
        default_commission_type <> 'percentage'
        OR default_commission_value BETWEEN 0 AND 100
    )
);

ALTER TABLE bookings ADD COLUMN booking_channel_id INTEGER REFERENCES booking_channels(id);
ALTER TABLE bookings ADD COLUMN commission_type_override TEXT;
ALTER TABLE bookings ADD COLUMN commission_value_override NUMERIC;
ALTER TABLE bookings ADD COLUMN commission_scope_override TEXT;
ALTER TABLE bookings ADD COLUMN commission_amount NUMERIC;
ALTER TABLE bookings ADD COLUMN net_revenue NUMERIC;

CREATE INDEX IF NOT EXISTS idx_booking_channels_active ON booking_channels(is_active);
CREATE INDEX IF NOT EXISTS idx_booking_channels_type ON booking_channels(channel_type);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_channel_id ON bookings(booking_channel_id);

INSERT OR IGNORE INTO booking_channels
    (name, channel_type, default_commission_type, default_commission_value, default_commission_scope, is_active)
VALUES
    ('Direct', 'direct', 'none', 0, 'per_booking', 1),
    ('Walk-in', 'walk_in', 'none', 0, 'per_booking', 1),
    ('Phone', 'phone', 'none', 0, 'per_booking', 1),
    ('Direct Website', 'website', 'none', 0, 'per_booking', 1),
    ('Booking.com', 'ota', 'none', 0, 'per_booking', 1),
    ('Agoda', 'ota', 'none', 0, 'per_booking', 1),
    ('Traveloka', 'ota', 'none', 0, 'per_booking', 1),
    ('Expedia', 'ota', 'none', 0, 'per_booking', 1),
    ('Hotels.com', 'ota', 'none', 0, 'per_booking', 1),
    ('Airbnb', 'ota', 'none', 0, 'per_booking', 1),
    ('Trip.com', 'ota', 'none', 0, 'per_booking', 1),
    ('Other OTA', 'ota', 'none', 0, 'per_booking', 1);
