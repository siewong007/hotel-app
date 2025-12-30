-- ============================================================================
-- SEED 04: GUESTS, BOOKINGS & PAYMENTS - COMPREHENSIVE TEST SCENARIOS
-- ============================================================================
-- Description: Complete test data covering all booking scenarios
-- Payment statuses: unpaid, unpaid_deposit, paid
-- ============================================================================

-- ============================================================================
-- GUESTS - Various profiles for different test scenarios
-- ============================================================================

-- Delete existing guests to avoid duplicates on re-run
DELETE FROM guests WHERE email IN (
    'john.smith@email.com', 'sarah.johnson@email.com', 'emily.williams@email.com',
    'michael.brown@corporate.com', 'lisa.davis@email.com', 'robert.wilson@email.com',
    'maria.gonzalez@email.com', 'jennifer.martinez@email.com', 'james.anderson@techcorp.com',
    'thomas.white@email.com', 'yuki.tanaka@email.jp', 'david.lee@email.com',
    'vip.guest@email.com', 'walkin@email.com', 'online.booker@email.com'
);

INSERT INTO guests (full_name, first_name, last_name, email, phone, address_line_1, city, state, postal_code, country, nationality, ic_number, created_at) VALUES
    ('John Smith', 'John', 'Smith', 'john.smith@email.com', '+1-555-1001', '123 Main Street, Apt 4B', 'New York', 'NY', '10001', 'United States', 'American', 'US123456789', CURRENT_TIMESTAMP - INTERVAL '200 days'),
    ('Sarah Johnson', 'Sarah', 'Johnson', 'sarah.johnson@email.com', '+1-555-1002', '456 Park Avenue, Suite 1200', 'San Francisco', 'CA', '94102', 'United States', 'American', 'US987654321', CURRENT_TIMESTAMP - INTERVAL '150 days'),
    ('Emily Williams', 'Emily', 'Williams', 'emily.williams@email.com', '+1-555-1003', '789 Beverly Hills Blvd', 'Los Angeles', 'CA', '90210', 'United States', 'American', 'US456789123', CURRENT_TIMESTAMP - INTERVAL '400 days'),
    ('Michael Brown', 'Michael', 'Brown', 'michael.brown@corporate.com', '+1-555-1004', '321 Corporate Plaza', 'Chicago', 'IL', '60601', 'United States', 'American', 'US789123456', CURRENT_TIMESTAMP - INTERVAL '300 days'),
    ('Lisa Davis', 'Lisa', 'Davis', 'lisa.davis@email.com', '+1-555-1005', '654 Sunset Boulevard', 'Miami', 'FL', '33101', 'United States', 'American', 'US321654987', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
    ('Robert Wilson', 'Robert', 'Wilson', 'robert.wilson@email.com', '+44-20-1234-5678', '10 Downing Street', 'London', 'England', 'SW1A 2AA', 'United Kingdom', 'British', 'UK123456789', CURRENT_TIMESTAMP - INTERVAL '100 days'),
    ('Maria Gonzalez', 'Maria', 'Gonzalez', 'maria.gonzalez@email.com', '+34-91-123-4567', 'Calle Gran Via 28', 'Madrid', 'Comunidad de Madrid', '28013', 'Spain', 'Spanish', 'ES123456789', CURRENT_TIMESTAMP - INTERVAL '75 days'),
    ('Jennifer Martinez', 'Jennifer', 'Martinez', 'jennifer.martinez@email.com', '+1-555-1009', '987 Ocean Drive', 'Miami Beach', 'FL', '33139', 'United States', 'American', 'US654987321', CURRENT_TIMESTAMP - INTERVAL '7 days'),
    ('James Anderson', 'James', 'Anderson', 'james.anderson@techcorp.com', '+1-555-1010', '1 Silicon Valley Drive', 'Palo Alto', 'CA', '94304', 'United States', 'American', 'US147258369', CURRENT_TIMESTAMP - INTERVAL '60 days'),
    ('Thomas White', 'Thomas', 'White', 'thomas.white@email.com', '+1-555-1011', NULL, NULL, NULL, NULL, NULL, 'American', NULL, CURRENT_TIMESTAMP - INTERVAL '500 days'),
    ('Yuki Tanaka', 'Yuki', 'Tanaka', 'yuki.tanaka@email.jp', '+81-3-1234-5678', '1-2-3 Shibuya', 'Tokyo', NULL, NULL, 'Japan', 'Japanese', 'JP123456789', CURRENT_TIMESTAMP - INTERVAL '45 days'),
    ('David Lee', 'David', 'Lee', 'david.lee@email.com', '+1-555-1008', '555 Tech Lane', 'Austin', 'TX', '73301', 'United States', 'American', 'US258369147', CURRENT_TIMESTAMP - INTERVAL '30 days'),
    ('VIP Guest', 'VIP', 'Guest', 'vip.guest@email.com', '+1-555-9999', '1 VIP Boulevard', 'Beverly Hills', 'CA', '90210', 'United States', 'American', 'US999888777', CURRENT_TIMESTAMP - INTERVAL '365 days'),
    ('Walk-in Customer', 'Walk-in', 'Customer', 'walkin@email.com', '+1-555-0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP - INTERVAL '1 day'),
    ('Online Booker', 'Online', 'Booker', 'online.booker@email.com', '+1-555-1111', '123 Web Street', 'Seattle', 'WA', '98101', 'United States', 'American', 'US111222333', CURRENT_TIMESTAMP - INTERVAL '5 days');

-- ============================================================================
-- BOOKINGS - COMPREHENSIVE TEST SCENARIOS
-- Payment Status: unpaid, unpaid_deposit, paid
-- Post Type: normal_stay, same_day
-- ============================================================================

-- ============================================================================
-- SCENARIO 1: CHECKED_IN guests (Currently staying - rooms occupied)
-- ============================================================================

-- Booking 1: CHECKED_IN with DEPOSIT (Sarah Johnson - Room 201) - UNPAID_DEPOSIT
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source, deposit_paid, deposit_amount, deposit_paid_at, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0001',
    g.id, (SELECT id FROM rooms WHERE room_number = '201' LIMIT 1),
    CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '3 days', 2, 0,
    200.00, 800.00, 80.00, 880.00, 'checked_in', 'unpaid_deposit', 'normal_stay',
    CURRENT_DATE - INTERVAL '1 day' + TIME '14:00:00', 'online',
    true, 200.00, CURRENT_TIMESTAMP - INTERVAL '2 days',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '5 days'
FROM guests g WHERE g.email = 'sarah.johnson@email.com'
ON CONFLICT (booking_number) DO NOTHING;

UPDATE rooms SET status = 'occupied' WHERE room_number = '201';

-- Booking 2: CHECKED_IN without DEPOSIT (David Lee - Room 203) - UNPAID
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source, deposit_paid, deposit_amount, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0002',
    g.id, (SELECT id FROM rooms WHERE room_number = '203' LIMIT 1),
    CURRENT_DATE, CURRENT_DATE + INTERVAL '2 days', 1, 0,
    180.00, 360.00, 36.00, 396.00, 'checked_in', 'unpaid', 'same_day',
    CURRENT_DATE + TIME '15:30:00', 'walk_in',
    false, 0,
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1), CURRENT_DATE - INTERVAL '1 hour'
FROM guests g WHERE g.email = 'david.lee@email.com'
ON CONFLICT (booking_number) DO NOTHING;

UPDATE rooms SET status = 'occupied' WHERE room_number = '203';

-- Booking 3: CHECKED_IN with deposit paid (Michael Brown - Room 204) - UNPAID_DEPOSIT
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source, deposit_paid, deposit_amount, deposit_paid_at, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0003',
    g.id, (SELECT id FROM rooms WHERE room_number = '204' LIMIT 1),
    CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE + INTERVAL '1 day', 1, 0,
    180.00, 540.00, 54.00, 594.00, 'checked_in', 'unpaid_deposit', 'normal_stay',
    CURRENT_DATE - INTERVAL '2 days' + TIME '16:00:00', 'phone',
    true, 100.00, CURRENT_TIMESTAMP - INTERVAL '3 days',
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1), CURRENT_DATE - INTERVAL '7 days'
FROM guests g WHERE g.email = 'michael.brown@corporate.com'
ON CONFLICT (booking_number) DO NOTHING;

