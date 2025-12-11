-- ============================================================================
-- USER DATA SEED DATA
-- ============================================================================
-- Sample guests, loyalty programs, and reviews
-- ============================================================================

-- ============================================================================
-- LOYALTY PROGRAMS
-- ============================================================================

INSERT INTO loyalty_programs (name, description, tier_level, points_multiplier, minimum_points_required, benefits, is_active) VALUES
(
    'Bronze Member',
    'Entry level loyalty program',
    1,
    1.0,
    0,
    '["Early check-in subject to availability", "Late check-out subject to availability", "Welcome drink"]'::jsonb,
    true
),
(
    'Silver Member',
    'Mid-tier loyalty program',
    2,
    1.5,
    1000,
    '["Guaranteed early check-in", "Guaranteed late check-out", "Room upgrade subject to availability", "10% discount on services", "Priority support"]'::jsonb,
    true
),
(
    'Gold Member',
    'Premium loyalty program',
    3,
    2.0,
    5000,
    '["Guaranteed room upgrade", "Free breakfast", "20% discount on services", "Priority check-in", "Complimentary airport transfer", "Access to executive lounge"]'::jsonb,
    true
),
(
    'Platinum Member',
    'Elite loyalty program',
    4,
    3.0,
    10000,
    '["Best available room upgrade", "Free breakfast and dinner", "30% discount on all services", "Personal concierge", "Complimentary spa access", "Exclusive member events", "Late checkout until 4 PM"]'::jsonb,
    true
)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SAMPLE GUESTS
-- ============================================================================

INSERT INTO guests (
    first_name, last_name, title, gender, date_of_birth, nationality,
    email, phone, preferred_contact_method,
    address_line1, city, state_province, postal_code, country,
    id_type, id_number, id_issue_country,
    language, currency,
    guest_type, vip_status,
    marketing_consent, newsletter_subscribed,
    source
) VALUES
(
    'John', 'Smith', 'Mr.', 'Male', '1985-03-15', 'United States',
    'john.smith@email.com', '+1-555-0101', 'email',
    '456 Park Avenue', 'New York', 'NY', '10022', 'United States',
    'passport', 'US123456789', 'United States',
    'en', 'USD',
    'individual', false,
    true, true,
    'website'
),
(
    'Sarah', 'Johnson', 'Ms.', 'Female', '1990-07-22', 'United States',
    'sarah.johnson@email.com', '+1-555-0102', 'email',
    '789 Broadway', 'New York', 'NY', '10003', 'United States',
    'drivers_license', 'NY987654321', 'United States',
    'en', 'USD',
    'individual', true,
    true, true,
    'phone'
),
(
    'Michael', 'Chen', 'Mr.', 'Male', '1982-11-08', 'China',
    'michael.chen@email.com', '+86-138-0000-0001', 'whatsapp',
    '123 Nanjing Road', 'Shanghai', 'Shanghai', '200001', 'China',
    'passport', 'CN456789123', 'China',
    'zh', 'USD',
    'corporate', false,
    false, false,
    'booking_com'
),
(
    'Emily', 'Williams', 'Mrs.', 'Female', '1988-05-30', 'United Kingdom',
    'emily.williams@email.com', '+44-20-7946-0958', 'email',
    '10 Downing Street', 'London', 'Greater London', 'SW1A 2AA', 'United Kingdom',
    'passport', 'UK789123456', 'United Kingdom',
    'en', 'USD',
    'individual', true,
    true, true,
    'website'
),
(
    'David', 'Martinez', 'Mr.', 'Male', '1975-09-12', 'Spain',
    'david.martinez@email.com', '+34-91-000-0000', 'email',
    'Gran Via 1', 'Madrid', 'Madrid', '28013', 'Spain',
    'national_id', 'ES123456789X', 'Spain',
    'es', 'EUR',
    'individual', false,
    true, false,
    'expedia'
),
(
    'Lisa', 'Anderson', 'Dr.', 'Female', '1980-12-25', 'Canada',
    'lisa.anderson@email.com', '+1-416-555-0000', 'email',
    '1 Front Street', 'Toronto', 'Ontario', 'M5J 2X2', 'Canada',
    'passport', 'CA987654321', 'Canada',
    'en', 'USD',
    'individual', true,
    true, true,
    'direct'
),
(
    'Robert', 'Taylor', 'Mr.', 'Male', '1992-02-14', 'Australia',
    'robert.taylor@email.com', '+61-2-9000-0000', 'sms',
    '1 Harbour Street', 'Sydney', 'NSW', '2000', 'Australia',
    'passport', 'AU123789456', 'Australia',
    'en', 'AUD',
    'individual', false,
    false, false,
    'website'
),
(
    'Maria', 'Garcia', 'Ms.', 'Female', '1987-08-19', 'Mexico',
    'maria.garcia@email.com', '+52-55-5000-0000', 'whatsapp',
    'Paseo de la Reforma 1', 'Mexico City', 'CDMX', '06600', 'Mexico',
    'passport', 'MX456123789', 'Mexico',
    'es', 'MXN',
    'individual', false,
    true, true,
    'booking_com'
)
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- GUEST PREFERENCES
-- ============================================================================

