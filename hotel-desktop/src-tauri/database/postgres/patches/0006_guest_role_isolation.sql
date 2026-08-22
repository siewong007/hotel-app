-- Guest role isolation: the seeded `guest` role historically held
-- bookings:create and bookings:read, which let any self-registered guest list
-- every booking in the hotel (full guest PII), read arbitrary booking
-- details, and create bookings with forged money fields through the
-- staff-side /api/bookings surface. Guests must use the scoped
-- /api/guest-portal/* endpoints instead (tests/guest_booking_isolation.rs).
--
-- Companion route-policy fix: /timeline requires only rooms:read and its
-- required-side excluded_roles shipped empty, so a logged-in guest could open
-- it by URL; the page fires GET /api/bookings on mount. Exclude the guest
-- role to match the fresh-seed policy.
DO $guest_booking_isolation$
DECLARE
    missing_roles text;
    missing_permissions text;
BEGIN
    SELECT string_agg(expected.name, ', ') INTO missing_roles
    FROM (VALUES ('guest'::text)) AS expected(name)
    WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.name = expected.name);

    IF missing_roles IS NOT NULL THEN
        RAISE EXCEPTION 'guest_booking_isolation preflight failed: roles missing: %', missing_roles;
    END IF;

    SELECT string_agg(expected.name, ', ') INTO missing_permissions
    FROM (VALUES ('bookings:create'::text), ('bookings:read')) AS expected(name)
    WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.name = expected.name);

    IF missing_permissions IS NOT NULL THEN
        RAISE EXCEPTION 'guest_booking_isolation preflight failed: permissions missing: %', missing_permissions;
    END IF;

    DELETE FROM public.role_permissions rp
    USING public.roles r, public.permissions p
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND r.name = 'guest'
      AND p.name IN ('bookings:create', 'bookings:read');

    UPDATE public.route_access_policies
    SET excluded_roles = '["guest"]'::jsonb,
        updated_at = CURRENT_TIMESTAMP
    WHERE route_id = 'timeline'
      AND is_system_policy
      AND excluded_roles IS DISTINCT FROM '["guest"]'::jsonb;
END;
$guest_booking_isolation$;
