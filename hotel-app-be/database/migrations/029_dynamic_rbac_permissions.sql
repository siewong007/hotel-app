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
