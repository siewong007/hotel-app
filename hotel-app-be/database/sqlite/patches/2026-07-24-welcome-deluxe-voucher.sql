-- Create the automatic welcome voucher campaign for existing SQLite installs.
INSERT INTO promotions (
    slug, name, description, terms, status, promotion_kind, discount_type,
    discount_value, currency, min_nights, min_subtotal, per_guest_limit,
    is_public, is_cancellable, created_by, updated_by
) VALUES (
    'welcome-deluxe-10', 'Welcome Deluxe 10%',
    'A one-time welcome voucher for 10% off a Deluxe Room.',
    'Valid for one eligible Deluxe Room booking. One voucher per guest.',
    'published', 'voucher', 'percentage', 10.00, 'USD', 1, 0, 1, 0, 1, NULL, NULL
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO promotion_room_types (promotion_id, room_type_id)
SELECT p.id, rt.id
FROM promotions p
JOIN room_types rt ON rt.code = 'DLX'
WHERE p.slug = 'welcome-deluxe-10'
ON CONFLICT DO NOTHING;
