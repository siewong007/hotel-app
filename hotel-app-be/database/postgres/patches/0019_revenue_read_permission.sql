-- Revenue & Marketing phase 1: revenue:read permission, navigation grant,
-- and the /revenue route policy for live V1 databases.
--
-- Fresh installs get these rows from seed.sql; installed databases need them
-- delivered here because the seed is a one-shot bootstrap. Grants are
-- additive and idempotent: admin/super_admin hold every permission, manager
-- owns revenue analytics, and the route policy mirrors the seed backfill so
-- accessControlled navigation resolves identically on old and new databases.
DO $revenue_read_permission$
DECLARE
    missing_roles text;
BEGIN
    SELECT string_agg(expected.name, ', ') INTO missing_roles
    FROM (VALUES ('admin'::text), ('super_admin'), ('manager')) AS expected(name)
    WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.name = expected.name);

    IF missing_roles IS NOT NULL THEN
        RAISE EXCEPTION 'revenue_read_permission preflight failed: roles missing: %', missing_roles;
    END IF;

    INSERT INTO public.permissions (name, resource, action, description, is_system_permission)
    VALUES
        ('revenue:read', 'revenue', 'read', 'View revenue performance, pricing, and occupancy analytics', true),
        ('navigation_revenue:read', 'navigation:revenue', 'read', 'Show Revenue navigation', true)
    ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        resource = EXCLUDED.resource,
        action = EXCLUDED.action,
        is_system_permission = EXCLUDED.is_system_permission;

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM public.roles r
    CROSS JOIN public.permissions p
    WHERE r.name IN ('admin', 'super_admin')
      AND p.name IN ('revenue:read', 'navigation_revenue:read')
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM public.roles r
    CROSS JOIN public.permissions p
    WHERE r.name = 'manager'
      AND p.name IN ('revenue:read', 'navigation_revenue:read')
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    INSERT INTO public.route_access_policies (
        route_id, path, nav_label, nav_group, required_permissions, required_roles,
        excluded_roles, nav_permissions, nav_roles, nav_excluded_roles,
        is_navigation, is_system_policy
    )
    VALUES (
        'revenue', '/revenue', 'Revenue', 'revenue',
        '["revenue:read"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
        '["navigation_revenue:read","revenue:read"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
        true, true
    )
    ON CONFLICT (route_id) DO UPDATE SET
        path = EXCLUDED.path,
        nav_label = EXCLUDED.nav_label,
        nav_group = EXCLUDED.nav_group,
        required_permissions = EXCLUDED.required_permissions,
        required_roles = EXCLUDED.required_roles,
        excluded_roles = EXCLUDED.excluded_roles,
        nav_permissions = EXCLUDED.nav_permissions,
        nav_roles = EXCLUDED.nav_roles,
        nav_excluded_roles = EXCLUDED.nav_excluded_roles,
        is_navigation = EXCLUDED.is_navigation,
        is_system_policy = EXCLUDED.is_system_policy,
        updated_at = CURRENT_TIMESTAMP;
END;
$revenue_read_permission$;
