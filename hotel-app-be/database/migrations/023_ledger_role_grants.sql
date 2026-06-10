-- ============================================================================
-- Migration: Ensure core staff roles have customer-ledger permissions
-- Description: Explicitly grant ledger access to Super Administrator,
-- Administrator, Manager, and Receptionist roles.
-- ============================================================================

INSERT INTO role_permissions (role_id, permission_id)
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
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
AND p.name IN ('ledgers:read', 'ledgers:create')
ON CONFLICT (role_id, permission_id) DO NOTHING;
