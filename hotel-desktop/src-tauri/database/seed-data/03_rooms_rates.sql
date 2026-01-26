-- ============================================================================
-- SEED 03: ROOM TYPES, ROOMS & RATE PLANS
-- ============================================================================
-- Description: Room inventory and pricing configuration
-- ============================================================================

-- ============================================================================
-- ROOM TYPES
-- ============================================================================

INSERT INTO room_types (name, code, description, max_occupancy, base_price, size_sqm, bed_type, bed_count, allows_extra_bed, max_extra_beds, extra_bed_charge, sort_order)
VALUES
    ('Standard Room', 'STD', 'Comfortable room with essential amenities', 2, 150.00, 25.0, 'Queen', 1, false, 0, 0.00, 1),
    ('Deluxe Room', 'DLX', 'Spacious room with premium amenities', 3, 250.00, 35.0, 'King', 1, true, 1, 50.00, 2),
    ('Suite', 'STE', 'Luxury suite with separate living area', 4, 450.00, 55.0, 'King', 1, true, 2, 75.00, 3),
    ('Family Room', 'FAM', 'Large room perfect for families with children', 6, 350.00, 45.0, 'Queen', 2, true, 2, 40.00, 4)
ON CONFLICT (code) DO UPDATE SET
    description = EXCLUDED.description,
    max_occupancy = EXCLUDED.max_occupancy,
    base_price = EXCLUDED.base_price,
    size_sqm = EXCLUDED.size_sqm,
    bed_type = EXCLUDED.bed_type,
    bed_count = EXCLUDED.bed_count,
    allows_extra_bed = EXCLUDED.allows_extra_bed,
    max_extra_beds = EXCLUDED.max_extra_beds,
    extra_bed_charge = EXCLUDED.extra_bed_charge,
    sort_order = EXCLUDED.sort_order;

-- ============================================================================
-- ROOMS - 16 rooms across 4 floors
-- ============================================================================

-- Floor 1: Standard Rooms (101-105)
INSERT INTO rooms (room_number, room_type_id, floor, status)
SELECT '10' || ROW_NUMBER() OVER(), (SELECT id FROM room_types WHERE code = 'STD' LIMIT 1), 1, 'available'
FROM generate_series(1, 5)
ON CONFLICT (room_number) DO NOTHING;

-- Floor 2: Deluxe Rooms (201-205)
INSERT INTO rooms (room_number, room_type_id, floor, status)
SELECT '20' || ROW_NUMBER() OVER(), (SELECT id FROM room_types WHERE code = 'DLX' LIMIT 1), 2, 'available'
FROM generate_series(1, 5)
ON CONFLICT (room_number) DO NOTHING;

-- Floor 3: Suites (301-303)
INSERT INTO rooms (room_number, room_type_id, floor, status)
SELECT '30' || ROW_NUMBER() OVER(), (SELECT id FROM room_types WHERE code = 'STE' LIMIT 1), 3, 'available'
FROM generate_series(1, 3)
ON CONFLICT (room_number) DO NOTHING;

-- Floor 4: Family Rooms (401-403)
INSERT INTO rooms (room_number, room_type_id, floor, status)
SELECT '40' || ROW_NUMBER() OVER(), (SELECT id FROM room_types WHERE code = 'FAM' LIMIT 1), 4, 'available'
FROM generate_series(1, 3)
ON CONFLICT (room_number) DO NOTHING;

-- ============================================================================
-- RATE PLANS
-- ============================================================================

INSERT INTO rate_plans (name, code, description, plan_type, adjustment_type, adjustment_value, valid_from, valid_to, is_active, priority, created_by)
VALUES
    ('Complimentary Rate', 'COMP', 'Complimentary rate for special guests, VIPs, and promotional purposes', 'promotional', 'override', 0.00, '2023-01-01', '2026-12-31', true, 100, 1000),
    ('Standard Rack Rate', 'RACK', 'Standard published rate for walk-in guests', 'standard', 'override', NULL, '2023-01-01', '2026-12-31', true, 50, 1000),
    ('Corporate Rate', 'CORP', 'Discounted rate for corporate clients and business travelers', 'corporate', 'percentage', -20.00, '2023-01-01', '2026-12-31', true, 60, 1000),
    ('Weekend Rate', 'WKND', 'Special rate for weekend stays (Friday-Sunday)', 'seasonal', 'percentage', 15.00, '2023-01-01', '2026-12-31', true, 55, 1000),
    ('Early Bird Rate', 'EARLY', 'Discounted rate for bookings made 30+ days in advance', 'promotional', 'percentage', -30.00, '2023-01-01', '2026-12-31', true, 70, 1000),
    ('Group Rate', 'GROUP', 'Special rate for group bookings (5+ rooms)', 'group', 'percentage', -25.00, '2023-01-01', '2026-12-31', true, 65, 1000)
