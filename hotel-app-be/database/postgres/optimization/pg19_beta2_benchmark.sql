\set ON_ERROR_STOP on
\timing on

-- Read-only PostgreSQL 19 Beta 2 benchmark companion for pg19_beta2.sql.
-- Capture the output before and after tuning with representative production-
-- shaped data. Beta software is not production-ready; retain a change only if
-- its measured latency, I/O, and maintenance effects are acceptable.

DO $$
BEGIN
    IF version() !~ '^PostgreSQL 19beta2 ' THEN
        RAISE EXCEPTION
            'pg19_beta2_benchmark.sql requires PostgreSQL 19 Beta 2 exactly; connected to %',
            version();
    END IF;
END;
$$;

SELECT version();

SELECT name, setting, unit, context, min_val, max_val, pending_restart
FROM pg_settings
WHERE name = ANY (ARRAY[
    'io_method',
    'io_min_workers',
    'io_max_workers',
    'effective_io_concurrency',
    'maintenance_io_concurrency',
    'autovacuum_max_parallel_workers',
    'autovacuum_analyze_score_weight',
    'autovacuum_vacuum_score_weight',
    'autovacuum_vacuum_insert_score_weight',
    'vacuum_max_eager_freeze_failure_rate',
    'default_toast_compression',
    'jit'
])
ORDER BY name;

EXPLAIN (ANALYZE, BUFFERS, IO, SETTINGS, TIMING OFF, SUMMARY ON)
SELECT 1
FROM public.bookings b
WHERE b.room_id = (SELECT MIN(id) FROM public.rooms)
  AND b.status IN ('confirmed', 'pending', 'checked_in', 'auto_checked_in')
  AND b.check_out_date > CURRENT_DATE
  AND b.check_in_date < CURRENT_DATE + 7
LIMIT 1;

EXPLAIN (ANALYZE, BUFFERS, IO, SETTINGS, TIMING OFF, SUMMARY ON)
SELECT id, action, resource_type, created_at
FROM public.audit_logs
WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
  AND details::text ILIKE '%booking%'
ORDER BY created_at DESC
LIMIT 100;

SELECT * FROM pg_stat_lock ORDER BY wait_time DESC, waits DESC;

SELECT backend_type, object, context, reads, read_time, writes, write_time
FROM pg_stat_io
ORDER BY backend_type, object, context;
