-- ============================================================================
-- BOOKING DATA SEED DATA
-- ============================================================================
-- Sample rooms, amenities, rate plans, and bookings
-- ============================================================================

-- ============================================================================
-- AMENITIES
-- ============================================================================

INSERT INTO amenities (name, category, icon, description) VALUES
-- Room Amenities
('Air Conditioning', 'room', 'ac_unit', 'Climate control air conditioning'),
('Heating', 'room', 'local_fire_department', 'Central heating'),
('Safe', 'room', 'lock', 'In-room safe for valuables'),
('Minibar', 'room', 'local_bar', 'Stocked minibar'),
('Work Desk', 'room', 'desk', 'Spacious work desk with chair'),
('Coffee Maker', 'room', 'coffee', 'In-room coffee/tea maker'),
('Ironing Facilities', 'room', 'iron', 'Iron and ironing board'),
('Balcony', 'room', 'balcony', 'Private balcony'),
('Sofa', 'room', 'weekend', 'Comfortable sofa or seating area'),

-- Bathroom Amenities
('Private Bathroom', 'bathroom', 'bathtub', 'Private ensuite bathroom'),
('Shower', 'bathroom', 'shower', 'Walk-in shower'),
('Bathtub', 'bathroom', 'bathtub', 'Full bathtub'),
('Hairdryer', 'bathroom', 'dry', 'Professional hairdryer'),
('Toiletries', 'bathroom', 'soap', 'Complimentary toiletries'),
('Bathrobes', 'bathroom', 'checkroom', 'Plush bathrobes'),
('Slippers', 'bathroom', 'checkroom', 'Comfortable slippers'),

-- Entertainment
('Flat Screen TV', 'entertainment', 'tv', '42" or larger flat screen TV'),
('Cable Channels', 'entertainment', 'live_tv', 'Premium cable channels'),
('Streaming Services', 'entertainment', 'connected_tv', 'Netflix, Prime Video access'),
('WiFi', 'entertainment', 'wifi', 'High-speed wireless internet'),
('Bluetooth Speaker', 'entertainment', 'speaker', 'Premium bluetooth speaker'),

-- Services
('Room Service', 'service', 'room_service', '24/7 room service'),
('Daily Housekeeping', 'service', 'cleaning_services', 'Daily housekeeping service'),
('Turndown Service', 'service', 'bed', 'Evening turndown service'),
('Concierge', 'service', 'support_agent', 'Concierge service'),
('Laundry Service', 'service', 'local_laundry_service', 'Laundry and dry cleaning')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- ROOM TYPES
-- ============================================================================

INSERT INTO room_types (
    name, code, description,
    base_occupancy, max_occupancy, base_price,
    size_sqm, bed_type, view_type, floor_preference,
    smoking_allowed, image_urls, features, sort_order, is_active
) VALUES
(
    'Standard Room',
    'STD',
    'Comfortable standard room with all essential amenities',
    2, 3, 150.00,
    25.0, 'Queen', 'City', 'Any',
    false,
    '["https://example.com/rooms/standard-1.jpg", "https://example.com/rooms/standard-2.jpg"]'::jsonb,
    '["Free WiFi", "Flat Screen TV", "Private Bathroom", "Air Conditioning"]'::jsonb,
    1, true
),
(
    'Deluxe Room',
    'DLX',
    'Spacious deluxe room with premium amenities and city views',
    2, 4, 250.00,
    35.0, 'King', 'City', 'High',
    false,
    '["https://example.com/rooms/deluxe-1.jpg", "https://example.com/rooms/deluxe-2.jpg"]'::jsonb,
    '["Free WiFi", "Smart TV", "Minibar", "Coffee Maker", "Work Desk", "Sitting Area"]'::jsonb,
    2, true
),
(
    'Ocean View Suite',
    'OVS',
    'Luxury suite with breathtaking ocean views and separate living area',
    2, 4, 450.00,
    55.0, 'King', 'Ocean', 'High',
    false,
    '["https://example.com/rooms/suite-ocean-1.jpg", "https://example.com/rooms/suite-ocean-2.jpg"]'::jsonb,
    '["Panoramic Ocean View", "Separate Living Room", "Premium Bathroom", "Balcony", "Minibar", "Espresso Machine"]'::jsonb,
    3, true
),
(
    'Presidential Suite',
    'PRES',
    'Ultimate luxury with panoramic views, private terrace, and exclusive amenities',
    2, 6, 1200.00,
    120.0, '2 Kings', 'Panoramic', 'Penthouse',
    false,
    '["https://example.com/rooms/presidential-1.jpg", "https://example.com/rooms/presidential-2.jpg"]'::jsonb,
    '["Two Bedrooms", "Private Terrace", "Jacuzzi", "Full Kitchen", "Dining Room", "Butler Service", "Premium Bar"]'::jsonb,
    4, true
),
(
    'Family Room',
    'FAM',
    'Spacious family room with extra beds and kid-friendly amenities',
    4, 6, 320.00,
    45.0, '2 Queens', 'City', 'Any',
    false,
    '["https://example.com/rooms/family-1.jpg", "https://example.com/rooms/family-2.jpg"]'::jsonb,
    '["Two Queen Beds", "Sofa Bed", "Mini Fridge", "Gaming Console", "Kids Welcome Pack"]'::jsonb,
    5, true
),
(
    'Accessible Room',
    'ADA',
    'Wheelchair accessible room with adapted facilities',
    2, 3, 150.00,
    30.0, 'Queen', 'City', 'Low',
    false,
    '["https://example.com/rooms/accessible-1.jpg", "https://example.com/rooms/accessible-2.jpg"]'::jsonb,
    '["Roll-in Shower", "Grab Bars", "Wide Doorways", "Lowered Controls", "Visual Alerts"]'::jsonb,
    6, true
)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- ROOM TYPE AMENITIES MAPPING
-- ============================================================================

