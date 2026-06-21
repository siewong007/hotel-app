-- Report preview and print font style settings.
-- Mirrors the PostgreSQL seed in database/schema.sql.

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES
    (
        'report_font_family',
        'Arial, Helvetica, sans-serif',
        'string',
        'reports',
        'Font family for generated report previews and print output',
        0
    ),
    (
        'report_heading_font_size',
        '24',
        'number',
        'reports',
        'Large heading and KPI font size in pixels for generated reports',
        0
    ),
    (
        'report_section_heading_font_size',
        '18',
        'number',
        'reports',
        'Section heading font size in pixels for generated reports',
        0
    ),
    (
        'report_table_font_size',
        '14',
        'number',
        'reports',
        'Table font size in pixels for generated reports',
        0
    ),
    (
        'report_caption_font_size',
        '13',
        'number',
        'reports',
        'Caption and secondary label font size in pixels for generated reports',
        0
    ),
    (
        'report_chip_font_size',
        '12',
        'number',
        'reports',
        'Status chip font size in pixels for generated reports',
        0
    );
