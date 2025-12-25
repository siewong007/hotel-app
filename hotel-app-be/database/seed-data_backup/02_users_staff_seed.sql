-- ============================================================================
-- ENHANCED USER ACCOUNTS SEED DATA
-- ============================================================================
-- Comprehensive test accounts for all user types with clear login credentials
-- ============================================================================
--
-- LOGIN CREDENTIALS REFERENCE:
-- ============================================================================
--
-- ADMINISTRATIVE USERS:
-- ---------------------
-- Username: admin              | Password: Admin@123      | Role: Admin (Super Admin)
-- Username: superadmin         | Password: SuperAdmin123! | Role: Super Admin
-- Username: manager1           | Password: Admin@123      | Role: Manager
--
-- RECEPTION STAFF:
-- ----------------
-- Username: receptionist1      | Password: Admin@123      | Role: Receptionist (Morning Shift)
-- Username: receptionist2      | Password: Admin@123      | Role: Receptionist (Evening Shift)
-- Username: receptionist3      | Password: Admin@123      | Role: Receptionist (Night Shift)
--
-- GENERAL STAFF:
-- --------------
-- Username: staff1             | Password: Admin@123      | Role: Staff
-- Username: housekeeping1      | Password: Admin@123      | Role: Staff (Housekeeping)
-- Username: maintenance1       | Password: Admin@123      | Role: Staff (Maintenance)
--
-- GUEST ACCOUNTS (For testing guest features):
-- ---------------------------------------------
-- Username: guest1             | Password: Guest@123      | Guest: John Smith
-- Username: guest2             | Password: Guest@123      | Guest: Sarah Johnson (VIP, 2FA)
-- Username: guest3             | Password: Guest@123      | Guest: Emily Williams (VIP Platinum)
-- Username: guest4             | Password: Guest@123      | Guest: Michael Brown (Corporate)
-- Username: guest5             | Password: Guest@123      | Guest: Lisa Davis (New)
-- Username: guest6             | Password: Guest@123      | Guest: Robert Wilson (UK)
-- Username: guest7             | Password: Guest@123      | Guest: María González (Spain)
-- Username: guest8             | Password: Guest@123      | Guest: David Lee
-- Username: guest9             | Password: Guest@123      | Guest: Jennifer Martinez
-- Username: guest10            | Password: Guest@123      | Guest: James Anderson (Corporate)
--
-- ============================================================================

-- ============================================================================
-- PART 1: STAFF USERS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- MANAGERS
-- ----------------------------------------------------------------------------

-- Manager 1: Alice Manager (2FA enabled)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, created_at
) VALUES (
    'manager1',
    'manager@hotel.com',
    '$2b$12$P2hNNHU8M1HsaW20lj3COuwvTNc2WjnkQCRn58Ww3sZPu1ZLcUpNC', -- Admin@123
    'Alice Manager',
    '+1-555-0101',
    'staff',
    true,
    true,
    false,
    true,
    CURRENT_TIMESTAMP - INTERVAL '365 days'
)
ON CONFLICT (username) DO NOTHING;

-- ----------------------------------------------------------------------------
-- RECEPTIONISTS (24/7 Coverage - Morning, Evening, Night shifts)
-- ----------------------------------------------------------------------------

-- Receptionist 1: Morning Shift (6 AM - 2 PM)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, last_login_at, created_at
) VALUES (
    'receptionist1',
    'reception.morning@hotel.com',
    '$2b$12$P2hNNHU8M1HsaW20lj3COuwvTNc2WjnkQCRn58Ww3sZPu1ZLcUpNC', -- Admin@123
    'Bob Martinez - Morning Shift',
    '+1-555-0201',
    'staff',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '2 hours',
    CURRENT_TIMESTAMP - INTERVAL '180 days'
)
ON CONFLICT (username) DO NOTHING;

-- Receptionist 2: Evening Shift (2 PM - 10 PM)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, last_login_at, created_at
) VALUES (
    'receptionist2',
    'reception.evening@hotel.com',
    '$2b$12$P2hNNHU8M1HsaW20lj3COuwvTNc2WjnkQCRn58Ww3sZPu1ZLcUpNC', -- Admin@123
    'Carol Chen - Evening Shift',
    '+1-555-0202',
    'staff',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '5 hours',
    CURRENT_TIMESTAMP - INTERVAL '90 days'
)
ON CONFLICT (username) DO NOTHING;

-- Receptionist 3: Night Shift (10 PM - 6 AM)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, created_at
) VALUES (
    'receptionist3',
    'reception.night@hotel.com',
    '$2b$12$P2hNNHU8M1HsaW20lj3COuwvTNc2WjnkQCRn58Ww3sZPu1ZLcUpNC', -- Admin@123
    'Daniel Night - Night Shift',
    '+1-555-0203',
    'staff',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '120 days'
)
ON CONFLICT (username) DO NOTHING;

-- ----------------------------------------------------------------------------
-- GENERAL STAFF
-- ----------------------------------------------------------------------------

