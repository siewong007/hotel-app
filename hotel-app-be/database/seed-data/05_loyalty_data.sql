-- ============================================================================
-- SEED 05: LOYALTY PROGRAMS & MEMBERSHIPS
-- ============================================================================
-- Description: Loyalty programs, tiers, memberships, and points transactions
-- ============================================================================

-- ============================================================================
-- LOYALTY PROGRAMS
-- ============================================================================

INSERT INTO loyalty_programs (name, description, points_per_dollar, is_active, created_at)
VALUES ('Grand Hotel Rewards', 'Earn points on every stay and redeem for free nights, upgrades, and more', 10.0, true, CURRENT_TIMESTAMP);

-- ============================================================================
-- LOYALTY TIERS
-- ============================================================================

INSERT INTO loyalty_tiers (program_id, name, min_points, max_points, points_multiplier, benefits, color)
SELECT lp.id, 'Bronze', 0, 999, 1.0, '{"benefits": ["Earn 10 points per dollar", "Member-only rates"]}', '#CD7F32'
FROM loyalty_programs lp WHERE lp.name = 'Grand Hotel Rewards';

INSERT INTO loyalty_tiers (program_id, name, min_points, max_points, points_multiplier, benefits, color)
SELECT lp.id, 'Silver', 1000, 4999, 1.5, '{"benefits": ["Earn 15 points per dollar", "Late checkout", "Room upgrade (subject to availability)"]}', '#C0C0C0'
FROM loyalty_programs lp WHERE lp.name = 'Grand Hotel Rewards';

INSERT INTO loyalty_tiers (program_id, name, min_points, max_points, points_multiplier, benefits, color)
SELECT lp.id, 'Gold', 5000, 14999, 2.0, '{"benefits": ["Earn 20 points per dollar", "Guaranteed late checkout", "Complimentary breakfast", "Room upgrade"]}', '#FFD700'
FROM loyalty_programs lp WHERE lp.name = 'Grand Hotel Rewards';

INSERT INTO loyalty_tiers (program_id, name, min_points, max_points, points_multiplier, benefits, color)
SELECT lp.id, 'Platinum', 15000, NULL, 3.0, '{"benefits": ["Earn 30 points per dollar", "Suite upgrade", "VIP lounge access", "Complimentary spa treatment"]}', '#E5E4E2'
FROM loyalty_programs lp WHERE lp.name = 'Grand Hotel Rewards';

-- ============================================================================
-- LOYALTY MEMBERSHIPS
-- ============================================================================

-- John Smith - Bronze tier
INSERT INTO loyalty_memberships (guest_id, program_id, tier_id, member_number, points_balance, lifetime_points, status, enrolled_at)
SELECT g.id, lp.id, lt.id, 'GHR-' || LPAD(g.id::TEXT, 8, '0'), 450, 850, 'active', CURRENT_TIMESTAMP - INTERVAL '200 days'
FROM guests g
CROSS JOIN loyalty_programs lp
JOIN loyalty_tiers lt ON lt.program_id = lp.id AND lt.name = 'Bronze'
WHERE g.email = 'john.smith@email.com' AND lp.name = 'Grand Hotel Rewards';

-- Sarah Johnson - Silver tier
INSERT INTO loyalty_memberships (guest_id, program_id, tier_id, member_number, points_balance, lifetime_points, status, enrolled_at)
SELECT g.id, lp.id, lt.id, 'GHR-' || LPAD(g.id::TEXT, 8, '0'), 2850, 4200, 'active', CURRENT_TIMESTAMP - INTERVAL '150 days'
FROM guests g
CROSS JOIN loyalty_programs lp
JOIN loyalty_tiers lt ON lt.program_id = lp.id AND lt.name = 'Silver'
WHERE g.email = 'sarah.johnson@email.com' AND lp.name = 'Grand Hotel Rewards';

-- Emily Williams - Platinum tier (VIP)
INSERT INTO loyalty_memberships (guest_id, program_id, tier_id, member_number, points_balance, lifetime_points, status, enrolled_at)
SELECT g.id, lp.id, lt.id, 'GHR-' || LPAD(g.id::TEXT, 8, '0'), 18500, 25000, 'active', CURRENT_TIMESTAMP - INTERVAL '400 days'
FROM guests g
CROSS JOIN loyalty_programs lp
JOIN loyalty_tiers lt ON lt.program_id = lp.id AND lt.name = 'Platinum'
WHERE g.email = 'emily.williams@email.com' AND lp.name = 'Grand Hotel Rewards';

