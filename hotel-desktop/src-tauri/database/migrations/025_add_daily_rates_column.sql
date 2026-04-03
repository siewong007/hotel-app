-- ============================================================================
-- MIGRATION 025: ADD DAILY_RATES COLUMN TO BOOKINGS
-- ============================================================================
-- Description: Adds daily_rates JSONB column for per-night rate tracking
-- ============================================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS daily_rates JSONB;

COMMENT ON COLUMN bookings.daily_rates IS 'Per-night rate breakdown as JSON object with date keys and rate values';
