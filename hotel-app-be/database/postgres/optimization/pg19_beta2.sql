\set ON_ERROR_STOP on

-- PostgreSQL 19 Beta 2, opt-in physical and planner tuning.
--
-- Beta 2 is prerelease software: apply this only to a disposable or
-- benchmark-validated environment. This script deliberately avoids host-wide
-- memory and worker settings; those require workload and hardware evidence.
-- Run pg19_beta2_benchmark.sql before and after applying this script.
--
-- NOTE: the per-table autovacuum_parallel_workers settings below are inert
-- until the cluster GUC autovacuum_max_parallel_workers is above zero. The
-- `make db-pg19-tune` target raises it via ALTER SYSTEM (and
-- `make db-pg19-tune-rollback` resets it); this file alone does not.

BEGIN;

DO $$
BEGIN
    IF version() !~ '^PostgreSQL 19beta2 ' THEN
        RAISE EXCEPTION
            'pg19_beta2.sql requires PostgreSQL 19 Beta 2 exactly; connected to %',
            version();
    END IF;
END;
$$;

-- Apply storage compression only to existing large JSON/text payload columns.
-- LZ4 is a PostgreSQL 19 default when supported; making it explicit prevents a
-- later cluster default from silently changing new values in these columns.
DO $$
DECLARE
    target record;
    lz4_available boolean := true;
BEGIN
    BEGIN
        PERFORM set_config('default_toast_compression', 'lz4', true);
    EXCEPTION
        WHEN invalid_parameter_value OR feature_not_supported THEN
            lz4_available := false;
            RAISE NOTICE 'LZ4 is unavailable; leaving TOAST compression unchanged';
    END;

    IF lz4_available THEN
        FOR target IN
            SELECT *
            FROM (VALUES
                ('public', 'audit_logs', 'details'),
                ('public', 'invoices', 'line_items'),
                ('public', 'booking_modifications', 'old_value'),
                ('public', 'booking_modifications', 'new_value'),
                ('public', 'booking_history', 'metadata'),
                ('public', 'ekyc_verifications', 'provider_raw_response'),
                ('public', 'ekyc_verifications', 'ocr_data'),
                ('public', 'ekyc_verifications', 'user_entered_data'),
                ('public', 'ekyc_verifications', 'submission_metadata'),
                ('public', 'ekyc_verifications', 'auto_verification_details'),
                ('public', 'ekyc_verifications', 'risk_flags'),
                ('app', 'invalid_data_quarantine', 'original_data')
            ) AS targets(schema_name, table_name, column_name)
        LOOP
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = target.schema_name
                  AND table_name = target.table_name
                  AND column_name = target.column_name
            ) THEN
                EXECUTE format(
                    'ALTER TABLE %I.%I ALTER COLUMN %I SET COMPRESSION lz4',
                    target.schema_name, target.table_name, target.column_name
                );
            END IF;
        END LOOP;
    END IF;
END;
$$;

-- PostgreSQL 19 permits parallel index processing in autovacuum. The lower
-- scale factors make busy operational tables get analyzed and vacuumed sooner.
DO $$
DECLARE
    target record;
BEGIN
    FOR target IN
        SELECT *
        FROM (VALUES
            ('public', 'bookings', 0.03::numeric, 0.015::numeric),
            ('public', 'payments', 0.05::numeric, 0.02::numeric),
            ('public', 'customer_ledgers', 0.03::numeric, 0.015::numeric),
            ('public', 'ekyc_verifications', 0.05::numeric, 0.02::numeric)
        ) AS targets(schema_name, table_name, vacuum_scale_factor, analyze_scale_factor)
    LOOP
        IF to_regclass(format('%I.%I', target.schema_name, target.table_name)) IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE %I.%I SET (autovacuum_parallel_workers = 2, autovacuum_vacuum_scale_factor = %s, autovacuum_analyze_scale_factor = %s)',
                target.schema_name, target.table_name,
                target.vacuum_scale_factor, target.analyze_scale_factor
            );
        END IF;
    END LOOP;

    IF to_regclass('public.audit_logs') IS NOT NULL THEN
        FOR target IN
            SELECT inhrelid::regclass AS partition_name
            FROM pg_inherits
            WHERE inhparent = 'public.audit_logs'::regclass
        LOOP
            EXECUTE format(
                'ALTER TABLE %s SET (autovacuum_parallel_workers = 2, autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02)',
                target.partition_name
            );
        END LOOP;
    END IF;
END;
$$;

-- Extended statistics capture correlated queue/status predicates which simple
-- per-column statistics cannot estimate well. CREATE IF NOT EXISTS makes
-- reapplying this profile safe; ANALYZE below refreshes their contents.
DO $$
BEGIN
    IF to_regclass('public.bookings') IS NOT NULL THEN
        CREATE STATISTICS IF NOT EXISTS stats_bookings_commercial_state
            (mcv, dependencies)
            ON status, payment_status, source, booking_channel_id
            FROM public.bookings;
        ALTER STATISTICS stats_bookings_commercial_state SET STATISTICS 500;
        ALTER TABLE public.bookings ALTER COLUMN status SET STATISTICS 500;
        ALTER TABLE public.bookings ALTER COLUMN payment_status SET STATISTICS 500;
        ANALYZE public.bookings;
    END IF;

    IF to_regclass('public.ekyc_verifications') IS NOT NULL THEN
        CREATE STATISTICS IF NOT EXISTS stats_ekyc_review_queue
            (mcv, dependencies)
            ON status, manual_review_required, risk_level, assigned_reviewer_id
            FROM public.ekyc_verifications;
        ALTER STATISTICS stats_ekyc_review_queue SET STATISTICS 500;
        ANALYZE public.ekyc_verifications;
    END IF;

    IF to_regclass('public.customer_ledgers') IS NOT NULL THEN
        CREATE STATISTICS IF NOT EXISTS stats_customer_ledgers_work_queue
            (mcv, dependencies)
            ON status, is_posted, folio_type, posting_date
            FROM public.customer_ledgers;
        ALTER STATISTICS stats_customer_ledgers_work_queue SET STATISTICS 500;
        ANALYZE public.customer_ledgers;
    END IF;

    IF to_regclass('public.payments') IS NOT NULL THEN
        ANALYZE public.payments;
    END IF;

    IF to_regclass('public.audit_logs') IS NOT NULL THEN
        ALTER TABLE public.audit_logs ALTER COLUMN action SET STATISTICS 500;
        ALTER TABLE public.audit_logs ALTER COLUMN resource_type SET STATISTICS 500;
        ANALYZE public.audit_logs;
    END IF;
END;
$$;

COMMIT;
