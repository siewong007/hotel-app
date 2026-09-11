-- Authenticator prompts carry the hotel's name, not the product label.
--
-- `totp_issuer_name` and `passkey_relying_party_name` shipped holding the
-- string 'Hotel Management System', so that is what an authenticator app
-- displayed next to every staff member's code, and what a passkey prompt said
-- the credential belonged to. Both settings now mean "empty = use hotel_name",
-- which `settings_cache::get_hotel_display_name` resolves on every read — the
-- same name that already brands outbound email.
--
-- The UPDATE is scoped to rows still holding that exact shipped default, so a
-- hotel that typed its own issuer keeps it. Re-running matches nothing, which
-- is what makes this idempotent; the description sync is unconditional because
-- it documents the new meaning of the value either way.
DO $authenticator_hotel_name$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'system_settings'
    ) THEN
        RAISE EXCEPTION 'authenticator_hotel_name preflight failed: system_settings is missing';
    END IF;

    UPDATE public.system_settings
    SET value = '',
        updated_at = CURRENT_TIMESTAMP
    WHERE key IN ('totp_issuer_name', 'passkey_relying_party_name')
      AND value = 'Hotel Management System';

    UPDATE public.system_settings
    SET description = 'Issuer name shown in authenticator apps during TOTP setup. Empty uses hotel_name.'
    WHERE key = 'totp_issuer_name'
      AND description IS DISTINCT FROM 'Issuer name shown in authenticator apps during TOTP setup. Empty uses hotel_name.';

    UPDATE public.system_settings
    SET description = 'Display name shown by passkey authenticators during registration. Empty uses hotel_name.'
    WHERE key = 'passkey_relying_party_name'
      AND description IS DISTINCT FROM 'Display name shown by passkey authenticators during registration. Empty uses hotel_name.';
END;
$authenticator_hotel_name$;
