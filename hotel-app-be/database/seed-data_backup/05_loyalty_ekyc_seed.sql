-- ============================================================================
-- ENHANCED LOYALTY PROGRAM & eKYC SEED DATA
-- ============================================================================
-- Comprehensive test data covering all loyalty tiers, eKYC statuses, and edge cases
-- ============================================================================

-- ============================================================================
-- LOYALTY PROGRAMS
-- ============================================================================

INSERT INTO loyalty_programs (name, description, tier_level, points_multiplier, minimum_points_required, is_active, created_at)
VALUES
    ('Bronze', 'Entry level loyalty program', 1, 1.0, 0, true, CURRENT_TIMESTAMP),
    ('Silver', 'Silver tier with enhanced benefits', 2, 1.5, 1000, true, CURRENT_TIMESTAMP),
    ('Gold', 'Gold tier with premium benefits', 3, 2.0, 5000, true, CURRENT_TIMESTAMP),
    ('Platinum', 'Platinum tier with exclusive benefits', 4, 3.0, 15000, true, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- LOYALTY MEMBERSHIPS - All tiers and statuses
-- ============================================================================

-- Membership 1: John Smith - Bronze tier, active
INSERT INTO loyalty_memberships (
    guest_id, program_id, membership_number,
    points_balance, lifetime_points, tier_level, status,
    enrolled_date, expiry_date, created_at
)
SELECT
    g.id,
    lp.id,
    'LM-' || LPAD(g.id::TEXT, 8, '0') || '-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT,
    450,
    850,
    1,
    'active',
    CURRENT_DATE - INTERVAL '200 days',
    CURRENT_DATE + INTERVAL '1 year',
    CURRENT_DATE - INTERVAL '200 days'
FROM guests g
CROSS JOIN loyalty_programs lp
WHERE g.email = 'john.smith@email.com' AND lp.name = 'Bronze'
ON CONFLICT DO NOTHING;

-- Membership 2: Sarah Johnson - Silver tier, active
INSERT INTO loyalty_memberships (
    guest_id, program_id, membership_number,
    points_balance, lifetime_points, tier_level, status,
    enrolled_date, expiry_date, created_at
)
SELECT
    g.id,
    lp.id,
    'LM-' || LPAD(g.id::TEXT, 8, '0') || '-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT,
    2850,
    4200,
    2,
    'active',
    CURRENT_DATE - INTERVAL '150 days',
    CURRENT_DATE + INTERVAL '1 year',
    CURRENT_DATE - INTERVAL '150 days'
FROM guests g
CROSS JOIN loyalty_programs lp
WHERE g.email = 'sarah.johnson@email.com' AND lp.name = 'Silver'
ON CONFLICT DO NOTHING;

-- Membership 3: Emily Williams - Platinum tier, active (VIP)
INSERT INTO loyalty_memberships (
    guest_id, program_id, membership_number,
    points_balance, lifetime_points, tier_level, status,
    enrolled_date, expiry_date, created_at
)
SELECT
    g.id,
    lp.id,
    'LM-' || LPAD(g.id::TEXT, 8, '0') || '-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT,
    18500,
    25000,
    4,
    'active',
    CURRENT_DATE - INTERVAL '400 days',
    CURRENT_DATE + INTERVAL '1 year',
    CURRENT_DATE - INTERVAL '400 days'
FROM guests g
CROSS JOIN loyalty_programs lp
WHERE g.email = 'emily.williams@email.com' AND lp.name = 'Platinum'
ON CONFLICT DO NOTHING;

-- Membership 4: Michael Brown - Gold tier, active
INSERT INTO loyalty_memberships (
    guest_id, program_id, membership_number,
    points_balance, lifetime_points, tier_level, status,
    enrolled_date, expiry_date, created_at
)
SELECT
    g.id,
    lp.id,
    'LM-' || LPAD(g.id::TEXT, 8, '0') || '-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT,
    7200,
    12000,
    3,
    'active',
    CURRENT_DATE - INTERVAL '300 days',
    CURRENT_DATE + INTERVAL '1 year',
    CURRENT_DATE - INTERVAL '300 days'
FROM guests g
CROSS JOIN loyalty_programs lp
WHERE g.email = 'michael.brown@corporate.com' AND lp.name = 'Gold'
ON CONFLICT DO NOTHING;

-- Membership 5: Lisa Davis - Bronze tier, new member
INSERT INTO loyalty_memberships (
    guest_id, program_id, membership_number,
    points_balance, lifetime_points, tier_level, status,
    enrolled_date, expiry_date, created_at
)
SELECT
    g.id,
    lp.id,
    'LM-' || LPAD(g.id::TEXT, 8, '0') || '-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT,
    100,
    100,
    1,
    'active',
    CURRENT_DATE - INTERVAL '2 hours',
    CURRENT_DATE + INTERVAL '1 year',
    CURRENT_DATE - INTERVAL '2 hours'
FROM guests g
CROSS JOIN loyalty_programs lp
WHERE g.email = 'lisa.davis@email.com' AND lp.name = 'Bronze'
ON CONFLICT DO NOTHING;

-- Membership 6: Robert Wilson - Silver tier, suspended (fraud investigation)
INSERT INTO loyalty_memberships (
    guest_id, program_id, membership_number,
    points_balance, lifetime_points, tier_level, status,
    enrolled_date, expiry_date, created_at
)
SELECT
    g.id,
    lp.id,
    'LM-' || LPAD(g.id::TEXT, 8, '0') || '-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT,
    1500,
    2800,
    2,
    'suspended',
    CURRENT_DATE - INTERVAL '100 days',
    CURRENT_DATE + INTERVAL '1 year',
    CURRENT_DATE - INTERVAL '100 days'
FROM guests g
CROSS JOIN loyalty_programs lp
WHERE g.email = 'robert.wilson@email.com' AND lp.name = 'Silver'
ON CONFLICT DO NOTHING;

-- Membership 7: María González - Bronze tier, active
INSERT INTO loyalty_memberships (
    guest_id, program_id, membership_number,
    points_balance, lifetime_points, tier_level, status,
    enrolled_date, expiry_date, created_at
)
SELECT
    g.id,
    lp.id,
    'LM-' || LPAD(g.id::TEXT, 8, '0') || '-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT,
    320,
    620,
    1,
    'active',
    CURRENT_DATE - INTERVAL '75 days',
    CURRENT_DATE + INTERVAL '1 year',
    CURRENT_DATE - INTERVAL '75 days'
FROM guests g
CROSS JOIN loyalty_programs lp
WHERE g.email = 'maria.gonzalez@email.com' AND lp.name = 'Bronze'
ON CONFLICT DO NOTHING;

-- Membership 8: Jennifer Martinez - Bronze tier, expired
INSERT INTO loyalty_memberships (
    guest_id, program_id, membership_number,
    points_balance, lifetime_points, tier_level, status,
    enrolled_date, expiry_date, created_at
)
SELECT
    g.id,
    lp.id,
    'LM-' || LPAD(g.id::TEXT, 8, '0') || '-' || EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '2 years')::TEXT,
    0,
    450,
    1,
    'expired',
    CURRENT_DATE - INTERVAL '2 years',
    CURRENT_DATE - INTERVAL '1 day',
    CURRENT_DATE - INTERVAL '2 years'
