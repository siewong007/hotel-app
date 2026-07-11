-- Define companies:* RBAC permissions for corporate billing account management.
-- Mirrors the PostgreSQL seed in database/data.sql. Before this, routes/companies.rs
-- gated only with require_auth, so any authenticated user could create/edit/delete
-- corporate billing accounts. Grants mirror the customer-ledger role assignments:
-- super_admin/admin/manager get full management, receptionist gets read+create.

INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission) VALUES
('companies:read', 'companies', 'read', 'View corporate billing accounts', 1),
('companies:create', 'companies', 'create', 'Create corporate billing accounts', 1),
('companies:update', 'companies', 'update', 'Update corporate billing accounts', 1),
('companies:delete', 'companies', 'delete', 'Delete corporate billing accounts', 1),
('companies:manage', 'companies', 'manage', 'Full corporate billing account management', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('super_admin', 'admin', 'manager')
AND p.name IN (
    'companies:read',
    'companies:create',
    'companies:update',
    'companies:delete',
    'companies:manage'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
AND p.name IN ('companies:read', 'companies:create');
