-- ============================================================================
-- SEED 04: GUESTS, BOOKINGS & PAYMENTS
-- ============================================================================
-- Description: Guest profiles, booking scenarios, payment transactions, reviews
-- ============================================================================

-- ============================================================================
-- GUESTS - Various profiles and data completeness levels
-- ============================================================================

INSERT INTO guests (full_name, first_name, last_name, email, phone, address_line_1, city, state, postal_code, country, created_at) VALUES
    ('John Smith', 'John', 'Smith', 'john.smith@email.com', '+1-555-1001', '123 Main Street, Apt 4B', 'New York', 'NY', '10001', 'United States', CURRENT_TIMESTAMP - INTERVAL '200 days'),
    ('Sarah Johnson', 'Sarah', 'Johnson', 'sarah.johnson@email.com', '+1-555-1002', '456 Park Avenue, Suite 1200', 'San Francisco', 'CA', '94102', 'United States', CURRENT_TIMESTAMP - INTERVAL '150 days'),
    ('Emily Williams', 'Emily', 'Williams', 'emily.williams@email.com', '+1-555-1003', '789 Beverly Hills Blvd', 'Los Angeles', 'CA', '90210', 'United States', CURRENT_TIMESTAMP - INTERVAL '400 days'),
    ('Michael Brown', 'Michael', 'Brown', 'michael.brown@corporate.com', '+1-555-1004', '321 Corporate Plaza', 'Chicago', 'IL', '60601', 'United States', CURRENT_TIMESTAMP - INTERVAL '300 days'),
    ('Lisa Davis', 'Lisa', 'Davis', 'lisa.davis@email.com', '+1-555-1005', '654 Sunset Boulevard', 'Miami', 'FL', '33101', 'United States', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
    ('Robert Wilson', 'Robert', 'Wilson', 'robert.wilson@email.com', '+44-20-1234-5678', '10 Downing Street', 'London', 'England', 'SW1A 2AA', 'United Kingdom', CURRENT_TIMESTAMP - INTERVAL '100 days'),
    ('María González', 'María', 'González', 'maria.gonzalez@email.com', '+34-91-123-4567', 'Calle Gran Vía 28', 'Madrid', 'Comunidad de Madrid', '28013', 'Spain', CURRENT_TIMESTAMP - INTERVAL '75 days'),
    ('Jennifer Martinez', 'Jennifer', 'Martinez', 'jennifer.martinez@email.com', '+1-555-1009', '987 Ocean Drive', 'Miami Beach', 'FL', '33139', 'United States', CURRENT_TIMESTAMP - INTERVAL '7 days'),
    ('James Anderson', 'James', 'Anderson', 'james.anderson@techcorp.com', '+1-555-1010', '1 Silicon Valley Drive', 'Palo Alto', 'CA', '94304', 'United States', CURRENT_TIMESTAMP - INTERVAL '60 days'),
    ('Thomas White', 'Thomas', 'White', 'thomas.white@email.com', '+1-555-1011', NULL, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP - INTERVAL '500 days'),
    ('Yuki Tanaka', 'Yuki', 'Tanaka', 'yuki.tanaka@email.jp', '+81-3-1234-5678', '1-2-3 Shibuya', 'Tokyo', NULL, NULL, 'Japan', CURRENT_TIMESTAMP - INTERVAL '45 days');

-- Minimal profile guest
INSERT INTO guests (full_name, first_name, last_name, email, phone, created_at)
VALUES ('David Lee', 'David', 'Lee', 'david.lee@email.com', '+1-555-1008', CURRENT_TIMESTAMP - INTERVAL '30 days');

-- ============================================================================
-- BOOKINGS - Comprehensive test scenarios covering all statuses
-- ============================================================================

-- Booking 1: CONFIRMED - Future booking (John Smith)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount, status, payment_status,
    special_requests, source, channel, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '7 days', 'YYYYMMDD') || '-0001',
    g.id, (SELECT id FROM rooms WHERE room_number = '101' LIMIT 1),
    CURRENT_DATE + INTERVAL '7 days', CURRENT_DATE + INTERVAL '10 days', 2, 0,
    (SELECT id FROM rate_plans WHERE code = 'RACK' LIMIT 1), 150.00, 450.00, 45.00, 495.00,
    'confirmed', 'paid', 'High floor preferred, late check-in expected', 'website', 'direct',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '3 days'
