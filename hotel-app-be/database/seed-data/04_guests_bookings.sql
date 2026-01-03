-- ============================================================================
-- SEED 04: GUESTS, BOOKINGS, COMPANIES, ROOM CHANGES - ALL SCENARIOS
-- ============================================================================
-- Description: Comprehensive test data covering ALL possibilities
-- ============================================================================

-- ============================================================================
-- COMPANIES - For direct billing scenarios
-- ============================================================================

DELETE FROM companies WHERE company_name IN (
    'Tech Corp International', 'Global Travel Agency', 'Summit Hotels Group',
    'Business Solutions Ltd', 'VIP Services Inc'
);

INSERT INTO companies (company_name, registration_number, contact_person, contact_email, contact_phone,
    billing_address, billing_city, billing_state, billing_postal_code, billing_country,
    is_active, credit_limit, payment_terms_days, notes, created_by)
VALUES
    ('Tech Corp International', 'TC-2024-001', 'John Director', 'billing@techcorp.com', '+1-555-8001',
     '100 Silicon Valley Blvd', 'San Jose', 'CA', '95110', 'United States',
     true, 50000.00, 30, 'Preferred corporate client', (SELECT id FROM users WHERE username = 'admin' LIMIT 1)),
    ('Global Travel Agency', 'GTA-2024-002', 'Sarah Agent', 'accounts@globaltravel.com', '+1-555-8002',
     '200 Travel Center Drive', 'Miami', 'FL', '33101', 'United States',
     true, 100000.00, 45, 'Travel agency with group bookings', (SELECT id FROM users WHERE username = 'admin' LIMIT 1)),
    ('Summit Hotels Group', 'SHG-2024-003', 'Mike Partner', 'finance@summithotels.com', '+1-555-8003',
     '300 Hospitality Lane', 'Las Vegas', 'NV', '89101', 'United States',
     true, 25000.00, 30, 'Partner hotel chain', (SELECT id FROM users WHERE username = 'admin' LIMIT 1)),
    ('Business Solutions Ltd', 'BSL-2024-004', 'Lisa Manager', 'ar@businesssolutions.com', '+44-20-7946-0958',
     '10 Business Park', 'London', 'England', 'EC1A 1BB', 'United Kingdom',
     true, 30000.00, 60, 'International business client', (SELECT id FROM users WHERE username = 'admin' LIMIT 1)),
    ('VIP Services Inc', 'VIP-2024-005', 'Robert Elite', 'vip@vipservices.com', '+1-555-8005',
     '1 Luxury Avenue', 'Beverly Hills', 'CA', '90210', 'United States',
     false, 10000.00, 15, 'Inactive - credit issues', (SELECT id FROM users WHERE username = 'admin' LIMIT 1));

-- ============================================================================
-- GUESTS - All guest_type variations with various discount_percentage
-- ============================================================================

DELETE FROM guests WHERE email IN (
    'john.smith@email.com', 'sarah.johnson@email.com', 'emily.williams@email.com',
    'michael.brown@corporate.com', 'lisa.davis@email.com', 'robert.wilson@email.com',
    'maria.gonzalez@email.com', 'jennifer.martinez@email.com', 'james.anderson@techcorp.com',
    'thomas.white@email.com', 'yuki.tanaka@email.jp', 'david.lee@email.com',
    'vip.guest@email.com', 'walkin@email.com', 'online.booker@email.com',
    'member.gold@email.com', 'member.silver@email.com', 'member.bronze@email.com',
    'corporate.vip@techcorp.com', 'refund.customer@email.com'
);

