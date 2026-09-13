-- Revenue & Marketing phase 2: /rates route access policy for live V1
-- databases. Fresh installs get this row from seed.sql; installed databases
-- need it delivered here because the seed is a one-shot bootstrap. The row is
-- additive and idempotent and mirrors the seed so accessControlled
-- navigation resolves identically on old and new databases. Reuses the
-- revenue:read / navigation_revenue:read permissions shipped in patch 0019.
DO $rates_route_policy$
BEGIN
    INSERT INTO public.route_access_policies (
        route_id, path, nav_label, nav_group, required_permissions, required_roles,
        excluded_roles, nav_permissions, nav_roles, nav_excluded_roles,
        is_navigation, is_system_policy
    )
    VALUES (
        'rates', '/rates', 'Rates', 'revenue',
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
$rates_route_policy$;
