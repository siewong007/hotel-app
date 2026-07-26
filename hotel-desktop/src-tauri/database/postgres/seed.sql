-- ============================================================================
-- HOTEL APP FRESH BOOTSTRAP (V1)
-- ============================================================================
-- Run exactly once, after migrations/0001_v1_baseline.sql and data.sql.
-- This file creates the initial operator accounts and records a completed V1.
-- It is never run by normal application startup.

\set ON_ERROR_STOP on

BEGIN;
SELECT pg_advisory_xact_lock(hashtext('hotel_app_v1_fresh_bootstrap'));

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.hotel_schema_revisions
        WHERE generation = 1 AND version = 1
    ) THEN
        RAISE EXCEPTION
            'seed.sql is a one-time V1 installation step and must not run against an existing V1 database';
    END IF;
END;
$$;

-- A restored PostgreSQL 18.4 database already owns its accounts and property
-- catalogue. Only a truly fresh V1 database receives sample bootstrap rows.
CREATE TEMP TABLE v1_seed_state (
    seed_accounts boolean NOT NULL,
    seed_property boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO v1_seed_state (seed_accounts, seed_property)
SELECT
    NOT EXISTS (SELECT 1 FROM users),
    NOT EXISTS (
        SELECT 1 FROM room_types
        UNION ALL SELECT 1 FROM rooms
        UNION ALL SELECT 1 FROM rate_plans
        UNION ALL SELECT 1 FROM room_rates
    );

-- Seeded accounts use a non-recoverable placeholder password hash. Set the
-- initial password explicitly with the backend fix_password helper.
INSERT INTO users (
    id, username, email, password_hash, full_name, is_active, is_verified,
    is_super_admin, created_at, updated_at
)
OVERRIDING SYSTEM VALUE
SELECT
    1000, 'admin', 'admin@hotel.com',
    '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'System Administrator', true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE (SELECT seed_accounts FROM v1_seed_state)
ON CONFLICT (username) DO NOTHING;

SELECT setval('users_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1000) FROM users), 1000) + 1, false)
WHERE (SELECT seed_accounts FROM v1_seed_state);

INSERT INTO users (
    username, email, password_hash, full_name, is_active, is_verified,
    is_super_admin, created_at
)
SELECT
    'superadmin', 'superadmin@hotel.local',
    '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Super Administrator', true, true, true, CURRENT_TIMESTAMP
WHERE (SELECT seed_accounts FROM v1_seed_state)
ON CONFLICT (username) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON r.name = 'admin'
WHERE u.username = 'admin'
  AND (SELECT seed_accounts FROM v1_seed_state)
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON r.name = 'super_admin'
WHERE u.username = 'superadmin'
  AND (SELECT seed_accounts FROM v1_seed_state)
ON CONFLICT DO NOTHING;

\echo '[seed] Initial room types, rooms & rate plans...';
-- ============================================================================
-- SEED 03: ROOM TYPES, ROOMS & RATE PLANS
-- ============================================================================
-- Description: Room inventory and pricing configuration
-- ============================================================================

-- ============================================================================
-- ROOM TYPES
-- ============================================================================

-- Room types are user-editable business data, not a system invariant. Seed the
-- sample catalog only on a fresh database (empty table). On an existing install
-- we must never re-insert (the name/code unique constraints would collide with
-- renamed/recoded types) nor UPDATE (that would clobber the operator's own
-- pricing/occupancy/names). See the bootstrap validation note below.
DO $$
BEGIN
    IF (SELECT seed_property FROM v1_seed_state) THEN
        INSERT INTO room_types (name, code, description, max_occupancy, base_price, size_sqm, bed_type, bed_count, allows_extra_bed, max_extra_beds, extra_bed_charge, sort_order)
        VALUES
            ('Standard Room', 'STD', 'Comfortable room with essential amenities', 2, 150.00, 25.0, 'Queen', 1, false, 0, 0.00, 1),
            ('Deluxe Room', 'DLX', 'Spacious room with premium amenities', 3, 250.00, 35.0, 'King', 1, true, 1, 50.00, 2),
            ('Suite', 'STE', 'Luxury suite with separate living area', 4, 450.00, 55.0, 'King', 1, true, 2, 75.00, 3),
            ('Family Room', 'FAM', 'Large room perfect for families with children', 6, 350.00, 45.0, 'Queen', 2, true, 2, 40.00, 4);
    END IF;
END $$;

-- System-managed, non-public voucher issued automatically when a guest portal
-- account is activated. It can only be redeemed against the Deluxe room type.
DO $$
DECLARE
    welcome_promotion_id BIGINT;
    deluxe_room_type_id BIGINT;
    admin_user_id BIGINT;
BEGIN
    IF (SELECT seed_property FROM v1_seed_state) THEN
        -- The seeded administrator is not id 1; resolve it by username so the
        -- promotion audit columns satisfy promotions_created_by_fkey.
        SELECT id INTO admin_user_id FROM users WHERE username = 'admin';

        INSERT INTO promotions (
            slug, name, description, terms, status, promotion_kind, discount_type,
            discount_value, currency, min_nights, min_subtotal, per_guest_limit,
            is_public, is_cancellable, created_by, updated_by
        ) VALUES (
            'welcome-deluxe-10', 'Welcome Deluxe 10%',
            'A one-time welcome voucher for 10% off a Deluxe Room.',
            'Valid for one eligible Deluxe Room booking. One voucher per guest.',
            'published', 'voucher', 'percentage', 10.00, 'USD', 1, 0, 1,
            false, true, admin_user_id, admin_user_id
        ) ON CONFLICT (slug) DO NOTHING;

        SELECT id INTO welcome_promotion_id FROM promotions WHERE slug = 'welcome-deluxe-10';
        SELECT id INTO deluxe_room_type_id FROM room_types WHERE code = 'DLX';
        IF welcome_promotion_id IS NOT NULL AND deluxe_room_type_id IS NOT NULL THEN
            INSERT INTO promotion_room_types (promotion_id, room_type_id)
            VALUES (welcome_promotion_id, deluxe_room_type_id)
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;
END $$;

-- ============================================================================
-- ROOMS - 16 rooms across 4 floors
-- ============================================================================

-- Sample rooms are user-editable business data, not a system invariant. Seed the
-- sample catalog only on a fresh database (no rooms yet). On an existing install
-- the operator already manages their own rooms, and their room_types may use
-- different codes (e.g. a restored backup), so re-seeding here must be skipped.
-- Each insert JOINs room_types (instead of a scalar subquery) so a missing code
-- yields zero rows rather than a NULL room_type_id that violates NOT NULL and
-- aborts the whole bootstrap transaction.
DO $$
BEGIN
    IF (SELECT seed_property FROM v1_seed_state) THEN
        -- Floor 1: Standard Rooms (101-105)
        INSERT INTO rooms (room_number, room_type_id, floor, status)
        SELECT '10' || ROW_NUMBER() OVER(), rt.id, 1, 'available'
        FROM generate_series(1, 5)
        CROSS JOIN (SELECT id FROM room_types WHERE code = 'STD' LIMIT 1) rt
        ON CONFLICT (room_number) DO NOTHING;

        -- Floor 2: Deluxe Rooms (201-205)
        INSERT INTO rooms (room_number, room_type_id, floor, status)
        SELECT '20' || ROW_NUMBER() OVER(), rt.id, 2, 'available'
        FROM generate_series(1, 5)
        CROSS JOIN (SELECT id FROM room_types WHERE code = 'DLX' LIMIT 1) rt
        ON CONFLICT (room_number) DO NOTHING;

        -- Floor 3: Suites (301-303)
        INSERT INTO rooms (room_number, room_type_id, floor, status)
        SELECT '30' || ROW_NUMBER() OVER(), rt.id, 3, 'available'
        FROM generate_series(1, 3)
        CROSS JOIN (SELECT id FROM room_types WHERE code = 'STE' LIMIT 1) rt
        ON CONFLICT (room_number) DO NOTHING;

        -- Floor 4: Family Rooms (401-403)
        INSERT INTO rooms (room_number, room_type_id, floor, status)
        SELECT '40' || ROW_NUMBER() OVER(), rt.id, 4, 'available'
        FROM generate_series(1, 3)
        CROSS JOIN (SELECT id FROM room_types WHERE code = 'FAM' LIMIT 1) rt
        ON CONFLICT (room_number) DO NOTHING;
    END IF;
END $$;

-- ============================================================================
-- RATE PLANS
-- ============================================================================

DO $$
BEGIN
    IF (SELECT seed_property FROM v1_seed_state) THEN
        INSERT INTO rate_plans (name, code, description, plan_type, adjustment_type, adjustment_value, valid_from, valid_to, is_active, priority)
        VALUES
            ('Complimentary Rate', 'COMP', 'Complimentary rate for special guests, VIPs, and promotional purposes', 'promotional', 'override', 0.00, '2023-01-01', '2026-12-31', true, 100),
            ('Standard Rack Rate', 'RACK', 'Standard published rate for walk-in guests', 'standard', 'override', NULL, '2023-01-01', '2026-12-31', true, 50),
            ('Corporate Rate', 'CORP', 'Discounted rate for corporate clients and business travelers', 'corporate', 'percentage', -20.00, '2023-01-01', '2026-12-31', true, 60),
            ('Weekend Rate', 'WKND', 'Special rate for weekend stays (Friday-Sunday)', 'seasonal', 'percentage', 15.00, '2023-01-01', '2026-12-31', true, 55),
            ('Early Bird Rate', 'EARLY', 'Discounted rate for bookings made 30+ days in advance', 'promotional', 'percentage', -30.00, '2023-01-01', '2026-12-31', true, 70),
            ('Group Rate', 'GROUP', 'Special rate for group bookings (5+ rooms)', 'group', 'percentage', -25.00, '2023-01-01', '2026-12-31', true, 65)
        ON CONFLICT (code) DO NOTHING;

        UPDATE rate_plans SET
            applies_monday = false, applies_tuesday = false, applies_wednesday = false, applies_thursday = false,
            applies_friday = true, applies_saturday = true, applies_sunday = true
        WHERE code = 'WKND';

        UPDATE rate_plans SET min_advance_booking = 30 WHERE code = 'EARLY';
        UPDATE rate_plans SET min_nights = 1 WHERE code = 'GROUP';
    END IF;
END $$;

-- ============================================================================
-- ROOM RATES - Prices for each rate plan and room type combination
-- ============================================================================

DO $$
DECLARE
    comp_id BIGINT; rack_id BIGINT; corp_id BIGINT; wknd_id BIGINT; early_id BIGINT; group_id BIGINT;
    std_id BIGINT; dlx_id BIGINT; ste_id BIGINT; fam_id BIGINT;
BEGIN
    IF NOT (SELECT seed_property FROM v1_seed_state) THEN
        RETURN;
    END IF;

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

    -- Each rate insert filters out room types that don't exist on this database
    -- (NULL *_id). Without the WHERE filter a missing code (e.g. a restored
    -- backup whose room_types use different codes) would insert a NULL
    -- room_type_id and abort the whole bootstrap transaction.

    -- COMPLIMENTARY RATE ($0 for all room types)
    IF comp_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        SELECT comp_id, rt.id, rt.price, '2023-01-01', '2026-12-31'
        FROM (VALUES (std_id, 0.00), (dlx_id, 0.00), (ste_id, 0.00), (fam_id, 0.00)) AS rt(id, price)
        WHERE rt.id IS NOT NULL
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- RACK RATE (Base prices: STD $150, DLX $250, STE $450, FAM $350)
    IF rack_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        SELECT rack_id, rt.id, rt.price, '2023-01-01', '2026-12-31'
        FROM (VALUES (std_id, 150.00), (dlx_id, 250.00), (ste_id, 450.00), (fam_id, 350.00)) AS rt(id, price)
        WHERE rt.id IS NOT NULL
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- CORPORATE RATE (20% off base)
    IF corp_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        SELECT corp_id, rt.id, rt.price, '2023-01-01', '2026-12-31'
        FROM (VALUES (std_id, 120.00), (dlx_id, 200.00), (ste_id, 360.00), (fam_id, 280.00)) AS rt(id, price)
        WHERE rt.id IS NOT NULL
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- WEEKEND RATE (15% premium)
    IF wknd_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        SELECT wknd_id, rt.id, rt.price, '2023-01-01', '2026-12-31'
        FROM (VALUES (std_id, 172.50), (dlx_id, 287.50), (ste_id, 517.50), (fam_id, 402.50)) AS rt(id, price)
        WHERE rt.id IS NOT NULL
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- EARLY BIRD RATE (30% off base)
    IF early_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        SELECT early_id, rt.id, rt.price, '2023-01-01', '2026-12-31'
        FROM (VALUES (std_id, 105.00), (dlx_id, 175.00), (ste_id, 315.00), (fam_id, 245.00)) AS rt(id, price)
        WHERE rt.id IS NOT NULL
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- GROUP RATE (25% off base)
    IF group_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        SELECT group_id, rt.id, rt.price, '2023-01-01', '2026-12-31'
        FROM (VALUES (std_id, 112.50), (dlx_id, 187.50), (ste_id, 337.50), (fam_id, 262.50)) AS rt(id, price)
        WHERE rt.id IS NOT NULL
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;
END $$;

DO $$
BEGIN
    IF (SELECT seed_property FROM v1_seed_state) THEN
        RAISE NOTICE 'Rooms & rates loaded: 4 room types, 16 rooms, 6 rate plans with room rates';
    ELSE
        RAISE NOTICE 'Existing property catalogue preserved; sample rooms and rates were not loaded';
    END IF;
END $$;


-- Loyalty-only July offer. It remains private to the rewards catalogue so
-- guests must redeem points before the voucher is issued.
INSERT INTO promotions (
    slug, name, description, terms, status, promotion_kind, discount_type,
    discount_value, currency, claim_starts_at, claim_ends_at, stay_starts_on,
    stay_ends_on, min_nights, min_subtotal, per_guest_limit, is_public,
    is_cancellable, created_by, updated_by
)
SELECT
    'july-deluxe-20-loyalty', 'July Deluxe Room 20% Voucher',
    'Redeem 2,000 loyalty points for 20% off one eligible Deluxe Room booking.',
    'One voucher per guest. Claim and stay dates must be in July 2026. Valid only for Deluxe Rooms.',
    'published', 'voucher', 'percentage', 20.00, 'USD',
    '2026-07-01 00:00:00+00', '2026-07-31 23:59:59+00', '2026-07-01', '2026-07-31',
    1, 0, 1, false, true, u.id, u.id
FROM users u
WHERE u.username = 'admin'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO promotion_room_types (promotion_id, room_type_id)
SELECT p.id, rt.id
FROM promotions p
JOIN room_types rt ON rt.code = 'DLX'
WHERE p.slug = 'july-deluxe-20-loyalty'
ON CONFLICT DO NOTHING;

INSERT INTO loyalty_rewards (
    name, description, category, points_cost, requires_approval, is_active,
    valid_from, valid_to, terms_conditions
)
SELECT
    'July Deluxe Room 20% Voucher',
    'Redeem 2,000 points for a voucher worth 20% off a Deluxe Room.',
    'discount', 2000, false, true, '2026-07-01', '2026-07-31',
    'The voucher is issued immediately, may be used once, and is valid only for a Deluxe Room stay in July 2026.'
WHERE NOT EXISTS (
    SELECT 1 FROM loyalty_rewards WHERE name = 'July Deluxe Room 20% Voucher'
);

-- Fresh-property validation.
DO $$
BEGIN
    IF (SELECT seed_property FROM v1_seed_state)
       AND ((SELECT COUNT(*) FROM room_types) < 4
            OR (SELECT COUNT(*) FROM rooms) < 16
            OR (SELECT COUNT(*) FROM rate_plans) < 6) THEN
        RAISE EXCEPTION 'fresh V1 property bootstrap did not create its required records';
    END IF;
END;
$$;

INSERT INTO audit_logs (user_id, action, resource_type, details)
SELECT u.id, 'system.seed', 'system',
       jsonb_build_object('message', 'V1 bootstrap data loaded', 'timestamp', CURRENT_TIMESTAMP)
FROM users u
WHERE u.username = 'admin'
  AND NOT EXISTS (
      SELECT 1 FROM audit_logs
      WHERE action = 'system.seed' AND resource_type = 'system'
  );

-- The revision row is deliberately the last persistent action: it certifies
-- that schema, required data, and fresh bootstrap data all succeeded.
INSERT INTO public.hotel_schema_revisions (
    generation, version, name, checksum, app_build
) VALUES (
    1, 1, 'v1-baseline',
    'sha256:1149266ee7cc6ae8a0733098a15e1ee0377568eea3aed65254709afe992d1e1d',
    NULL
);

COMMIT;
