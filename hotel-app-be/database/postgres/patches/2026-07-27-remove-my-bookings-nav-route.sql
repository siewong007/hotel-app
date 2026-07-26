-- Patch: remove the retired 'my-bookings' navigation route (PostgreSQL)
-- Date: 2026-07-27
--
-- Purpose: bring an already-initialized V1 database in line with
-- database/postgres/data.sql, which no longer seeds the 'my-bookings'
-- route_access_policies row.
--
-- The legacy /my-bookings page was the guest-only predecessor of the guest
-- portal. It has been deleted from the frontend (route, page, registry entry)
-- and its backend endpoints (GET /bookings/my-bookings and
-- POST /bookings/my-bookings/{id}/cancel) have been removed. The guest portal
-- (/guest-portal, backed by /guest-portal/me/bookings) is now the only guest
-- booking surface, and DashboardRouter already redirects every guest there.
--
-- Why this patch is needed at all: the sidebar is built from the frontend
-- routeRegistry, not from this table, so a stale row does NOT put a dead link
-- in the guest navigation. It does, however, keep rendering a phantom
-- "My Bookings" toggle in Access Control -> Roles -> Navigation Access, which
-- builds its list from route_access_policies (see
-- features/admin/components/rbac/RolesTab/NavigationAccessSection.tsx). This
-- patch is therefore admin-UI hygiene, not a functional fix.
--
-- Deliberate divergence from data.sql's quarantine-don't-delete philosophy:
-- this DELETEs the policy row rather than quarantining it. A navigation route
-- carries no authorization history of its own -- the grants live on the
-- permissions it cites ('bookings:read'), which many surviving routes also
-- cite and which this patch leaves untouched.
--
-- The orphaned 'navigation_my_bookings:read' permission is intentionally NOT
-- deleted. It is never INSERTed by data.sql (it exists only on databases that
-- came through upgrade/pg18_4_to_v1.sql), and permissions.id is the target of
-- TWO ON DELETE CASCADE foreign keys -- role_permissions.permission_id
-- (0001_v1_baseline.sql:9103) and user_permissions.permission_id
-- (0001_v1_baseline.sql:9423). Deleting it would silently drop per-role AND
-- per-user grant history, which data.sql explicitly preserves ("intentionally
-- retained so the one important database never loses authorization history").
-- An unreferenced permission row is inert.
--
-- Safe to run more than once:
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-27-remove-my-bookings-nav-route.sql

\set ON_ERROR_STOP on

BEGIN;

DELETE FROM route_access_policies
WHERE route_id = 'my-bookings';

COMMIT;
