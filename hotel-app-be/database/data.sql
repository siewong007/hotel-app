-- ============================================================================
-- HOTEL APP DATA
-- ============================================================================
-- Purpose:
-- 1. Validate existing system-managed data
-- 2. Quarantine invalid records before removal
-- 3. Insert or update seed data
-- 4. Remove obsolete seed-managed records where the schema marks ownership
-- 5. Run safely more than once
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Prevent two deployments from modifying seed data simultaneously.
SELECT pg_advisory_xact_lock(hashtext('hotel_app_database_bootstrap'));


-- Current canonical system roles.
CREATE TEMP TABLE expected_system_roles (
    name TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO expected_system_roles (name)
VALUES
    ('super_admin'),
    ('admin'),
    ('manager'),
    ('receptionist'),
    ('housekeeping'),
    ('staff'),
    ('guest'),
    ('compliance_admin'),
    ('ekyc_reviewer'),
    ('senior_reviewer'),
    ('auditor'),
    ('support_readonly');

-- Current canonical system permissions seeded by migrations and seed data.
CREATE TEMP TABLE expected_system_permissions (
    name TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO expected_system_permissions (name)
VALUES
    ('analytics:read'),
    ('audit:export'),
    ('audit:read'),
    ('bookings:create'),
    ('bookings:delete'),
    ('bookings:manage'),
    ('bookings:read'),
    ('bookings:update'),
    ('companies:create'),
    ('companies:delete'),
    ('companies:manage'),
    ('companies:read'),
    ('companies:update'),
    ('ekyc:approve'),
    ('ekyc:assign'),
    ('ekyc:download_documents'),
    ('ekyc:escalate'),
    ('ekyc:export'),
    ('ekyc:manage'),
    ('ekyc:manage_reason_codes'),
    ('ekyc:manage_risk_rules'),
    ('ekyc:override'),
    ('ekyc:read'),
    ('ekyc:reject'),
    ('ekyc:request_resubmission'),
    ('ekyc:reveal_sensitive'),
    ('ekyc:review'),
    ('ekyc:verify'),
    ('ekyc:view_provider_raw'),
    ('ekyc:view_sensitive'),
    ('guests:create'),
    ('guests:delete'),
    ('guests:manage'),
    ('guests:read'),
    ('guests:update'),
    ('housekeeping:create'),
    ('housekeeping:manage'),
    ('housekeeping:read'),
    ('housekeeping:update'),
    ('ledgers:create'),
    ('ledgers:manage'),
    ('ledgers:read'),
    ('ledgers:update'),
    ('ledgers:void'),
    ('loyalty:manage'),
    ('loyalty:read'),
    ('maintenance:manage'),
    ('maintenance:read'),
    ('maintenance:write'),
    ('navigation_audit_log:read'),
    ('navigation_bookings:read'),
    ('navigation_company_ledger:read'),
    ('navigation_complimentary:read'),
    ('navigation_data_transfer:read'),
    ('navigation_ekyc_admin:read'),
    ('navigation_guest_config:read'),
    ('navigation_housekeeping:read'),
    ('navigation_loyalty:read'),
    ('navigation_my_bookings:read'),
    ('navigation_my_rewards:read'),
    ('navigation_night_audit:read'),
    ('navigation_rbac:read'),
    ('navigation_reports:read'),
    ('navigation_room_config:read'),
    ('navigation_room_management:read'),
    ('navigation_settings:read'),
    ('navigation_timeline:read'),
    ('night_audit:execute'),
    ('night_audit:read'),
    ('payments:create'),
    ('payments:delete'),
    ('payments:manage'),
    ('payments:read'),
    ('payments:refund'),
    ('payments:update'),
    ('permissions:create'),
    ('permissions:delete'),
    ('permissions:manage'),
    ('permissions:read'),
    ('permissions:update'),
    ('reports:execute'),
    ('reports:read'),
    ('reviews:create'),
    ('reviews:delete'),
    ('reviews:manage'),
    ('reviews:read'),
    ('reviews:update'),
    ('rewards:read'),
    ('roles:create'),
    ('roles:delete'),
    ('roles:manage'),
    ('roles:read'),
    ('roles:update'),
    ('rooms:create'),
    ('rooms:delete'),
    ('rooms:manage'),
    ('rooms:read'),
    ('rooms:update'),
    ('rooms:write'),
    ('services:create'),
    ('services:delete'),
    ('services:manage'),
    ('services:read'),
    ('services:update'),
    ('settings:manage'),
    ('settings:read'),
    ('settings:update'),
    ('support:assign'),
    ('support:escalate'),
    ('support:manage'),
    ('support:read'),
    ('support:write'),
    ('navigation_support:read'),
    ('users:create'),
    ('users:delete'),
    ('users:manage'),
    ('users:read'),
    ('users:update');

CREATE TEMP TABLE expected_system_settings (
    key TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO expected_system_settings (key)
VALUES
    ('booking_channels'),
    ('auto_checkin_requires_ekyc'),
    ('check_in_time'),
    ('check_out_time'),
    ('currency'),
    ('default_payment_terms_days'),
    ('deposit_amount'),
    ('enable_2fa'),
    ('enable_email_verification'),
    ('guest_titles'),
    ('hotel_address'),
    ('hotel_email'),
    ('hotel_name'),
    ('hotel_phone'),
    ('market_codes'),
    ('max_login_attempts'),
    ('night_shift_time'),
    ('passkey_relying_party_name'),
    ('payment_methods'),
    ('rate_codes'),
    ('report_caption_font_size'),
    ('report_chip_font_size'),
    ('report_font_family'),
    ('report_font_size'),
    ('report_heading_font_size'),
    ('report_section_heading_font_size'),
    ('report_table_font_size'),
    ('service_tax_rate'),
    ('session_timeout'),
    ('support_auto_close_resolved_days'),
    ('support_categories'),
    ('support_enabled'),
    ('support_first_response_high_minutes'),
    ('support_first_response_low_minutes'),
    ('support_first_response_normal_minutes'),
    ('support_first_response_urgent_minutes'),
    ('support_reopen_window_days'),
    ('support_resolution_high_minutes'),
    ('support_resolution_low_minutes'),
    ('support_resolution_normal_minutes'),
    ('support_resolution_urgent_minutes'),
    ('timezone'),
    ('totp_issuer_name'),
    ('tourism_tax_rate');

CREATE TEMP TABLE expected_room_types (
    code TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO expected_room_types (code)
VALUES
    ('STD'),
    ('DLX'),
    ('STE'),
    ('FAM');

CREATE TEMP TABLE expected_rooms (
    room_number TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO expected_rooms (room_number)
VALUES
    ('101'), ('102'), ('103'), ('104'), ('105'),
    ('201'), ('202'), ('203'), ('204'), ('205'),
    ('301'), ('302'), ('303'),
    ('401'), ('402'), ('403');

CREATE TEMP TABLE expected_rate_plans (
    code TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO expected_rate_plans (code)
VALUES
    ('COMP'),
    ('RACK'),
    ('CORP'),
    ('WKND'),
    ('EARLY'),
    ('GROUP');

CREATE TEMP TABLE expected_route_access_policies (
    route_id TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO expected_route_access_policies (route_id)
VALUES
    ('audit-log'),
    ('bookings'),
    ('company-ledger'),
    ('complimentary'),
    ('dashboard'),
    ('data-transfer'),
    ('ekyc'),
    ('ekyc-admin'),
    ('guest-config'),
    ('help'),
    ('housekeeping'),
    ('loyalty'),
    ('my-bookings'),
    ('night-audit'),
    ('profile'),
    ('rbac'),
    ('reports'),
    ('room-config'),
    ('room-management'),
    ('settings'),
    ('support'),
    ('timeline');

-- Quarantine and remove invalid system-owned roles before reseeding.
INSERT INTO app.invalid_data_quarantine (
    source_table,
    source_key,
    invalid_reason,
    original_data
)
SELECT
    'public.roles',
    r.id::TEXT,
    concat_ws(
        '; ',
        CASE WHEN r.name IS NULL OR r.name !~ '^[a-z][a-z0-9_]*$' THEN 'Invalid role name' END,
        CASE WHEN r.display_name IS NULL OR length(trim(r.display_name)) = 0 THEN 'Missing display name' END,
        CASE WHEN r.priority IS NULL OR r.priority < 0 THEN 'Invalid priority' END
    ),
    to_jsonb(r)
FROM roles r
WHERE r.is_system_role IS TRUE
  AND (
      r.name IS NULL
      OR r.name !~ '^[a-z][a-z0-9_]*$'
      OR r.display_name IS NULL
      OR length(trim(r.display_name)) = 0
      OR r.priority IS NULL
      OR r.priority < 0
  );

DELETE FROM roles r
WHERE r.is_system_role IS TRUE
  AND (
      r.name IS NULL
      OR r.name !~ '^[a-z][a-z0-9_]*$'
      OR r.display_name IS NULL
      OR length(trim(r.display_name)) = 0
      OR r.priority IS NULL
      OR r.priority < 0
  );

-- Quarantine and remove invalid system-owned permissions before reseeding.
INSERT INTO app.invalid_data_quarantine (
    source_table,
    source_key,
    invalid_reason,
    original_data
)
SELECT
    'public.permissions',
    p.id::TEXT,
    concat_ws(
        '; ',
        CASE WHEN p.name IS NULL OR p.name !~ '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$' THEN 'Invalid permission name' END,
        CASE WHEN p.resource IS NULL OR length(trim(p.resource)) = 0 THEN 'Missing resource' END,
        CASE WHEN p.action IS NULL OR p.action NOT IN (
            'create', 'read', 'update', 'delete', 'manage', 'execute', 'void', 'refund',
            'write', 'verify', 'review', 'assign', 'approve', 'reject', 'escalate',
            'override', 'export', 'download', 'reveal', 'request_resubmission',
            'view_provider_raw', 'manage_reason_codes', 'manage_risk_rules'
        ) THEN 'Invalid action' END
    ),
    to_jsonb(p)
FROM permissions p
WHERE p.is_system_permission IS TRUE
  AND (
      p.name IS NULL
      OR p.name !~ '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$'
      OR p.resource IS NULL
      OR length(trim(p.resource)) = 0
      OR p.action IS NULL
      OR p.action NOT IN (
          'create', 'read', 'update', 'delete', 'manage', 'execute', 'void', 'refund',
          'write', 'verify', 'review', 'assign', 'approve', 'reject', 'escalate',
          'override', 'export', 'download', 'reveal', 'request_resubmission',
          'view_provider_raw', 'manage_reason_codes', 'manage_risk_rules'
      )
  );

DELETE FROM permissions p
WHERE p.is_system_permission IS TRUE
  AND (
      p.name IS NULL
      OR p.name !~ '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$'
      OR p.resource IS NULL
      OR length(trim(p.resource)) = 0
      OR p.action IS NULL
      OR p.action NOT IN (
          'create', 'read', 'update', 'delete', 'manage', 'execute', 'void', 'refund',
          'write', 'verify', 'review', 'assign', 'approve', 'reject', 'escalate',
          'override', 'export', 'download', 'reveal', 'request_resubmission',
          'view_provider_raw', 'manage_reason_codes', 'manage_risk_rules'
      )
  );

-- Quarantine and remove malformed system route policies before reseeding.
INSERT INTO app.invalid_data_quarantine (
    source_table,
    source_key,
    invalid_reason,
    original_data
)
SELECT
    'public.route_access_policies',
    p.route_id,
    concat_ws(
        '; ',
        CASE WHEN p.route_id IS NULL OR p.route_id !~ '^[a-z][a-z0-9_-]*$' THEN 'Invalid route id' END,
        CASE WHEN p.path IS NULL OR length(trim(p.path)) = 0 THEN 'Missing path' END,
        CASE WHEN jsonb_typeof(p.required_permissions) IS DISTINCT FROM 'array' THEN 'Invalid required_permissions' END,
        CASE WHEN jsonb_typeof(p.required_roles) IS DISTINCT FROM 'array' THEN 'Invalid required_roles' END,
        CASE WHEN jsonb_typeof(p.excluded_roles) IS DISTINCT FROM 'array' THEN 'Invalid excluded_roles' END,
        CASE WHEN jsonb_typeof(p.nav_permissions) IS DISTINCT FROM 'array' THEN 'Invalid nav_permissions' END,
        CASE WHEN jsonb_typeof(p.nav_roles) IS DISTINCT FROM 'array' THEN 'Invalid nav_roles' END,
        CASE WHEN jsonb_typeof(p.nav_excluded_roles) IS DISTINCT FROM 'array' THEN 'Invalid nav_excluded_roles' END
    ),
    to_jsonb(p)
FROM route_access_policies p
WHERE p.is_system_policy IS TRUE
  AND (
      p.route_id IS NULL
      OR p.route_id !~ '^[a-z][a-z0-9_-]*$'
      OR p.path IS NULL
      OR length(trim(p.path)) = 0
      OR jsonb_typeof(p.required_permissions) IS DISTINCT FROM 'array'
      OR jsonb_typeof(p.required_roles) IS DISTINCT FROM 'array'
      OR jsonb_typeof(p.excluded_roles) IS DISTINCT FROM 'array'
      OR jsonb_typeof(p.nav_permissions) IS DISTINCT FROM 'array'
      OR jsonb_typeof(p.nav_roles) IS DISTINCT FROM 'array'
      OR jsonb_typeof(p.nav_excluded_roles) IS DISTINCT FROM 'array'
  );

DELETE FROM route_access_policies p
WHERE p.is_system_policy IS TRUE
  AND (
      p.route_id IS NULL
      OR p.route_id !~ '^[a-z][a-z0-9_-]*$'
      OR p.path IS NULL
      OR length(trim(p.path)) = 0
      OR jsonb_typeof(p.required_permissions) IS DISTINCT FROM 'array'
      OR jsonb_typeof(p.required_roles) IS DISTINCT FROM 'array'
      OR jsonb_typeof(p.excluded_roles) IS DISTINCT FROM 'array'
      OR jsonb_typeof(p.nav_permissions) IS DISTINCT FROM 'array'
      OR jsonb_typeof(p.nav_roles) IS DISTINCT FROM 'array'
      OR jsonb_typeof(p.nav_excluded_roles) IS DISTINCT FROM 'array'
  );

\echo '[bootstrap 1/2] System configuration, roles & admin...';
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
('housekeeping', 'Housekeeping', 'Room cleaning and maintenance operations', true, 45),
('staff', 'Staff', 'Basic hotel staff access', true, 40),
('guest', 'Guest', 'Guest user access', true, 20),
('compliance_admin', 'Compliance Administrator', 'Compliance administration and eKYC oversight', true, 90),
('ekyc_reviewer', 'eKYC Reviewer', 'Reviews and actions assigned eKYC applications', true, 70),
('senior_reviewer', 'Senior Reviewer', 'Second-level eKYC review and high-risk approvals', true, 75),
('auditor', 'Auditor', 'Read-only audit and compliance access', true, 65),
('support_readonly', 'Read-only Support', 'Read-only operational support access', true, 30)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    is_system_role = EXCLUDED.is_system_role,
    priority = EXCLUDED.priority,
    updated_at = CURRENT_TIMESTAMP
WHERE roles.display_name IS DISTINCT FROM EXCLUDED.display_name
   OR roles.description IS DISTINCT FROM EXCLUDED.description
   OR roles.is_system_role IS DISTINCT FROM EXCLUDED.is_system_role
   OR roles.priority IS DISTINCT FROM EXCLUDED.priority;

-- ============================================================================
-- PERMISSIONS
-- ============================================================================

ALTER TABLE permissions DROP CONSTRAINT IF EXISTS valid_action;
ALTER TABLE permissions ADD CONSTRAINT valid_action
    CHECK (action IN (
        'create', 'read', 'update', 'delete', 'manage', 'execute', 'void', 'refund',
        'write', 'verify', 'review', 'assign', 'approve', 'reject', 'escalate',
        'override', 'export', 'download', 'reveal', 'request_resubmission',
        'view_provider_raw', 'manage_reason_codes', 'manage_risk_rules'
    ));

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
('housekeeping:read', 'housekeeping', 'read', 'View housekeeping tasks and board', true),
('housekeeping:create', 'housekeeping', 'create', 'Create housekeeping tasks', true),
('housekeeping:update', 'housekeeping', 'update', 'Update housekeeping task status and assignments', true),
('housekeeping:manage', 'housekeeping', 'manage', 'Full housekeeping management', true),
('maintenance:read', 'maintenance', 'read', 'View maintenance tickets', true),
('maintenance:write', 'maintenance', 'write', 'Create and update maintenance tickets', true),
('maintenance:manage', 'maintenance', 'manage', 'Full maintenance management', true),
('navigation_housekeeping:read', 'navigation:housekeeping', 'read', 'Show Housekeeping navigation', true),
('support:read', 'support', 'read', 'View guest support conversations', true),
('support:write', 'support', 'write', 'Reply to and resolve assigned guest support conversations', true),
('support:assign', 'support', 'assign', 'Claim, assign, and hand off guest support conversations', true),
('support:escalate', 'support', 'escalate', 'Escalate guest support conversations', true),
('support:manage', 'support', 'manage', 'Full guest support management', true),
('navigation_support:read', 'navigation:support', 'read', 'Show Support navigation', true),
('bookings:create', 'bookings', 'create', 'Create new bookings', true),
('bookings:read', 'bookings', 'read', 'View bookings', true),
('bookings:update', 'bookings', 'update', 'Update bookings', true),
('bookings:delete', 'bookings', 'delete', 'Cancel bookings', true),
('bookings:manage', 'bookings', 'manage', 'Full booking management', true),
('companies:read', 'companies', 'read', 'View corporate billing accounts', true),
('companies:create', 'companies', 'create', 'Create corporate billing accounts', true),
('companies:update', 'companies', 'update', 'Update corporate billing accounts', true),
('companies:delete', 'companies', 'delete', 'Delete corporate billing accounts', true),
('companies:manage', 'companies', 'manage', 'Full corporate billing account management', true),
('guests:create', 'guests', 'create', 'Create guest profiles', true),
('guests:read', 'guests', 'read', 'View guest information', true),
('guests:update', 'guests', 'update', 'Update guest information', true),
('guests:delete', 'guests', 'delete', 'Delete guest profiles', true),
('guests:manage', 'guests', 'manage', 'Full guest management', true),
('payments:create', 'payments', 'create', 'Process payments', true),
('payments:read', 'payments', 'read', 'View payment information', true),
('payments:update', 'payments', 'update', 'Update payments', true),
('payments:delete', 'payments', 'delete', 'Delete payment records', true),
('payments:refund', 'payments', 'refund', 'Refund and revert deposit payments', true),
('payments:manage', 'payments', 'manage', 'Full payment management', true),
('ledgers:read', 'ledgers', 'read', 'View customer ledger entries and payments', true),
('ledgers:create', 'ledgers', 'create', 'Create customer ledger entries and record ledger payments', true),
('ledgers:update', 'ledgers', 'update', 'Update customer ledger entries and payment dates', true),
('ledgers:void', 'ledgers', 'void', 'Void customer ledger entries and create reversals', true),
('ledgers:manage', 'ledgers', 'manage', 'Full customer ledger management', true),
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
('audit:read', 'audit', 'read', 'View audit logs', true),
('night_audit:read', 'night_audit', 'read', 'View night audit data', true),
('night_audit:execute', 'night_audit', 'execute', 'Execute night audit', true),
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
    description = EXCLUDED.description,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    is_system_permission = EXCLUDED.is_system_permission
WHERE permissions.description IS DISTINCT FROM EXCLUDED.description
   OR permissions.resource IS DISTINCT FROM EXCLUDED.resource
   OR permissions.action IS DISTINCT FROM EXCLUDED.action
   OR permissions.is_system_permission IS DISTINCT FROM EXCLUDED.is_system_permission;

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
    'housekeeping:read', 'housekeeping:create', 'housekeeping:update', 'housekeeping:manage',
    'maintenance:read', 'maintenance:write', 'maintenance:manage', 'navigation_housekeeping:read',
    'support:read', 'support:write', 'support:assign', 'support:escalate', 'support:manage',
    'navigation_support:read',
    'payments:manage', 'ledgers:read', 'ledgers:create', 'ledgers:update', 'ledgers:void', 'ledgers:manage',
    'companies:read', 'companies:create', 'companies:update', 'companies:delete', 'companies:manage',
    'services:manage', 'reviews:manage', 'reports:read', 'reports:execute', 'analytics:read'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Receptionist permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'receptionist' AND p.name IN (
    'rooms:read', 'rooms:update', 'bookings:create', 'bookings:read', 'bookings:update',
    'housekeeping:read', 'housekeeping:create', 'housekeeping:update', 'navigation_housekeeping:read',
    'support:read', 'support:write', 'support:assign', 'support:escalate', 'navigation_support:read',
    'guests:create', 'guests:read', 'guests:update', 'guests:manage', 'payments:create', 'payments:read',
    'payments:update', 'payments:delete', 'payments:refund',
    'ledgers:read', 'ledgers:create', 'companies:read', 'companies:create',
    'services:read', 'services:create', 'reviews:read', 'settings:read',
    'analytics:read', 'reports:execute'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Housekeeping permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'housekeeping' AND p.name IN (
    'rooms:read', 'rooms:update',
    'housekeeping:read', 'housekeeping:create', 'housekeeping:update', 'housekeeping:manage',
    'maintenance:read', 'maintenance:write',
    'navigation_housekeeping:read', 'navigation_room_management:read'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Staff permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'staff' AND p.name IN (
    'rooms:read', 'bookings:read', 'guests:read', 'services:read', 'services:create', 'reviews:read',
    'support:read', 'support:write', 'navigation_support:read'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Guest permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'guest' AND p.name IN (
    'rooms:read', 'bookings:create', 'bookings:read', 'reviews:create', 'reviews:read', 'reviews:update'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

-- eKYC compliance roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'compliance_admin' AND p.name IN (
    'ekyc:read', 'ekyc:review', 'ekyc:view_sensitive', 'ekyc:reveal_sensitive',
    'ekyc:download_documents', 'ekyc:assign', 'ekyc:approve', 'ekyc:reject',
    'ekyc:escalate', 'ekyc:request_resubmission', 'ekyc:override',
    'ekyc:export', 'ekyc:manage_reason_codes', 'ekyc:manage_risk_rules',
    'ekyc:view_provider_raw', 'navigation_ekyc_admin:read', 'audit:read'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'ekyc_reviewer' AND p.name IN (
    'ekyc:read', 'ekyc:review', 'ekyc:download_documents', 'ekyc:assign',
    'ekyc:approve', 'ekyc:reject', 'ekyc:escalate',
    'ekyc:request_resubmission', 'navigation_ekyc_admin:read'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'senior_reviewer' AND p.name IN (
    'ekyc:read', 'ekyc:review', 'ekyc:view_sensitive', 'ekyc:download_documents',
    'ekyc:assign', 'ekyc:approve', 'ekyc:reject', 'ekyc:escalate',
    'ekyc:request_resubmission', 'ekyc:override', 'navigation_ekyc_admin:read'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'auditor' AND p.name IN (
    'ekyc:read', 'ekyc:export', 'navigation_ekyc_admin:read', 'audit:read'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'support_readonly' AND p.name IN (
    'ekyc:read', 'navigation_ekyc_admin:read', 'support:read', 'navigation_support:read'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

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
    is_navigation,
    is_system_policy
)
VALUES (
    'housekeeping',
    '/housekeeping',
    'Housekeeping',
    'operations',
    '["housekeeping:read"]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["navigation_housekeeping:read","housekeeping:read"]'::jsonb,
    '[]'::jsonb,
    '["guest"]'::jsonb,
    true,
    true
)
ON CONFLICT (route_id) DO UPDATE SET
    path = EXCLUDED.path,
    nav_label = EXCLUDED.nav_label,
    nav_group = EXCLUDED.nav_group,
    required_permissions = EXCLUDED.required_permissions,
    required_roles = EXCLUDED.required_roles,
    excluded_roles = EXCLUDED.excluded_roles,
    nav_permissions = EXCLUDED.nav_permissions,
    nav_roles = EXCLUDED.nav_roles,
    nav_excluded_roles = EXCLUDED.nav_excluded_roles,
    is_navigation = EXCLUDED.is_navigation,
    is_system_policy = EXCLUDED.is_system_policy,
    updated_at = CURRENT_TIMESTAMP;

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
    is_navigation,
    is_system_policy
)
VALUES (
    'support',
    '/support',
    'Support',
    'operations',
    '["support:read"]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["navigation_support:read","support:read"]'::jsonb,
    '[]'::jsonb,
    '["guest"]'::jsonb,
    true,
    true
)
ON CONFLICT (route_id) DO UPDATE SET
    path = EXCLUDED.path,
    nav_label = EXCLUDED.nav_label,
    nav_group = EXCLUDED.nav_group,
    required_permissions = EXCLUDED.required_permissions,
    required_roles = EXCLUDED.required_roles,
    excluded_roles = EXCLUDED.excluded_roles,
    nav_permissions = EXCLUDED.nav_permissions,
    nav_roles = EXCLUDED.nav_roles,
    nav_excluded_roles = EXCLUDED.nav_excluded_roles,
    is_navigation = EXCLUDED.is_navigation,
    is_system_policy = EXCLUDED.is_system_policy,
    updated_at = CURRENT_TIMESTAMP;

-- ============================================================================
-- ADMIN USERS
-- Seeded accounts use a non-recoverable placeholder password hash.
-- Set an initial password explicitly with: cargo run --bin fix_password -- <username> <new-password>
-- ============================================================================

INSERT INTO users (id, username, email, password_hash, full_name, is_active, is_verified, is_super_admin, created_at, updated_at)
VALUES (1000, 'admin', 'admin@hotel.com', '$2b$12$YP3zIgLP0ClHE6BmGXRfOO5x6PqgBgeAUEPw7m6GIXKh0GyIPZKfa',
    'System Administrator', true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (username) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    is_active = EXCLUDED.is_active,
    is_verified = EXCLUDED.is_verified,
    is_super_admin = EXCLUDED.is_super_admin,
    updated_at = CURRENT_TIMESTAMP
WHERE users.email IS DISTINCT FROM EXCLUDED.email
   OR users.full_name IS DISTINCT FROM EXCLUDED.full_name
   OR users.is_active IS DISTINCT FROM EXCLUDED.is_active
   OR users.is_verified IS DISTINCT FROM EXCLUDED.is_verified
   OR users.is_super_admin IS DISTINCT FROM EXCLUDED.is_super_admin;

-- Reset sequence before inserting more users
SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000) + 1, false);

INSERT INTO users (username, email, password_hash, full_name, is_active, is_verified, is_super_admin, created_at)
VALUES ('superadmin', 'superadmin@hotel.local', '$2b$12$YP3zIgLP0ClHE6BmGXRfOO5x6PqgBgeAUEPw7m6GIXKh0GyIPZKfa',
    'Super Administrator', true, true, true, CURRENT_TIMESTAMP)
ON CONFLICT (username) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    is_active = EXCLUDED.is_active,
    is_verified = EXCLUDED.is_verified,
    is_super_admin = true,
    updated_at = CURRENT_TIMESTAMP
WHERE users.email IS DISTINCT FROM EXCLUDED.email
   OR users.full_name IS DISTINCT FROM EXCLUDED.full_name
   OR users.is_active IS DISTINCT FROM EXCLUDED.is_active
   OR users.is_verified IS DISTINCT FROM EXCLUDED.is_verified
   OR users.is_super_admin IS DISTINCT FROM true;

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
('auto_checkin_requires_ekyc', 'true', 'boolean', 'frontdesk', 'Require approved guest eKYC before scheduled auto check-in', false),
('check_in_time', '15:00', 'string', 'general', 'Standard check-in time', true),
('check_out_time', '11:00', 'string', 'general', 'Standard check-out time', true),
('night_shift_time', '23:00', 'string', 'operations', 'Scheduled night audit posting time', false),
('currency', 'USD', 'string', 'general', 'Default currency code', true),
('timezone', 'Asia/Kuala_Lumpur', 'string', 'general', 'Hotel timezone', false),
('deposit_amount', '50', 'number', 'payments', 'Default room card or check-in deposit amount', false),
('tourism_tax_rate', '10', 'number', 'tax', 'Tourism tax amount charged per night for foreign guests', false),
('default_payment_terms_days', '30', 'number', 'ledger', 'Default ledger due-date offset in days when a company has no payment terms', false),
('max_login_attempts', '5', 'number', 'security', 'Maximum failed login attempts before lockout', false),
('session_timeout', '3600', 'number', 'security', 'Session timeout in seconds', false),
('enable_2fa', 'false', 'boolean', 'security', 'Enable two-factor authentication', false),
('enable_email_verification', 'true', 'boolean', 'security', 'Require email verification', false),
('totp_issuer_name', 'Hotel Management System', 'string', 'security', 'Issuer name shown in authenticator apps during TOTP setup', false),
('passkey_relying_party_name', 'Hotel Management System', 'string', 'security', 'Display name shown by passkey authenticators during registration', false),
('rate_codes', '["RACK","OVR","CORP","GOVT","WKII","PKG","GRP","AAA","PROMO"]', 'json', 'rates', 'Available rate codes', true),
('market_codes', '["WKII","CORP","GOVT","OTA","DIRECT","GROUP","EVENTS","LEISURE"]', 'json', 'sales', 'Market segment codes', true),
('booking_channels', '[{"name":"Booking.com","abbreviation":"B.C"},{"name":"Agoda","abbreviation":"A.C"},{"name":"Traveloka","abbreviation":"T.C"},{"name":"Expedia","abbreviation":"E.C"},{"name":"Hotels.com","abbreviation":"H.C"},{"name":"Airbnb","abbreviation":"AB"},{"name":"Trip.com","abbreviation":"TR"},{"name":"Direct Website","abbreviation":"DW"},{"name":"Other OTA","abbreviation":"OT"}]', 'json', 'sales', 'Online and direct booking channels available to front desk workflows', true),
('payment_methods', '["Cash","Visa Card","Master Card","Debit Card","Sarawak Pay","American Express","Bank Transfer","E-Wallet","Other"]', 'json', 'payments', 'Payment methods available to walk-in and payment workflows', true),
('report_font_size', '14', 'number', 'reports', 'Base font size in pixels for generated report previews and print output', false),
('report_font_family', 'Arial, Helvetica, sans-serif', 'string', 'reports', 'Font family for generated report previews and print output', false),
('report_heading_font_size', '24', 'number', 'reports', 'Large heading and KPI font size in pixels for generated reports', false),
('report_section_heading_font_size', '18', 'number', 'reports', 'Section heading font size in pixels for generated reports', false),
('report_table_font_size', '14', 'number', 'reports', 'Table font size in pixels for generated reports', false),
('report_caption_font_size', '13', 'number', 'reports', 'Caption and secondary label font size in pixels for generated reports', false),
('report_chip_font_size', '12', 'number', 'reports', 'Status chip font size in pixels for generated reports', false),
('support_enabled', 'true', 'boolean', 'support', 'Enable guest portal support conversations', false),
('support_categories', '["booking","stay","billing","loyalty","technical","other"]', 'json', 'support', 'Guest-selectable support conversation categories', false),
('support_first_response_low_minutes', '240', 'number', 'support', 'First-response SLA for low priority support conversations in minutes', false),
('support_first_response_normal_minutes', '60', 'number', 'support', 'First-response SLA for normal priority support conversations in minutes', false),
('support_first_response_high_minutes', '15', 'number', 'support', 'First-response SLA for high priority support conversations in minutes', false),
('support_first_response_urgent_minutes', '5', 'number', 'support', 'First-response SLA for urgent priority support conversations in minutes', false),
('support_resolution_low_minutes', '1440', 'number', 'support', 'Resolution SLA for low priority support conversations in minutes', false),
('support_resolution_normal_minutes', '480', 'number', 'support', 'Resolution SLA for normal priority support conversations in minutes', false),
('support_resolution_high_minutes', '120', 'number', 'support', 'Resolution SLA for high priority support conversations in minutes', false),
('support_resolution_urgent_minutes', '30', 'number', 'support', 'Resolution SLA for urgent priority support conversations in minutes', false),
('support_reopen_window_days', '7', 'number', 'support', 'Days a resolved guest support conversation can be reopened by its guest', false),
('support_auto_close_resolved_days', '7', 'number', 'support', 'Days after resolution before support conversations may be automatically closed', false),
('guest_titles', '["Mr","Mrs","Ms","Miss","Dr","Prof","Rev"]', 'json', 'guests', 'Guest title options', true)
-- NOTE: `value` is intentionally NOT updated here. This seed re-runs on every
-- desktop restart (see hotel-desktop/src-tauri/src/postgres.rs::run_database_setup),
-- so overwriting `value` would revert any user-edited setting back to the default
-- on every restart. New keys are still inserted; existing rows keep their value
-- while metadata (label/category/type/visibility) stays in sync with the seed.
ON CONFLICT (key) DO UPDATE SET
    value_type = EXCLUDED.value_type,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    is_public = EXCLUDED.is_public,
    updated_at = CURRENT_TIMESTAMP
WHERE system_settings.value_type IS DISTINCT FROM EXCLUDED.value_type
   OR system_settings.category IS DISTINCT FROM EXCLUDED.category
   OR system_settings.description IS DISTINCT FROM EXCLUDED.description
   OR system_settings.is_public IS DISTINCT FROM EXCLUDED.is_public;

-- ============================================================================
-- BOOKING CHANNELS
-- ============================================================================

INSERT INTO booking_channels
    (name, channel_type, default_commission_type, default_commission_value, default_commission_scope, is_active)
VALUES
    ('Direct', 'direct', 'none', 0, 'per_booking', true),
    ('Walk-in', 'walk_in', 'none', 0, 'per_booking', true),
    ('Phone', 'phone', 'none', 0, 'per_booking', true),
    ('Direct Website', 'website', 'none', 0, 'per_booking', true),
    ('Booking.com', 'ota', 'none', 0, 'per_booking', true),
    ('Agoda', 'ota', 'none', 0, 'per_booking', true),
    ('Traveloka', 'ota', 'none', 0, 'per_booking', true),
    ('Expedia', 'ota', 'none', 0, 'per_booking', true),
    ('Hotels.com', 'ota', 'none', 0, 'per_booking', true),
    ('Airbnb', 'ota', 'none', 0, 'per_booking', true),
    ('Trip.com', 'ota', 'none', 0, 'per_booking', true),
    ('Other OTA', 'ota', 'none', 0, 'per_booking', true)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- AUDIT LOG
-- ============================================================================

INSERT INTO audit_logs (user_id, action, resource_type, details)
SELECT 1000, 'system.seed', 'system', jsonb_build_object('message', 'System seed data loaded', 'timestamp', CURRENT_TIMESTAMP)
WHERE NOT EXISTS (
    SELECT 1
    FROM audit_logs
    WHERE user_id = 1000
      AND action = 'system.seed'
      AND resource_type = 'system'
);

DO $$ BEGIN RAISE NOTICE 'System configuration loaded: roles, permissions, admin users, settings'; END $$;

\echo '[bootstrap 2/2] Room types, rooms & rate plans...';
-- ============================================================================
-- SEED 03: ROOM TYPES, ROOMS & RATE PLANS
-- ============================================================================
-- Description: Room inventory and pricing configuration
-- ============================================================================

-- ============================================================================
-- ROOM TYPES
-- ============================================================================

-- Room types are user-editable business data, not a system invariant. Seed the
-- sample catalog only on a fresh database (empty table). On an existing install
-- we must never re-insert (the name/code unique constraints would collide with
-- renamed/recoded types) nor UPDATE (that would clobber the operator's own
-- pricing/occupancy/names). See the bootstrap validation note below.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM room_types) THEN
        INSERT INTO room_types (name, code, description, max_occupancy, base_price, size_sqm, bed_type, bed_count, allows_extra_bed, max_extra_beds, extra_bed_charge, sort_order)
        VALUES
            ('Standard Room', 'STD', 'Comfortable room with essential amenities', 2, 150.00, 25.0, 'Queen', 1, false, 0, 0.00, 1),
            ('Deluxe Room', 'DLX', 'Spacious room with premium amenities', 3, 250.00, 35.0, 'King', 1, true, 1, 50.00, 2),
            ('Suite', 'STE', 'Luxury suite with separate living area', 4, 450.00, 55.0, 'King', 1, true, 2, 75.00, 3),
            ('Family Room', 'FAM', 'Large room perfect for families with children', 6, 350.00, 45.0, 'Queen', 2, true, 2, 40.00, 4);
    END IF;
END $$;

-- ============================================================================
-- ROOMS - 16 rooms across 4 floors
-- ============================================================================

-- Sample rooms are user-editable business data, not a system invariant. Seed the
-- sample catalog only on a fresh database (no rooms yet). On an existing install
-- the operator already manages their own rooms, and their room_types may use
-- different codes (e.g. a restored backup), so re-seeding here must be skipped.
-- Each insert JOINs room_types (instead of a scalar subquery) so a missing code
-- yields zero rows rather than a NULL room_type_id that violates NOT NULL and
-- aborts the whole bootstrap transaction.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM rooms) THEN
        -- Floor 1: Standard Rooms (101-105)
        INSERT INTO rooms (room_number, room_type_id, floor, status)
        SELECT '10' || ROW_NUMBER() OVER(), rt.id, 1, 'available'
        FROM generate_series(1, 5)
        CROSS JOIN (SELECT id FROM room_types WHERE code = 'STD' LIMIT 1) rt
        ON CONFLICT (room_number) DO NOTHING;

        -- Floor 2: Deluxe Rooms (201-205)
        INSERT INTO rooms (room_number, room_type_id, floor, status)
        SELECT '20' || ROW_NUMBER() OVER(), rt.id, 2, 'available'
        FROM generate_series(1, 5)
        CROSS JOIN (SELECT id FROM room_types WHERE code = 'DLX' LIMIT 1) rt
        ON CONFLICT (room_number) DO NOTHING;

        -- Floor 3: Suites (301-303)
        INSERT INTO rooms (room_number, room_type_id, floor, status)
        SELECT '30' || ROW_NUMBER() OVER(), rt.id, 3, 'available'
        FROM generate_series(1, 3)
        CROSS JOIN (SELECT id FROM room_types WHERE code = 'STE' LIMIT 1) rt
        ON CONFLICT (room_number) DO NOTHING;

        -- Floor 4: Family Rooms (401-403)
        INSERT INTO rooms (room_number, room_type_id, floor, status)
        SELECT '40' || ROW_NUMBER() OVER(), rt.id, 4, 'available'
        FROM generate_series(1, 3)
        CROSS JOIN (SELECT id FROM room_types WHERE code = 'FAM' LIMIT 1) rt
        ON CONFLICT (room_number) DO NOTHING;
    END IF;
END $$;

-- ============================================================================
-- RATE PLANS
-- ============================================================================

INSERT INTO rate_plans (name, code, description, plan_type, adjustment_type, adjustment_value, valid_from, valid_to, is_active, priority, created_by)
VALUES
    ('Complimentary Rate', 'COMP', 'Complimentary rate for special guests, VIPs, and promotional purposes', 'promotional', 'override', 0.00, '2023-01-01', '2026-12-31', true, 100, 1000),
    ('Standard Rack Rate', 'RACK', 'Standard published rate for walk-in guests', 'standard', 'override', NULL, '2023-01-01', '2026-12-31', true, 50, 1000),
    ('Corporate Rate', 'CORP', 'Discounted rate for corporate clients and business travelers', 'corporate', 'percentage', -20.00, '2023-01-01', '2026-12-31', true, 60, 1000),
    ('Weekend Rate', 'WKND', 'Special rate for weekend stays (Friday-Sunday)', 'seasonal', 'percentage', 15.00, '2023-01-01', '2026-12-31', true, 55, 1000),
    ('Early Bird Rate', 'EARLY', 'Discounted rate for bookings made 30+ days in advance', 'promotional', 'percentage', -30.00, '2023-01-01', '2026-12-31', true, 70, 1000),
    ('Group Rate', 'GROUP', 'Special rate for group bookings (5+ rooms)', 'group', 'percentage', -25.00, '2023-01-01', '2026-12-31', true, 65, 1000)
ON CONFLICT (code) DO NOTHING;

-- Configure Weekend Rate (applies only Fri-Sun)
UPDATE rate_plans SET
    applies_monday = false, applies_tuesday = false, applies_wednesday = false, applies_thursday = false,
    applies_friday = true, applies_saturday = true, applies_sunday = true
WHERE code = 'WKND'
  AND (
      applies_monday IS DISTINCT FROM false
      OR applies_tuesday IS DISTINCT FROM false
      OR applies_wednesday IS DISTINCT FROM false
      OR applies_thursday IS DISTINCT FROM false
      OR applies_friday IS DISTINCT FROM true
      OR applies_saturday IS DISTINCT FROM true
      OR applies_sunday IS DISTINCT FROM true
  );

-- Configure Early Bird Rate (30+ days advance booking)
UPDATE rate_plans
SET min_advance_booking = 30
WHERE code = 'EARLY'
  AND min_advance_booking IS DISTINCT FROM 30;

-- Configure Group Rate
UPDATE rate_plans
SET min_nights = 1
WHERE code = 'GROUP'
  AND min_nights IS DISTINCT FROM 1;

-- ============================================================================
-- ROOM RATES - Prices for each rate plan and room type combination
-- ============================================================================

DO $$
DECLARE
    comp_id BIGINT; rack_id BIGINT; corp_id BIGINT; wknd_id BIGINT; early_id BIGINT; group_id BIGINT;
    std_id BIGINT; dlx_id BIGINT; ste_id BIGINT; fam_id BIGINT;
BEGIN
    -- Get rate plan IDs
    SELECT id INTO comp_id FROM rate_plans WHERE code = 'COMP' LIMIT 1;
    SELECT id INTO rack_id FROM rate_plans WHERE code = 'RACK' LIMIT 1;
    SELECT id INTO corp_id FROM rate_plans WHERE code = 'CORP' LIMIT 1;
    SELECT id INTO wknd_id FROM rate_plans WHERE code = 'WKND' LIMIT 1;
    SELECT id INTO early_id FROM rate_plans WHERE code = 'EARLY' LIMIT 1;
    SELECT id INTO group_id FROM rate_plans WHERE code = 'GROUP' LIMIT 1;

    -- Get room type IDs
    SELECT id INTO std_id FROM room_types WHERE code = 'STD' LIMIT 1;
    SELECT id INTO dlx_id FROM room_types WHERE code = 'DLX' LIMIT 1;
    SELECT id INTO ste_id FROM room_types WHERE code = 'STE' LIMIT 1;
    SELECT id INTO fam_id FROM room_types WHERE code = 'FAM' LIMIT 1;

    -- Each rate insert filters out room types that don't exist on this database
    -- (NULL *_id). Without the WHERE filter a missing code (e.g. a restored
    -- backup whose room_types use different codes) would insert a NULL
    -- room_type_id and abort the whole bootstrap transaction.

    -- COMPLIMENTARY RATE ($0 for all room types)
    IF comp_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        SELECT comp_id, rt.id, rt.price, '2023-01-01', '2026-12-31'
        FROM (VALUES (std_id, 0.00), (dlx_id, 0.00), (ste_id, 0.00), (fam_id, 0.00)) AS rt(id, price)
        WHERE rt.id IS NOT NULL
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- RACK RATE (Base prices: STD $150, DLX $250, STE $450, FAM $350)
    IF rack_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        SELECT rack_id, rt.id, rt.price, '2023-01-01', '2026-12-31'
        FROM (VALUES (std_id, 150.00), (dlx_id, 250.00), (ste_id, 450.00), (fam_id, 350.00)) AS rt(id, price)
        WHERE rt.id IS NOT NULL
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- CORPORATE RATE (20% off base)
    IF corp_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        SELECT corp_id, rt.id, rt.price, '2023-01-01', '2026-12-31'
        FROM (VALUES (std_id, 120.00), (dlx_id, 200.00), (ste_id, 360.00), (fam_id, 280.00)) AS rt(id, price)
        WHERE rt.id IS NOT NULL
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- WEEKEND RATE (15% premium)
    IF wknd_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        SELECT wknd_id, rt.id, rt.price, '2023-01-01', '2026-12-31'
        FROM (VALUES (std_id, 172.50), (dlx_id, 287.50), (ste_id, 517.50), (fam_id, 402.50)) AS rt(id, price)
        WHERE rt.id IS NOT NULL
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- EARLY BIRD RATE (30% off base)
    IF early_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        SELECT early_id, rt.id, rt.price, '2023-01-01', '2026-12-31'
        FROM (VALUES (std_id, 105.00), (dlx_id, 175.00), (ste_id, 315.00), (fam_id, 245.00)) AS rt(id, price)
        WHERE rt.id IS NOT NULL
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;

    -- GROUP RATE (25% off base)
    IF group_id IS NOT NULL THEN
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        SELECT group_id, rt.id, rt.price, '2023-01-01', '2026-12-31'
        FROM (VALUES (std_id, 112.50), (dlx_id, 187.50), (ste_id, 337.50), (fam_id, 262.50)) AS rt(id, price)
        WHERE rt.id IS NOT NULL
        ON CONFLICT (rate_plan_id, room_type_id, effective_from) DO NOTHING;
    END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'Rooms & rates loaded: 4 room types, 16 rooms, 6 rate plans with room rates'; END $$;

-- Normalize ownership markers for canonical seed-managed records after legacy
-- upserts that may not update the marker on conflict.
UPDATE roles r
SET is_system_role = TRUE
WHERE EXISTS (
    SELECT 1
    FROM expected_system_roles expected
    WHERE expected.name = r.name
)
AND r.is_system_role IS DISTINCT FROM TRUE;

UPDATE permissions p
SET is_system_permission = TRUE
WHERE EXISTS (
    SELECT 1
    FROM expected_system_permissions expected
    WHERE expected.name = p.name
)
AND p.is_system_permission IS DISTINCT FROM TRUE;

UPDATE route_access_policies p
SET is_system_policy = TRUE
WHERE EXISTS (
    SELECT 1
    FROM expected_route_access_policies expected
    WHERE expected.route_id = p.route_id
)
AND p.is_system_policy IS DISTINCT FROM TRUE;

-- Remove obsolete permissions explicitly marked as system-owned.
INSERT INTO app.invalid_data_quarantine (
    source_table,
    source_key,
    invalid_reason,
    original_data
)
SELECT
    'public.permissions',
    p.id::TEXT,
    'Obsolete system seed record',
    to_jsonb(p)
FROM permissions p
WHERE p.is_system_permission IS TRUE
  AND NOT EXISTS (
      SELECT 1
      FROM expected_system_permissions expected
      WHERE expected.name = p.name
  );

DELETE FROM permissions p
WHERE p.is_system_permission IS TRUE
  AND NOT EXISTS (
      SELECT 1
      FROM expected_system_permissions expected
      WHERE expected.name = p.name
  );

-- Obsolete system roles with live assignments are quarantined but preserved.
INSERT INTO app.invalid_data_quarantine (
    source_table,
    source_key,
    invalid_reason,
    original_data
)
SELECT
    'public.roles',
    r.id::TEXT,
    CASE
        WHEN EXISTS (SELECT 1 FROM user_roles ur WHERE ur.role_id = r.id)
            THEN 'Obsolete system seed record retained because users are assigned'
        ELSE 'Obsolete system seed record'
    END,
    to_jsonb(r)
FROM roles r
WHERE r.is_system_role IS TRUE
  AND NOT EXISTS (
      SELECT 1
      FROM expected_system_roles expected
      WHERE expected.name = r.name
  );

DELETE FROM roles r
WHERE r.is_system_role IS TRUE
  AND NOT EXISTS (
      SELECT 1
      FROM expected_system_roles expected
      WHERE expected.name = r.name
  )
  AND NOT EXISTS (
      SELECT 1
      FROM user_roles ur
      WHERE ur.role_id = r.id
  );

-- Remove obsolete route policies explicitly marked as system-owned.
INSERT INTO app.invalid_data_quarantine (
    source_table,
    source_key,
    invalid_reason,
    original_data
)
SELECT
    'public.route_access_policies',
    p.route_id,
    'Obsolete system seed record',
    to_jsonb(p)
FROM route_access_policies p
WHERE p.is_system_policy IS TRUE
  AND NOT EXISTS (
      SELECT 1
      FROM expected_route_access_policies expected
      WHERE expected.route_id = p.route_id
  );

DELETE FROM route_access_policies p
WHERE p.is_system_policy IS TRUE
  AND NOT EXISTS (
      SELECT 1
      FROM expected_route_access_policies expected
      WHERE expected.route_id = p.route_id
  );

-- Final integrity checks.
DO $$
DECLARE
    invalid_count INTEGER;
    missing_seed_count INTEGER;
    unknown_route_permission_count INTEGER;
    unknown_route_role_count INTEGER;
    obsolete_assigned_role_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO invalid_count
    FROM (
        SELECT 'roles' AS source_name
        FROM roles r
        WHERE r.is_system_role IS TRUE
          AND (
              r.name !~ '^[a-z][a-z0-9_]*$'
              OR length(trim(r.display_name)) = 0
              OR r.priority < 0
          )
        UNION ALL
        SELECT 'permissions' AS source_name
        FROM permissions p
        WHERE p.is_system_permission IS TRUE
          AND (
              p.name !~ '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$'
              OR length(trim(p.resource)) = 0
              OR p.action NOT IN (
                  'create', 'read', 'update', 'delete', 'manage', 'execute', 'void', 'refund',
                  'write', 'verify', 'review', 'assign', 'approve', 'reject', 'escalate',
                  'override', 'export', 'download', 'reveal', 'request_resubmission',
                  'view_provider_raw', 'manage_reason_codes', 'manage_risk_rules'
              )
          )
        UNION ALL
        SELECT 'route_access_policies' AS source_name
        FROM route_access_policies p
        WHERE p.is_system_policy IS TRUE
          AND (
              p.route_id !~ '^[a-z][a-z0-9_-]*$'
              OR length(trim(p.path)) = 0
              OR jsonb_typeof(p.required_permissions) IS DISTINCT FROM 'array'
              OR jsonb_typeof(p.required_roles) IS DISTINCT FROM 'array'
              OR jsonb_typeof(p.excluded_roles) IS DISTINCT FROM 'array'
              OR jsonb_typeof(p.nav_permissions) IS DISTINCT FROM 'array'
              OR jsonb_typeof(p.nav_roles) IS DISTINCT FROM 'array'
              OR jsonb_typeof(p.nav_excluded_roles) IS DISTINCT FROM 'array'
          )
    ) invalid_records;

    IF invalid_count > 0 THEN
        RAISE EXCEPTION
            'Database bootstrap validation failed: % invalid system-owned records remain',
            invalid_count;
    END IF;

    SELECT COUNT(*)
    INTO missing_seed_count
    FROM (
        SELECT 'role:' || expected.name AS seed_key
        FROM expected_system_roles expected
        WHERE NOT EXISTS (SELECT 1 FROM roles actual WHERE actual.name = expected.name)
        UNION ALL
        SELECT 'permission:' || expected.name AS seed_key
        FROM expected_system_permissions expected
        WHERE NOT EXISTS (SELECT 1 FROM permissions actual WHERE actual.name = expected.name)
        UNION ALL
        SELECT 'setting:' || expected.key AS seed_key
        FROM expected_system_settings expected
        WHERE NOT EXISTS (SELECT 1 FROM system_settings actual WHERE actual.key = expected.key)
        UNION ALL
        -- Room types and rooms are user-editable business data, not system
        -- invariants (see the seed blocks above). An existing/restored property
        -- legitimately renames the sample room types and uses its own room
        -- numbers, so they are intentionally NOT required here. Enforcing the
        -- sample STD/STE/FAM codes or 101-403 room numbers would abort bootstrap
        -- on any real install.
        SELECT 'rate_plan:' || expected.code AS seed_key
        FROM expected_rate_plans expected
        WHERE NOT EXISTS (SELECT 1 FROM rate_plans actual WHERE actual.code = expected.code)
        UNION ALL
        SELECT 'route_policy:' || expected.route_id AS seed_key
        FROM expected_route_access_policies expected
        WHERE NOT EXISTS (SELECT 1 FROM route_access_policies actual WHERE actual.route_id = expected.route_id)
        UNION ALL
        SELECT 'admin_user:admin' AS seed_key
        WHERE NOT EXISTS (SELECT 1 FROM users actual WHERE actual.username = 'admin')
        UNION ALL
        SELECT 'admin_user:superadmin' AS seed_key
        WHERE NOT EXISTS (SELECT 1 FROM users actual WHERE actual.username = 'superadmin')
    ) missing_seed_records;

    IF missing_seed_count > 0 THEN
        RAISE EXCEPTION
            'Database bootstrap validation failed: % required seed records are missing',
            missing_seed_count;
    END IF;

    SELECT COUNT(*)
    INTO unknown_route_permission_count
    FROM route_access_policies policy
    CROSS JOIN LATERAL jsonb_array_elements_text(policy.required_permissions || policy.nav_permissions) route_permission(permission_name)
    LEFT JOIN permissions permission ON permission.name = route_permission.permission_name
    WHERE policy.is_system_policy IS TRUE
      AND permission.id IS NULL;

    IF unknown_route_permission_count > 0 THEN
        RAISE EXCEPTION
            'Database bootstrap validation failed: % route policy permission references are unknown',
            unknown_route_permission_count;
    END IF;

    SELECT COUNT(*)
    INTO unknown_route_role_count
    FROM route_access_policies policy
    CROSS JOIN LATERAL jsonb_array_elements_text(
        policy.required_roles
        || policy.excluded_roles
        || policy.nav_roles
        || policy.nav_excluded_roles
    ) route_role(role_name)
    LEFT JOIN roles role_record ON role_record.name = route_role.role_name
    WHERE policy.is_system_policy IS TRUE
      AND role_record.id IS NULL;

    IF unknown_route_role_count > 0 THEN
        RAISE EXCEPTION
            'Database bootstrap validation failed: % route policy role references are unknown',
            unknown_route_role_count;
    END IF;

    SELECT COUNT(*)
    INTO obsolete_assigned_role_count
    FROM roles r
    WHERE r.is_system_role IS TRUE
      AND NOT EXISTS (
          SELECT 1
          FROM expected_system_roles expected
          WHERE expected.name = r.name
      )
      AND EXISTS (
          SELECT 1
          FROM user_roles ur
          WHERE ur.role_id = r.id
      );

    IF obsolete_assigned_role_count > 0 THEN
        RAISE NOTICE
            'Database bootstrap retained % obsolete system role(s) because users are assigned; review app.invalid_data_quarantine',
            obsolete_assigned_role_count;
    END IF;
END;
$$;

COMMIT;
