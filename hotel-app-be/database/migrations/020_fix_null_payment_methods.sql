-- Migration: Fix NULL payment methods in bookings
-- This migration sets a default payment_method for bookings that have NULL values

-- Update bookings with NULL payment_method based on their source
UPDATE bookings
SET payment_method = CASE
    WHEN source IN ('corporate') THEN 'company_billing'
    WHEN source IN ('walk_in') THEN 'cash'
    WHEN source IN ('online', 'website', 'mobile') THEN 'credit_card'
    WHEN source IN ('agent') THEN 'bank_transfer'
    ELSE 'credit_card'
END
WHERE payment_method IS NULL;

-- Add a comment for documentation
COMMENT ON COLUMN bookings.payment_method IS 'Payment method: cash, credit_card, debit_card, bank_transfer, company_billing, online_payment, ewallet';
