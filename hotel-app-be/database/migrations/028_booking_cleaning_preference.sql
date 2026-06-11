-- ============================================================================
-- MIGRATION 028: BOOKING CLEANING PREFERENCE
-- ============================================================================
-- Description:
--   Add a per-booking daily-cleaning preference captured at the front desk.
--   NULL  = not set, TRUE = guest wants daily cleaning, FALSE = declined.
-- ============================================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaning_preference BOOLEAN;