-- John Smith preferences
INSERT INTO guest_preferences (guest_id, preference_category, preference_key, preference_value)
SELECT g.id, 'room', 'floor', 'high'
FROM guests g WHERE g.email = 'john.smith@email.com'
ON CONFLICT (guest_id, preference_category, preference_key) DO NOTHING;

INSERT INTO guest_preferences (guest_id, preference_category, preference_key, preference_value)
SELECT g.id, 'room', 'bed_type', 'king'
FROM guests g WHERE g.email = 'john.smith@email.com'
ON CONFLICT (guest_id, preference_category, preference_key) DO NOTHING;

INSERT INTO guest_preferences (guest_id, preference_category, preference_key, preference_value)
SELECT g.id, 'amenity', 'newspaper', 'Wall Street Journal'
FROM guests g WHERE g.email = 'john.smith@email.com'
ON CONFLICT (guest_id, preference_category, preference_key) DO NOTHING;

-- Sarah Johnson preferences
INSERT INTO guest_preferences (guest_id, preference_category, preference_key, preference_value)
SELECT g.id, 'room', 'view', 'ocean'
FROM guests g WHERE g.email = 'sarah.johnson@email.com'
ON CONFLICT (guest_id, preference_category, preference_key) DO NOTHING;

INSERT INTO guest_preferences (guest_id, preference_category, preference_key, preference_value)
SELECT g.id, 'room', 'smoking', 'non-smoking'
FROM guests g WHERE g.email = 'sarah.johnson@email.com'
ON CONFLICT (guest_id, preference_category, preference_key) DO NOTHING;

INSERT INTO guest_preferences (guest_id, preference_category, preference_key, preference_value)
SELECT g.id, 'service', 'pillow_type', 'hypoallergenic'
FROM guests g WHERE g.email = 'sarah.johnson@email.com'
ON CONFLICT (guest_id, preference_category, preference_key) DO NOTHING;

-- ============================================================================
-- LOYALTY MEMBERSHIPS
-- ============================================================================

-- Assign loyalty memberships to guests
INSERT INTO loyalty_memberships (guest_id, program_id, membership_number, points_balance, lifetime_points, tier_level, status)
SELECT
    g.id,
    lp.id,
    'LM-' || LPAD(g.id::text, 8, '0'),
    500,
    500,
    1,
    'active'
FROM guests g
CROSS JOIN loyalty_programs lp
WHERE g.email = 'john.smith@email.com' AND lp.name = 'Bronze Member'
ON CONFLICT (guest_id, program_id) DO NOTHING;

INSERT INTO loyalty_memberships (guest_id, program_id, membership_number, points_balance, lifetime_points, tier_level, status)
SELECT
    g.id,
    lp.id,
    'LM-' || LPAD(g.id::text, 8, '0'),
    3500,
    3500,
    2,
    'active'
FROM guests g
CROSS JOIN loyalty_programs lp
WHERE g.email = 'sarah.johnson@email.com' AND lp.name = 'Silver Member'
ON CONFLICT (guest_id, program_id) DO NOTHING;

INSERT INTO loyalty_memberships (guest_id, program_id, membership_number, points_balance, lifetime_points, tier_level, status)
SELECT
    g.id,
    lp.id,
    'LM-' || LPAD(g.id::text, 8, '0'),
    7500,
    7500,
    3,
    'active'
FROM guests g
CROSS JOIN loyalty_programs lp
WHERE g.email = 'emily.williams@email.com' AND lp.name = 'Gold Member'
ON CONFLICT (guest_id, program_id) DO NOTHING;

INSERT INTO loyalty_memberships (guest_id, program_id, membership_number, points_balance, lifetime_points, tier_level, status)
SELECT
    g.id,
    lp.id,
    'LM-' || LPAD(g.id::text, 8, '0'),
    15000,
    15000,
    4,
    'active'
FROM guests g
CROSS JOIN loyalty_programs lp
WHERE g.email = 'lisa.anderson@email.com' AND lp.name = 'Platinum Member'
ON CONFLICT (guest_id, program_id) DO NOTHING;

-- ============================================================================
-- GUEST NOTES
-- ============================================================================

INSERT INTO guest_notes (guest_id, note, note_type, priority, is_alert, created_by)
SELECT
    g.id,
    'VIP guest - ensure room upgrade and welcome amenities',
    'alert',
    'high',
    true,
    (SELECT id FROM users WHERE username = 'admin')
FROM guests g
WHERE g.email = 'sarah.johnson@email.com';

INSERT INTO guest_notes (guest_id, note, note_type, priority, is_alert, created_by)
SELECT
    g.id,
    'Regular business traveler - prefers quiet rooms away from elevator',
    'general',
    'normal',
    false,
    (SELECT id FROM users WHERE username = 'admin')
FROM guests g
WHERE g.email = 'michael.chen@email.com';

