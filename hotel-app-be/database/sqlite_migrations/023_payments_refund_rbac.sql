-- Restore front-desk checkout after the payments RBAC hardening (user
-- decision 2026-07-12). refund_deposit/revert_deposit_refund were gated on
-- payments:manage, and update/delete on payments:update/delete -- none of
-- which the receptionist role holds, breaking the routine checkout flow
-- (deposit refund, fixing a mis-keyed payment) in CheckoutInvoiceModal.
-- A dedicated payments:refund permission now gates refund/revert
-- (routes/payments.rs); receptionist additionally gets update/delete.
-- Manager needs no explicit refund grant at check time (payments:manage
-- implies all payments actions via rbac_cache::has_permission), but is
-- granted explicitly for visibility in role-permission listings.

-- payments:update / payments:delete were never defined in the SQLite seed
-- (001 only created read/create/manage for payments, unlike data.sql which
-- defines all five) -- define them here so the receptionist grant below can
-- bind and so payments:update/delete route gates work on SQLite at all.
INSERT OR IGNORE INTO permissions (name, resource, action, description, is_system_permission) VALUES
('payments:update', 'payments', 'update', 'Update payments', 1),
('payments:delete', 'payments', 'delete', 'Delete payment records', 1),
('payments:refund', 'payments', 'refund', 'Refund and revert deposit payments', 1);

-- Mirror data.sql role coverage for the newly defined update/delete:
-- admin got a blanket all-permissions grant in 001 that predates these rows,
-- and manager's 001 grant was likewise a point-in-time filter, so both need
-- explicit grants here (payments:manage already implies these at check time
-- via rbac_cache, but explicit rows keep role listings accurate).
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('super_admin', 'admin', 'manager')
AND p.name IN ('payments:update', 'payments:delete');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('super_admin', 'admin', 'manager', 'receptionist')
AND p.name = 'payments:refund';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'receptionist'
AND p.name IN ('payments:update', 'payments:delete');
