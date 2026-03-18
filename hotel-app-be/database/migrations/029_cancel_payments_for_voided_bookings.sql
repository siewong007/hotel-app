-- ============================================================================
-- MIGRATION 029: CANCEL PAYMENTS FOR VOIDED BOOKINGS
-- ============================================================================
-- Description: Mark all payments linked to voided bookings as cancelled
--              so they don't appear in night audit reports.
-- ============================================================================

-- Cancel all payments linked to voided bookings
UPDATE payments
SET status = 'cancelled'
WHERE booking_id IN (SELECT id FROM bookings WHERE status = 'voided')
  AND status != 'cancelled';
