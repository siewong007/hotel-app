-- Move a late audit month's rows without rebuilding the DEFAULT partition.
--
-- Patch 0016 took SPLIT PARTITION out of ensure_audit_logs_partition(date)
-- (PostgreSQL 19 Beta 4 reverted it) by rebuilding the DEFAULT partition when
-- a month is created late: copy every default row to a temp table, drop and
-- recreate the default, and re-insert all of them through the parent. That
-- copies the whole default, not just the late month, and recreates the table.
--
-- This patch replaces that path with the design from #217: detach the default,
-- create the month, move only that month's rows across in one
-- DELETE ... RETURNING / INSERT ... OVERRIDING SYSTEM VALUE statement, and
-- reattach the default. Every column value survives, id and created_at
-- included. The DELETE runs on the detached table, which carries no append-only
-- trigger, so app.allow_audit_mutation is never set and audit_logs itself stays
-- append-only. DETACH holds ACCESS EXCLUSIVE on audit_logs until the calling
-- transaction ends, so no session sees a half-moved month. It behaves the same
-- on 19beta3 and 19beta4+.
--
-- Guard: the function is replaced only when it is exactly the definition patch
-- 0016 installs (the one deployed since 2026-10-06), is left alone when it is
-- already this patch's definition (re-run), and anything else raises, which
-- rolls the whole patch back. The constants are exact pg_get_functiondef output,
-- including its trailing newline; carriage returns are ignored in the
-- comparison so a body stored from a CRLF checkout still matches.
--
-- Unlike most patches, the baseline keeps 0016's definition: patches run on
-- fresh installs too, and 0016 (immutable once deployed) refuses any definition
-- but its own and the pre-0016 one. Fresh installs therefore reach this
-- definition through this patch, exactly as installed databases do.

DO $audit_partition_move$
DECLARE
    found_definition text;
    move_definition constant text := $fn_move$CREATE OR REPLACE FUNCTION public.ensure_audit_logs_partition(p_month date)
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
$fn_move$;
    rebuild_definition constant text := $fn_rebuild$CREATE OR REPLACE FUNCTION public.ensure_audit_logs_partition(p_month date)
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
$fn_rebuild$;
BEGIN
    SELECT replace(pg_get_functiondef(routine_row.oid), E'\r', '')
    INTO found_definition
    FROM pg_proc AS routine_row
    WHERE routine_row.oid = to_regprocedure('public.ensure_audit_logs_partition(date)');

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'ensure_audit_logs_partition(date) has incompatible definition: <missing>';
    ELSIF found_definition = rebuild_definition THEN
        EXECUTE move_definition;
    ELSIF found_definition <> move_definition THEN
        RAISE EXCEPTION 'ensure_audit_logs_partition(date) has incompatible definition: %', found_definition;
    END IF;
END;
$audit_partition_move$;

COMMENT ON FUNCTION public.ensure_audit_logs_partition(p_month date) IS 'Idempotently creates the monthly audit_logs partition covering the given month. When a month is created late, its rows already in the DEFAULT partition move into it unchanged (detach the default, create the month, move the rows, reattach) without enabling app.allow_audit_mutation. Pre-create months during maintenance: that late path locks audit_logs exclusively and scans the default.';
