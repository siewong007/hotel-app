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
