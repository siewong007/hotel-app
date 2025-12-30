-- ============================================================================
-- MIGRATION 012: RENAME COMPLIMENTARISE STATUS TO RELEASED
-- ============================================================================
-- Description: Renames the 'complimentarise' booking status to 'released'
--              for clarity (room released for guest to use credits elsewhere)
-- ============================================================================

-- Step 1: Update existing data
UPDATE bookings SET status = 'released' WHERE status = 'complimentarise';

-- Step 2: Update the status constraint to use 'released' instead of 'complimentarise'
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'pending', 'confirmed', 'checked_in', 'checked_out',
    'cancelled', 'no_show', 'completed', 'released',
    'partial_complimentary', 'fully_complimentary'
  ));

-- Step 3: Update the comment
COMMENT ON COLUMN bookings.status IS 'Booking status: pending, confirmed, checked_in, checked_out, cancelled, no_show, completed, released, partial_complimentary, fully_complimentary';
