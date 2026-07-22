-- Patch: payments:approve permission + /payment-approvals nav route (SQLite)
-- Date: 2026-07-21
--
-- Purpose: bring an ALREADY-INITIALIZED V1 SQLite database up to date with the
-- payments:approve staff feature. The embedded data.sql only runs once for a new
-- empty database, so apply this standalone, idempotent script to an existing DB:
--
--   sqlite3 "$DATABASE_PATH" < database/sqlite/patches/2026-07-21-payments-approve-permission.sql
--
-- Mirrors the rows a fresh SQLite data.sql install now produces:
--   * permission payments:approve (granted to admin, super_admin, manager on fresh install)
--   * navigation marker navigation_payment_approvals:read (granted to admin, super_admin)
--   * route_access_policies row for the /payment-approvals nav tab
-- INSERT OR IGNORE keeps this safe to run more than once.

-- 1. Permissions ------------------------------------------------------------
INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('payments:approve', 'payments', 'approve', 'Approve or reject pending payments', 1),
    ('navigation_payment_approvals:read', 'navigation:payment-approvals', 'read', 'Show Payment Approvals navigation', 1);

-- 2. Role grants ------------------------------------------------------------
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin', 'manager')
  AND p.name = 'payments:approve';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.name = 'navigation_payment_approvals:read';

-- 3. Nav route policy -------------------------------------------------------
INSERT INTO route_access_policies (
    route_id, path, nav_label, nav_group, required_permissions, required_roles,
    excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation
)
VALUES (
    'payment-approvals', '/payment-approvals', 'Payment Approvals', 'admin',
    '["payments:approve","payments:read"]', '[]', '[]',
    '["navigation_payment_approvals:read","payments:approve","payments:read"]', '[]', '[]', 1
)
ON CONFLICT(route_id) DO NOTHING;