INSERT INTO guests (full_name, first_name, last_name, email, phone, address_line_1, city, state, postal_code, country, nationality, ic_number, guest_type, discount_percentage, vip_status, created_at) VALUES
    -- NON-MEMBER guests (standard rates)
    ('John Smith', 'John', 'Smith', 'john.smith@email.com', '+1-555-1001', '123 Main Street', 'New York', 'NY', '10001', 'United States', 'American', 'US123456789', 'non_member', 0, NULL, CURRENT_TIMESTAMP - INTERVAL '200 days'),
    ('Sarah Johnson', 'Sarah', 'Johnson', 'sarah.johnson@email.com', '+1-555-1002', '456 Park Avenue', 'San Francisco', 'CA', '94102', 'United States', 'American', 'US987654321', 'non_member', 0, NULL, CURRENT_TIMESTAMP - INTERVAL '150 days'),
    ('Lisa Davis', 'Lisa', 'Davis', 'lisa.davis@email.com', '+1-555-1005', '654 Sunset Boulevard', 'Miami', 'FL', '33101', 'United States', 'American', 'US321654987', 'non_member', 0, NULL, CURRENT_TIMESTAMP - INTERVAL '2 hours'),
    ('Walk-in Customer', 'Walk-in', 'Customer', 'walkin@email.com', '+1-555-0000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'non_member', 0, NULL, CURRENT_TIMESTAMP - INTERVAL '1 day'),
    ('Thomas White', 'Thomas', 'White', 'thomas.white@email.com', '+1-555-1011', NULL, NULL, NULL, NULL, NULL, 'American', NULL, 'non_member', 0, NULL, CURRENT_TIMESTAMP - INTERVAL '500 days'),

    -- MEMBER guests with various discount percentages
    ('Emily Williams', 'Emily', 'Williams', 'emily.williams@email.com', '+1-555-1003', '789 Beverly Hills Blvd', 'Los Angeles', 'CA', '90210', 'United States', 'American', 'US456789123', 'member', 10, 'Gold', CURRENT_TIMESTAMP - INTERVAL '400 days'),
    ('Michael Brown', 'Michael', 'Brown', 'michael.brown@corporate.com', '+1-555-1004', '321 Corporate Plaza', 'Chicago', 'IL', '60601', 'United States', 'American', 'US789123456', 'member', 15, 'Silver', CURRENT_TIMESTAMP - INTERVAL '300 days'),
    ('Robert Wilson', 'Robert', 'Wilson', 'robert.wilson@email.com', '+44-20-1234-5678', '10 Downing Street', 'London', 'England', 'SW1A 2AA', 'United Kingdom', 'British', 'UK123456789', 'member', 5, NULL, CURRENT_TIMESTAMP - INTERVAL '100 days'),
    ('Maria Gonzalez', 'Maria', 'Gonzalez', 'maria.gonzalez@email.com', '+34-91-123-4567', 'Calle Gran Via 28', 'Madrid', 'Comunidad de Madrid', '28013', 'Spain', 'Spanish', 'ES123456789', 'member', 20, 'Platinum', CURRENT_TIMESTAMP - INTERVAL '75 days'),
    ('Jennifer Martinez', 'Jennifer', 'Martinez', 'jennifer.martinez@email.com', '+1-555-1009', '987 Ocean Drive', 'Miami Beach', 'FL', '33139', 'United States', 'American', 'US654987321', 'member', 25, 'Diamond', CURRENT_TIMESTAMP - INTERVAL '7 days'),
    ('James Anderson', 'James', 'Anderson', 'james.anderson@techcorp.com', '+1-555-1010', '1 Silicon Valley Drive', 'Palo Alto', 'CA', '94304', 'United States', 'American', 'US147258369', 'member', 30, 'Corporate', CURRENT_TIMESTAMP - INTERVAL '60 days'),
    ('Yuki Tanaka', 'Yuki', 'Tanaka', 'yuki.tanaka@email.jp', '+81-3-1234-5678', '1-2-3 Shibuya', 'Tokyo', NULL, NULL, 'Japan', 'Japanese', 'JP123456789', 'member', 12, NULL, CURRENT_TIMESTAMP - INTERVAL '45 days'),
    ('David Lee', 'David', 'Lee', 'david.lee@email.com', '+1-555-1008', '555 Tech Lane', 'Austin', 'TX', '73301', 'United States', 'American', 'US258369147', 'non_member', 0, NULL, CURRENT_TIMESTAMP - INTERVAL '30 days'),
    ('VIP Guest', 'VIP', 'Guest', 'vip.guest@email.com', '+1-555-9999', '1 VIP Boulevard', 'Beverly Hills', 'CA', '90210', 'United States', 'American', 'US999888777', 'member', 50, 'VIP', CURRENT_TIMESTAMP - INTERVAL '365 days'),
    ('Online Booker', 'Online', 'Booker', 'online.booker@email.com', '+1-555-1111', '123 Web Street', 'Seattle', 'WA', '98101', 'United States', 'American', 'US111222333', 'non_member', 0, NULL, CURRENT_TIMESTAMP - INTERVAL '5 days'),

    -- Additional members with edge case discounts
    ('Gold Member', 'Gold', 'Member', 'member.gold@email.com', '+1-555-2001', '100 Gold Street', 'Denver', 'CO', '80201', 'United States', 'American', 'US100200300', 'member', 15, 'Gold', CURRENT_TIMESTAMP - INTERVAL '180 days'),
    ('Silver Member', 'Silver', 'Member', 'member.silver@email.com', '+1-555-2002', '200 Silver Avenue', 'Phoenix', 'AZ', '85001', 'United States', 'American', 'US200300400', 'member', 10, 'Silver', CURRENT_TIMESTAMP - INTERVAL '90 days'),
    ('Bronze Member', 'Bronze', 'Member', 'member.bronze@email.com', '+1-555-2003', '300 Bronze Road', 'Portland', 'OR', '97201', 'United States', 'American', 'US300400500', 'member', 5, 'Bronze', CURRENT_TIMESTAMP - INTERVAL '30 days'),
    ('Corporate VIP', 'Corporate', 'VIP', 'corporate.vip@techcorp.com', '+1-555-3001', '500 Executive Drive', 'Boston', 'MA', '02101', 'United States', 'American', 'US500600700', 'member', 35, 'Corporate VIP', CURRENT_TIMESTAMP - INTERVAL '250 days'),
    ('Refund Customer', 'Refund', 'Customer', 'refund.customer@email.com', '+1-555-4001', '600 Return Lane', 'Atlanta', 'GA', '30301', 'United States', 'American', 'US600700800', 'non_member', 0, NULL, CURRENT_TIMESTAMP - INTERVAL '14 days');

-- ============================================================================
-- BOOKINGS - ALL STATUS & PAYMENT STATUS COMBINATIONS
-- Statuses: pending, confirmed, checked_in, checked_out, cancelled, no_show, completed, released, partial_complimentary, fully_complimentary
-- Payment Statuses: unpaid, unpaid_deposit, paid_rate, partial, paid, refunded, cancelled
-- ============================================================================

-- ============================================================================
-- CHECKED_IN bookings (Currently staying)
-- ============================================================================

-- Booking 1: CHECKED_IN + UNPAID (Sarah Johnson - Room 201)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source, deposit_paid, deposit_amount, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-1001',
    g.id, (SELECT id FROM rooms WHERE room_number = '201' LIMIT 1),
    CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '3 days', 2, 0,
    200.00, 800.00, 80.00, 880.00, 'checked_in', 'unpaid', 'normal_stay',
    CURRENT_DATE - INTERVAL '1 day' + TIME '14:00:00', 'online', false, 0,
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '5 days'
FROM guests g WHERE g.email = 'sarah.johnson@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 2: CHECKED_IN + UNPAID_DEPOSIT (David Lee - Room 203)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source, deposit_paid, deposit_amount, deposit_paid_at, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-1002',
    g.id, (SELECT id FROM rooms WHERE room_number = '203' LIMIT 1),
    CURRENT_DATE, CURRENT_DATE + INTERVAL '2 days', 1, 0,
    180.00, 360.00, 36.00, 396.00, 'checked_in', 'unpaid_deposit', 'same_day',
    CURRENT_DATE + TIME '15:30:00', 'walk_in', true, 100.00, CURRENT_TIMESTAMP - INTERVAL '1 day',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1), CURRENT_DATE - INTERVAL '1 hour'
