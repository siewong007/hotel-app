-- ============================================================================
-- HOTEL APP SEED DATA (V1)
-- ============================================================================
-- Purpose:
-- Run once, immediately after the V1 schema migration.
-- This file owns required/reference data and fresh-install bootstrap records.
-- It is never an application-startup task.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Prevent two deployments from initializing seed data simultaneously.
SELECT pg_advisory_xact_lock(hashtext('hotel_app_v1_fresh_bootstrap'));

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.hotel_schema_revisions
        WHERE generation = 1 AND version = 1
    ) THEN
        RAISE EXCEPTION
            'seed.sql is a one-time V1 installation step and must not run against an existing V1 database';
    END IF;
END;
$$;


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
    ('navigation_housekeeping:read'),
    ('navigation_promotions:read'),
    ('night_audit:execute'),
    ('night_audit:read'),
    ('payments:approve'),
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
    ('promotions:manage'),
    ('promotions:read'),
    ('communications:read'),
    ('communications:compose'),
    ('communications:send'),
    ('communications:manage'),
    ('navigation_communications:read'),
    ('reports:execute'),
    ('reports:read'),
    ('reviews:create'),
    ('reviews:delete'),
    ('reviews:manage'),
    ('reviews:read'),
    ('reviews:update'),
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
    ('teams:assign'),
    ('teams:create'),
    ('teams:delete'),
    ('teams:manage'),
    ('teams:read'),
    ('teams:update'),
    ('users:create'),
    ('users:delete'),
    ('users:manage'),
    ('users:read'),
    ('users:update'),
    ('vouchers:manage'),
    ('vouchers:read');

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

CREATE TEMP TABLE expected_route_access_policies (
    route_id TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO expected_route_access_policies (route_id)
VALUES
    ('audit-log'),
    ('bookings'),
    ('communications'),
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
    ('night-audit'),
    ('online-inventory'),
    ('payment-approvals'),
    ('profile'),
    ('promotions'),
    ('rbac'),
    ('reports'),
    ('room-config'),
    ('room-management'),
    ('settings'),
    ('support'),
    ('teams'),
    ('timeline');

-- Quarantine invalid system-owned roles before canonical upserts.
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

-- Invalid system-owned rows are quarantined but never deleted automatically.
-- The final validation stops the transaction so the retained database can be
-- corrected deliberately without losing role or permission history.
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
            'view_provider_raw', 'manage_reason_codes', 'manage_risk_rules',
            'compose', 'send'
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
          'view_provider_raw', 'manage_reason_codes', 'manage_risk_rules',
          'compose', 'send'
      )
  );

-- Quarantine malformed system route policies without deleting them.
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

\echo '[data] System configuration, roles, permissions, and route policies...';
-- ============================================================================
-- REQUIRED SYSTEM CONFIGURATION, ROLES, PERMISSIONS & ROUTE POLICIES
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

INSERT INTO permissions (name, resource, action, description, is_system_permission) VALUES
-- Gated by live routes but never seeded until now. `audit:export` and the
-- two `loyalty:*` names made their endpoints permanently 403 for EVERY role
-- including super_admin, because the `<resource>:manage` fallback resolves
-- to a name that was equally absent. `rooms:write` and the `permissions:*`
-- four were rescued by their `:manage` sibling, so they worked -- but at a
-- wider privilege than the code declared it needed.
('audit:export', 'audit', 'export', 'Export audit logs', true),
('loyalty:read', 'loyalty', 'read', 'View loyalty programme data', true),
('loyalty:manage', 'loyalty', 'manage', 'Full control over the loyalty programme', true),
('rooms:write', 'rooms', 'write', 'Create or modify rooms', true),
('permissions:create', 'permissions', 'create', 'Create permissions', true),
('permissions:read', 'permissions', 'read', 'View permissions', true),
('permissions:update', 'permissions', 'update', 'Update permissions', true),
('permissions:delete', 'permissions', 'delete', 'Delete permissions', true),
('teams:create', 'teams', 'create', 'Create teams', true),
('teams:read', 'teams', 'read', 'View teams and their membership', true),
('teams:update', 'teams', 'update', 'Update team details', true),
('teams:delete', 'teams', 'delete', 'Delete teams', true),
('teams:assign', 'teams', 'assign', 'Add or remove team members', true),
('teams:manage', 'teams', 'manage', 'Full control over teams', true),
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
('promotions:read', 'promotions', 'read', 'View promotions and promotion performance', true),
('promotions:manage', 'promotions', 'manage', 'Create and manage promotions', true),
('vouchers:read', 'vouchers', 'read', 'View issued vouchers and redemptions', true),
('vouchers:manage', 'vouchers', 'manage', 'Issue, revoke, and manage vouchers', true),
('navigation_promotions:read', 'navigation:promotions', 'read', 'Show Promotions navigation', true),
('communications:read', 'communications', 'read', 'View communications campaigns, templates, and delivery status', true),
('communications:compose', 'communications', 'write', 'Draft and edit email campaigns and templates', true),
('communications:send', 'communications', 'execute', 'Schedule, test-send, and send email campaigns', true),
('communications:manage', 'communications', 'manage', 'Full communications management including automation and suppressions', true),
('navigation_communications:read', 'navigation:communications', 'read', 'Show Communications navigation', true),
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
('payments:approve', 'payments', 'approve', 'Approve or reject pending payments', true),
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
('ekyc:manage', 'ekyc', 'manage', 'Full eKYC administration', true)
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

