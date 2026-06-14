-- ============================================================================
-- HOTEL APP SCHEMA
-- ============================================================================
-- Consolidated PostgreSQL schema script. Run before data.sql.
-- Generated from the previous ordered migration set.
-- ============================================================================

\set ON_ERROR_STOP on


-- ============================================================================
-- 001_core_extensions_functions.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 001: CORE EXTENSIONS & FUNCTIONS
-- ============================================================================
-- Description: PostgreSQL extensions and core utility functions
-- ============================================================================

-- Enable PostgreSQL extensions (some may not be available in embedded PostgreSQL)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'uuid-ossp extension not available, UUIDs will use gen_random_uuid() instead';
END
$$;

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pgcrypto extension not available, skipping';
END
$$;

-- ============================================================================
-- CORE UTILITY FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired challenges
CREATE OR REPLACE FUNCTION cleanup_expired_challenges()
RETURNS void AS $$
BEGIN
    DELETE FROM passkey_challenges WHERE expires_at < CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
    UPDATE user_sessions
    SET is_active = false
    WHERE expires_at < CURRENT_TIMESTAMP AND is_active = true;

    DELETE FROM refresh_tokens
    WHERE expires_at < CURRENT_TIMESTAMP AND is_revoked = false;
END;
$$ LANGUAGE plpgsql;

-- Function to increment failed login attempts
CREATE OR REPLACE FUNCTION increment_failed_login(user_email VARCHAR)
RETURNS void AS $$
BEGIN
    UPDATE users
    SET failed_login_attempts = failed_login_attempts + 1,
        is_locked = CASE
            WHEN failed_login_attempts >= 4 THEN true
            ELSE false
        END,
        locked_until = CASE
            WHEN failed_login_attempts >= 4 THEN CURRENT_TIMESTAMP + INTERVAL '30 minutes'
            ELSE NULL
        END
    WHERE email = user_email;
END;
$$ LANGUAGE plpgsql;

-- Function to reset failed login attempts
CREATE OR REPLACE FUNCTION reset_failed_login(user_email VARCHAR)
RETURNS void AS $$
BEGIN
    UPDATE users
    SET failed_login_attempts = 0,
        is_locked = false,
        locked_until = NULL,
        last_login_at = CURRENT_TIMESTAMP
    WHERE email = user_email;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 002_authentication_rbac.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 002: AUTHENTICATION & RBAC
-- ============================================================================
-- Description: Users, roles, permissions, sessions, and auth system
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS users_id_seq START WITH 1000;
CREATE SEQUENCE IF NOT EXISTS roles_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS permissions_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS user_sessions_id_seq START WITH 1;

-- ============================================================================
-- ENUMS
-- ============================================================================

