-- When today's new reservations show on the New reservations strip.
--
-- The room timeline, room grid, guest stays and the booking list are not
-- filtered by this clock. There is no existing morning setting to copy
-- (check-in is 15:00, check-out 11:00, night audit 23:00), so the default
-- is 14:00. A same-day booking created after that time still appears
-- immediately. Fresh installs also get the row from seed.sql. `value` is
-- never overwritten. Idempotent.
--
-- Managers can open Hotel Settings (`settings:read`) and change this one
-- clock. They do not gain `settings:update`.

INSERT INTO system_settings (key, value, value_type, category, description, is_public, default_value)
VALUES (
    'new_reservation_visible_time',
    '14:00',
    'string',
    'general',
    'Hotel-local time when a new reservation for today first appears on the New reservations strip. Same-day bookings created after this time appear immediately. Does not hide reservations from the timeline, room grid, guest stays or the booking list.',
    false,
    '14:00'
)
ON CONFLICT (key) DO UPDATE SET
    value_type = EXCLUDED.value_type,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    is_public = EXCLUDED.is_public,
    default_value = COALESCE(system_settings.default_value, EXCLUDED.default_value),
    updated_at = CURRENT_TIMESTAMP
WHERE system_settings.value_type IS DISTINCT FROM EXCLUDED.value_type
   OR system_settings.category IS DISTINCT FROM EXCLUDED.category
   OR system_settings.description IS DISTINCT FROM EXCLUDED.description
   OR system_settings.is_public IS DISTINCT FROM EXCLUDED.is_public
   OR system_settings.default_value IS NULL;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'manager'
  AND p.name = 'settings:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;
