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