FROM guests g
CROSS JOIN loyalty_programs lp
WHERE g.email = 'jennifer.martinez@email.com' AND lp.name = 'Bronze'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- POINTS TRANSACTIONS - Various transaction types
-- ============================================================================

-- John Smith transactions
INSERT INTO points_transactions (id, membership_id, transaction_type, points_amount, balance_after, reference_type, reference_id, description, created_at)
SELECT
    uuid_generate_v4(),
    lm.id,
    'earn',
    500,
    500,
    'booking',
    b.id,
    'Points earned from booking #' || b.booking_number,
    b.created_at + INTERVAL '1 day'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
JOIN bookings b ON b.guest_id = g.id
WHERE g.email = 'john.smith@email.com'
  AND b.booking_number LIKE '%-0001'
LIMIT 1;

INSERT INTO points_transactions (id, membership_id, transaction_type, points_amount, balance_after, reference_type, description, created_at)
SELECT
    uuid_generate_v4(),
    lm.id,
    'earn',
    350,
    850,
    'bonus',
    'Welcome bonus for new member',
    CURRENT_DATE - INTERVAL '200 days' + INTERVAL '1 hour'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
WHERE g.email = 'john.smith@email.com'
LIMIT 1;

INSERT INTO points_transactions (id, membership_id, transaction_type, points_amount, balance_after, reference_type, description, created_at)
SELECT
    uuid_generate_v4(),
    lm.id,
    'redeem',
    -400,
    450,
    'reward',
    'Redeemed: Welcome Drink Voucher',
    CURRENT_DATE - INTERVAL '30 days'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
