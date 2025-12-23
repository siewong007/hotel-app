-- ============================================================================
-- ENHANCED GUEST & BOOKING SEED DATA
-- ============================================================================
-- Comprehensive test data covering all guest types, booking statuses, and edge cases
-- ============================================================================

-- ============================================================================
-- GUESTS - Various profiles and data completeness levels
-- ============================================================================

-- Guest 1: Complete profile (linked to user johnsmith)
INSERT INTO guests (first_name, last_name, email, phone, address_line1, city, state_province, postal_code, country, is_active, created_at)
VALUES (
    'John',
    'Smith',
    'john.smith@email.com',
    '+1-555-1001',
    '123 Main Street, Apt 4B',
    'New York',
    'NY',
    '10001',
    'United States',
    true,
    CURRENT_TIMESTAMP - INTERVAL '200 days'
)
ON CONFLICT (email) DO NOTHING;

-- Guest 2: VIP guest with complete profile (linked to user sarahjohnson)
INSERT INTO guests (first_name, last_name, email, phone, address_line1, city, state_province, postal_code, country, is_active, created_at)
VALUES (
    'Sarah',
    'Johnson',
    'sarah.johnson@email.com',
    '+1-555-1002',
    '456 Park Avenue, Suite 1200',
    'San Francisco',
    'CA',
    '94102',
    'United States',
    true,
    CURRENT_TIMESTAMP - INTERVAL '150 days'
)
ON CONFLICT (email) DO NOTHING;

-- Guest 3: VIP guest (linked to user emilywilliams)
INSERT INTO guests (first_name, last_name, email, phone, address_line1, city, state_province, postal_code, country, is_active, created_at)
VALUES (
    'Emily',
    'Williams',
    'emily.williams@email.com',
    '+1-555-1003',
    '789 Beverly Hills Blvd',
    'Los Angeles',
    'CA',
    '90210',
    'United States',
    true,
    CURRENT_TIMESTAMP - INTERVAL '400 days'
)
ON CONFLICT (email) DO NOTHING;

-- Guest 4: Business traveler (linked to user michaelbrown)
INSERT INTO guests (first_name, last_name, email, phone, address_line1, city, state_province, postal_code, country, is_active, created_at)
VALUES (
    'Michael',
    'Brown',
    'michael.brown@corporate.com',
    '+1-555-1004',
    '321 Corporate Plaza',
    'Chicago',
    'IL',
    '60601',
    'United States',
    true,
    CURRENT_TIMESTAMP - INTERVAL '300 days'
)
ON CONFLICT (email) DO NOTHING;

-- Guest 5: New guest (linked to user lisadavis)
INSERT INTO guests (first_name, last_name, email, phone, address_line1, city, state_province, postal_code, country, is_active, created_at)
VALUES (
    'Lisa',
    'Davis',
    'lisa.davis@email.com',
    '+1-555-1005',
    '654 Sunset Boulevard',
    'Miami',
    'FL',
    '33101',
    'United States',
    true,
    CURRENT_TIMESTAMP - INTERVAL '2 hours'
)
ON CONFLICT (email) DO NOTHING;

-- Guest 6: International guest (linked to user robertwilson)
INSERT INTO guests (first_name, last_name, email, phone, address_line1, city, state_province, postal_code, country, is_active, created_at)
VALUES (
    'Robert',
    'Wilson',
    'robert.wilson@email.com',
    '+44-20-1234-5678',
    '10 Downing Street',
    'London',
    'England',
    'SW1A 2AA',
    'United Kingdom',
    true,
    CURRENT_TIMESTAMP - INTERVAL '100 days'
)
ON CONFLICT (email) DO NOTHING;

-- Guest 7: International guest with special characters
INSERT INTO guests (first_name, last_name, email, phone, address_line1, city, state_province, postal_code, country, is_active, created_at)
VALUES (
    'María',
    'González',
    'maria.gonzalez@email.com',
    '+34-91-123-4567',
    'Calle Gran Vía 28',
    'Madrid',
    'Comunidad de Madrid',
    '28013',
    'Spain',
    true,
    CURRENT_TIMESTAMP - INTERVAL '75 days'
)
ON CONFLICT (email) DO NOTHING;

-- Guest 8: Minimal profile
INSERT INTO guests (first_name, last_name, email, phone, is_active, created_at)
VALUES (
    'David',
    'Lee',
    'david.lee@email.com',
    '+1-555-1008',
    true,
    CURRENT_TIMESTAMP - INTERVAL '30 days'
)
ON CONFLICT (email) DO NOTHING;