FROM guests g WHERE g.email = 'david.lee@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 3: CHECKED_IN + PAID_RATE (Michael Brown - Room 204) - Corporate billing
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source, deposit_paid, company_id, company_name, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-1003',
    g.id, (SELECT id FROM rooms WHERE room_number = '204' LIMIT 1),
    CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE + INTERVAL '1 day', 1, 0,
    180.00, 540.00, 54.00, 594.00, 'checked_in', 'paid_rate', 'normal_stay',
    CURRENT_DATE - INTERVAL '2 days' + TIME '16:00:00', 'corporate', false,
    (SELECT id FROM companies WHERE company_name = 'Tech Corp International' LIMIT 1), 'Tech Corp International',
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1), CURRENT_DATE - INTERVAL '7 days'
FROM guests g WHERE g.email = 'michael.brown@corporate.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 4: CHECKED_IN + PARTIAL (Lisa Davis - Room 205)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source, deposit_paid, deposit_amount, deposit_paid_at, is_tourist, tourism_tax_amount,
    payment_note, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-1004',
    g.id, (SELECT id FROM rooms WHERE room_number = '205' LIMIT 1),
    CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days', 2, 1,
    200.00, 1000.00, 100.00, 1150.00, 'checked_in', 'partial', 'normal_stay',
    CURRENT_DATE + TIME '11:00:00', 'agent', true, 300.00, CURRENT_TIMESTAMP - INTERVAL '10 days',
    true, 50.00, 'Paid 50% upfront, balance due at checkout',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '14 days'
