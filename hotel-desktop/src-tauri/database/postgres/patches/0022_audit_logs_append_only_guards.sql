-- Make audit_logs append-only on every installed database, partitions included.
--
-- Production and staging were installed (2026-07-18) before the V1 baseline
-- gained the append-only guard (2026-09-13), and no patch carried it, so they
-- have neither prevent_audit_log_mutation() nor the trigger on audit_logs:
-- UPDATE, DELETE and TRUNCATE on audit history all succeed there. Databases
-- installed from the baseline since then have the function and the parent
-- statement trigger, but not the partition guards below. This patch converges
-- both onto the baseline:
--
-- * prevent_audit_log_mutation(): created when missing, replaced when it is
--   the earlier baseline body, left alone when already current. When it runs
--   per row it hands the row back: a BEFORE ROW trigger that returns NULL
--   silently skips the row, which would turn the app.allow_audit_mutation
--   escape hatch into a no-op.
-- * trg_audit_logs_append_only, the statement trigger on audit_logs (UPDATE,
--   DELETE, TRUNCATE): created when missing.
-- * trg_audit_logs_append_only_row, a BEFORE UPDATE OR DELETE row trigger on
--   audit_logs. PostgreSQL clones it onto every partition, now and whenever
--   one is created or attached later. A statement fires only the triggers of
--   the table it names, so without it a statement naming a partition
--   (audit_logs_2026_10, audit_logs_default) went through.
-- * ensure_audit_logs_truncate_guards(), run once here. TRUNCATE triggers can
--   only be statement-level and PostgreSQL does not clone statement triggers,
--   so it gives each partition its own BEFORE TRUNCATE trigger. Partition
--   upkeep calls it again after ensure_audit_logs_partition().
--
-- ensure_audit_logs_partition() (patch 0021) needs no escape hatch: DETACH
-- PARTITION drops the cloned row trigger from the detached default, so its
-- DELETE of the late month's rows runs unguarded, and ATTACH clones the
-- trigger back. The default keeps its own TRUNCATE trigger throughout.
--
-- Anything else already in place under these names (another body, another
-- trigger definition, a disabled trigger) is drift: the patch raises and the
-- whole catalog step rolls back. Function constants are exact
-- pg_get_functiondef output, including its trailing newline, compared with
-- carriage returns removed (a CRLF-installed desktop keeps CR bytes in stored
-- bodies). Every step is a catalog read once the database has converged, so a
-- re-run is a no-op.
--
-- From here on, the only ways to change audit rows are the escape hatch, set
-- for one transaction (BEGIN; SET LOCAL app.allow_audit_mutation = 'on'; ...),
-- or DDL by the owner. The users -> audit_logs ON DELETE SET NULL key runs an
-- UPDATE on audit_logs, so hard-deleting a user who has audit rows needs the
-- hatch too; the application only soft-deletes users.

