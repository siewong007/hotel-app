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
