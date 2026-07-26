-- Patch: payments:approve permission + /payment-approvals nav route (PostgreSQL)
-- Date: 2026-07-21
--
-- Purpose: bring an ALREADY-INITIALIZED V1 PostgreSQL database up to date with the
-- payments:approve staff feature. data.sql is a one-time, guarded install and must
-- NOT be re-run against an existing V1 DB (it RAISEs on re-run), so apply this
-- standalone, idempotent script instead. Safe to run more than once.
--
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-21-payments-approve-permission.sql
--
-- Mirrors the rows that a fresh data.sql install now produces:
--   * permission payments:approve
--   * grant to admin / super_admin (they hold every permission on a fresh install;
--     manager is covered at authorization time by payments:manage implication, so
--     it gets no explicit row here, matching data.sql)
--   * route_access_policies row for the /payment-approvals nav tab

BEGIN;

-- 1. Permission -------------------------------------------------------------
INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES ('payments:approve', 'payments', 'approve', 'Approve or reject pending payments', true)
ON CONFLICT (name) DO NOTHING;

-- 2. Role grants (admin + super_admin hold all permissions on a fresh install) --
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.name = 'payments:approve'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. Nav route policy -------------------------------------------------------
INSERT INTO route_access_policies (
    route_id, path, nav_label, nav_group, required_permissions, required_roles,
    excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation, is_system_policy
)
VALUES (
    'payment-approvals', '/payment-approvals', 'Payment Approvals', 'admin',
    '["payments:approve","payments:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '["payments:approve","payments:read"]'::jsonb, '[]'::jsonb, '[]'::jsonb, true, true
)
ON CONFLICT (route_id) DO NOTHING;

COMMIT;
