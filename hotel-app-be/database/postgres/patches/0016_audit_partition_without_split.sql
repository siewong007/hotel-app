-- Rebuild ensure_audit_logs_partition() without SPLIT PARTITION.
--
-- PostgreSQL 19 Beta 4 reverted ALTER TABLE ... SPLIT/MERGE PARTITION, and the
-- revert carries into the release candidate and GA. The function used SPLIT
-- when a month's partition was created after that month's rows had landed in
-- audit_logs_default, so on beta4+ that call fails with a syntax error, and the
-- daily partition upkeep, which covers three months in one statement, then
-- creates none of them. The new body rebuilds the DEFAULT partition instead:
-- its rows are copied aside, it is dropped and recreated next to the new
-- month, and the rows are inserted back through the parent. Only INSERT and
-- DROP run, so no audit row is updated or deleted.
--
-- Fresh installs already carry the new definition from the V1 baseline; this
-- patch converges installed databases onto exactly that definition and its
-- comment. The constants are exact pg_get_functiondef output, including the
-- trailing newline it emits, because the guard compares them literally.

DO $audit_partition$
DECLARE
    found_definition text;
    current_definition constant text := $fn_current$CREATE OR REPLACE FUNCTION public.ensure_audit_logs_partition(p_month date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    start_date date := date_trunc('month', p_month)::date;
    end_date   date := (date_trunc('month', p_month) + INTERVAL '1 month')::date;
    part_name  text := format('audit_logs_%s', to_char(start_date, 'YYYY_MM'));
BEGIN
    -- Schema-qualify the DDL: the pinned search_path puts pg_catalog first, so
    -- an unqualified CREATE TABLE would (illegally) target the system catalog.
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE relname = part_name AND relnamespace = 'public'::regnamespace
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM public.audit_logs_default
            WHERE created_at >= start_date::timestamptz
              AND created_at < end_date::timestamptz
            LIMIT 1
        ) THEN
            -- The month's rows already sit in the DEFAULT partition, and a new
            -- partition cannot be created over them. PostgreSQL 19 Beta 4
            -- reverted SPLIT PARTITION, so rebuild the DEFAULT partition
            -- instead: copy its rows aside, drop and recreate it next to the
            -- new month, and insert the rows back through the parent so each
            -- lands in its partition with its id and timestamp. Only INSERT
            -- and DROP run, so no audit row is updated or deleted. The lock
            -- holds audit writes until the transaction commits.
            LOCK TABLE public.audit_logs IN ACCESS EXCLUSIVE MODE;
            CREATE TEMP TABLE audit_logs_default_rows AS TABLE public.audit_logs_default;
            ALTER TABLE public.audit_logs DETACH PARTITION public.audit_logs_default;
            DROP TABLE public.audit_logs_default;
            EXECUTE format(
                'CREATE TABLE public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
                part_name, start_date, end_date
            );
            CREATE TABLE public.audit_logs_default PARTITION OF public.audit_logs DEFAULT;
            INSERT INTO public.audit_logs OVERRIDING SYSTEM VALUE
                TABLE pg_temp.audit_logs_default_rows;
            DROP TABLE pg_temp.audit_logs_default_rows;
        ELSE
            EXECUTE format(
                'CREATE TABLE public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
                part_name, start_date, end_date
            );
        END IF;
    END IF;
END;
$function$
$fn_current$;
    old_definition constant text := $fn_old$CREATE OR REPLACE FUNCTION public.ensure_audit_logs_partition(p_month date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    start_date date := date_trunc('month', p_month)::date;
    end_date   date := (date_trunc('month', p_month) + INTERVAL '1 month')::date;
    part_name  text := format('audit_logs_%s', to_char(start_date, 'YYYY_MM'));
BEGIN
    -- Schema-qualify the DDL: the pinned search_path puts pg_catalog first, so
    -- an unqualified CREATE TABLE would (illegally) target the system catalog.
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE relname = part_name AND relnamespace = 'public'::regnamespace
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM public.audit_logs_default
            WHERE created_at >= start_date::timestamptz
              AND created_at < end_date::timestamptz
            LIMIT 1
        ) THEN
            -- PostgreSQL 19 can split the DEFAULT partition in place. Unlike a
            -- late CREATE/ATTACH, this moves already-arrived rows into the new
            -- month while copying the parent's indexes and triggers.
            EXECUTE format(
                'ALTER TABLE public.audit_logs SPLIT PARTITION audit_logs_default INTO (PARTITION public.%I FOR VALUES FROM (%L) TO (%L), PARTITION public.audit_logs_default DEFAULT)',
                part_name, start_date, end_date
            );
        ELSE
            EXECUTE format(
                'CREATE TABLE public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
                part_name, start_date, end_date
            );
        END IF;
    END IF;
END;
$function$
$fn_old$;
BEGIN
    SELECT pg_get_functiondef(routine_row.oid)
    INTO found_definition
    FROM pg_proc AS routine_row
    WHERE routine_row.oid = to_regprocedure('public.ensure_audit_logs_partition(date)');

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'ensure_audit_logs_partition(date) has incompatible definition: <missing>';
    ELSIF found_definition = old_definition THEN
        EXECUTE current_definition;
    ELSIF found_definition <> current_definition THEN
        RAISE EXCEPTION 'ensure_audit_logs_partition(date) has incompatible definition: %', found_definition;
    END IF;
END;
$audit_partition$;

COMMENT ON FUNCTION public.ensure_audit_logs_partition(p_month date) IS 'Idempotently creates the monthly audit_logs partition covering the given month. When a month is created late, it rebuilds the DEFAULT partition under an exclusive lock and re-inserts its rows through the parent, which moves the month''s rows into the new partition. Pre-create months during maintenance because that path blocks audit writes and copies the DEFAULT partition.';
