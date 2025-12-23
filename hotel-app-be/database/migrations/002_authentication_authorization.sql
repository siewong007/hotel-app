-- ============================================================================
-- MIGRATION 002: AUTHENTICATION & AUTHORIZATION
-- ============================================================================
-- Description: Users, roles, permissions, and RBAC system
-- Created: 2025-01-29
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS users_id_seq START WITH 1000;
CREATE SEQUENCE IF NOT EXISTS roles_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS permissions_id_seq START WITH 1;

-- ============================================================================
-- ENUMS
-- ============================================================================

-- User type enum
CREATE TYPE UserType AS ENUM ('staff', 'guest');

-- ============================================================================
-- ROLES & PERMISSIONS
-- ============================================================================

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
    id BIGINT PRIMARY KEY DEFAULT nextval('roles_id_seq'),
    name VARCHAR(50) UNIQUE NOT NULL CHECK (name = LOWER(name)),
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system_role BOOLEAN DEFAULT false,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_role_name CHECK (name ~ '^[a-z][a-z0-9_]*$')
);

-- Permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id BIGINT PRIMARY KEY DEFAULT nextval('permissions_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL CHECK (name = LOWER(name)),
    resource VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL,
    description TEXT,
    is_system_permission BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_permission_format CHECK (name ~ '^[a-z][a-z0-9_]*:[a-z]+$'),
    CONSTRAINT valid_action CHECK (action IN ('create', 'read', 'update', 'delete', 'manage', 'execute'))
);

-- Role-Permission mapping
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    granted_by BIGINT,
    PRIMARY KEY (role_id, permission_id)
);

-- ============================================================================
-- USERS
-- ============================================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY DEFAULT nextval('users_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL CHECK (username = LOWER(username)),
    email VARCHAR(255) UNIQUE NOT NULL CHECK (email = LOWER(email)),
    password_hash VARCHAR(255),
    full_name VARCHAR(255),
    phone VARCHAR(20),
    avatar_url TEXT,
    user_type UserType DEFAULT 'staff',
    guest_id BIGINT, -- Will reference guests(id) after guest table is created

    -- Status fields
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    is_locked BOOLEAN DEFAULT false,
    is_super_admin BOOLEAN DEFAULT false,

    -- Email verification
    email_verification_token VARCHAR(255),
    email_token_expires_at TIMESTAMP WITH TIME ZONE,

    -- Two-factor authentication
    two_factor_enabled BOOLEAN DEFAULT false,
    two_factor_secret VARCHAR(255),
    two_factor_recovery_codes TEXT[],

    -- Security tracking
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    last_login_ip INET,
    password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by BIGINT REFERENCES users(id),
    deleted_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT valid_username CHECK (username ~ '^[a-z0-9][a-z0-9_-]{2,99}$'),
    CONSTRAINT valid_email CHECK (email ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
);

-- User-Role mapping
CREATE TABLE IF NOT EXISTS user_roles (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    assigned_by BIGINT REFERENCES users(id),
    expires_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (user_id, role_id)
);

-- User-Permission direct assignments (override role permissions)
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    assigned_by BIGINT REFERENCES users(id),
    PRIMARY KEY (user_id, permission_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type);
CREATE INDEX IF NOT EXISTS idx_users_guest_id ON users(guest_id) WHERE guest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW user_complete AS
SELECT
    u.id,
    u.uuid,
    u.username,
    u.email,
    u.full_name,
    u.user_type,
    u.is_active,
    u.is_verified,
    u.is_super_admin,
    u.last_login_at,
    array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL) as roles,
    array_agg(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL) as permissions
FROM users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.id
LEFT JOIN role_permissions rp ON r.id = rp.role_id
LEFT JOIN permissions p ON rp.permission_id = p.id
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.uuid, u.username, u.email, u.full_name, u.user_type, u.is_active, u.is_verified, u.is_super_admin, u.last_login_at;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE users IS 'Core user accounts for system authentication';
COMMENT ON TABLE roles IS 'Role definitions for role-based access control';
COMMENT ON TABLE permissions IS 'Granular permissions for resources';
COMMENT ON COLUMN users.user_type IS 'User type: staff (employees) or guest (hotel guests with accounts)';
COMMENT ON COLUMN users.guest_id IS 'Links to guests table if user_type is guest';