ON CONFLICT (code) DO NOTHING;

-- Configure Weekend Rate (applies only Fri-Sun)
UPDATE rate_plans SET
    applies_monday = false, applies_tuesday = false, applies_wednesday = false, applies_thursday = false,
    applies_friday = true, applies_saturday = true, applies_sunday = true
WHERE code = 'WKND';

-- Configure Early Bird Rate (30+ days advance booking)
UPDATE rate_plans SET min_advance_booking = 30 WHERE code = 'EARLY';

-- Configure Group Rate
UPDATE rate_plans SET min_nights = 1 WHERE code = 'GROUP';

-- ============================================================================
-- ROOM RATES - Prices for each rate plan and room type combination
-- ============================================================================

DO $$
DECLARE
    comp_id BIGINT; rack_id BIGINT; corp_id BIGINT; wknd_id BIGINT; early_id BIGINT; group_id BIGINT;
    std_id BIGINT; dlx_id BIGINT; ste_id BIGINT; fam_id BIGINT;
BEGIN
    -- Get rate plan IDs
    SELECT id INTO comp_id FROM rate_plans WHERE code = 'COMP' LIMIT 1;
    SELECT id INTO rack_id FROM rate_plans WHERE code = 'RACK' LIMIT 1;
    SELECT id INTO corp_id FROM rate_plans WHERE code = 'CORP' LIMIT 1;
    SELECT id INTO wknd_id FROM rate_plans WHERE code = 'WKND' LIMIT 1;
    SELECT id INTO early_id FROM rate_plans WHERE code = 'EARLY' LIMIT 1;
    SELECT id INTO group_id FROM rate_plans WHERE code = 'GROUP' LIMIT 1;

    -- Get room type IDs
    SELECT id INTO std_id FROM room_types WHERE code = 'STD' LIMIT 1;
    SELECT id INTO dlx_id FROM room_types WHERE code = 'DLX' LIMIT 1;
    SELECT id INTO ste_id FROM room_types WHERE code = 'STE' LIMIT 1;
    SELECT id INTO fam_id FROM room_types WHERE code = 'FAM' LIMIT 1;

    -- COMPLIMENTARY RATE ($0 for all room types)
    IF comp_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to) VALUES
            (comp_id, std_id, 0.00, '2023-01-01', '2026-12-31'),
            (comp_id, dlx_id, 0.00, '2023-01-01', '2026-12-31'),
            (comp_id, ste_id, 0.00, '2023-01-01', '2026-12-31'),
            (comp_id, fam_id, 0.00, '2023-01-01', '2026-12-31')
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- RACK RATE (Base prices: STD $150, DLX $250, STE $450, FAM $350)
    IF rack_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to) VALUES
            (rack_id, std_id, 150.00, '2023-01-01', '2026-12-31'),
            (rack_id, dlx_id, 250.00, '2023-01-01', '2026-12-31'),
            (rack_id, ste_id, 450.00, '2023-01-01', '2026-12-31'),
            (rack_id, fam_id, 350.00, '2023-01-01', '2026-12-31')
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- CORPORATE RATE (20% off base)
    IF corp_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to) VALUES
            (corp_id, std_id, 120.00, '2023-01-01', '2026-12-31'),
            (corp_id, dlx_id, 200.00, '2023-01-01', '2026-12-31'),
            (corp_id, ste_id, 360.00, '2023-01-01', '2026-12-31'),
            (corp_id, fam_id, 280.00, '2023-01-01', '2026-12-31')
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- WEEKEND RATE (15% premium)
    IF wknd_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to) VALUES
            (wknd_id, std_id, 172.50, '2023-01-01', '2026-12-31'),
            (wknd_id, dlx_id, 287.50, '2023-01-01', '2026-12-31'),
            (wknd_id, ste_id, 517.50, '2023-01-01', '2026-12-31'),
            (wknd_id, fam_id, 402.50, '2023-01-01', '2026-12-31')
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- EARLY BIRD RATE (30% off base)
    IF early_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to) VALUES
            (early_id, std_id, 105.00, '2023-01-01', '2026-12-31'),
            (early_id, dlx_id, 175.00, '2023-01-01', '2026-12-31'),
            (early_id, ste_id, 315.00, '2023-01-01', '2026-12-31'),
            (early_id, fam_id, 245.00, '2023-01-01', '2026-12-31')
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- GROUP RATE (25% off base)
    IF group_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to) VALUES
            (group_id, std_id, 112.50, '2023-01-01', '2026-12-31'),
            (group_id, dlx_id, 187.50, '2023-01-01', '2026-12-31'),
            (group_id, ste_id, 337.50, '2023-01-01', '2026-12-31'),
            (group_id, fam_id, 262.50, '2023-01-01', '2026-12-31')
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'Rooms & rates loaded: 4 room types, 16 rooms, 6 rate plans with room rates'; END $$;
