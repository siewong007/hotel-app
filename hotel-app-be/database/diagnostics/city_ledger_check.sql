-- Diagnostic query to check city ledger data for a specific date
-- Run this query against your database to diagnose the issue

-- Replace '2026-03-11' with the actual audit date you're checking

-- 1. Check if any bookings with company_billing exist for the date
SELECT 
    'Bookings with company_billing payment method' as check_type,
    COUNT(*) as count
FROM bookings b
WHERE b.payment_method = 'company_billing'
AND (
    (b.status IN ('checked_in', 'auto_checked_in') AND b.check_in_date <= '2026-03-11' AND b.check_out_date > '2026-03-11')
    OR (b.status = 'checked_out' AND b.check_in_date <= '2026-03-11' AND b.check_out_date >= '2026-03-11')
);

-- 2. Check if night audit was run for this date
SELECT 
    'Night audit runs for this date' as check_type,
    id,
    audit_date,
    status,
    total_bookings_posted
FROM night_audit_runs
WHERE audit_date = '2026-03-11';

-- 3. Check what was posted for this date (if audit was run)
SELECT 
    'Posted nights for this date' as check_type,
    napn.id,
    b.booking_number,
    b.payment_method,
    r.room_number,
    napn.room_charge,
    napn.service_tax,
    napn.total_posted
FROM night_audit_posted_nights napn
JOIN bookings b ON napn.booking_id = b.id
JOIN rooms r ON b.room_id = r.id
WHERE napn.audit_date = '2026-03-11';

-- 4. Check city ledger eligible bookings with details
SELECT 
    'City ledger eligible bookings' as check_type,
    b.id,
    b.booking_number,
    b.status,
    b.payment_method,
    b.check_in_date,
    b.check_out_date,
    b.total_amount,
    r.room_number
FROM bookings b
JOIN rooms r ON b.room_id = r.id
WHERE b.payment_method = 'company_billing'
AND (
    (b.status IN ('checked_in', 'auto_checked_in') AND b.check_in_date <= '2026-03-11' AND b.check_out_date > '2026-03-11')
    OR (b.status = 'checked_out' AND b.check_in_date <= '2026-03-11' AND b.check_out_date >= '2026-03-11')
);

-- 5. If audit was posted, check if company_billing bookings were included
SELECT 
    'Company billing bookings in posted nights' as check_type,
    napn.id,
    b.booking_number,
    b.payment_method,
    r.room_number
FROM night_audit_posted_nights napn
JOIN bookings b ON napn.booking_id = b.id
JOIN rooms r ON b.room_id = r.id
WHERE napn.audit_date = '2026-03-11'
AND b.payment_method = 'company_billing';