FROM guests g WHERE g.email = 'john.smith@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Reserve room 101
UPDATE rooms SET status = 'reserved' WHERE room_number = '101';

-- Booking 2: CHECKED_IN - Currently staying (Sarah Johnson)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount, status, payment_status,
    actual_check_in, special_requests, source, channel, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '2 days', 'YYYYMMDD') || '-0002',
    g.id, (SELECT id FROM rooms WHERE room_number = '201' LIMIT 1),
    CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE + INTERVAL '3 days', 2, 1,
    (SELECT id FROM rate_plans WHERE code = 'WKND' LIMIT 1), 200.00, 1000.00, 100.00, 1100.00,
    'checked_in', 'paid', CURRENT_DATE - INTERVAL '2 days' + TIME '15:30:00',
    'Celebrating anniversary, champagne and flowers requested', 'phone', 'phone',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1), CURRENT_DATE - INTERVAL '10 days'
FROM guests g WHERE g.email = 'sarah.johnson@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Occupy room 201
UPDATE rooms SET status = 'occupied' WHERE room_number = '201';

-- Booking 3: CHECKED_OUT - Completed stay (Emily Williams - VIP)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount, status, payment_status,
    actual_check_in, actual_check_out, special_requests, source, channel, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE - INTERVAL '5 days', 'YYYYMMDD') || '-0003',
    g.id, (SELECT id FROM rooms WHERE room_number = '301' LIMIT 1),
    CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE - INTERVAL '2 days', 2, 0,
    (SELECT id FROM rate_plans WHERE code = 'RACK' LIMIT 1), 250.00, 750.00, 75.00, 825.00,
    'checked_out', 'paid',
    CURRENT_DATE - INTERVAL '5 days' + TIME '14:00:00', CURRENT_DATE - INTERVAL '2 days' + TIME '11:30:00',
    'VIP guest - ensure room upgrade if available', 'direct', 'walk_in',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1), CURRENT_DATE - INTERVAL '6 days'
FROM guests g WHERE g.email = 'emily.williams@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 4: CANCELLED - (Michael Brown)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount, status, payment_status,
    special_requests, source, channel, cancelled_at, cancellation_reason, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '3 days', 'YYYYMMDD') || '-0004',
    g.id, (SELECT id FROM rooms WHERE room_number = '102' LIMIT 1),
    CURRENT_DATE + INTERVAL '3 days', CURRENT_DATE + INTERVAL '5 days', 1, 0,
    (SELECT id FROM rate_plans WHERE code = 'CORP' LIMIT 1), 112.50, 225.00, 22.50, 247.50,
    'cancelled', 'refunded', 'Ground floor preferred', 'website', 'direct',
    CURRENT_DATE - INTERVAL '1 day', 'Business trip cancelled due to meeting rescheduling',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '15 days'
FROM guests g WHERE g.email = 'michael.brown@corporate.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 5: PENDING - Awaiting payment (Lisa Davis)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount, status, payment_status,
    special_requests, source, channel, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '30 days', 'YYYYMMDD') || '-0005',
    g.id, (SELECT id FROM rooms WHERE room_number = '103' LIMIT 1),
    CURRENT_DATE + INTERVAL '30 days', CURRENT_DATE + INTERVAL '33 days', 2, 0,
    (SELECT id FROM rate_plans WHERE code = 'EARLY' LIMIT 1), 127.50, 382.50, 38.25, 420.75,
    'pending', 'unpaid', 'Quiet room requested', 'website', 'direct',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_DATE - INTERVAL '1 hour'
FROM guests g WHERE g.email = 'lisa.davis@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Booking 6: CONFIRMED - Weekend family booking (Jennifer Martinez)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount, status, payment_status,
    special_requests, source, channel, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '14 days', 'YYYYMMDD') || '-0006',
    g.id, (SELECT id FROM rooms WHERE room_number = '401' LIMIT 1),
    CURRENT_DATE + INTERVAL '14 days', CURRENT_DATE + INTERVAL '16 days', 2, 2,
    (SELECT id FROM rate_plans WHERE code = 'WKND' LIMIT 1), 120.00, 240.00, 24.00, 264.00,
    'confirmed', 'partial', 'Crib needed for infant, extra towels', 'direct', 'walk_in',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1), CURRENT_DATE - INTERVAL '1 day'
