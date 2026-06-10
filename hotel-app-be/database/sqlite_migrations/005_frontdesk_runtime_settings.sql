-- ============================================================================
-- SQLITE MIGRATION 005: FRONT DESK RUNTIME SETTINGS
-- ============================================================================
-- Description: Persist client-facing settings that were previously local only.
-- ============================================================================

INSERT OR IGNORE INTO system_settings (key, value, value_type, category, description, is_sensitive)
VALUES
    (
        'night_shift_time',
        '23:00',
        'string',
        'operations',
        'Scheduled night audit posting time',
        0
    ),
    (
        'deposit_amount',
        '50',
        'number',
        'payments',
        'Default room card or check-in deposit amount',
        0
    ),
    (
        'tourism_tax_rate',
        '10',
        'number',
        'tax',
        'Tourism tax amount charged per night for foreign guests',
        0
    ),
    (
        'booking_channels',
        '[{"name":"Booking.com","abbreviation":"B.C"},{"name":"Agoda","abbreviation":"A.C"},{"name":"Traveloka","abbreviation":"T.C"},{"name":"Expedia","abbreviation":"E.C"},{"name":"Hotels.com","abbreviation":"H.C"},{"name":"Airbnb","abbreviation":"AB"},{"name":"Trip.com","abbreviation":"TR"},{"name":"Direct Website","abbreviation":"DW"},{"name":"Other OTA","abbreviation":"OT"}]',
        'json',
        'sales',
        'Online and direct booking channels available to front desk workflows',
        0
    ),
    (
        'payment_methods',
        '["Cash","Visa Card","Master Card","Debit Card","Sarawak Pay","American Express","Bank Transfer","E-Wallet","Other"]',
        'json',
        'payments',
        'Payment methods available to walk-in and payment workflows',
        0
    );