-- Standard Room Amenities
INSERT INTO room_type_amenities (room_type_id, amenity_id, is_standard)
SELECT rt.id, a.id, true
FROM room_types rt
CROSS JOIN amenities a
WHERE rt.code = 'STD'
  AND a.name IN (
      'Air Conditioning', 'WiFi', 'Flat Screen TV', 'Private Bathroom',
      'Shower', 'Hairdryer', 'Toiletries', 'Daily Housekeeping'
  )
ON CONFLICT DO NOTHING;

-- Deluxe Room Amenities (includes all standard + more)
INSERT INTO room_type_amenities (room_type_id, amenity_id, is_standard)
SELECT rt.id, a.id, true
FROM room_types rt
CROSS JOIN amenities a
WHERE rt.code = 'DLX'
  AND a.name IN (
      'Air Conditioning', 'WiFi', 'Flat Screen TV', 'Cable Channels',
      'Private Bathroom', 'Shower', 'Bathtub', 'Hairdryer', 'Toiletries', 'Bathrobes',
      'Minibar', 'Coffee Maker', 'Work Desk', 'Safe', 'Sofa',
      'Daily Housekeeping', 'Room Service'
  )
ON CONFLICT DO NOTHING;

-- Ocean View Suite Amenities
INSERT INTO room_type_amenities (room_type_id, amenity_id, is_standard)
SELECT rt.id, a.id, true
FROM room_types rt
CROSS JOIN amenities a
WHERE rt.code = 'OVS'
  AND a.name IN (
      'Air Conditioning', 'WiFi', 'Flat Screen TV', 'Cable Channels', 'Streaming Services',
      'Private Bathroom', 'Shower', 'Bathtub', 'Hairdryer', 'Toiletries', 'Bathrobes', 'Slippers',
      'Minibar', 'Coffee Maker', 'Work Desk', 'Safe', 'Sofa', 'Balcony',
      'Daily Housekeeping', 'Room Service', 'Turndown Service', 'Concierge'
  )
ON CONFLICT DO NOTHING;

-- Presidential Suite Amenities (all amenities)
INSERT INTO room_type_amenities (room_type_id, amenity_id, is_standard)
SELECT rt.id, a.id, true
FROM room_types rt
CROSS JOIN amenities a
WHERE rt.code = 'PRES'
ON CONFLICT DO NOTHING;

-- Family Room Amenities
INSERT INTO room_type_amenities (room_type_id, amenity_id, is_standard)
SELECT rt.id, a.id, true
FROM room_types rt
CROSS JOIN amenities a
WHERE rt.code = 'FAM'
  AND a.name IN (
      'Air Conditioning', 'WiFi', 'Flat Screen TV', 'Cable Channels',
      'Private Bathroom', 'Shower', 'Bathtub', 'Hairdryer', 'Toiletries',
      'Coffee Maker', 'Safe', 'Sofa',
      'Daily Housekeeping', 'Room Service'
  )
ON CONFLICT DO NOTHING;

-- Accessible Room Amenities
INSERT INTO room_type_amenities (room_type_id, amenity_id, is_standard)
SELECT rt.id, a.id, true
FROM room_types rt
CROSS JOIN amenities a
WHERE rt.code = 'ADA'
  AND a.name IN (
      'Air Conditioning', 'WiFi', 'Flat Screen TV',
      'Private Bathroom', 'Shower', 'Hairdryer', 'Toiletries',
      'Daily Housekeeping'
  )
ON CONFLICT DO NOTHING;

-- Add unique constraint to services name for idempotency
ALTER TABLE services ADD CONSTRAINT services_name_key UNIQUE (name);

-- ============================================================================
-- ROOMS
-- ============================================================================

