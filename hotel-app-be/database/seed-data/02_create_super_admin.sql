-- ============================================================================
-- CREATE SUPER ADMIN USER
-- ============================================================================
-- Description: Creates the initial super admin user with all privileges
-- This user cannot be deleted by regular admins
-- ============================================================================

-- Check if super_admin role exists, create if not
INSERT INTO roles (name, display_name, description, is_system_role, priority)
VALUES ('super_admin', 'Super Administrator', 'Super administrator with full system access', true, 1000)
ON CONFLICT (name) DO NOTHING;

-- Ensure admin role exists
INSERT INTO roles (name, display_name, description, is_system_role, priority)
VALUES ('admin', 'Administrator', 'System administrator with management privileges', true, 100)
ON CONFLICT (name) DO NOTHING;

-- Create super admin user
-- Default password: 'SuperAdmin123!' (MUST BE CHANGED ON FIRST LOGIN)
-- Password hash generated using bcrypt with cost 12
INSERT INTO users (
    username,
    email,
    password_hash,
    full_name,
    is_active,
    is_verified,
    is_super_admin,
    created_at
)
VALUES (
    'superadmin',
    'superadmin@hotel.local',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYxN8/LewY5G', -- SuperAdmin123!
    'Super Administrator',
    true,
    true,
    true,
    CURRENT_TIMESTAMP
)
ON CONFLICT (username) DO UPDATE
SET is_super_admin = true,
    is_verified = true;

-- Assign super_admin role to the super admin user
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.username = 'superadmin' AND r.name = 'super_admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Grant all permissions to super_admin role
-- First, ensure all core permissions exist
INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('users:manage', 'users', 'manage', 'Full user management access', true),
    ('roles:manage', 'roles', 'manage', 'Full role management access', true),
    ('permissions:manage', 'permissions', 'manage', 'Full permission management access', true),
    ('rooms:manage', 'rooms', 'manage', 'Full room management access', true),
    ('bookings:manage', 'bookings', 'manage', 'Full booking management access', true),
    ('guests:manage', 'guests', 'manage', 'Full guest management access', true),
    ('analytics:read', 'analytics', 'read', 'Access to analytics and reports', true),
    ('settings:manage', 'settings', 'manage', 'Full system settings management', true),
    ('audit:read', 'audit', 'read', 'Access to audit logs', true)
ON CONFLICT (name) DO NOTHING;

-- Assign all permissions to super_admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Display success message
DO $$
BEGIN
    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'Super Admin User Created Successfully!';
    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'Username: superadmin';
    RAISE NOTICE 'Email: superadmin@hotel.local';
    RAISE NOTICE 'Default Password: SuperAdmin123!';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  IMPORTANT: Change this password immediately after first login!';
    RAISE NOTICE '=================================================================';
END $$;