INSERT INTO guest_notes (guest_id, note, note_type, priority, is_alert, created_by)
SELECT
    g.id,
    'Celebrating anniversary - arrange flowers and champagne',
    'alert',
    'high',
    true,
    (SELECT id FROM users WHERE username = 'admin')
FROM guests g
WHERE g.email = 'emily.williams@email.com';

-- ============================================================================
-- CORPORATE ACCOUNTS
-- ============================================================================

INSERT INTO corporate_accounts (
    company_name, company_email, company_phone,
    billing_address, tax_id, account_number,
    credit_limit, payment_terms, discount_percentage,
    primary_contact_name, primary_contact_email, primary_contact_phone,
    account_status
) VALUES
(
    'Tech Innovations Inc.',
    'billing@techinnovations.com',
    '+1-555-1000',
    '100 Tech Drive, Silicon Valley, CA 94025',
    'US-TAX-123456789',
    'CORP-001',
    50000.00,
    30,
    15.00,
    'Jennifer Brown',
    'jennifer.brown@techinnovations.com',
    '+1-555-1001',
    'active'
),
(
    'Global Consulting Group',
    'accounts@globalconsulting.com',
    '+1-555-2000',
    '200 Business Plaza, New York, NY 10001',
    'US-TAX-987654321',
    'CORP-002',
    75000.00,
    45,
    20.00,
    'Richard Davis',
    'richard.davis@globalconsulting.com',
    '+1-555-2001',
    'active'
),
(
    'International Trading Co.',
    'finance@intltrading.com',
    '+44-20-8000-0000',
    '50 Trade Street, London, UK',
    'UK-VAT-123456789',
    'CORP-003',
    100000.00,
    60,
    25.00,
    'Victoria Smith',
    'victoria.smith@intltrading.com',
    '+44-20-8000-0001',
    'active'
);

-- ============================================================================
-- GUEST-CORPORATE LINKS
-- ============================================================================

INSERT INTO guest_corporate_links (guest_id, corporate_account_id, employee_id, department, is_primary_contact, linked_by)
SELECT
    g.id,
    ca.id,
    'EMP-001',
    'Engineering',
    false,
    (SELECT id FROM users WHERE username = 'admin')
FROM guests g
CROSS JOIN corporate_accounts ca
WHERE g.email = 'michael.chen@email.com'
  AND ca.company_name = 'Tech Innovations Inc.'
ON CONFLICT (guest_id, corporate_account_id) DO NOTHING;

INSERT INTO guest_corporate_links (guest_id, corporate_account_id, employee_id, department, is_primary_contact, linked_by)
SELECT
    g.id,
    ca.id,
    'CON-042',
    'Consulting',
    false,
    (SELECT id FROM users WHERE username = 'admin')
FROM guests g
CROSS JOIN corporate_accounts ca
WHERE g.email = 'david.martinez@email.com'
  AND ca.company_name = 'Global Consulting Group'
ON CONFLICT (guest_id, corporate_account_id) DO NOTHING;

-- ============================================================================
-- GUEST REVIEWS (Sample)
-- ============================================================================

INSERT INTO guest_reviews (
    guest_id, overall_rating, cleanliness_rating, staff_rating,
    facilities_rating, value_rating, location_rating,
    title, review_text, pros, cons, recommend,
    stay_type, is_verified, is_published
)
SELECT
    g.id,
    5.0, 5.0, 5.0, 4.5, 4.5, 5.0,
    'Excellent Stay!',
    'Had a wonderful experience at the hotel. The staff was incredibly friendly and the room was spotless. The location is perfect for both business and leisure.',
    'Excellent service, great location, comfortable beds',
    'WiFi could be faster',
    true,
    'business',
    true,
    true
FROM guests g
WHERE g.email = 'john.smith@email.com';

INSERT INTO guest_reviews (
    guest_id, overall_rating, cleanliness_rating, staff_rating,
    facilities_rating, value_rating, location_rating,
    title, review_text, pros, cons, recommend,
    stay_type, is_verified, is_published
)
SELECT
    g.id,
    4.5, 5.0, 5.0, 4.0, 4.0, 4.5,
    'Great for Business Travel',
    'Perfect hotel for business trips. Good amenities, professional staff, and convenient location. Would definitely stay again.',
    'Professional service, good meeting facilities',
    'Breakfast options could be expanded',
    true,
    'business',
    true,
    true
FROM guests g
WHERE g.email = 'michael.chen@email.com';

INSERT INTO guest_reviews (
    guest_id, overall_rating, cleanliness_rating, staff_rating,
    facilities_rating, value_rating, location_rating,
    title, review_text, pros, cons, recommend,
    stay_type, is_verified, is_published
)
SELECT
    g.id,
    5.0, 5.0, 5.0, 5.0, 4.5, 5.0,
    'Perfect Anniversary Getaway',
    'We celebrated our anniversary here and it was perfect! The staff went above and beyond to make it special. The room was beautifully decorated and the champagne was a lovely touch.',
    'Exceptional service, romantic atmosphere, attention to detail',
    'None - everything was perfect!',
    true,
    'couple',
    true,
    true
FROM guests g
WHERE g.email = 'emily.williams@email.com';
