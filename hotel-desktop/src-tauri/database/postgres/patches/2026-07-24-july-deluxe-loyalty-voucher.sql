-- July 2026 loyalty reward: 2,000 points for a one-time 20% Deluxe Room voucher.
INSERT INTO promotions (
    slug, name, description, terms, status, promotion_kind, discount_type,
    discount_value, currency, claim_starts_at, claim_ends_at, stay_starts_on,
    stay_ends_on, min_nights, min_subtotal, per_guest_limit, is_public,
    is_cancellable, created_by, updated_by
) SELECT
    'july-deluxe-20-loyalty', 'July Deluxe Room 20% Voucher',
    'Redeem 2,000 loyalty points for 20% off one eligible Deluxe Room booking.',
    'One voucher per guest. Claim and stay dates must be in July 2026. Valid only for Deluxe Rooms.',
    'published', 'voucher', 'percentage', 20.00, 'USD',
    '2026-07-01 00:00:00+00', '2026-07-31 23:59:59+00', '2026-07-01', '2026-07-31',
    1, 0, 1, false, true, u.id, u.id
FROM users u
ORDER BY u.is_super_admin DESC, u.id
LIMIT 1
ON CONFLICT (slug) DO NOTHING;

INSERT INTO promotion_room_types (promotion_id, room_type_id)
SELECT p.id, rt.id
FROM promotions p
JOIN room_types rt ON rt.code = 'DLX'
WHERE p.slug = 'july-deluxe-20-loyalty'
ON CONFLICT DO NOTHING;

INSERT INTO loyalty_rewards (
    name, description, category, points_cost, requires_approval, is_active,
    valid_from, valid_to, terms_conditions
) VALUES (
    'July Deluxe Room 20% Voucher',
    'Redeem 2,000 points for a voucher worth 20% off a Deluxe Room.',
    'discount', 2000, false, true, '2026-07-01', '2026-07-31',
    'The voucher is issued immediately, may be used once, and is valid only for a Deluxe Room stay in July 2026.'
) ON CONFLICT DO NOTHING;
