-- ============================================================================
-- HOTEL APP SQLITE FRESH BOOTSTRAP DATA
-- ============================================================================
-- Applied once, immediately after data.sql, while creating an empty SQLite V1
-- database. These records intentionally are not reapplied on later startups.
-- ============================================================================

-- Initial property room catalogue.
INSERT INTO room_types (id, name, code, description, base_price, max_occupancy, bed_type, bed_count) VALUES
    (1, 'Standard Room', 'STD', 'Comfortable standard room', 150.00, 2, 'Queen', 1),
    (2, 'Deluxe Room', 'DLX', 'Spacious deluxe room with city view', 250.00, 2, 'King', 1),
    (3, 'Suite', 'STE', 'Luxury suite with separate living area', 450.00, 4, 'King', 1),
    (4, 'Family Room', 'FAM', 'Large room suitable for families', 350.00, 4, 'Queen', 2);

-- Initial administrator. Its placeholder password must be reset explicitly
-- before use; later application starts never modify this row.
INSERT INTO users (
    id, uuid, username, email, password_hash, full_name, user_type,
    is_active, is_verified, is_super_admin
) VALUES (
    1, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'admin', 'admin@hotel.local',
    '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'System Administrator', 'staff', 1, 1, 1
);

INSERT INTO user_roles (user_id, role_id) VALUES (1, 1);

-- System-managed, non-public voucher issued automatically when a guest portal
-- account is activated. It can only be redeemed against the Deluxe room type.
INSERT INTO promotions (
    slug, name, description, terms, status, promotion_kind, discount_type,
    discount_value, currency, min_nights, min_subtotal, per_guest_limit,
    is_public, is_cancellable, created_by, updated_by
) VALUES (
    'welcome-deluxe-10', 'Welcome Deluxe 10%',
    'A one-time welcome voucher for 10% off a Deluxe Room.',
    'Valid for one eligible Deluxe Room booking. One voucher per guest.',
    'published', 'voucher', 'percentage', 10.00, 'USD', 1, 0, 1, 0, 1, 1, 1
);

INSERT INTO promotion_room_types (promotion_id, room_type_id)
SELECT p.id, rt.id
FROM promotions p
JOIN room_types rt ON rt.code = 'DLX'
WHERE p.slug = 'welcome-deluxe-10';

-- Loyalty-only July offer. It remains private to the rewards catalogue so
-- guests must redeem points before the voucher is issued.
INSERT INTO promotions (
    slug, name, description, terms, status, promotion_kind, discount_type,
    discount_value, currency, claim_starts_at, claim_ends_at, stay_starts_on,
    stay_ends_on, min_nights, min_subtotal, per_guest_limit, is_public,
    is_cancellable, created_by, updated_by
) VALUES (
    'july-deluxe-20-loyalty', 'July Deluxe Room 20% Voucher',
    'Redeem 2,000 loyalty points for 20% off one eligible Deluxe Room booking.',
    'One voucher per guest. Claim and stay dates must be in July 2026. Valid only for Deluxe Rooms.',
    'published', 'voucher', 'percentage', 20.00, 'USD',
    '2026-07-01 00:00:00', '2026-07-31 23:59:59', '2026-07-01', '2026-07-31',
    1, 0, 1, 0, 1, 1, 1
);

INSERT INTO promotion_room_types (promotion_id, room_type_id)
SELECT p.id, rt.id
FROM promotions p
JOIN room_types rt ON rt.code = 'DLX'
WHERE p.slug = 'july-deluxe-20-loyalty';

INSERT INTO loyalty_rewards (
    name, description, category, points_cost, requires_approval, is_active,
    valid_from, valid_to, terms_conditions
) VALUES (
    'July Deluxe Room 20% Voucher',
    'Redeem 2,000 points for a voucher worth 20% off a Deluxe Room.',
    'discount', 2000, 0, 1, '2026-07-01', '2026-07-31',
    'The voucher is issued immediately, may be used once, and is valid only for a Deluxe Room stay in July 2026.'
);