FROM guests g WHERE g.email = 'lisa.davis@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 5: CHECKED_IN + PAID (VIP Guest - Room 302) - Fully complimentary
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source, is_complimentary, complimentary_reason,
    complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights,
    created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-1005',
    g.id, (SELECT id FROM rooms WHERE room_number = '302' LIMIT 1),
    CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '2 days', 2, 0,
    250.00, 0.00, 0.00, 0.00, 'checked_in', 'paid', 'normal_stay',
    CURRENT_DATE - INTERVAL '1 day' + TIME '14:00:00', 'direct',
    true, 'VIP Guest - Management approved complimentary stay',
    CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '2 days', 750.00, 3,
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1), CURRENT_DATE - INTERVAL '3 days'
FROM guests g WHERE g.email = 'vip.guest@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- CONFIRMED bookings (Future reservations)
-- ============================================================================

-- Booking 6: CONFIRMED + UNPAID (Robert Wilson - Room 101)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, special_requests, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '3 days', 'YYYYMMDD') || '-1006',
    g.id, (SELECT id FROM rooms WHERE room_number = '101' LIMIT 1),
    CURRENT_DATE + INTERVAL '3 days', CURRENT_DATE + INTERVAL '6 days', 2, 0,
    150.00, 450.00, 45.00, 495.00, 'confirmed', 'unpaid', 'normal_stay', 'online',
    'Late check-in expected around 10pm',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '5 days'
FROM guests g WHERE g.email = 'robert.wilson@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 7: CONFIRMED + UNPAID_DEPOSIT (Maria Gonzalez - Room 102)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, deposit_paid, deposit_amount, deposit_paid_at, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'YYYYMMDD') || '-1007',
    g.id, (SELECT id FROM rooms WHERE room_number = '102' LIMIT 1),
    CURRENT_DATE + INTERVAL '7 days', CURRENT_DATE + INTERVAL '9 days', 1, 0,
    150.00, 300.00, 30.00, 330.00, 'confirmed', 'unpaid_deposit', 'normal_stay', 'website',
    true, 100.00, CURRENT_TIMESTAMP - INTERVAL '2 days',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1), CURRENT_DATE - INTERVAL '3 days'
FROM guests g WHERE g.email = 'maria.gonzalez@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 8: CONFIRMED + PAID (Yuki Tanaka - Room 103)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, deposit_paid, deposit_amount, deposit_paid_at, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-1008',
    g.id, (SELECT id FROM rooms WHERE room_number = '103' LIMIT 1),
    CURRENT_DATE, CURRENT_DATE + INTERVAL '2 days', 1, 0,
    150.00, 300.00, 30.00, 330.00, 'confirmed', 'paid', 'normal_stay', 'mobile',
    true, 330.00, CURRENT_TIMESTAMP - INTERVAL '1 day',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '1 day'
FROM guests g WHERE g.email = 'yuki.tanaka@email.jp'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- PENDING bookings (Awaiting confirmation)
-- ============================================================================

-- Booking 9: PENDING + UNPAID (Online Booker - Room 104)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, special_requests, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '14 days', 'YYYYMMDD') || '-1009',
    g.id, (SELECT id FROM rooms WHERE room_number = '104' LIMIT 1),
    CURRENT_DATE + INTERVAL '14 days', CURRENT_DATE + INTERVAL '17 days', 2, 0,
    150.00, 450.00, 45.00, 495.00, 'pending', 'unpaid', 'normal_stay', 'website',
    'Honeymoon trip - special decoration requested',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '1 hour'
FROM guests g WHERE g.email = 'online.booker@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- CHECKED_OUT bookings (Completed stays)
-- ============================================================================

