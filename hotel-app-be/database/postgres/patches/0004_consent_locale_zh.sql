-- Adds 'zh' to the consent_records.locale vocabulary so consent evidence can
-- record that the guest read the notices in Chinese.
--
-- The platform locale registry (core::i18n::SUPPORTED_LOCALES) already lists
-- zh and consent validation admits it; without this widening a zh consent
-- submission would still fail the check constraint at insert time.
--
-- Fresh installs already carry the current definition from the V1 baseline;
-- this patch converges installed databases onto exactly that definition.
--
-- The replacement is driven from the recorded current definition text rather
-- than from hand-written DDL, so a patched database reproduces the baseline
-- rendering byte for byte instead of drifting on spelling. The constants are
-- exact pg_get_constraintdef output, because the guards compare them
-- literally.

DO $consent_locale$
DECLARE
    found_definition text;
    current_definition constant text := $consent_locale_current$CHECK (((locale)::text = ANY (ARRAY[('en'::character varying)::text, ('ms'::character varying)::text, ('zh'::character varying)::text])))$consent_locale_current$;
    old_definition constant text := $consent_locale_old$CHECK (((locale)::text = ANY (ARRAY[('en'::character varying)::text, ('ms'::character varying)::text])))$consent_locale_old$;
BEGIN
    SELECT pg_get_constraintdef(constraint_row.oid)
    INTO found_definition
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
    WHERE schema_row.nspname = 'public'
      AND table_row.relname = 'consent_records'
      AND constraint_row.conname = 'consent_records_locale_check';

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'consent_records_locale_check has incompatible definition: <missing>';
    ELSIF found_definition = old_definition THEN
        EXECUTE 'ALTER TABLE public.consent_records DROP CONSTRAINT consent_records_locale_check';
        EXECUTE 'ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_locale_check '
            || current_definition;
    ELSIF found_definition <> current_definition THEN
        RAISE EXCEPTION 'consent_records_locale_check has incompatible definition: %', found_definition;
    END IF;
END;
$consent_locale$;