UPDATE rooms SET status = 'occupied' WHERE room_number = '204';

-- Booking 4: CHECKED_IN - TOURIST fully paid (Lisa Davis - Room 205) - PAID
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source, deposit_paid, deposit_amount, deposit_paid_at, is_tourist, tourism_tax_amount,
    created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0004',
    g.id, (SELECT id FROM rooms WHERE room_number = '205' LIMIT 1),
    CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days', 2, 1,
    200.00, 1000.00, 100.00, 1100.00, 'checked_in', 'paid', 'normal_stay',
    CURRENT_DATE + TIME '11:00:00', 'agent',
    true, 300.00, CURRENT_TIMESTAMP - INTERVAL '10 days', true, 50.00,
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '14 days'
FROM guests g WHERE g.email = 'lisa.davis@email.com'
ON CONFLICT (booking_number) DO NOTHING;

UPDATE rooms SET status = 'occupied' WHERE room_number = '205';

-- ============================================================================
-- SCENARIO 2: CONFIRMED bookings (Future - rooms reserved)
-- ============================================================================

-- Booking 5: CONFIRMED with deposit PAID (Robert Wilson - Room 101) - UNPAID_DEPOSIT
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, deposit_paid, deposit_amount, deposit_paid_at, special_requests, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '3 days', 'YYYYMMDD') || '-0005',
    g.id, (SELECT id FROM rooms WHERE room_number = '101' LIMIT 1),
    CURRENT_DATE + INTERVAL '3 days', CURRENT_DATE + INTERVAL '6 days', 2, 0,
    150.00, 450.00, 45.00, 495.00, 'confirmed', 'unpaid_deposit', 'normal_stay',
    'online',
    true, 150.00, CURRENT_TIMESTAMP - INTERVAL '2 days',
    'Late check-in expected around 10pm',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '5 days'