-- Floor 1-3: Standard Rooms (101-330)
INSERT INTO rooms (room_number, room_type_id, floor, status, is_active)
SELECT
    (100 * floor_num + room_num)::TEXT,
    (SELECT id FROM room_types WHERE code = 'STD'),
    floor_num,
    'available',
    true
FROM generate_series(1, 3) AS floor_num,
     generate_series(1, 10) AS room_num
ON CONFLICT (room_number) DO NOTHING;

-- Floor 4-6: Deluxe Rooms (401-610)
INSERT INTO rooms (room_number, room_type_id, floor, status, is_active)
SELECT
    (100 * floor_num + room_num)::TEXT,
    (SELECT id FROM room_types WHERE code = 'DLX'),
    floor_num,
    'available',
    true
FROM generate_series(4, 6) AS floor_num,
     generate_series(1, 10) AS room_num
ON CONFLICT (room_number) DO NOTHING;

-- Floor 7: Ocean View Suites (701-708)
INSERT INTO rooms (room_number, room_type_id, floor, status, is_active)
SELECT
    (700 + room_num)::TEXT,
    (SELECT id FROM room_types WHERE code = 'OVS'),
    7,
    'available',
    true
FROM generate_series(1, 8) AS room_num
ON CONFLICT (room_number) DO NOTHING;

-- Floor 8: Presidential Suites (801-802) and Family Rooms (803-810)
INSERT INTO rooms (room_number, room_type_id, floor, status, is_active)
SELECT
    '801',
    (SELECT id FROM room_types WHERE code = 'PRES'),
    8,
    'available',
    true
UNION ALL
SELECT
    '802',
    (SELECT id FROM room_types WHERE code = 'PRES'),
    8,
    'available',
    true
UNION ALL
SELECT
    (800 + room_num)::TEXT,
    (SELECT id FROM room_types WHERE code = 'FAM'),
    8,
    'available',
    true
FROM generate_series(3, 10) AS room_num
ON CONFLICT (room_number) DO NOTHING;

-- Floor 1: Accessible Rooms (111-114)
INSERT INTO rooms (room_number, room_type_id, floor, status, is_accessible, is_active)
SELECT
    (110 + room_num)::TEXT,
    (SELECT id FROM room_types WHERE code = 'ADA'),
    1,
    'available',
    true,
    true
FROM generate_series(1, 4) AS room_num
ON CONFLICT (room_number) DO NOTHING;

-- ============================================================================
-- RATE PLANS
-- ============================================================================

INSERT INTO rate_plans (
    name, code, description, plan_type,
    adjustment_type, adjustment_value,
    valid_from, valid_to,
    applies_monday, applies_tuesday, applies_wednesday, applies_thursday,
    applies_friday, applies_saturday, applies_sunday,
    min_nights, is_active, priority
) VALUES
(
    'Standard Rate',
    'STD',
    'Standard rack rate',
    'standard',
    'percentage',
    0,
    '2025-01-01', NULL,
    true, true, true, true, true, true, true,
    1, true, 100
),
(
    'Weekend Special',
    'WKND',
    '20% discount on weekend stays',
    'promotional',
    'percentage',
    -20,
    '2025-01-01', '2025-12-31',
    false, false, false, false, true, true, true,
    2, true, 200
),
(
    'Early Bird',
    'EARLY',
    '15% discount for bookings 30 days in advance',
    'promotional',
    'percentage',
    -15,
    '2025-01-01', '2025-12-31',
    true, true, true, true, true, true, true,
    1, true, 150
),
(
    'Corporate Rate',
    'CORP',
    '25% discount for corporate accounts',
    'corporate',
    'percentage',
    -25,
    '2025-01-01', NULL,
    true, true, true, true, true, false, false,
    1, true, 250
),
(
    'Summer Season',
    'SUMMER',
    'Summer peak season rates',
    'seasonal',
    'percentage',
    30,
    '2025-06-01', '2025-08-31',
    true, true, true, true, true, true, true,
    1, true, 300
),
(
    'Holiday Special',
    'HOLIDAY',
    'Holiday season premium',
    'seasonal',
    'percentage',
    50,
    '2025-12-20', '2026-01-05',
    true, true, true, true, true, true, true,
    2, true, 400
)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- SERVICES
-- ============================================================================

INSERT INTO services (name, category, description, unit_price, unit_type, tax_rate, is_taxable, is_active) VALUES
-- Room Service
('Continental Breakfast', 'room_service', 'Continental breakfast delivered to room', 25.00, 'item', 10.0, true, true),
('American Breakfast', 'room_service', 'Full American breakfast', 35.00, 'item', 10.0, true, true),
('Lunch Menu', 'room_service', 'Room service lunch', 45.00, 'item', 10.0, true, true),
('Dinner Menu', 'room_service', 'Room service dinner', 65.00, 'item', 10.0, true, true),
('Snacks & Beverages', 'room_service', 'Light snacks and drinks', 15.00, 'item', 10.0, true, true),

