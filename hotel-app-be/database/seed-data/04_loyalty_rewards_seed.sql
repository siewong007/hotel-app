-- ============================================================================
-- LOYALTY REWARDS CATALOG SEED DATA
-- ============================================================================

INSERT INTO loyalty_rewards (name, description, category, points_cost, monetary_value, minimum_tier_level, is_active, stock_quantity, terms_conditions) VALUES
-- Bronze Tier Rewards (Tier 1)
(
    'Welcome Drink Voucher',
    'Complimentary welcome drink at our hotel bar upon check-in',
    'service',
    100,
    10.00,
    1,
    true,
    NULL,
    'Valid for one drink up to $10 value. Cannot be exchanged for cash. Valid for 6 months from redemption.'
),
(
    'Late Checkout (2 PM)',
    'Enjoy a late checkout until 2 PM subject to availability',
    'service',
    250,
    25.00,
    1,
    true,
    NULL,
    'Subject to availability. Must be requested at least 24 hours in advance. Not available during peak season.'
),
(
    '10% Dining Discount',
    'Get 10% off your total bill at any of our hotel restaurants',
    'discount',
    300,
    NULL,
    1,
    true,
    NULL,
    'Valid for one transaction up to $200. Cannot be combined with other offers. Excludes alcoholic beverages.'
),

-- Silver Tier Rewards (Tier 2)
(
    'Room Upgrade Certificate',
    'Upgrade to next room category subject to availability',
    'room_upgrade',
    500,
    50.00,
    2,
    true,
    NULL,
    'Subject to availability at check-in. Valid for one night. Cannot upgrade to suites. Valid for 12 months.'
),
(
    'Spa Treatment Voucher',
    'Enjoy a 60-minute massage at our luxury spa',
    'spa',
    800,
    120.00,
    2,
    true,
    50,
    'Advance booking required. Valid Monday-Thursday only. Cannot be exchanged for cash. Valid for 6 months.'
),
(
    'Airport Transfer',
    'Complimentary one-way airport transfer',
    'service',
    600,
    75.00,
    2,
    true,
    NULL,
    'Must be booked 48 hours in advance. One-way transfer only. Valid for distances up to 30km from hotel.'
),
(
    'Breakfast for Two',
    'Complimentary breakfast buffet for two guests',
    'dining',
    400,
    40.00,
    2,
    true,
    NULL,
    'Valid for one breakfast. Cannot be exchanged for cash or room service. Valid for 6 months from redemption.'
),

-- Gold Tier Rewards (Tier 3)
(
    'Suite Upgrade Certificate',
    'Upgrade to a Junior Suite for one night',
    'room_upgrade',
    1500,
    200.00,
    3,
    true,
    NULL,
    'Subject to availability at check-in. Valid for one night. Cannot be transferred. Valid for 12 months.'
),
(
    'Dinner for Two',
    'Three-course dinner for two at our signature restaurant',
    'dining',
    1200,
    150.00,
    3,
    true,
    NULL,
    'Advance reservation required. Excludes beverages. Valid Monday-Thursday only. Valid for 6 months.'
),
(
    'Executive Lounge Access (3 Days)',
    'Access to Executive Lounge for 3 days including breakfast and evening cocktails',
    'service',
    1000,
    120.00,
    3,
    true,
    NULL,
    'Valid for consecutive days during one stay. Cannot be split across multiple visits. Valid for 12 months.'
),
(
    'Full Day Spa Package',
    'Full day spa package including massage, facial, and access to wellness facilities',
    'spa',
    2000,
    300.00,
    3,
    true,
    30,
    'Advance booking required 7 days in advance. Valid Monday-Thursday only. Valid for 6 months.'
),

-- Platinum Tier Rewards (Tier 4)
(
    'Free Night Stay',
    'Complimentary one-night stay in a Deluxe Room',
    'room_upgrade',
    3000,
    250.00,
    4,
    true,
    NULL,
    'Subject to availability. Blackout dates apply during peak season and holidays. Must be booked 30 days in advance. Valid for 12 months.'
),
(
    'Presidential Suite Weekend',
    'One night in our Presidential Suite including breakfast',
    'room_upgrade',
    5000,
    500.00,
    4,
    true,
    10,
    'Subject to availability. Must be booked 60 days in advance. Blackout dates apply. Valid for 12 months. Non-refundable after booking.'
),
(
    'Exclusive Dining Experience',
    'Private dining experience for up to 4 guests with sommelier',
    'dining',
    4000,
    600.00,
    4,
    true,
    20,
    'Advance booking required 14 days in advance. Menu customization available. Includes wine pairing. Valid for 12 months.'
),
(
    'Personal Concierge Service',
    '24-hour personal concierge service during your stay',
    'experience',
    2500,
    300.00,
    4,
    true,
    NULL,
    'Valid for one stay up to 7 days. Advance booking required 7 days in advance. Valid for 12 months.'
),
(
    'Luxury Gift Hamper',
    'Curated luxury gift hamper featuring premium local products',
    'gift',
    1800,
    200.00,
    4,
    true,
    15,
    'Delivered to room upon check-in. Cannot be exchanged for cash. Subject to availability. Valid for 6 months.'
),

-- Experience Rewards (All tiers)
(
    'City Tour Package',
    'Half-day guided city tour for two including transportation',
    'experience',
    900,
    100.00,
    2,
    true,
    NULL,
    'Subject to availability. Must be booked 48 hours in advance. Valid Monday-Friday only. Valid for 6 months.'
),
(
    'Wine Tasting Experience',
    'Wine tasting experience at local vineyard including transportation',
    'experience',
    1500,
    180.00,
    3,
    true,
    25,
    'Subject to availability. Must be booked 7 days in advance. For guests 21+ only. Valid for 6 months.'
)
ON CONFLICT DO NOTHING;
