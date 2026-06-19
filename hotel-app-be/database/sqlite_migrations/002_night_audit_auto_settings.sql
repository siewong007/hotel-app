-- Automatic night audit scheduler settings (opt-in).
-- Mirrors the PostgreSQL seed in database/schema.sql. The in-process scheduler
-- reads these live; `night_shift_time` (seeded in 001) is reused as the trigger
-- time. Note: night audit posting itself is PostgreSQL-only (stored procedure),
-- so on SQLite these settings stay inert.

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES
    (
        'night_audit_auto_enabled',
        'false',
        'boolean',
        'operations',
        'When true, the backend runs the night audit automatically at night_shift_time',
        0
    ),
    (
        'night_audit_catchup_days',
        '7',
        'number',
        'operations',
        'Max number of missed business dates the scheduler will back-fill in one sweep',
        0
    );
