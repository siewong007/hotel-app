-- ============================================================================
-- MIGRATION 020: PARTITION audit_logs BY MONTH (PG 18)
-- ============================================================================
-- Description:
--   Converts the append-only `audit_logs` table into a RANGE-partitioned table
--   (one partition per calendar month on `created_at`). This was the deferred
--   "partition audit_logs once row count crosses ~10M" follow-up from
--   PG18_UPGRADE_NOTES.md. Doing it now — while the table is small — makes the
--   rewrite cheap; doing it after it grows large is the painful path.
--
--   Why partition:
--     * Old months can be detached/dropped in O(1) instead of a huge DELETE.
--     * The planner prunes to the relevant month(s) for time-bounded queries
--       (the audit UI and CSV export both filter on a date range).
--     * Per-partition BRIN/GIN/btree indexes stay small.
--
--   Design choices:
--     * `id` switches to `GENERATED ALWAYS AS IDENTITY` (PG 18-era style; this
--       is the go-forward standard for new tables — see follow-up #3 in
--       PG18_UPGRADE_NOTES.md). The old `audit_logs_id_seq` is dropped.
--     * The partition key must be part of every unique constraint, so the PK
--       becomes `(id, created_at)`. `id` alone is still globally unique because
--       the identity sequence never repeats; the composite PK is purely a
--       partitioning requirement. No FK references audit_logs.id, so this is
--       transparent to the rest of the schema.
--     * A DEFAULT partition catches any row outside the pre-created monthly
--       window (including historical rows), so an INSERT is never rejected.
--     * `ensure_audit_logs_partition(date)` lets a maintenance job (or the next
--       deploy) pre-create future months. New months MUST be created before
--       rows for them arrive — you cannot attach a monthly partition once the
--       DEFAULT partition already holds rows in that range.
--
--   This is an atomic rewrite (rename → recreate → copy → drop) wrapped in the
--   migration transaction: it either fully succeeds or fully rolls back. On a
--   large `audit_logs` it takes an ACCESS EXCLUSIVE lock for the duration of
--   the copy — run it during a maintenance window if the table is already big.
--
-- Postgres-only. SQLite has no partitioning and the column shape is unchanged,
-- so there is no SQLite counterpart migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Set the old table aside and free its index names for reuse.
-- ----------------------------------------------------------------------------
ALTER TABLE audit_logs RENAME TO audit_logs_legacy;

DROP INDEX IF EXISTS idx_audit_logs_user_id;
DROP INDEX IF EXISTS idx_audit_logs_action;
DROP INDEX IF EXISTS idx_audit_logs_resource;
DROP INDEX IF EXISTS idx_audit_logs_created_at;
DROP INDEX IF EXISTS idx_audit_logs_details_gin;
DROP INDEX IF EXISTS idx_audit_logs_created_at_brin;

-- ----------------------------------------------------------------------------
-- 2. Create the partitioned parent.
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id BIGINT,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Catch-all for any timestamp outside the pre-created monthly partitions
-- (historical rows copied below, plus anything beyond the forward window).
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- ----------------------------------------------------------------------------
-- 3. Partition-maintenance helper.
-- ----------------------------------------------------------------------------
-- Creates the monthly partition covering p_month if it does not already exist.
-- Pinned search_path keeps it safe from function-hijack via a mutable path.
CREATE OR REPLACE FUNCTION ensure_audit_logs_partition(p_month date)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
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
        EXECUTE format(
            'CREATE TABLE public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
            part_name, start_date, end_date
        );
    END IF;
END;
$$;

COMMENT ON FUNCTION ensure_audit_logs_partition(date) IS
    'Idempotently creates the monthly audit_logs partition covering the given '
    'month. Call ahead of time (maintenance job / deploy) so future months '
    'exist before rows arrive — overlapping rows in the DEFAULT partition '
    'block late attachment.';

-- Pre-create the current month plus the next 11 months.
DO $$
DECLARE
    base_month date := date_trunc('month', CURRENT_DATE)::date;
    i int;
BEGIN
    FOR i IN 0..11 LOOP
        PERFORM ensure_audit_logs_partition((base_month + (i || ' months')::interval)::date);
    END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Copy existing rows, preserving id and created_at.
-- ----------------------------------------------------------------------------
-- OVERRIDING SYSTEM VALUE is required to write into a GENERATED ALWAYS identity
-- column. COALESCE guards the (previously nullable) created_at.
INSERT INTO audit_logs
    (id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
OVERRIDING SYSTEM VALUE
SELECT
    id, user_id, action, resource_type, resource_id, details, ip_address, user_agent,
    COALESCE(created_at, CURRENT_TIMESTAMP)
FROM audit_logs_legacy;

-- Advance the identity sequence past the highest copied id.
DO $$
DECLARE
    max_id bigint;
BEGIN
    SELECT MAX(id) INTO max_id FROM audit_logs;
    IF max_id IS NOT NULL THEN
        PERFORM setval(pg_get_serial_sequence('audit_logs', 'id'), max_id);
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Recreate indexes on the parent (cascade to every partition).
-- ----------------------------------------------------------------------------
CREATE INDEX idx_audit_logs_user_id    ON audit_logs (user_id);
CREATE INDEX idx_audit_logs_action     ON audit_logs (action);
CREATE INDEX idx_audit_logs_resource   ON audit_logs (resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);
-- jsonb_path_ops GIN for containment queries on details (migration 016).
CREATE INDEX idx_audit_logs_details_gin ON audit_logs USING gin (details jsonb_path_ops);
-- BRIN for wide time-range scans (migration 016). Tiny per partition.
CREATE INDEX idx_audit_logs_created_at_brin ON audit_logs USING brin (created_at);

-- ----------------------------------------------------------------------------
-- 6. Drop the legacy table and its now-orphaned sequence.
-- ----------------------------------------------------------------------------
DROP TABLE audit_logs_legacy;
DROP SEQUENCE IF EXISTS audit_logs_id_seq;

COMMENT ON TABLE audit_logs IS
    'Comprehensive audit trail for all system actions. RANGE-partitioned by '
    'month on created_at (migration 020); use ensure_audit_logs_partition() to '
    'pre-create future months.';
