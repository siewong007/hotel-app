-- Patch: seed the system permissions and the tax setting that V1 declared but
-- never inserted (PostgreSQL)
-- Date: 2026-07-27
--
-- Background: data.sql declares a canonical list of system permissions in
-- `expected_system_permissions`, computes how many of them are missing into
-- `missing_seed_count` -- and then never looked at the result, while its three
-- sibling counters all raised. Eight names were therefore promised and never
-- delivered. Three of them gate live routes with no `:manage` sibling to fall
-- back on, so those endpoints returned 403 to EVERY role, super_admin
-- included, on every fresh V1 install:
--
--   * audit:export     -> GET /api/audit-logs/export/csv        (unreachable)
--   * loyalty:read     -> the loyalty admin read endpoints      (unreachable)
--   * loyalty:manage   -> 7 loyalty admin endpoints             (unreachable)
--
-- The other five existed only implicitly, rescued by their `:manage` sibling,
-- so they worked but at a wider privilege than the code declared:
--
--   * rooms:write, permissions:create/read/update/delete
--
-- Arming the guard also surfaced `service_tax_rate`, a system setting six
-- backend call sites read (falling back to 8) and the frontend invoice
-- calculator divides by with no fallback at all -- an absent row makes that
-- calculation NaN. Seeded at 8 to match the backend default, so no server-side
-- number changes.
--
-- Safe to run more than once:
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-27-missing-system-permissions.sql

BEGIN;

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('audit:export',       'audit',       'export', 'Export audit logs', true),
    ('loyalty:read',       'loyalty',     'read',   'View loyalty programme data', true),
    ('loyalty:manage',     'loyalty',     'manage', 'Full control over the loyalty programme', true),
    ('rooms:write',        'rooms',       'write',  'Create or modify rooms', true),
    ('permissions:create', 'permissions', 'create', 'Create permissions', true),
    ('permissions:read',   'permissions', 'read',   'View permissions', true),
    ('permissions:update', 'permissions', 'update', 'Update permissions', true),
    ('permissions:delete', 'permissions', 'delete', 'Delete permissions', true)
ON CONFLICT (name) DO NOTHING;

-- admin/super_admin hold every system permission. On a fresh install the
-- CROSS JOIN in data.sql does this; an existing database needs it explicitly,
-- and without it the three unreachable endpoints above stay unreachable.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.name IN (
    'audit:export', 'loyalty:read', 'loyalty:manage', 'rooms:write',
    'permissions:create', 'permissions:read', 'permissions:update', 'permissions:delete'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Manager already reaches the Loyalty page (its route policy gates on
-- analytics:read); without these the page loads and every call in it 403s.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'manager'
  AND p.name IN ('loyalty:read', 'loyalty:manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- The auditor role exists for compliance review; exporting the trail is the
-- one action that job needs beyond reading it.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'auditor'
  AND p.name IN ('audit:read', 'audit:export')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO system_settings (key, value, value_type, category, description, is_public)
VALUES ('service_tax_rate', '8', 'number', 'tax',
        'Service tax percentage applied to room charges', true)
ON CONFLICT (key) DO NOTHING;

COMMIT;