WHERE g.email = 'john.smith@email.com'
LIMIT 1;

-- Sarah Johnson transactions (Silver tier)
INSERT INTO points_transactions (id, membership_id, transaction_type, points_amount, balance_after, reference_type, reference_id, description, created_at)
SELECT
    uuid_generate_v4(),
    lm.id,
    'earn',
    1500,
    1500,
    'booking',
    b.id,
    'Points earned from booking #' || b.booking_number || ' (Silver tier 1.5x multiplier)',
    b.created_at + INTERVAL '1 day'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
JOIN bookings b ON b.guest_id = g.id
WHERE g.email = 'sarah.johnson@email.com'
  AND b.booking_number LIKE '%-0002'
LIMIT 1;

INSERT INTO points_transactions (id, membership_id, transaction_type, points_amount, balance_after, reference_type, description, created_at)
SELECT
    uuid_generate_v4(),
    lm.id,
    'earn',
    2700,
    4200,
    'booking',
    'Historical bookings bonus points',
    CURRENT_DATE - INTERVAL '100 days'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
WHERE g.email = 'sarah.johnson@email.com'
LIMIT 1;

INSERT INTO points_transactions (id, membership_id, transaction_type, points_amount, balance_after, reference_type, description, created_at)
SELECT
    uuid_generate_v4(),
    lm.id,
    'redeem',
    -1350,
    2850,
    'reward',
    'Redeemed: Room Upgrade Certificate',
    CURRENT_DATE - INTERVAL '50 days'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
WHERE g.email = 'sarah.johnson@email.com'
LIMIT 1;

-- Emily Williams transactions (Platinum tier - VIP)
INSERT INTO points_transactions (id, membership_id, transaction_type, points_amount, balance_after, reference_type, reference_id, description, created_at)
SELECT
    uuid_generate_v4(),
    lm.id,
    'earn',
    2250,
    22750,
    'booking',
    b.id,
    'Points earned from booking #' || b.booking_number || ' (Platinum tier 3x multiplier)',
    b.created_at + INTERVAL '1 day'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
JOIN bookings b ON b.guest_id = g.id
WHERE g.email = 'emily.williams@email.com'
  AND b.booking_number LIKE '%-0003'
LIMIT 1;

INSERT INTO points_transactions (id, membership_id, transaction_type, points_amount, balance_after, reference_type, description, created_at)
SELECT
    uuid_generate_v4(),
    lm.id,
    'redeem',
    -4250,
    18500,
    'reward',
    'Redeemed: Presidential Suite Weekend',
    CURRENT_DATE - INTERVAL '60 days'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
WHERE g.email = 'emily.williams@email.com'
LIMIT 1;

INSERT INTO points_transactions (id, membership_id, transaction_type, points_amount, balance_after, reference_type, description, created_at)
SELECT
    uuid_generate_v4(),
    lm.id,
    'earn',
    5000,
    23500,
    'bonus',
    'VIP anniversary bonus - 1 year platinum membership',
    CURRENT_DATE - INTERVAL '30 days'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
