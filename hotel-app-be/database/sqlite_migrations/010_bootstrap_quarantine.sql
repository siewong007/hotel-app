-- ============================================================================
-- SQLITE MIGRATION 010: BOOTSTRAP QUARANTINE
-- ============================================================================
-- Description: SQLite-compatible quarantine table aligned with PostgreSQL
--              bootstrap validation metadata.
-- ============================================================================

CREATE TABLE IF NOT EXISTS invalid_data_quarantine (
    quarantine_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_table TEXT NOT NULL,
    source_key TEXT,
    invalid_reason TEXT NOT NULL,
    original_data TEXT NOT NULL,
    quarantined_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invalid_data_quarantine_source
    ON invalid_data_quarantine (source_table, quarantined_at DESC);