FROM guests g WHERE g.email = 'robert.wilson@email.com'
ON CONFLICT (booking_number) DO NOTHING;

UPDATE rooms SET status = 'reserved' WHERE room_number = '101';

-- Booking 6: CONFIRMED without deposit (Maria Gonzalez - Room 102) - UNPAID
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, deposit_paid, deposit_amount, special_requests, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'YYYYMMDD') || '-0006',
    g.id, (SELECT id FROM rooms WHERE room_number = '102' LIMIT 1),
    CURRENT_DATE + INTERVAL '7 days', CURRENT_DATE + INTERVAL '9 days', 1, 0,
    150.00, 300.00, 30.00, 330.00, 'confirmed', 'unpaid', 'normal_stay',
    'website',
    false, 0,
    'Ground floor if possible',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1), CURRENT_DATE - INTERVAL '3 days'
FROM guests g WHERE g.email = 'maria.gonzalez@email.com'
ON CONFLICT (booking_number) DO NOTHING;

UPDATE rooms SET status = 'reserved' WHERE room_number = '102';

-- Booking 7: CONFIRMED - Same day check-in expected, fully paid (Yuki Tanaka - Room 103) - PAID
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, deposit_paid, deposit_amount, deposit_paid_at, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0007',
    g.id, (SELECT id FROM rooms WHERE room_number = '103' LIMIT 1),
    CURRENT_DATE, CURRENT_DATE + INTERVAL '2 days', 1, 0,
    150.00, 300.00, 30.00, 330.00, 'confirmed', 'paid', 'normal_stay',
    'mobile',
    true, 100.00, CURRENT_TIMESTAMP - INTERVAL '1 day',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '1 day'
