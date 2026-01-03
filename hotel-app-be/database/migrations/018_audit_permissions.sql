-- ============================================================================
-- MIGRATION 018: AUDIT LOG PERMISSIONS
-- ============================================================================
-- Description: Add permissions for viewing and exporting audit logs
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