FROM guests g WHERE g.email = 'jennifer.martinez@email.com'
ON CONFLICT (booking_number) DO NOTHING;

UPDATE rooms SET status = 'reserved' WHERE room_number = '401';

-- Booking 7: CONFIRMED - Long stay corporate (James Anderson)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount, status, payment_status,
    special_requests, source, channel, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE + INTERVAL '5 days', 'YYYYMMDD') || '-0007',
    g.id, (SELECT id FROM rooms WHERE room_number = '203' LIMIT 1),
    CURRENT_DATE + INTERVAL '5 days', CURRENT_DATE + INTERVAL '12 days', 1, 0,
    (SELECT id FROM rate_plans WHERE code = 'CORP' LIMIT 1), 112.50, 787.50, 78.75, 866.25,
    'confirmed', 'paid', 'Corporate account - TechCorp Inc., billing to company', 'email', 'corporate',
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1), CURRENT_DATE - INTERVAL '5 days'
FROM guests g WHERE g.email = 'james.anderson@techcorp.com'
ON CONFLICT (booking_number) DO NOTHING;

UPDATE rooms SET status = 'reserved' WHERE room_number = '203';

-- Booking 8: CONFIRMED - Same day booking (Yuki Tanaka)
INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount, status, payment_status,
    special_requests, source, channel, created_by, created_at)
SELECT 'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0008',
    g.id, (SELECT id FROM rooms WHERE room_number = '104' LIMIT 1),
    CURRENT_DATE, CURRENT_DATE + INTERVAL '1 day', 1, 0,
    (SELECT id FROM rate_plans WHERE code = 'RACK' LIMIT 1), 150.00, 150.00, 15.00, 165.00,
    'confirmed', 'paid', 'Last minute booking, contactless check-in preferred', 'mobile', 'mobile_app',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1), CURRENT_DATE - INTERVAL '2 hours'
FROM guests g WHERE g.email = 'yuki.tanaka@email.jp'
ON CONFLICT (booking_number) DO NOTHING;

-- ============================================================================
-- PAYMENTS - Various payment methods and statuses
-- ============================================================================

-- Payment 1: Booking 1 - Credit Card (Visa)
INSERT INTO payments (booking_id, amount, currency, payment_method, payment_type, transaction_id, card_last_four, card_brand, payment_gateway, status, created_by, processed_at, processed_by)
SELECT b.id, 495.00, 'USD', 'card', 'booking', 'pi_' || md5(random()::text), '4242', 'Visa', 'stripe', 'completed',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_TIMESTAMP - INTERVAL '3 days',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
FROM bookings b WHERE b.booking_number LIKE '%-0001' AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id) LIMIT 1;

-- Payment 2: Booking 2 - Cash payment at check-in
INSERT INTO payments (booking_id, amount, currency, payment_method, payment_type, transaction_id, payment_gateway, status, notes, created_by, processed_at, processed_by)
SELECT b.id, 1100.00, 'USD', 'cash', 'booking', 'CSH-' || b.booking_number, 'manual', 'completed', 'Paid in cash at check-in',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1), CURRENT_TIMESTAMP - INTERVAL '2 days',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1)
FROM bookings b WHERE b.booking_number LIKE '%-0002' AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id) LIMIT 1;

-- Payment 3: Booking 3 - Mastercard
INSERT INTO payments (booking_id, amount, currency, payment_method, payment_type, transaction_id, card_last_four, card_brand, payment_gateway, status, created_by, processed_at, processed_by)
SELECT b.id, 825.00, 'USD', 'card', 'booking', 'pi_' || md5(random()::text), '5555', 'Mastercard', 'stripe', 'completed',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1), CURRENT_TIMESTAMP - INTERVAL '6 days',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1)
FROM bookings b WHERE b.booking_number LIKE '%-0003' AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id) LIMIT 1;

-- Payment 4: Booking 4 - Refunded (Amex)
INSERT INTO payments (booking_id, amount, currency, payment_method, payment_type, transaction_id, card_last_four, card_brand, payment_gateway, status, refund_amount, refunded_at, refund_reason, created_by, processed_at, processed_by)
SELECT b.id, 247.50, 'USD', 'card', 'booking', 'pi_' || md5(random()::text), '3782', 'Amex', 'stripe', 'refunded',
    247.50, CURRENT_TIMESTAMP - INTERVAL '1 day', 'Booking cancelled by guest',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1), CURRENT_TIMESTAMP - INTERVAL '15 days',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
