-- ============================================================================
-- SQLITE MIGRATION 003: BUSINESS RUNTIME SETTINGS
-- ============================================================================
-- Description: Add hotel-facing settings that replace hardcoded defaults.
-- ============================================================================

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES
    (
        'default_payment_terms_days',
        '30',
        'number',
        'ledger',
        'Default ledger due-date offset in days when a company has no payment terms',
        0
    ),
    (
        'totp_issuer_name',
        'Hotel Management System',
        'string',
        'security',
        'Issuer name shown in authenticator apps during TOTP setup',
        0
    ),
    (
        'passkey_relying_party_name',
        'Hotel Management System',
        'string',
        'security',
        'Display name shown by passkey authenticators during registration',
        0
    );
