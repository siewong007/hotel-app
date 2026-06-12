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