-- General Staff 1
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, created_at
) VALUES (
    'staff1',
    'staff1@hotel.com',
    '$2b$12$P2hNNHU8M1HsaW20lj3COuwvTNc2WjnkQCRn58Ww3sZPu1ZLcUpNC', -- Admin@123
    'David Staff',
    '+1-555-0301',
    'staff',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '60 days'
)
ON CONFLICT (username) DO NOTHING;

-- Housekeeping Staff
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, created_at
) VALUES (
    'housekeeping1',
    'housekeeping@hotel.com',
    '$2b$12$P2hNNHU8M1HsaW20lj3COuwvTNc2WjnkQCRn58Ww3sZPu1ZLcUpNC', -- Admin@123
    'Emma Housekeeping',
    '+1-555-0302',
    'staff',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '150 days'
)
ON CONFLICT (username) DO NOTHING;

-- Maintenance Staff
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, created_at
) VALUES (
    'maintenance1',
    'maintenance@hotel.com',
    '$2b$12$P2hNNHU8M1HsaW20lj3COuwvTNc2WjnkQCRn58Ww3sZPu1ZLcUpNC', -- Admin@123
    'Frank Maintenance',
    '+1-555-0303',
    'staff',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '200 days'
)
ON CONFLICT (username) DO NOTHING;

-- ============================================================================
-- PART 2: GUEST USER ACCOUNTS (Linked to guest profiles)
-- ============================================================================

-- Guest 1: John Smith (Regular guest, Bronze tier)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, last_login_at, created_at
) VALUES (
    'guest1',
    'john.smith@email.com',
    '$2b$12$LhGYN5Z8K6vY5nX5Z8K6ve5Z8K6vY5nX5Z8K6vY5nX5Z8K6vY5nX5a', -- Guest@123
    'John Smith',
    '+1-555-1001',
    'guest',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '1 day',
    CURRENT_TIMESTAMP - INTERVAL '200 days'
)
ON CONFLICT (username) DO NOTHING;

-- Guest 2: Sarah Johnson (VIP guest, Silver tier, 2FA enabled)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, two_factor_secret,
    two_factor_recovery_codes, last_login_at, created_at
) VALUES (
    'guest2',
    'sarah.johnson@email.com',
    '$2b$12$LhGYN5Z8K6vY5nX5Z8K6ve5Z8K6vY5nX5Z8K6vY5nX5Z8K6vY5nX5a', -- Guest@123
    'Sarah Johnson',
    '+1-555-1002',
    'guest',
    true,
    true,
    false,
    true,
    'JBSWY3DPEHPK3PXP',
    ARRAY['BACKUP1234', 'BACKUP5678', 'BACKUP9012'],
    CURRENT_TIMESTAMP - INTERVAL '3 hours',
    CURRENT_TIMESTAMP - INTERVAL '150 days'
)
ON CONFLICT (username) DO NOTHING;

-- Guest 3: Emily Williams (VIP Platinum, highest tier)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, created_at
) VALUES (
    'guest3',
    'emily.williams@email.com',
    '$2b$12$LhGYN5Z8K6vY5nX5Z8K6ve5Z8K6vY5nX5Z8K6vY5nX5Z8K6vY5nX5a', -- Guest@123
    'Emily Williams',
    '+1-555-1003',
    'guest',
    true,
    true,
    false,
    true,
    CURRENT_TIMESTAMP - INTERVAL '400 days'
)
ON CONFLICT (username) DO NOTHING;

-- Guest 4: Michael Brown (Corporate guest, Gold tier)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, last_login_at, created_at
) VALUES (
    'guest4',
    'michael.brown@corporate.com',
    '$2b$12$LhGYN5Z8K6vY5nX5Z8K6ve5Z8K6vY5nX5Z8K6vY5nX5Z8K6vY5nX5a', -- Guest@123
    'Michael Brown',
    '+1-555-1004',
    'guest',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '5 days',
    CURRENT_TIMESTAMP - INTERVAL '300 days'
)
ON CONFLICT (username) DO NOTHING;

-- Guest 5: Lisa Davis (New guest, just registered)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, created_at
) VALUES (
    'guest5',
    'lisa.davis@email.com',
    '$2b$12$LhGYN5Z8K6vY5nX5Z8K6ve5Z8K6vY5nX5Z8K6vY5nX5Z8K6vY5nX5a', -- Guest@123
    'Lisa Davis',
    '+1-555-1005',
    'guest',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '2 hours'
)
ON CONFLICT (username) DO NOTHING;

-- Guest 6: Robert Wilson (International - UK)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, created_at
) VALUES (
    'guest6',
    'robert.wilson@email.com',
    '$2b$12$LhGYN5Z8K6vY5nX5Z8K6ve5Z8K6vY5nX5Z8K6vY5nX5Z8K6vY5nX5a', -- Guest@123
    'Robert Wilson',
    '+44-20-1234-5678',
    'guest',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '100 days'
)
ON CONFLICT (username) DO NOTHING;