-- Michael Brown - Gold tier
INSERT INTO loyalty_memberships (guest_id, program_id, tier_id, member_number, points_balance, lifetime_points, status, enrolled_at)
SELECT g.id, lp.id, lt.id, 'GHR-' || LPAD(g.id::TEXT, 8, '0'), 7200, 12000, 'active', CURRENT_TIMESTAMP - INTERVAL '300 days'
FROM guests g
CROSS JOIN loyalty_programs lp
JOIN loyalty_tiers lt ON lt.program_id = lp.id AND lt.name = 'Gold'
WHERE g.email = 'michael.brown@corporate.com' AND lp.name = 'Grand Hotel Rewards';

-- Lisa Davis - Bronze tier (new)
INSERT INTO loyalty_memberships (guest_id, program_id, tier_id, member_number, points_balance, lifetime_points, status, enrolled_at)
SELECT g.id, lp.id, lt.id, 'GHR-' || LPAD(g.id::TEXT, 8, '0'), 100, 100, 'active', CURRENT_TIMESTAMP - INTERVAL '2 hours'
FROM guests g
CROSS JOIN loyalty_programs lp
JOIN loyalty_tiers lt ON lt.program_id = lp.id AND lt.name = 'Bronze'
WHERE g.email = 'lisa.davis@email.com' AND lp.name = 'Grand Hotel Rewards';

-- Robert Wilson - Silver tier (suspended)
INSERT INTO loyalty_memberships (guest_id, program_id, tier_id, member_number, points_balance, lifetime_points, status, enrolled_at)
SELECT g.id, lp.id, lt.id, 'GHR-' || LPAD(g.id::TEXT, 8, '0'), 1500, 2800, 'suspended', CURRENT_TIMESTAMP - INTERVAL '100 days'
FROM guests g
CROSS JOIN loyalty_programs lp
JOIN loyalty_tiers lt ON lt.program_id = lp.id AND lt.name = 'Silver'
WHERE g.email = 'robert.wilson@email.com' AND lp.name = 'Grand Hotel Rewards';

-- ============================================================================
-- POINTS TRANSACTIONS
-- ============================================================================

-- John Smith transactions
INSERT INTO points_transactions (membership_id, transaction_type, points, balance_after, description, created_at)
SELECT lm.id, 'earn', 500, 500, 'Points earned from booking', CURRENT_TIMESTAMP - INTERVAL '180 days'
FROM loyalty_memberships lm JOIN guests g ON g.id = lm.guest_id WHERE g.email = 'john.smith@email.com';

INSERT INTO points_transactions (membership_id, transaction_type, points, balance_after, description, created_at)
SELECT lm.id, 'earn', 350, 850, 'Welcome bonus for new member', CURRENT_TIMESTAMP - INTERVAL '200 days'
FROM loyalty_memberships lm JOIN guests g ON g.id = lm.guest_id WHERE g.email = 'john.smith@email.com';

INSERT INTO points_transactions (membership_id, transaction_type, points, balance_after, description, created_at)
SELECT lm.id, 'redeem', -400, 450, 'Redeemed: Welcome Drink Voucher', CURRENT_TIMESTAMP - INTERVAL '30 days'
FROM loyalty_memberships lm JOIN guests g ON g.id = lm.guest_id WHERE g.email = 'john.smith@email.com';

-- Sarah Johnson transactions (Silver tier)
INSERT INTO points_transactions (membership_id, transaction_type, points, balance_after, description, created_at)
SELECT lm.id, 'earn', 1500, 1500, 'Points earned from booking (Silver tier 1.5x)', CURRENT_TIMESTAMP - INTERVAL '140 days'
FROM loyalty_memberships lm JOIN guests g ON g.id = lm.guest_id WHERE g.email = 'sarah.johnson@email.com';

INSERT INTO points_transactions (membership_id, transaction_type, points, balance_after, description, created_at)
SELECT lm.id, 'earn', 2700, 4200, 'Historical bookings bonus points', CURRENT_TIMESTAMP - INTERVAL '100 days'
FROM loyalty_memberships lm JOIN guests g ON g.id = lm.guest_id WHERE g.email = 'sarah.johnson@email.com';

INSERT INTO points_transactions (membership_id, transaction_type, points, balance_after, description, created_at)
SELECT lm.id, 'redeem', -1350, 2850, 'Redeemed: Room Upgrade Certificate', CURRENT_TIMESTAMP - INTERVAL '50 days'
FROM loyalty_memberships lm JOIN guests g ON g.id = lm.guest_id WHERE g.email = 'sarah.johnson@email.com';

-- Emily Williams transactions (Platinum tier - VIP)
INSERT INTO points_transactions (membership_id, transaction_type, points, balance_after, description, created_at)
SELECT lm.id, 'earn', 2250, 22750, 'Points earned from booking (Platinum tier 3x)', CURRENT_TIMESTAMP - INTERVAL '90 days'
FROM loyalty_memberships lm JOIN guests g ON g.id = lm.guest_id WHERE g.email = 'emily.williams@email.com';

