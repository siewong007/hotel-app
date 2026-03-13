-- Add daily_rates column to bookings table
-- Stores per-day rate overrides as JSONB: {"2026-03-13": 150.00, "2026-03-14": 200.00}
-- When present, total is calculated as sum of daily rates instead of room_rate * nights

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS daily_rates JSONB;
