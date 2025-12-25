-- ============================================================================
-- PAYMENT & INVOICE SEED DATA
-- ============================================================================
-- Sample payment data matching the payments table schema
-- ============================================================================

-- ============================================================================
-- PAYMENTS
-- ============================================================================

-- Payment 1: Booking 1 - Credit Card payment
INSERT INTO payments (
    booking_id, amount, currency, payment_method, payment_type,
    transaction_id, card_last_four, card_brand, payment_gateway,
    status, created_by, processed_at, processed_by
)
SELECT
    b.id,
    495.00,
    'USD',
    'card',
    'booking',
    'pi_' || md5(random()::text),
    '4242',
    'Visa',
    'stripe',
    'completed',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1),
    CURRENT_TIMESTAMP - INTERVAL '3 days',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
FROM bookings b
WHERE b.booking_number LIKE '%-0001'
AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id)
LIMIT 1;

-- Payment 2: Booking 2 - Cash payment at check-in
INSERT INTO payments (
    booking_id, amount, currency, payment_method, payment_type,
    transaction_id, payment_gateway, status, notes,
    created_by, processed_at, processed_by
)
SELECT
    b.id,
    1100.00,
    'USD',
    'cash',
    'booking',
    'CSH-' || b.booking_number,
    'manual',
    'completed',
    'Paid in cash at check-in',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1),
    CURRENT_TIMESTAMP - INTERVAL '2 days',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1)
FROM bookings b
WHERE b.booking_number LIKE '%-0002'
AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id)
LIMIT 1;

-- Payment 3: Booking 3 - Card payment for completed stay
INSERT INTO payments (
    booking_id, amount, currency, payment_method, payment_type,
    transaction_id, card_last_four, card_brand, payment_gateway,
    status, created_by, processed_at, processed_by
)
SELECT
    b.id,
    825.00,
    'USD',
    'card',
    'booking',
    'pi_' || md5(random()::text),
    '5555',
    'Mastercard',
    'stripe',
    'completed',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1),
    CURRENT_TIMESTAMP - INTERVAL '6 days',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1)
FROM bookings b
WHERE b.booking_number LIKE '%-0003'
AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id)
LIMIT 1;

-- Payment 4: Booking 4 - Refunded (cancelled booking)
INSERT INTO payments (
    booking_id, amount, currency, payment_method, payment_type,
    transaction_id, card_last_four, card_brand, payment_gateway,
    status, refund_amount, refunded_at, refund_reason,
    created_by, processed_at, processed_by
)
SELECT
    b.id,
    247.50,
    'USD',
    'card',
    'booking',
    'pi_' || md5(random()::text),
    '3782',
    'Amex',
    'stripe',
    'refunded',
    247.50,
    CURRENT_TIMESTAMP - INTERVAL '1 day',
    'Booking cancelled by guest',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1),
    CURRENT_TIMESTAMP - INTERVAL '15 days',
    (SELECT id FROM users WHERE username = 'admin' LIMIT 1)
FROM bookings b
WHERE b.booking_number LIKE '%-0004'
AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id)
LIMIT 1;

-- Payment 5: Booking 6 - Partial payment (deposit)
INSERT INTO payments (
    booking_id, amount, currency, payment_method, payment_type,
    transaction_id, payment_gateway, status, notes,
    created_by, processed_at, processed_by
)
SELECT
    b.id,
    132.00,
    'USD',
    'card',
    'deposit',
    'pi_' || md5(random()::text),
    'stripe',
    'completed',
    '50% deposit for family booking',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1),
    CURRENT_TIMESTAMP - INTERVAL '1 day',
    (SELECT id FROM users WHERE username = 'receptionist2' LIMIT 1)
FROM bookings b
WHERE b.booking_number LIKE '%-0006'
AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id)
LIMIT 1;

-- Payment 6: Booking 7 - Corporate booking (invoiced)
INSERT INTO payments (
    booking_id, amount, currency, payment_method, payment_type,
    transaction_id, payment_gateway, status, notes,
    created_by, processed_at, processed_by
)
SELECT
    b.id,
    866.25,
    'USD',
    'bank_transfer',
    'booking',
    'CORP-INV-' || b.booking_number,
    'manual',
    'completed',
    'Corporate billing - TechCorp Inc.',
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1),
    CURRENT_TIMESTAMP - INTERVAL '5 days',
    (SELECT id FROM users WHERE username = 'manager1' LIMIT 1)
FROM bookings b
WHERE b.booking_number LIKE '%-0007'
AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id)
LIMIT 1;

-- Payment 7: Booking 8 - Same day payment
INSERT INTO payments (
    booking_id, amount, currency, payment_method, payment_type,
    transaction_id, card_last_four, card_brand, payment_gateway,
    status, created_by, processed_at, processed_by
)
SELECT
    b.id,
    165.00,
    'USD',
    'card',
    'booking',
    'pi_' || md5(random()::text),
    '4000',
    'Visa',
    'stripe',
    'completed',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1),
    CURRENT_TIMESTAMP - INTERVAL '2 hours',
    (SELECT id FROM users WHERE username = 'receptionist1' LIMIT 1)
FROM bookings b
WHERE b.booking_number LIKE '%-0008'
AND NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = b.id)
LIMIT 1;

\echo '✓ Payment seed data loaded successfully'
\echo '✓ Created 7 payments covering various methods and statuses'
