-- Run as database owner on an isolated baseline+seed+patched test database,
-- after deploy/db-least-privilege.sql. All application changes roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE hotel_app;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND
        (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
        RAISE EXCEPTION 'runtime role has administrative privileges';
    END IF;
    BEGIN
        CREATE TABLE public.runtime_forbidden(id int);
        RAISE EXCEPTION 'runtime unexpectedly created a table';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        CREATE SCHEMA runtime_forbidden;
        RAISE EXCEPTION 'runtime unexpectedly created a schema';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        ALTER TABLE public.guests ADD COLUMN runtime_forbidden int;
        RAISE EXCEPTION 'runtime unexpectedly altered a table';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        UPDATE public.hotel_schema_revisions SET name = name;
        RAISE EXCEPTION 'runtime unexpectedly wrote schema revisions';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        EXECUTE format('SET ROLE %I', pg_get_userbyid((
            SELECT relowner FROM pg_class WHERE oid = 'public.users'::regclass
        )));
        RAISE EXCEPTION 'runtime unexpectedly switched to the table owner';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT public.transfer_import_ddl('public','users','fk_defer','fk_users_guest');
SELECT public.transfer_import_ddl('public','guests','fk_defer','guests_created_by_fkey');
SELECT public.transfer_import_ddl('public','users','triggers_off',NULL);
SELECT public.transfer_import_ddl('public','guests','triggers_off',NULL);
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO public.users(id,username,email,guest_id) OVERRIDING SYSTEM VALUE
VALUES (929990001,'runtime_role_test','runtime-role-test@example.invalid',929990001);
INSERT INTO public.guests(id,nick_name,created_by) OVERRIDING SYSTEM VALUE
VALUES (929990001,'Runtime role test',929990001);
SET CONSTRAINTS ALL IMMEDIATE;
SELECT public.transfer_import_ddl('public','users','triggers_on',NULL);
SELECT public.transfer_import_ddl('public','guests','triggers_on',NULL);
SELECT public.transfer_import_ddl('public','users','fk_immediate','fk_users_guest');
SELECT public.transfer_import_ddl('public','guests','fk_immediate','guests_created_by_fkey');
DO $$ BEGIN
    BEGIN
        PERFORM public.transfer_import_ddl('public','hotel_schema_revisions','triggers_off',NULL);
        RAISE EXCEPTION 'helper accepted schema revisions';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        PERFORM public.transfer_import_ddl('pg_catalog','pg_authid','triggers_off',NULL);
        RAISE EXCEPTION 'helper accepted system object';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        PERFORM public.transfer_import_ddl('public','users','fk_defer','not_a_foreign_key');
        RAISE EXCEPTION 'helper accepted unapproved constraint';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN
        PERFORM public.transfer_import_ddl('public','users','DROP TABLE',NULL);
        RAISE EXCEPTION 'helper accepted arbitrary operation';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN
        PERFORM public.transfer_import_ddl('public','users','fk_defer','fk_users_guest');
        UPDATE public.users SET guest_id=929999999 WHERE id=929990001;
        SET CONSTRAINTS ALL IMMEDIATE;
        RAISE EXCEPTION 'invalid FK unexpectedly succeeded';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.users'::regclass AND conname='fk_users_guest' AND condeferrable) THEN
        RAISE EXCEPTION 'failed import did not roll back FK DDL';
    END IF;
END $$;
INSERT INTO app.invalid_data_quarantine
    (quarantine_id, source_table, source_key, invalid_reason, original_data)
OVERRIDING SYSTEM VALUE
VALUES
    (929990001, 'runtime-role-test', '929990001', 'privilege test', '{}'::jsonb);
UPDATE app.invalid_data_quarantine SET invalid_reason = 'updated' WHERE quarantine_id = 929990001;
DELETE FROM app.invalid_data_quarantine WHERE quarantine_id = 929990001;

CREATE TEMP VIEW pg_class AS
SELECT 'audit_logs_2098_01'::name AS relname, 'public'::regnamespace AS relnamespace;
SELECT public.maintain_audit_partition('2098-01-01'::date);
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class
        WHERE relname = 'audit_logs_2098_01' AND relnamespace = 'public'::regnamespace
    ) THEN
        RAISE EXCEPTION 'temporary catalog shadow prevented audit partition creation';
    END IF;
END $$;
INSERT INTO public.audit_logs (id, action, resource_type, created_at) OVERRIDING SYSTEM VALUE
VALUES (929990002, 'runtime-role-test', 'runtime-role-test', '2098-02-15 12:00:00+00');
SELECT public.maintain_audit_partition('2098-02-01'::date);
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.audit_logs
        WHERE id = 929990002 AND tableoid = 'public.audit_logs_2098_02'::regclass
    ) THEN
        RAISE EXCEPTION 'audit partition maintenance did not move the DEFAULT row';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.audit_logs_2098_02'::regclass
          AND tgname = 'trg_audit_logs_no_truncate'
          AND tgenabled = 'O'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'runtime partition maintenance did not install the TRUNCATE guard';
    END IF;
    BEGIN
        EXECUTE 'TRUNCATE TABLE public.audit_logs_2098_02';
        RAISE EXCEPTION 'runtime role truncated a guarded audit partition';
    EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
        IF SQLERRM = 'runtime role truncated a guarded audit partition' THEN
            RAISE;
        END IF;
    END;
END $$;
ROLLBACK;
