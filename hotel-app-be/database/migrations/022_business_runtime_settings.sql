-- ============================================================================
-- MIGRATION 022: BUSINESS RUNTIME SETTINGS
-- ============================================================================
-- Description: Add hotel-facing settings that replace hardcoded defaults.
-- ============================================================================

INSERT INTO system_settings (key, value, value_type, category, description, is_public)
VALUES
    (
        'default_payment_terms_days',
        '30',
        'number',
        'ledger',
        'Default ledger due-date offset in days when a company has no payment terms',
        false
    ),
    (
        'totp_issuer_name',
        'Hotel Management System',
        'string',
        'security',
        'Issuer name shown in authenticator apps during TOTP setup',
        false
    ),
    (
        'passkey_relying_party_name',
        'Hotel Management System',
        'string',
        'security',
        'Display name shown by passkey authenticators during registration',
        false
    )
ON CONFLICT (key) DO NOTHING;
