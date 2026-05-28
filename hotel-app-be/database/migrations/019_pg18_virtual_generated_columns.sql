-- ============================================================================
-- MIGRATION 019: VIRTUAL GENERATED COLUMNS
-- ============================================================================
-- Description:
--   Adds a virtual (read-time, no storage) generated column to bookings that
--   exposes the *billable* tourism tax in one place instead of forcing every
--   report to write `CASE WHEN is_tourist THEN tourism_tax_amount ELSE 0 END`.
--
--   PostgreSQL 18 added VIRTUAL generated columns; this is exactly the case
--   they target: a deterministic expression over other columns where the
--   value isn't searched often enough to justify storing it. Reports compute
--   it on read; writes pay zero overhead.
--
--   Existing rows are unaffected — virtual columns aren't materialized.
--   Application code can opt in by SELECTing bookings.tourism_billable_amount
--   instead of duplicating the CASE expression.
--
-- Postgres-only (SQLite uses STORED generated columns and lacks VIRTUAL).
-- ============================================================================

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS tourism_billable_amount DECIMAL(10, 2)
    GENERATED ALWAYS AS (
        CASE WHEN is_tourist THEN COALESCE(tourism_tax_amount, 0) ELSE 0 END
    ) VIRTUAL;

COMMENT ON COLUMN bookings.tourism_billable_amount IS
    'Virtual generated column (PG 18): tourism_tax_amount when is_tourist, else 0. '
    'Computed on read; no storage overhead. Replaces repeated CASE expressions '
    'in reporting queries.';