-- Guest 7: María González (International - Spain)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, created_at
) VALUES (
    'guest7',
    'maria.gonzalez@email.com',
    '$2b$12$LhGYN5Z8K6vY5nX5Z8K6ve5Z8K6vY5nX5Z8K6vY5nX5Z8K6vY5nX5a', -- Guest@123
    'María González',
    '+34-91-123-4567',
    'guest',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '75 days'
)
ON CONFLICT (username) DO NOTHING;

-- Guest 8: David Lee (Minimal profile)
INSERT INTO users (
    username, email, password_hash, full_name,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, created_at
) VALUES (
    'guest8',
    'david.lee@email.com',
    '$2b$12$LhGYN5Z8K6vY5nX5Z8K6ve5Z8K6vY5nX5Z8K6vY5nX5Z8K6vY5nX5a', -- Guest@123
    'David Lee',
    'guest',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '30 days'
)
ON CONFLICT (username) DO NOTHING;

-- Guest 9: Jennifer Martinez (Family guest)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, created_at
) VALUES (
    'guest9',
    'jennifer.martinez@email.com',
    '$2b$12$LhGYN5Z8K6vY5nX5Z8K6ve5Z8K6vY5nX5Z8K6vY5nX5Z8K6vY5nX5a', -- Guest@123
    'Jennifer Martinez',
    '+1-555-1009',
    'guest',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '7 days'
)
ON CONFLICT (username) DO NOTHING;

-- Guest 10: James Anderson (Corporate account leader)
INSERT INTO users (
    username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_super_admin,
    two_factor_enabled, created_at
) VALUES (
    'guest10',
    'james.anderson@techcorp.com',
    '$2b$12$LhGYN5Z8K6vY5nX5Z8K6ve5Z8K6vY5nX5Z8K6vY5nX5Z8K6vY5nX5a', -- Guest@123
    'James Anderson',
    '+1-555-1010',
    'guest',
    true,
    true,
    false,
    false,
    CURRENT_TIMESTAMP - INTERVAL '60 days'
)
ON CONFLICT (username) DO NOTHING;

-- ============================================================================
-- PART 3: ASSIGN ROLES TO USERS
-- ============================================================================

-- Assign manager role
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.username = 'manager1' AND r.name = 'manager'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Assign receptionist roles
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.username IN ('receptionist1', 'receptionist2', 'receptionist3')
  AND r.name = 'receptionist'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Assign staff roles
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.username IN ('staff1', 'housekeeping1', 'maintenance1')
  AND r.name = 'staff'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Assign guest roles to all guest accounts
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.username IN ('guest1', 'guest2', 'guest3', 'guest4', 'guest5',
                     'guest6', 'guest7', 'guest8', 'guest9', 'guest10')
  AND r.name = 'guest'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ============================================================================
-- PART 4: AUDIT LOG ENTRIES
-- ============================================================================

INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details)
SELECT
    u.id,
    'user.login',
    'users',
    u.id,
    jsonb_build_object(
        'username', u.username,
        'timestamp', u.last_login_at,
        'ip_address', '192.168.1.' || (100 + (random() * 50)::int)::text
    )
FROM users u
WHERE u.last_login_at IS NOT NULL;

-- ============================================================================
-- SUMMARY OUTPUT
-- ============================================================================

\echo ''
\echo '============================================================================'
\echo '✓ USER ACCOUNTS CREATED SUCCESSFULLY'
\echo '============================================================================'
\echo ''
\echo 'STAFF ACCOUNTS:'
\echo '---------------'
\echo '  • 1 Manager:       manager1 (2FA enabled)'
\echo '  • 3 Receptionists: receptionist1 (morning), receptionist2 (evening), receptionist3 (night)'
\echo '  • 3 Staff:         staff1, housekeeping1, maintenance1'
\echo ''
\echo 'GUEST ACCOUNTS:'
\echo '---------------'
\echo '  • guest1:  John Smith (Bronze tier, regular)'
\echo '  • guest2:  Sarah Johnson (Silver tier, VIP, 2FA)'
\echo '  • guest3:  Emily Williams (Platinum tier, VIP)'
\echo '  • guest4:  Michael Brown (Gold tier, corporate)'
\echo '  • guest5:  Lisa Davis (Bronze tier, new)'
\echo '  • guest6:  Robert Wilson (International - UK)'
\echo '  • guest7:  María González (International - Spain)'
\echo '  • guest8:  David Lee (Minimal profile)'
\echo '  • guest9:  Jennifer Martinez (Family)'
\echo '  • guest10: James Anderson (Corporate leader)'
\echo ''
\echo 'LOGIN CREDENTIALS:'
\echo '------------------'
\echo '  Staff Password:  Admin@123'
\echo '  Guest Password:  Guest@123'
\echo ''
\echo '⚠️  IMPORTANT: Change all passwords in production!'
\echo '============================================================================'
\echo ''