-- Guest 9: Walk-in guest (no user account)
INSERT INTO guests (first_name, last_name, email, phone, address_line1, city, state_province, postal_code, country, is_active, created_at)
VALUES (
    'Jennifer',
    'Martinez',
    'jennifer.martinez@email.com',
    '+1-555-1009',
    '987 Ocean Drive',
    'Miami Beach',
    'FL',
    '33139',
    'United States',
    true,
    CURRENT_TIMESTAMP - INTERVAL '7 days'
)
ON CONFLICT (email) DO NOTHING;

-- Guest 10: Corporate group leader (no user account)
INSERT INTO guests (first_name, last_name, email, phone, address_line1, city, state_province, postal_code, country, is_active, created_at)
VALUES (
    'James',
    'Anderson',
    'james.anderson@techcorp.com',
    '+1-555-1010',
    '1 Silicon Valley Drive',
    'Palo Alto',
    'CA',
    '94304',
    'United States',
    true,
    CURRENT_TIMESTAMP - INTERVAL '60 days'
)
ON CONFLICT (email) DO NOTHING;

-- Guest 11: Inactive guest (cancelled multiple times)
INSERT INTO guests (first_name, last_name, email, phone, is_active, created_at)
VALUES (
    'Thomas',
    'White',
    'thomas.white@email.com',
    '+1-555-1011',
    false,
    CURRENT_TIMESTAMP - INTERVAL '500 days'
)
ON CONFLICT (email) DO NOTHING;

-- Guest 12: Asian name testing
INSERT INTO guests (first_name, last_name, email, phone, address_line1, city, country, is_active, created_at)
VALUES (
    'Yuki',
    'Tanaka',
    'yuki.tanaka@email.jp',
    '+81-3-1234-5678',
    '1-2-3 Shibuya',
    'Tokyo',
    'Japan',
    true,
    CURRENT_TIMESTAMP - INTERVAL '45 days'
)
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- BOOKINGS - Comprehensive test scenarios
-- ============================================================================

-- Booking 1: CONFIRMED - Future booking (John Smith)
INSERT INTO bookings (
    booking_number, guest_id, room_id,
    check_in_date, check_out_date,
    adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount,
    status, payment_status,
    special_requests, source, channel,
    created_by, created_at
)
SELECT
    'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'YYYYMMDD') || '-0001',
    g.id,
    (SELECT id FROM rooms WHERE room_number = '101' LIMIT 1),
    CURRENT_DATE + INTERVAL '7 days',
    CURRENT_DATE + INTERVAL '10 days',
    2, 0,
    (SELECT id FROM rate_plans WHERE code = 'STD' LIMIT 1),
    150.00,
    450.00,
    45.00,
    495.00,
    'confirmed',
    'paid',
    'High floor preferred, late check-in expected',
    'website',
    'direct',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1),
    CURRENT_DATE - INTERVAL '3 days'
FROM guests g
WHERE g.email = 'john.smith@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Update room status for reserved booking
UPDATE rooms SET status = 'reserved'
WHERE room_number = '101';

-- Booking 2: CHECKED_IN - Currently staying (Sarah Johnson)
INSERT INTO bookings (
    booking_number, guest_id, room_id,
    check_in_date, check_out_date,
    adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount,
    status, payment_status,
    actual_check_in,
    special_requests, source, channel,
    created_by, created_at
)
SELECT
    'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '2 days', 'YYYYMMDD') || '-0002',
    g.id,
    (SELECT id FROM rooms WHERE room_number = '201' LIMIT 1),
    CURRENT_DATE - INTERVAL '2 days',
    CURRENT_DATE + INTERVAL '3 days',
    2, 1,
    (SELECT id FROM rate_plans WHERE code = 'WKND' LIMIT 1),
    200.00,
    1000.00,
    100.00,
    1100.00,
    'checked_in',
    'paid',
    CURRENT_DATE - INTERVAL '2 days' + TIME '15:30:00',
    'Celebrating anniversary, champagne and flowers requested',
    'phone',
    'phone',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1),
    CURRENT_DATE - INTERVAL '10 days'
FROM guests g
WHERE g.email = 'sarah.johnson@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Update room status for checked-in booking
UPDATE rooms SET status = 'occupied'
WHERE room_number = '201';

