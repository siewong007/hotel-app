-- ============================================================================
-- MIGRATION 024: FRONT DESK RUNTIME SETTINGS
-- ============================================================================
-- Description: Persist client-facing settings that were previously local only.
-- ============================================================================

INSERT INTO system_settings (key, value, value_type, category, description, is_public)
VALUES
    (
        'night_shift_time',
        '23:00',
        'string',
        'operations',
        'Scheduled night audit posting time',
        false
    ),
    (
        'deposit_amount',
        '50',
        'number',
        'payments',
        'Default room card or check-in deposit amount',
        false
    ),
    (
        'tourism_tax_rate',
        '10',
        'number',
        'tax',
        'Tourism tax amount charged per night for foreign guests',
        false
    ),
    (
        'booking_channels',
        '[{"name":"Booking.com","abbreviation":"B.C"},{"name":"Agoda","abbreviation":"A.C"},{"name":"Traveloka","abbreviation":"T.C"},{"name":"Expedia","abbreviation":"E.C"},{"name":"Hotels.com","abbreviation":"H.C"},{"name":"Airbnb","abbreviation":"AB"},{"name":"Trip.com","abbreviation":"TR"},{"name":"Direct Website","abbreviation":"DW"},{"name":"Other OTA","abbreviation":"OT"}]',
        'json',
        'sales',
        'Online and direct booking channels available to front desk workflows',
        true
    ),
    (
        'payment_methods',
        '["Cash","Visa Card","Master Card","Debit Card","Sarawak Pay","American Express","Bank Transfer","E-Wallet","Other"]',
        'json',
        'payments',
        'Payment methods available to walk-in and payment workflows',
        true
    )
ON CONFLICT (key) DO NOTHING;