-- Booking 10: CHECKED_OUT + PAID (Emily Williams - Room 301)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, actual_check_out, source, deposit_paid, deposit_amount, deposit_paid_at,
    created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '5 days', 'YYYYMMDD') || '-1010',
    g.id, (SELECT id FROM rooms WHERE room_number = '301' LIMIT 1),
    CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE - INTERVAL '2 days', 2, 0,
    250.00, 750.00, 75.00, 825.00, 'checked_out', 'paid', 'normal_stay',
    CURRENT_DATE - INTERVAL '5 days' + TIME '14:00:00', CURRENT_DATE - INTERVAL '2 days' + TIME '11:00:00',
    'direct', true, 250.00, CURRENT_TIMESTAMP - INTERVAL '7 days',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1), CURRENT_DATE - INTERVAL '10 days'
FROM guests g WHERE g.email = 'emily.williams@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 11: CHECKED_OUT + UNPAID (Walk-in) - Balance pending collection
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, actual_check_out, source, payment_note, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '3 days', 'YYYYMMDD') || '-1011',
    g.id, (SELECT id FROM rooms WHERE room_number = '401' LIMIT 1),
    CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE - INTERVAL '2 days', 1, 0,
    350.00, 350.00, 35.00, 385.00, 'checked_out', 'unpaid', 'same_day',
    CURRENT_DATE - INTERVAL '3 days' + TIME '18:00:00', CURRENT_DATE - INTERVAL '2 days' + TIME '10:30:00',
    'walk_in', 'Guest left without paying - follow up required',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1), CURRENT_DATE - INTERVAL '3 days'
FROM guests g WHERE g.email = 'walkin@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- COMPLETED bookings (Fully processed)
-- ============================================================================

-- Booking 12: COMPLETED + PAID (Gold Member - Room 301)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, discount_percentage, status, payment_status, post_type,
    actual_check_in, actual_check_out, source, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '30 days', 'YYYYMMDD') || '-1012',
    g.id, (SELECT id FROM rooms WHERE room_number = '301' LIMIT 1),
    CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '27 days', 2, 0,
    250.00, 637.50, 63.75, 701.25, 15.00, 'completed', 'paid', 'normal_stay',
    CURRENT_DATE - INTERVAL '30 days' + TIME '15:00:00', CURRENT_DATE - INTERVAL '27 days' + TIME '10:00:00',
    'online',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '45 days'
FROM guests g WHERE g.email = 'member.gold@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- CANCELLED bookings
-- ============================================================================

-- Booking 13: CANCELLED + UNPAID (Thomas White)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, cancellation_reason, cancelled_at, cancelled_by, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '10 days', 'YYYYMMDD') || '-1013',
    g.id, (SELECT id FROM rooms WHERE room_number = '402' LIMIT 1),
    CURRENT_DATE + INTERVAL '10 days', CURRENT_DATE + INTERVAL '12 days', 2, 0,
    350.00, 700.00, 70.00, 770.00, 'cancelled', 'unpaid', 'normal_stay', 'phone',
    'Guest requested cancellation due to travel plans change',
    CURRENT_TIMESTAMP - INTERVAL '1 day', (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1),
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '7 days'
FROM guests g WHERE g.email = 'thomas.white@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 14: CANCELLED + CANCELLED payment status (Corporate VIP - deposit refunded)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, deposit_paid, deposit_amount, cancellation_reason, cancelled_at, cancelled_by,
    payment_note, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '20 days', 'YYYYMMDD') || '-1014',
    g.id, (SELECT id FROM rooms WHERE room_number = '303' LIMIT 1),
    CURRENT_DATE + INTERVAL '20 days', CURRENT_DATE + INTERVAL '25 days', 1, 0,
    200.00, 1000.00, 100.00, 1100.00, 'cancelled', 'cancelled', 'normal_stay', 'corporate',
    true, 300.00, 'Corporate event cancelled', CURRENT_TIMESTAMP - INTERVAL '2 days',
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1),
    'Deposit refunded to corporate account',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '15 days'
FROM guests g WHERE g.email = 'corporate.vip@techcorp.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- NO_SHOW bookings
-- ============================================================================

-- Booking 15: NO_SHOW + UNPAID_DEPOSIT (James Anderson)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, deposit_paid, deposit_amount, deposit_paid_at, payment_note, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '1 day', 'YYYYMMDD') || '-1015',
    g.id, (SELECT id FROM rooms WHERE room_number = '403' LIMIT 1),
    CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '1 day', 1, 0,
    350.00, 700.00, 70.00, 770.00, 'no_show', 'unpaid_deposit', 'normal_stay', 'online',
    true, 200.00, CURRENT_TIMESTAMP - INTERVAL '5 days',
    'Deposit forfeited due to no-show',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '7 days'