DO $audit_guard_function$
DECLARE
    found_definition text;
    current_definition constant text := $fn_current$CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- Escape hatch for fixture cleanup only: integration tests set this GUC
    -- per pooled connection so they can purge rows they wrote. Nothing in the
    -- application sets it. A principal that can run SET could equally drop the
    -- trigger, so the GUC widens nothing -- the trigger exists to stop
    -- accidental and application-level mutation, not the database owner.
    IF current_setting('app.allow_audit_mutation', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'audit_logs is append-only: UPDATE and DELETE are forbidden';
    END IF;
    -- A BEFORE ROW trigger that returns NULL silently skips its row, so with
    -- the escape hatch open the row must be handed back for the UPDATE or
    -- DELETE to happen. Statement-level calls ignore the return value.
    IF TG_LEVEL = 'ROW' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$function$
$fn_current$;
    old_definition constant text := $fn_old$CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    -- Escape hatch for fixture cleanup only: integration tests set this GUC
    -- per pooled connection so they can purge rows they wrote. Nothing in the
    -- application sets it. A principal that can run SET could equally drop the
    -- trigger, so the GUC widens nothing -- the trigger exists to stop
    -- accidental and application-level mutation, not the database owner.
    IF current_setting('app.allow_audit_mutation', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'audit_logs is append-only: UPDATE and DELETE are forbidden';
    END IF;
    RETURN NULL;
END;
$function$
$fn_old$;
BEGIN
    SELECT replace(pg_get_functiondef(routine_row.oid), chr(13), '')
    INTO found_definition
    FROM pg_proc AS routine_row
    WHERE routine_row.oid = to_regprocedure('public.prevent_audit_log_mutation()');

    IF found_definition IS NULL OR found_definition = old_definition THEN
        EXECUTE current_definition;
    ELSIF found_definition <> current_definition THEN
        RAISE EXCEPTION 'prevent_audit_log_mutation() has incompatible definition: %', found_definition;
    END IF;
END;
$audit_guard_function$;

COMMENT ON FUNCTION public.prevent_audit_log_mutation() IS 'Trigger body that makes audit_logs append-only even for the table owner. It runs per statement on audit_logs (UPDATE, DELETE, TRUNCATE), per row on every partition through the row trigger PostgreSQL clones from audit_logs (UPDATE, DELETE), and per statement on each partition for TRUNCATE, which ensure_audit_logs_truncate_guards() adds. A statement that names a partition fires only that partition''s triggers. REVOKE cannot help here because the application connects as the owner, and owners bypass privilege checks; a BEFORE trigger is the only enforcement that applies.';

-- pg_get_triggerdef qualifies names only when the search_path hides them, so
-- compare with the schema prefix removed.
DO $audit_statement_trigger$
DECLARE
    found_definition text;
    found_enabled "char";
    expected_definition constant text :=
        'CREATE TRIGGER trg_audit_logs_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_log_mutation()';
BEGIN
    SELECT replace(pg_get_triggerdef(trigger_row.oid), 'public.', ''), trigger_row.tgenabled
    INTO found_definition, found_enabled
    FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.audit_logs'::regclass
      AND trigger_row.tgname = 'trg_audit_logs_append_only';

    IF found_definition IS NULL THEN
        CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.audit_logs
            FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_audit_log_mutation();
    ELSIF found_definition <> expected_definition OR found_enabled <> 'O' THEN
        RAISE EXCEPTION 'trg_audit_logs_append_only has incompatible definition: % (enabled %)',
            found_definition, found_enabled;
    END IF;
END;
$audit_statement_trigger$;

DO $audit_truncate_guards$
DECLARE
    found_definition text;
    current_definition constant text := $fn_current$CREATE OR REPLACE FUNCTION public.ensure_audit_logs_truncate_guards()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    partition_row record;
    guarded integer := 0;
BEGIN
    -- TRUNCATE triggers can only be statement-level, and PostgreSQL clones
    -- row triggers to partitions but not statement triggers, so a TRUNCATE
    -- that names a partition never reaches the guard on audit_logs. Give each
    -- partition its own. Schema-qualify the DDL: the pinned search_path puts
    -- pg_catalog first. OR REPLACE keeps two concurrent callers from failing
    -- on the same partition.
    FOR partition_row IN
        SELECT partition_schema.nspname AS schema_name,
               partition_table.relname AS table_name
        FROM pg_inherits AS link
        JOIN pg_class AS partition_table ON partition_table.oid = link.inhrelid
        JOIN pg_namespace AS partition_schema
          ON partition_schema.oid = partition_table.relnamespace
        WHERE link.inhparent = 'public.audit_logs'::regclass
          AND NOT EXISTS (
              SELECT 1
              FROM pg_trigger AS guard
              WHERE guard.tgrelid = partition_table.oid
                AND guard.tgname = 'trg_audit_logs_no_truncate'
          )
        ORDER BY partition_table.relname
    LOOP
        EXECUTE format(
            'CREATE OR REPLACE TRIGGER trg_audit_logs_no_truncate BEFORE TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_audit_log_mutation()',
            partition_row.schema_name, partition_row.table_name
        );
        guarded := guarded + 1;
    END LOOP;
    RETURN guarded;
END;
$function$
$fn_current$;
BEGIN
    SELECT replace(pg_get_functiondef(routine_row.oid), chr(13), '')
    INTO found_definition
    FROM pg_proc AS routine_row
    WHERE routine_row.oid = to_regprocedure('public.ensure_audit_logs_truncate_guards()');

    IF found_definition IS NULL THEN
        EXECUTE current_definition;
    ELSIF found_definition <> current_definition THEN
        RAISE EXCEPTION 'ensure_audit_logs_truncate_guards() has incompatible definition: %', found_definition;
    END IF;
END;
$audit_truncate_guards$;

COMMENT ON FUNCTION public.ensure_audit_logs_truncate_guards() IS 'Adds the statement-level BEFORE TRUNCATE trigger trg_audit_logs_no_truncate to every audit_logs partition that lacks it and returns how many it added. PostgreSQL does not clone statement triggers to partitions, so a TRUNCATE that names a partition skips the guard on audit_logs. Partition upkeep calls this after ensure_audit_logs_partition(); a partition created any other way is guarded on the next call.';

DO $audit_row_trigger$
DECLARE
    found_definition text;
    found_enabled "char";
    expected_definition constant text :=
        'CREATE TRIGGER trg_audit_logs_append_only_row BEFORE DELETE OR UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation()';
BEGIN
    SELECT replace(pg_get_triggerdef(trigger_row.oid), 'public.', ''), trigger_row.tgenabled
    INTO found_definition, found_enabled
    FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.audit_logs'::regclass
      AND trigger_row.tgname = 'trg_audit_logs_append_only_row';

    IF found_definition IS NULL THEN
        CREATE TRIGGER trg_audit_logs_append_only_row BEFORE DELETE OR UPDATE ON public.audit_logs
            FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();
    ELSIF found_definition <> expected_definition OR found_enabled <> 'O' THEN
        RAISE EXCEPTION 'trg_audit_logs_append_only_row has incompatible definition: % (enabled %)',
            found_definition, found_enabled;
    END IF;
END;
$audit_row_trigger$;

DO $audit_truncate_backfill$
BEGIN
    PERFORM public.ensure_audit_logs_truncate_guards();
END;
$audit_truncate_backfill$;
