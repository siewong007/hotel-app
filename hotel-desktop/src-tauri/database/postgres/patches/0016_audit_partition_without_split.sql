-- Replace the late-month path of ensure_audit_logs_partition(date), which ran
-- ALTER TABLE ... SPLIT PARTITION. PostgreSQL 19 Beta 4 reverted SPLIT/MERGE
-- PARTITION, and the revert carries into the release candidate and GA: those
-- servers reject the statement as a syntax error. The path runs only when a
-- month's partition is created after that month's rows already reached
-- audit_logs_default, but the daily maintenance covers three months in one
-- statement, so one failing split blocked all three, and from then on each new
-- month's rows would have landed in the default and needed a split as well.
--
-- The new definition makes the same move without SPLIT: detach the default,
-- create the month, move its rows across in one DELETE ... RETURNING / INSERT
-- statement, and reattach the default. Every column value survives, id and
-- created_at included, and app.allow_audit_mutation is never set. It behaves
-- the same on 19beta3, so this applies before or after the engine move.
--
-- Fresh installs already carry the new definition and comment from the V1
-- baseline; this patch converges installed databases onto exactly those. The
-- constants are exact pg_get_functiondef output, including the trailing
-- newline it emits. The guard compares them after removing carriage returns:
-- a baseline installed from a CRLF checkout keeps CR bytes in the stored body,
-- which would otherwise fail an exact match on a function that is semantically
-- the expected one. The replacement is written with plain LF either way.

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
    late_month boolean;
BEGIN
    -- Schema-qualify the DDL: the pinned search_path puts pg_catalog first, so
    -- an unqualified CREATE TABLE would (illegally) target the system catalog.
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE relname = part_name AND relnamespace = 'public'::regnamespace
    ) THEN
        -- A month created late already has rows in the DEFAULT partition, and
        -- PostgreSQL will not create a partition over them. Detach the default,
        -- create the month, move its rows across unchanged, and reattach: what
        -- ALTER TABLE ... SPLIT PARTITION did until PostgreSQL 19 Beta 4
        -- reverted it. DETACH holds ACCESS EXCLUSIVE on audit_logs until the
        -- calling transaction ends, so no session sees a half-moved month.
        late_month := EXISTS (
            SELECT 1
            FROM public.audit_logs_default
            WHERE created_at >= start_date::timestamptz
              AND created_at < end_date::timestamptz
        );
        IF late_month THEN
            EXECUTE 'ALTER TABLE public.audit_logs DETACH PARTITION public.audit_logs_default';
        END IF;
        EXECUTE format(
            'CREATE TABLE public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
            part_name, start_date, end_date
        );
        IF late_month THEN
            -- One statement, so the rows inserted are exactly the rows removed.
            -- The DELETE runs on the detached table, which no append-only
            -- trigger guards, so app.allow_audit_mutation stays off. SELECT *
            -- is positional: audit_logs_default was created in the parent's
            -- column order, and ALTER TABLE on the parent changes both alike.
            WITH moved AS (
                DELETE FROM public.audit_logs_default
                WHERE created_at >= start_date::timestamptz
                  AND created_at < end_date::timestamptz
                RETURNING *
            )
            INSERT INTO public.audit_logs OVERRIDING SYSTEM VALUE
            SELECT * FROM moved;
            EXECUTE 'ALTER TABLE public.audit_logs ATTACH PARTITION public.audit_logs_default DEFAULT';
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
    JOIN pg_namespace AS schema_row ON schema_row.oid = routine_row.pronamespace
    WHERE schema_row.nspname = 'public'
      AND routine_row.proname = 'ensure_audit_logs_partition'
      AND pg_get_function_identity_arguments(routine_row.oid) = 'p_month date';

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'ensure_audit_logs_partition(date) has incompatible definition: <missing>';
    ELSIF replace(found_definition, E'\r', '') = old_definition THEN
        EXECUTE current_definition;
    ELSIF replace(found_definition, E'\r', '') <> current_definition THEN
        RAISE EXCEPTION 'ensure_audit_logs_partition(date) has incompatible definition: %', found_definition;
    END IF;
END;
$audit_partition$;

COMMENT ON FUNCTION public.ensure_audit_logs_partition(p_month date) IS 'Idempotently creates the monthly audit_logs partition covering the given month. When a month is created late, its rows already in the DEFAULT partition move into it unchanged (detach the default, create the month, move the rows, reattach) without enabling app.allow_audit_mutation. Pre-create months during maintenance: that late path locks audit_logs exclusively and scans the default.';
