-- Normalize legacy "cancelled" status values to "void".

UPDATE bookings
SET status = 'comp_void'
WHERE status = 'comp_cancelled';

UPDATE bookings
SET status = 'voided'
WHERE status = 'cancelled';

UPDATE bookings
SET payment_status = 'void'
WHERE payment_status = 'cancelled';

UPDATE payments
SET status = 'void'
WHERE status = 'cancelled';

UPDATE invoices
SET status = 'void'
WHERE status = 'cancelled';

UPDATE ekyc_verifications
SET status = 'void'
WHERE status = 'cancelled';
