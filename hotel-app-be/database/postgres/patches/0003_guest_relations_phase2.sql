-- Guest Relations phase 2 route policies.
--
-- The 'guest-relations' nav policy is repointed from /guest-relations/guests
-- to /guest-relations, where the new overview dashboard lands; the guest list
-- keeps its own non-navigation policy under 'guest-relations-detail'. A second
-- non-navigation policy, 'guest-relations-follow-ups', covers the
-- /guest-relations/follow-ups queue page with the same guests:read /
-- guests:manage gate as the detail policy.
--
-- Fresh installs already carry both rows from seed.sql; this patch converges
-- installed V1 databases onto the same policies. Both statements are
-- idempotent: the UPDATE pins the path and the INSERT only adds the policy
-- when the route_id is absent.

UPDATE route_access_policies SET path = '/guest-relations' WHERE route_id = 'guest-relations';
INSERT INTO route_access_policies (route_id, path, nav_label, nav_group, required_permissions, required_roles, excluded_roles, nav_permissions, nav_roles, nav_excluded_roles, is_navigation, is_system_policy)
SELECT 'guest-relations-follow-ups', '/guest-relations/follow-ups', NULL, NULL,
       '["guests:read","guests:manage"]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb,
       '[]'::jsonb, '[]'::jsonb, '["guest"]'::jsonb, false, true
WHERE NOT EXISTS (SELECT 1 FROM route_access_policies WHERE route_id = 'guest-relations-follow-ups');
