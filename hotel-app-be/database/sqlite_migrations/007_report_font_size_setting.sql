-- Report preview and print font size setting.
-- Mirrors the PostgreSQL seed in database/schema.sql.

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES (
    'report_font_size',
    '14',
    'number',
    'reports',
    'Base font size in pixels for generated report previews and print output',
    0
);
