-- Hotel default locale setting.
--
-- `i18n::mail_locale` already falls back to `system_settings.default_locale`
-- when a guest carries no `language_preference`, but no row was ever seeded,
-- so the setting could not be stored (update_system_setting rejects unknown
-- keys with NotFound) and no Settings screen could expose it. Fresh installs
-- get the row from seed.sql; this patch converges installed V1 databases.
--
-- Public because the frontend reads `/settings/public` at boot to apply the
-- hotel's language to guests who have not chosen one. `default_value` is
-- written on insert so the settings-reset endpoint can restore 'en'; an
-- existing row's recorded default is kept. `value` is never overwritten — a
-- hotel that already set it keeps its choice. Idempotent.
INSERT INTO system_settings (key, value, value_type, category, description, is_public, default_value)
VALUES (
    'default_locale',
    'en',
    'string',
    'general',
    'Fallback language for the interface and guest emails when a guest has no language preference. One of: en, ms, zh, zh-TW.',
    true,
    'en'
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
