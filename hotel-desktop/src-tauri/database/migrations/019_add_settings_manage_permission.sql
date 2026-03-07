-- Migration: Add settings:manage permission for data transfer and settings pages
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
