-- Change the untouched default for the New reservations strip to 07:00.
--
-- Keep manager-selected values intact. The old 14:00 row is only changed when
-- it still matches the original default; customized settings are not touched.
-- Idempotent.

UPDATE system_settings
SET value = '07:00',
    default_value = '07:00',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'new_reservation_visible_time'
  AND value = '14:00'
  AND (default_value IS NULL OR default_value = '14:00');
