\set ON_ERROR_STOP on

-- Opt-in PostgreSQL 19 development/benchmark tuning.
-- Apply after schema.sql and data.sql. This file changes physical storage and
-- planner metadata only; it does not change application-visible constraints.

DO $$
BEGIN
    IF current_setting('server_version_num')::integer < 190000 THEN
        RAISE EXCEPTION 'pg19_speculative_tuning.sql requires PostgreSQL 19 or newer';
    END IF;
END;
$$;

-- PostgreSQL 19 defaults TOAST compression to LZ4 when the build supports it.
-- Make the choice explicit for large JSON payloads. Existing values are not
-- rewritten; the setting applies to future writes and later dump/restores.
DO $$
DECLARE
    lz4_available boolean := true;
    target record;
BEGIN
    BEGIN
        PERFORM set_config('default_toast_compression', 'lz4', true);
    EXCEPTION
        WHEN invalid_parameter_value OR feature_not_supported THEN
            lz4_available := false;
            RAISE NOTICE 'LZ4 unavailable; keeping existing TOAST compression';
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
            EXECUTE format(
                'ALTER TABLE %I.%I ALTER COLUMN %I SET COMPRESSION lz4',
                target.schema_name,
                target.table_name,
                target.column_name
            );
        END LOOP;
    END IF;
END;
$$;

-- PostgreSQL 19 can use parallel workers for autovacuum index processing.
ALTER TABLE bookings SET (
    autovacuum_parallel_workers = 2,
    autovacuum_vacuum_scale_factor = 0.03,
    autovacuum_analyze_scale_factor = 0.015
);

ALTER TABLE payments SET (
    autovacuum_parallel_workers = 2,
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE customer_ledgers SET (
    autovacuum_parallel_workers = 2,
    autovacuum_vacuum_scale_factor = 0.03,
    autovacuum_analyze_scale_factor = 0.015
);

ALTER TABLE ekyc_verifications SET (
    autovacuum_parallel_workers = 2,
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

DO $$
DECLARE
    audit_partition regclass;
BEGIN
    FOR audit_partition IN
        SELECT inhrelid::regclass
        FROM pg_inherits
        WHERE inhparent = 'public.audit_logs'::regclass
    LOOP
        EXECUTE format(
            'ALTER TABLE %s SET (autovacuum_parallel_workers = 2, autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02)',
            audit_partition
        );
    END LOOP;
END;
$$;

-- Equality/status combinations used by operational queues are good candidates
-- for multivariate MCV and dependency statistics. These are hypotheses: retain
-- them only when before/after plans improve on representative data.
CREATE STATISTICS IF NOT EXISTS stats_bookings_commercial_state
    (mcv, dependencies)
    ON status, payment_status, source, booking_channel_id
    FROM bookings;

CREATE STATISTICS IF NOT EXISTS stats_ekyc_review_queue
    (mcv, dependencies)
    ON status, manual_review_required, risk_level, assigned_reviewer_id
    FROM ekyc_verifications;

CREATE STATISTICS IF NOT EXISTS stats_customer_ledgers_work_queue
    (mcv, dependencies)
    ON status, is_posted, folio_type, posting_date
    FROM customer_ledgers;

ALTER STATISTICS stats_bookings_commercial_state SET STATISTICS 500;
ALTER STATISTICS stats_ekyc_review_queue SET STATISTICS 500;
ALTER STATISTICS stats_customer_ledgers_work_queue SET STATISTICS 500;

ALTER TABLE bookings ALTER COLUMN status SET STATISTICS 500;
ALTER TABLE bookings ALTER COLUMN payment_status SET STATISTICS 500;
ALTER TABLE audit_logs ALTER COLUMN action SET STATISTICS 500;
ALTER TABLE audit_logs ALTER COLUMN resource_type SET STATISTICS 500;

ANALYZE bookings;
ANALYZE payments;
ANALYZE customer_ledgers;
ANALYZE ekyc_verifications;
ANALYZE audit_logs;
