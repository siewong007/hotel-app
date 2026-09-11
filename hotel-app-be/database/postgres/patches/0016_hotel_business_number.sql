-- The hotel's own business registration number becomes a configured setting.
--
-- The booking terms have to name the supplier's registered number: Malaysian
-- e-commerce disclosure (Electronic Commerce Act 2006 s.10 and the Consumer
-- Protection (Electronic Trade Transactions) Regulations 2012 r.3) requires an
-- online buyer to be shown it. The frontend carried a compiled-in placeholder
-- instead, so every deployment rendered the same literal string and no operator
-- could correct it without a release.
--
-- Seeding it as a row makes it editable from Settings and readable before
-- sign-in (is_public), which the public /legal pages need. The value ships as
-- Salim Inn's SSM number, matching the compiled-in fallback the frontend keeps
-- for the case where the row has not reached a browser yet.
--
-- Idempotent by ON CONFLICT DO NOTHING: a database that already carries the key
-- keeps whatever an operator typed there, which is the same contract seed.sql
-- holds for every other setting (it syncs metadata, never `value`).
DO $hotel_business_number$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'system_settings'
    ) THEN
        RAISE EXCEPTION 'hotel_business_number preflight failed: system_settings is missing';
    END IF;

    INSERT INTO public.system_settings (key, value, value_type, category, description, is_public)
    VALUES (
        'hotel_business_number',
        'SA2012724',
        'string',
        'general',
        'Business registration (SSM) number shown in the booking terms and other legal disclosures',
        true
    )
    ON CONFLICT (key) DO NOTHING;

    -- Metadata sync for a database that somehow already holds the key: the value
    -- is deliberately left alone, only the shape and visibility are corrected.
    UPDATE public.system_settings
    SET value_type = 'string',
        category = 'general',
        description = 'Business registration (SSM) number shown in the booking terms and other legal disclosures',
        is_public = true,
        updated_at = CURRENT_TIMESTAMP
    WHERE key = 'hotel_business_number'
      AND (value_type IS DISTINCT FROM 'string'
           OR category IS DISTINCT FROM 'general'
           OR description IS DISTINCT FROM 'Business registration (SSM) number shown in the booking terms and other legal disclosures'
           OR is_public IS DISTINCT FROM true);
END;
$hotel_business_number$;