-- Auditor: the role exists for compliance review, and audit:export is the
-- one action that job needs beyond reading.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'auditor' AND p.name IN ('audit:read', 'audit:export')
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
    'services:manage', 'reviews:manage', 'reports:read', 'reports:execute', 'analytics:read',
    'teams:read', 'teams:assign', 'loyalty:read', 'loyalty:manage'
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
    'analytics:read', 'reports:execute', 'teams:read'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Housekeeping permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'housekeeping' AND p.name IN (
    'rooms:read', 'rooms:update',
    'housekeeping:read', 'housekeeping:create', 'housekeeping:update', 'housekeeping:manage',
    'maintenance:read', 'maintenance:write',
    'navigation_housekeeping:read', 'navigation_room_management:read', 'teams:read'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Staff permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'staff' AND p.name IN (
    'rooms:read', 'bookings:read', 'guests:read', 'services:read', 'services:create', 'reviews:read',
    'support:read', 'support:write', 'navigation_support:read'
) ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Guest permissions. Deliberately no bookings:create/bookings:read: guests use
-- the scoped /api/guest-portal/* surface (see tests/guest_booking_isolation.rs).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'guest' AND p.name IN (
    'rooms:read', 'reviews:create', 'reviews:read', 'reviews:update'
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
    'promotions',
    '/promotions',
    'Promotions',
    'admin',
    '["promotions:read"]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["navigation_promotions:read","promotions:read"]'::jsonb,
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
    'communications',
    '/communications',
    'Communications',
    'admin',
    '["communications:read"]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["navigation_communications:read","communications:read"]'::jsonb,
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
-- Declared expected since V1 but never actually seeded, which the newly-armed
-- missing-seed guard caught. Six backend call sites silently fell back to 8
-- (settings_cache::get_positive_decimal default), while the frontend invoice
-- calculator reads it as `hotelSettings.service_tax_rate / 100` with no
-- fallback -- an absent row yields NaN. 8 matches the backend default, so
-- seeding it changes no server-side number; it makes the value real, editable
-- from Settings, and consistent across the two halves.
('service_tax_rate', '8', 'number', 'tax', 'Service tax percentage applied to room charges', true),
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
-- LOYALTY PROGRAM BOOTSTRAP
-- ============================================================================
-- The loyalty module has no CRUD surface for programs, tiers, or program
-- rules: it only ever SELECTs them (modules/loyalty/repository.rs
-- default_tier_id / get_rules) and UPDATEs the single rules row
-- (update_rules ... WHERE id = 1). Without these rows every enrollment fails
-- with "no rows returned by a query that expected to return at least one row"
-- and the whole module is unusable. The values below are the canonical ones
-- carried over from the pre-PostgreSQL seed data.

INSERT INTO loyalty_programs (name, description, points_per_dollar, currency, is_active)
SELECT 'Stay Rewards', 'Default guest loyalty program', 1.0000, 'USD', true
WHERE NOT EXISTS (SELECT 1 FROM loyalty_programs);

-- One statement per tier, lowest rank first: `LoyaltyRepository::list_rewards`
-- gating compares tier ids directly (`minimum_tier_id <= member.tier_id`), so
-- the generated ids must ascend with the tier rank.
INSERT INTO loyalty_tiers
    (program_id, code, name, sort_order, min_points, min_nights, min_spend, benefits, is_active)
SELECT p.id, 'silver', 'Silver', 1, 0, 0, 0,
       '["Member rates","Points on eligible stays"]'::jsonb, true
FROM (SELECT id FROM loyalty_programs ORDER BY id LIMIT 1) p
WHERE NOT EXISTS (SELECT 1 FROM loyalty_tiers WHERE code = 'silver');

INSERT INTO loyalty_tiers
    (program_id, code, name, sort_order, min_points, min_nights, min_spend, benefits, is_active)
SELECT p.id, 'gold', 'Gold', 2, 5000, 10, 2500,
       '["Priority support","Late checkout when available","Bonus earning"]'::jsonb, true
FROM (SELECT id FROM loyalty_programs ORDER BY id LIMIT 1) p
WHERE NOT EXISTS (SELECT 1 FROM loyalty_tiers WHERE code = 'gold');

INSERT INTO loyalty_tiers
    (program_id, code, name, sort_order, min_points, min_nights, min_spend, benefits, is_active)
SELECT p.id, 'platinum', 'Platinum', 3, 15000, 30, 7500,
       '["Room upgrade priority","Welcome amenity","Highest earning rate"]'::jsonb, true
FROM (SELECT id FROM loyalty_programs ORDER BY id LIMIT 1) p
WHERE NOT EXISTS (SELECT 1 FROM loyalty_tiers WHERE code = 'platinum');

INSERT INTO loyalty_program_rules
    (id, points_per_currency_unit, tier_qualification_metric, point_expiry_months,
     redemption_approval_required, earning_enabled, min_eligible_amount)
VALUES (1, 1, 'points', 24, true, true, 0)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN RAISE NOTICE 'Required system configuration loaded'; END $$;

-- Normalize ownership markers for canonical records whose conflict updates do
-- not change the marker.
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

-- Quarantine obsolete system-owned records for review. They are intentionally
-- retained so the one important database never loses authorization history.
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

-- Retain obsolete route policies as well; the quarantine copy makes them easy
-- to audit and remove later through an explicit operator decision.
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

-- Guest-portal cancellation defaults must be present before validation.
INSERT INTO system_settings (key, value, value_type, category, description, is_public)
VALUES ('guest_booking_cancellation_enabled', 'false', 'boolean', 'booking',
        'Allow guests to cancel eligible bookings in the guest portal', false)
ON CONFLICT (key) DO NOTHING;

-- This policy is part of the required route-policy set, so it must be present
-- before the integrity checks below.
INSERT INTO route_access_policies (
    route_id, path, nav_label, nav_group, required_permissions, required_roles,
    excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation, is_system_policy
)
VALUES (
    'online-inventory', '/online-inventory', 'Online Inventory', 'operations',
    '["rooms:update","rooms:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '["rooms:update","rooms:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true
)
ON CONFLICT (route_id) DO UPDATE SET
    path = EXCLUDED.path,
    nav_label = EXCLUDED.nav_label,
    nav_group = EXCLUDED.nav_group,
    required_permissions = EXCLUDED.required_permissions,
    nav_permissions = EXCLUDED.nav_permissions,
    is_navigation = EXCLUDED.is_navigation,
    is_system_policy = EXCLUDED.is_system_policy,
    updated_at = CURRENT_TIMESTAMP;

-- Backfill the remaining system route policies. Postgres previously shipped only
-- the five module policies above, so every other accessControlled tab in the
-- frontend (see hotel-web-fe routeRegistry.tsx / canAccessNavigationRoute) was
-- hidden: that function returns false when an accessControlled route has no
-- matching policy. admin and super_admin hold every permission referenced below,
-- so they see all navigation tabs; other roles remain gated per permission.
-- These policies use only permissions that exist in the PostgreSQL seed.
INSERT INTO route_access_policies (
    route_id, path, nav_label, nav_group, required_permissions, required_roles,
    excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation, is_system_policy
)
VALUES
    ('timeline', '/timeline', 'Timeline', 'main', '["rooms:read"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, '["bookings:read"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, true, true),
    ('guest-config', '/guest-config', 'Guests', 'main', '["guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true),
    ('bookings', '/bookings', 'Bookings', 'main', '["bookings:read","bookings:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["bookings:read","bookings:manage"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, true, true),
    ('room-management', '/room-management', 'Rooms', 'main', '["rooms:read","rooms:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["rooms:read","rooms:manage"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, true, true),
    ('reports', '/reports', 'Reports', 'operations', '["analytics:read","reports:execute"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["analytics:read","reports:execute"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true),
    ('company-ledger', '/company-ledger', 'Ledger', 'operations', '["ledgers:read","ledgers:create","ledgers:update","ledgers:void","ledgers:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["ledgers:read","ledgers:create","ledgers:update","ledgers:void","ledgers:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true),
    ('room-config', '/room-config', 'Room Configuration', 'config', '["rooms:update","rooms:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["rooms:update","rooms:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true),
    ('settings', '/settings', 'Settings', 'config', '["settings:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["settings:read","settings:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true),
    ('rbac', '/rbac', 'Access Control', 'config', '["roles:read","roles:manage","permissions:manage","users:read","users:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["roles:read","roles:manage","permissions:manage","users:read","users:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true),
    ('night-audit', '/night-audit', 'Night Audit', 'admin', '["night_audit:read","night_audit:execute"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["night_audit:read","night_audit:execute"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true),
    ('payment-approvals', '/payment-approvals', 'Payment Approvals', 'admin', '["payments:approve","payments:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["payments:approve","payments:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true),
    ('audit-log', '/audit-log', 'Audit Log', 'admin', '["audit:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["audit:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true),
    ('complimentary', '/complimentary', 'Complimentary Nights', 'admin', '["bookings:read","bookings:update"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["bookings:read","bookings:update"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, true, true),
    ('loyalty', '/loyalty', 'Loyalty', 'admin', '["analytics:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["analytics:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true),
    ('data-transfer', '/data-transfer', 'Data Transfer', 'admin', '["settings:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["settings:manage"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true),
    ('ekyc-admin', '/ekyc-admin', 'eKYC Admin', 'admin', '["ekyc:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["ekyc:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true),
    ('dashboard', '/', NULL, NULL, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, true),
    ('profile', '/profile', NULL, NULL, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, true),
    ('help', '/help', NULL, NULL, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, true),
    ('ekyc', '/ekyc', NULL, NULL, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, true),
    ('teams', '/teams', 'Teams', 'config', '["teams:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, '["teams:read"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, true, true)
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

-- Final integrity checks.
DO $$
DECLARE
    invalid_count INTEGER;
    missing_seed_count INTEGER;
    missing_seed_detail TEXT;
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
                  'view_provider_raw', 'manage_reason_codes', 'manage_risk_rules',
                  'compose', 'send'
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
        SELECT 'route_policy:' || expected.route_id AS seed_key
        FROM expected_route_access_policies expected
        WHERE NOT EXISTS (SELECT 1 FROM route_access_policies actual WHERE actual.route_id = expected.route_id)
    ) missing_seed_records;

    -- This count was computed and then discarded for the whole life of the V1
    -- seed, while its three siblings below all raised. That is how three
    -- permissions gating live endpoints (audit:export, loyalty:read,
    -- loyalty:manage) shipped absent -- their routes returned 403 to every
    -- role including super_admin, and nothing anywhere reported it. Arming the
    -- guard is the actual fix; seeding those three is just today's instance.
    IF missing_seed_count > 0 THEN
        SELECT string_agg(seed_key, ', ' ORDER BY seed_key)
        INTO missing_seed_detail
        FROM (
            SELECT 'role:' || expected.name AS seed_key
            FROM expected_system_roles expected
            WHERE NOT EXISTS (SELECT 1 FROM roles actual WHERE actual.name = expected.name)
            UNION ALL
            SELECT 'permission:' || expected.name
            FROM expected_system_permissions expected
            WHERE NOT EXISTS (SELECT 1 FROM permissions actual WHERE actual.name = expected.name)
            UNION ALL
            SELECT 'setting:' || expected.key
            FROM expected_system_settings expected
            WHERE NOT EXISTS (SELECT 1 FROM system_settings actual WHERE actual.key = expected.key)
            UNION ALL
            SELECT 'route_policy:' || expected.route_id
            FROM expected_route_access_policies expected
            WHERE NOT EXISTS (SELECT 1 FROM route_access_policies actual WHERE actual.route_id = expected.route_id)
        ) missing_seed_records;

        RAISE EXCEPTION
            'Database bootstrap validation failed: % expected system record(s) were never seeded: %',
            missing_seed_count, missing_seed_detail;
    END IF;

    -- Some route policies and permissions are intentionally feature-optional;
    -- validate their references when present, but do not reject a V1 install
    -- merely because that feature is not enabled in this deployment.

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


-- ============================================================================
-- FRESH-INSTALL BOOTSTRAP DATA
-- ============================================================================
CREATE TEMP TABLE v1_seed_state (
    seed_accounts boolean NOT NULL,
    seed_property boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO v1_seed_state (seed_accounts, seed_property)
SELECT
    NOT EXISTS (SELECT 1 FROM users),
    NOT EXISTS (
        SELECT 1 FROM room_types
        UNION ALL SELECT 1 FROM rooms
        UNION ALL SELECT 1 FROM rate_plans
        UNION ALL SELECT 1 FROM room_rates
    );

-- Seeded accounts use a non-recoverable placeholder password hash. Set the
-- initial password explicitly with the backend fix_password helper.
INSERT INTO users (
    id, username, email, password_hash, full_name, is_active, is_verified,
    is_super_admin, created_at, updated_at
)
OVERRIDING SYSTEM VALUE
SELECT
    1000, 'admin', 'admin@hotel.com',
    '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'System Administrator', true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE (SELECT seed_accounts FROM v1_seed_state)
ON CONFLICT (username) DO NOTHING;

SELECT setval('users_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1000) FROM users), 1000) + 1, false)
WHERE (SELECT seed_accounts FROM v1_seed_state);

INSERT INTO users (
    username, email, password_hash, full_name, is_active, is_verified,
    is_super_admin, created_at
)
SELECT
    'superadmin', 'superadmin@hotel.local',
    '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
    'Super Administrator', true, true, true, CURRENT_TIMESTAMP
WHERE (SELECT seed_accounts FROM v1_seed_state)
ON CONFLICT (username) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON r.name = 'admin'
WHERE u.username = 'admin'
  AND (SELECT seed_accounts FROM v1_seed_state)
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON r.name = 'super_admin'
WHERE u.username = 'superadmin'
  AND (SELECT seed_accounts FROM v1_seed_state)
ON CONFLICT DO NOTHING;

\echo '[seed] Initial room types, rooms & rate plans...';
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
    IF (SELECT seed_property FROM v1_seed_state) THEN
        INSERT INTO room_types (name, code, description, max_occupancy, base_price, size_sqm, bed_type, bed_count, allows_extra_bed, max_extra_beds, extra_bed_charge, sort_order)
        VALUES
            ('Standard Room', 'STD', 'Comfortable room with essential amenities', 2, 150.00, 25.0, 'Queen', 1, false, 0, 0.00, 1),
            ('Deluxe Room', 'DLX', 'Spacious room with premium amenities', 3, 250.00, 35.0, 'King', 1, true, 1, 50.00, 2),
            ('Suite', 'STE', 'Luxury suite with separate living area', 4, 450.00, 55.0, 'King', 1, true, 2, 75.00, 3),
            ('Family Room', 'FAM', 'Large room perfect for families with children', 6, 350.00, 45.0, 'Queen', 2, true, 2, 40.00, 4);
    END IF;
END $$;

-- System-managed, non-public voucher issued automatically when a guest portal
-- account is activated. It can only be redeemed against the Deluxe room type.
DO $$
DECLARE
    welcome_promotion_id BIGINT;
    deluxe_room_type_id BIGINT;
    admin_user_id BIGINT;
BEGIN
    IF (SELECT seed_property FROM v1_seed_state) THEN
        -- The seeded administrator is not id 1; resolve it by username so the
        -- promotion audit columns satisfy promotions_created_by_fkey.
        SELECT id INTO admin_user_id FROM users WHERE username = 'admin';

        INSERT INTO promotions (
            slug, name, description, terms, status, promotion_kind, discount_type,
            discount_value, currency, min_nights, min_subtotal, per_guest_limit,
            is_public, is_cancellable, created_by, updated_by
        ) VALUES (
            'welcome-deluxe-10', 'Welcome Deluxe 10%',
            'A one-time welcome voucher for 10% off a Deluxe Room.',
            'Valid for one eligible Deluxe Room booking. One voucher per guest.',
            'published', 'voucher', 'percentage', 10.00, 'USD', 1, 0, 1,
            false, true, admin_user_id, admin_user_id
        ) ON CONFLICT (slug) DO NOTHING;

        SELECT id INTO welcome_promotion_id FROM promotions WHERE slug = 'welcome-deluxe-10';
        SELECT id INTO deluxe_room_type_id FROM room_types WHERE code = 'DLX';
        IF welcome_promotion_id IS NOT NULL AND deluxe_room_type_id IS NOT NULL THEN
            INSERT INTO promotion_room_types (promotion_id, room_type_id)
            VALUES (welcome_promotion_id, deluxe_room_type_id)
            ON CONFLICT DO NOTHING;
        END IF;
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
    IF (SELECT seed_property FROM v1_seed_state) THEN
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

DO $$
BEGIN
    IF (SELECT seed_property FROM v1_seed_state) THEN
        INSERT INTO rate_plans (name, code, description, plan_type, adjustment_type, adjustment_value, valid_from, valid_to, is_active, priority)
        VALUES
            ('Complimentary Rate', 'COMP', 'Complimentary rate for special guests, VIPs, and promotional purposes', 'promotional', 'override', 0.00, '2023-01-01', '2026-12-31', true, 100),
            ('Standard Rack Rate', 'RACK', 'Standard published rate for walk-in guests', 'standard', 'override', NULL, '2023-01-01', '2026-12-31', true, 50),
            ('Corporate Rate', 'CORP', 'Discounted rate for corporate clients and business travelers', 'corporate', 'percentage', -20.00, '2023-01-01', '2026-12-31', true, 60),
            ('Weekend Rate', 'WKND', 'Special rate for weekend stays (Friday-Sunday)', 'seasonal', 'percentage', 15.00, '2023-01-01', '2026-12-31', true, 55),
            ('Early Bird Rate', 'EARLY', 'Discounted rate for bookings made 30+ days in advance', 'promotional', 'percentage', -30.00, '2023-01-01', '2026-12-31', true, 70),
            ('Group Rate', 'GROUP', 'Special rate for group bookings (5+ rooms)', 'group', 'percentage', -25.00, '2023-01-01', '2026-12-31', true, 65)
        ON CONFLICT (code) DO NOTHING;

        UPDATE rate_plans SET
            applies_monday = false, applies_tuesday = false, applies_wednesday = false, applies_thursday = false,
            applies_friday = true, applies_saturday = true, applies_sunday = true
        WHERE code = 'WKND';

        UPDATE rate_plans SET min_advance_booking = 30 WHERE code = 'EARLY';
        UPDATE rate_plans SET min_nights = 1 WHERE code = 'GROUP';
    END IF;
END $$;

-- ============================================================================
-- ROOM RATES - Prices for each rate plan and room type combination
-- ============================================================================

DO $$
DECLARE
    comp_id BIGINT; rack_id BIGINT; corp_id BIGINT; wknd_id BIGINT; early_id BIGINT; group_id BIGINT;
    std_id BIGINT; dlx_id BIGINT; ste_id BIGINT; fam_id BIGINT;
BEGIN
    IF NOT (SELECT seed_property FROM v1_seed_state) THEN
        RETURN;
    END IF;

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

DO $$
BEGIN
    IF (SELECT seed_property FROM v1_seed_state) THEN
        RAISE NOTICE 'Rooms & rates loaded: 4 room types, 16 rooms, 6 rate plans with room rates';
    ELSE
        RAISE NOTICE 'Existing property catalogue preserved; sample rooms and rates were not loaded';
    END IF;
END $$;


-- Loyalty-only July offer. It remains private to the rewards catalogue so
-- guests must redeem points before the voucher is issued.
INSERT INTO promotions (
    slug, name, description, terms, status, promotion_kind, discount_type,
    discount_value, currency, claim_starts_at, claim_ends_at, stay_starts_on,
    stay_ends_on, min_nights, min_subtotal, per_guest_limit, is_public,
    is_cancellable, created_by, updated_by
)
SELECT
    'july-deluxe-20-loyalty', 'July Deluxe Room 20% Voucher',
    'Redeem 2,000 loyalty points for 20% off one eligible Deluxe Room booking.',
    'One voucher per guest. Claim and stay dates must be in July 2026. Valid only for Deluxe Rooms.',
    'published', 'voucher', 'percentage', 20.00, 'USD',
    '2026-07-01 00:00:00+00', '2026-07-31 23:59:59+00', '2026-07-01', '2026-07-31',
    1, 0, 1, false, true, u.id, u.id
FROM users u
WHERE u.username = 'admin'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO promotion_room_types (promotion_id, room_type_id)
SELECT p.id, rt.id
FROM promotions p
JOIN room_types rt ON rt.code = 'DLX'
WHERE p.slug = 'july-deluxe-20-loyalty'
ON CONFLICT DO NOTHING;

INSERT INTO loyalty_rewards (
    name, description, category, points_cost, requires_approval, is_active,
    valid_from, valid_to, terms_conditions
)
SELECT
    'July Deluxe Room 20% Voucher',
    'Redeem 2,000 points for a voucher worth 20% off a Deluxe Room.',
    'discount', 2000, false, true, '2026-07-01', '2026-07-31',
    'The voucher is issued immediately, may be used once, and is valid only for a Deluxe Room stay in July 2026.'
WHERE NOT EXISTS (
    SELECT 1 FROM loyalty_rewards WHERE name = 'July Deluxe Room 20% Voucher'
);

-- Fresh-property validation.
DO $$
BEGIN
    IF (SELECT seed_property FROM v1_seed_state)
       AND ((SELECT COUNT(*) FROM room_types) < 4
            OR (SELECT COUNT(*) FROM rooms) < 16
            OR (SELECT COUNT(*) FROM rate_plans) < 6) THEN
        RAISE EXCEPTION 'fresh V1 property bootstrap did not create its required records';
    END IF;
END;
$$;

INSERT INTO audit_logs (user_id, action, resource_type, details)
SELECT u.id, 'system.seed', 'system',
       jsonb_build_object('message', 'V1 bootstrap data loaded', 'timestamp', CURRENT_TIMESTAMP)
FROM users u
WHERE u.username = 'admin'
  AND NOT EXISTS (
      SELECT 1 FROM audit_logs
      WHERE action = 'system.seed' AND resource_type = 'system'
  );

-- ============================================================================
-- STARTER TEAMS
-- ============================================================================
-- Three obvious hotel departments so the Teams page is not empty on first run.
-- These are sample data, not bootstrap data: nothing reads them with fetch_one
-- and an empty teams table is a valid state, so they live here rather than in
-- seed.sql. `created_by` resolves the admin by username -- the seeded admin is
-- id 1000, and hardcoding an id here has broken this file before.
INSERT INTO teams (code, name, description, created_by, updated_by)
SELECT v.code, v.name, v.description, u.id, u.id
FROM (VALUES
    ('front_desk',  'Front Desk',  'Reception, check-in/out and guest relations'),
    ('housekeeping','Housekeeping','Room cleaning, turndown and laundry'),
    ('maintenance', 'Maintenance', 'Engineering, repairs and preventive upkeep')
) AS v(code, name, description)
LEFT JOIN users u ON u.username = 'admin'
ON CONFLICT DO NOTHING;

-- The revision row is deliberately the last persistent action: it certifies
-- that schema, required data, and fresh bootstrap data all succeeded.
INSERT INTO public.hotel_schema_revisions (
    generation, version, name, checksum, app_build
) VALUES (
    1, 1, 'v1-baseline',
    'sha256:1149266ee7cc6ae8a0733098a15e1ee0377568eea3aed65254709afe992d1e1d',
    NULL
);

COMMIT;
