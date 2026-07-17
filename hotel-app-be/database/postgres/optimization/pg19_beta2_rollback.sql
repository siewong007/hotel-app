\set ON_ERROR_STOP on

-- Revert pg19_beta2.sql. This is safe to repeat. Existing LZ4-compressed
-- values remain readable; this only changes the compression choice for future
-- rewrites. Validate the rollback with pg19_beta2_benchmark.sql.

BEGIN;

DO $$
BEGIN
    IF version() !~ '^PostgreSQL 19beta2 ' THEN
        RAISE EXCEPTION
            'pg19_beta2_rollback.sql requires PostgreSQL 19 Beta 2 exactly; connected to %',
            version();
    END IF;
END;
$$;

DO $$
DECLARE
    target record;
BEGIN
    FOR target IN
        SELECT *
        FROM (VALUES
            ('public', 'bookings'),
            ('public', 'payments'),
            ('public', 'customer_ledgers'),
            ('public', 'ekyc_verifications')
        ) AS targets(schema_name, table_name)
    LOOP
        IF to_regclass(format('%I.%I', target.schema_name, target.table_name)) IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE %I.%I RESET (autovacuum_parallel_workers, autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor)',
                target.schema_name, target.table_name
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
                'ALTER TABLE %s RESET (autovacuum_parallel_workers, autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor)',
                target.partition_name
            );
        END LOOP;
    END IF;
END;
$$;

DROP STATISTICS IF EXISTS stats_bookings_commercial_state;
DROP STATISTICS IF EXISTS stats_ekyc_review_queue;
DROP STATISTICS IF EXISTS stats_customer_ledgers_work_queue;

DO $$
DECLARE
    target record;
BEGIN
    IF to_regclass('public.bookings') IS NOT NULL THEN
        ALTER TABLE public.bookings ALTER COLUMN status SET STATISTICS DEFAULT;
        ALTER TABLE public.bookings ALTER COLUMN payment_status SET STATISTICS DEFAULT;
    END IF;
    IF to_regclass('public.audit_logs') IS NOT NULL THEN
        ALTER TABLE public.audit_logs ALTER COLUMN action SET STATISTICS DEFAULT;
        ALTER TABLE public.audit_logs ALTER COLUMN resource_type SET STATISTICS DEFAULT;
    END IF;

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
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = target.schema_name
              AND table_name = target.table_name
              AND column_name = target.column_name
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I.%I ALTER COLUMN %I SET COMPRESSION default',
                target.schema_name, target.table_name, target.column_name
            );
        END IF;
    END LOOP;
END;
$$;

COMMIT;