-- Booking 3: CHECKED_OUT - Completed stay (Emily Williams - VIP)
INSERT INTO bookings (
    booking_number, guest_id, room_id,
    check_in_date, check_out_date,
    adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount,
    status, payment_status,
    actual_check_in,
    actual_check_out,
    special_requests, source, channel,
    created_by, created_at
)
SELECT
    'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '5 days', 'YYYYMMDD') || '-0003',
    g.id,
    (SELECT id FROM rooms WHERE room_number = '301' LIMIT 1),
    CURRENT_DATE - INTERVAL '5 days',
    CURRENT_DATE - INTERVAL '2 days',
    2, 0,
    (SELECT id FROM rate_plans WHERE code = 'STD' LIMIT 1),
    250.00,
    750.00,
    75.00,
    825.00,
    'checked_out',
    'paid',
    CURRENT_DATE - INTERVAL '5 days' + TIME '14:00:00',
    CURRENT_DATE - INTERVAL '2 days' + TIME '11:30:00',
    'VIP guest - ensure room upgrade if available',
    'direct',
    'walk_in',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1),
    CURRENT_DATE - INTERVAL '6 days'
FROM guests g
WHERE g.email = 'emily.williams@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 4: CANCELLED - Cancelled before check-in (Michael Brown)
INSERT INTO bookings (
    booking_number, guest_id, room_id,
    check_in_date, check_out_date,
    adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount,
    status, payment_status,
    special_requests, source, channel,
    cancelled_at, cancellation_reason,
    created_by, created_at
)
SELECT
    'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '3 days', 'YYYYMMDD') || '-0004',
    g.id,
    (SELECT id FROM rooms WHERE room_number = '102' LIMIT 1),
    CURRENT_DATE + INTERVAL '3 days',
    CURRENT_DATE + INTERVAL '5 days',
    1, 0,
    (SELECT id FROM rate_plans WHERE code = 'CORP' LIMIT 1),
    112.50,
    225.00,
    22.50,
    247.50,
    'cancelled',
    'refunded',
    'Ground floor preferred',
    'website',
    'direct',
    CURRENT_DATE - INTERVAL '1 day',
    'Business trip cancelled due to meeting rescheduling',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1),
    CURRENT_DATE - INTERVAL '15 days'
FROM guests g
WHERE g.email = 'michael.brown@corporate.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 5: PENDING - Awaiting payment (Lisa Davis)
INSERT INTO bookings (
    booking_number, guest_id, room_id,
    check_in_date, check_out_date,
    adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount,
    status, payment_status,
    special_requests, source, channel,
    created_by, created_at
)
SELECT
    'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '30 days', 'YYYYMMDD') || '-0005',
    g.id,
    (SELECT id FROM rooms WHERE room_number = '103' LIMIT 1),
    CURRENT_DATE + INTERVAL '30 days',
    CURRENT_DATE + INTERVAL '33 days',
    2, 0,
    (SELECT id FROM rate_plans WHERE code = 'EARLY' LIMIT 1),
    127.50,
    382.50,
    38.25,
    420.75,
    'pending',
    'unpaid',
    'Quiet room requested',
    'website',
    'direct',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1),
    CURRENT_DATE - INTERVAL '1 hour'
FROM guests g
WHERE g.email = 'lisa.davis@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 6: CONFIRMED - Weekend booking with child (Jennifer Martinez - walk-in)
-- Room 202 is Deluxe (max_occupancy = 3), so 2 adults + 1 child = 3 guests
INSERT INTO bookings (
    booking_number, guest_id, room_id,
    check_in_date, check_out_date,
    adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount,
    status, payment_status,
    special_requests, source, channel,
    created_by, created_at
)
SELECT
    'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '14 days', 'YYYYMMDD') || '-0006',
    g.id,
    (SELECT id FROM rooms WHERE room_number = '401' LIMIT 1), -- Family room (max 6) instead
    CURRENT_DATE + INTERVAL '14 days',
    CURRENT_DATE + INTERVAL '16 days',
    2, 2,
    (SELECT id FROM rate_plans WHERE code = 'WKND' LIMIT 1),
    120.00,
    240.00,
    24.00,
    264.00,
    'confirmed',
    'partial',
    'Crib needed for infant, extra towels',
    'direct',
    'walk_in',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1),
    CURRENT_DATE - INTERVAL '1 day'
FROM guests g
WHERE g.email = 'jennifer.martinez@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Update room status for reserved booking
UPDATE rooms SET status = 'reserved'
WHERE room_number = '401';

