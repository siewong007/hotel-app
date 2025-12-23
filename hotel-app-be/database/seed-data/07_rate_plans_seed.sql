-- ============================================================================
-- RATE PLANS & ROOM RATES SEED DATA
-- ============================================================================
-- This script creates default rate plans and room rates for all room types
-- Similar to the standard hotel rate management system
-- ============================================================================

\echo '';
\echo '==============================================';
\echo 'Loading Rate Plans and Room Rates Seed Data';
\echo '==============================================';

-- ============================================================================
-- RATE PLANS
-- ============================================================================

-- Complimentary Rate (COMP) - Free stay for special guests
INSERT INTO rate_plans (
    name, code, description, plan_type, adjustment_type, adjustment_value,
    valid_from, valid_to, is_active, priority, created_by
)
VALUES (
    'Complimentary Rate',
    'COMP',
    'Complimentary rate for special guests, VIPs, and promotional purposes',
    'promotional',
    'override',
    0.00,
    '2023-01-01',
    '2026-12-31',
    true,
    100,
    1000
),
-- Standard Rack Rate (RACK) - Standard published rate
(
    'Standard Rack Rate',
    'RACK',
    'Standard published rate for walk-in guests',
    'standard',
    'override',
    NULL,
    '2023-01-01',
    '2026-12-31',
    true,
    50,
    1000
),
-- Corporate Rate (CORP) - 20% discount for corporate bookings
(
    'Corporate Rate',
    'CORP',
    'Discounted rate for corporate clients and business travelers',
    'corporate',
    'percentage',
    -20.00,
    '2023-01-01',
    '2026-12-31',
    true,
    60,
    1000
),
-- Weekend Rate (WKND) - Special weekend pricing
(
    'Weekend Rate',
    'WKND',
    'Special rate for weekend stays (Friday-Sunday)',
    'seasonal',
    'percentage',
    15.00,
    '2023-01-01',
    '2026-12-31',
    true,
    55,
    1000
),
-- Early Bird Rate (EARLY) - 30% discount for bookings made 30+ days in advance
(
    'Early Bird Rate',
    'EARLY',
    'Discounted rate for bookings made 30+ days in advance',
    'promotional',
    'percentage',
    -30.00,
    '2023-01-01',
    '2026-12-31',
    true,
    70,
    1000
),
-- Group Rate (GROUP) - 25% discount for group bookings
(
    'Group Rate',
    'GROUP',
    'Special rate for group bookings (5+ rooms)',
    'group',
    'percentage',
    -25.00,
    '2023-01-01',
    '2026-12-31',
    true,
    65,
    1000
)
ON CONFLICT (code) DO NOTHING;

-- Update the Weekend Rate to only apply on weekends
UPDATE rate_plans
SET
    applies_monday = false,
    applies_tuesday = false,
    applies_wednesday = false,
    applies_thursday = false,
    applies_friday = true,
    applies_saturday = true,
    applies_sunday = true
WHERE code = 'WKND';

-- Update Early Bird Rate booking constraints
UPDATE rate_plans
SET
    min_advance_booking = 30
WHERE code = 'EARLY';

-- Update Group Rate booking constraints
UPDATE rate_plans
SET
    min_nights = 1
WHERE code = 'GROUP';

-- ============================================================================
-- ROOM RATES
-- ============================================================================

-- Get the COMP rate plan ID
DO $$
DECLARE
    comp_rate_plan_id BIGINT;
    rack_rate_plan_id BIGINT;
    corp_rate_plan_id BIGINT;
    wknd_rate_plan_id BIGINT;
    early_rate_plan_id BIGINT;
    group_rate_plan_id BIGINT;

    std_room_type_id BIGINT;
    dlx_room_type_id BIGINT;
    ste_room_type_id BIGINT;
    fam_room_type_id BIGINT;
