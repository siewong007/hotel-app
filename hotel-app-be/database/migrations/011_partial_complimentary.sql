-- ============================================================================
-- MIGRATION 011: PARTIAL COMPLIMENTARY BOOKINGS
-- ============================================================================
-- Description: Adds support for partial complimentary bookings with date ranges
-- ============================================================================

-- Widen status column to accommodate longer status values like 'partial_complimentary'
-- Note: This requires dropping dependent objects first (views, triggers)
-- Run this manually if there are dependencies:
--   DROP TRIGGER IF EXISTS trg_sync_room_status_booking ON bookings;
--   DROP VIEW IF EXISTS booking_summary, daily_arrivals, daily_departures, occupancy_stats, revenue_summary, room_status_summary CASCADE;
--   ALTER TABLE bookings ALTER COLUMN status TYPE VARCHAR(50);
--   Then recreate the trigger and views

-- Update status constraint to add new values
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'pending', 'confirmed', 'checked_in', 'checked_out',
    'cancelled', 'no_show', 'completed', 'complimentarise',
    'partial_complimentary', 'fully_complimentary'
  ));

-- Add columns for complimentary date tracking
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complimentary_start_date DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complimentary_end_date DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS original_total_amount DECIMAL(12,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complimentary_nights INTEGER DEFAULT 0;

-- Add constraint to ensure complimentary dates are within booking range
ALTER TABLE bookings ADD CONSTRAINT valid_complimentary_dates
  CHECK (
    (complimentary_start_date IS NULL AND complimentary_end_date IS NULL) OR
    (complimentary_start_date IS NOT NULL AND complimentary_end_date IS NOT NULL AND
     complimentary_start_date >= check_in_date AND
     complimentary_end_date <= check_out_date AND
     complimentary_start_date < complimentary_end_date)
  );

-- Index for querying complimentary bookings
CREATE INDEX IF NOT EXISTS idx_bookings_complimentary_status
  ON bookings(status) WHERE status IN ('partial_complimentary', 'fully_complimentary');

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON COLUMN bookings.complimentary_start_date IS 'Start date of complimentary period within booking';
COMMENT ON COLUMN bookings.complimentary_end_date IS 'End date of complimentary period within booking';
COMMENT ON COLUMN bookings.original_total_amount IS 'Original total before complimentary adjustment';
COMMENT ON COLUMN bookings.complimentary_nights IS 'Number of complimentary nights in this booking';
