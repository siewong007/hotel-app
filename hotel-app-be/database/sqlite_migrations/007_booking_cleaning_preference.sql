-- ============================================================================
-- SQLITE MIGRATION 007: BOOKING CLEANING PREFERENCE
-- ============================================================================
-- Description:
--   Add a per-booking daily-cleaning preference captured at the front desk.
--   NULL = not set, 1 = guest wants daily cleaning, 0 = declined.
-- ============================================================================

ALTER TABLE bookings ADD COLUMN cleaning_preference INTEGER;