WHERE g.email = 'emily.williams@email.com'
LIMIT 1;

-- Michael Brown transactions (Gold tier)
INSERT INTO points_transactions (id, membership_id, transaction_type, points_amount, balance_after, reference_type, description, created_at)
SELECT
    uuid_generate_v4(),
    lm.id,
    'earn',
    1575,
    8775,
    'booking',
    'Corporate booking points (Gold tier 2x multiplier)',
    CURRENT_DATE - INTERVAL '200 days'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
WHERE g.email = 'michael.brown@corporate.com'
LIMIT 1;

INSERT INTO points_transactions (id, membership_id, transaction_type, points_amount, balance_after, reference_type, description, created_at)
SELECT
    uuid_generate_v4(),
    lm.id,
    'redeem',
    -1575,
    7200,
    'reward',
    'Redeemed: Full Day Spa Package',
    CURRENT_DATE - INTERVAL '90 days'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
WHERE g.email = 'michael.brown@corporate.com'
LIMIT 1;

-- ============================================================================
-- REWARD REDEMPTIONS
-- ============================================================================

-- Redemption 1: John Smith - Welcome Drink Voucher (redeemed)
INSERT INTO reward_redemptions (membership_id, reward_id, points_spent, status, redeemed_at, created_at)
SELECT
    lm.id,
    lr.id,
    100,
    'redeemed',
    CURRENT_DATE - INTERVAL '30 days',
    CURRENT_DATE - INTERVAL '30 days'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
CROSS JOIN loyalty_rewards lr
WHERE g.email = 'john.smith@email.com'
  AND lr.name = 'Welcome Drink Voucher'
LIMIT 1;

-- Redemption 2: Sarah Johnson - Room Upgrade (redeemed)
INSERT INTO reward_redemptions (membership_id, reward_id, points_spent, status, redeemed_at, notes, created_at)
SELECT
    lm.id,
    lr.id,
    500,
    'redeemed',
    CURRENT_DATE - INTERVAL '50 days',
    'Upgraded from Standard to Deluxe Room',
    CURRENT_DATE - INTERVAL '50 days'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
CROSS JOIN loyalty_rewards lr
WHERE g.email = 'sarah.johnson@email.com'
  AND lr.name = 'Room Upgrade Certificate'
LIMIT 1;

-- Redemption 3: Emily Williams - Presidential Suite (redeemed)
INSERT INTO reward_redemptions (membership_id, reward_id, booking_id, points_spent, status, redeemed_at, notes, created_at)
SELECT
    lm.id,
    lr.id,
    b.id,
    5000,
    'redeemed',
    CURRENT_DATE - INTERVAL '60 days',
    'Presidential Suite Weekend - VIP guest special redemption',
    CURRENT_DATE - INTERVAL '60 days'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
CROSS JOIN loyalty_rewards lr
LEFT JOIN bookings b ON b.guest_id = g.id AND b.booking_number LIKE '%-0003'
WHERE g.email = 'emily.williams@email.com'
  AND lr.name = 'Presidential Suite Weekend'
LIMIT 1;

-- Redemption 4: Michael Brown - Spa Package (pending)
INSERT INTO reward_redemptions (membership_id, reward_id, points_spent, status, notes, created_at)
SELECT
    lm.id,
    lr.id,
    2000,
    'pending',
    'Awaiting spa appointment confirmation',
    CURRENT_DATE - INTERVAL '2 days'
FROM loyalty_memberships lm
JOIN guests g ON g.id = lm.guest_id
CROSS JOIN loyalty_rewards lr
WHERE g.email = 'michael.brown@corporate.com'
  AND lr.name = 'Full Day Spa Package'
LIMIT 1;

\echo '✓ Loyalty program seed data loaded successfully'
\echo '✓ Created 4 loyalty tiers (Bronze, Silver, Gold, Platinum)'
\echo '✓ Created 8 loyalty memberships'
\echo '✓ Created points transactions and reward redemptions'
