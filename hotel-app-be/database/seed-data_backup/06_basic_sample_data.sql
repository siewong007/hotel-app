-- ============================================================================
-- BASIC SAMPLE DATA
-- ============================================================================
-- This script creates basic sample data for development/testing
-- ============================================================================

-- ============================================================================
-- ROOM TYPES
-- ============================================================================

INSERT INTO room_types (name, code, description, base_occupancy, max_occupancy, base_price, size_sqm, bed_type, view_type)
VALUES
    ('Standard Room', 'STD', 'Comfortable room with essential amenities', 2, 2, 150.00, 25.0, 'Queen', 'City'),
    ('Deluxe Room', 'DLX', 'Spacious room with premium amenities', 2, 3, 250.00, 35.0, 'King', 'Garden'),
    ('Suite', 'STE', 'Luxury suite with living area', 2, 4, 450.00, 55.0, 'King', 'Sea'),
    ('Family Room', 'FAM', 'Large room perfect for families', 4, 6, 350.00, 45.0, '2 Queens', 'City')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- ROOMS
-- ============================================================================

INSERT INTO rooms (room_number, room_type_id, floor, status)
SELECT
    '10' || ROW_NUMBER() OVER(),
    (SELECT id FROM room_types WHERE code = 'STD' LIMIT 1),
    1,
    'available'
FROM generate_series(1, 5);

INSERT INTO rooms (room_number, room_type_id, floor, status)
SELECT
    '20' || ROW_NUMBER() OVER(),
    (SELECT id FROM room_types WHERE code = 'DLX' LIMIT 1),
    2,
    'available'
FROM generate_series(1, 5);

INSERT INTO rooms (room_number, room_type_id, floor, status)
SELECT
    '30' || ROW_NUMBER() OVER(),
    (SELECT id FROM room_types WHERE code = 'STE' LIMIT 1),
    3,
    'available'
FROM generate_series(1, 3);

INSERT INTO rooms (room_number, room_type_id, floor, status)
SELECT
    '40' || ROW_NUMBER() OVER(),
    (SELECT id FROM room_types WHERE code = 'FAM' LIMIT 1),
    4,
    'available'
FROM generate_series(1, 3);

\echo '';
\echo '✓ Basic sample data loaded successfully';
\echo '✓ Created 4 room types (Standard, Deluxe, Suite, Family)';
\echo '✓ Created 16 rooms across 4 floors';
\echo '';