FROM guests g WHERE g.email = 'yuki.tanaka@email.jp'
ON CONFLICT (booking_number) DO NOTHING;

UPDATE rooms SET status = 'reserved' WHERE room_number = '103';

-- ============================================================================
-- SCENARIO 3: COMPLIMENTARY bookings
-- ============================================================================

-- Booking 8: FULLY COMPLIMENTARY (VIP Guest - Room 302) - PAID (no charge)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source,
    is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date,
    original_total_amount, complimentary_nights, deposit_paid, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0008',
    g.id, (SELECT id FROM rooms WHERE room_number = '302' LIMIT 1),
    CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '2 days', 2, 0,
    250.00, 0.00, 0.00, 0.00, 'checked_in', 'paid', 'normal_stay',
    CURRENT_DATE - INTERVAL '1 day' + TIME '14:00:00', 'direct',
    true, 'VIP Guest - Management approved complimentary stay',
    CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '2 days',
    750.00, 3, false,
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1), CURRENT_DATE - INTERVAL '3 days'
FROM guests g WHERE g.email = 'vip.guest@email.com'
ON CONFLICT (booking_number) DO NOTHING;

UPDATE rooms SET status = 'occupied' WHERE room_number = '302';

-- Booking 9: PARTIAL COMPLIMENTARY - 2 nights free out of 5 (Jennifer Martinez - Room 303) - UNPAID_DEPOSIT
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source,
    is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date,
    original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at,
    created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0009',
    g.id, (SELECT id FROM rooms WHERE room_number = '303' LIMIT 1),
    CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE + INTERVAL '3 days', 2, 1,
    200.00, 600.00, 60.00, 660.00, 'checked_in', 'unpaid_deposit', 'normal_stay',
    CURRENT_DATE - INTERVAL '2 days' + TIME '15:00:00', 'phone',
    true, 'Loyalty reward - 2 nights complimentary',
    CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE,
    1000.00, 2, true, 200.00, CURRENT_TIMESTAMP - INTERVAL '5 days',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '10 days'
FROM guests g WHERE g.email = 'jennifer.martinez@email.com'
ON CONFLICT (booking_number) DO NOTHING;

UPDATE rooms SET status = 'occupied' WHERE room_number = '303';

-- ============================================================================
-- SCENARIO 4: PENDING bookings (Awaiting confirmation/payment)
-- ============================================================================

-- Booking 10: PENDING - Awaiting payment (Online Booker - Room 104) - UNPAID
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, deposit_paid, deposit_amount, special_requests, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '14 days', 'YYYYMMDD') || '-0010',
    g.id, (SELECT id FROM rooms WHERE room_number = '104' LIMIT 1),
    CURRENT_DATE + INTERVAL '14 days', CURRENT_DATE + INTERVAL '17 days', 2, 0,
    150.00, 450.00, 45.00, 495.00, 'pending', 'unpaid', 'normal_stay',
    'website',
    false, 0, 'Honeymoon trip - special decoration requested',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '1 hour'
FROM guests g WHERE g.email = 'online.booker@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- SCENARIO 5: CHECKED_OUT bookings (Completed stays)
-- ============================================================================

-- Booking 11: CHECKED_OUT with full payment (Emily Williams - Room 301) - PAID
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, actual_check_out, source, deposit_paid, deposit_amount, deposit_paid_at,
    created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '5 days', 'YYYYMMDD') || '-0011',
    g.id, (SELECT id FROM rooms WHERE room_number = '301' LIMIT 1),
    CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE - INTERVAL '2 days', 2, 0,
    250.00, 750.00, 75.00, 825.00, 'checked_out', 'paid', 'normal_stay',
    CURRENT_DATE - INTERVAL '5 days' + TIME '14:00:00',
    CURRENT_DATE - INTERVAL '2 days' + TIME '11:00:00',
    'direct',
    true, 250.00, CURRENT_TIMESTAMP - INTERVAL '7 days',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1), CURRENT_DATE - INTERVAL '10 days'
