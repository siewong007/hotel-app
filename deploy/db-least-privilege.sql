-- Run as the schema owner after applying the catalog, before restarting the API.
-- Password is provisioned separately over psql stdin by deploy.sh.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_app') THEN
        CREATE ROLE hotel_app LOGIN;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = 'hotel_app'::regrole)
       OR EXISTS (
           SELECT 1 FROM pg_shdepend
           WHERE refclassid = 'pg_authid'::regclass
             AND refobjid = 'hotel_app'::regrole
             AND deptype = 'o'
       ) THEN
        RAISE EXCEPTION 'hotel_app must not own objects or inherit other roles';
    END IF;
    ALTER ROLE hotel_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO hotel_app', current_database());
END
$$;
-- The role may retain database-level grants from an earlier provisioning.
SELECT format('REVOKE CREATE ON DATABASE %I FROM PUBLIC, hotel_app', current_database()) \gexec
-- Prevent runtime-created objects shadowing the pinned capability search path.
REVOKE CREATE ON SCHEMA public, app FROM PUBLIC, hotel_app;
GRANT USAGE ON SCHEMA public, app TO hotel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hotel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.invalid_data_quarantine TO hotel_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public, app TO hotel_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.hotel_schema_revisions FROM hotel_app;
GRANT EXECUTE ON FUNCTION public.transfer_import_ddl(text,text,text,text), public.maintain_audit_partition(date) TO hotel_app;
-- These defaults belong to the executing migrator/schema-owner role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hotel_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, app
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO hotel_app;
COMMIT;
