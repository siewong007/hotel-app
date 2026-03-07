-- Migration: Add service_tax_rate to system_settings if not present
INSERT INTO system_settings (key, value, description)
VALUES ('service_tax_rate', '8', 'Service tax percentage applied to room charges (e.g. 8 for 8%)')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE system_settings IS 'System-wide configuration settings including tax rates';