-- Booking 7: CONFIRMED - Long stay corporate booking (James Anderson)
INSERT INTO bookings (
    booking_number, guest_id, room_id,
    check_in_date, check_out_date,
    adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount,
    status, payment_status,
    special_requests, source, channel,
    created_by, created_at
)
SELECT
    'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '5 days', 'YYYYMMDD') || '-0007',
    g.id,
    (SELECT id FROM rooms WHERE room_number = '203' LIMIT 1),
    CURRENT_DATE + INTERVAL '5 days',
    CURRENT_DATE + INTERVAL '12 days',
    1, 0,
    (SELECT id FROM rate_plans WHERE code = 'CORP' LIMIT 1),
    112.50,
    787.50,
    78.75,
    866.25,
    'confirmed',
    'paid',
    'Corporate account - TechCorp Inc., billing to company',
    'email',
    'corporate',
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1),
    CURRENT_DATE - INTERVAL '5 days'
FROM guests g
WHERE g.email = 'james.anderson@techcorp.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Update room status for reserved booking
UPDATE rooms SET status = 'reserved'
WHERE room_number = '203';

-- Booking 8: CONFIRMED - Same day booking (Yuki Tanaka)
-- Using room 104 (Standard room on floor 1)
INSERT INTO bookings (
    booking_number, guest_id, room_id,
    check_in_date, check_out_date,
    adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount,
    status, payment_status,
    special_requests, source, channel,
    created_by, created_at
)
SELECT
    'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0008',
    g.id,
    (SELECT id FROM rooms WHERE room_number = '104' LIMIT 1),
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '1 day',
    1, 0,
    (SELECT id FROM rate_plans WHERE code = 'STD' LIMIT 1),
    150.00,
    150.00,
    15.00,
    165.00,
    'confirmed',
    'paid',
    'Last minute booking, contactless check-in preferred',
    'mobile',
    'mobile_app',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1),
    CURRENT_DATE - INTERVAL '2 hours'
FROM guests g
WHERE g.email = 'yuki.tanaka@email.jp'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- GUEST REVIEWS - Various ratings and review types
-- ============================================================================

-- Review 1: Excellent review from Emily Williams
INSERT INTO guest_reviews (
    guest_id, room_type,
    overall_rating, cleanliness_rating, staff_rating, facilities_rating, value_rating, location_rating,
    title, review_text, pros, cons, recommend, created_at
)
SELECT
    g.id,
    'Deluxe Room',
    5.0, 5.0, 5.0, 5.0, 4.5, 5.0,
    'Absolutely Amazing Experience!',
    'Our stay was exceptional from start to finish. The room was immaculate, staff was incredibly attentive, and the amenities exceeded our expectations. The view from our room was breathtaking.',
    'Perfect cleanliness, amazing staff, beautiful views, comfortable bed',
    'Nothing to complain about',
    true,
    CURRENT_DATE - INTERVAL '1 day'
FROM guests g
WHERE g.email = 'emily.williams@email.com';

-- Review 2: Good review from John Smith
INSERT INTO guest_reviews (
    guest_id, room_type,
    overall_rating, cleanliness_rating, staff_rating, facilities_rating, value_rating, location_rating,
    title, review_text, pros, cons, recommend, created_at
)
SELECT
    g.id,
    'Standard Room',
    4.0, 4.5, 4.5, 4.0, 4.0, 4.5,
    'Great Value for Money',
    'Very pleasant stay overall. Room was clean and comfortable. Staff was helpful and friendly. Good location near downtown. Would definitely stay again.',
    'Clean rooms, friendly staff, good location, reasonable prices',
    'WiFi could be faster, breakfast area gets crowded',
    true,
    CURRENT_DATE - INTERVAL '10 days'
FROM guests g
WHERE g.email = 'john.smith@email.com';

-- Review 3: Critical review from Robert Wilson
INSERT INTO guest_reviews (
    guest_id, room_type,
    overall_rating, cleanliness_rating, staff_rating, facilities_rating, value_rating, location_rating,
    title, review_text, pros, cons, recommend, created_at
)
SELECT
    g.id,
    'Standard Room',
    2.5, 3.0, 3.5, 2.0, 2.5, 4.0,
    'Disappointed - Needs Improvement',
    'While the location was good, several aspects need improvement. Room had maintenance issues, air conditioning was noisy, and housekeeping was inconsistent.',
    'Good location, polite staff',
    'Room maintenance issues, noisy AC, inconsistent housekeeping, dated decor',
    false,
    CURRENT_DATE - INTERVAL '25 days'
FROM guests g
WHERE g.email = 'robert.wilson@email.com';

\echo '✓ Enhanced guest and booking seed data loaded successfully'
\echo '✓ Created 12 diverse guest profiles'
\echo '✓ Created 8 bookings covering all statuses (confirmed, checked_in, checked_out, cancelled, pending)'
\echo '✓ Created 3 guest reviews with varying ratings'