BEGIN
    -- Get rate plan IDs
    SELECT id INTO comp_rate_plan_id FROM rate_plans WHERE code = 'COMP' LIMIT 1;
    SELECT id INTO rack_rate_plan_id FROM rate_plans WHERE code = 'RACK' LIMIT 1;
    SELECT id INTO corp_rate_plan_id FROM rate_plans WHERE code = 'CORP' LIMIT 1;
    SELECT id INTO wknd_rate_plan_id FROM rate_plans WHERE code = 'WKND' LIMIT 1;
    SELECT id INTO early_rate_plan_id FROM rate_plans WHERE code = 'EARLY' LIMIT 1;
    SELECT id INTO group_rate_plan_id FROM rate_plans WHERE code = 'GROUP' LIMIT 1;

    -- Get room type IDs
    SELECT id INTO std_room_type_id FROM room_types WHERE code = 'STD' LIMIT 1;
    SELECT id INTO dlx_room_type_id FROM room_types WHERE code = 'DLX' LIMIT 1;
    SELECT id INTO ste_room_type_id FROM room_types WHERE code = 'STE' LIMIT 1;
    SELECT id INTO fam_room_type_id FROM room_types WHERE code = 'FAM' LIMIT 1;

    -- COMPLIMENTARY RATE (COMP) - $0 for all room types
    IF comp_rate_plan_id IS NOT NULL THEN
        -- Standard Room
        IF std_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (comp_rate_plan_id, std_room_type_id, 0.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Deluxe Room
        IF dlx_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (comp_rate_plan_id, dlx_room_type_id, 0.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Suite
        IF ste_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (comp_rate_plan_id, ste_room_type_id, 0.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Family Room
        IF fam_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (comp_rate_plan_id, fam_room_type_id, 0.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;
    END IF;

    -- STANDARD RACK RATE (RACK) - Base rates for all room types
    IF rack_rate_plan_id IS NOT NULL THEN
        -- Standard Room - $150/night
        IF std_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (rack_rate_plan_id, std_room_type_id, 150.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Deluxe Room - $250/night
        IF dlx_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (rack_rate_plan_id, dlx_room_type_id, 250.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Suite - $450/night
        IF ste_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (rack_rate_plan_id, ste_room_type_id, 450.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Family Room - $350/night
        IF fam_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (rack_rate_plan_id, fam_room_type_id, 350.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;
    END IF;

    -- CORPORATE RATE (CORP) - Uses base rate with 20% discount (applied via adjustment_type)
    IF corp_rate_plan_id IS NOT NULL THEN
        -- Standard Room - $120/night (20% off $150)
        IF std_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (corp_rate_plan_id, std_room_type_id, 120.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Deluxe Room - $200/night (20% off $250)
        IF dlx_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (corp_rate_plan_id, dlx_room_type_id, 200.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Suite - $360/night (20% off $450)
        IF ste_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (corp_rate_plan_id, ste_room_type_id, 360.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Family Room - $280/night (20% off $350)
        IF fam_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (corp_rate_plan_id, fam_room_type_id, 280.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;
    END IF;

    -- WEEKEND RATE (WKND) - 15% premium on base rate
    IF wknd_rate_plan_id IS NOT NULL THEN
        -- Standard Room - $172.50/night (15% premium on $150)
        IF std_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (wknd_rate_plan_id, std_room_type_id, 172.50, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Deluxe Room - $287.50/night (15% premium on $250)
        IF dlx_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (wknd_rate_plan_id, dlx_room_type_id, 287.50, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Suite - $517.50/night (15% premium on $450)
        IF ste_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (wknd_rate_plan_id, ste_room_type_id, 517.50, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Family Room - $402.50/night (15% premium on $350)
        IF fam_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (wknd_rate_plan_id, fam_room_type_id, 402.50, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;
    END IF;

    -- EARLY BIRD RATE (EARLY) - 30% discount on base rate
    IF early_rate_plan_id IS NOT NULL THEN
        -- Standard Room - $105/night (30% off $150)
        IF std_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (early_rate_plan_id, std_room_type_id, 105.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Deluxe Room - $175/night (30% off $250)
        IF dlx_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (early_rate_plan_id, dlx_room_type_id, 175.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Suite - $315/night (30% off $450)
        IF ste_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (early_rate_plan_id, ste_room_type_id, 315.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Family Room - $245/night (30% off $350)
        IF fam_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (early_rate_plan_id, fam_room_type_id, 245.00, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;
    END IF;

    -- GROUP RATE (GROUP) - 25% discount on base rate
    IF group_rate_plan_id IS NOT NULL THEN
        -- Standard Room - $112.50/night (25% off $150)
        IF std_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (group_rate_plan_id, std_room_type_id, 112.50, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Deluxe Room - $187.50/night (25% off $250)
        IF dlx_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (group_rate_plan_id, dlx_room_type_id, 187.50, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Suite - $337.50/night (25% off $450)
        IF ste_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (group_rate_plan_id, ste_room_type_id, 337.50, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;

        -- Family Room - $262.50/night (25% off $350)
        IF fam_room_type_id IS NOT NULL THEN
            INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
            VALUES (group_rate_plan_id, fam_room_type_id, 262.50, '2023-01-01', '2026-12-31')
            ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
        END IF;
    END IF;

END $$;

\echo '';
\echo '✓ Rate plans and room rates loaded successfully';
\echo '✓ Created 6 rate plans (COMP, RACK, CORP, WKND, EARLY, GROUP)';
\echo '✓ Created room rates for all room types';
\echo '';