INSERT INTO points_transactions (membership_id, transaction_type, points, balance_after, description, created_at)
SELECT lm.id, 'redeem', -4250, 18500, 'Redeemed: Presidential Suite Weekend', CURRENT_TIMESTAMP - INTERVAL '60 days'
FROM loyalty_memberships lm JOIN guests g ON g.id = lm.guest_id WHERE g.email = 'emily.williams@email.com';

INSERT INTO points_transactions (membership_id, transaction_type, points, balance_after, description, created_at)
SELECT lm.id, 'earn', 5000, 23500, 'VIP anniversary bonus', CURRENT_TIMESTAMP - INTERVAL '30 days'
FROM loyalty_memberships lm JOIN guests g ON g.id = lm.guest_id WHERE g.email = 'emily.williams@email.com';

-- Michael Brown transactions (Gold tier)
INSERT INTO points_transactions (membership_id, transaction_type, points, balance_after, description, created_at)
SELECT lm.id, 'earn', 1575, 8775, 'Corporate booking points (Gold tier 2x)', CURRENT_TIMESTAMP - INTERVAL '200 days'
FROM loyalty_memberships lm JOIN guests g ON g.id = lm.guest_id WHERE g.email = 'michael.brown@corporate.com';

INSERT INTO points_transactions (membership_id, transaction_type, points, balance_after, description, created_at)
SELECT lm.id, 'redeem', -1575, 7200, 'Redeemed: Full Day Spa Package', CURRENT_TIMESTAMP - INTERVAL '90 days'
FROM loyalty_memberships lm JOIN guests g ON g.id = lm.guest_id WHERE g.email = 'michael.brown@corporate.com';

-- ============================================================================
-- COMPLIMENTARY NIGHT CREDITS (Room-Type Specific)
-- ============================================================================

-- Reset any legacy credits to 0 (using modern room-type specific credits only)
UPDATE guests SET complimentary_nights_credit = 0 WHERE complimentary_nights_credit > 0;

-- Room-type specific complimentary credits
-- Emily Williams - 3 nights for Deluxe, 2 nights for Suite
INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available, notes, created_at)
SELECT g.id, rt.id, 3, 'VIP anniversary reward - Deluxe room credits', CURRENT_TIMESTAMP - INTERVAL '30 days'
FROM guests g, room_types rt
WHERE g.email = 'emily.williams@email.com' AND rt.code = 'DLX'
ON CONFLICT (guest_id, room_type_id) DO UPDATE SET nights_available = EXCLUDED.nights_available;

INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available, notes, created_at)
SELECT g.id, rt.id, 2, 'Platinum tier suite upgrade credits', CURRENT_TIMESTAMP - INTERVAL '15 days'
FROM guests g, room_types rt
WHERE g.email = 'emily.williams@email.com' AND rt.code = 'STE'
ON CONFLICT (guest_id, room_type_id) DO UPDATE SET nights_available = EXCLUDED.nights_available;

-- Sarah Johnson - 2 nights for Standard
INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available, notes, created_at)
SELECT g.id, rt.id, 2, 'Service recovery credit', CURRENT_TIMESTAMP - INTERVAL '45 days'
FROM guests g, room_types rt
WHERE g.email = 'sarah.johnson@email.com' AND rt.code = 'STD'
ON CONFLICT (guest_id, room_type_id) DO UPDATE SET nights_available = EXCLUDED.nights_available;

-- Michael Brown - 2 nights for Deluxe (corporate benefit)
INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available, notes, created_at)
SELECT g.id, rt.id, 2, 'Corporate account loyalty bonus', CURRENT_TIMESTAMP - INTERVAL '60 days'
FROM guests g, room_types rt
WHERE g.email = 'michael.brown@corporate.com' AND rt.code = 'DLX'
ON CONFLICT (guest_id, room_type_id) DO UPDATE SET nights_available = EXCLUDED.nights_available;

-- John Smith - 1 night for Standard (new member bonus)
INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available, notes, created_at)
SELECT g.id, rt.id, 1, 'New member welcome gift', CURRENT_TIMESTAMP - INTERVAL '180 days'
FROM guests g, room_types rt
WHERE g.email = 'john.smith@email.com' AND rt.code = 'STD'
ON CONFLICT (guest_id, room_type_id) DO UPDATE SET nights_available = EXCLUDED.nights_available;

DO $$ BEGIN RAISE NOTICE 'Loyalty data loaded: 1 program, 4 tiers, 6 memberships, points transactions, complimentary credits'; END $$;
