-- Add a test city ledger booking for March 11, 2026 to verify the feature works
-- Run this if you want to test city ledger with a specific date

-- First, ensure we have a test guest
INSERT INTO guests (first_name, last_name, full_name, email, phone, nationality, created_at)
SELECT 'Test', 'CityLedger', 'Test CityLedger', 'test.cityledger@test.com', '0123456789', 'Malaysian', NOW()
WHERE NOT EXISTS (SELECT 1 FROM guests WHERE email = 'test.cityledger@test.com');

-- Get a room for the booking
DO $$
DECLARE
    v_guest_id BIGINT;
    v_room_id BIGINT;
    v_booking_number VARCHAR(50);
BEGIN
    -- Get the test guest ID
    SELECT id INTO v_guest_id FROM guests WHERE email = 'test.cityledger@test.com';
    
    -- Get first available room
    SELECT id INTO v_room_id FROM rooms WHERE status = 'available' LIMIT 1;
    
    -- Generate booking number
    v_booking_number := 'BK-20260311-TEST01';
    
    -- Insert the test booking for March 11, 2026
    INSERT INTO bookings (
        booking_number, guest_id, room_id, 
        check_in_date, check_out_date, 
        adults, children,
        room_rate, subtotal, tax_amount, total_amount, 
        status, payment_status, payment_method, post_type,
        actual_check_in, source, 
        created_by, created_at
    )
    SELECT 
        v_booking_number, v_guest_id, v_room_id,
        '2026-03-11'::date, '2026-03-13'::date,
        1, 0,
        150.00, 300.00, 24.00, 324.00,
        'checked_in', 'pending', 'company_billing', 'normal_stay',
        '2026-03-11 14:00:00', 'corporate',
        (SELECT id FROM users WHERE username = 'admin' LIMIT 1), NOW()
    WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE booking_number = v_booking_number);
    
    -- Update room status to occupied
    UPDATE rooms SET status = 'occupied' WHERE id = v_room_id;
    
    RAISE NOTICE 'Test city ledger booking created: %', v_booking_number;
END $$;

-- Verify the booking was created
SELECT 
    b.booking_number,
    b.status,
    b.payment_method,
    b.check_in_date,
    b.check_out_date,
    b.total_amount,
    r.room_number,
    g.full_name as guest_name
FROM bookings b
JOIN rooms r ON b.room_id = r.id
JOIN guests g ON b.guest_id = g.id
WHERE b.booking_number = 'BK-20260311-TEST01';
