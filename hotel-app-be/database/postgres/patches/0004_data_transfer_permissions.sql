-- Data Transfer privileged permissions.
--
-- The data-transfer surface moves off `settings:manage` + the super-admin flag
-- onto a dedicated `data_transfer:*` permission set (view / export /
-- export_sensitive / import / import_sensitive / override / restore /
-- manage). Fresh installs already carry the rows and the repointed
-- 'data-transfer' route policy from seed.sql; this patch converges installed
-- V1 databases. `admin` and `super_admin` receive the grants to match the
-- blanket seed grant; no other role is touched. Every statement is
-- idempotent: inserts skip existing rows and the UPDATE pins the policy.
--
-- The new names use action verbs outside the baseline's `valid_action`
-- vocabulary (`view`, `export_sensitive`, `import`, `import_sensitive`,
-- `restore`), so the constraint is rebuilt with the extended list first —
-- the baseline carries the same widened set for fresh installs. All prior
-- actions remain valid, so existing rows validate against the replacement.

ALTER TABLE permissions DROP CONSTRAINT valid_action;
ALTER TABLE permissions ADD CONSTRAINT valid_action CHECK ((action)::text = ANY ((ARRAY['create','read','update','delete','manage','execute','void','refund','write','verify','review','assign','approve','reject','escalate','override','export','download','reveal','request_resubmission','view_provider_raw','manage_reason_codes','manage_risk_rules','compose','send','view','export_sensitive','import','import_sensitive','restore'])::text[]));

INSERT INTO permissions (name, resource, action, description, is_system_permission)
VALUES
    ('data_transfer:view', 'data_transfer', 'view', 'View the data transfer page and transfer history', true),
    ('data_transfer:export', 'data_transfer', 'export', 'Export standard (non-sensitive) data', true),
    ('data_transfer:export_sensitive', 'data_transfer', 'export_sensitive', 'Export sensitive and full-system backup data', true),
    ('data_transfer:import', 'data_transfer', 'import', 'Import non-sensitive data', true),
    ('data_transfer:import_sensitive', 'data_transfer', 'import_sensitive', 'Import files containing sensitive data', true),
    ('data_transfer:override', 'data_transfer', 'override', 'Update existing records during import', true),
    ('data_transfer:restore', 'data_transfer', 'restore', 'Run destructive restore/replace imports', true),
    ('data_transfer:manage', 'data_transfer', 'manage', 'Full data transfer management', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('admin', 'super_admin')
  AND p.name LIKE 'data_transfer:%'
ON CONFLICT (role_id, permission_id) DO NOTHING;

UPDATE route_access_policies
SET required_permissions = '["data_transfer:view"]'::jsonb,
    nav_permissions = '["data_transfer:view","data_transfer:manage"]'::jsonb
WHERE route_id = 'data-transfer';
