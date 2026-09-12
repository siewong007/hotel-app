-- Least-privilege split for the hotel_management database.
--
-- Today the backend connects as `hotel_admin`, a full PostgreSQL superuser:
-- any query bug becomes unbounded, and BYPASSRLS defeats every future
-- row-level-security policy. This script creates a runtime role `hotel_app`
-- with only the privileges the API needs (DML + sequences) and leaves
-- `hotel_admin` as the migrator/owner role used by apply-patches.sh.
--
-- Operator runbook (tested against dev before prod):
--   1. Run this file once:  psql "$DATABASE_URL" -f deploy/db-least-privilege.sql
--   2. Point the backend's DATABASE_URL at hotel_app and restart.
--   3. Keep hotel_admin for apply-patches.sh / seed.sql only.
-- Idempotent: safe to re-run; never downgrades hotel_admin itself.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_app') THEN
        CREATE ROLE hotel_app LOGIN;
    END IF;
END
$$;

-- The operator sets the password out-of-band so it never sits in this file:
--   ALTER ROLE hotel_app PASSWORD '...';
-- (Run that before pointing DATABASE_URL at the new role.)

GRANT CONNECT ON DATABASE hotel_management TO hotel_app;
GRANT USAGE ON SCHEMA public TO hotel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hotel_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO hotel_app;

-- New objects created by the migrator role stay usable by the runtime role.
ALTER DEFAULT PRIVILEGES FOR ROLE hotel_admin IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hotel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hotel_admin IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO hotel_app;

COMMIT;