FROM guests g WHERE g.email = 'emily.williams@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 12: CHECKED_OUT - Same day booking (Walk-in Customer) - PAID
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, actual_check_out, source, deposit_paid, deposit_amount,
    created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '3 days', 'YYYYMMDD') || '-0012',
    g.id, (SELECT id FROM rooms WHERE room_number = '401' LIMIT 1),
    CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE - INTERVAL '2 days', 1, 0,
    350.00, 350.00, 35.00, 385.00, 'checked_out', 'paid', 'same_day',
    CURRENT_DATE - INTERVAL '3 days' + TIME '18:00:00',
    CURRENT_DATE - INTERVAL '2 days' + TIME '10:30:00',
    'walk_in',
    false, 0,
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1), CURRENT_DATE - INTERVAL '3 days'
FROM guests g WHERE g.email = 'walkin@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- SCENARIO 6: CANCELLED bookings
-- ============================================================================

-- Booking 13: CANCELLED booking (Thomas White - was Room 402)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, deposit_paid, deposit_amount, cancellation_reason, cancelled_at, cancelled_by,
    created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '10 days', 'YYYYMMDD') || '-0013',
    g.id, (SELECT id FROM rooms WHERE room_number = '402' LIMIT 1),
    CURRENT_DATE + INTERVAL '10 days', CURRENT_DATE + INTERVAL '12 days', 2, 0,
    350.00, 700.00, 70.00, 770.00, 'cancelled', 'unpaid', 'normal_stay',
    'phone',
    false, 0, 'Guest requested cancellation due to travel plans change',
    CURRENT_TIMESTAMP - INTERVAL '1 day',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1),
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '7 days'
FROM guests g WHERE g.email = 'thomas.white@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- SCENARIO 7: NO_SHOW bookings
-- ============================================================================

-- Booking 14: NO_SHOW (James Anderson - Room 403) - Was unpaid
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, deposit_paid, deposit_amount, deposit_paid_at, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '1 day', 'YYYYMMDD') || '-0014',
    g.id, (SELECT id FROM rooms WHERE room_number = '403' LIMIT 1),
    CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '1 day', 1, 0,
    350.00, 700.00, 70.00, 770.00, 'no_show', 'unpaid_deposit', 'normal_stay',
    'online',
    true, 200.00, CURRENT_TIMESTAMP - INTERVAL '5 days',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '7 days'
FROM guests g WHERE g.email = 'james.anderson@techcorp.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- UPDATE ROOM STATUSES based on active bookings
-- ============================================================================

-- Set rooms with checked_in bookings to occupied
UPDATE rooms SET status = 'occupied'
WHERE id IN (
    SELECT DISTINCT room_id FROM bookings
    WHERE status = 'checked_in'
);

-- Set rooms with confirmed/pending bookings for today to reserved
UPDATE rooms SET status = 'reserved'
WHERE id IN (
    SELECT DISTINCT room_id FROM bookings
    WHERE status IN ('confirmed', 'pending')
    AND check_in_date <= CURRENT_DATE
    AND check_out_date > CURRENT_DATE
) AND status != 'occupied';

-- Set Room 105 to maintenance for testing
UPDATE rooms SET status = 'maintenance' WHERE room_number = '105';

-- Set Room 202 to cleaning/dirty for testing
UPDATE rooms SET status = 'cleaning' WHERE room_number = '202';

-- ============================================================================
-- SUMMARY OF SEED DATA
-- ============================================================================
-- Guests: 15 with various profiles (VIP, corporate, international, walk-in)
-- Bookings: 14 covering all scenarios:
--   - 4 x CHECKED_IN (occupied rooms)
--   - 3 x CONFIRMED (reserved rooms)
--   - 2 x COMPLIMENTARY (1 full, 1 partial)
--   - 1 x PENDING
--   - 2 x CHECKED_OUT
--   - 1 x CANCELLED
--   - 1 x NO_SHOW
-- Payment Statuses: unpaid, unpaid_deposit, paid
-- Post Types: normal_stay, same_day
-- ============================================================================
