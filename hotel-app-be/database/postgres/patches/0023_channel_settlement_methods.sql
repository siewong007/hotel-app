-- Online bookings are settled by their channel: the room charge of an OTA
-- booking is collected by the OTA, and a direct-website booking is paid by
-- bank transfer or PayPal. `booking_channels.settlement_payment_methods`
-- lists the payment-method labels a channel's room charge may be recorded
-- under; the backend refuses any other tender for `payment_type = 'booking'`
-- rows on such bookings (payments::settlement_lock). Matching is case- and
-- punctuation-insensitive and ignores a trailing ".com", so legacy spellings
-- such as `Booking.Com`, `Traveloka.Com`, `bank_transfer` or `Paypal` still
-- match.
--
-- Seeds the five live online channels by name or code, only where the list
-- is still NULL, so a re-run never overwrites a configured value. Existing
-- payments are not touched. Idempotent.

ALTER TABLE public.booking_channels
    ADD COLUMN IF NOT EXISTS settlement_payment_methods text[];

COMMENT ON COLUMN public.booking_channels.settlement_payment_methods IS 'Payment-method labels the room charge (payment_type booking) of a booking on this channel may be recorded with; NULL/empty = not an online-settled channel';

UPDATE public.booking_channels AS bc
SET settlement_payment_methods = seed.methods,
    updated_at = CURRENT_TIMESTAMP
FROM (VALUES
    ('direct website', 'direct_website', ARRAY['Bank Transfer', 'PayPal']::text[]),
    ('booking.com',    'booking_com',    ARRAY['Booking.com']::text[]),
    ('agoda',          'agoda',          ARRAY['Agoda.com']::text[]),
    ('traveloka',      'traveloka',      ARRAY['Traveloka']::text[]),
    ('expedia',        'expedia',        ARRAY['Expedia.com']::text[])
) AS seed(name_key, code_key, methods)
WHERE bc.settlement_payment_methods IS NULL
  AND (lower(btrim(bc.name)) = seed.name_key OR bc.code = seed.code_key);