FROM guests g WHERE g.email = 'james.anderson@techcorp.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- RELEASED bookings (Room released for guest credit use elsewhere)
-- ============================================================================

-- Booking 16: RELEASED + PAID (Silver Member)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    source, is_complimentary, complimentary_reason, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '7 days', 'YYYYMMDD') || '-1016',
    g.id, (SELECT id FROM rooms WHERE room_number = '301' LIMIT 1),
    CURRENT_DATE - INTERVAL '7 days', CURRENT_DATE - INTERVAL '5 days', 1, 0,
    250.00, 0.00, 0.00, 0.00, 'released', 'paid', 'normal_stay', 'direct',
    true, 'Complimentary night credit used - room released to inventory',
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1), CURRENT_DATE - INTERVAL '14 days'
FROM guests g WHERE g.email = 'member.silver@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- PARTIAL_COMPLIMENTARY bookings
-- ============================================================================

-- Booking 17: PARTIAL_COMPLIMENTARY + PARTIAL payment (Jennifer Martinez - Room 303)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source, is_complimentary, complimentary_reason,
    complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights,
    deposit_paid, deposit_amount, deposit_paid_at, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-1017',
    g.id, (SELECT id FROM rooms WHERE room_number = '303' LIMIT 1),
    CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE + INTERVAL '3 days', 2, 1,
    200.00, 600.00, 60.00, 660.00, 'partial_complimentary', 'partial', 'normal_stay',
    CURRENT_DATE - INTERVAL '2 days' + TIME '15:00:00', 'phone',
    true, 'Loyalty reward - 2 nights complimentary out of 5',
    CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE,
    1000.00, 2, true, 200.00, CURRENT_TIMESTAMP - INTERVAL '5 days',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '10 days'
FROM guests g WHERE g.email = 'jennifer.martinez@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- FULLY_COMPLIMENTARY bookings
-- ============================================================================

-- Booking 18: FULLY_COMPLIMENTARY + PAID (Bronze Member)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, actual_check_out, source, is_complimentary, complimentary_reason,
    complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights,
    created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '10 days', 'YYYYMMDD') || '-1018',
    g.id, (SELECT id FROM rooms WHERE room_number = '101' LIMIT 1),
    CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE - INTERVAL '8 days', 1, 0,
    150.00, 0.00, 0.00, 0.00, 'fully_complimentary', 'paid', 'normal_stay',
    CURRENT_DATE - INTERVAL '10 days' + TIME '14:00:00', CURRENT_DATE - INTERVAL '8 days' + TIME '11:00:00',
    'direct', true, 'Welcome gift - new member first night free',
    CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE - INTERVAL '8 days', 300.00, 2,
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '15 days'
FROM guests g WHERE g.email = 'member.bronze@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- REFUNDED payment status
-- ============================================================================

-- Booking 19: CHECKED_OUT + REFUNDED (Refund Customer)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, actual_check_out, source, deposit_paid, deposit_amount,
    payment_note, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '7 days', 'YYYYMMDD') || '-1019',
    g.id, (SELECT id FROM rooms WHERE room_number = '402' LIMIT 1),
    CURRENT_DATE - INTERVAL '7 days', CURRENT_DATE - INTERVAL '5 days', 2, 0,
    350.00, 700.00, 70.00, 770.00, 'checked_out', 'refunded', 'normal_stay',
    CURRENT_DATE - INTERVAL '7 days' + TIME '15:00:00', CURRENT_DATE - INTERVAL '5 days' + TIME '09:00:00',
    'online', true, 770.00,
    'Full refund issued due to AC malfunction - guest complaint resolved',
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1), CURRENT_DATE - INTERVAL '14 days'
FROM guests g WHERE g.email = 'refund.customer@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 20: Extra bed booking (John Smith - Room 401)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, total_amount, status, payment_status, post_type,
    actual_check_in, source, extra_bed_count, extra_bed_charge, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-1020',
    g.id, (SELECT id FROM rooms WHERE room_number = '401' LIMIT 1),
    CURRENT_DATE, CURRENT_DATE + INTERVAL '3 days', 4, 2,
    350.00, 1170.00, 117.00, 1287.00, 'checked_in', 'unpaid_deposit', 'normal_stay',
    CURRENT_DATE + TIME '13:00:00', 'phone', 2, 80.00,
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1), CURRENT_DATE - INTERVAL '3 days'
FROM guests g WHERE g.email = 'john.smith@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- ROOM CHANGES - Sample room change history
-- ============================================================================

