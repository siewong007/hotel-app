-- Automatic release of stale unpaid holds (opt-in).
--
-- `services::bookings::release_stale_unpaid_holds` reads this setting on a
-- 15-minute schedule and does nothing unless it holds a positive number of
-- hours. It is introduced at '24' at the hotel's instruction: an unpaid ONLINE
-- booking keeps its room for a day, then the room goes back on sale. Front-desk
-- bookings are never released automatically. Set it to 0 in Settings to switch
-- the sweep off.
--
-- `value` is NOT updated on conflict, matching seed.sql: a hotel that has
-- already chosen a window keeps it if this patch is ever re-applied.
DO $unpaid_hold_release$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'system_settings'
    ) THEN
        RAISE EXCEPTION 'unpaid_hold_release preflight failed: system_settings is missing';
    END IF;

    INSERT INTO public.system_settings (key, value, value_type, category, description, is_public)
    VALUES (
        'unpaid_hold_release_hours',
        '24',
        'number',
        'booking',
        'Hours an unpaid online booking keeps its room before it is released automatically. 0 disables automatic release. Front-desk bookings are never released automatically.',
        false
    )
    ON CONFLICT (key) DO UPDATE SET
        value_type = EXCLUDED.value_type,
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        is_public = EXCLUDED.is_public,
        updated_at = CURRENT_TIMESTAMP
    WHERE system_settings.value_type IS DISTINCT FROM EXCLUDED.value_type
       OR system_settings.category IS DISTINCT FROM EXCLUDED.category
       OR system_settings.description IS DISTINCT FROM EXCLUDED.description
       OR system_settings.is_public IS DISTINCT FROM EXCLUDED.is_public;
END;
$unpaid_hold_release$;
