-- ============================================================================
-- HOTEL APP SQLITE DATA
-- ============================================================================
-- Rerunnable system seed, policy, normalization, and backfill statements.
-- Executed after all pending sqlite_schema.sql sections have succeeded.
-- ============================================================================

-- Source migration 001: initial_schema
-- ============================================================================
-- SEED DATA: ROLES
-- ============================================================================

INSERT OR IGNORE INTO roles (id, name, display_name, description, is_system_role, priority) VALUES
(1, 'admin', 'Administrator', 'Full system access', 1, 100),
(2, 'manager', 'Manager', 'Hotel management access', 1, 80),
(3, 'receptionist', 'Receptionist', 'Front desk operations', 1, 60),
(4, 'housekeeping', 'Housekeeping', 'Room cleaning and maintenance', 1, 40),
(5, 'accountant', 'Accountant', 'Financial operations', 1, 50),
(6, 'guest', 'Guest', 'Guest self-service access', 1, 10);

-- ============================================================================
-- SEED DATA: PERMISSIONS
-- ============================================================================

INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission) VALUES
('rooms:read', 'rooms', 'read', 'View rooms', 1),
('rooms:create', 'rooms', 'create', 'Create rooms', 1),
('rooms:update', 'rooms', 'update', 'Update rooms', 1),
('rooms:delete', 'rooms', 'delete', 'Delete rooms', 1),
('rooms:manage', 'rooms', 'manage', 'Full room management', 1),
('bookings:read', 'bookings', 'read', 'View bookings', 1),
('bookings:create', 'bookings', 'create', 'Create bookings', 1),
('bookings:update', 'bookings', 'update', 'Update bookings', 1),
('bookings:delete', 'bookings', 'delete', 'Cancel bookings', 1),
('bookings:manage', 'bookings', 'manage', 'Full booking management', 1),
('guests:read', 'guests', 'read', 'View guests', 1),
('guests:create', 'guests', 'create', 'Create guests', 1),
('guests:update', 'guests', 'update', 'Update guests', 1),
('guests:delete', 'guests', 'delete', 'Delete guests', 1),
('guests:manage', 'guests', 'manage', 'Full guest management', 1),
('payments:read', 'payments', 'read', 'View payments', 1),
('payments:create', 'payments', 'create', 'Process payments', 1),
('payments:manage', 'payments', 'manage', 'Full payment management', 1),
('reports:read', 'reports', 'read', 'View reports', 1),
('reports:manage', 'reports', 'manage', 'Full report access', 1),
('users:read', 'users', 'read', 'View users', 1),
('users:create', 'users', 'create', 'Create users', 1),
('users:update', 'users', 'update', 'Update users', 1),
('users:delete', 'users', 'delete', 'Delete users', 1),
('users:manage', 'users', 'manage', 'Full user management', 1),
('settings:read', 'settings', 'read', 'View settings', 1),
('settings:update', 'settings', 'update', 'Update settings', 1),
('settings:manage', 'settings', 'manage', 'Full settings management', 1);

-- ============================================================================
-- SEED DATA: ROLE PERMISSIONS
-- ============================================================================

-- Admin: all permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions;

-- Manager: most permissions except user management
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions WHERE resource NOT IN ('users', 'settings') OR action = 'read';

-- Receptionist: bookings, guests, rooms read/create/update
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 3, id FROM permissions WHERE
    (resource IN ('bookings', 'guests') AND action IN ('read', 'create', 'update')) OR
    (resource = 'rooms' AND action IN ('read', 'update')) OR
    (resource = 'payments' AND action IN ('read', 'create'));

-- ============================================================================
-- SEED DATA: ROOM TYPES
-- ============================================================================

INSERT OR IGNORE INTO room_types (id, name, code, description, base_price, max_occupancy, bed_type, bed_count) VALUES
(1, 'Standard Room', 'STD', 'Comfortable standard room', 150.00, 2, 'Queen', 1),
(2, 'Deluxe Room', 'DLX', 'Spacious deluxe room with city view', 250.00, 2, 'King', 1),
(3, 'Suite', 'STE', 'Luxury suite with separate living area', 450.00, 4, 'King', 1),
(4, 'Family Room', 'FAM', 'Large room suitable for families', 350.00, 4, 'Queen', 2);

-- ============================================================================
-- SEED DATA: MARKET CODES
-- ============================================================================

INSERT OR IGNORE INTO market_codes (code, name, description, category) VALUES
('WKII', 'Walk-In', 'Walk-in guest', 'Direct'),
('ONLI', 'Online', 'Online booking', 'OTA'),
('CORP', 'Corporate', 'Corporate booking', 'Business'),
('GOVT', 'Government', 'Government booking', 'Business'),
('COMP', 'Complimentary', 'Complimentary stay', 'Special');

-- ============================================================================
-- SEED DATA: RATE CODES
-- ============================================================================

INSERT OR IGNORE INTO rate_codes (code, name, description, discount_type, discount_value) VALUES
('RACK', 'Rack Rate', 'Standard published rate', 'percentage', 0),
('CORP', 'Corporate Rate', 'Corporate discount rate', 'percentage', 15),
('PROMO', 'Promotional', 'Promotional discount', 'percentage', 20),
('MEMB', 'Member Rate', 'Loyalty member rate', 'percentage', 10);

-- ============================================================================
-- SEED DATA: DEFAULT ADMIN USER
-- Uses a non-recoverable placeholder password hash. Reset explicitly before login.
-- ============================================================================

INSERT OR IGNORE INTO users (id, uuid, username, email, password_hash, full_name, user_type, is_active, is_verified, is_super_admin)
VALUES (1, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'admin', 'admin@hotel.local',
        '$2b$12$Fq3zPzZ.mr/wuYrbUPUItOqoC9YvsFfW.mcq4B6U5e3nWsPr4JQdK',
        'System Administrator', 'staff', 1, 1, 1);

INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (1, 1);

