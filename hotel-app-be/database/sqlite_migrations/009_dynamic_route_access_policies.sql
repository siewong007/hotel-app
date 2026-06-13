-- ============================================================================
-- SQLITE MIGRATION 009: DYNAMIC ROUTE ACCESS POLICIES
-- ============================================================================
-- Description: Store frontend route/navigation RBAC policy in the database so
--              clients consume policy from the backend instead of hardcoding it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS route_access_policies (
    route_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    nav_label TEXT,
    nav_group TEXT,
    required_permissions TEXT NOT NULL DEFAULT '[]',
    required_roles TEXT NOT NULL DEFAULT '[]',
    excluded_roles TEXT NOT NULL DEFAULT '[]',
    nav_permissions TEXT NOT NULL DEFAULT '[]',
    nav_roles TEXT NOT NULL DEFAULT '[]',
    nav_excluded_roles TEXT NOT NULL DEFAULT '[]',
    is_navigation INTEGER NOT NULL DEFAULT 0,
    is_system_policy INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
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
    ('timeline', '/timeline', 'Timeline', 'main', '["rooms:read"]', '[]', '[]', '["navigation_timeline:read","bookings:read"]', '[]', '[]', 1),
    ('guest-config', '/guest-config', 'Guests', 'main', '["guests:read","guests:manage"]', '[]', '[]', '["navigation_guest_config:read","guests:read","guests:manage"]', '[]', '[]', 1),
    ('bookings', '/bookings', 'Bookings', 'main', '["bookings:read","bookings:manage"]', '[]', '[]', '["navigation_bookings:read","bookings:read","bookings:manage"]', '[]', '[]', 1),
    ('my-bookings', '/my-bookings', 'My Bookings', 'main', '["bookings:read"]', '[]', '["super_admin","admin","manager","receptionist","staff"]', '["navigation_my_bookings:read","bookings:read"]', '[]', '["super_admin","admin","manager","receptionist","staff"]', 1),
    ('room-management', '/room-management', 'Rooms', 'main', '["rooms:read","rooms:manage"]', '[]', '[]', '["navigation_room_management:read","rooms:read","rooms:manage"]', '[]', '[]', 1),
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
    ('complimentary', '/complimentary', 'Complimentary Nights', 'admin', '["bookings:read","bookings:update"]', '[]', '[]', '["navigation_complimentary:read","bookings:read","bookings:update"]', '[]', '[]', 1),
    ('data-transfer', '/data-transfer', 'Data Transfer', 'admin', '["settings:manage"]', '[]', '[]', '["navigation_data_transfer:read","settings:manage"]', '[]', '[]', 1)
ON CONFLICT(route_id) DO NOTHING;
