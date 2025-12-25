-- ============================================================================
-- SEED 01: SYSTEM CONFIGURATION, ROLES, PERMISSIONS & ADMIN USERS
-- ============================================================================

-- ============================================================================
-- ROLES
-- ============================================================================

INSERT INTO roles (name, display_name, description, is_system_role, priority) VALUES
('super_admin', 'Super Administrator', 'Super administrator with full system access', true, 1000),
('admin', 'Administrator', 'Full system access and administration', true, 100),
('manager', 'Manager', 'Hotel operations management', true, 80),
('receptionist', 'Receptionist', 'Front desk and booking management', true, 60),
('staff', 'Staff', 'Basic hotel staff access', true, 40),
('guest', 'Guest', 'Guest user access', true, 20)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    priority = EXCLUDED.priority,
    updated_at = CURRENT_TIMESTAMP;

-- ============================================================================
-- PERMISSIONS
-- ============================================================================

INSERT INTO permissions (name, resource, action, description, is_system_permission) VALUES
('users:create', 'users', 'create', 'Create new users', true),
('users:read', 'users', 'read', 'View user information', true),
('users:update', 'users', 'update', 'Update user information', true),
('users:delete', 'users', 'delete', 'Delete users', true),
('users:manage', 'users', 'manage', 'Full user management', true),
('roles:create', 'roles', 'create', 'Create new roles', true),
('roles:read', 'roles', 'read', 'View roles', true),
('roles:update', 'roles', 'update', 'Update roles', true),
('roles:delete', 'roles', 'delete', 'Delete roles', true),
('roles:manage', 'roles', 'manage', 'Full role management', true),
('permissions:manage', 'permissions', 'manage', 'Full permission management access', true),
('rooms:create', 'rooms', 'create', 'Create new rooms', true),
('rooms:read', 'rooms', 'read', 'View room information', true),
('rooms:update', 'rooms', 'update', 'Update room information', true),
('rooms:delete', 'rooms', 'delete', 'Delete rooms', true),
('rooms:manage', 'rooms', 'manage', 'Full room management', true),
('bookings:create', 'bookings', 'create', 'Create new bookings', true),
('bookings:read', 'bookings', 'read', 'View bookings', true),
('bookings:update', 'bookings', 'update', 'Update bookings', true),
('bookings:delete', 'bookings', 'delete', 'Cancel bookings', true),
('bookings:manage', 'bookings', 'manage', 'Full booking management', true),
('guests:create', 'guests', 'create', 'Create guest profiles', true),
('guests:read', 'guests', 'read', 'View guest information', true),
('guests:update', 'guests', 'update', 'Update guest information', true),
('guests:delete', 'guests', 'delete', 'Delete guest profiles', true),
('guests:manage', 'guests', 'manage', 'Full guest management', true),
('payments:create', 'payments', 'create', 'Process payments', true),
('payments:read', 'payments', 'read', 'View payment information', true),
('payments:update', 'payments', 'update', 'Update payments', true),
('payments:delete', 'payments', 'delete', 'Delete payment records', true),
('payments:manage', 'payments', 'manage', 'Full payment management', true),
('services:create', 'services', 'create', 'Create new services', true),
('services:read', 'services', 'read', 'View service information', true),
('services:update', 'services', 'update', 'Update services', true),
('services:delete', 'services', 'delete', 'Delete services', true),
('services:manage', 'services', 'manage', 'Full service management', true),
('reviews:create', 'reviews', 'create', 'Create reviews', true),
('reviews:read', 'reviews', 'read', 'View reviews', true),
('reviews:update', 'reviews', 'update', 'Update reviews', true),
('reviews:delete', 'reviews', 'delete', 'Delete reviews', true),
('reviews:manage', 'reviews', 'manage', 'Full review management', true),
('settings:read', 'settings', 'read', 'View system settings', true),
('settings:update', 'settings', 'update', 'Update system settings', true),
('settings:manage', 'settings', 'manage', 'Full settings management', true),
('reports:read', 'reports', 'read', 'View reports', true),
('reports:execute', 'reports', 'execute', 'Generate reports', true),
('analytics:read', 'analytics', 'read', 'Access to analytics and reports', true),
('audit:read', 'audit', 'read', 'View audit logs', true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, resource = EXCLUDED.resource, action = EXCLUDED.action;

-- ============================================================================
-- ROLE-PERMISSION MAPPINGS
-- ============================================================================

-- Super Admin & Admin get all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name IN ('admin', 'super_admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Manager permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'manager' AND p.name IN (
    'users:read', 'users:create', 'users:update', 'rooms:manage', 'bookings:manage', 'guests:manage',
    'payments:manage', 'services:manage', 'reviews:manage', 'reports:read', 'reports:execute'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Receptionist permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'receptionist' AND p.name IN (
    'rooms:read', 'rooms:update', 'bookings:create', 'bookings:read', 'bookings:update',
    'guests:create', 'guests:read', 'guests:update', 'payments:create', 'payments:read',
    'services:read', 'services:create', 'reviews:read', 'settings:read', 'analytics:read', 'reports:execute'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Staff permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'staff' AND p.name IN (
    'rooms:read', 'bookings:read', 'guests:read', 'services:read', 'services:create', 'reviews:read'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Guest permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'guest' AND p.name IN (
    'rooms:read', 'bookings:create', 'bookings:read', 'reviews:create', 'reviews:read', 'reviews:update'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================================
-- ADMIN USERS (Password: Admin@123)
-- ============================================================================

INSERT INTO users (id, username, email, password_hash, full_name, is_active, is_verified, is_super_admin, created_at, updated_at)
VALUES (1000, 'admin', 'admin@hotel.com', '$2b$12$P2hNNHU8M1HsaW20lj3COuwvTNc2WjnkQCRn58Ww3sZPu1ZLcUpNC',
    'System Administrator', true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_super_admin = EXCLUDED.is_super_admin;

-- Reset sequence before inserting more users
SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000) + 1, false);

INSERT INTO users (username, email, password_hash, full_name, is_active, is_verified, is_super_admin, created_at)
VALUES ('superadmin', 'superadmin@hotel.local', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYxN8/LewY5G',
    'Super Administrator', true, true, true, CURRENT_TIMESTAMP)
ON CONFLICT (username) DO UPDATE SET is_super_admin = true;

-- Assign admin roles
INSERT INTO user_roles (user_id, role_id) SELECT 1000, id FROM roles WHERE name = 'admin' ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = 'superadmin' AND r.name = 'super_admin' ON CONFLICT DO NOTHING;

-- ============================================================================
-- SYSTEM SETTINGS
-- ============================================================================

INSERT INTO system_settings (key, value, value_type, category, description, is_public) VALUES
('hotel_name', 'Grand Hotel', 'string', 'general', 'Hotel name', true),
('hotel_address', '123 Main Street, City', 'string', 'general', 'Hotel address', true),
('hotel_phone', '+1-555-0123', 'string', 'general', 'Hotel contact phone', true),
('hotel_email', 'info@grandhotel.com', 'string', 'general', 'Hotel contact email', true),
('check_in_time', '15:00', 'string', 'general', 'Standard check-in time', true),
('check_out_time', '11:00', 'string', 'general', 'Standard check-out time', true),
('currency', 'USD', 'string', 'general', 'Default currency code', true),
('timezone', 'America/New_York', 'string', 'general', 'Hotel timezone', false),
('max_login_attempts', '5', 'number', 'security', 'Maximum failed login attempts before lockout', false),
('session_timeout', '3600', 'number', 'security', 'Session timeout in seconds', false),
('enable_2fa', 'false', 'boolean', 'security', 'Enable two-factor authentication', false),
('enable_email_verification', 'true', 'boolean', 'security', 'Require email verification', false),
('rate_codes', '["RACK","OVR","CORP","GOVT","WKII","PKG","GRP","AAA","PROMO"]', 'json', 'rates', 'Available rate codes', true),
('market_codes', '["WKII","CORP","GOVT","OTA","DIRECT","GROUP","EVENTS","LEISURE"]', 'json', 'sales', 'Market segment codes', true),
('guest_titles', '["Mr","Mrs","Ms","Miss","Dr","Prof","Rev"]', 'json', 'guests', 'Guest title options', true)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;

-- ============================================================================
-- AUDIT LOG
-- ============================================================================

INSERT INTO audit_logs (user_id, action, resource_type, details)
VALUES (1000, 'system.seed', 'system', jsonb_build_object('message', 'System seed data loaded', 'timestamp', CURRENT_TIMESTAMP));

DO $$ BEGIN RAISE NOTICE 'System configuration loaded: roles, permissions, admin users, settings'; END $$;
