\set ON_ERROR_STOP on

-- Revert the physical/planner changes from pg19_speculative_tuning.sql.
-- Existing LZ4-compressed values stay readable and are not rewritten.

ALTER TABLE bookings RESET (
    autovacuum_parallel_workers,
    autovacuum_vacuum_scale_factor,
    autovacuum_analyze_scale_factor
);

ALTER TABLE payments RESET (
    autovacuum_parallel_workers,
    autovacuum_vacuum_scale_factor,
    autovacuum_analyze_scale_factor
);

ALTER TABLE customer_ledgers RESET (
    autovacuum_parallel_workers,
    autovacuum_vacuum_scale_factor,
    autovacuum_analyze_scale_factor
);

ALTER TABLE ekyc_verifications RESET (
    autovacuum_parallel_workers,
    autovacuum_vacuum_scale_factor,
    autovacuum_analyze_scale_factor
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
            'ALTER TABLE %s RESET (autovacuum_parallel_workers, autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor)',
            audit_partition
        );
    END LOOP;
END;
$$;

DROP STATISTICS IF EXISTS stats_bookings_commercial_state;
DROP STATISTICS IF EXISTS stats_ekyc_review_queue;
DROP STATISTICS IF EXISTS stats_customer_ledgers_work_queue;

ALTER TABLE bookings ALTER COLUMN status SET STATISTICS DEFAULT;
ALTER TABLE bookings ALTER COLUMN payment_status SET STATISTICS DEFAULT;
ALTER TABLE audit_logs ALTER COLUMN action SET STATISTICS DEFAULT;
ALTER TABLE audit_logs ALTER COLUMN resource_type SET STATISTICS DEFAULT;

DO $$
DECLARE
    target record;
BEGIN
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
            'ALTER TABLE %I.%I ALTER COLUMN %I SET COMPRESSION default',
            target.schema_name,
            target.table_name,
            target.column_name
        );
    END LOOP;
END;
$$;