-- Room change 1: Sarah Johnson moved from 201 to 202 (upgrade)
INSERT INTO room_changes (booking_id, from_room_id, to_room_id, guest_id, reason, changed_by, changed_at)
SELECT b.id,
    (SELECT id FROM rooms WHERE room_number = '201' LIMIT 1),
    (SELECT id FROM rooms WHERE room_number = '202' LIMIT 1),
    b.guest_id,
    'Complimentary upgrade due to room issue',
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1),
    CURRENT_TIMESTAMP - INTERVAL '12 hours'
FROM bookings b WHERE b.booking_number LIKE 'BK-%-1001'
ON CONFLICT DO NOTHING;

-- Room change 2: VIP Guest moved from 301 to 302 (preference)
INSERT INTO room_changes (booking_id, from_room_id, to_room_id, guest_id, reason, changed_by, changed_at)
SELECT b.id,
    (SELECT id FROM rooms WHERE room_number = '301' LIMIT 1),
    (SELECT id FROM rooms WHERE room_number = '302' LIMIT 1),
    b.guest_id,
    'Guest requested higher floor with better view',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1),
    CURRENT_TIMESTAMP - INTERVAL '1 day'
FROM bookings b WHERE b.booking_number LIKE 'BK-%-1005'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- UPDATE ROOM STATUSES - All possible statuses
-- ============================================================================

-- Reset all rooms to available first
UPDATE rooms SET status = 'available';

-- Set rooms with checked_in bookings to occupied
UPDATE rooms SET status = 'occupied'
WHERE id IN (SELECT DISTINCT room_id FROM bookings WHERE status = 'checked_in');

-- Set rooms with confirmed/pending bookings for today to reserved
UPDATE rooms SET status = 'reserved'
WHERE id IN (
    SELECT DISTINCT room_id FROM bookings
    WHERE status IN ('confirmed', 'pending')
    AND check_in_date <= CURRENT_DATE + INTERVAL '1 day'
) AND status != 'occupied';

-- Set specific rooms to other statuses for testing
UPDATE rooms SET status = 'maintenance', status_notes = 'AC unit repair in progress' WHERE room_number = '105';
UPDATE rooms SET status = 'cleaning', status_notes = 'Deep cleaning scheduled' WHERE room_number = '202';
UPDATE rooms SET status = 'dirty', status_notes = 'Guest checkout - awaiting housekeeping' WHERE room_number = '301';
UPDATE rooms SET status = 'out_of_order', status_notes = 'Water damage - under renovation' WHERE room_number = '403';

-- ============================================================================
-- SUMMARY OF COMPREHENSIVE SEED DATA
-- ============================================================================
-- Companies: 5 (4 active, 1 inactive)
-- Guests: 20 with various profiles
--   - guest_type: 12 non_member, 8 member
--   - discount_percentage: 0%, 5%, 10%, 12%, 15%, 20%, 25%, 30%, 35%, 50%
--   - vip_status: NULL, Bronze, Silver, Gold, Platinum, Diamond, VIP, Corporate, Corporate VIP
--
-- Bookings: 20 covering ALL combinations:
--   Statuses:
--     - checked_in: 6
--     - confirmed: 3
--     - pending: 1
--     - checked_out: 2
--     - completed: 1
--     - cancelled: 2
--     - no_show: 1
--     - released: 1
--     - partial_complimentary: 1
--     - fully_complimentary: 1
--
--   Payment Statuses:
--     - unpaid: 4
--     - unpaid_deposit: 4
--     - paid_rate: 1
--     - partial: 2
--     - paid: 6
--     - refunded: 1
--     - cancelled: 1
--
-- Room Changes: 2 sample records
--
-- Room Statuses:
--   - available: multiple
--   - occupied: 6 (from checked_in bookings)
--   - reserved: 3 (from confirmed/pending)
--   - maintenance: 1 (Room 105)
--   - cleaning: 1 (Room 202)
--   - dirty: 1 (Room 301)
--   - out_of_order: 1 (Room 403)
-- ============================================================================
