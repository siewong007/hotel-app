-- ============================================================================
-- Migration: Add customer-ledger RBAC permissions
-- Description: Gate customer ledger reads, mutations, voids, and management.
-- ============================================================================

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('ledgers:read', 'ledgers', 'read', 'View customer ledger entries and payments', true),
    ('ledgers:create', 'ledgers', 'create', 'Create customer ledger entries and record ledger payments', true),
    ('ledgers:update', 'ledgers', 'update', 'Update customer ledger entries and payment dates', true),
    ('ledgers:void', 'ledgers', 'void', 'Void customer ledger entries and create reversals', true),
    ('ledgers:manage', 'ledgers', 'manage', 'Full customer ledger management', true)
ON CONFLICT (name) DO UPDATE SET
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    is_system_permission = EXCLUDED.is_system_permission;

INSERT INTO role_permissions (role_id, permission_id)
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
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
AND p.name IN ('ledgers:read', 'ledgers:create')
ON CONFLICT (role_id, permission_id) DO NOTHING;
