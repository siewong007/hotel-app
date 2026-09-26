-- Online inventory write permission.
--
-- Changing online inventory (online sales on/off, walk-in holds and
-- guest-facing custom online prices) moves off `rooms:update` onto a
-- dedicated `online_inventory:manage` permission. Viewing the Online
-- Inventory page and its read API stays on `rooms:update`, so front-desk and
-- housekeeping staff keep a read-only view; only the roles granted here can
-- write.
--
-- Fresh installs already carry the row and the grants from seed.sql (admin
-- and super_admin through the blanket grant, manager through its explicit
-- list); this patch converges installed V1 databases to the same state. Roles
-- are looked up by name. Every statement is idempotent: inserts skip existing
-- rows, and no existing grant is removed.

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES (
    'online_inventory:manage',
    'online_inventory',
    'manage',
    'Change online inventory: online sales, walk-in holds and custom online prices',
    true
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('super_admin', 'admin', 'manager')
  AND p.name = 'online_inventory:manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