FROM bookings b WHERE b.booking_number LIKE '%-0004' AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id) LIMIT 1;

-- Payment 5: Booking 6 - Partial deposit
INSERT INTO payments (booking_id, amount, currency, payment_method, payment_type, transaction_id, payment_gateway, status, notes, created_by, processed_at, processed_by)
SELECT b.id, 132.00, 'USD', 'card', 'deposit', 'pi_' || md5(random()::text), 'stripe', 'completed', '50% deposit for family booking',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1), CURRENT_TIMESTAMP - INTERVAL '1 day',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1)
FROM bookings b WHERE b.booking_number LIKE '%-0006' AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id) LIMIT 1;

-- Payment 6: Booking 7 - Corporate bank transfer
INSERT INTO payments (booking_id, amount, currency, payment_method, payment_type, transaction_id, payment_gateway, status, notes, created_by, processed_at, processed_by)
SELECT b.id, 866.25, 'USD', 'bank_transfer', 'booking', 'CORP-INV-' || b.booking_number, 'manual', 'completed', 'Corporate billing - TechCorp Inc.',
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1), CURRENT_TIMESTAMP - INTERVAL '5 days',
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1)
FROM bookings b WHERE b.booking_number LIKE '%-0007' AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id) LIMIT 1;

-- Payment 7: Booking 8 - Same day Visa
INSERT INTO payments (booking_id, amount, currency, payment_method, payment_type, transaction_id, card_last_four, card_brand, payment_gateway, status, created_by, processed_at, processed_by)
SELECT b.id, 165.00, 'USD', 'card', 'booking', 'pi_' || md5(random()::text), '4000', 'Visa', 'stripe', 'completed',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1), CURRENT_TIMESTAMP - INTERVAL '2 hours',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1)
FROM bookings b WHERE b.booking_number LIKE '%-0008' AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id) LIMIT 1;

-- ============================================================================
-- GUEST REVIEWS - Various ratings
-- ============================================================================

-- Review 1: Excellent (Emily Williams - 5 stars)
INSERT INTO guest_reviews (guest_id, overall_rating, cleanliness_rating, service_rating, comfort_rating, value_rating, location_rating, title, content, pros, cons, created_at)
SELECT g.id, 5.0, 5.0, 5.0, 5.0, 4.5, 5.0,
    'Absolutely Amazing Experience!',
    'Our stay was exceptional from start to finish. The room was immaculate, staff was incredibly attentive, and the amenities exceeded our expectations.',
    'Perfect cleanliness, amazing staff, beautiful views, comfortable bed', 'Nothing to complain about', CURRENT_DATE - INTERVAL '1 day'
FROM guests g WHERE g.email = 'emily.williams@email.com';

-- Review 2: Good (John Smith - 4 stars)
INSERT INTO guest_reviews (guest_id, overall_rating, cleanliness_rating, service_rating, comfort_rating, value_rating, location_rating, title, content, pros, cons, created_at)
SELECT g.id, 4.0, 4.5, 4.5, 4.0, 4.0, 4.5,
    'Great Value for Money',
    'Very pleasant stay overall. Room was clean and comfortable. Staff was helpful and friendly. Good location near downtown.',
    'Clean rooms, friendly staff, good location, reasonable prices', 'WiFi could be faster, breakfast area gets crowded', CURRENT_DATE - INTERVAL '10 days'
FROM guests g WHERE g.email = 'john.smith@email.com';

-- Review 3: Critical (Robert Wilson - 2.5 stars)
INSERT INTO guest_reviews (guest_id, overall_rating, cleanliness_rating, service_rating, comfort_rating, value_rating, location_rating, title, content, pros, cons, created_at)
SELECT g.id, 2.5, 3.0, 3.5, 2.0, 2.5, 4.0,
    'Disappointed - Needs Improvement',
    'While the location was good, several aspects need improvement. Room had maintenance issues, air conditioning was noisy.',
    'Good location, polite staff', 'Room maintenance issues, noisy AC, inconsistent housekeeping, dated decor', CURRENT_DATE - INTERVAL '25 days'
FROM guests g WHERE g.email = 'robert.wilson@email.com';

DO $$ BEGIN RAISE NOTICE 'Guests & bookings loaded: 12 guests, 8 bookings, 7 payments, 3 reviews'; END $$;
