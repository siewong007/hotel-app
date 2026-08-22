-- Manager audit:read grant (decisions-needed.md item 4, approved).
--
-- Managers approve payments in the Payment Approvals queue, but the conflict
-- banner on that screen is gated server-side on `audit:read`, which the seeded
-- manager role never received — approvers were flying blind on exactly the
-- surface they own. Grants are additive and idempotent; no other role changes.
DO $manager_audit_read$
DECLARE
    manager_role_missing boolean;
    permission_missing boolean;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'manager') THEN
        RAISE EXCEPTION 'manager_audit_read preflight failed: role manager is missing';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE name = 'audit:read') THEN
        RAISE EXCEPTION 'manager_audit_read preflight failed: permission audit:read is missing';
    END IF;

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM public.roles r
    CROSS JOIN public.permissions p
    WHERE r.name = 'manager'
      AND p.name = 'audit:read'
    ON CONFLICT (role_id, permission_id) DO NOTHING;
END;
$manager_audit_read$;