-- Laundry
('Laundry Service', 'laundry', 'Wash and iron per item', 8.00, 'item', 10.0, true, true),
('Dry Cleaning', 'laundry', 'Dry cleaning per item', 15.00, 'item', 10.0, true, true),
('Express Laundry', 'laundry', 'Same day laundry service', 12.00, 'item', 10.0, true, true),

-- Spa & Wellness
('Swedish Massage 60min', 'spa', 'Relaxing Swedish massage', 120.00, 'hour', 10.0, true, true),
('Deep Tissue Massage 60min', 'spa', 'Therapeutic deep tissue massage', 140.00, 'hour', 10.0, true, true),
('Facial Treatment', 'spa', 'Rejuvenating facial', 95.00, 'item', 10.0, true, true),
('Manicure & Pedicure', 'spa', 'Complete nail care', 75.00, 'item', 10.0, true, true),

-- Transportation
('Airport Transfer', 'transport', 'One-way airport shuttle', 65.00, 'item', 0, false, true),
('Car Rental - Economy', 'transport', 'Economy car rental per day', 85.00, 'item', 10.0, true, true),
('Car Rental - Luxury', 'transport', 'Luxury car rental per day', 250.00, 'item', 10.0, true, true),

-- Other Services
('Pet Care', 'other', 'Pet sitting and care per day', 50.00, 'item', 10.0, true, true),
('Babysitting', 'other', 'Professional babysitting service per hour', 25.00, 'hour', 0, false, true),
('Meeting Room Rental', 'other', 'Conference room rental per hour', 100.00, 'hour', 10.0, true, true),
('Business Center', 'other', 'Printing, faxing, and office services', 20.00, 'item', 10.0, true, true)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SAMPLE BOOKINGS
-- ============================================================================

-- Future booking for John Smith
INSERT INTO bookings (
    booking_number, guest_id, room_id,
    check_in_date, check_out_date,
    adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount,
    status, payment_status,
    special_requests, source,
    created_by
)
SELECT
    'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0001',
    g.id,
    (SELECT id FROM rooms WHERE room_number = '501' LIMIT 1),
    CURRENT_DATE + INTERVAL '7 days',
    CURRENT_DATE + INTERVAL '10 days',
    2, 0,
    (SELECT id FROM rate_plans WHERE code = 'STD'),
    250.00,
    750.00,
    75.00,
    825.00,
    'confirmed',
    'paid',
    'High floor preferred, king bed',
    'website',
    (SELECT id FROM users WHERE username = 'admin')
FROM guests g
WHERE g.email = 'john.smith@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Checked-in booking for Sarah Johnson
INSERT INTO bookings (
    booking_number, guest_id, room_id,
    check_in_date, check_out_date,
    adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount,
    status, payment_status,
    actual_check_in,
    special_requests, source,
    created_by
)
SELECT
    'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0002',
    g.id,
    (SELECT id FROM rooms WHERE room_number = '701' LIMIT 1),
    CURRENT_DATE - INTERVAL '2 days',
    CURRENT_DATE + INTERVAL '3 days',
    2, 0,
    (SELECT id FROM rate_plans WHERE code = 'STD'),
    450.00,
    2250.00,
    225.00,
    2475.00,
    'checked_in',
    'paid',
    CURRENT_DATE - INTERVAL '2 days' + TIME '15:30:00',
    'Ocean view, celebrating anniversary',
    'phone',
    (SELECT id FROM users WHERE username = 'admin')
FROM guests g
WHERE g.email = 'sarah.johnson@email.com'
ON CONFLICT (booking_number) DO NOTHING;

-- Update room status for checked-in booking
UPDATE rooms SET status = 'occupied'
WHERE room_number = '701';

-- Future booking for Emily Williams (VIP)
INSERT INTO bookings (
    booking_number, guest_id, room_id,
    check_in_date, check_out_date,
    adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount,
    status, payment_status,
    special_requests, source,
    created_by
)
SELECT
    'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-0003',
    g.id,
    (SELECT id FROM rooms WHERE room_number = '801' LIMIT 1),
    CURRENT_DATE + INTERVAL '14 days',
    CURRENT_DATE + INTERVAL '17 days',
    2, 0,
    (SELECT id FROM rate_plans WHERE code = 'STD'),
    1200.00,
    3600.00,
    360.00,
    3960.00,
    'confirmed',
    'partial',
    'VIP guest, presidential suite, welcome champagne and flowers',
    'direct',
    (SELECT id FROM users WHERE username = 'admin')
FROM guests g
WHERE g.email = 'emily.williams@email.com'
ON CONFLICT (booking_number) DO NOTHING;
