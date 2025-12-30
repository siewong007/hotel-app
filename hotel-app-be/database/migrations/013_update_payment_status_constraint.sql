-- Migration 013: Update payment_status constraint to include all valid values
-- This updates the CHECK constraint on the bookings table to allow additional payment status values

-- Drop the existing constraint first
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;

-- Add the new constraint with all valid values
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_status_check
    CHECK (payment_status IN (
        'unpaid',
        'unpaid_deposit',
        'paid_rate',
        'partial',
        'paid',
        'refunded',
        'cancelled'
    ));

-- Update any existing invalid values to valid ones (if any)
-- This is a safety measure - should not affect properly migrated data
UPDATE bookings SET payment_status = 'unpaid'
WHERE payment_status NOT IN ('unpaid', 'unpaid_deposit', 'paid_rate', 'partial', 'paid', 'refunded', 'cancelled');