-- Migration: 002_ledger_permissions.sql
-- ============================================================================
-- Migration: Add customer-ledger RBAC permissions
-- Description: Gate customer ledger reads, mutations, voids, and management.
-- ============================================================================

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('ledgers:read', 'ledgers', 'read', 'View customer ledger entries and payments', 1),
    ('ledgers:create', 'ledgers', 'create', 'Create customer ledger entries and record ledger payments', 1),
    ('ledgers:update', 'ledgers', 'update', 'Update customer ledger entries and payment dates', 1),
    ('ledgers:void', 'ledgers', 'void', 'Void customer ledger entries and create reversals', 1),
    ('ledgers:manage', 'ledgers', 'manage', 'Full customer ledger management', 1)
ON CONFLICT(name) DO UPDATE SET
    resource = excluded.resource,
    action = excluded.action,
    description = excluded.description,
    is_system_permission = excluded.is_system_permission;

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
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
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
AND p.name IN ('ledgers:read', 'ledgers:create');

-- Migration: 003_business_runtime_settings.sql
-- ============================================================================
-- SQLITE MIGRATION 003: BUSINESS RUNTIME SETTINGS
-- ============================================================================
-- Description: Add hotel-facing settings that replace hardcoded defaults.
-- ============================================================================

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES
    (
        'default_payment_terms_days',
        '30',
        'number',
        'ledger',
        'Default ledger due-date offset in days when a company has no payment terms',
        0
    ),
    (
        'totp_issuer_name',
        'Hotel Management System',
        'string',
        'security',
        'Issuer name shown in authenticator apps during TOTP setup',
        0
    ),
    (
        'passkey_relying_party_name',
        'Hotel Management System',
        'string',
        'security',
        'Display name shown by passkey authenticators during registration',
        0
    );

-- Migration: 004_ledger_role_grants.sql
-- ============================================================================
-- Migration: Ensure core staff roles have customer-ledger permissions
-- Description: Explicitly grant ledger access to Super Administrator,
-- Administrator, Manager, and Receptionist roles.
-- ============================================================================

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
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
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
AND p.name IN ('ledgers:read', 'ledgers:create');

-- Migration: 005_frontdesk_runtime_settings.sql
-- ============================================================================
-- SQLITE MIGRATION 005: FRONT DESK RUNTIME SETTINGS
-- ============================================================================
-- Description: Persist client-facing settings that were previously local only.
-- ============================================================================

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES
    (
        'night_shift_time',
        '23:00',
        'string',
        'operations',
        'Scheduled night audit posting time',
        0
    ),
    (
        'deposit_amount',
        '50',
        'number',
        'payments',
        'Default room card or check-in deposit amount',
        0
    ),
    (
        'tourism_tax_rate',
        '10',
        'number',
        'tax',
        'Tourism tax amount charged per night for foreign guests',
        0
    ),
    (
        'booking_channels',
        '[{"name":"Booking.com","abbreviation":"B.C"},{"name":"Agoda","abbreviation":"A.C"},{"name":"Traveloka","abbreviation":"T.C"},{"name":"Expedia","abbreviation":"E.C"},{"name":"Hotels.com","abbreviation":"H.C"},{"name":"Airbnb","abbreviation":"AB"},{"name":"Trip.com","abbreviation":"TR"},{"name":"Direct Website","abbreviation":"DW"},{"name":"Other OTA","abbreviation":"OT"}]',
        'json',
        'sales',
        'Online and direct booking channels available to front desk workflows',
        0
    ),
    (
        'payment_methods',
        '["Cash","Visa Card","Master Card","Debit Card","Sarawak Pay","American Express","Bank Transfer","E-Wallet","Other"]',
        'json',
        'payments',
        'Payment methods available to walk-in and payment workflows',
        0
    ),
    (
        'report_font_size',
        '14',
        'number',
        'reports',
        'Base font size in pixels for generated report previews and print output',
        0
    );

-- Migration: 006_analytics_role_grants.sql
-- ============================================================================
-- SQLITE MIGRATION 006: ANALYTICS ROLE GRANTS
-- ============================================================================
-- Description: Ensure every operational user role except guest/staff can read analytics.
-- ============================================================================

INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission)
VALUES ('analytics:read', 'analytics', 'read', 'Access to analytics and reports', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.name = 'analytics:read'
  AND r.name NOT IN ('guest', 'staff');

-- Migration: 008_dynamic_rbac_permissions.sql
-- ============================================================================
-- SQLITE MIGRATION 008: DYNAMIC RBAC PERMISSIONS
-- ============================================================================
-- Description: Seed first-class access-control permissions used by RBAC routes.
-- ============================================================================

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('users:create', 'users', 'create', 'Create users', 1),
    ('users:read', 'users', 'read', 'View users', 1),
    ('users:update', 'users', 'update', 'Update users', 1),
    ('users:delete', 'users', 'delete', 'Delete users', 1),
    ('users:manage', 'users', 'manage', 'Full user management', 1),
    ('roles:create', 'roles', 'create', 'Create roles', 1),
    ('roles:read', 'roles', 'read', 'View roles', 1),
    ('roles:update', 'roles', 'update', 'Update roles', 1),
    ('roles:delete', 'roles', 'delete', 'Delete roles', 1),
    ('roles:manage', 'roles', 'manage', 'Full role management', 1),
    ('permissions:create', 'permissions', 'create', 'Create permissions', 1),
    ('permissions:read', 'permissions', 'read', 'View permissions', 1),
    ('permissions:update', 'permissions', 'update', 'Update permissions', 1),
    ('permissions:delete', 'permissions', 'delete', 'Delete permissions', 1),
    ('permissions:manage', 'permissions', 'manage', 'Full permission management', 1),
    ('loyalty:read', 'loyalty', 'read', 'View loyalty program data', 1),
    ('loyalty:manage', 'loyalty', 'manage', 'Manage loyalty program rewards and points', 1)
ON CONFLICT(name) DO UPDATE SET
    resource = excluded.resource,
    action = excluded.action,
    description = excluded.description,
    is_system_permission = excluded.is_system_permission;

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
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
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('manager', 'receptionist')
AND p.name IN (
    'loyalty:read'
);

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('rooms:write', 'rooms', 'write', 'Create and modify rooms and room types', 1),
    ('ekyc:manage', 'ekyc', 'manage', 'Manage eKYC verifications', 1),
    ('ekyc:verify', 'ekyc', 'verify', 'Approve or reject eKYC verifications', 1),
    ('rewards:read', 'rewards', 'read', 'View reward information', 1),
    ('navigation_timeline:read', 'navigation:timeline', 'read', 'Show Reservation Timeline navigation', 1),
    ('navigation_guest_config:read', 'navigation:guest-config', 'read', 'Show Guest Management navigation', 1),
    ('navigation_bookings:read', 'navigation:bookings', 'read', 'Show Bookings navigation', 1),
    ('navigation_my_bookings:read', 'navigation:my-bookings', 'read', 'Show My Bookings navigation', 1),
    ('navigation_room_management:read', 'navigation:room-management', 'read', 'Show Room Management navigation', 1),
    ('navigation_reports:read', 'navigation:reports', 'read', 'Show Reports navigation', 1),
    ('navigation_ekyc_admin:read', 'navigation:ekyc-admin', 'read', 'Show eKYC Admin navigation', 1),
    ('navigation_room_config:read', 'navigation:room-config', 'read', 'Show Room Configuration navigation', 1),
    ('navigation_settings:read', 'navigation:settings', 'read', 'Show Settings navigation', 1),
    ('navigation_rbac:read', 'navigation:rbac', 'read', 'Show Access Control navigation', 1),
    ('navigation_company_ledger:read', 'navigation:company-ledger', 'read', 'Show Company Ledger navigation', 1),
    ('navigation_night_audit:read', 'navigation:night-audit', 'read', 'Show Night Audit navigation', 1),
    ('navigation_audit_log:read', 'navigation:audit-log', 'read', 'Show Audit Log navigation', 1),
    ('navigation_complimentary:read', 'navigation:complimentary', 'read', 'Show Complimentary Nights navigation', 1),
    ('navigation_data_transfer:read', 'navigation:data-transfer', 'read', 'Show Data Transfer navigation', 1)
ON CONFLICT(name) DO UPDATE SET
    resource = excluded.resource,
    action = excluded.action,
    description = excluded.description,
    is_system_permission = excluded.is_system_permission;

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
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
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'guest'
AND p.name IN ('rewards:read', 'navigation_my_bookings:read');

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
    ('dashboard', '/', NULL, NULL, '[]', '[]', '[]', '[]', '[]', '[]', 0),
    ('timeline', '/timeline', 'Timeline', 'main', '["rooms:read"]', '[]', '[]', '["navigation_timeline:read","bookings:read"]', '[]', '["guest"]', 1),
    ('guest-config', '/guest-config', 'Guests', 'main', '["guests:read","guests:manage"]', '[]', '[]', '["navigation_guest_config:read","guests:read","guests:manage"]', '[]', '[]', 1),
    ('bookings', '/bookings', 'Bookings', 'main', '["bookings:read","bookings:manage"]', '[]', '[]', '["navigation_bookings:read","bookings:read","bookings:manage"]', '[]', '["guest"]', 1),
    ('my-bookings', '/my-bookings', 'My Bookings', 'main', '["bookings:read"]', '[]', '["super_admin","admin","manager","receptionist","staff"]', '["navigation_my_bookings:read","bookings:read"]', '[]', '["super_admin","admin","manager","receptionist","staff"]', 1),
    ('room-management', '/room-management', 'Rooms', 'main', '["rooms:read","rooms:manage"]', '[]', '[]', '["navigation_room_management:read","rooms:read","rooms:manage"]', '[]', '["guest"]', 1),
    ('reports', '/reports', 'Reports', 'operations', '["analytics:read","reports:execute"]', '[]', '[]', '["navigation_reports:read","analytics:read","reports:execute"]', '[]', '[]', 1),
    ('loyalty', '/loyalty', NULL, NULL, '["loyalty:read","loyalty:manage","analytics:read"]', '[]', '[]', '[]', '[]', '[]', 0),
    ('profile', '/profile', NULL, NULL, '[]', '[]', '[]', '[]', '[]', '[]', 0),
    ('help', '/help', NULL, NULL, '[]', '[]', '[]', '[]', '[]', '[]', 0),
    ('ekyc', '/ekyc', NULL, NULL, '[]', '[]', '[]', '[]', '[]', '[]', 0),
    ('ekyc-admin', '/ekyc-admin', 'eKYC Admin', 'admin', '["ekyc:manage"]', '[]', '[]', '["navigation_ekyc_admin:read","ekyc:manage"]', '[]', '[]', 1),
    ('room-config', '/room-config', 'Room Configuration', 'config', '["rooms:update","rooms:write","rooms:manage"]', '[]', '[]', '["navigation_room_config:read","rooms:update","rooms:write","rooms:manage"]', '[]', '[]', 1),
    ('settings', '/settings', 'Settings', 'config', '["settings:read"]', '[]', '[]', '["navigation_settings:read","settings:read","settings:manage"]', '[]', '[]', 1),
    ('rbac', '/rbac', 'Access Control', 'config', '["roles:read","roles:manage","permissions:read","permissions:manage","users:read","users:manage"]', '[]', '[]', '["navigation_rbac:read","roles:read","roles:manage","permissions:read","permissions:manage","users:read","users:manage"]', '[]', '[]', 1),
    ('company-ledger', '/company-ledger', 'Ledger', 'operations', '["ledgers:read","ledgers:create","ledgers:update","ledgers:void","ledgers:manage"]', '[]', '[]', '["navigation_company_ledger:read","ledgers:read","ledgers:create","ledgers:update","ledgers:void","ledgers:manage"]', '[]', '[]', 1),
    ('night-audit', '/night-audit', 'Night Audit', 'admin', '["night_audit:read","night_audit:execute"]', '[]', '[]', '["navigation_night_audit:read","night_audit:read","night_audit:execute"]', '[]', '[]', 1),
    ('audit-log', '/audit-log', 'Audit Log', 'admin', '["audit:read"]', '[]', '[]', '["navigation_audit_log:read","audit:read"]', '[]', '[]', 1),
    ('complimentary', '/complimentary', 'Complimentary Nights', 'admin', '["bookings:read","bookings:update"]', '[]', '[]', '["navigation_complimentary:read","bookings:read","bookings:update"]', '[]', '["guest"]', 1),
    ('data-transfer', '/data-transfer', 'Data Transfer', 'admin', '["settings:manage"]', '[]', '[]', '["navigation_data_transfer:read","settings:manage"]', '[]', '[]', 1)
ON CONFLICT(route_id) DO NOTHING;

-- Migration: 011_ekyc_admin_workflow.sql
-- ============================================================================
-- SQLITE MIGRATION 011: eKYC ADMIN WORKFLOW, AUDIT, AND RBAC
-- ============================================================================

INSERT OR IGNORE INTO roles (name, display_name, description, is_system_role, priority) VALUES
('compliance_admin', 'Compliance Administrator', 'Compliance administration and eKYC oversight', 1, 90),
('ekyc_reviewer', 'eKYC Reviewer', 'Reviews and actions assigned eKYC applications', 1, 70),
('senior_reviewer', 'Senior Reviewer', 'Second-level eKYC review and high-risk approvals', 1, 75),
('auditor', 'Auditor', 'Read-only audit and compliance access', 1, 65),
('support_readonly', 'Read-only Support', 'Read-only operational support access', 1, 30);

INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission) VALUES
('ekyc:read', 'ekyc', 'read', 'View masked eKYC applications', 1),
('ekyc:review', 'ekyc', 'review', 'Review eKYC application details and notes', 1),
('ekyc:view_sensitive', 'ekyc', 'read', 'View sensitive eKYC data when explicitly returned', 1),
('ekyc:reveal_sensitive', 'ekyc', 'reveal', 'Reveal masked eKYC identity fields with audit', 1),
('ekyc:download_documents', 'ekyc', 'download', 'Download private eKYC documents', 1),
('ekyc:assign', 'ekyc', 'assign', 'Claim, assign, or reassign eKYC cases', 1),
('ekyc:approve', 'ekyc', 'approve', 'Approve eKYC applications', 1),
('ekyc:reject', 'ekyc', 'reject', 'Reject eKYC applications', 1),
('ekyc:escalate', 'ekyc', 'escalate', 'Escalate eKYC applications', 1),
('ekyc:request_resubmission', 'ekyc', 'request_resubmission', 'Request additional eKYC information', 1),
('ekyc:override', 'ekyc', 'override', 'Perform controlled eKYC manual overrides', 1),
('ekyc:export', 'ekyc', 'export', 'Export masked eKYC records', 1),
('ekyc:manage_reason_codes', 'ekyc', 'manage_reason_codes', 'Manage eKYC reason codes', 1),
('ekyc:manage_risk_rules', 'ekyc', 'manage_risk_rules', 'Manage eKYC risk rules', 1),
('ekyc:view_provider_raw', 'ekyc', 'view_provider_raw', 'View raw eKYC provider responses', 1),
('ekyc:manage', 'ekyc', 'manage', 'Full eKYC administration', 1),
('ekyc:verify', 'ekyc', 'verify', 'Legacy eKYC approve or reject permission', 1),
('navigation_ekyc_admin:read', 'navigation:ekyc-admin', 'read', 'Show eKYC Admin navigation', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.resource = 'ekyc';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
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
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'ekyc_reviewer'
  AND p.name IN (
      'ekyc:read', 'ekyc:review', 'ekyc:download_documents', 'ekyc:assign',
      'ekyc:approve', 'ekyc:reject', 'ekyc:escalate',
      'ekyc:request_resubmission', 'navigation_ekyc_admin:read'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'senior_reviewer'
  AND p.name IN (
      'ekyc:read', 'ekyc:review', 'ekyc:view_sensitive', 'ekyc:download_documents',
      'ekyc:assign', 'ekyc:approve', 'ekyc:reject', 'ekyc:escalate',
      'ekyc:request_resubmission', 'ekyc:override', 'navigation_ekyc_admin:read'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'auditor'
  AND p.name IN ('ekyc:read', 'ekyc:export', 'navigation_ekyc_admin:read', 'audit:read');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'support_readonly'
  AND p.name IN ('ekyc:read', 'navigation_ekyc_admin:read');

INSERT OR REPLACE INTO ekyc_reason_codes (code, label, category, requires_details, customer_message_template, is_active) VALUES
('document_blurry', 'Blurry document', 'resubmission', 0, 'Please upload a clearer image of your identity document.', 1),
('missing_document', 'Missing document', 'resubmission', 0, 'Please upload the missing identity document.', 1),
('expired_document', 'Expired document', 'resubmission', 0, 'Please upload a valid, unexpired identity document.', 1),
('selfie_mismatch', 'Selfie mismatch', 'resubmission', 1, 'Please submit a new selfie that clearly matches your identity document.', 1),
('incomplete_profile', 'Incomplete profile', 'resubmission', 0, 'Please complete the missing profile details.', 1),
('unsupported_document', 'Unsupported document', 'rejection', 1, NULL, 1),
('data_mismatch', 'Data mismatch', 'review', 1, 'Please review and correct the submitted identity information.', 1),
('duplicate_identity', 'Potential duplicate identity', 'escalation', 1, NULL, 1),
('watchlist_match', 'Watchlist, sanctions, or PEP match', 'escalation', 1, NULL, 1),
('provider_error', 'Verification provider error', 'manual_override', 1, NULL, 1),
('manual_override', 'Manual override', 'manual_override', 1, NULL, 1),
('other', 'Other', 'general', 1, NULL, 1);

UPDATE route_access_policies
SET required_permissions = '["ekyc:read"]',
    nav_permissions = '["navigation_ekyc_admin:read","ekyc:read"]',
    updated_at = datetime('now')
WHERE route_id = 'ekyc-admin';

-- Migration: 016_void_status_names.sql
-- Normalize legacy "cancelled" status values to "void".

UPDATE bookings
SET status = 'comp_void'
WHERE status = 'comp_cancelled';

UPDATE bookings
SET status = 'voided'
WHERE status = 'cancelled';

UPDATE bookings
SET payment_status = 'void'
WHERE payment_status = 'cancelled';

UPDATE payments
SET status = 'void'
WHERE status = 'cancelled';

UPDATE invoices
SET status = 'void'
WHERE status = 'cancelled';

UPDATE ekyc_verifications
SET status = 'void'
WHERE status = 'cancelled';


-- Source migration 002: night_audit_auto_settings
-- Automatic night audit scheduler settings (opt-in).
-- Mirrors the PostgreSQL seed in database/schema.sql. The in-process scheduler
-- reads these live; `night_shift_time` (seeded in 001) is reused as the trigger
-- time. Note: night audit posting itself is PostgreSQL-only (stored procedure),
-- so on SQLite these settings stay inert.

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES
    (
        'night_audit_auto_enabled',
        'false',
        'boolean',
        'operations',
        'When true, the backend runs the night audit automatically at night_shift_time',
        0
    ),
    (
        'night_audit_catchup_days',
        '7',
        'number',
        'operations',
        'Max number of missed business dates the scheduler will back-fill in one sweep',
        0
    );


-- Source migration 003: channel_net_revenue
INSERT OR IGNORE INTO booking_channels
    (name, channel_type, default_commission_type, default_commission_value, default_commission_scope, is_active)
VALUES
    ('Direct', 'direct', 'none', 0, 'per_booking', 1),
    ('Walk-in', 'walk_in', 'none', 0, 'per_booking', 1),
    ('Phone', 'phone', 'none', 0, 'per_booking', 1),
    ('Direct Website', 'website', 'none', 0, 'per_booking', 1),
    ('Booking.com', 'ota', 'none', 0, 'per_booking', 1),
    ('Agoda', 'ota', 'none', 0, 'per_booking', 1),
    ('Traveloka', 'ota', 'none', 0, 'per_booking', 1),
    ('Expedia', 'ota', 'none', 0, 'per_booking', 1),
    ('Hotels.com', 'ota', 'none', 0, 'per_booking', 1),
    ('Airbnb', 'ota', 'none', 0, 'per_booking', 1),
    ('Trip.com', 'ota', 'none', 0, 'per_booking', 1),
    ('Other OTA', 'ota', 'none', 0, 'per_booking', 1);


-- Source migration 007: report_font_size_setting
-- Report preview and print font size setting.
-- Mirrors the PostgreSQL seed in database/schema.sql.

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES (
    'report_font_size',
    '14',
    'number',
    'reports',
    'Base font size in pixels for generated report previews and print output',
    0
);


-- Source migration 008: report_font_style_settings
-- Report preview and print font style settings.
-- Mirrors the PostgreSQL seed in database/schema.sql.

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES
    (
        'report_font_family',
        'Arial, Helvetica, sans-serif',
        'string',
        'reports',
        'Font family for generated report previews and print output',
        0
    ),
    (
        'report_heading_font_size',
        '24',
        'number',
        'reports',
        'Large heading and KPI font size in pixels for generated reports',
        0
    ),
    (
        'report_section_heading_font_size',
        '18',
        'number',
        'reports',
        'Section heading font size in pixels for generated reports',
        0
    ),
    (
        'report_table_font_size',
        '14',
        'number',
        'reports',
        'Table font size in pixels for generated reports',
        0
    ),
    (
        'report_caption_font_size',
        '13',
        'number',
        'reports',
        'Caption and secondary label font size in pixels for generated reports',
        0
    ),
    (
        'report_chip_font_size',
        '12',
        'number',
        'reports',
        'Status chip font size in pixels for generated reports',
        0
    );


-- Source migration 009: loyalty_program_portal
INSERT INTO loyalty_tiers (code, name, sort_order, min_points, min_nights, min_spend, benefits)
VALUES
    ('silver', 'Silver', 1, 0, 0, 0, '["Member rates","Points on eligible stays"]'),
    ('gold', 'Gold', 2, 5000, 10, 2500, '["Priority support","Late checkout when available","Bonus earning"]'),
    ('platinum', 'Platinum', 3, 15000, 30, 7500, '["Room upgrade priority","Welcome amenity","Highest earning rate"]')
ON CONFLICT(code) DO UPDATE SET
    name = excluded.name,
    sort_order = excluded.sort_order,
    min_points = excluded.min_points,
    min_nights = excluded.min_nights,
    min_spend = excluded.min_spend,
    benefits = excluded.benefits,
    is_active = 1,
    updated_at = datetime('now');

INSERT INTO loyalty_program_rules (id, points_per_currency_unit, tier_qualification_metric, point_expiry_months, redemption_approval_required, earning_enabled, min_eligible_amount)
VALUES (1, 1, 'points', 24, 1, 1, 0)
ON CONFLICT(id) DO NOTHING;

INSERT INTO loyalty_rewards (name, description, category, points_cost, minimum_tier_id, requires_approval, is_active, terms_conditions)
SELECT 'Late checkout', 'Request a late checkout on an eligible stay.', 'service', 750, id, 1, 1, 'Subject to availability.'
FROM loyalty_tiers
WHERE code = 'silver'
  AND NOT EXISTS (SELECT 1 FROM loyalty_rewards WHERE name = 'Late checkout');

INSERT INTO loyalty_rewards (name, description, category, points_cost, minimum_tier_id, requires_approval, is_active, terms_conditions)
SELECT 'Room upgrade request', 'Request a one-category room upgrade when available.', 'room_upgrade', 2000, id, 1, 1, 'Subject to availability and room type.'
FROM loyalty_tiers
WHERE code = 'gold'
  AND NOT EXISTS (SELECT 1 FROM loyalty_rewards WHERE name = 'Room upgrade request');

INSERT INTO loyalty_rewards (name, description, category, points_cost, minimum_tier_id, requires_approval, is_active, terms_conditions)
SELECT 'Dining credit', 'Apply a dining credit during a future stay.', 'dining', 1500, id, 0, 1, 'Valid for one eligible stay.'
FROM loyalty_tiers
WHERE code = 'silver'
  AND NOT EXISTS (SELECT 1 FROM loyalty_rewards WHERE name = 'Dining credit');

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('navigation_loyalty:read', 'navigation:loyalty', 'read', 'Show Loyalty navigation', 1),
    ('navigation_my_rewards:read', 'navigation:my-rewards', 'read', 'Show My Rewards navigation', 1)
ON CONFLICT(name) DO UPDATE SET
    resource = excluded.resource,
    action = excluded.action,
    description = excluded.description,
    is_system_permission = excluded.is_system_permission;

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.name IN ('navigation_loyalty:read', 'loyalty:read', 'loyalty:manage');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'guest'
  AND p.name IN ('navigation_my_rewards:read', 'rewards:read');

UPDATE route_access_policies
SET nav_label = 'Loyalty',
    nav_group = 'admin',
    nav_permissions = '["navigation_loyalty:read","loyalty:read","loyalty:manage"]',
    is_navigation = 1,
    updated_at = datetime('now')
WHERE route_id = 'loyalty';

INSERT INTO route_access_policies (
    route_id, path, nav_label, nav_group, required_permissions, required_roles,
    excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation
)
VALUES (
    'my-rewards', '/my-rewards', 'My Rewards', 'main', '["rewards:read"]', '[]',
    '["super_admin","admin","manager","receptionist","staff"]',
    '["navigation_my_rewards:read","rewards:read"]', '[]',
    '["super_admin","admin","manager","receptionist","staff"]', 1
)
ON CONFLICT(route_id) DO UPDATE SET
    nav_label = excluded.nav_label,
    nav_group = excluded.nav_group,
    required_permissions = excluded.required_permissions,
    excluded_roles = excluded.excluded_roles,
    nav_permissions = excluded.nav_permissions,
    nav_excluded_roles = excluded.nav_excluded_roles,
    is_navigation = excluded.is_navigation,
    updated_at = datetime('now');


-- Source migration 010: guest_ekyc_auto_checkin
UPDATE ekyc_verifications
SET guest_id = (
    SELECT users.guest_id
    FROM users
    WHERE users.id = ekyc_verifications.user_id
)
WHERE guest_id IS NULL
  AND EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = ekyc_verifications.user_id
        AND users.guest_id IS NOT NULL
  );

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES (
    'auto_checkin_requires_ekyc',
    'true',
    'boolean',
    'frontdesk',
    'Require approved guest eKYC before scheduled auto check-in',
    0
);

-- Hide the operational/admin navigation entries (Timeline, Bookings, Rooms,
-- Complimentary Nights) from guests. The 001 seed uses ON CONFLICT DO NOTHING,
-- so this patches pre-existing rows by setting nav_excluded_roles to exclude
-- 'guest' (which short-circuits nav visibility regardless of the guest role's
-- permissions). My Bookings is intentionally left visible to guests.
UPDATE route_access_policies
SET nav_excluded_roles = '["guest"]',
    updated_at = datetime('now')
WHERE route_id IN ('timeline', 'bookings', 'room-management', 'complimentary')
  AND nav_excluded_roles <> '["guest"]';

-- Revert any prior guest exclusion on My Bookings so guests retain access.
UPDATE route_access_policies
SET nav_excluded_roles = '["super_admin","admin","manager","receptionist","staff"]',
    updated_at = datetime('now')
WHERE route_id = 'my-bookings'
  AND nav_excluded_roles <> '["super_admin","admin","manager","receptionist","staff"]';


-- Source migration 011: backfill_loyalty_members
-- Backfill portal loyalty members for SQLite databases that already had
-- guests marked as members before the portal loyalty tables existed.

INSERT OR IGNORE INTO loyalty_members (guest_id, member_number, status, enrolled_at)
SELECT
    id,
    printf('LP%08d', id),
    'active',
    COALESCE(created_at, datetime('now'))
FROM guests
WHERE deleted_at IS NULL
  AND guest_type = 'member';

INSERT OR IGNORE INTO loyalty_accounts (
    member_id,
    current_tier_id,
    lifetime_points,
    qualifying_points,
    qualifying_nights,
    qualifying_spend
)
SELECT
    lm.id,
    (
        SELECT id
        FROM loyalty_tiers
        WHERE is_active = 1
        ORDER BY sort_order, id
        LIMIT 1
    ),
    COALESCE(g.loyalty_points, 0),
    COALESCE(g.loyalty_points, 0),
    COALESCE(g.total_stays, 0),
    COALESCE(g.total_spent, 0)
FROM loyalty_members lm
JOIN guests g ON g.id = lm.guest_id
WHERE g.deleted_at IS NULL
  AND g.guest_type = 'member'
  AND NOT EXISTS (
      SELECT 1
      FROM loyalty_accounts existing
      WHERE existing.member_id = lm.id
  );

INSERT INTO loyalty_transactions (
    member_id,
    account_id,
    transaction_type,
    points_delta,
    available_delta,
    balance_after,
    source_type,
    source_id,
    description,
    created_at
)
SELECT
    lm.id,
    la.id,
    'adjusted',
    COALESCE(g.loyalty_points, 0),
    COALESCE(g.loyalty_points, 0),
    COALESCE(g.loyalty_points, 0),
    'legacy_guest_points',
    g.id,
    'Opening balance from guest loyalty points',
    COALESCE(g.created_at, datetime('now'))
FROM loyalty_members lm
JOIN loyalty_accounts la ON la.member_id = lm.id
JOIN guests g ON g.id = lm.guest_id
WHERE g.deleted_at IS NULL
  AND g.guest_type = 'member'
  AND COALESCE(g.loyalty_points, 0) <> 0
  AND NOT EXISTS (
      SELECT 1
      FROM loyalty_transactions existing
      WHERE existing.member_id = lm.id
        AND existing.source_type = 'legacy_guest_points'
        AND existing.source_id = g.id
        AND existing.transaction_type = 'adjusted'
  );


-- Source migration 015: housekeeping_maintenance
INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission) VALUES
('housekeeping:read', 'housekeeping', 'read', 'View housekeeping tasks and board', 1),
('housekeeping:create', 'housekeeping', 'create', 'Create housekeeping tasks', 1),
('housekeeping:update', 'housekeeping', 'update', 'Update housekeeping task status and assignments', 1),
('housekeeping:manage', 'housekeeping', 'manage', 'Full housekeeping management', 1),
('maintenance:read', 'maintenance', 'read', 'View maintenance tickets', 1),
('maintenance:write', 'maintenance', 'write', 'Create and update maintenance tickets', 1),
('maintenance:manage', 'maintenance', 'manage', 'Full maintenance management', 1),
('navigation_housekeeping:read', 'navigation:housekeeping', 'read', 'Show Housekeeping navigation', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'manager')
  AND p.name IN (
    'housekeeping:read', 'housekeeping:create', 'housekeeping:update', 'housekeeping:manage',
    'maintenance:read', 'maintenance:write', 'maintenance:manage',
    'navigation_housekeeping:read'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
  AND p.name IN (
    'housekeeping:read', 'housekeeping:create', 'housekeeping:update',
    'navigation_housekeeping:read'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'housekeeping'
  AND p.name IN (
    'rooms:read', 'rooms:update',
    'housekeeping:read', 'housekeeping:create', 'housekeeping:update', 'housekeeping:manage',
    'maintenance:read', 'maintenance:write',
    'navigation_housekeeping:read', 'navigation_room_management:read'
  );

INSERT INTO route_access_policies (
    route_id, path, nav_label, nav_group, required_permissions, required_roles,
    excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation
)
VALUES (
    'housekeeping', '/housekeeping', 'Housekeeping', 'operations',
    '["housekeeping:read"]', '[]', '[]',
    '["navigation_housekeeping:read","housekeeping:read"]', '[]', '["guest"]', 1
)
ON CONFLICT(route_id) DO UPDATE SET
    path = excluded.path,
    nav_label = excluded.nav_label,
    nav_group = excluded.nav_group,
    required_permissions = excluded.required_permissions,
    nav_permissions = excluded.nav_permissions,
    nav_excluded_roles = excluded.nav_excluded_roles,
    is_navigation = excluded.is_navigation,
    updated_at = datetime('now');


-- Source migration 019: companies_rbac
-- Define companies:* RBAC permissions for corporate billing account management.
-- Mirrors the PostgreSQL seed in database/data.sql. Before this, routes/companies.rs
-- gated only with require_auth, so any authenticated user could create/edit/delete
-- corporate billing accounts. Grants mirror the customer-ledger role assignments:
-- super_admin/admin/manager get full management, receptionist gets read+create.

INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission) VALUES
('companies:read', 'companies', 'read', 'View corporate billing accounts', 1),
('companies:create', 'companies', 'create', 'Create corporate billing accounts', 1),
('companies:update', 'companies', 'update', 'Update corporate billing accounts', 1),
('companies:delete', 'companies', 'delete', 'Delete corporate billing accounts', 1),
('companies:manage', 'companies', 'manage', 'Full corporate billing account management', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('super_admin', 'admin', 'manager')
AND p.name IN (
    'companies:read',
    'companies:create',
    'companies:update',
    'companies:delete',
    'companies:manage'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
AND p.name IN ('companies:read', 'companies:create');


-- Source migration 023: payments_refund_rbac
-- Restore front-desk checkout after the payments RBAC hardening (user
-- decision 2026-07-12). refund_deposit/revert_deposit_refund were gated on
-- payments:manage, and update/delete on payments:update/delete -- none of
-- which the receptionist role holds, breaking the routine checkout flow
-- (deposit refund, fixing a mis-keyed payment) in CheckoutInvoiceModal.
-- A dedicated payments:refund permission now gates refund/revert
-- (routes/payments.rs); receptionist additionally gets update/delete.
-- Manager needs no explicit refund grant at check time (payments:manage
-- implies all payments actions via rbac_cache::has_permission), but is
-- granted explicitly for visibility in role-permission listings.

-- payments:update / payments:delete were never defined in the SQLite seed
-- (001 only created read/create/manage for payments, unlike data.sql which
-- defines all five) -- define them here so the receptionist grant below can
-- bind and so payments:update/delete route gates work on SQLite at all.
INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission) VALUES
('payments:update', 'payments', 'update', 'Update payments', 1),
('payments:delete', 'payments', 'delete', 'Delete payment records', 1),
('payments:refund', 'payments', 'refund', 'Refund and revert deposit payments', 1);

-- Mirror data.sql role coverage for the newly defined update/delete:
-- admin got a blanket all-permissions grant in 001 that predates these rows,
-- and manager's 001 grant was likewise a point-in-time filter, so both need
-- explicit grants here (payments:manage already implies these at check time
-- via rbac_cache, but explicit rows keep role listings accurate).
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('super_admin', 'admin', 'manager')
AND p.name IN ('payments:update', 'payments:delete');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('super_admin', 'admin', 'manager', 'receptionist')
AND p.name = 'payments:refund';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
AND p.name IN ('payments:update', 'payments:delete');


-- Source migration 024: support_workflow
-- Guest support queue permissions, navigation policy, and runtime defaults.
-- Values are only inserted on first run so a property can tune SLAs without
-- having its choices reset on every desktop start.

INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission) VALUES
('support:read', 'support', 'read', 'View guest support conversations', 1),
('support:write', 'support', 'write', 'Reply to and resolve assigned guest support conversations', 1),
('support:assign', 'support', 'assign', 'Claim, assign, and hand off guest support conversations', 1),
('support:escalate', 'support', 'escalate', 'Escalate guest support conversations', 1),
('support:manage', 'support', 'manage', 'Full guest support management', 1),
('navigation_support:read', 'navigation:support', 'read', 'Show Support navigation', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('super_admin', 'admin', 'manager')
  AND p.name IN (
      'support:read', 'support:write', 'support:assign', 'support:escalate',
      'support:manage', 'navigation_support:read'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
  AND p.name IN (
      'support:read', 'support:write', 'support:assign', 'support:escalate',
      'navigation_support:read'
  );

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'support_readonly'
  AND p.name IN ('support:read', 'navigation_support:read');

INSERT INTO route_access_policies (
    route_id, path, nav_label, nav_group, required_permissions, required_roles,
    excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation,
    is_system_policy
)
VALUES (
    'support', '/support', 'Support', 'operations', '["support:read"]', '[]', '[]',
    '["navigation_support:read","support:read"]', '[]', '["guest"]', 1, 1
)
ON CONFLICT(route_id) DO UPDATE SET
    path = excluded.path,
    nav_label = excluded.nav_label,
    nav_group = excluded.nav_group,
    required_permissions = excluded.required_permissions,
    required_roles = excluded.required_roles,
    excluded_roles = excluded.excluded_roles,
    nav_permissions = excluded.nav_permissions,
    nav_roles = excluded.nav_roles,
    nav_excluded_roles = excluded.nav_excluded_roles,
    is_navigation = excluded.is_navigation,
    is_system_policy = excluded.is_system_policy,
    updated_at = datetime('now');

INSERT INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES
    ('support_enabled', 'true', 'boolean', 'support', 'Enable guest portal support conversations', 0),
    ('support_categories', '["booking","stay","billing","loyalty","technical","other"]', 'json', 'support', 'Guest-selectable support conversation categories', 0),
    ('support_first_response_low_minutes', '240', 'number', 'support', 'First-response SLA for low priority support conversations in minutes', 0),
    ('support_first_response_normal_minutes', '60', 'number', 'support', 'First-response SLA for normal priority support conversations in minutes', 0),
    ('support_first_response_high_minutes', '15', 'number', 'support', 'First-response SLA for high priority support conversations in minutes', 0),
    ('support_first_response_urgent_minutes', '5', 'number', 'support', 'First-response SLA for urgent priority support conversations in minutes', 0),
    ('support_resolution_low_minutes', '1440', 'number', 'support', 'Resolution SLA for low priority support conversations in minutes', 0),
    ('support_resolution_normal_minutes', '480', 'number', 'support', 'Resolution SLA for normal priority support conversations in minutes', 0),
    ('support_resolution_high_minutes', '120', 'number', 'support', 'Resolution SLA for high priority support conversations in minutes', 0),
    ('support_resolution_urgent_minutes', '30', 'number', 'support', 'Resolution SLA for urgent priority support conversations in minutes', 0),
    ('support_reopen_window_days', '7', 'number', 'support', 'Days a resolved guest support conversation can be reopened by its guest', 0)
ON CONFLICT(key) DO UPDATE SET
    value_type = excluded.value_type,
    category = excluded.category,
    description = excluded.description,
    is_sensitive = excluded.is_sensitive,
    updated_at = datetime('now');


-- Source migration 026: promotions_vouchers
-- Promotions and vouchers use read/manage actions already accepted by the
-- shared RBAC validator. Guest discovery and claims are session-scoped and do
-- not require granting these administrative permissions to the guest role.

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('promotions:read', 'promotions', 'read', 'View promotions and promotion performance', 1),
    ('promotions:manage', 'promotions', 'manage', 'Create and manage promotions', 1),
    ('vouchers:read', 'vouchers', 'read', 'View issued vouchers and redemptions', 1),
    ('vouchers:manage', 'vouchers', 'manage', 'Issue, revoke, and manage vouchers', 1),
    ('navigation_promotions:read', 'navigation:promotions', 'read', 'Show Promotions navigation', 1)
ON CONFLICT(name) DO UPDATE SET
    resource = excluded.resource,
    action = excluded.action,
    description = excluded.description,
    is_system_permission = excluded.is_system_permission;

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('super_admin', 'admin')
  AND p.name IN (
      'promotions:read', 'promotions:manage',
      'vouchers:read', 'vouchers:manage',
      'navigation_promotions:read'
  );

INSERT INTO route_access_policies (
    route_id, path, nav_label, nav_group, required_permissions, required_roles,
    excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation,
    is_system_policy
)
VALUES (
    'promotions', '/promotions', 'Promotions', 'admin', '["promotions:read"]', '[]', '[]',
    '["navigation_promotions:read","promotions:read"]', '[]', '["guest"]', 1, 1
)
ON CONFLICT(route_id) DO UPDATE SET
    path = excluded.path,
    nav_label = excluded.nav_label,
    nav_group = excluded.nav_group,
    required_permissions = excluded.required_permissions,
    required_roles = excluded.required_roles,
    excluded_roles = excluded.excluded_roles,
    nav_permissions = excluded.nav_permissions,
    nav_roles = excluded.nav_roles,
    nav_excluded_roles = excluded.nav_excluded_roles,
    is_navigation = excluded.is_navigation,
    is_system_policy = excluded.is_system_policy,
    updated_at = datetime('now');