DO $$ BEGIN CREATE TYPE UserType AS ENUM ('staff', 'guest'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================================
-- ROLES & PERMISSIONS
-- ============================================================================

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

CREATE TABLE IF NOT EXISTS permissions (
    id BIGINT PRIMARY KEY DEFAULT nextval('permissions_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL CHECK (name = LOWER(name)),
    resource VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL,
    description TEXT,
    is_system_permission BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_permission_format CHECK (name ~ '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$'),
    CONSTRAINT valid_action CHECK (action IN (
        'create', 'read', 'update', 'delete', 'manage', 'execute', 'void',
        'write', 'verify', 'review', 'assign', 'approve', 'reject', 'escalate',
        'override', 'export', 'download', 'reveal', 'request_resubmission',
        'view_provider_raw', 'manage_reason_codes', 'manage_risk_rules'
    ))
);

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
    guest_id BIGINT,
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    is_locked BOOLEAN DEFAULT false,
    is_super_admin BOOLEAN DEFAULT false,
    email_verification_token VARCHAR(255),
    email_token_expires_at TIMESTAMP WITH TIME ZONE,
    two_factor_enabled BOOLEAN DEFAULT false,
    two_factor_secret VARCHAR(255),
    two_factor_recovery_codes TEXT[],
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    last_login_ip INET,
    password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by BIGINT REFERENCES users(id),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT valid_username CHECK (username ~ '^[a-z0-9][a-z0-9_-]{2,99}$'),
    CONSTRAINT valid_email CHECK (email ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    assigned_by BIGINT REFERENCES users(id),
    expires_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    assigned_by BIGINT REFERENCES users(id),
    PRIMARY KEY (user_id, permission_id)
);

-- ============================================================================
-- SESSION MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    device_info JSONB,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_revoked BOOLEAN DEFAULT false,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_by BIGINT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS passkeys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id BYTEA NOT NULL UNIQUE,
    public_key BYTEA NOT NULL,
    counter BIGINT DEFAULT 0,
    transports TEXT[],
    device_type VARCHAR(50),
    device_name VARCHAR(255),
    aaguid UUID,
    backup_eligible BOOLEAN DEFAULT false,
    backup_state BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS passkey_challenges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    challenge BYTEA NOT NULL,
    challenge_type VARCHAR(20) NOT NULL CHECK (challenge_type IN ('registration', 'authentication')),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGINT PRIMARY KEY DEFAULT nextval('user_sessions_id_seq'),
    session_id UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address INET,
    user_agent TEXT,
    device_info JSONB,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT true
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
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id) WHERE is_revoked = false;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash) WHERE is_revoked = false;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at) WHERE is_revoked = false;
CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkeys(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_passkeys_credential_id ON passkeys(credential_id);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires ON passkey_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_roles_updated_at ON roles;
CREATE TRIGGER update_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW user_complete AS
SELECT
    u.id, u.uuid, u.username, u.email, u.full_name, u.user_type,
    u.is_active, u.is_verified, u.is_super_admin, u.last_login_at,
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
COMMENT ON TABLE refresh_tokens IS 'JWT refresh tokens for session management';
COMMENT ON TABLE passkeys IS 'WebAuthn passkey credentials for passwordless authentication';
COMMENT ON TABLE user_sessions IS 'Active user sessions for tracking';

-- ============================================================================
-- AUDIT LOG PERMISSIONS
-- ============================================================================

-- Insert audit permissions
INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('audit:read', 'audit', 'read', 'View audit logs', true),
    ('audit:export', 'audit', 'execute', 'Export audit logs to CSV/PDF', true)
ON CONFLICT (name) DO NOTHING;

-- Assign audit permissions to admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin'
AND p.name IN ('audit:read', 'audit:export')
ON CONFLICT DO NOTHING;

-- Also assign to manager role (read only)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'manager'
AND p.name = 'audit:read'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SETTINGS & DATA TRANSFER PERMISSIONS
-- ============================================================================

-- Add settings:manage permission for data transfer and settings pages
INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES ('settings:manage', 'settings', 'manage', 'Manage system settings and data transfer (export/import)', true)
ON CONFLICT (name) DO NOTHING;

-- Assign to admin role only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin'
AND p.name = 'settings:manage'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 003_system_settings_audit.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 003: SYSTEM SETTINGS & AUDIT
-- ============================================================================
-- Description: Audit logs, system settings, email templates
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS audit_logs_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS system_settings_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS email_templates_id_seq START WITH 1;

-- ============================================================================
-- AUDIT LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT PRIMARY KEY DEFAULT nextval('audit_logs_id_seq'),
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id BIGINT,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SYSTEM SETTINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_settings (
    id BIGINT PRIMARY KEY DEFAULT nextval('system_settings_id_seq'),
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    value_type VARCHAR(20) DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
    category VARCHAR(50) DEFAULT 'general',
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    is_encrypted BOOLEAN DEFAULT false,
    validation_pattern VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by BIGINT REFERENCES users(id)
);

-- ============================================================================
-- EMAIL TEMPLATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_templates (
    id BIGINT PRIMARY KEY DEFAULT nextval('email_templates_id_seq'),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    variables JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_settings_category ON system_settings(category);
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);
CREATE INDEX IF NOT EXISTS idx_system_settings_public ON system_settings(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_email_templates_code ON email_templates(code);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_system_settings_updated_at ON system_settings;
CREATE TRIGGER update_system_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_email_templates_updated_at ON email_templates;
CREATE TRIGGER update_email_templates_updated_at
    BEFORE UPDATE ON email_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE audit_logs IS 'Comprehensive audit trail for all system actions';
COMMENT ON TABLE system_settings IS 'System-wide configuration settings including tax rates';

-- Insert default service tax rate
INSERT INTO system_settings (key, value, description)
VALUES ('service_tax_rate', '8', 'Service tax percentage applied to room charges (e.g. 8 for 8%)')
ON CONFLICT (key) DO NOTHING;
COMMENT ON TABLE email_templates IS 'Transactional email templates with variable support';

-- ============================================================================
-- NIGHT AUDIT SYSTEM
-- ============================================================================
-- Night audit posting system for daily data reconciliation

-- Create night_audit_runs table to track audit history
CREATE TABLE IF NOT EXISTS night_audit_runs (
    id BIGSERIAL PRIMARY KEY,
    audit_date DATE NOT NULL UNIQUE,  -- The business date being audited
    run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_by BIGINT REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'completed',  -- completed, failed, rolled_back

    -- Statistics captured during the audit
    total_bookings_posted INTEGER DEFAULT 0,
    total_checkins INTEGER DEFAULT 0,
    total_checkouts INTEGER DEFAULT 0,
    total_revenue DECIMAL(12, 2) DEFAULT 0,
    total_rooms_occupied INTEGER DEFAULT 0,
    total_rooms_available INTEGER DEFAULT 0,
    occupancy_rate DECIMAL(5, 2) DEFAULT 0,

    -- Room status snapshot
    rooms_available INTEGER DEFAULT 0,
    rooms_occupied INTEGER DEFAULT 0,
    rooms_reserved INTEGER DEFAULT 0,
    rooms_maintenance INTEGER DEFAULT 0,
    rooms_dirty INTEGER DEFAULT 0,

    -- Breakdown data
    payment_method_breakdown JSONB DEFAULT '{}',
    booking_channel_breakdown JSONB DEFAULT '{}',

    notes TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create night_audit_details table for detailed posting records
CREATE TABLE IF NOT EXISTS night_audit_details (
    id BIGSERIAL PRIMARY KEY,
    audit_run_id BIGINT NOT NULL REFERENCES night_audit_runs(id) ON DELETE CASCADE,
    booking_id BIGINT,
    room_id BIGINT,

    record_type VARCHAR(50) NOT NULL,  -- booking, room_status, revenue, etc.
    action VARCHAR(50) NOT NULL,       -- posted, checked_in, checked_out, etc.

    -- Snapshot of data at time of posting
    data JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for night audit tables
CREATE INDEX IF NOT EXISTS idx_night_audit_runs_audit_date ON night_audit_runs(audit_date DESC);
CREATE INDEX IF NOT EXISTS idx_night_audit_details_audit_run_id ON night_audit_details(audit_run_id);
CREATE INDEX IF NOT EXISTS idx_night_audit_details_booking_id ON night_audit_details(booking_id);

-- Create view for night audit summary
CREATE OR REPLACE VIEW night_audit_summary AS
SELECT
    nar.id,
    nar.audit_date,
    nar.run_at,
    u.username as run_by_username,
    nar.status,
    nar.total_bookings_posted,
    nar.total_checkins,
    nar.total_checkouts,
    nar.total_revenue,
    nar.occupancy_rate,
    nar.rooms_available,
    nar.rooms_occupied,
    nar.rooms_reserved,
    nar.rooms_maintenance,
    nar.rooms_dirty,
    nar.notes,
    nar.created_at
FROM night_audit_runs nar
LEFT JOIN users u ON nar.run_by = u.id
ORDER BY nar.audit_date DESC;

COMMENT ON TABLE night_audit_runs IS 'Tracks each night audit run with statistics';
COMMENT ON TABLE night_audit_details IS 'Detailed records of what was posted in each audit';

-- ============================================================================
-- 004_guest_management.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 004: GUEST MANAGEMENT
-- ============================================================================
-- Description: Guests, documents, preferences, reviews, corporate accounts
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS guests_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_documents_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_preferences_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_notes_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS guest_reviews_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS corporate_accounts_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS corporate_account_contacts_id_seq START WITH 1;

-- ============================================================================
-- ENUMS
-- ============================================================================

DO $$ BEGIN CREATE TYPE IdentificationType AS ENUM ('passport', 'drivers_license', 'national_id', 'other'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE guest_type AS ENUM ('member', 'non_member'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE tourism_type AS ENUM ('local', 'foreign'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================================
-- GUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS guests (
    id BIGINT PRIMARY KEY DEFAULT nextval('guests_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    full_name VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(20),
    title VARCHAR(20),
    alt_phone VARCHAR(20),
    date_of_birth DATE,
    nationality VARCHAR(100),
    ic_number VARCHAR(50),
    address_line_1 VARCHAR(255),
    address_line_2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100),
    id_type IdentificationType,
    id_number VARCHAR(100),
    id_expiry DATE,
    id_country VARCHAR(100),
    language_preference VARCHAR(10) DEFAULT 'en',
    communication_preference VARCHAR(50) DEFAULT 'email',
    marketing_opt_in BOOLEAN DEFAULT false,
    vip_status VARCHAR(20),
    company_name VARCHAR(255),
    job_title VARCHAR(100),
    notes TEXT,
    special_requests TEXT,
    tags TEXT[],
    total_stays INTEGER DEFAULT 0,
    total_spend DECIMAL(12,2) DEFAULT 0,
    average_rating DECIMAL(3,2),
    complimentary_nights_credit INTEGER DEFAULT 0,
    is_blacklisted BOOLEAN DEFAULT false,
    blacklist_reason TEXT,
    guest_type guest_type NOT NULL DEFAULT 'non_member',
    discount_percentage INTEGER NOT NULL DEFAULT 0 CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
    tourism_type tourism_type DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by BIGINT REFERENCES users(id),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT valid_email_format CHECK (email IS NULL OR email ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
);

-- Guest complimentary credits by room type
CREATE TABLE IF NOT EXISTS guest_complimentary_credits (
    id BIGSERIAL PRIMARY KEY,
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    room_type_id BIGINT NOT NULL,
    nights_available INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guest_id, room_type_id)
);

-- Add foreign key for users.guest_id
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_guest;
ALTER TABLE users ADD CONSTRAINT fk_users_guest
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL;

-- ============================================================================
-- USER-GUEST LINKING (for booking on behalf of others)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_guests (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) DEFAULT 'family',
    can_book_for BOOLEAN DEFAULT true,
    can_view_bookings BOOLEAN DEFAULT true,
    can_modify BOOLEAN DEFAULT false,
    notes TEXT,
    linked_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, guest_id)
);

CREATE INDEX IF NOT EXISTS idx_user_guests_user_id ON user_guests(user_id);
CREATE INDEX IF NOT EXISTS idx_user_guests_guest_id ON user_guests(guest_id);

DROP TRIGGER IF EXISTS update_user_guests_updated_at ON user_guests;
CREATE TRIGGER update_user_guests_updated_at
    BEFORE UPDATE ON user_guests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE user_guests IS 'Links users to guests they can book/manage on behalf of';

-- ============================================================================
-- GUEST DOCUMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS guest_documents (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_documents_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    document_number VARCHAR(100),
    file_url TEXT,
    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by BIGINT REFERENCES users(id),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- GUEST PREFERENCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS guest_preferences (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_preferences_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    preference_key VARCHAR(100) NOT NULL,
    preference_value TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guest_id, category, preference_key)
);

-- ============================================================================
-- GUEST NOTES
-- ============================================================================

CREATE TABLE IF NOT EXISTS guest_notes (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_notes_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    note_type VARCHAR(50) DEFAULT 'general',
    content TEXT NOT NULL,
    is_alert BOOLEAN DEFAULT false,
    is_private BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- GUEST REVIEWS
-- ============================================================================

CREATE TABLE IF NOT EXISTS guest_reviews (
    id BIGINT PRIMARY KEY DEFAULT nextval('guest_reviews_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    booking_id BIGINT,
    overall_rating DECIMAL(3,2) NOT NULL CHECK (overall_rating >= 1 AND overall_rating <= 5),
    cleanliness_rating DECIMAL(3,2) CHECK (cleanliness_rating >= 1 AND cleanliness_rating <= 5),
    service_rating DECIMAL(3,2) CHECK (service_rating >= 1 AND service_rating <= 5),
    comfort_rating DECIMAL(3,2) CHECK (comfort_rating >= 1 AND comfort_rating <= 5),
    location_rating DECIMAL(3,2) CHECK (location_rating >= 1 AND location_rating <= 5),
    value_rating DECIMAL(3,2) CHECK (value_rating >= 1 AND value_rating <= 5),
    title VARCHAR(255),
    content TEXT,
    pros TEXT,
    cons TEXT,
    response TEXT,
    response_at TIMESTAMP WITH TIME ZONE,
    response_by BIGINT REFERENCES users(id),
    is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- CORPORATE ACCOUNTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS corporate_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    company_registration VARCHAR(100) UNIQUE,
    tax_id VARCHAR(100),
    industry VARCHAR(100),
    billing_address TEXT,
    billing_email VARCHAR(255),
    billing_phone VARCHAR(20),
    credit_limit DECIMAL(12,2) DEFAULT 0,
    credit_balance DECIMAL(12,2) DEFAULT 0,
    payment_terms VARCHAR(50) DEFAULT 'Net 30',
    discount_percentage DECIMAL(5,2) DEFAULT 0,
    contract_start DATE,
    contract_end DATE,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS corporate_account_contacts (
    id BIGINT PRIMARY KEY DEFAULT nextval('corporate_account_contacts_id_seq'),
    corporate_account_id UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    role VARCHAR(100),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests(phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guests_full_name ON guests(full_name);
CREATE INDEX IF NOT EXISTS idx_guests_uuid ON guests(uuid);
CREATE INDEX IF NOT EXISTS idx_guests_vip ON guests(vip_status) WHERE vip_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guests_company ON guests(company_name) WHERE company_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guests_blacklist ON guests(is_blacklisted) WHERE is_blacklisted = true;
CREATE INDEX IF NOT EXISTS idx_guests_ic_number ON guests(ic_number);
CREATE INDEX IF NOT EXISTS idx_guests_created_at ON guests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guests_guest_type ON guests(guest_type);
CREATE INDEX IF NOT EXISTS idx_guests_member_discount ON guests(guest_type, discount_percentage) WHERE guest_type = 'member';
CREATE INDEX IF NOT EXISTS idx_guests_tourism_type ON guests(tourism_type) WHERE tourism_type IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_full_name_unique ON guests (LOWER(TRIM(full_name))) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guest_credits_guest_id ON guest_complimentary_credits(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_credits_room_type ON guest_complimentary_credits(room_type_id);
CREATE INDEX IF NOT EXISTS idx_guest_documents_guest_id ON guest_documents(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_preferences_guest_id ON guest_preferences(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_notes_guest_id ON guest_notes(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_notes_alert ON guest_notes(guest_id, is_alert) WHERE is_alert = true;
CREATE INDEX IF NOT EXISTS idx_guest_reviews_guest_id ON guest_reviews(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_reviews_rating ON guest_reviews(overall_rating);
CREATE INDEX IF NOT EXISTS idx_guest_reviews_published ON guest_reviews(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_corporate_accounts_name ON corporate_accounts(name);
CREATE INDEX IF NOT EXISTS idx_corporate_accounts_registration ON corporate_accounts(company_registration);
CREATE INDEX IF NOT EXISTS idx_corporate_account_contacts_corp ON corporate_account_contacts(corporate_account_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_guests_updated_at ON guests;
CREATE TRIGGER update_guests_updated_at
    BEFORE UPDATE ON guests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_guest_preferences_updated_at ON guest_preferences;
CREATE TRIGGER update_guest_preferences_updated_at
    BEFORE UPDATE ON guest_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_guest_notes_updated_at ON guest_notes;
CREATE TRIGGER update_guest_notes_updated_at
    BEFORE UPDATE ON guest_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_guest_reviews_updated_at ON guest_reviews;
CREATE TRIGGER update_guest_reviews_updated_at
    BEFORE UPDATE ON guest_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_corporate_accounts_updated_at ON corporate_accounts;
CREATE TRIGGER update_corporate_accounts_updated_at
    BEFORE UPDATE ON corporate_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE guests IS 'Guest profiles with personal information and preferences';
COMMENT ON TABLE guest_complimentary_credits IS 'Room-type specific complimentary night credits for guests';
COMMENT ON TABLE guest_documents IS 'Identity documents and files attached to guests';
COMMENT ON TABLE guest_preferences IS 'Guest preferences organized by category';
COMMENT ON TABLE guest_notes IS 'Staff notes and alerts about guests';
COMMENT ON TABLE guest_reviews IS 'Guest reviews and feedback';
COMMENT ON TABLE corporate_accounts IS 'Corporate accounts for business clients';
COMMENT ON COLUMN guests.ic_number IS 'Identity card or passport number';
COMMENT ON COLUMN guests.nationality IS 'Guest nationality/citizenship';
COMMENT ON COLUMN guests.guest_type IS 'Guest membership type: member (discounted rates) or non_member (standard rates)';
COMMENT ON COLUMN guests.discount_percentage IS 'Discount percentage for members (0-100). Only applicable when guest_type is member.';
COMMENT ON COLUMN guests.tourism_type IS 'Tourism type: local (no tourism tax) or foreign (tourism tax applies). NULL means not specified.';

-- ============================================================================
-- 005_loyalty_program.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 005: LOYALTY PROGRAM
-- ============================================================================
-- Description: Loyalty programs, memberships, rewards, tiers
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS loyalty_programs_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS loyalty_tiers_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS loyalty_memberships_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS points_transactions_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS reward_catalog_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS reward_redemptions_id_seq START WITH 1;

-- ============================================================================
-- LOYALTY PROGRAMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_programs (
    id BIGINT PRIMARY KEY DEFAULT nextval('loyalty_programs_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    points_per_dollar DECIMAL(10,4) DEFAULT 1.0,
    currency VARCHAR(3) DEFAULT 'USD',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- LOYALTY TIERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_tiers (
    id BIGINT PRIMARY KEY DEFAULT nextval('loyalty_tiers_id_seq'),
    program_id BIGINT NOT NULL REFERENCES loyalty_programs(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    min_points INTEGER NOT NULL DEFAULT 0,
    max_points INTEGER,
    benefits JSONB,
    discount_percentage DECIMAL(5,2) DEFAULT 0,
    points_multiplier DECIMAL(4,2) DEFAULT 1.0,
    color VARCHAR(7),
    icon VARCHAR(100),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (program_id, name)
);

-- ============================================================================
-- LOYALTY MEMBERSHIPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_memberships (
    id BIGINT PRIMARY KEY DEFAULT nextval('loyalty_memberships_id_seq'),
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    program_id BIGINT NOT NULL REFERENCES loyalty_programs(id) ON DELETE CASCADE,
    tier_id BIGINT REFERENCES loyalty_tiers(id),
    member_number VARCHAR(50) UNIQUE NOT NULL,
    points_balance INTEGER DEFAULT 0,
    lifetime_points INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guest_id, program_id)
);

-- ============================================================================
-- POINTS TRANSACTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS points_transactions (
    id BIGINT PRIMARY KEY DEFAULT nextval('points_transactions_id_seq'),
    membership_id BIGINT NOT NULL REFERENCES loyalty_memberships(id) ON DELETE CASCADE,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('earn', 'redeem', 'adjust', 'expire', 'transfer')),
    points INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reference_type VARCHAR(50),
    reference_id BIGINT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id)
);

-- ============================================================================
-- REWARD CATALOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS reward_catalog (
    id BIGINT PRIMARY KEY DEFAULT nextval('reward_catalog_id_seq'),
    program_id BIGINT NOT NULL REFERENCES loyalty_programs(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    points_required INTEGER NOT NULL,
    quantity_available INTEGER,
    valid_from TIMESTAMP WITH TIME ZONE,
    valid_to TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    terms_conditions TEXT,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- REWARD REDEMPTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS reward_redemptions (
    id BIGINT PRIMARY KEY DEFAULT nextval('reward_redemptions_id_seq'),
    membership_id BIGINT NOT NULL REFERENCES loyalty_memberships(id) ON DELETE CASCADE,
    reward_id BIGINT NOT NULL REFERENCES reward_catalog(id),
    booking_id BIGINT,
    points_spent INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'used', 'void', 'expired')),
    redemption_code VARCHAR(50) UNIQUE,
    redeemed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    notes TEXT
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_loyalty_tiers_program ON loyalty_tiers(program_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_memberships_guest ON loyalty_memberships(guest_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_memberships_program ON loyalty_memberships(program_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_memberships_member_number ON loyalty_memberships(member_number);
CREATE INDEX IF NOT EXISTS idx_points_transactions_membership ON points_transactions(membership_id);
CREATE INDEX IF NOT EXISTS idx_points_transactions_type ON points_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_points_transactions_created ON points_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_catalog_program ON reward_catalog(program_id);
CREATE INDEX IF NOT EXISTS idx_reward_catalog_category ON reward_catalog(category);
CREATE INDEX IF NOT EXISTS idx_reward_catalog_active ON reward_catalog(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_membership ON reward_redemptions(membership_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_status ON reward_redemptions(status);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_loyalty_programs_updated_at ON loyalty_programs;
CREATE TRIGGER update_loyalty_programs_updated_at
    BEFORE UPDATE ON loyalty_programs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_loyalty_memberships_updated_at ON loyalty_memberships;
CREATE TRIGGER update_loyalty_memberships_updated_at
    BEFORE UPDATE ON loyalty_memberships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reward_catalog_updated_at ON reward_catalog;
CREATE TRIGGER update_reward_catalog_updated_at
    BEFORE UPDATE ON reward_catalog
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE loyalty_programs IS 'Loyalty program definitions';
COMMENT ON TABLE loyalty_tiers IS 'Tier levels within loyalty programs';
COMMENT ON TABLE loyalty_memberships IS 'Guest memberships in loyalty programs';
COMMENT ON TABLE points_transactions IS 'Points earning and redemption history';
COMMENT ON TABLE reward_catalog IS 'Available rewards for redemption';
COMMENT ON TABLE reward_redemptions IS 'Reward redemption records';

-- ============================================================================
-- 006_room_management.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 006: ROOM MANAGEMENT
-- ============================================================================
-- Description: Room types, rooms, amenities, housekeeping, status system
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS room_types_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS amenities_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS rooms_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS room_history_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS housekeeping_tasks_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS maintenance_tickets_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS room_changes_id_seq START WITH 1;

-- ============================================================================
-- ROOM TYPES
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_types (
    id BIGINT PRIMARY KEY DEFAULT nextval('room_types_id_seq'),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    base_price DECIMAL(10,2) NOT NULL,
    weekday_rate DECIMAL(10,2),
    weekend_rate DECIMAL(10,2),
    max_occupancy INTEGER DEFAULT 2,
    bed_type VARCHAR(50),
    bed_count INTEGER DEFAULT 1,
    allows_extra_bed BOOLEAN DEFAULT false,
    max_extra_beds INTEGER DEFAULT 0 CHECK (max_extra_beds >= 0),
    extra_bed_charge DECIMAL(10,2) DEFAULT 0 CHECK (extra_bed_charge >= 0),
    size_sqm DECIMAL(6,2),
    size_sqft DECIMAL(6,2),
    floor_range VARCHAR(20),
    images JSONB,
    features JSONB,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- AMENITIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS amenities (
    id BIGINT PRIMARY KEY DEFAULT nextval('amenities_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL,
    category VARCHAR(50) NOT NULL,
    icon VARCHAR(50),
    description TEXT,
    is_paid BOOLEAN DEFAULT false,
    price DECIMAL(10,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS room_type_amenities (
    room_type_id BIGINT NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
    amenity_id BIGINT NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
    is_complimentary BOOLEAN DEFAULT true,
    PRIMARY KEY (room_type_id, amenity_id)
);

-- ============================================================================
-- ROOMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS rooms (
    id BIGINT PRIMARY KEY DEFAULT nextval('rooms_id_seq'),
    room_number VARCHAR(20) UNIQUE NOT NULL,
    room_type_id BIGINT NOT NULL REFERENCES room_types(id),
    floor INTEGER,
    building VARCHAR(50),
    custom_price DECIMAL(10,2),  -- Optional per-room price override (if NULL, uses room_type base_price)
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'reserved', 'cleaning', 'dirty', 'maintenance', 'out_of_order')),
    status_notes TEXT,
    reserved_start_date TIMESTAMP WITH TIME ZONE,
    reserved_end_date TIMESTAMP WITH TIME ZONE,
    maintenance_start_date TIMESTAMP WITH TIME ZONE,
    maintenance_end_date TIMESTAMP WITH TIME ZONE,
    cleaning_start_date TIMESTAMP WITH TIME ZONE,
    cleaning_end_date TIMESTAMP WITH TIME ZONE,
    current_occupancy INTEGER DEFAULT 0,
    last_cleaned_at TIMESTAMP WITH TIME ZONE,
    last_inspected_at TIMESTAMP WITH TIME ZONE,
    inspected_by BIGINT REFERENCES users(id),
    is_smoking BOOLEAN DEFAULT false,
    is_accessible BOOLEAN DEFAULT false,
    has_view BOOLEAN DEFAULT false,
    view_type VARCHAR(50),
    connecting_room_id BIGINT REFERENCES rooms(id),
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    -- Night audit tracking
    last_posted_status VARCHAR(50),
    last_posted_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROOM HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_history (
    id BIGINT PRIMARY KEY DEFAULT nextval('room_history_id_seq'),
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    notes TEXT,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    changed_by BIGINT REFERENCES users(id),
    is_auto_generated BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROOM STATUS TRANSITIONS (State Machine)
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_status_transitions (
    from_status VARCHAR(20) NOT NULL,
    to_status VARCHAR(20) NOT NULL,
    is_allowed BOOLEAN DEFAULT true,
    requires_permission VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (from_status, to_status)
);

-- Define allowed status transitions
INSERT INTO room_status_transitions (from_status, to_status, is_allowed, requires_permission, notes) VALUES
    ('available', 'reserved', true, NULL, 'Guest reservation created'),
    ('available', 'occupied', true, NULL, 'Guest checked in'),
    ('available', 'cleaning', true, 'housekeeping', 'Scheduled cleaning'),
    ('available', 'dirty', true, 'housekeeping', 'Room marked as dirty'),
    ('available', 'maintenance', true, 'maintenance:write', 'Maintenance required'),
    ('available', 'out_of_order', true, 'rooms:write', 'Room out of service'),
    ('reserved', 'occupied', true, NULL, 'Guest checked in'),
    ('reserved', 'available', true, NULL, 'Reservation voided'),
    ('reserved', 'dirty', true, 'housekeeping', 'Previous guest left early, room dirty'),
    ('occupied', 'dirty', true, NULL, 'Guest checked out, room needs cleaning'),
    ('occupied', 'cleaning', true, 'housekeeping', 'Guest checked out, cleaning started'),
    ('occupied', 'available', true, NULL, 'Express checkout, room already clean'),
    ('occupied', 'maintenance', true, 'maintenance:write', 'Issue found during stay'),
    ('dirty', 'cleaning', true, 'housekeeping', 'Cleaning started'),
    ('dirty', 'available', true, 'housekeeping', 'Quick clean completed'),
    ('dirty', 'maintenance', true, 'maintenance:write', 'Issue found during inspection'),
    ('cleaning', 'available', true, 'housekeeping', 'Cleaning completed'),
    ('cleaning', 'dirty', true, 'housekeeping', 'Cleaning failed inspection'),
    ('cleaning', 'maintenance', true, 'maintenance:write', 'Issue found during cleaning'),
    ('maintenance', 'available', true, 'maintenance:write', 'Maintenance completed'),
    ('maintenance', 'cleaning', true, 'maintenance:write', 'Maintenance done, needs cleaning'),
    ('maintenance', 'dirty', true, 'maintenance:write', 'Maintenance done, room is dirty'),
    ('maintenance', 'out_of_order', true, 'rooms:write', 'Severe issue found'),
    ('out_of_order', 'maintenance', true, 'rooms:write', 'Repairs starting'),
    ('out_of_order', 'available', true, 'rooms:write', 'Room restored to service')
ON CONFLICT (from_status, to_status) DO NOTHING;

-- ============================================================================
-- HOUSEKEEPING TASKS
-- ============================================================================

CREATE TABLE IF NOT EXISTS housekeeping_tasks (
    id BIGINT PRIMARY KEY DEFAULT nextval('housekeeping_tasks_id_seq'),
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    task_type VARCHAR(50) NOT NULL DEFAULT 'cleaning',
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'void')),
    assigned_to BIGINT REFERENCES users(id),
    scheduled_date DATE,
    task_date DATE DEFAULT CURRENT_DATE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    inspection_notes TEXT,
    items_used JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- MAINTENANCE TICKETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS maintenance_tickets (
    id BIGINT PRIMARY KEY DEFAULT nextval('maintenance_tickets_id_seq'),
    room_id BIGINT REFERENCES rooms(id) ON DELETE SET NULL,
    ticket_number VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'on_hold', 'resolved', 'closed')),
    assigned_to BIGINT REFERENCES users(id),
    reported_by BIGINT REFERENCES users(id),
    estimated_cost DECIMAL(10,2),
    actual_cost DECIMAL(10,2),
    estimated_hours DECIMAL(5,2),
    actual_hours DECIMAL(5,2),
    scheduled_date TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    images JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROOM CHANGES (revisit flow - track room changes during guest stays)
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_changes (
    id BIGINT PRIMARY KEY DEFAULT nextval('room_changes_id_seq'),
    booking_id BIGINT NOT NULL,
    from_room_id BIGINT NOT NULL REFERENCES rooms(id),
    to_room_id BIGINT NOT NULL REFERENCES rooms(id),
    guest_id BIGINT REFERENCES guests(id) ON DELETE SET NULL,
    reason TEXT,
    changed_by BIGINT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- Note: Foreign keys to bookings, guests, and users are added in 008_bookings.sql after those tables exist

-- ============================================================================
-- ROOM STATUS CHANGE LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_status_change_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id BIGINT NOT NULL REFERENCES rooms(id),
    from_status VARCHAR(20),
    to_status VARCHAR(20),
    trigger_source VARCHAR(100),
    booking_id BIGINT,
    was_blocked BOOLEAN DEFAULT false,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- FUNCTIONS: Room Status Management
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_room_status_transition(
    p_room_id BIGINT,
    p_new_status VARCHAR(20),
    p_user_id BIGINT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_current_status VARCHAR(20);
    v_is_allowed BOOLEAN;
    v_count INT;
BEGIN
    SELECT status INTO v_current_status FROM rooms WHERE id = p_room_id;
    IF v_current_status IS NULL THEN RAISE EXCEPTION 'Room % not found', p_room_id; END IF;
    IF v_current_status = p_new_status THEN RETURN true; END IF;

    -- Auto-seed transitions if table is empty
    SELECT COUNT(*) INTO v_count FROM room_status_transitions;
    IF v_count = 0 THEN
        INSERT INTO room_status_transitions (from_status, to_status, is_allowed) VALUES
        ('available', 'occupied', true), ('available', 'reserved', true),
        ('available', 'dirty', true), ('available', 'maintenance', true),
        ('available', 'out_of_order', true),
        ('occupied', 'available', true), ('occupied', 'dirty', true),
        ('occupied', 'maintenance', true), ('occupied', 'reserved', true),
        ('reserved', 'occupied', true), ('reserved', 'available', true),
        ('reserved', 'dirty', true), ('reserved', 'maintenance', true),
        ('dirty', 'available', true), ('dirty', 'maintenance', true),
        ('dirty', 'reserved', true), ('dirty', 'occupied', true),
        ('maintenance', 'available', true), ('maintenance', 'dirty', true),
        ('maintenance', 'out_of_order', true),
        ('out_of_order', 'available', true), ('out_of_order', 'maintenance', true),
        ('out_of_order', 'dirty', true)
        ON CONFLICT DO NOTHING;
    END IF;

    SELECT is_allowed INTO v_is_allowed FROM room_status_transitions
    WHERE from_status = v_current_status AND to_status = p_new_status;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transition from % to % is not defined', v_current_status, p_new_status; END IF;
    IF NOT v_is_allowed THEN RAISE EXCEPTION 'Transition from % to % is not allowed', v_current_status, p_new_status; END IF;
    RETURN true;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_room_status(
    p_room_id BIGINT,
    p_new_status VARCHAR(20),
    p_notes TEXT DEFAULT NULL,
    p_user_id BIGINT DEFAULT NULL,
    p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_old_status VARCHAR(20);
BEGIN
    SELECT status INTO v_old_status FROM rooms WHERE id = p_room_id;
    INSERT INTO room_status_change_log (room_id, from_status, to_status, trigger_source, reason)
    VALUES (p_room_id, v_old_status, p_new_status, 'update_room_status', p_notes);
    PERFORM validate_room_status_transition(p_room_id, p_new_status, p_user_id);
    UPDATE rooms SET status = p_new_status, status_notes = COALESCE(p_notes, '') || ' [via update_room_status]',
        updated_at = CURRENT_TIMESTAMP,
        reserved_start_date = CASE WHEN p_new_status = 'reserved' THEN COALESCE(p_start_date, CURRENT_TIMESTAMP) ELSE NULL END,
        reserved_end_date = CASE WHEN p_new_status = 'reserved' THEN p_end_date ELSE NULL END,
        maintenance_start_date = CASE WHEN p_new_status = 'maintenance' THEN COALESCE(p_start_date, CURRENT_TIMESTAMP) ELSE NULL END,
        maintenance_end_date = CASE WHEN p_new_status = 'maintenance' THEN p_end_date ELSE NULL END,
        cleaning_start_date = CASE WHEN p_new_status IN ('cleaning', 'dirty') THEN COALESCE(p_start_date, CURRENT_TIMESTAMP) ELSE NULL END,
        cleaning_end_date = CASE WHEN p_new_status IN ('cleaning', 'dirty') THEN p_end_date ELSE NULL END
    WHERE id = p_room_id;
    INSERT INTO room_history (room_id, from_status, to_status, notes, start_date, end_date, changed_by, is_auto_generated)
    VALUES (p_room_id, v_old_status, p_new_status, p_notes, p_start_date, p_end_date, p_user_id, p_user_id IS NULL);
    IF p_new_status IN ('dirty', 'cleaning') THEN
        INSERT INTO housekeeping_tasks (room_id, task_type, priority, status, created_by, notes)
        VALUES (p_room_id, 'cleaning', 'normal', CASE WHEN p_new_status = 'cleaning' THEN 'in_progress' ELSE 'pending' END, p_user_id, p_notes)
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS: Room Status (Views requiring bookings are in 008_bookings.sql)
-- ============================================================================

CREATE OR REPLACE VIEW room_status_summary AS
SELECT r.status, COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage,
    json_agg(json_build_object('id', r.id, 'room_number', r.room_number, 'floor', r.floor) ORDER BY r.room_number) as rooms
FROM rooms r WHERE r.is_active = true GROUP BY r.status;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(room_type_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms(floor);
CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_rooms_status_active ON rooms(status, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_room_history_room ON room_history(room_id);
CREATE INDEX IF NOT EXISTS idx_room_history_created ON room_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_status_log_room_created ON room_status_change_log(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_housekeeping_room ON housekeeping_tasks(room_id);
CREATE INDEX IF NOT EXISTS idx_housekeeping_status ON housekeeping_tasks(status);
CREATE INDEX IF NOT EXISTS idx_housekeeping_assigned ON housekeeping_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_housekeeping_date ON housekeeping_tasks(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_housekeeping_room_date_status ON housekeeping_tasks(room_id, task_date, status);
CREATE INDEX IF NOT EXISTS idx_maintenance_room ON maintenance_tickets(room_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_tickets(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_priority ON maintenance_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_maintenance_assigned ON maintenance_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_room_type_amenities_type ON room_type_amenities(room_type_id);
CREATE INDEX IF NOT EXISTS idx_room_changes_booking ON room_changes(booking_id);
CREATE INDEX IF NOT EXISTS idx_room_changes_from_room ON room_changes(from_room_id);
CREATE INDEX IF NOT EXISTS idx_room_changes_to_room ON room_changes(to_room_id);
CREATE INDEX IF NOT EXISTS idx_room_changes_guest ON room_changes(guest_id);
CREATE INDEX IF NOT EXISTS idx_room_changes_changed_at ON room_changes(changed_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_room_types_updated_at ON room_types;
CREATE TRIGGER update_room_types_updated_at BEFORE UPDATE ON room_types FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_rooms_updated_at ON rooms;
CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_housekeeping_updated_at ON housekeeping_tasks;
CREATE TRIGGER update_housekeeping_updated_at BEFORE UPDATE ON housekeeping_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_maintenance_updated_at ON maintenance_tickets;
CREATE TRIGGER update_maintenance_updated_at BEFORE UPDATE ON maintenance_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE room_types IS 'Room type definitions with pricing';
COMMENT ON TABLE amenities IS 'Available amenities catalog';
COMMENT ON TABLE rooms IS 'Individual room inventory';
COMMENT ON TABLE room_history IS 'History of room status changes';
COMMENT ON TABLE room_status_transitions IS 'Defines valid room status transitions';
COMMENT ON TABLE housekeeping_tasks IS 'Housekeeping task assignments';
COMMENT ON TABLE maintenance_tickets IS 'Maintenance work orders';
COMMENT ON TABLE room_changes IS 'Tracks room changes during guest stays';
COMMENT ON COLUMN room_changes.booking_id IS 'The booking that had the room change';
COMMENT ON COLUMN room_changes.from_room_id IS 'Original room the guest was in';
COMMENT ON COLUMN room_changes.to_room_id IS 'New room the guest moved to';
COMMENT ON COLUMN room_changes.reason IS 'Reason for the room change';
COMMENT ON COLUMN room_changes.changed_by IS 'Staff member who processed the change';
COMMENT ON COLUMN room_types.allows_extra_bed IS 'Whether this room type allows extra beds';
COMMENT ON COLUMN room_types.max_extra_beds IS 'Maximum number of extra beds allowed';
COMMENT ON COLUMN room_types.extra_bed_charge IS 'Charge per extra bed per night';

-- ============================================================================
-- 007_rate_pricing.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 007: RATE & PRICING MANAGEMENT
-- ============================================================================
-- Description: Rate plans, room rates, and pricing strategies
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS rate_plans_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS room_rates_id_seq START WITH 1;

-- ============================================================================
-- RATE PLANS
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_plans (
    id BIGINT PRIMARY KEY DEFAULT nextval('rate_plans_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    plan_type VARCHAR(50) DEFAULT 'standard' CHECK (plan_type IN ('standard', 'seasonal', 'promotional', 'corporate', 'group', 'package')),
    adjustment_type VARCHAR(20) DEFAULT 'percentage' CHECK (adjustment_type IN ('percentage', 'fixed', 'override')),
    adjustment_value DECIMAL(10,2),
    valid_from DATE,
    valid_to DATE,
    applies_monday BOOLEAN DEFAULT true,
    applies_tuesday BOOLEAN DEFAULT true,
    applies_wednesday BOOLEAN DEFAULT true,
    applies_thursday BOOLEAN DEFAULT true,
    applies_friday BOOLEAN DEFAULT true,
    applies_saturday BOOLEAN DEFAULT true,
    applies_sunday BOOLEAN DEFAULT true,
    min_nights INTEGER DEFAULT 1,
    max_nights INTEGER,
    min_advance_booking INTEGER DEFAULT 0,
    max_advance_booking INTEGER,
    blackout_dates JSONB,
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ROOM RATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_rates (
    id BIGINT PRIMARY KEY DEFAULT nextval('room_rates_id_seq'),
    rate_plan_id BIGINT NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
    room_type_id BIGINT NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
    price DECIMAL(10,2) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rate_plan_id, room_type_id, effective_from)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_rate_plans_dates ON rate_plans(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_rate_plans_active ON rate_plans(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_rate_plans_type ON rate_plans(plan_type);
CREATE INDEX IF NOT EXISTS idx_room_rates_plan ON room_rates(rate_plan_id);
CREATE INDEX IF NOT EXISTS idx_room_rates_type ON room_rates(room_type_id);
CREATE INDEX IF NOT EXISTS idx_room_rates_dates ON room_rates(effective_from, effective_to);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_rate_plans_updated_at ON rate_plans;
CREATE TRIGGER update_rate_plans_updated_at
    BEFORE UPDATE ON rate_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE rate_plans IS 'Rate plan definitions for pricing strategies';
COMMENT ON TABLE room_rates IS 'Specific prices for room types under rate plans';

-- ============================================================================
-- 008_bookings.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 008: BOOKINGS & RESERVATIONS
-- ============================================================================
-- Description: Bookings, booking guests, modifications, tourism tax, pre-check-in
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS bookings_id_seq START WITH 1000;
CREATE SEQUENCE IF NOT EXISTS booking_guests_id_seq START WITH 1;

-- ============================================================================
-- COMPANIES (for direct billing)
-- ============================================================================

CREATE TABLE IF NOT EXISTS companies (
    id BIGSERIAL PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    registration_number VARCHAR(100),
    contact_person VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    billing_address TEXT,
    billing_city VARCHAR(100),
    billing_state VARCHAR(100),
    billing_postal_code VARCHAR(20),
    billing_country VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    credit_limit DECIMAL(12,2),
    payment_terms_days INTEGER DEFAULT 30,
    notes TEXT,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_unique ON companies(LOWER(company_name));
CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(is_active) WHERE is_active = true;

-- ============================================================================
-- BOOKINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS bookings (
    id BIGINT PRIMARY KEY DEFAULT nextval('bookings_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    booking_number VARCHAR(50) UNIQUE NOT NULL,
    folio_number VARCHAR(50),

    -- Guest information
    guest_id BIGINT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    guest_name VARCHAR(255),
    guest_email VARCHAR(255),
    guest_phone VARCHAR(20),
    corporate_account_id UUID REFERENCES corporate_accounts(id),

    -- Room and dates
    room_id BIGINT NOT NULL REFERENCES rooms(id),
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    nights INTEGER GENERATED ALWAYS AS (check_out_date - check_in_date) STORED,

    -- Occupancy
    adults INTEGER NOT NULL DEFAULT 1,
    children INTEGER DEFAULT 0,
    infants INTEGER DEFAULT 0,
    total_guests INTEGER GENERATED ALWAYS AS (adults + children + infants) STORED,

    -- Pricing
    rate_plan_id BIGINT REFERENCES rate_plans(id),
    room_rate DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    discount_percentage DECIMAL(5,2) DEFAULT 0.00,
    total_amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',

    -- Rate overrides
    rate_override_weekday DECIMAL(10,2),
    rate_override_weekend DECIMAL(10,2),
    daily_rates JSONB,

    -- Tourism and extra charges
    is_tourist BOOLEAN DEFAULT false,
    tourism_tax_amount DECIMAL(10,2) DEFAULT 0,
    extra_bed_count INTEGER DEFAULT 0,
    extra_bed_charge DECIMAL(10,2) DEFAULT 0,
    room_card_deposit DECIMAL(10,2) DEFAULT 0,
    late_checkout_penalty DECIMAL(10,2) DEFAULT 0,
    is_complimentary BOOLEAN DEFAULT false,
    complimentary_reason TEXT,
    complimentary_start_date DATE,
    complimentary_end_date DATE,
    original_total_amount DECIMAL(12,2),
    complimentary_nights INTEGER DEFAULT 0,

    -- Deposit tracking
    deposit_paid BOOLEAN DEFAULT false,
    deposit_amount DECIMAL(10,2) DEFAULT 0,
    deposit_paid_at TIMESTAMP WITH TIME ZONE,

    -- Status
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN (
        'pending', 'confirmed', 'checked_in', 'auto_checked_in', 'checked_out',
        'no_show', 'completed', 'comp_void',
        'partial_complimentary', 'fully_complimentary', 'voided'
    )),
    payment_status VARCHAR(30) DEFAULT 'unpaid' CHECK (payment_status IN (
        'unpaid', 'unpaid_deposit', 'paid_rate', 'partial', 'paid', 'refunded', 'void'
    )),
    payment_method VARCHAR(100),
    payment_note TEXT,
    market_code VARCHAR(50),
    company_id BIGINT REFERENCES companies(id),
    company_name VARCHAR(255),

    -- Check-in/out times and tracking
    check_in_time TIME DEFAULT '15:00:00',
    check_out_time TIME DEFAULT '11:00:00',
    actual_check_in TIMESTAMP WITH TIME ZONE,
    actual_check_out TIMESTAMP WITH TIME ZONE,
    early_check_in BOOLEAN DEFAULT false,
    late_check_out BOOLEAN DEFAULT false,

    -- Pre-check-in (guest portal)
    pre_checkin_completed BOOLEAN DEFAULT FALSE,
    pre_checkin_completed_at TIMESTAMP WITH TIME ZONE,
    pre_checkin_token VARCHAR(255),
    pre_checkin_token_expires_at TIMESTAMP WITH TIME ZONE,

    -- Special requests and notes
    special_requests TEXT,
    internal_notes TEXT,
    remarks TEXT,

    -- Booking source and type
    source VARCHAR(50) DEFAULT 'direct',
    post_type VARCHAR(50) DEFAULT 'normal_stay',
    channel VARCHAR(50),
    commission_rate DECIMAL(5,2),

    -- Cancellation
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancelled_by BIGINT REFERENCES users(id),
    cancellation_reason TEXT,
    cancellation_fee DECIMAL(10,2),

    -- Night audit posting
    is_posted BOOLEAN DEFAULT FALSE,
    posted_date DATE,
    posted_at TIMESTAMP WITH TIME ZONE,
    posted_by BIGINT REFERENCES users(id),

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by BIGINT REFERENCES users(id),

    CONSTRAINT valid_dates CHECK (check_out_date >= check_in_date),
    CONSTRAINT valid_occupancy CHECK (adults + children + infants > 0),
    CONSTRAINT valid_complimentary_dates CHECK (
        (complimentary_start_date IS NULL AND complimentary_end_date IS NULL) OR
        (complimentary_start_date IS NOT NULL AND complimentary_end_date IS NOT NULL AND
         complimentary_start_date >= check_in_date AND
         complimentary_end_date <= check_out_date AND
         complimentary_start_date < complimentary_end_date)
    )
);

-- Indexes for bookings
CREATE INDEX IF NOT EXISTS idx_bookings_complimentary_status
    ON bookings(status) WHERE status IN ('partial_complimentary', 'fully_complimentary');

-- Add foreign key for guest_complimentary_credits
ALTER TABLE guest_complimentary_credits DROP CONSTRAINT IF EXISTS fk_guest_credits_room_type;
ALTER TABLE guest_complimentary_credits ADD CONSTRAINT fk_guest_credits_room_type
    FOREIGN KEY (room_type_id) REFERENCES room_types(id) ON DELETE CASCADE;

-- Add foreign key reference from reward_redemptions
ALTER TABLE reward_redemptions DROP CONSTRAINT IF EXISTS fk_reward_redemptions_booking;
ALTER TABLE reward_redemptions ADD CONSTRAINT fk_reward_redemptions_booking
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;

-- Add foreign key reference from guest_reviews
ALTER TABLE guest_reviews DROP CONSTRAINT IF EXISTS fk_guest_reviews_booking;
ALTER TABLE guest_reviews ADD CONSTRAINT fk_guest_reviews_booking
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;

-- Add foreign key references for room_changes table (created in 006_room_management.sql)
ALTER TABLE room_changes DROP CONSTRAINT IF EXISTS fk_room_changes_booking;
ALTER TABLE room_changes ADD CONSTRAINT fk_room_changes_booking
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
ALTER TABLE room_changes DROP CONSTRAINT IF EXISTS fk_room_changes_guest;
ALTER TABLE room_changes ADD CONSTRAINT fk_room_changes_guest
    FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL;
ALTER TABLE room_changes DROP CONSTRAINT IF EXISTS fk_room_changes_user;
ALTER TABLE room_changes ADD CONSTRAINT fk_room_changes_user
    FOREIGN KEY (changed_by) REFERENCES users(id);

-- ============================================================================
-- BOOKING GUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS booking_guests (
    id BIGINT PRIMARY KEY DEFAULT nextval('booking_guests_id_seq'),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    guest_id BIGINT REFERENCES guests(id) ON DELETE SET NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    age_group VARCHAR(20) CHECK (age_group IN ('adult', 'child', 'infant')),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- BOOKING MODIFICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS booking_modifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    modification_type VARCHAR(50) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    reason TEXT,
    price_adjustment DECIMAL(10,2) DEFAULT 0,
    modified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    modified_by BIGINT NOT NULL REFERENCES users(id)
);

-- ============================================================================
-- BOOKING HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS booking_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    previous_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    changed_by BIGINT REFERENCES users(id),
    change_reason TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_booking_total(
    p_room_rate DECIMAL,
    p_nights INTEGER,
    p_tax_rate DECIMAL DEFAULT 0.10,
    p_discount DECIMAL DEFAULT 0
)
RETURNS TABLE(subtotal DECIMAL, tax DECIMAL, total DECIMAL) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (p_room_rate * p_nights) - p_discount as subtotal,
        ((p_room_rate * p_nights) - p_discount) * p_tax_rate as tax,
        ((p_room_rate * p_nights) - p_discount) * (1 + p_tax_rate) as total;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION calculate_booking_total_extended(
    p_room_rate DECIMAL, p_nights INTEGER, p_tax_rate DECIMAL DEFAULT 0.10,
    p_discount DECIMAL DEFAULT 0, p_tourism_tax_per_night DECIMAL DEFAULT 0,
    p_is_tourist BOOLEAN DEFAULT false, p_extra_bed_charge DECIMAL DEFAULT 0,
    p_late_checkout_penalty DECIMAL DEFAULT 0
)
RETURNS TABLE(subtotal DECIMAL, service_tax DECIMAL, tourism_tax DECIMAL, extra_bed_total DECIMAL, penalty_total DECIMAL, total DECIMAL) AS $$
DECLARE
    v_room_subtotal DECIMAL;
    v_service_tax DECIMAL;
    v_tourism_tax DECIMAL;
BEGIN
    v_room_subtotal := (p_room_rate * p_nights) - p_discount;
    v_service_tax := v_room_subtotal * p_tax_rate;
    v_tourism_tax := CASE WHEN p_is_tourist THEN p_tourism_tax_per_night * p_nights ELSE 0 END;
    RETURN QUERY SELECT v_room_subtotal, v_service_tax, v_tourism_tax, p_extra_bed_charge, p_late_checkout_penalty,
        v_room_subtotal + v_service_tax + v_tourism_tax + p_extra_bed_charge + p_late_checkout_penalty;
END;
$$ LANGUAGE plpgsql;

-- Trigger to sync room status with booking
CREATE OR REPLACE FUNCTION sync_room_status_with_booking() RETURNS TRIGGER AS $$
DECLARE
    v_current_room_status VARCHAR(20);
    v_has_other_active_bookings BOOLEAN;
    v_has_upcoming_reservation BOOLEAN;
BEGIN
    -- Skip room status changes for back-dated bookings (check-out already passed)
    IF NEW.check_out_date < CURRENT_DATE AND NEW.status IN ('checked_in', 'checked_out') THEN
        RETURN NEW;
    END IF;

    SELECT status INTO v_current_room_status FROM rooms WHERE id = NEW.room_id;
    SELECT EXISTS (
        SELECT 1 FROM bookings
        WHERE room_id = NEW.room_id AND id != NEW.id
          AND status IN ('confirmed', 'pending', 'checked_in')
          AND check_out_date >= CURRENT_DATE
    ) INTO v_has_other_active_bookings;

    -- checked_in -> occupied
    IF NEW.status = 'checked_in' AND v_current_room_status NOT IN ('occupied') THEN
        PERFORM update_room_status(NEW.room_id, 'occupied',
            'Guest checked in - Booking #' || NEW.id, NULL,
            NEW.check_in_date, NEW.check_out_date);

    -- checked_out -> reserved (if upcoming booking) or dirty
    ELSIF NEW.status = 'checked_out' AND v_current_room_status = 'occupied' THEN
        SELECT EXISTS (
            SELECT 1 FROM bookings
            WHERE room_id = NEW.room_id
              AND id != NEW.id
              AND status IN ('confirmed', 'pending')
              AND check_in_date >= CURRENT_DATE
        ) INTO v_has_upcoming_reservation;

        IF v_has_upcoming_reservation THEN
            PERFORM update_room_status(NEW.room_id, 'reserved',
                'Guest checked out - Upcoming reservation - Booking #' || NEW.id,
                NULL, NULL, NULL);
        ELSE
            PERFORM update_room_status(NEW.room_id, 'dirty',
                'Guest checked out - Needs cleaning - Booking #' || NEW.id,
                NULL, CURRENT_TIMESTAMP, NULL);
        END IF;

    -- same-day booking -> occupied
    ELSIF NEW.status IN ('confirmed', 'pending')
        AND v_current_room_status IN ('available', 'reserved')
        AND NEW.check_in_date::date = CURRENT_DATE THEN
        PERFORM update_room_status(NEW.room_id, 'occupied',
            'Same-day booking - Guest arriving today - Booking #' || NEW.id,
            NULL, NEW.check_in_date, NEW.check_out_date);

    -- future booking -> reserved
    ELSIF NEW.status IN ('confirmed', 'pending')
        AND v_current_room_status = 'available'
        AND NEW.check_in_date::date > CURRENT_DATE THEN
        PERFORM update_room_status(NEW.room_id, 'reserved',
            'Future reservation - Booking #' || NEW.id, NULL,
            NEW.check_in_date, NEW.check_out_date);

    -- no_show/voided -> available (if no other active bookings)
    ELSIF NEW.status IN ('no_show', 'voided')
        AND v_current_room_status IN ('occupied', 'reserved')
        AND NOT v_has_other_active_bookings THEN
        PERFORM update_room_status(NEW.room_id, 'available',
            'Booking no-show/voided - Booking #' || NEW.id, NULL, NULL, NULL);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_room_status_booking ON bookings;
CREATE TRIGGER trg_sync_room_status_booking AFTER INSERT OR UPDATE OF status, check_in_date ON bookings FOR EACH ROW EXECUTE FUNCTION sync_room_status_with_booking();

-- Validate occupancy
CREATE OR REPLACE FUNCTION validate_booking_occupancy() RETURNS TRIGGER AS $$
DECLARE v_max_occupancy INTEGER; v_total_guests INTEGER;
BEGIN
    SELECT rt.max_occupancy INTO v_max_occupancy FROM rooms r JOIN room_types rt ON r.room_type_id = rt.id WHERE r.id = NEW.room_id;
    v_total_guests := COALESCE(NEW.adults, 1) + COALESCE(NEW.children, 0);
    IF v_total_guests > v_max_occupancy THEN
        RAISE EXCEPTION 'Total guests (%) exceeds room maximum occupancy (%)', v_total_guests, v_max_occupancy;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_booking_occupancy ON bookings;
CREATE TRIGGER trigger_validate_booking_occupancy BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION validate_booking_occupancy();

-- ============================================================================
-- VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW booking_summary AS
SELECT b.id, b.uuid, b.booking_number, b.status, b.payment_status,
    g.full_name as guest_name, g.email as guest_email, g.phone as guest_phone,
    r.room_number, rt.name as room_type, b.check_in_date, b.check_out_date, b.nights,
    b.adults, b.children, b.total_amount, b.currency, b.source,
    b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
    b.room_card_deposit, b.late_checkout_penalty, b.payment_method, b.created_at,
    CASE WHEN b.status = 'checked_in' THEN 'In House'
        WHEN b.check_in_date = CURRENT_DATE THEN 'Arriving Today'
        WHEN b.check_out_date = CURRENT_DATE THEN 'Departing Today'
        WHEN b.check_in_date > CURRENT_DATE THEN 'Future' ELSE 'Past' END as booking_category
FROM bookings b
JOIN guests g ON b.guest_id = g.id
JOIN rooms r ON b.room_id = r.id
JOIN room_types rt ON r.room_type_id = rt.id;

CREATE OR REPLACE VIEW daily_arrivals AS
SELECT b.check_in_date as date, COUNT(*) as total_arrivals, SUM(b.adults + b.children) as total_guests,
    array_agg(b.booking_number ORDER BY b.check_in_date) as booking_numbers
FROM bookings b WHERE b.status IN ('confirmed', 'checked_in') AND b.check_in_date >= CURRENT_DATE
GROUP BY b.check_in_date ORDER BY b.check_in_date;

CREATE OR REPLACE VIEW daily_departures AS
SELECT b.check_out_date as date, COUNT(*) as total_departures, SUM(b.adults + b.children) as total_guests,
    array_agg(b.booking_number ORDER BY b.check_out_date) as booking_numbers
FROM bookings b WHERE b.status IN ('confirmed', 'checked_in') AND b.check_out_date >= CURRENT_DATE
GROUP BY b.check_out_date ORDER BY b.check_out_date;

CREATE OR REPLACE VIEW occupancy_stats AS
SELECT date_trunc('day', CURRENT_TIMESTAMP) as date, COUNT(DISTINCT r.id) as total_rooms,
    COUNT(DISTINCT CASE WHEN b.status = 'checked_in' THEN r.id END) as occupied_rooms,
    COUNT(DISTINCT CASE WHEN r.status = 'available' THEN r.id END) as available_rooms,
    ROUND(COUNT(DISTINCT CASE WHEN b.status = 'checked_in' THEN r.id END)::numeric / NULLIF(COUNT(DISTINCT r.id), 0) * 100, 2) as occupancy_percentage
FROM rooms r LEFT JOIN bookings b ON r.id = b.room_id AND b.status = 'checked_in' AND CURRENT_DATE BETWEEN b.check_in_date AND b.check_out_date
WHERE r.is_active = true;

CREATE OR REPLACE VIEW revenue_summary AS
SELECT date_trunc('month', b.check_in_date) as month, COUNT(*) as total_bookings,
    SUM(b.total_amount) as total_revenue, SUM(b.subtotal) as room_revenue, SUM(b.tax_amount) as tax_collected,
    AVG(b.total_amount) as average_booking_value,
    SUM(CASE WHEN b.payment_status = 'paid' THEN b.total_amount ELSE 0 END) as collected_revenue
FROM bookings b WHERE b.status NOT IN ('voided', 'no_show')
GROUP BY date_trunc('month', b.check_in_date) ORDER BY month DESC;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_bookings_guest ON bookings(guest_id);
CREATE INDEX IF NOT EXISTS idx_bookings_room ON bookings(room_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_bookings_check_in ON bookings(check_in_date);
CREATE INDEX IF NOT EXISTS idx_bookings_check_out ON bookings(check_out_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_number ON bookings(booking_number);
CREATE INDEX IF NOT EXISTS idx_bookings_uuid ON bookings(uuid);
CREATE INDEX IF NOT EXISTS idx_bookings_source ON bookings(source);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_corporate ON bookings(corporate_account_id) WHERE corporate_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_pre_checkin_token ON bookings(pre_checkin_token) WHERE pre_checkin_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_market_code ON bookings(market_code) WHERE market_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_room_status_dates ON bookings(room_id, status, check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_bookings_occupancy_lookup ON bookings(room_id, status, check_in_date, check_out_date) WHERE status = 'checked_in';
CREATE INDEX IF NOT EXISTS idx_booking_guests_booking ON booking_guests(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_guests_guest ON booking_guests(guest_id);
CREATE INDEX IF NOT EXISTS idx_booking_mods_booking ON booking_modifications(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_mods_date ON booking_modifications(modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_history_booking ON booking_history(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_history_created_at ON booking_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_company_id ON bookings(company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_is_posted ON bookings(is_posted);
CREATE INDEX IF NOT EXISTS idx_bookings_posted_date ON bookings(posted_date);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE bookings IS 'Guest reservations and bookings';
COMMENT ON TABLE booking_guests IS 'Additional guests in a booking';
COMMENT ON TABLE booking_modifications IS 'History of booking changes';
COMMENT ON TABLE booking_history IS 'Audit trail of booking status changes';
COMMENT ON COLUMN bookings.status IS 'Booking status: pending, confirmed, checked_in, checked_out, voided, no_show, completed, comp_void, partial_complimentary, fully_complimentary';
COMMENT ON COLUMN bookings.is_tourist IS 'Whether the guest is a tourist (affects tourism tax calculation)';
COMMENT ON COLUMN bookings.tourism_tax_amount IS 'Tourism tax charged (per night for tourists)';
COMMENT ON COLUMN bookings.pre_checkin_completed IS 'Guest completed pre-check-in via portal';
COMMENT ON COLUMN bookings.payment_note IS 'Note or remarks about payment status changes';
COMMENT ON COLUMN bookings.company_id IS 'Reference to company for direct billing';
COMMENT ON COLUMN bookings.company_name IS 'Denormalized company name for display';
COMMENT ON TABLE companies IS 'Companies for direct billing and corporate accounts';

-- ============================================================================
-- ROOM OCCUPANCY VIEWS (requires bookings table to exist)
-- ============================================================================

CREATE OR REPLACE VIEW room_current_occupancy AS
SELECT r.id AS room_id, r.room_number, r.room_type_id, rt.name AS room_type_name, rt.max_occupancy, r.status AS room_status,
    COALESCE(b.adults, 0)::INTEGER AS current_adults,
    COALESCE(b.children, 0)::INTEGER AS current_children,
    COALESCE(b.infants, 0)::INTEGER AS current_infants,
    (COALESCE(b.adults, 0) + COALESCE(b.children, 0) + COALESCE(b.infants, 0))::INTEGER AS current_total_guests,
    CASE WHEN rt.max_occupancy > 0 THEN
        ROUND((COALESCE(b.adults, 0) + COALESCE(b.children, 0) + COALESCE(b.infants, 0))::NUMERIC / rt.max_occupancy * 100, 1)
    ELSE NULL END AS occupancy_percentage,
    b.id AS current_booking_id, b.booking_number AS current_booking_number, b.guest_id AS current_guest_id,
    b.check_in_date,
    b.check_out_date,
    CASE WHEN b.id IS NOT NULL THEN TRUE ELSE FALSE END AS is_occupied
FROM rooms r LEFT JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN bookings b ON r.id = b.room_id AND b.status = 'checked_in' AND CURRENT_DATE >= b.check_in_date AND CURRENT_DATE <= b.check_out_date
WHERE r.is_active = TRUE;

CREATE OR REPLACE VIEW hotel_occupancy_summary AS
SELECT COUNT(*)::BIGINT AS total_rooms,
    COUNT(*) FILTER (WHERE is_occupied = TRUE)::BIGINT AS occupied_rooms,
    COUNT(*) FILTER (WHERE is_occupied = FALSE)::BIGINT AS available_rooms,
    ROUND(COUNT(*) FILTER (WHERE is_occupied = TRUE)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS occupancy_rate,
    COALESCE(SUM(current_adults), 0)::BIGINT AS total_adults,
    COALESCE(SUM(current_children), 0)::BIGINT AS total_children,
    COALESCE(SUM(current_infants), 0)::BIGINT AS total_infants,
    COALESCE(SUM(current_total_guests), 0)::BIGINT AS total_guests,
    COALESCE(SUM(max_occupancy), 0)::BIGINT AS total_capacity,
    CASE WHEN SUM(max_occupancy) > 0 THEN
        ROUND(COALESCE(SUM(current_total_guests), 0)::NUMERIC / NULLIF(SUM(max_occupancy), 0) * 100, 1)
    ELSE NULL END AS guest_occupancy_rate
FROM room_current_occupancy;

CREATE OR REPLACE VIEW occupancy_by_room_type AS
SELECT rt.id AS room_type_id, rt.name AS room_type_name, rt.max_occupancy AS capacity_per_room,
    COUNT(r.id)::BIGINT AS total_rooms,
    COUNT(r.id) FILTER (WHERE b.id IS NOT NULL)::BIGINT AS occupied_rooms,
    ROUND(COUNT(r.id) FILTER (WHERE b.id IS NOT NULL)::NUMERIC / NULLIF(COUNT(r.id), 0) * 100, 1) AS room_occupancy_rate,
    COALESCE(SUM(COALESCE(b.adults, 0) + COALESCE(b.children, 0) + COALESCE(b.infants, 0)), 0)::BIGINT AS total_guests,
    (COUNT(r.id) * rt.max_occupancy)::BIGINT AS total_capacity,
    CASE WHEN COUNT(r.id) * rt.max_occupancy > 0 THEN
        ROUND(COALESCE(SUM(COALESCE(b.adults, 0) + COALESCE(b.children, 0) + COALESCE(b.infants, 0)), 0)::NUMERIC
              / NULLIF(COUNT(r.id) * rt.max_occupancy, 0) * 100, 1)
    ELSE NULL END AS guest_occupancy_rate
FROM room_types rt
LEFT JOIN rooms r ON r.room_type_id = rt.id AND r.is_active = TRUE
LEFT JOIN bookings b ON r.id = b.room_id AND b.status = 'checked_in' AND CURRENT_DATE >= b.check_in_date AND CURRENT_DATE <= b.check_out_date
WHERE rt.is_active = TRUE
GROUP BY rt.id, rt.name, rt.max_occupancy;

-- ============================================================================
-- NIGHT AUDIT FUNCTIONS
-- ============================================================================

-- Track which (booking, date) combinations have been posted
CREATE TABLE IF NOT EXISTS night_audit_posted_nights (
    id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    audit_date DATE NOT NULL,
    room_rate DECIMAL(10,2) NOT NULL,       -- nightly rate posted
    room_charge DECIMAL(10,2) NOT NULL,     -- room charge (before tax)
    service_tax DECIMAL(10,2) NOT NULL,     -- tax amount
    tourism_tax DECIMAL(10,2) NOT NULL DEFAULT 0, -- tourism tax amount
    extra_bed_charge DECIMAL(10,2) NOT NULL DEFAULT 0, -- extra bed charge (before tax)
    extra_bed_tax DECIMAL(10,2) NOT NULL DEFAULT 0,    -- extra bed tax amount
    total_posted DECIMAL(10,2) NOT NULL,    -- total for this night
    audit_run_id BIGINT REFERENCES night_audit_runs(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    posted_by BIGINT,
    CONSTRAINT unique_booking_night UNIQUE (booking_id, audit_date)
);

CREATE INDEX IF NOT EXISTS idx_posted_nights_booking ON night_audit_posted_nights(booking_id);
CREATE INDEX IF NOT EXISTS idx_posted_nights_date ON night_audit_posted_nights(audit_date);
CREATE INDEX IF NOT EXISTS idx_posted_nights_audit_run ON night_audit_posted_nights(audit_run_id);

COMMENT ON TABLE night_audit_posted_nights IS 'Tracks per-night posting for each booking.';

-- Function to get unposted bookings for a date
CREATE OR REPLACE FUNCTION get_unposted_bookings(p_audit_date DATE)
RETURNS TABLE (
    booking_id BIGINT,
    booking_number VARCHAR,
    guest_name TEXT,
    room_number VARCHAR,
    check_in_date DATE,
    check_out_date DATE,
    status VARCHAR,
    total_amount DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id as booking_id,
        b.booking_number,
        g.first_name || ' ' || g.last_name as guest_name,
        r.room_number,
        b.check_in_date,
        b.check_out_date,
        b.status,
        b.total_amount
    FROM bookings b
    JOIN guests g ON b.guest_id = g.id
    JOIN rooms r ON b.room_id = r.id
    WHERE b.is_posted = FALSE
    AND (
        (b.check_in_date <= p_audit_date AND b.check_out_date > p_audit_date)
        OR (b.check_out_date = p_audit_date AND b.status = 'checked_out')
        OR (DATE(b.created_at) = p_audit_date OR DATE(b.updated_at) = p_audit_date)
    )
    AND b.status NOT IN ('voided', 'no_show', 'confirmed', 'pending')
    ORDER BY b.check_in_date;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION run_night_audit(
    p_audit_date DATE,
    p_user_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
    v_audit_run_id BIGINT;
    v_bookings_posted INTEGER := 0;
    v_checkins INTEGER := 0;
    v_checkouts INTEGER := 0;
    v_revenue DECIMAL(12, 2) := 0;
    v_rooms_occupied INTEGER := 0;
    v_rooms_available INTEGER := 0;
    v_rooms_reserved INTEGER := 0;
    v_rooms_maintenance INTEGER := 0;
    v_rooms_dirty INTEGER := 0;
    v_total_rooms INTEGER := 0;
    v_occupancy_rate DECIMAL(5, 2) := 0;
    v_booking RECORD;
    v_tax_rate DECIMAL(5, 4) := 0.08;
    v_room_charge DECIMAL(10, 2);
    v_service_tax DECIMAL(10, 2);
    v_tourism_tax_per_night DECIMAL(10, 2);
    v_nights INTEGER;
    v_extra_bed_charge_per_night DECIMAL(10, 2);
    v_extra_bed_tax DECIMAL(10, 2);
    v_night_total DECIMAL(10, 2);
BEGIN
    IF EXISTS (SELECT 1 FROM night_audit_runs WHERE audit_date = p_audit_date AND status = 'completed') THEN
        RAISE EXCEPTION 'Night audit already completed for date %', p_audit_date;
    END IF;

    BEGIN
        SELECT CAST(value AS DECIMAL) / 100.0 INTO v_tax_rate
        FROM system_settings WHERE key = 'service_tax_rate';
    EXCEPTION WHEN OTHERS THEN
        v_tax_rate := 0.08;
    END;

    INSERT INTO night_audit_runs (audit_date, run_by, status)
    VALUES (p_audit_date, p_user_id, 'in_progress')
    RETURNING id INTO v_audit_run_id;

    FOR v_booking IN
        SELECT b.id, b.booking_number, b.status, b.room_rate, b.total_amount,
               b.check_in_date, b.check_out_date, b.guest_id, b.room_id,
               COALESCE(b.is_tourist, false) as is_tourist,
               COALESCE(b.tourism_tax_amount, 0) as tourism_tax_amount,
               COALESCE(b.extra_bed_charge, 0) as extra_bed_charge
        FROM bookings b
        WHERE b.status NOT IN ('pending', 'confirmed', 'voided', 'no_show')
        AND b.check_in_date <= p_audit_date
        AND b.check_out_date > p_audit_date
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = p_audit_date
        )
    LOOP
        v_room_charge := ROUND(v_booking.room_rate / (1 + v_tax_rate), 2);
        v_service_tax := v_booking.room_rate - v_room_charge;
        v_tourism_tax_per_night := 0;
        v_extra_bed_charge_per_night := 0;
        v_extra_bed_tax := 0;

        IF v_booking.extra_bed_charge > 0 THEN
            v_extra_bed_charge_per_night := ROUND(v_booking.extra_bed_charge / (1 + v_tax_rate), 2);
            v_extra_bed_tax := v_booking.extra_bed_charge - v_extra_bed_charge_per_night;
        END IF;

        IF v_booking.is_tourist AND v_booking.tourism_tax_amount > 0 THEN
            v_nights := GREATEST((v_booking.check_out_date - v_booking.check_in_date), 1);
            v_tourism_tax_per_night := ROUND(v_booking.tourism_tax_amount / v_nights, 2);
        END IF;

        v_night_total := v_booking.room_rate + v_booking.extra_bed_charge + v_tourism_tax_per_night;

        INSERT INTO night_audit_posted_nights
            (booking_id, audit_date, room_rate, room_charge, service_tax, tourism_tax,
             extra_bed_charge, extra_bed_tax, total_posted, audit_run_id, posted_by)
        VALUES
            (v_booking.id, p_audit_date, v_booking.room_rate, v_room_charge, v_service_tax,
             v_tourism_tax_per_night, v_extra_bed_charge_per_night, v_extra_bed_tax,
             v_night_total, v_audit_run_id, p_user_id);

        INSERT INTO night_audit_details (audit_run_id, booking_id, record_type, action, data)
        VALUES (v_audit_run_id, v_booking.id, 'booking', 'night_posted',
            jsonb_build_object(
                'status', v_booking.status,
                'room_rate', v_booking.room_rate,
                'night_date', p_audit_date,
                'room_charge', v_room_charge,
                'service_tax', v_service_tax,
                'tourism_tax', v_tourism_tax_per_night,
                'extra_bed_charge', v_extra_bed_charge_per_night,
                'extra_bed_tax', v_extra_bed_tax,
                'check_in_date', v_booking.check_in_date,
                'check_out_date', v_booking.check_out_date
            )
        );

        v_bookings_posted := v_bookings_posted + 1;
        v_revenue := v_revenue + v_night_total;
    END LOOP;

    FOR v_booking IN
        SELECT b.id, b.booking_number, b.status, b.room_rate, b.total_amount,
               b.check_in_date, b.check_out_date, b.guest_id, b.room_id,
               COALESCE(b.is_tourist, false) as is_tourist,
               COALESCE(b.tourism_tax_amount, 0) as tourism_tax_amount,
               COALESCE(b.extra_bed_charge, 0) as extra_bed_charge
        FROM bookings b
        WHERE b.status = 'checked_out'
        AND b.check_in_date = p_audit_date
        AND b.check_out_date = p_audit_date
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = p_audit_date
        )
    LOOP
        v_room_charge := ROUND(v_booking.room_rate / (1 + v_tax_rate), 2);
        v_service_tax := v_booking.room_rate - v_room_charge;
        v_tourism_tax_per_night := 0;
        v_extra_bed_charge_per_night := 0;
        v_extra_bed_tax := 0;

        IF v_booking.extra_bed_charge > 0 THEN
            v_extra_bed_charge_per_night := ROUND(v_booking.extra_bed_charge / (1 + v_tax_rate), 2);
            v_extra_bed_tax := v_booking.extra_bed_charge - v_extra_bed_charge_per_night;
        END IF;

        IF v_booking.is_tourist AND v_booking.tourism_tax_amount > 0 THEN
            v_tourism_tax_per_night := v_booking.tourism_tax_amount;
        END IF;

        v_night_total := v_booking.room_rate + v_booking.extra_bed_charge + v_tourism_tax_per_night;

        INSERT INTO night_audit_posted_nights
            (booking_id, audit_date, room_rate, room_charge, service_tax, tourism_tax,
             extra_bed_charge, extra_bed_tax, total_posted, audit_run_id, posted_by)
        VALUES
            (v_booking.id, p_audit_date, v_booking.room_rate, v_room_charge, v_service_tax,
             v_tourism_tax_per_night, v_extra_bed_charge_per_night, v_extra_bed_tax,
             v_night_total, v_audit_run_id, p_user_id);

        INSERT INTO night_audit_details (audit_run_id, booking_id, record_type, action, data)
        VALUES (v_audit_run_id, v_booking.id, 'booking', 'night_posted',
            jsonb_build_object(
                'status', v_booking.status,
                'room_rate', v_booking.room_rate,
                'night_date', p_audit_date,
                'room_charge', v_room_charge,
                'service_tax', v_service_tax,
                'tourism_tax', v_tourism_tax_per_night,
                'extra_bed_charge', v_extra_bed_charge_per_night,
                'extra_bed_tax', v_extra_bed_tax,
                'check_in_date', v_booking.check_in_date,
                'check_out_date', v_booking.check_out_date
            )
        );

        v_bookings_posted := v_bookings_posted + 1;
        v_revenue := v_revenue + v_night_total;
        v_checkouts := v_checkouts + 1;
    END LOOP;

    SELECT COUNT(*) INTO v_checkins FROM bookings
    WHERE status IN ('checked_in', 'auto_checked_in') AND check_in_date = p_audit_date;

    SELECT COUNT(*) INTO v_checkouts FROM bookings
    WHERE status = 'checked_out'
    AND COALESCE((actual_check_out AT TIME ZONE COALESCE((SELECT value FROM system_settings WHERE key = 'timezone'), 'UTC'))::date, check_out_date) = p_audit_date;

    SELECT COUNT(*) INTO v_total_rooms FROM rooms;

    SELECT
        COUNT(*) FILTER (WHERE status = 'available' OR status = 'clean'),
        COUNT(*) FILTER (WHERE status = 'occupied'),
        COUNT(*) FILTER (WHERE status = 'reserved'),
        COUNT(*) FILTER (WHERE status IN ('maintenance', 'out_of_order')),
        COUNT(*) FILTER (WHERE status = 'dirty' OR status = 'cleaning')
    INTO v_rooms_available, v_rooms_occupied, v_rooms_reserved, v_rooms_maintenance, v_rooms_dirty
    FROM rooms;

    SELECT COUNT(DISTINCT r.id) INTO v_rooms_occupied
    FROM rooms r
    JOIN bookings b ON r.id = b.room_id
    WHERE b.status IN ('checked_in', 'auto_checked_in')
    AND b.check_in_date <= p_audit_date
    AND b.check_out_date > p_audit_date;

    IF v_total_rooms > 0 THEN
        v_occupancy_rate := ROUND((v_rooms_occupied::DECIMAL / v_total_rooms) * 100, 2);
    END IF;

    UPDATE rooms
    SET last_posted_status = status, last_posted_date = p_audit_date;

    UPDATE night_audit_runs
    SET status = 'completed',
        total_bookings_posted = v_bookings_posted,
        total_checkins = v_checkins,
        total_checkouts = v_checkouts,
        total_revenue = v_revenue,
        total_rooms_occupied = v_rooms_occupied,
        total_rooms_available = v_rooms_available,
        occupancy_rate = v_occupancy_rate,
        rooms_available = v_rooms_available,
        rooms_occupied = v_rooms_occupied,
        rooms_reserved = v_rooms_reserved,
        rooms_maintenance = v_rooms_maintenance,
        rooms_dirty = v_rooms_dirty,
        run_at = NOW()
    WHERE id = v_audit_run_id;

    RETURN v_audit_run_id;
END;
$$ LANGUAGE plpgsql;

---- Migration: 022_auto_checkin_function.sql
-- Description: Create a database function to auto-check-in confirmed reservations
--              that have passed their check-in date. This provides the server-side
--              implementation for the 'auto_checked_in' booking status, which is
--              already referenced throughout queries (rooms_queries, bookings,
--              analytics, night_audit) but was only partially implemented in the
--              application-level handler (process_auto_checkin_checkout_handler).
--
-- The 'auto_checked_in' status distinguishes guests who were automatically
-- checked in (e.g., by night audit or a scheduled task) from those who were
-- manually checked in at the front desk. All existing queries already treat
-- 'auto_checked_in' identically to 'checked_in'.
--
-- Usage:
--   SELECT auto_check_in_reservations(CURRENT_DATE);
--   -- Can be called from night audit, a cron job, or the application handler.

CREATE OR REPLACE FUNCTION auto_check_in_reservations(p_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER;
    v_booking RECORD;
BEGIN
    v_count := 0;

    -- Find all confirmed bookings whose check-in date has arrived or passed
    FOR v_booking IN
        SELECT b.id, b.room_id
        FROM bookings b
        WHERE b.status = 'confirmed'
          AND b.check_in_date <= p_date
          AND b.check_out_date > p_date
    LOOP
        -- Update booking status to auto_checked_in
        UPDATE bookings
        SET status = 'auto_checked_in',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_booking.id;

        -- Update the corresponding room to occupied
        UPDATE rooms
        SET status = 'occupied'
        WHERE id = v_booking.room_id;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- ============================================================================
-- 032_ekyc_admin_workflow.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 032: eKYC ADMIN WORKFLOW, AUDIT, AND RBAC
-- ============================================================================
-- Description:
--   Adds the durable eKYC application tables expected by the Rust services,
--   granular reviewer/compliance permissions, immutable decision/access records,
--   masked-by-default review support, reason codes, and common filter indexes.
-- ============================================================================

ALTER TABLE permissions DROP CONSTRAINT IF EXISTS valid_permission_format;
ALTER TABLE permissions ADD CONSTRAINT valid_permission_format
    CHECK (name ~ '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$');

ALTER TABLE permissions DROP CONSTRAINT IF EXISTS valid_action;
ALTER TABLE permissions ADD CONSTRAINT valid_action
    CHECK (action IN (
        'create', 'read', 'update', 'delete', 'manage', 'execute', 'void',
        'write', 'verify', 'review', 'assign', 'approve', 'reject', 'escalate',
        'override', 'export', 'download', 'reveal', 'request_resubmission',
        'view_provider_raw', 'manage_reason_codes', 'manage_risk_rules'
    ));

INSERT INTO roles (name, display_name, description, is_system_role, priority) VALUES
    ('compliance_admin', 'Compliance Administrator', 'Compliance administration and eKYC oversight', true, 90),
    ('ekyc_reviewer', 'eKYC Reviewer', 'Reviews and actions assigned eKYC applications', true, 70),
    ('senior_reviewer', 'Senior Reviewer', 'Second-level eKYC review and high-risk approvals', true, 75),
    ('auditor', 'Auditor', 'Read-only audit and compliance access', true, 65),
    ('support_readonly', 'Read-only Support', 'Read-only operational support access', true, 30)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    is_system_role = EXCLUDED.is_system_role,
    priority = EXCLUDED.priority;

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('ekyc:read', 'ekyc', 'read', 'View masked eKYC applications', true),
    ('ekyc:review', 'ekyc', 'review', 'Review eKYC application details and notes', true),
    ('ekyc:view_sensitive', 'ekyc', 'read', 'View sensitive eKYC data when explicitly returned', true),
    ('ekyc:reveal_sensitive', 'ekyc', 'reveal', 'Reveal masked eKYC identity fields with audit', true),
    ('ekyc:download_documents', 'ekyc', 'download', 'Download private eKYC documents', true),
    ('ekyc:assign', 'ekyc', 'assign', 'Claim, assign, or reassign eKYC cases', true),
    ('ekyc:approve', 'ekyc', 'approve', 'Approve eKYC applications', true),
    ('ekyc:reject', 'ekyc', 'reject', 'Reject eKYC applications', true),
    ('ekyc:escalate', 'ekyc', 'escalate', 'Escalate eKYC applications', true),
    ('ekyc:request_resubmission', 'ekyc', 'request_resubmission', 'Request additional eKYC information', true),
    ('ekyc:override', 'ekyc', 'override', 'Perform controlled eKYC manual overrides', true),
    ('ekyc:export', 'ekyc', 'export', 'Export masked eKYC records', true),
    ('ekyc:manage_reason_codes', 'ekyc', 'manage_reason_codes', 'Manage eKYC reason codes', true),
    ('ekyc:manage_risk_rules', 'ekyc', 'manage_risk_rules', 'Manage eKYC risk rules', true),
    ('ekyc:view_provider_raw', 'ekyc', 'view_provider_raw', 'View raw eKYC provider responses', true),
    ('ekyc:manage', 'ekyc', 'manage', 'Full eKYC administration', true),
    ('ekyc:verify', 'ekyc', 'verify', 'Legacy eKYC approve or reject permission', true)
ON CONFLICT (name) DO UPDATE SET
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    is_system_permission = EXCLUDED.is_system_permission;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.resource = 'ekyc'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'compliance_admin'
  AND p.name IN (
      'ekyc:read', 'ekyc:review', 'ekyc:view_sensitive', 'ekyc:reveal_sensitive',
      'ekyc:download_documents', 'ekyc:assign', 'ekyc:approve', 'ekyc:reject',
      'ekyc:escalate', 'ekyc:request_resubmission', 'ekyc:override',
      'ekyc:export', 'ekyc:manage_reason_codes', 'ekyc:manage_risk_rules',
      'ekyc:view_provider_raw', 'navigation_ekyc_admin:read', 'audit:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'ekyc_reviewer'
  AND p.name IN (
      'ekyc:read', 'ekyc:review', 'ekyc:download_documents', 'ekyc:assign',
      'ekyc:approve', 'ekyc:reject', 'ekyc:escalate',
      'ekyc:request_resubmission', 'navigation_ekyc_admin:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'senior_reviewer'
  AND p.name IN (
      'ekyc:read', 'ekyc:review', 'ekyc:view_sensitive', 'ekyc:download_documents',
      'ekyc:assign', 'ekyc:approve', 'ekyc:reject', 'ekyc:escalate',
      'ekyc:request_resubmission', 'ekyc:override', 'navigation_ekyc_admin:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'auditor'
  AND p.name IN ('ekyc:read', 'ekyc:export', 'navigation_ekyc_admin:read', 'audit:read')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'support_readonly'
  AND p.name IN ('ekyc:read', 'navigation_ekyc_admin:read')
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS ekyc_verifications_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS ekyc_decision_history_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS ekyc_notes_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS ekyc_sensitive_reveals_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS ekyc_access_events_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS ekyc_idempotency_keys_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS self_checkin_events_id_seq START WITH 1;

CREATE TABLE IF NOT EXISTS ekyc_verifications (
    id BIGINT PRIMARY KEY DEFAULT nextval('ekyc_verifications_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id BIGINT REFERENCES guests(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'submitted',
    assigned_reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewer_claimed_at TIMESTAMP WITH TIME ZONE,
    full_name VARCHAR(255),
    date_of_birth DATE,
    nationality VARCHAR(100),
    phone VARCHAR(50),
    email VARCHAR(255),
    current_address TEXT,
    id_type VARCHAR(80),
    id_number VARCHAR(255),
    id_issuing_country VARCHAR(100),
    id_issue_date DATE,
    id_expiry_date DATE,
    id_front_image_path TEXT,
    id_back_image_path TEXT,
    selfie_image_path TEXT,
    proof_of_address_path TEXT,
    provider_name VARCHAR(100),
    provider_verification_result VARCHAR(80),
    provider_raw_response JSONB,
    ocr_data JSONB,
    user_entered_data JSONB,
    document_authenticity_result VARCHAR(80),
    face_match_score DOUBLE PRECISION,
    face_match_passed BOOLEAN DEFAULT false,
    liveness_score DOUBLE PRECISION,
    liveness_passed BOOLEAN DEFAULT false,
    duplicate_check_result VARCHAR(80),
    watchlist_result VARCHAR(80),
    ip_address VARCHAR(64),
    device_fingerprint VARCHAR(255),
    geolocation VARCHAR(255),
    submission_metadata JSONB,
    auto_verified BOOLEAN DEFAULT false,
    auto_verification_details JSONB,
    manual_review_required BOOLEAN DEFAULT true,
    risk_level VARCHAR(30) DEFAULT 'medium',
    risk_score INTEGER DEFAULT 0,
    risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommended_action VARCHAR(100),
    potential_duplicate BOOLEAN DEFAULT false,
    fraud_suspected BOOLEAN DEFAULT false,
    verification_notes TEXT,
    customer_message TEXT,
    decision_reason_code VARCHAR(80),
    decision_reason TEXT,
    verified_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP WITH TIME ZONE,
    self_checkin_enabled BOOLEAN DEFAULT false,
    self_checkin_activated_at TIMESTAMP WITH TIME ZONE,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_ekyc_status CHECK (status IN (
        'draft', 'submitted', 'automated_review', 'pending_manual_review',
        'in_review', 'additional_information_required', 'approved', 'rejected',
        'escalated', 'expired', 'void', 'on_hold',
        'pending', 'under_review', 'verified'
    )),
    CONSTRAINT valid_ekyc_risk_level CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'critical'))
);

ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS guest_id BIGINT REFERENCES guests(id) ON DELETE SET NULL;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS assigned_reviewer_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS reviewer_claimed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS current_address TEXT;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS id_issuing_country VARCHAR(100);
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS id_issue_date DATE;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS id_expiry_date DATE;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS id_front_image_path TEXT;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS id_back_image_path TEXT;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS selfie_image_path TEXT;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS proof_of_address_path TEXT;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS provider_name VARCHAR(100);
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS provider_verification_result VARCHAR(80);
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS provider_raw_response JSONB;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS ocr_data JSONB;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS user_entered_data JSONB;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS document_authenticity_result VARCHAR(80);
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS face_match_score DOUBLE PRECISION;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS face_match_passed BOOLEAN DEFAULT false;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS liveness_score DOUBLE PRECISION;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS liveness_passed BOOLEAN DEFAULT false;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS duplicate_check_result VARCHAR(80);
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS watchlist_result VARCHAR(80);
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64);
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(255);
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS geolocation VARCHAR(255);
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS submission_metadata JSONB;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS auto_verified BOOLEAN DEFAULT false;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS auto_verification_details JSONB;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS manual_review_required BOOLEAN DEFAULT true;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS risk_level VARCHAR(30) DEFAULT 'medium';
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS recommended_action VARCHAR(100);
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS potential_duplicate BOOLEAN DEFAULT false;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS fraud_suspected BOOLEAN DEFAULT false;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS customer_message TEXT;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS decision_reason_code VARCHAR(80);
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS decision_reason TEXT;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS self_checkin_enabled BOOLEAN DEFAULT false;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS self_checkin_activated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE ekyc_verifications ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS ekyc_decision_history (
    id BIGINT PRIMARY KEY DEFAULT nextval('ekyc_decision_history_id_seq'),
    application_id BIGINT NOT NULL REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
    actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    from_status VARCHAR(50),
    to_status VARCHAR(50),
    reason_code VARCHAR(80),
    reason TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ekyc_notes (
    id BIGINT PRIMARY KEY DEFAULT nextval('ekyc_notes_id_seq'),
    application_id BIGINT NOT NULL REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
    note_type VARCHAR(40) NOT NULL DEFAULT 'internal',
    body TEXT NOT NULL,
    customer_visible BOOLEAN NOT NULL DEFAULT false,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ekyc_sensitive_reveals (
    id BIGINT PRIMARY KEY DEFAULT nextval('ekyc_sensitive_reveals_id_seq'),
    application_id BIGINT NOT NULL REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
    actor_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    field_name VARCHAR(80) NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ekyc_access_events (
    id BIGINT PRIMARY KEY DEFAULT nextval('ekyc_access_events_id_seq'),
    application_id BIGINT REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
    actor_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(100) NOT NULL,
    details JSONB,
    ip_address VARCHAR(64),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ekyc_idempotency_keys (
    id BIGINT PRIMARY KEY DEFAULT nextval('ekyc_idempotency_keys_id_seq'),
    application_id BIGINT NOT NULL REFERENCES ekyc_verifications(id) ON DELETE CASCADE,
    actor_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(160) NOT NULL,
    action VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (application_id, actor_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ekyc_reason_codes (
    code VARCHAR(80) PRIMARY KEY,
    label VARCHAR(160) NOT NULL,
    category VARCHAR(80) NOT NULL,
    requires_details BOOLEAN NOT NULL DEFAULT false,
    customer_message_template TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS self_checkin_events (
    id BIGINT PRIMARY KEY DEFAULT nextval('self_checkin_events_id_seq'),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    ekyc_verification_id BIGINT REFERENCES ekyc_verifications(id) ON DELETE SET NULL,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    checked_in_at TIMESTAMP WITH TIME ZONE,
    room_key_issued BOOLEAN DEFAULT false,
    digital_key_sent BOOLEAN DEFAULT false,
    device_type VARCHAR(100),
    checkin_location VARCHAR(255),
    event_type VARCHAR(100),
    event_data TEXT,
    ip_address VARCHAR(64),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO ekyc_reason_codes (code, label, category, requires_details, customer_message_template)
VALUES
    ('document_blurry', 'Blurry document', 'resubmission', false, 'Please upload a clearer image of your identity document.'),
    ('missing_document', 'Missing document', 'resubmission', false, 'Please upload the missing identity document.'),
    ('expired_document', 'Expired document', 'resubmission', false, 'Please upload a valid, unexpired identity document.'),
    ('selfie_mismatch', 'Selfie mismatch', 'resubmission', true, 'Please submit a new selfie that clearly matches your identity document.'),
    ('incomplete_profile', 'Incomplete profile', 'resubmission', false, 'Please complete the missing profile details.'),
    ('unsupported_document', 'Unsupported document', 'rejection', true, NULL),
    ('data_mismatch', 'Data mismatch', 'review', true, 'Please review and correct the submitted identity information.'),
    ('duplicate_identity', 'Potential duplicate identity', 'escalation', true, NULL),
    ('watchlist_match', 'Watchlist, sanctions, or PEP match', 'escalation', true, NULL),
    ('provider_error', 'Verification provider error', 'manual_override', true, NULL),
    ('manual_override', 'Manual override', 'manual_override', true, NULL),
    ('other', 'Other', 'general', true, NULL)
ON CONFLICT (code) DO UPDATE SET
    label = EXCLUDED.label,
    category = EXCLUDED.category,
    requires_details = EXCLUDED.requires_details,
    customer_message_template = EXCLUDED.customer_message_template,
    is_active = true,
    updated_at = CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_ekyc_status ON ekyc_verifications(status);
CREATE INDEX IF NOT EXISTS idx_ekyc_submitted_at ON ekyc_verifications(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ekyc_assigned_reviewer ON ekyc_verifications(assigned_reviewer_id);
CREATE INDEX IF NOT EXISTS idx_ekyc_risk ON ekyc_verifications(risk_level, risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_ekyc_manual_review ON ekyc_verifications(manual_review_required);
CREATE INDEX IF NOT EXISTS idx_ekyc_guest ON ekyc_verifications(guest_id);
CREATE INDEX IF NOT EXISTS idx_ekyc_user ON ekyc_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_ekyc_id_number ON ekyc_verifications(id_number);
CREATE INDEX IF NOT EXISTS idx_ekyc_email ON ekyc_verifications(email);
CREATE INDEX IF NOT EXISTS idx_ekyc_history_application ON ekyc_decision_history(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ekyc_notes_application ON ekyc_notes(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ekyc_access_application ON ekyc_access_events(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ekyc_reveals_application ON ekyc_sensitive_reveals(application_id, created_at DESC);

UPDATE route_access_policies
SET required_permissions = '["ekyc:read"]'::jsonb,
    nav_permissions = '["navigation_ekyc_admin:read","ekyc:read"]'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE route_id = 'ekyc-admin';

COMMENT ON FUNCTION auto_check_in_reservations(DATE) IS
    'Auto-checks-in confirmed reservations whose check-in date is on or before '
    'the given date (and check-out date is still in the future). Updates booking '
    'status to auto_checked_in and room status to occupied. Returns the number '
    'of bookings processed. Intended to be called by night audit or a scheduled task.';


-- ============================================================================
-- DATA FIXES
-- ============================================================================

-- Fix NULL payment methods in bookings
UPDATE bookings
SET payment_method = CASE
    WHEN source IN ('corporate') THEN 'company_billing'
    WHEN source IN ('walk_in') THEN 'cash'
    WHEN source IN ('online', 'website', 'mobile') THEN 'credit_card'
    WHEN source IN ('agent') THEN 'bank_transfer'
    ELSE 'credit_card'
END
WHERE payment_method IS NULL;

COMMENT ON COLUMN bookings.is_posted IS 'Whether this booking has been included in a night audit';
COMMENT ON COLUMN bookings.posted_date IS 'The business date when this booking was posted';
COMMENT ON COLUMN bookings.payment_method IS 'Payment method: cash, credit_card, debit_card, bank_transfer, company_billing, online_payment, ewallet';

-- ============================================================================
-- 009_payments_invoices.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 009: PAYMENTS, INVOICES & SERVICES
-- ============================================================================
-- Description: Payment processing, invoicing, and additional services
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS payments_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS invoices_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS services_id_seq START WITH 1;

-- ============================================================================
-- PAYMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS payments (
    id BIGINT PRIMARY KEY DEFAULT nextval('payments_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    payment_method VARCHAR(50) NOT NULL,
    payment_type VARCHAR(20) DEFAULT 'booking' CHECK (payment_type IN ('booking', 'deposit', 'service', 'damage', 'refund')),
    transaction_id VARCHAR(255),
    card_last_four VARCHAR(4),
    card_brand VARCHAR(20),
    payment_gateway VARCHAR(50) DEFAULT 'stripe',
    gateway_customer_id VARCHAR(255),
    gateway_payment_intent_id VARCHAR(255),
    gateway_charge_id VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded', 'void')),
    failure_reason TEXT,
    refund_amount DECIMAL(12,2),
    refunded_at TIMESTAMP WITH TIME ZONE,
    refund_reason TEXT,
    gateway_refund_id VARCHAR(255),
    metadata JSONB,
    notes TEXT,
    receipt_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    processed_at TIMESTAMP WITH TIME ZONE,
    processed_by BIGINT REFERENCES users(id)
);

-- ============================================================================
-- INVOICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS invoices (
    id BIGINT PRIMARY KEY DEFAULT nextval('invoices_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    bill_to_guest_id BIGINT REFERENCES guests(id) ON DELETE SET NULL,
    bill_to_corporate_id UUID REFERENCES corporate_accounts(id),
    billing_name VARCHAR(255) NOT NULL,
    billing_address TEXT,
    billing_email VARCHAR(255),
    tax_id VARCHAR(100),
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    subtotal DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL,
    paid_amount DECIMAL(12,2) DEFAULT 0,
    balance_due DECIMAL(12,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    currency VARCHAR(3) DEFAULT 'USD',
    line_items JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'void', 'refunded')),
    pdf_url TEXT,
    invoice_type VARCHAR(50) DEFAULT 'booking',
    payment_terms TEXT,
    room_charges DECIMAL(12,2) DEFAULT 0,
    service_charges DECIMAL(12,2) DEFAULT 0,
    additional_charges DECIMAL(12,2) DEFAULT 0,
    notes TEXT,
    terms TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- SERVICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS services (
    id BIGINT PRIMARY KEY DEFAULT nextval('services_id_seq'),
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    unit_price DECIMAL(10,2) NOT NULL,
    unit_type VARCHAR(20) DEFAULT 'item',
    tax_rate DECIMAL(5,2) DEFAULT 0,
    is_taxable BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- BOOKING SERVICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS booking_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    service_id BIGINT NOT NULL REFERENCES services(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    service_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'void')),
    notes TEXT,
    delivered_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_gateway_payment_intent ON payments(gateway_payment_intent_id) WHERE gateway_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_guest ON invoices(bill_to_guest_id);
CREATE INDEX IF NOT EXISTS idx_invoices_corporate ON invoices(bill_to_corporate_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_booking_services_booking ON booking_services(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_services_service ON booking_services(service_id);
CREATE INDEX IF NOT EXISTS idx_booking_services_date ON booking_services(service_date);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_services_updated_at ON services;
CREATE TRIGGER update_services_updated_at BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_invoices_updated_at ON invoices;
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Automatically sync bookings.payment_status when payments are inserted, updated, or deleted.

CREATE OR REPLACE FUNCTION sync_booking_payment_status()
RETURNS TRIGGER AS $$
DECLARE
    v_booking_id INTEGER;
    v_total_paid NUMERIC;
    v_total_amount NUMERIC;
    v_has_refunded BOOLEAN;
    v_new_status TEXT;
BEGIN
    -- Determine the affected booking_id (NEW for INSERT/UPDATE, OLD for DELETE)
    v_booking_id := COALESCE(NEW.booking_id, OLD.booking_id);

    -- Sum all completed payments for this booking
    SELECT COALESCE(SUM(amount), 0)
      INTO v_total_paid
      FROM payments
     WHERE booking_id = v_booking_id
       AND status = 'completed';

    -- Get the booking's total_amount
    SELECT total_amount
      INTO v_total_amount
      FROM bookings
     WHERE id = v_booking_id;

    -- Check if any payment has been refunded and there are no completed payments
    SELECT EXISTS (
        SELECT 1
          FROM payments
         WHERE booking_id = v_booking_id
           AND status = 'refunded'
    ) INTO v_has_refunded;

    -- Determine the new payment status
    IF v_total_paid = 0 AND v_has_refunded THEN
        v_new_status := 'refunded';
    ELSIF v_total_paid >= v_total_amount THEN
        v_new_status := 'paid';
    ELSIF v_total_paid > 0 AND v_total_paid < v_total_amount THEN
        v_new_status := 'partial';
    ELSE
        v_new_status := 'unpaid';
    END IF;

    -- Update the booking's payment status
    UPDATE bookings
       SET payment_status = v_new_status
     WHERE id = v_booking_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_booking_payment_status()
    IS 'Trigger function that recalculates and updates bookings.payment_status based on the sum of completed payments whenever a payment is inserted, updated, or deleted.';

-- Drop the trigger first if it already exists to avoid errors on re-run
DROP TRIGGER IF EXISTS trg_sync_booking_payment_status ON payments;

CREATE TRIGGER trg_sync_booking_payment_status
    AFTER INSERT OR UPDATE OR DELETE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION sync_booking_payment_status();



-- ============================================================================
-- DATA FIXES
-- ============================================================================

-- ============================================================================
-- MIGRATION 029: CANCEL PAYMENTS FOR VOIDED BOOKINGS
-- ============================================================================
-- Description: Mark all payments linked to voided bookings as void
--              so they don't appear in night audit reports.
-- ============================================================================

-- Void all payments linked to voided bookings
UPDATE payments
SET status = 'void'
WHERE booking_id IN (SELECT id FROM bookings WHERE status = 'voided')
  AND status != 'void';


-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE payments IS 'Payment transactions';
COMMENT ON TABLE invoices IS 'Guest invoices and billing';
COMMENT ON TABLE services IS 'Additional service catalog';
COMMENT ON TABLE booking_services IS 'Services ordered by guests';
COMMENT ON COLUMN payments.payment_gateway IS 'Payment gateway used (stripe, paypal, etc.)';
COMMENT ON COLUMN invoices.line_items IS 'Invoice line items as JSON array';

-- ============================================================================
-- 010_customer_ledgers.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 010: CUSTOMER LEDGERS
-- ============================================================================
-- Description: Customer ledgers and account receivable payments
-- ============================================================================

-- ============================================================================
-- CUSTOMER LEDGERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_ledgers (
    id BIGSERIAL PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    company_registration_number VARCHAR(100),
    contact_person VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    billing_address_line1 VARCHAR(255),
    billing_city VARCHAR(100),
    billing_state VARCHAR(100),
    billing_postal_code VARCHAR(20),
    billing_country VARCHAR(100) DEFAULT 'Malaysia',
    description TEXT NOT NULL,
    expense_type VARCHAR(100) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'MYR',
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    paid_amount DECIMAL(10, 2) DEFAULT 0.00,
    balance_due DECIMAL(10, 2) GENERATED ALWAYS AS (amount - paid_amount) STORED,
    payment_method VARCHAR(50),
    payment_reference VARCHAR(255),
    payment_date TIMESTAMP,
    booking_id BIGINT REFERENCES bookings(id) ON DELETE SET NULL,
    guest_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    invoice_number VARCHAR(100) UNIQUE,
    invoice_date DATE,
    due_date DATE,
    notes TEXT,
    internal_notes TEXT,

    -- Ledger accounting fields
    folio_number VARCHAR(50),
    folio_type VARCHAR(50) DEFAULT 'city_ledger',
    transaction_type VARCHAR(20) DEFAULT 'debit',
    post_type VARCHAR(50),
    department_code VARCHAR(20),
    transaction_code VARCHAR(20),
    room_number VARCHAR(20),
    posting_date DATE DEFAULT CURRENT_DATE,
    transaction_date DATE DEFAULT CURRENT_DATE,
    reference_number VARCHAR(100),
    cashier_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    is_reversal BOOLEAN DEFAULT FALSE,
    original_transaction_id BIGINT REFERENCES customer_ledgers(id) ON DELETE SET NULL,
    reversal_reason TEXT,
    tax_amount DECIMAL(10, 2) DEFAULT 0.00,
    service_charge DECIMAL(10, 2) DEFAULT 0.00,
    net_amount DECIMAL(10, 2),
    is_posted BOOLEAN DEFAULT TRUE,
    posted_at TIMESTAMP,
    void_at TIMESTAMP,
    void_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    void_reason TEXT,

    -- Audit fields
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT positive_amount CHECK (amount > 0),
    CONSTRAINT valid_paid_amount CHECK (paid_amount >= 0 AND paid_amount <= amount),
    CONSTRAINT valid_status CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'void')),
    CONSTRAINT valid_folio_type CHECK (folio_type IN ('guest_folio', 'master_folio', 'city_ledger', 'group_folio', 'ar_ledger')),
    CONSTRAINT valid_transaction_type CHECK (transaction_type IN ('debit', 'credit')),
    CONSTRAINT valid_post_type CHECK (post_type IS NULL OR post_type IN (
        'room_charge', 'room_tax', 'service_charge', 'tourism_tax',
        'fnb_restaurant', 'fnb_room_service', 'fnb_minibar', 'fnb_banquet',
        'laundry', 'telephone', 'internet', 'parking', 'spa', 'gym',
        'transportation', 'miscellaneous', 'advance_deposit', 'payment',
        'adjustment', 'rebate', 'discount', 'commission', 'refund',
        'transfer_in', 'transfer_out', 'city_ledger_transfer'
    ))
);

-- ============================================================================
-- CUSTOMER LEDGER PAYMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_ledger_payments (
    id BIGSERIAL PRIMARY KEY,
    ledger_id BIGINT NOT NULL REFERENCES customer_ledgers(id) ON DELETE CASCADE,
    payment_amount DECIMAL(10, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    payment_reference VARCHAR(255),
    payment_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    receipt_number VARCHAR(100),
    receipt_file_url VARCHAR(500),
    notes TEXT,
    processed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT positive_payment CHECK (payment_amount > 0)
);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_customer_ledger_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.invoice_number IS NULL THEN
        NEW.invoice_number := 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(NEW.id::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_folio_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.folio_number IS NULL THEN
        NEW.folio_number := CASE NEW.folio_type
            WHEN 'guest_folio' THEN 'GF-'
            WHEN 'master_folio' THEN 'MF-'
            WHEN 'city_ledger' THEN 'CL-'
            WHEN 'group_folio' THEN 'GP-'
            WHEN 'ar_ledger' THEN 'AR-'
            ELSE 'TX-'
        END || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(NEW.id::TEXT, 6, '0');
    END IF;
    IF NEW.net_amount IS NULL THEN
        NEW.net_amount := NEW.amount - COALESCE(NEW.tax_amount, 0) - COALESCE(NEW.service_charge, 0);
    END IF;
    IF NEW.is_posted = TRUE AND NEW.posted_at IS NULL THEN
        NEW.posted_at := CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_update_customer_ledger_timestamp ON customer_ledgers;
CREATE TRIGGER trigger_update_customer_ledger_timestamp
    BEFORE UPDATE ON customer_ledgers
    FOR EACH ROW EXECUTE FUNCTION update_customer_ledger_timestamp();

DROP TRIGGER IF EXISTS trigger_generate_invoice_number ON customer_ledgers;
CREATE TRIGGER trigger_generate_invoice_number
    BEFORE INSERT ON customer_ledgers
    FOR EACH ROW EXECUTE FUNCTION generate_invoice_number();

DROP TRIGGER IF EXISTS trigger_generate_folio_number ON customer_ledgers;
CREATE TRIGGER trigger_generate_folio_number
    BEFORE INSERT ON customer_ledgers
    FOR EACH ROW EXECUTE FUNCTION generate_folio_number();

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_company ON customer_ledgers(company_name);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_status ON customer_ledgers(status);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_booking ON customer_ledgers(booking_id);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_guest ON customer_ledgers(guest_id);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_due_date ON customer_ledgers(due_date);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_invoice ON customer_ledgers(invoice_number);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_folio_number ON customer_ledgers(folio_number);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_folio_type ON customer_ledgers(folio_type);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_room_number ON customer_ledgers(room_number);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_posting_date ON customer_ledgers(posting_date);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_transaction_code ON customer_ledgers(transaction_code);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_department_code ON customer_ledgers(department_code);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_payments_ledger ON customer_ledger_payments(ledger_id);

-- Enforce one auto-posted company room-charge per booking. This makes the
-- checkout city-ledger posting idempotent at the database level instead of
-- relying on a racy application-side EXISTS check (two concurrent checkouts
-- could otherwise both insert). Reversal rows are excluded so a booking can
-- still hold its original room_charge plus a later REVERSAL sibling.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_ledgers_booking_room_charge
ON customer_ledgers (booking_id)
WHERE post_type = 'room_charge'
  AND COALESCE(is_reversal, false) = false
  AND booking_id IS NOT NULL;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE customer_ledgers IS 'Tracks company expenses and customer ledger accounts';
COMMENT ON TABLE customer_ledger_payments IS 'Tracks payment history for customer ledgers';
COMMENT ON COLUMN customer_ledgers.balance_due IS 'Auto-calculated as amount - paid_amount';
COMMENT ON COLUMN customer_ledgers.folio_number IS 'Ledger folio number (auto-generated based on folio_type)';
COMMENT ON COLUMN customer_ledgers.folio_type IS 'Type: guest_folio, master_folio, city_ledger, group_folio, ar_ledger';

-- ============================================================================
-- 011_night_audit_extra_bed.sql
-- ============================================================================

-- Migration: 011_night_audit_extra_bed.sql
-- Description: Add extra bed charge and tax tracking to night audit postings
--              so that extra bed charges (and their service tax) are included
--              in the nightly audit alongside room charges.

-- Add extra bed columns to posted nights table
ALTER TABLE night_audit_posted_nights
    ADD COLUMN IF NOT EXISTS extra_bed_charge DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS extra_bed_tax DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Replace the night audit function to include extra bed charges
CREATE OR REPLACE FUNCTION run_night_audit(
    p_audit_date DATE,
    p_user_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
    v_audit_run_id BIGINT;
    v_bookings_posted INTEGER := 0;
    v_checkins INTEGER := 0;
    v_checkouts INTEGER := 0;
    v_revenue DECIMAL(12, 2) := 0;
    v_rooms_occupied INTEGER := 0;
    v_rooms_available INTEGER := 0;
    v_rooms_reserved INTEGER := 0;
    v_rooms_maintenance INTEGER := 0;
    v_rooms_dirty INTEGER := 0;
    v_total_rooms INTEGER := 0;
    v_occupancy_rate DECIMAL(5, 2) := 0;
    v_booking RECORD;
    v_tax_rate DECIMAL(5, 4) := 0.08;
    v_room_charge DECIMAL(10, 2);
    v_service_tax DECIMAL(10, 2);
    v_tourism_tax_per_night DECIMAL(10, 2);
    v_nights INTEGER;
    v_extra_bed_charge_per_night DECIMAL(10, 2);
    v_extra_bed_tax DECIMAL(10, 2);
    v_night_total DECIMAL(10, 2);
BEGIN
    IF EXISTS (SELECT 1 FROM night_audit_runs WHERE audit_date = p_audit_date AND status = 'completed') THEN
        RAISE EXCEPTION 'Night audit already completed for date %', p_audit_date;
    END IF;

    BEGIN
        SELECT CAST(value AS DECIMAL) / 100.0 INTO v_tax_rate
        FROM system_settings WHERE key = 'service_tax_rate';
    EXCEPTION WHEN OTHERS THEN
        v_tax_rate := 0.08;
    END;

    INSERT INTO night_audit_runs (audit_date, run_by, status)
    VALUES (p_audit_date, p_user_id, 'in_progress')
    RETURNING id INTO v_audit_run_id;

    -- Main loop: active bookings spanning the audit date
    FOR v_booking IN
        SELECT b.id, b.booking_number, b.status, b.room_rate, b.total_amount,
               b.check_in_date, b.check_out_date, b.guest_id, b.room_id,
               COALESCE(b.is_tourist, false) as is_tourist,
               COALESCE(b.tourism_tax_amount, 0) as tourism_tax_amount,
               COALESCE(b.extra_bed_charge, 0) as extra_bed_charge
        FROM bookings b
        WHERE b.status NOT IN ('pending', 'confirmed', 'voided', 'no_show')
        AND b.check_in_date <= p_audit_date
        AND b.check_out_date > p_audit_date
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = p_audit_date
        )
    LOOP
        v_room_charge := ROUND(v_booking.room_rate / (1 + v_tax_rate), 2);
        v_service_tax := v_booking.room_rate - v_room_charge;
        v_tourism_tax_per_night := 0;

        -- Extra bed charge per night (tax-inclusive), split into charge + tax
        v_extra_bed_charge_per_night := 0;
        v_extra_bed_tax := 0;
        IF v_booking.extra_bed_charge > 0 THEN
            v_extra_bed_charge_per_night := ROUND(v_booking.extra_bed_charge / (1 + v_tax_rate), 2);
            v_extra_bed_tax := v_booking.extra_bed_charge - v_extra_bed_charge_per_night;
        END IF;

        IF v_booking.is_tourist AND v_booking.tourism_tax_amount > 0 THEN
            v_nights := GREATEST((v_booking.check_out_date - v_booking.check_in_date), 1);
            v_tourism_tax_per_night := ROUND(v_booking.tourism_tax_amount / v_nights, 2);
        END IF;

        v_night_total := v_booking.room_rate + v_booking.extra_bed_charge + v_tourism_tax_per_night;

        INSERT INTO night_audit_posted_nights
            (booking_id, audit_date, room_rate, room_charge, service_tax, tourism_tax,
             extra_bed_charge, extra_bed_tax, total_posted, audit_run_id, posted_by)
        VALUES
            (v_booking.id, p_audit_date, v_booking.room_rate, v_room_charge, v_service_tax,
             v_tourism_tax_per_night, v_extra_bed_charge_per_night, v_extra_bed_tax,
             v_night_total, v_audit_run_id, p_user_id);

        INSERT INTO night_audit_details (audit_run_id, booking_id, record_type, action, data)
        VALUES (v_audit_run_id, v_booking.id, 'booking', 'night_posted',
            jsonb_build_object(
                'status', v_booking.status,
                'room_rate', v_booking.room_rate,
                'night_date', p_audit_date,
                'room_charge', v_room_charge,
                'service_tax', v_service_tax,
                'tourism_tax', v_tourism_tax_per_night,
                'extra_bed_charge', v_extra_bed_charge_per_night,
                'extra_bed_tax', v_extra_bed_tax,
                'check_in_date', v_booking.check_in_date,
                'check_out_date', v_booking.check_out_date
            )
        );

        v_bookings_posted := v_bookings_posted + 1;
        v_revenue := v_revenue + v_night_total;
    END LOOP;

    -- Same-day checkout bookings (check_in_date = check_out_date = audit_date)
    FOR v_booking IN
        SELECT b.id, b.booking_number, b.status, b.room_rate, b.total_amount,
               b.check_in_date, b.check_out_date, b.guest_id, b.room_id,
               COALESCE(b.is_tourist, false) as is_tourist,
               COALESCE(b.tourism_tax_amount, 0) as tourism_tax_amount,
               COALESCE(b.extra_bed_charge, 0) as extra_bed_charge
        FROM bookings b
        WHERE b.status = 'checked_out'
        AND b.check_in_date = p_audit_date
        AND b.check_out_date = p_audit_date
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = p_audit_date
        )
    LOOP
        v_room_charge := ROUND(v_booking.room_rate / (1 + v_tax_rate), 2);
        v_service_tax := v_booking.room_rate - v_room_charge;
        v_tourism_tax_per_night := 0;

        v_extra_bed_charge_per_night := 0;
        v_extra_bed_tax := 0;
        IF v_booking.extra_bed_charge > 0 THEN
            v_extra_bed_charge_per_night := ROUND(v_booking.extra_bed_charge / (1 + v_tax_rate), 2);
            v_extra_bed_tax := v_booking.extra_bed_charge - v_extra_bed_charge_per_night;
        END IF;

        IF v_booking.is_tourist AND v_booking.tourism_tax_amount > 0 THEN
            v_tourism_tax_per_night := v_booking.tourism_tax_amount;
        END IF;

        v_night_total := v_booking.room_rate + v_booking.extra_bed_charge + v_tourism_tax_per_night;

        INSERT INTO night_audit_posted_nights
            (booking_id, audit_date, room_rate, room_charge, service_tax, tourism_tax,
             extra_bed_charge, extra_bed_tax, total_posted, audit_run_id, posted_by)
        VALUES
            (v_booking.id, p_audit_date, v_booking.room_rate, v_room_charge, v_service_tax,
             v_tourism_tax_per_night, v_extra_bed_charge_per_night, v_extra_bed_tax,
             v_night_total, v_audit_run_id, p_user_id);

        INSERT INTO night_audit_details (audit_run_id, booking_id, record_type, action, data)
        VALUES (v_audit_run_id, v_booking.id, 'booking', 'night_posted',
            jsonb_build_object(
                'status', v_booking.status,
                'room_rate', v_booking.room_rate,
                'night_date', p_audit_date,
                'room_charge', v_room_charge,
                'service_tax', v_service_tax,
                'tourism_tax', v_tourism_tax_per_night,
                'extra_bed_charge', v_extra_bed_charge_per_night,
                'extra_bed_tax', v_extra_bed_tax,
                'check_in_date', v_booking.check_in_date,
                'check_out_date', v_booking.check_out_date
            )
        );

        v_bookings_posted := v_bookings_posted + 1;
        v_revenue := v_revenue + v_night_total;
        v_checkouts := v_checkouts + 1;
    END LOOP;

    SELECT COUNT(*) INTO v_checkins FROM bookings
    WHERE status IN ('checked_in', 'auto_checked_in') AND check_in_date = p_audit_date;

    SELECT COUNT(*) INTO v_checkouts FROM bookings
    WHERE status = 'checked_out'
    AND COALESCE((actual_check_out AT TIME ZONE COALESCE((SELECT value FROM system_settings WHERE key = 'timezone'), 'UTC'))::date, check_out_date) = p_audit_date;

    SELECT COUNT(*) INTO v_total_rooms FROM rooms;

    SELECT
        COUNT(*) FILTER (WHERE status = 'available' OR status = 'clean'),
        COUNT(*) FILTER (WHERE status = 'occupied'),
        COUNT(*) FILTER (WHERE status = 'reserved'),
        COUNT(*) FILTER (WHERE status IN ('maintenance', 'out_of_order')),
        COUNT(*) FILTER (WHERE status = 'dirty' OR status = 'cleaning')
    INTO v_rooms_available, v_rooms_occupied, v_rooms_reserved, v_rooms_maintenance, v_rooms_dirty
    FROM rooms;

    SELECT COUNT(DISTINCT r.id) INTO v_rooms_occupied
    FROM rooms r
    JOIN bookings b ON r.id = b.room_id
    WHERE b.status IN ('checked_in', 'auto_checked_in')
    AND b.check_in_date <= p_audit_date
    AND b.check_out_date > p_audit_date;

    IF v_total_rooms > 0 THEN
        v_occupancy_rate := ROUND((v_rooms_occupied::DECIMAL / v_total_rooms) * 100, 2);
    END IF;

    UPDATE rooms
    SET last_posted_status = status, last_posted_date = p_audit_date;

    UPDATE night_audit_runs
    SET status = 'completed',
        total_bookings_posted = v_bookings_posted,
        total_checkins = v_checkins,
        total_checkouts = v_checkouts,
        total_revenue = v_revenue,
        total_rooms_occupied = v_rooms_occupied,
        total_rooms_available = v_rooms_available,
        occupancy_rate = v_occupancy_rate,
        rooms_available = v_rooms_available,
        rooms_occupied = v_rooms_occupied,
        rooms_reserved = v_rooms_reserved,
        rooms_maintenance = v_rooms_maintenance,
        rooms_dirty = v_rooms_dirty,
        run_at = NOW()
    WHERE id = v_audit_run_id;

    RETURN v_audit_run_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 012_remove_duplicate_guests.sql
-- ============================================================================

-- One-time script: Remove all duplicate guest records
-- For each group of guests with the same name (case-insensitive), keeps the one
-- with the most complete info (email > phone > lowest id) and reassigns all
-- foreign key references from duplicates to the keeper before deleting them.
--
-- Usage: psql -d your_database -f scripts/remove_duplicate_guests.sql
--
-- Run this BEFORE applying the unique index if it doesn't exist yet.

BEGIN;

-- Show duplicates that will be cleaned up
DO $$
DECLARE
    dup_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT LOWER(TRIM(full_name)) AS norm_name
        FROM guests
        WHERE deleted_at IS NULL
        GROUP BY LOWER(TRIM(full_name))
        HAVING COUNT(*) > 1
    ) sub;
    RAISE NOTICE 'Found % duplicate guest name groups to clean up', dup_count;
END $$;

DO $$
DECLARE
    r RECORD;
    keep_id BIGINT;
    dup_id BIGINT;
    total_removed INTEGER := 0;
BEGIN
    FOR r IN
        SELECT LOWER(TRIM(full_name)) AS norm_name
        FROM guests
        WHERE deleted_at IS NULL
        GROUP BY LOWER(TRIM(full_name))
        HAVING COUNT(*) > 1
    LOOP
        -- Keep the record with the most complete data
        SELECT id INTO keep_id
        FROM guests
        WHERE LOWER(TRIM(full_name)) = r.norm_name
          AND deleted_at IS NULL
        ORDER BY
            (email IS NOT NULL AND email != '') DESC,
            (phone IS NOT NULL AND phone != '') DESC,
            id ASC
        LIMIT 1;

        FOR dup_id IN
            SELECT id FROM guests
            WHERE LOWER(TRIM(full_name)) = r.norm_name
              AND deleted_at IS NULL
              AND id != keep_id
        LOOP
            RAISE NOTICE 'Merging guest id % into % (name: %)', dup_id, keep_id, r.norm_name;

            -- Reassign bookings
            UPDATE bookings SET guest_id = keep_id WHERE guest_id = dup_id;

            -- Reassign booking_guests (avoid unique constraint violation)
            UPDATE booking_guests SET guest_id = keep_id
            WHERE guest_id = dup_id
              AND NOT EXISTS (
                SELECT 1 FROM booking_guests bg2
                WHERE bg2.booking_id = booking_guests.booking_id AND bg2.guest_id = keep_id
              );
            DELETE FROM booking_guests WHERE guest_id = dup_id;

            -- Reassign invoices
            UPDATE invoices SET bill_to_guest_id = keep_id WHERE bill_to_guest_id = dup_id;

            -- Reassign customer_ledgers
            UPDATE customer_ledgers SET guest_id = keep_id WHERE guest_id = dup_id;

            -- Reassign user_guests (avoid unique constraint violation)
            UPDATE user_guests SET guest_id = keep_id
            WHERE guest_id = dup_id
              AND NOT EXISTS (
                SELECT 1 FROM user_guests ug2
                WHERE ug2.user_id = user_guests.user_id AND ug2.guest_id = keep_id
              );
            DELETE FROM user_guests WHERE guest_id = dup_id;

            -- Reassign guest_complimentary_credits (avoid unique constraint violation)
            UPDATE guest_complimentary_credits SET guest_id = keep_id
            WHERE guest_id = dup_id
              AND NOT EXISTS (
                SELECT 1 FROM guest_complimentary_credits gcc2
                WHERE gcc2.guest_id = keep_id AND gcc2.room_type_id = guest_complimentary_credits.room_type_id
              );
            DELETE FROM guest_complimentary_credits WHERE guest_id = dup_id;

            -- Hard delete the duplicate guest
            DELETE FROM guests WHERE id = dup_id;

            total_removed := total_removed + 1;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Removed % duplicate guest records', total_removed;
END $$;

-- Normalize whitespace in full_name
UPDATE guests SET full_name = TRIM(full_name) WHERE full_name != TRIM(full_name) AND deleted_at IS NULL;

-- Ensure the unique index exists to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_full_name_unique
    ON guests (LOWER(TRIM(full_name)))
    WHERE deleted_at IS NULL;

COMMIT;

-- ============================================================================
-- 013_invoice_number_format.sql
-- ============================================================================

-- Migration: switch invoice number format to INV-YYYYMM-XXXX
--
-- The application now generates invoice numbers in Rust (see
-- services::invoice_numbers::next_invoice_number) and writes them on INSERT,
-- so the legacy trigger only fires on rows that arrive without an explicit
-- invoice_number. Keep the trigger consistent with the application format.

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_next_seq INTEGER;
BEGIN
    IF NEW.invoice_number IS NULL THEN
        v_prefix := 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-';

        SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 12) AS INTEGER)), 0)
          INTO v_next_seq
          FROM (
              SELECT invoice_number FROM invoices
               WHERE invoice_number LIKE v_prefix || '%'
              UNION ALL
              SELECT invoice_number FROM customer_ledgers
               WHERE invoice_number LIKE v_prefix || '%'
          ) combined;

        NEW.invoice_number := v_prefix || LPAD((v_next_seq + 1)::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 014_customer_ledger_payment_safety.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 014: CUSTOMER LEDGER PAYMENT SAFETY
-- ============================================================================
-- Enforce unique receipt numbers for customer-ledger payments when provided.
-- Existing blank/null receipt numbers remain allowed.

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_ledger_payments_receipt_unique
ON customer_ledger_payments (LOWER(TRIM(receipt_number)))
WHERE receipt_number IS NOT NULL AND TRIM(receipt_number) <> '';

-- ============================================================================
-- 015_pg18_extensions_uuidv7.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 015: PG 18 EXTENSIONS, uuidv7(), HARDENING
-- ============================================================================
-- Description:
--   * Enables observability + text-search extensions (defensive — bundled
--     desktop PostgreSQL may not have them; each CREATE is wrapped).
--   * Adds gen_uuidv7() helper that prefers PostgreSQL 18's native uuidv7()
--     and falls back to gen_random_uuid() on older clusters. New tables
--     should default UUID columns to gen_uuidv7().
--   * Hardens update_updated_at_column() with a pinned search_path.
--
-- Postgres-only. SQLite migrations are unaffected.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions (defensive — bundled desktop builds may omit them)
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_stat_statements not available — query observability disabled';
END
$$;

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "pg_trgm";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm not available — fuzzy text search GIN indexes will not be created';
END
$$;

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "btree_gin";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'btree_gin not available — mixed-type GIN indexes will not be created';
END
$$;

-- ----------------------------------------------------------------------------
-- gen_uuidv7() — prefers PG 18 native uuidv7(), falls back to v4
-- ----------------------------------------------------------------------------
-- New code should reference gen_uuidv7() so existing rows continue to use
-- whatever default they had, and new inserts pick up the better algorithm
-- whenever uuidv7() exists in the server.
CREATE OR REPLACE FUNCTION gen_uuidv7()
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- PG 18+: prefer native uuidv7()
    RETURN uuidv7();
EXCEPTION
    WHEN undefined_function THEN
        -- Fallback for older servers (older bundled desktop builds, dev VMs)
        RETURN gen_random_uuid();
END;
$$;

-- Normalize legacy "cancelled" status values to "void" and keep generated
-- check constraints aligned for existing PostgreSQL databases.
ALTER TABLE reward_redemptions DROP CONSTRAINT IF EXISTS reward_redemptions_status_check;
UPDATE reward_redemptions SET status = 'void' WHERE status = 'cancelled';
ALTER TABLE reward_redemptions
    ADD CONSTRAINT reward_redemptions_status_check
    CHECK (status IN ('pending', 'confirmed', 'used', 'void', 'expired'));

ALTER TABLE housekeeping_tasks DROP CONSTRAINT IF EXISTS housekeeping_tasks_status_check;
UPDATE housekeeping_tasks SET status = 'void' WHERE status = 'cancelled';
ALTER TABLE housekeeping_tasks
    ADD CONSTRAINT housekeeping_tasks_status_check
    CHECK (status IN ('pending', 'in_progress', 'completed', 'void'));

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
UPDATE bookings SET status = 'voided' WHERE status = 'cancelled';
UPDATE bookings SET status = 'comp_void' WHERE status = 'comp_cancelled';
ALTER TABLE bookings
    ADD CONSTRAINT bookings_status_check
    CHECK (status IN (
        'pending', 'confirmed', 'checked_in', 'auto_checked_in', 'checked_out',
        'no_show', 'completed', 'comp_void',
        'partial_complimentary', 'fully_complimentary', 'voided'
    ));

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
UPDATE bookings SET payment_status = 'void' WHERE payment_status = 'cancelled';
ALTER TABLE bookings
    ADD CONSTRAINT bookings_payment_status_check
    CHECK (payment_status IN (
        'unpaid', 'unpaid_deposit', 'paid_rate', 'partial', 'paid', 'refunded', 'void'
    ));

ALTER TABLE ekyc_verifications DROP CONSTRAINT IF EXISTS valid_ekyc_status;
UPDATE ekyc_verifications SET status = 'void' WHERE status = 'cancelled';
ALTER TABLE ekyc_verifications
    ADD CONSTRAINT valid_ekyc_status
    CHECK (status IN (
        'draft', 'submitted', 'automated_review', 'pending_manual_review',
        'in_review', 'additional_information_required', 'approved', 'rejected',
        'escalated', 'expired', 'void', 'on_hold',
        'pending', 'under_review', 'verified'
    ));

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
UPDATE payments SET status = 'void' WHERE status = 'cancelled';
ALTER TABLE payments
    ADD CONSTRAINT payments_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded', 'void'));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
UPDATE invoices SET status = 'void' WHERE status = 'cancelled';
ALTER TABLE invoices
    ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'void', 'refunded'));

ALTER TABLE booking_services DROP CONSTRAINT IF EXISTS booking_services_status_check;
UPDATE booking_services SET status = 'void' WHERE status = 'cancelled';
ALTER TABLE booking_services
    ADD CONSTRAINT booking_services_status_check
    CHECK (status IN ('pending', 'in_progress', 'completed', 'void'));

ALTER TABLE customer_ledgers DROP CONSTRAINT IF EXISTS valid_status;
UPDATE customer_ledgers SET status = 'void' WHERE status = 'cancelled';
ALTER TABLE customer_ledgers
    ADD CONSTRAINT valid_status
    CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'void'));

COMMENT ON FUNCTION gen_uuidv7() IS
    'Time-ordered UUIDv7 (PostgreSQL 18+) with a v4 fallback for older clusters. '
    'Prefer this for new UUID column defaults so writes land sequentially in btree pages.';

-- ----------------------------------------------------------------------------
-- Harden update_updated_at_column() with a pinned search_path
-- ----------------------------------------------------------------------------
-- The previous definition picked up search_path from the caller, which is a
-- mild function-hijack vector and lints warn about it. Behavior is unchanged.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 016_pg18_indexes.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 016: PG 18 INDEX IMPROVEMENTS
-- ============================================================================
-- Description:
--   * Adds GIN trigram indexes for the columns that the app searches with
--     `ILIKE '%…%'` (guests, companies, bookings, users).
--   * Adds GIN(jsonb_path_ops) index on audit_logs.details so containment
--     and the existing `details::text ILIKE` path can be planned.
--   * Adds BRIN indexes on the append-only time-series tables
--     (audit_logs.created_at, night_audit_posted_nights.audit_date).
--   * Adds a covering btree on bookings for the room/status occupancy
--     lookup, using INCLUDE so range checks come from the index alone.
--   * Drops three indexes that are strict subsets of others — wins write
--     amplification with no read regression because PG 18's improved
--     multicolumn btree skip scan covers the dropped single-column forms.
--
-- All trigram/GIN indexes are guarded by extension existence checks so the
-- migration is safe on bundled desktop builds where pg_trgm is unavailable.
--
-- Postgres-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pg_trgm GIN indexes (guarded — skipped silently if extension is missing)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        CREATE INDEX IF NOT EXISTS idx_guests_full_name_trgm
            ON guests USING gin (full_name gin_trgm_ops)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_guests_email_trgm
            ON guests USING gin (email gin_trgm_ops)
            WHERE deleted_at IS NULL AND email IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_companies_company_name_trgm
            ON companies USING gin (company_name gin_trgm_ops);

        CREATE INDEX IF NOT EXISTS idx_bookings_booking_number_trgm
            ON bookings USING gin (booking_number gin_trgm_ops);

        CREATE INDEX IF NOT EXISTS idx_users_username_trgm
            ON users USING gin (username gin_trgm_ops)
            WHERE deleted_at IS NULL;
    ELSE
        RAISE NOTICE 'pg_trgm not installed — skipping trigram GIN indexes';
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- JSONB GIN — audit_logs.details
-- ----------------------------------------------------------------------------
-- jsonb_path_ops is smaller and faster than the default jsonb_ops for the
-- containment-only queries we run; the existing `details::text ILIKE` path
-- still benefits because the planner can prefilter rows via the GIN index.
CREATE INDEX IF NOT EXISTS idx_audit_logs_details_gin
    ON audit_logs USING gin (details jsonb_path_ops);

-- ----------------------------------------------------------------------------
-- BRIN — append-only time-series
-- ----------------------------------------------------------------------------
-- BRIN keeps a tiny per-block summary that is ideal for monotonically growing
-- timestamps. We keep the existing btree on audit_logs(created_at DESC) as
-- well; the planner picks whichever fits the query. The BRIN tends to win
-- for wide range scans and uses ~1/1000th the storage.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_brin
    ON audit_logs USING brin (created_at);

CREATE INDEX IF NOT EXISTS idx_night_audit_posted_nights_date_brin
    ON night_audit_posted_nights USING brin (audit_date);

-- ----------------------------------------------------------------------------
-- Covering index for the hot booking-occupancy lookup
-- ----------------------------------------------------------------------------
-- create_booking_handler runs:
--   SELECT 1 FROM bookings
--   WHERE room_id = $1
--     AND status IN ('confirmed','pending','checked_in','auto_checked_in')
--     AND tstzrange(...) && tstzrange(...)
-- This INCLUDE-covering index lets the planner answer the existence check
-- without a heap visit, while keeping (room_id, status) as the search key.
CREATE INDEX IF NOT EXISTS idx_bookings_room_status_covering
    ON bookings (room_id, status)
    INCLUDE (check_in_date, check_out_date, total_amount);

-- ----------------------------------------------------------------------------
-- Drop redundant indexes
-- ----------------------------------------------------------------------------
-- idx_bookings_dates (check_in_date, check_out_date) already serves any
-- query that filters on check_in_date alone; PG 18's improved multicolumn
-- btree skip scan further reduces value of the single-column siblings.
DROP INDEX IF EXISTS idx_bookings_check_in;
DROP INDEX IF EXISTS idx_bookings_check_out;

-- idx_bookings_occupancy_lookup is a strict subset of
-- idx_bookings_room_status_dates (same key columns, just a WHERE predicate).
-- The new covering index above does the actual hot work; this partial is
-- redundant now.
DROP INDEX IF EXISTS idx_bookings_occupancy_lookup;

-- ============================================================================
-- 017_pg18_booking_overlap_exclude.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 017: DB-LEVEL BOOKING OVERLAP PREVENTION
-- ============================================================================
-- Description:
--   Adds an EXCLUDE constraint on the bookings table so PostgreSQL itself
--   rejects any two active reservations that overlap on the same room.
--   The application already enforces this via SELECT … FOR UPDATE inside
--   create_booking_handler, but the DB-level guard removes a class of bugs
--   from concurrent writers, manual SQL, imports, and admin tooling.
--
--   The constraint is partial: it applies only to statuses that *occupy* a
--   room. Statuses excluded:
--     - voided, no_show, completed, comp_void — historical/terminal
--     - checked_out — the room has been released
--     - partial_complimentary, fully_complimentary — flagged separately
--
--   PostgreSQL does not support NOT VALID for EXCLUDE constraints, so any
--   pre-existing overlapping rows would cause CREATE to fail. The migration
--   surfaces violators with a clear NOTICE before raising, so the operator
--   can clean them up and rerun.
--
-- Postgres-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- btree_gist — required for EXCLUDE that mixes equality and range
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "btree_gist";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'btree_gist not available — booking overlap EXCLUDE will be skipped';
END
$$;

-- ----------------------------------------------------------------------------
-- Pre-flight: detect existing overlaps and surface them before failing
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_violation_count BIGINT;
    v_sample TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
        RAISE NOTICE 'btree_gist missing — skipping bookings overlap constraint';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_room_date_overlap'
    ) THEN
        RAISE NOTICE 'bookings_no_room_date_overlap already exists — nothing to do';
        RETURN;
    END IF;

    WITH active AS (
        SELECT id, room_id, check_in_date, check_out_date
        FROM bookings
        WHERE status IN ('pending', 'confirmed', 'checked_in', 'auto_checked_in')
          AND check_out_date > check_in_date
    ),
    -- NB: "overlaps" is a reserved SQL keyword and cannot be a CTE name.
    overlap_pairs AS (
        SELECT a.id AS a_id, b.id AS b_id, a.room_id
        FROM active a
        JOIN active b
          ON a.room_id = b.room_id
         AND a.id < b.id
         AND daterange(a.check_in_date, a.check_out_date, '[)')
             && daterange(b.check_in_date, b.check_out_date, '[)')
    )
    SELECT COUNT(*),
           string_agg(format('room %s: bookings %s and %s', room_id, a_id, b_id), '; ')
      INTO v_violation_count, v_sample
      FROM overlap_pairs;

    IF v_violation_count > 0 THEN
        RAISE EXCEPTION
            'Cannot add bookings_no_room_date_overlap: % overlapping active bookings exist. Sample: %',
            v_violation_count, v_sample
            USING HINT = 'Resolve the overlaps (void/move one of each pair), then rerun this migration.';
    END IF;

    EXECUTE $constraint$
        ALTER TABLE bookings
            ADD CONSTRAINT bookings_no_room_date_overlap
            EXCLUDE USING gist (
                room_id WITH =,
                daterange(check_in_date, check_out_date, '[)') WITH &&
            )
            WHERE (status IN ('pending', 'confirmed', 'checked_in', 'auto_checked_in'))
    $constraint$;

    RAISE NOTICE 'Added EXCLUDE constraint bookings_no_room_date_overlap';
END
$$;

-- ============================================================================
-- 018_pg18_uuidv7_defaults.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 018: SWITCH UUID DEFAULTS TO gen_uuidv7()
-- ============================================================================
-- Description:
--   Updates every UUID column that defaults to uuid_generate_v4() so that
--   new inserts use gen_uuidv7() instead. gen_uuidv7() prefers PostgreSQL
--   18's native uuidv7() and falls back to gen_random_uuid() on older
--   clusters (see migration 015).
--
--   Existing rows keep their random v4 UUIDs — only future inserts get the
--   time-ordered v7 IDs. Mixed v4/v7 values in one column is harmless: both
--   are 128-bit and the value type is identical.
--
--   The benefit lands on the high-write tables — booking_history,
--   booking_modifications, refresh_tokens, payments, passkey_challenges —
--   because v7's monotonic prefix keeps btree pages sequential.
--
-- Postgres-only.
-- ============================================================================

-- UUID PRIMARY KEYs
ALTER TABLE refresh_tokens         ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE passkeys               ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE passkey_challenges     ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE corporate_accounts     ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE room_status_change_log ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE booking_modifications  ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE booking_history        ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE booking_services       ALTER COLUMN id SET DEFAULT gen_uuidv7();

-- Side UUID columns (BIGINT PK + UUID UNIQUE) — same benefit on the unique
-- btree, and these columns are heavily filtered by the API surface.
ALTER TABLE users         ALTER COLUMN uuid       SET DEFAULT gen_uuidv7();
ALTER TABLE guests        ALTER COLUMN uuid       SET DEFAULT gen_uuidv7();
ALTER TABLE bookings      ALTER COLUMN uuid       SET DEFAULT gen_uuidv7();
ALTER TABLE user_sessions ALTER COLUMN session_id SET DEFAULT gen_uuidv7();
ALTER TABLE payments      ALTER COLUMN uuid       SET DEFAULT gen_uuidv7();
ALTER TABLE invoices      ALTER COLUMN uuid       SET DEFAULT gen_uuidv7();

-- ============================================================================
-- 019_pg18_virtual_generated_columns.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 019: VIRTUAL GENERATED COLUMNS
-- ============================================================================
-- Description:
--   Adds a virtual (read-time, no storage) generated column to bookings that
--   exposes the *billable* tourism tax in one place instead of forcing every
--   report to write `CASE WHEN is_tourist THEN tourism_tax_amount ELSE 0 END`.
--
--   PostgreSQL 18 added VIRTUAL generated columns; this is exactly the case
--   they target: a deterministic expression over other columns where the
--   value isn't searched often enough to justify storing it. Reports compute
--   it on read; writes pay zero overhead.
--
--   Existing rows are unaffected — virtual columns aren't materialized.
--   Application code can opt in by SELECTing bookings.tourism_billable_amount
--   instead of duplicating the CASE expression.
--
-- Postgres-only (SQLite uses STORED generated columns and lacks VIRTUAL).
-- ============================================================================

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS tourism_billable_amount DECIMAL(10, 2)
    GENERATED ALWAYS AS (
        CASE WHEN is_tourist THEN COALESCE(tourism_tax_amount, 0) ELSE 0 END
    ) VIRTUAL;

COMMENT ON COLUMN bookings.tourism_billable_amount IS
    'Virtual generated column (PG 18): tourism_tax_amount when is_tourist, else 0. '
    'Computed on read; no storage overhead. Replaces repeated CASE expressions '
    'in reporting queries.';

-- ============================================================================
-- 020_pg18_audit_logs_partitioning.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 020: PARTITION audit_logs BY MONTH (PG 18)
-- ============================================================================
-- Description:
--   Converts the append-only `audit_logs` table into a RANGE-partitioned table
--   (one partition per calendar month on `created_at`). This was the deferred
--   "partition audit_logs once row count crosses ~10M" follow-up from
--   PG18_UPGRADE_NOTES.md. Doing it now — while the table is small — makes the
--   rewrite cheap; doing it after it grows large is the painful path.
--
--   Why partition:
--     * Old months can be detached/dropped in O(1) instead of a huge DELETE.
--     * The planner prunes to the relevant month(s) for time-bounded queries
--       (the audit UI and CSV export both filter on a date range).
--     * Per-partition BRIN/GIN/btree indexes stay small.
--
--   Design choices:
--     * `id` switches to `GENERATED ALWAYS AS IDENTITY` (PG 18-era style; this
--       is the go-forward standard for new tables — see follow-up #3 in
--       PG18_UPGRADE_NOTES.md). The old `audit_logs_id_seq` is dropped.
--     * The partition key must be part of every unique constraint, so the PK
--       becomes `(id, created_at)`. `id` alone is still globally unique because
--       the identity sequence never repeats; the composite PK is purely a
--       partitioning requirement. No FK references audit_logs.id, so this is
--       transparent to the rest of the schema.
--     * A DEFAULT partition catches any row outside the pre-created monthly
--       window (including historical rows), so an INSERT is never rejected.
--     * `ensure_audit_logs_partition(date)` lets a maintenance job (or the next
--       deploy) pre-create future months. New months MUST be created before
--       rows for them arrive — you cannot attach a monthly partition once the
--       DEFAULT partition already holds rows in that range.
--
--   This is an atomic rewrite (rename → recreate → copy → drop) wrapped in the
--   migration transaction: it either fully succeeds or fully rolls back. On a
--   large `audit_logs` it takes an ACCESS EXCLUSIVE lock for the duration of
--   the copy — run it during a maintenance window if the table is already big.
--
-- Postgres-only. SQLite has no partitioning and the column shape is unchanged,
-- so there is no SQLite counterpart migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. If needed, set the old table aside and create the partitioned parent.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    audit_logs_kind text;
BEGIN
    SELECT c.relkind::text
    INTO audit_logs_kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'audit_logs';

    IF audit_logs_kind = 'p' THEN
        RAISE NOTICE 'audit_logs is already partitioned; skipping table rewrite';
    ELSE
        IF audit_logs_kind IS NULL THEN
            RAISE EXCEPTION 'audit_logs table does not exist before partition rewrite';
        END IF;

        EXECUTE 'ALTER TABLE public.audit_logs RENAME TO audit_logs_legacy';

        EXECUTE 'DROP INDEX IF EXISTS public.idx_audit_logs_user_id';
        EXECUTE 'DROP INDEX IF EXISTS public.idx_audit_logs_action';
        EXECUTE 'DROP INDEX IF EXISTS public.idx_audit_logs_resource';
        EXECUTE 'DROP INDEX IF EXISTS public.idx_audit_logs_created_at';
        EXECUTE 'DROP INDEX IF EXISTS public.idx_audit_logs_details_gin';
        EXECUTE 'DROP INDEX IF EXISTS public.idx_audit_logs_created_at_brin';

        EXECUTE $ddl$
            CREATE TABLE public.audit_logs (
                id BIGINT GENERATED ALWAYS AS IDENTITY,
                user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
                action VARCHAR(100) NOT NULL,
                resource_type VARCHAR(50) NOT NULL,
                resource_id BIGINT,
                details JSONB,
                ip_address INET,
                user_agent TEXT,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id, created_at)
            ) PARTITION BY RANGE (created_at)
        $ddl$;

        -- Catch-all for any timestamp outside the pre-created monthly partitions
        -- (historical rows copied below, plus anything beyond the forward window).
        EXECUTE 'CREATE TABLE public.audit_logs_default PARTITION OF public.audit_logs DEFAULT';
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Partition-maintenance helper.
-- ----------------------------------------------------------------------------
-- Creates the monthly partition covering p_month if it does not already exist.
-- Pinned search_path keeps it safe from function-hijack via a mutable path.
CREATE OR REPLACE FUNCTION ensure_audit_logs_partition(p_month date)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    start_date date := date_trunc('month', p_month)::date;
    end_date   date := (date_trunc('month', p_month) + INTERVAL '1 month')::date;
    part_name  text := format('audit_logs_%s', to_char(start_date, 'YYYY_MM'));
BEGIN
    -- Schema-qualify the DDL: the pinned search_path puts pg_catalog first, so
    -- an unqualified CREATE TABLE would (illegally) target the system catalog.
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE relname = part_name AND relnamespace = 'public'::regnamespace
    ) THEN
        EXECUTE format(
            'CREATE TABLE public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
            part_name, start_date, end_date
        );
    END IF;
END;
$$;

COMMENT ON FUNCTION ensure_audit_logs_partition(date) IS
    'Idempotently creates the monthly audit_logs partition covering the given '
    'month. Call ahead of time (maintenance job / deploy) so future months '
    'exist before rows arrive — overlapping rows in the DEFAULT partition '
    'block late attachment.';

-- Pre-create the current month plus the next 11 months.
DO $$
DECLARE
    base_month date := date_trunc('month', CURRENT_DATE)::date;
    i int;
BEGIN
    FOR i IN 0..11 LOOP
        PERFORM ensure_audit_logs_partition((base_month + (i || ' months')::interval)::date);
    END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Copy existing rows, preserving id and created_at, when a rewrite happened.
-- ----------------------------------------------------------------------------
-- OVERRIDING SYSTEM VALUE is required to write into a GENERATED ALWAYS identity
-- column. COALESCE guards the (previously nullable) created_at.
DO $$
DECLARE
    max_id bigint;
    sequence_name text;
BEGIN
    IF to_regclass('public.audit_logs_legacy') IS NOT NULL THEN
        EXECUTE $sql$
            INSERT INTO public.audit_logs
                (id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
            OVERRIDING SYSTEM VALUE
            SELECT
                id, user_id, action, resource_type, resource_id, details, ip_address, user_agent,
                COALESCE(created_at, CURRENT_TIMESTAMP)
            FROM public.audit_logs_legacy
        $sql$;

        EXECUTE 'DROP TABLE public.audit_logs_legacy';
        EXECUTE 'DROP SEQUENCE IF EXISTS public.audit_logs_id_seq';
    END IF;

    -- Advance the identity sequence past the highest copied id.
    SELECT MAX(id) INTO max_id FROM public.audit_logs;
    sequence_name := pg_get_serial_sequence('public.audit_logs', 'id');
    IF max_id IS NOT NULL AND sequence_name IS NOT NULL THEN
        PERFORM setval(sequence_name, max_id);
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Recreate indexes on the parent (cascade to every partition).
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id    ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action     ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource   ON audit_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
-- jsonb_path_ops GIN for containment queries on details (migration 016).
CREATE INDEX IF NOT EXISTS idx_audit_logs_details_gin ON audit_logs USING gin (details jsonb_path_ops);
-- BRIN for wide time-range scans (migration 016). Tiny per partition.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_brin ON audit_logs USING brin (created_at);

COMMENT ON TABLE audit_logs IS
    'Comprehensive audit trail for all system actions. RANGE-partitioned by '
    'month on created_at (migration 020); use ensure_audit_logs_partition() to '
    'pre-create future months.';

-- ============================================================================
-- 021_ledger_permissions.sql
-- ============================================================================

-- ============================================================================
-- Migration: Add customer-ledger RBAC permissions
-- Description: Gate customer ledger reads, mutations, voids, and management.
-- ============================================================================

-- Keep the flattened schema aligned with the final RBAC action vocabulary.
ALTER TABLE permissions DROP CONSTRAINT IF EXISTS valid_action;
ALTER TABLE permissions ADD CONSTRAINT valid_action
    CHECK (action IN (
        'create', 'read', 'update', 'delete', 'manage', 'execute', 'void',
        'write', 'verify', 'review', 'assign', 'approve', 'reject', 'escalate',
        'override', 'export', 'download', 'reveal', 'request_resubmission',
        'view_provider_raw', 'manage_reason_codes', 'manage_risk_rules'
    ));

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('ledgers:read', 'ledgers', 'read', 'View customer ledger entries and payments', true),
    ('ledgers:create', 'ledgers', 'create', 'Create customer ledger entries and record ledger payments', true),
    ('ledgers:update', 'ledgers', 'update', 'Update customer ledger entries and payment dates', true),
    ('ledgers:void', 'ledgers', 'void', 'Void customer ledger entries and create reversals', true),
    ('ledgers:manage', 'ledgers', 'manage', 'Full customer ledger management', true)
ON CONFLICT (name) DO UPDATE SET
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    is_system_permission = EXCLUDED.is_system_permission;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin', 'manager', 'accountant')
AND p.name IN (
    'ledgers:read',
    'ledgers:create',
    'ledgers:update',
    'ledgers:void',
    'ledgers:manage'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
AND p.name IN ('ledgers:read', 'ledgers:create')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================================
-- 022_business_runtime_settings.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 022: BUSINESS RUNTIME SETTINGS
-- ============================================================================
-- Description: Add hotel-facing settings that replace hardcoded defaults.
-- ============================================================================

INSERT INTO system_settings (key, value, value_type, category, description, is_public)
VALUES
    (
        'default_payment_terms_days',
        '30',
        'number',
        'ledger',
        'Default ledger due-date offset in days when a company has no payment terms',
        false
    ),
    (
        'totp_issuer_name',
        'Hotel Management System',
        'string',
        'security',
        'Issuer name shown in authenticator apps during TOTP setup',
        false
    ),
    (
        'passkey_relying_party_name',
        'Hotel Management System',
        'string',
        'security',
        'Display name shown by passkey authenticators during registration',
        false
    )
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 023_ledger_role_grants.sql
-- ============================================================================

-- ============================================================================
-- Migration: Ensure core staff roles have customer-ledger permissions
-- Description: Explicitly grant ledger access to Super Administrator,
-- Administrator, Manager, and Receptionist roles.
-- ============================================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('super_admin', 'admin', 'manager')
AND p.name IN (
    'ledgers:read',
    'ledgers:create',
    'ledgers:update',
    'ledgers:void',
    'ledgers:manage'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
AND p.name IN ('ledgers:read', 'ledgers:create')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================================
-- 024_frontdesk_runtime_settings.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 024: FRONT DESK RUNTIME SETTINGS
-- ============================================================================
-- Description: Persist client-facing settings that were previously local only.
-- ============================================================================

INSERT INTO system_settings (key, value, value_type, category, description, is_public)
VALUES
    (
        'night_shift_time',
        '23:00',
        'string',
        'operations',
        'Scheduled night audit posting time',
        false
    ),
    (
        'deposit_amount',
        '50',
        'number',
        'payments',
        'Default room card or check-in deposit amount',
        false
    ),
    (
        'tourism_tax_rate',
        '10',
        'number',
        'tax',
        'Tourism tax amount charged per night for foreign guests',
        false
    ),
    (
        'booking_channels',
        '[{"name":"Booking.com","abbreviation":"B.C"},{"name":"Agoda","abbreviation":"A.C"},{"name":"Traveloka","abbreviation":"T.C"},{"name":"Expedia","abbreviation":"E.C"},{"name":"Hotels.com","abbreviation":"H.C"},{"name":"Airbnb","abbreviation":"AB"},{"name":"Trip.com","abbreviation":"TR"},{"name":"Direct Website","abbreviation":"DW"},{"name":"Other OTA","abbreviation":"OT"}]',
        'json',
        'sales',
        'Online and direct booking channels available to front desk workflows',
        true
    ),
    (
        'payment_methods',
        '["Cash","Visa Card","Master Card","Debit Card","Sarawak Pay","American Express","Bank Transfer","E-Wallet","Other"]',
        'json',
        'payments',
        'Payment methods available to walk-in and payment workflows',
        true
    )
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 025_analytics_role_grants.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 025: ANALYTICS ROLE GRANTS
-- ============================================================================
-- Description: Ensure every operational user role except guest/staff can read analytics.
-- ============================================================================

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES ('analytics:read', 'analytics', 'read', 'Access to analytics and reports', true)
ON CONFLICT (name) DO UPDATE SET
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    is_system_permission = EXCLUDED.is_system_permission;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.name = 'analytics:read'
  AND r.name NOT IN ('guest', 'staff')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================================
-- 026_room_status_reconciliation.sql
-- ============================================================================

-- Keep denormalized room status in step with booking state.
--
-- Confirmed same-day reservations should reserve a room, not mark it occupied.
-- Occupied is reserved for actual checked-in stays. This prevents a later room
-- move from leaving a stale occupied status behind when the only remaining
-- bookings are future reservations.

CREATE OR REPLACE FUNCTION sync_room_status_with_booking() RETURNS TRIGGER AS $$
DECLARE
    v_current_room_status VARCHAR(20);
    v_next_status VARCHAR(20);
    v_has_other_current_stay BOOLEAN;
BEGIN
    -- Skip room status changes for back-dated stays that have already ended.
    IF NEW.check_out_date < CURRENT_DATE
       AND NEW.status IN ('checked_in', 'auto_checked_in', 'checked_out', 'completed') THEN
        RETURN NEW;
    END IF;

    SELECT status INTO v_current_room_status FROM rooms WHERE id = NEW.room_id;

    SELECT EXISTS (
        SELECT 1 FROM bookings
        WHERE room_id = NEW.room_id
          AND id != NEW.id
          AND status IN ('checked_in', 'auto_checked_in', 'late_checkout')
          AND check_in_date <= CURRENT_DATE
          AND check_out_date >= CURRENT_DATE
    ) INTO v_has_other_current_stay;

    IF NEW.status IN ('checked_in', 'auto_checked_in', 'late_checkout')
       AND v_current_room_status != 'occupied' THEN
        PERFORM update_room_status(NEW.room_id, 'occupied',
            'Guest checked in - Booking #' || NEW.id, NULL,
            NEW.check_in_date, NEW.check_out_date);

    ELSIF NEW.status IN ('checked_out', 'completed')
          AND v_current_room_status = 'occupied' THEN
        PERFORM update_room_status(NEW.room_id, 'dirty',
            'Guest checked out - Needs cleaning - Booking #' || NEW.id,
            NULL, CURRENT_TIMESTAMP, NULL);

    ELSIF NEW.status IN ('confirmed', 'pending')
          AND NOT v_has_other_current_stay
          AND v_current_room_status NOT IN ('maintenance', 'out_of_order', 'dirty', 'cleaning') THEN
        PERFORM update_room_status(NEW.room_id, 'reserved',
            CASE
                WHEN NEW.check_in_date::date = CURRENT_DATE
                    THEN 'Same-day reservation - Booking #' || NEW.id
                ELSE 'Future reservation - Booking #' || NEW.id
            END,
            NULL, NEW.check_in_date, NEW.check_out_date);

    ELSIF NEW.status IN ('no_show', 'voided')
          AND v_current_room_status IN ('occupied', 'reserved') THEN
        SELECT CASE
            WHEN EXISTS (
                SELECT 1 FROM bookings
                WHERE room_id = NEW.room_id
                  AND id != NEW.id
                  AND status IN ('checked_in', 'auto_checked_in', 'late_checkout')
                  AND check_in_date <= CURRENT_DATE
                  AND check_out_date >= CURRENT_DATE
            ) THEN 'occupied'
            WHEN EXISTS (
                SELECT 1 FROM bookings
                WHERE room_id = NEW.room_id
                  AND id != NEW.id
                  AND status IN ('confirmed', 'pending')
                  AND check_out_date > CURRENT_DATE
            ) THEN 'reserved'
            ELSE 'available'
        END INTO v_next_status;

        PERFORM update_room_status(NEW.room_id, v_next_status,
            'Booking no-show/voided - Booking #' || NEW.id, NULL, NULL, NULL);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 027_enforce_booking_tourism_tax.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 027: ENFORCE BOOKING TOURISM TAX
-- ============================================================================
-- Description:
--   Keep bookings.is_tourist and bookings.tourism_tax_amount derived from the
--   guest tourism type, booking dates, and hotel tourism tax setting. This
--   prevents stale or client-supplied values from undercharging extended stays.
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_booking_tourism_tax()
RETURNS TRIGGER AS $$
DECLARE
    v_is_tourist BOOLEAN := false;
    v_tourism_tax_rate NUMERIC := 10;
    v_billable_nights INTEGER := 1;
BEGIN
    SELECT COALESCE(
        (
            SELECT CASE
                WHEN trim(value) ~ '^[0-9]+(\.[0-9]+)?$' AND trim(value)::numeric > 0
                    THEN trim(value)::numeric
                ELSE NULL
            END
            FROM system_settings
            WHERE key = 'tourism_tax_rate'
            LIMIT 1
        ),
        10
    )
    INTO v_tourism_tax_rate;

    SELECT COALESCE(g.tourism_type::text = 'foreign', false)
    INTO v_is_tourist
    FROM guests g
    WHERE g.id = NEW.guest_id;

    v_billable_nights := GREATEST((NEW.check_out_date - NEW.check_in_date), 1);

    NEW.is_tourist := COALESCE(v_is_tourist, false);
    NEW.tourism_tax_amount := CASE
        WHEN NEW.is_tourist THEN v_tourism_tax_rate * v_billable_nights
        ELSE 0
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_booking_tourism_tax ON bookings;

CREATE TRIGGER trg_enforce_booking_tourism_tax
    BEFORE INSERT OR UPDATE OF guest_id, check_in_date, check_out_date, is_tourist, tourism_tax_amount
    ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION enforce_booking_tourism_tax();

COMMENT ON COLUMN bookings.is_tourist IS
    'Derived from guests.tourism_type. Foreign guests are charged tourism tax.';
COMMENT ON COLUMN bookings.tourism_tax_amount IS
    'Total tourism tax for the booking, derived from configured per-night rate times billable nights for foreign guests.';

WITH tourism_setting AS (
    SELECT COALESCE(
        (
            SELECT CASE
                WHEN trim(value) ~ '^[0-9]+(\.[0-9]+)?$' AND trim(value)::numeric > 0
                    THEN trim(value)::numeric
                ELSE NULL
            END
            FROM system_settings
            WHERE key = 'tourism_tax_rate'
            LIMIT 1
        ),
        10
    ) AS rate
)
UPDATE bookings b
SET
    is_tourist = (g.tourism_type::text = 'foreign'),
    tourism_tax_amount = CASE
        WHEN g.tourism_type::text = 'foreign'
            THEN s.rate * GREATEST((b.check_out_date - b.check_in_date), 1)
        ELSE 0
    END
FROM guests g
CROSS JOIN tourism_setting s
WHERE b.guest_id = g.id
  AND (
      COALESCE(b.is_tourist, false) IS DISTINCT FROM (g.tourism_type::text = 'foreign')
      OR COALESCE(b.tourism_tax_amount, 0) IS DISTINCT FROM CASE
          WHEN g.tourism_type::text = 'foreign'
              THEN s.rate * GREATEST((b.check_out_date - b.check_in_date), 1)
          ELSE 0
      END
  );

-- ============================================================================
-- 028_booking_cleaning_preference.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 028: BOOKING CLEANING PREFERENCE
-- ============================================================================
-- Description:
--   Add a per-booking daily-cleaning preference captured at the front desk.
--   NULL  = not set, TRUE = guest wants daily cleaning, FALSE = declined.
-- ============================================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cleaning_preference BOOLEAN;

-- ============================================================================
-- 029_dynamic_rbac_permissions.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 029: DYNAMIC RBAC PERMISSIONS
-- ============================================================================
-- Description: Seed first-class access-control permissions used by RBAC routes.
-- ============================================================================

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('users:create', 'users', 'create', 'Create users', true),
    ('users:read', 'users', 'read', 'View users', true),
    ('users:update', 'users', 'update', 'Update users', true),
    ('users:delete', 'users', 'delete', 'Delete users', true),
    ('users:manage', 'users', 'manage', 'Full user management', true),
    ('roles:create', 'roles', 'create', 'Create roles', true),
    ('roles:read', 'roles', 'read', 'View roles', true),
    ('roles:update', 'roles', 'update', 'Update roles', true),
    ('roles:delete', 'roles', 'delete', 'Delete roles', true),
    ('roles:manage', 'roles', 'manage', 'Full role management', true),
    ('permissions:create', 'permissions', 'create', 'Create permissions', true),
    ('permissions:read', 'permissions', 'read', 'View permissions', true),
    ('permissions:update', 'permissions', 'update', 'Update permissions', true),
    ('permissions:delete', 'permissions', 'delete', 'Delete permissions', true),
    ('permissions:manage', 'permissions', 'manage', 'Full permission management', true),
    ('loyalty:read', 'loyalty', 'read', 'View loyalty program data', true),
    ('loyalty:manage', 'loyalty', 'manage', 'Manage loyalty program rewards and points', true)
ON CONFLICT (name) DO UPDATE SET
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    is_system_permission = EXCLUDED.is_system_permission;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
AND p.name IN (
    'users:create',
    'users:read',
    'users:update',
    'users:delete',
    'users:manage',
    'roles:create',
    'roles:read',
    'roles:update',
    'roles:delete',
    'roles:manage',
    'permissions:create',
    'permissions:read',
    'permissions:update',
    'permissions:delete',
    'permissions:manage',
    'loyalty:read',
    'loyalty:manage'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('manager', 'receptionist')
AND p.name IN (
    'loyalty:read'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================================
-- 030_dynamic_route_access_policies.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 030: DYNAMIC ROUTE ACCESS POLICIES
-- ============================================================================
-- Description: Store frontend route/navigation RBAC policy in the database so
--              clients consume policy from the backend instead of hardcoding it.
-- ============================================================================

ALTER TABLE permissions DROP CONSTRAINT IF EXISTS valid_action;
ALTER TABLE permissions ADD CONSTRAINT valid_action
    CHECK (action IN (
        'create', 'read', 'update', 'delete', 'manage', 'execute', 'void',
        'write', 'verify', 'review', 'assign', 'approve', 'reject', 'escalate',
        'override', 'export', 'download', 'reveal', 'request_resubmission',
        'view_provider_raw', 'manage_reason_codes', 'manage_risk_rules'
    ));

CREATE TABLE IF NOT EXISTS route_access_policies (
    route_id VARCHAR(100) PRIMARY KEY,
    path VARCHAR(255) NOT NULL,
    nav_label VARCHAR(100),
    nav_group VARCHAR(50),
    required_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    required_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
    excluded_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
    nav_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    nav_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
    nav_excluded_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_navigation BOOLEAN NOT NULL DEFAULT false,
    is_system_policy BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_route_access_policy_id CHECK (route_id ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT valid_route_access_policy_arrays CHECK (
        jsonb_typeof(required_permissions) = 'array'
        AND jsonb_typeof(required_roles) = 'array'
        AND jsonb_typeof(excluded_roles) = 'array'
        AND jsonb_typeof(nav_permissions) = 'array'
        AND jsonb_typeof(nav_roles) = 'array'
        AND jsonb_typeof(nav_excluded_roles) = 'array'
    )
);

DROP TRIGGER IF EXISTS update_route_access_policies_updated_at ON route_access_policies;
CREATE TRIGGER update_route_access_policies_updated_at
    BEFORE UPDATE ON route_access_policies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('rooms:write', 'rooms', 'write', 'Create and modify rooms and room types', true),
    ('ekyc:manage', 'ekyc', 'manage', 'Manage eKYC verifications', true),
    ('ekyc:verify', 'ekyc', 'verify', 'Approve or reject eKYC verifications', true),
    ('rewards:read', 'rewards', 'read', 'View reward information', true),
    ('navigation_timeline:read', 'navigation:timeline', 'read', 'Show Reservation Timeline navigation', true),
    ('navigation_guest_config:read', 'navigation:guest-config', 'read', 'Show Guest Management navigation', true),
    ('navigation_bookings:read', 'navigation:bookings', 'read', 'Show Bookings navigation', true),
    ('navigation_my_bookings:read', 'navigation:my-bookings', 'read', 'Show My Bookings navigation', true),
    ('navigation_room_management:read', 'navigation:room-management', 'read', 'Show Room Management navigation', true),
    ('navigation_reports:read', 'navigation:reports', 'read', 'Show Reports navigation', true),
    ('navigation_ekyc_admin:read', 'navigation:ekyc-admin', 'read', 'Show eKYC Admin navigation', true),
    ('navigation_room_config:read', 'navigation:room-config', 'read', 'Show Room Configuration navigation', true),
    ('navigation_settings:read', 'navigation:settings', 'read', 'Show Settings navigation', true),
    ('navigation_rbac:read', 'navigation:rbac', 'read', 'Show Access Control navigation', true),
    ('navigation_company_ledger:read', 'navigation:company-ledger', 'read', 'Show Company Ledger navigation', true),
    ('navigation_night_audit:read', 'navigation:night-audit', 'read', 'Show Night Audit navigation', true),
    ('navigation_audit_log:read', 'navigation:audit-log', 'read', 'Show Audit Log navigation', true),
    ('navigation_complimentary:read', 'navigation:complimentary', 'read', 'Show Complimentary Nights navigation', true),
    ('navigation_data_transfer:read', 'navigation:data-transfer', 'read', 'Show Data Transfer navigation', true)
ON CONFLICT (name) DO UPDATE SET
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    is_system_permission = EXCLUDED.is_system_permission;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
AND p.name IN (
    'rooms:write',
    'ekyc:manage',
    'ekyc:verify',
    'rewards:read',
    'navigation_timeline:read',
    'navigation_guest_config:read',
    'navigation_bookings:read',
    'navigation_room_management:read',
    'navigation_reports:read',
    'navigation_ekyc_admin:read',
    'navigation_room_config:read',
    'navigation_settings:read',
    'navigation_rbac:read',
    'navigation_company_ledger:read',
    'navigation_night_audit:read',
    'navigation_audit_log:read',
    'navigation_complimentary:read',
    'navigation_data_transfer:read'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'guest'
AND p.name IN ('rewards:read', 'navigation_my_bookings:read')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO route_access_policies (
    route_id,
    path,
    nav_label,
    nav_group,
    required_permissions,
    required_roles,
    excluded_roles,
    nav_permissions,
    nav_roles,
    nav_excluded_roles,
    is_navigation
)
VALUES
    ('dashboard', '/', NULL, NULL, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false),
    ('timeline', '/timeline', 'Timeline', 'main', '["rooms:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_timeline:read","bookings:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('guest-config', '/guest-config', 'Guests', 'main', '["guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_guest_config:read","guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('bookings', '/bookings', 'Bookings', 'main', '["bookings:read","bookings:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_bookings:read","bookings:read","bookings:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('my-bookings', '/my-bookings', 'My Bookings', 'main', '["bookings:read"]'::jsonb, '[]'::jsonb, '["super_admin","admin","manager","receptionist","staff"]'::jsonb, '["navigation_my_bookings:read","bookings:read"]'::jsonb, '[]'::jsonb, '["super_admin","admin","manager","receptionist","staff"]'::jsonb, true),
    ('room-management', '/room-management', 'Rooms', 'main', '["rooms:read","rooms:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_room_management:read","rooms:read","rooms:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('reports', '/reports', 'Reports', 'operations', '["analytics:read","reports:execute"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_reports:read","analytics:read","reports:execute"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('loyalty', '/loyalty', NULL, NULL, '["loyalty:read","loyalty:manage","analytics:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false),
    ('profile', '/profile', NULL, NULL, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false),
    ('help', '/help', NULL, NULL, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false),
    ('ekyc', '/ekyc', NULL, NULL, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false),
    ('ekyc-admin', '/ekyc-admin', 'eKYC Admin', 'admin', '["ekyc:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_ekyc_admin:read","ekyc:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('room-config', '/room-config', 'Room Configuration', 'config', '["rooms:update","rooms:write","rooms:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_room_config:read","rooms:update","rooms:write","rooms:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('settings', '/settings', 'Settings', 'config', '["settings:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_settings:read","settings:read","settings:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('rbac', '/rbac', 'Access Control', 'config', '["roles:read","roles:manage","permissions:read","permissions:manage","users:read","users:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_rbac:read","roles:read","roles:manage","permissions:read","permissions:manage","users:read","users:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('company-ledger', '/company-ledger', 'Ledger', 'operations', '["ledgers:read","ledgers:create","ledgers:update","ledgers:void","ledgers:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_company_ledger:read","ledgers:read","ledgers:create","ledgers:update","ledgers:void","ledgers:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('night-audit', '/night-audit', 'Night Audit', 'admin', '["night_audit:read","night_audit:execute"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_night_audit:read","night_audit:read","night_audit:execute"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('audit-log', '/audit-log', 'Audit Log', 'admin', '["audit:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_audit_log:read","audit:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('complimentary', '/complimentary', 'Complimentary Nights', 'admin', '["bookings:read","bookings:update"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_complimentary:read","bookings:read","bookings:update"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true),
    ('data-transfer', '/data-transfer', 'Data Transfer', 'admin', '["settings:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["navigation_data_transfer:read","settings:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true)
ON CONFLICT (route_id) DO NOTHING;

-- ============================================================================
-- 031_bootstrap_quarantine.sql
-- ============================================================================

-- ============================================================================
-- MIGRATION 031: BOOTSTRAP QUARANTINE
-- ============================================================================
-- Description: Durable quarantine table for invalid or obsolete bootstrap-managed
--              records captured before cleanup.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.invalid_data_quarantine (
    quarantine_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_table TEXT NOT NULL,
    source_key TEXT,
    invalid_reason TEXT NOT NULL,
    original_data JSONB NOT NULL,
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invalid_data_quarantine_source
    ON app.invalid_data_quarantine (source_table, quarantined_at DESC);

COMMENT ON TABLE app.invalid_data_quarantine IS
    'Rows quarantined by bootstrap validation before invalid or obsolete seed-managed records are removed.';

-- ============================================================================
-- 034_night_audit_restore_daily_rates.sql
-- ============================================================================

-- Migration: 034_night_audit_restore_daily_rates.sql
-- Description: Restore daily_rates support in run_night_audit. Migration 028
--              originally added per-night rate lookup, but 031 (tourism tax)
--              and 032 (extra bed) regenerated the function and silently
--              dropped that branch, causing the audit to post b.room_rate even
--              when b.daily_rates['<audit_date>'] held a different value.
--              Also reconciles posted_nights rows that disagree with daily_rates.

CREATE OR REPLACE FUNCTION run_night_audit(
    p_audit_date DATE,
    p_user_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
    v_audit_run_id BIGINT;
    v_bookings_posted INTEGER := 0;
    v_checkins INTEGER := 0;
    v_checkouts INTEGER := 0;
    v_revenue DECIMAL(12, 2) := 0;
    v_rooms_occupied INTEGER := 0;
    v_rooms_available INTEGER := 0;
    v_rooms_reserved INTEGER := 0;
    v_rooms_maintenance INTEGER := 0;
    v_rooms_dirty INTEGER := 0;
    v_total_rooms INTEGER := 0;
    v_occupancy_rate DECIMAL(5, 2) := 0;
    v_booking RECORD;
    v_tax_rate DECIMAL(5, 4) := 0.08;
    v_night_rate DECIMAL(10, 2);
    v_room_charge DECIMAL(10, 2);
    v_service_tax DECIMAL(10, 2);
    v_tourism_tax_per_night DECIMAL(10, 2);
    v_nights INTEGER;
    v_extra_bed_charge_per_night DECIMAL(10, 2);
    v_extra_bed_tax DECIMAL(10, 2);
    v_night_total DECIMAL(10, 2);
BEGIN
    IF EXISTS (SELECT 1 FROM night_audit_runs WHERE audit_date = p_audit_date AND status = 'completed') THEN
        RAISE EXCEPTION 'Night audit already completed for date %', p_audit_date;
    END IF;

    BEGIN
        SELECT CAST(value AS DECIMAL) / 100.0 INTO v_tax_rate
        FROM system_settings WHERE key = 'service_tax_rate';
    EXCEPTION WHEN OTHERS THEN
        v_tax_rate := 0.08;
    END;

    INSERT INTO night_audit_runs (audit_date, run_by, status)
    VALUES (p_audit_date, p_user_id, 'in_progress')
    RETURNING id INTO v_audit_run_id;

    FOR v_booking IN
        SELECT b.id, b.booking_number, b.status, b.room_rate, b.total_amount,
               b.check_in_date, b.check_out_date, b.guest_id, b.room_id,
               b.daily_rates,
               COALESCE(b.is_tourist, false) as is_tourist,
               COALESCE(b.tourism_tax_amount, 0) as tourism_tax_amount,
               COALESCE(b.extra_bed_charge, 0) as extra_bed_charge
        FROM bookings b
        WHERE b.status NOT IN ('pending', 'confirmed', 'no_show', 'voided')
        AND b.check_in_date <= p_audit_date
        AND b.check_out_date > p_audit_date
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = p_audit_date
        )
    LOOP
        IF v_booking.daily_rates IS NOT NULL
           AND v_booking.daily_rates ? p_audit_date::TEXT THEN
            v_night_rate := (v_booking.daily_rates ->> p_audit_date::TEXT)::DECIMAL;
        ELSE
            v_night_rate := v_booking.room_rate;
        END IF;

        v_room_charge := ROUND(v_night_rate / (1 + v_tax_rate), 2);
        v_service_tax := v_night_rate - v_room_charge;

        v_tourism_tax_per_night := 0;
        IF v_booking.is_tourist AND v_booking.tourism_tax_amount > 0 THEN
            v_nights := GREATEST((v_booking.check_out_date - v_booking.check_in_date), 1);
            v_tourism_tax_per_night := ROUND(v_booking.tourism_tax_amount / v_nights, 2);
        END IF;

        v_extra_bed_charge_per_night := 0;
        v_extra_bed_tax := 0;
        IF v_booking.extra_bed_charge > 0 THEN
            v_extra_bed_charge_per_night := ROUND(v_booking.extra_bed_charge / (1 + v_tax_rate), 2);
            v_extra_bed_tax := v_booking.extra_bed_charge - v_extra_bed_charge_per_night;
        END IF;

        v_night_total := v_night_rate + v_booking.extra_bed_charge + v_tourism_tax_per_night;

        INSERT INTO night_audit_posted_nights
            (booking_id, audit_date, room_rate, room_charge, service_tax, tourism_tax,
             extra_bed_charge, extra_bed_tax, total_posted, audit_run_id, posted_by)
        VALUES
            (v_booking.id, p_audit_date, v_night_rate, v_room_charge, v_service_tax,
             v_tourism_tax_per_night, v_extra_bed_charge_per_night, v_extra_bed_tax,
             v_night_total, v_audit_run_id, p_user_id);

        INSERT INTO night_audit_details (audit_run_id, booking_id, record_type, action, data)
        VALUES (v_audit_run_id, v_booking.id, 'booking', 'night_posted',
            jsonb_build_object(
                'status', v_booking.status,
                'room_rate', v_booking.room_rate,
                'night_rate', v_night_rate,
                'has_daily_rates', (v_booking.daily_rates IS NOT NULL),
                'night_date', p_audit_date,
                'room_charge', v_room_charge,
                'service_tax', v_service_tax,
                'tourism_tax', v_tourism_tax_per_night,
                'extra_bed_charge', v_extra_bed_charge_per_night,
                'extra_bed_tax', v_extra_bed_tax,
                'check_in_date', v_booking.check_in_date,
                'check_out_date', v_booking.check_out_date
            )
        );

        v_bookings_posted := v_bookings_posted + 1;
        v_revenue := v_revenue + v_night_total;
    END LOOP;

    -- Same-day checkout (hourly stays)
    FOR v_booking IN
        SELECT b.id, b.booking_number, b.status, b.room_rate, b.total_amount,
               b.check_in_date, b.check_out_date, b.guest_id, b.room_id,
               b.daily_rates,
               COALESCE(b.is_tourist, false) as is_tourist,
               COALESCE(b.tourism_tax_amount, 0) as tourism_tax_amount,
               COALESCE(b.extra_bed_charge, 0) as extra_bed_charge
        FROM bookings b
        WHERE b.status = 'checked_out'
        AND b.check_in_date = p_audit_date
        AND b.check_out_date = p_audit_date
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = p_audit_date
        )
    LOOP
        IF v_booking.daily_rates IS NOT NULL
           AND v_booking.daily_rates ? p_audit_date::TEXT THEN
            v_night_rate := (v_booking.daily_rates ->> p_audit_date::TEXT)::DECIMAL;
        ELSE
            v_night_rate := v_booking.room_rate;
        END IF;

        v_room_charge := ROUND(v_night_rate / (1 + v_tax_rate), 2);
        v_service_tax := v_night_rate - v_room_charge;

        v_tourism_tax_per_night := 0;
        IF v_booking.is_tourist AND v_booking.tourism_tax_amount > 0 THEN
            v_tourism_tax_per_night := v_booking.tourism_tax_amount;
        END IF;

        v_extra_bed_charge_per_night := 0;
        v_extra_bed_tax := 0;
        IF v_booking.extra_bed_charge > 0 THEN
            v_extra_bed_charge_per_night := ROUND(v_booking.extra_bed_charge / (1 + v_tax_rate), 2);
            v_extra_bed_tax := v_booking.extra_bed_charge - v_extra_bed_charge_per_night;
        END IF;

        v_night_total := v_night_rate + v_booking.extra_bed_charge + v_tourism_tax_per_night;

        INSERT INTO night_audit_posted_nights
            (booking_id, audit_date, room_rate, room_charge, service_tax, tourism_tax,
             extra_bed_charge, extra_bed_tax, total_posted, audit_run_id, posted_by)
        VALUES
            (v_booking.id, p_audit_date, v_night_rate, v_room_charge, v_service_tax,
             v_tourism_tax_per_night, v_extra_bed_charge_per_night, v_extra_bed_tax,
             v_night_total, v_audit_run_id, p_user_id);

        INSERT INTO night_audit_details (audit_run_id, booking_id, record_type, action, data)
        VALUES (v_audit_run_id, v_booking.id, 'booking', 'night_posted',
            jsonb_build_object(
                'status', v_booking.status,
                'room_rate', v_booking.room_rate,
                'night_rate', v_night_rate,
                'has_daily_rates', (v_booking.daily_rates IS NOT NULL),
                'night_date', p_audit_date,
                'room_charge', v_room_charge,
                'service_tax', v_service_tax,
                'tourism_tax', v_tourism_tax_per_night,
                'extra_bed_charge', v_extra_bed_charge_per_night,
                'extra_bed_tax', v_extra_bed_tax,
                'check_in_date', v_booking.check_in_date,
                'check_out_date', v_booking.check_out_date
            )
        );

        v_bookings_posted := v_bookings_posted + 1;
        v_revenue := v_revenue + v_night_total;
        v_checkouts := v_checkouts + 1;
    END LOOP;

    SELECT COUNT(*) INTO v_checkins FROM bookings
    WHERE status IN ('checked_in', 'auto_checked_in') AND check_in_date = p_audit_date;

    SELECT COUNT(*) INTO v_checkouts FROM bookings
    WHERE status = 'checked_out'
    AND COALESCE((actual_check_out AT TIME ZONE COALESCE((SELECT value FROM system_settings WHERE key = 'timezone'), 'UTC'))::date, check_out_date) = p_audit_date;

    SELECT COUNT(*) INTO v_total_rooms FROM rooms;

    SELECT
        COUNT(*) FILTER (WHERE status = 'available' OR status = 'clean'),
        COUNT(*) FILTER (WHERE status = 'occupied'),
        COUNT(*) FILTER (WHERE status = 'reserved'),
        COUNT(*) FILTER (WHERE status IN ('maintenance', 'out_of_order')),
        COUNT(*) FILTER (WHERE status = 'dirty' OR status = 'cleaning')
    INTO v_rooms_available, v_rooms_occupied, v_rooms_reserved, v_rooms_maintenance, v_rooms_dirty
    FROM rooms;

    SELECT COUNT(DISTINCT r.id) INTO v_rooms_occupied
    FROM rooms r
    JOIN bookings b ON r.id = b.room_id
    WHERE b.status IN ('checked_in', 'auto_checked_in')
    AND b.check_in_date <= p_audit_date
    AND b.check_out_date > p_audit_date;

    IF v_total_rooms > 0 THEN
        v_occupancy_rate := ROUND((v_rooms_occupied::DECIMAL / v_total_rooms) * 100, 2);
    END IF;

    UPDATE rooms
    SET last_posted_status = status, last_posted_date = p_audit_date;

    UPDATE night_audit_runs
    SET status = 'completed',
        total_bookings_posted = v_bookings_posted,
        total_checkins = v_checkins,
        total_checkouts = v_checkouts,
        total_revenue = v_revenue,
        total_rooms_occupied = v_rooms_occupied,
        total_rooms_available = v_rooms_available,
        occupancy_rate = v_occupancy_rate,
        rooms_available = v_rooms_available,
        rooms_occupied = v_rooms_occupied,
        rooms_reserved = v_rooms_reserved,
        rooms_maintenance = v_rooms_maintenance,
        rooms_dirty = v_rooms_dirty,
        run_at = NOW()
    WHERE id = v_audit_run_id;

    RETURN v_audit_run_id;
END;
$$ LANGUAGE plpgsql;

-- Reconcile already-posted nights whose daily_rates entry disagrees with the
-- frozen room_rate (regression introduced by 031/032). Idempotent: no-op once
-- posted rows match daily_rates.
DO $$
DECLARE
    v_tax_rate DECIMAL(5, 4) := 0.08;
    r RECORD;
    v_new_rate DECIMAL(10, 2);
    v_new_room_charge DECIMAL(10, 2);
    v_new_service_tax DECIMAL(10, 2);
    v_new_total DECIMAL(10, 2);
    v_delta DECIMAL(10, 2);
BEGIN
    BEGIN
        SELECT CAST(value AS DECIMAL) / 100.0 INTO v_tax_rate
        FROM system_settings WHERE key = 'service_tax_rate';
    EXCEPTION WHEN OTHERS THEN
        v_tax_rate := 0.08;
    END;

    FOR r IN
        SELECT napn.id AS posted_id,
               napn.audit_run_id,
               napn.tourism_tax,
               napn.extra_bed_charge,
               (b.daily_rates ->> napn.audit_date::text)::DECIMAL AS expected_rate,
               napn.total_posted AS old_total
        FROM night_audit_posted_nights napn
        JOIN bookings b ON b.id = napn.booking_id
        WHERE b.daily_rates IS NOT NULL
          AND b.daily_rates ? napn.audit_date::text
          AND (b.daily_rates ->> napn.audit_date::text)::DECIMAL <> napn.room_rate
    LOOP
        v_new_rate := r.expected_rate;
        v_new_room_charge := ROUND(v_new_rate / (1 + v_tax_rate), 2);
        v_new_service_tax := v_new_rate - v_new_room_charge;
        v_new_total := v_new_rate + r.extra_bed_charge + r.tourism_tax;
        v_delta := v_new_total - r.old_total;

        UPDATE night_audit_posted_nights
        SET room_rate = v_new_rate,
            room_charge = v_new_room_charge,
            service_tax = v_new_service_tax,
            total_posted = v_new_total
        WHERE id = r.posted_id;

        IF r.audit_run_id IS NOT NULL AND v_delta <> 0 THEN
            UPDATE night_audit_runs
            SET total_revenue = COALESCE(total_revenue, 0) + v_delta
            WHERE id = r.audit_run_id;
        END IF;
    END LOOP;
END;
$$;
