//! Marketing: promotions in every status, vouchers + redemptions, email
//! templates/campaigns/deliveries, suppression list. Ported from staging.sql
//! §50 tail + §70. Voucher redemptions reference bookings 802104/802111/802116
//! — scenarios including this module must also include bookings_ops +
//! bookings_matrix (the registry already does).

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL_PROMOTIONS).execute(&mut **tx).await?;
    sqlx::raw_sql(SQL_VOUCHERS).execute(&mut **tx).await?;
    sqlx::raw_sql(SQL_COMMS).execute(&mut **tx).await?;
    Ok(())
}

const SQL_PROMOTIONS: &str = r#"
INSERT INTO public.promotions (
    id, slug, name, description, terms, status, promotion_kind, discount_type,
    discount_value, max_discount_amount, currency, claim_starts_at, claim_ends_at,
    stay_starts_on, stay_ends_on, min_nights, max_nights, min_subtotal,
    claim_limit, claimed_count, per_guest_limit, is_public, is_cancellable,
    internal_code, objective, created_by, updated_by
)
OVERRIDING SYSTEM VALUE VALUES
    (807001, 'stg-weekend-15', 'Weekend Escape 15%', '15% off weekend stays (Fri-Sun).', 'Min 2 nights. Stays must start Fri or Sat.', 'published', 'deal', 'percentage', 15.00, 200.00, 'USD',
        (SELECT today-30 FROM staging_ref)::timestamptz, (SELECT today+60 FROM staging_ref)::timestamptz,
        (SELECT today FROM staging_ref), (SELECT today+90 FROM staging_ref), 2, 5, 200.00, 500, 37, 1, true, true, 'WKND15', 'occupancy', 800007, 800007),
    (807002, 'stg-member-voucher-20', 'Member Voucher RM20eq', 'Flat 20 off for loyalty members.', 'One per member. Public claimable.', 'published', 'voucher', 'fixed_amount', 20.00, NULL, 'USD',
        (SELECT today-15 FROM staging_ref)::timestamptz, (SELECT today+30 FROM staging_ref)::timestamptz,
        (SELECT today FROM staging_ref), (SELECT today+60 FROM staging_ref), 1, NULL, 50.00, 200, 12, 1, true, true, 'MBR20', 'loyalty', 800007, 800007),
    (807003, 'stg-corporate-10', 'Corporate Partner 10%', 'Corporate account partner rate.', 'Linked corporate accounts only.', 'published', 'deal', 'percentage', 10.00, NULL, 'USD',
        NULL, NULL, (SELECT today-90 FROM staging_ref), (SELECT today+180 FROM staging_ref), 1, NULL, 0.00, NULL, 64, 2, false, true, 'CORP10', 'retention', 800007, 800007),
    (807004, 'stg-merdeka-sale', 'Merdeka Flash Sale', 'Flash sale — ended.', 'Was live for 48h.', 'archived', 'deal', 'percentage', 30.00, 300.00, 'USD',
        (SELECT today-40 FROM staging_ref)::timestamptz, (SELECT today-38 FROM staging_ref)::timestamptz,
        (SELECT today-30 FROM staging_ref), (SELECT today-10 FROM staging_ref), 1, 3, 100.00, 300, 300, 1, true, false, 'MDK30', 'acquisition', 800007, 800007),
    (807005, 'stg-paused-upsell', 'Suite Upsell Push', 'Paused pending rate review.', 'Internal only.', 'paused', 'deal', 'fixed_amount', 50.00, NULL, 'USD',
        (SELECT today-10 FROM staging_ref)::timestamptz, (SELECT today+20 FROM staging_ref)::timestamptz,
        (SELECT today+5 FROM staging_ref), (SELECT today+90 FROM staging_ref), 3, NULL, 800.00, 50, 3, 1, false, true, 'UPSL50', 'upsell', 800007, 800001),
    (807006, 'stg-cancelled-test', 'Cancelled Test Promo', 'Cancelled before launch.', NULL, 'cancelled', 'voucher', 'percentage', 25.00, NULL, 'USD',
        NULL, NULL, NULL, NULL, 1, NULL, 0.00, 10, 0, 1, false, true, 'CXL25', 'other', 800007, 800007),
    (807007, 'stg-draft-cny', 'CNY Early Bird (draft)', 'Draft — not yet published.', NULL, 'draft', 'deal', 'percentage', 18.00, 150.00, 'USD',
        NULL, NULL, (SELECT today+120 FROM staging_ref), (SELECT today+140 FROM staging_ref), 2, NULL, 300.00, 100, 0, 1, true, true, 'CNY18', 'occupancy', 800007, 800007),
    -- Edge states: published but claim window closed; published but claim
    -- limit reached; published voucher promo that is private (unclaimable by
    -- the public gallery but vouchers on it remain valid).
    (807008, 'stg-window-closed', 'Window Closed Voucher', 'Published but the claim window has closed.', 'Claim period ended.', 'published', 'voucher', 'percentage', 5.00, NULL, 'USD',
        (SELECT today-40 FROM staging_ref)::timestamptz, (SELECT today-10 FROM staging_ref)::timestamptz,
        (SELECT today-30 FROM staging_ref), (SELECT today+30 FROM staging_ref), 1, NULL, 0.00, 100, 40, 1, true, true, 'WINC05', 'acquisition', 800007, 800007),
    (807009, 'stg-limit-reached', 'Limit Reached Voucher', 'Published but the claim limit is exhausted.', 'All claims taken.', 'published', 'voucher', 'fixed_amount', 10.00, NULL, 'USD',
        (SELECT today-20 FROM staging_ref)::timestamptz, (SELECT today+20 FROM staging_ref)::timestamptz,
        (SELECT today FROM staging_ref), (SELECT today+60 FROM staging_ref), 1, NULL, 0.00, 3, 3, 1, true, true, 'LIMT10', 'acquisition', 800007, 800007),
    (807010, 'stg-private-voucher', 'Private Voucher 20%', 'Published voucher promo hidden from the public gallery.', 'Invitation only.', 'published', 'voucher', 'percentage', 20.00, NULL, 'USD',
        (SELECT today-15 FROM staging_ref)::timestamptz, (SELECT today+45 FROM staging_ref)::timestamptz,
        (SELECT today FROM staging_ref), (SELECT today+90 FROM staging_ref), 1, NULL, 0.00, 50, 8, 1, false, true, 'PRIV20', 'retention', 800007, 800007);

INSERT INTO public.promotion_room_types (promotion_id, room_type_id) VALUES
    (807001, 800202), (807001, 800201),
    (807002, 800201),
    (807003, 800202), (807005, 800202),
    (807007, 800202), (807007, 800201);
INSERT INTO public.promotion_room_types (promotion_id, room_type_id)
SELECT 807001, id FROM public.room_types WHERE code IN ('DLX', 'STE');
INSERT INTO public.promotion_room_types (promotion_id, room_type_id)
SELECT 807002, id FROM public.room_types WHERE code IN ('STD', 'DLX');
INSERT INTO public.promotion_room_types (promotion_id, room_type_id)
SELECT 807003, id FROM public.room_types WHERE code IN ('DLX', 'STE');

INSERT INTO public.promotion_channels (promotion_id, booking_channel_id)
SELECT p.id, bc.id FROM public.promotions p CROSS JOIN public.booking_channels bc
WHERE p.id = 807001 AND bc.channel_type IN ('website', 'ota');
INSERT INTO public.promotion_channels (promotion_id, booking_channel_id)
SELECT 807002, id FROM public.booking_channels WHERE name IN ('Direct Website', 'Direct');

INSERT INTO public.promotion_loyalty_tiers (promotion_id, loyalty_tier_id)
SELECT 807002, t.id FROM public.loyalty_tiers t WHERE t.code IN ('gold', 'platinum');
"#;

const SQL_VOUCHERS: &str = r#"
INSERT INTO public.vouchers (
    id, promotion_id, guest_id, code, status, source, expires_at,
    redeemed_at, revoked_at, revoked_by, revocation_reason, issued_by, claimed_at
)
OVERRIDING SYSTEM VALUE VALUES
    (805001, 807002, 801001, 'STG-VCH-0001', 'redeemed', 'guest_claim', (SELECT today+30 FROM staging_ref)::timestamptz,
        (SELECT today-10 FROM staging_ref)::timestamptz, NULL, NULL, NULL, NULL, (SELECT today-12 FROM staging_ref)::timestamptz),
    (805002, 807002, 801002, 'STG-VCH-0002', 'available', 'guest_claim', (SELECT today+30 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, NULL, (SELECT today-5 FROM staging_ref)::timestamptz),
    (805003, 807002, 801003, 'STG-VCH-0003', 'available', 'admin_issue', (SELECT today+14 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, 800007, (SELECT today-3 FROM staging_ref)::timestamptz),
    (805004, 807002, 801016, 'STG-VCH-0004', 'revoked', 'admin_issue', (SELECT today+14 FROM staging_ref)::timestamptz,
        NULL, (SELECT today-2 FROM staging_ref)::timestamptz, 800001, 'Guest blacklisted — voucher revoked', 800007, (SELECT today-7 FROM staging_ref)::timestamptz),
    (805005, 807002, 801007, 'STG-VCH-0005', 'available', 'guest_claim', (SELECT today+2 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, NULL, (SELECT today-30 FROM staging_ref)::timestamptz),
    -- Welcome voucher (bootstrap promotion) redeemed on a completed stay.
    (805006, (SELECT id FROM public.promotions WHERE slug = 'welcome-deluxe-10'), 801002, 'STG-WLC-0001', 'redeemed', 'guest_claim', (SELECT today-5 FROM staging_ref)::timestamptz,
        (SELECT today-11 FROM staging_ref)::timestamptz, NULL, NULL, NULL, NULL, (SELECT today-20 FROM staging_ref)::timestamptz),
    -- Claimed while the window was open; the promo's claim window has since
    -- closed (807008) — voucher itself remains valid.
    (805007, 807008, 801001, 'STG-VCH-0007', 'available', 'guest_claim', (SELECT today+20 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, NULL, (SELECT today-25 FROM staging_ref)::timestamptz),
    -- Voucher on the private published promotion (807010).
    (805008, 807010, 801004, 'STG-VCH-0008', 'available', 'admin_issue', (SELECT today+30 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, 800007, (SELECT today-4 FROM staging_ref)::timestamptz),
    -- Claimed before the limit was hit on 807009.
    (805009, 807009, 801006, 'STG-VCH-0009', 'available', 'guest_claim', (SELECT today+15 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, NULL, (SELECT today-6 FROM staging_ref)::timestamptz),
    -- Status 'available' but expires_at already passed => derived "expired".
    (805010, 807002, 801005, 'STG-VCH-0010', 'available', 'admin_issue', (SELECT today-1 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, 800007, (SELECT today-15 FROM staging_ref)::timestamptz);

INSERT INTO public.voucher_redemptions (
    id, voucher_id, promotion_id, booking_id, guest_id, status,
    gross_subtotal, discount_type, discount_value, discount_amount, net_total,
    applied_by, applied_at
)
OVERRIDING SYSTEM VALUE VALUES
    (805101, 805001, 807002, 802116, 801002, 'applied',
        450.00, 'fixed_amount', 20.00, 20.00, 430.00, 800002, (SELECT today-11 FROM staging_ref)::timestamptz),
    (805102, 805006, (SELECT id FROM public.promotions WHERE slug = 'welcome-deluxe-10'), 802104, 801004, 'applied',
        500.00, 'percentage', 10.00, 50.00, 450.00, 800003, (SELECT today-11 FROM staging_ref)::timestamptz),
    -- Reversed redemption (guest rebooked, voucher returned).
    (805103, 805003, 807002, 802111, 801012, 'reversed',
        90.00, 'fixed_amount', 20.00, 20.00, 70.00, 800002, (SELECT today-2 FROM staging_ref)::timestamptz);

UPDATE public.voucher_redemptions
SET reversed_by = 800001, reversed_at = (SELECT today-1 FROM staging_ref)::timestamptz,
    reversal_reason = 'Booking dates changed — voucher released'
WHERE id = 805103;

INSERT INTO public.voucher_redemption_allocations (id, redemption_id, booking_id, stay_date, gross_amount, discount_amount, net_amount)
OVERRIDING SYSTEM VALUE VALUES
    (805201, 805102, 802104, (SELECT today-2 FROM staging_ref), 250.00, 25.00, 225.00),
    (805202, 805102, 802104, (SELECT today-1 FROM staging_ref), 250.00, 25.00, 225.00);
"#;

const SQL_COMMS: &str = r#"
INSERT INTO public.email_templates (
    id, code, name, subject, body_html, body_text, variables, is_active
)
OVERRIDING SYSTEM VALUE VALUES
    (807101, 'stg_booking_confirmation', 'Booking Confirmation', 'Your booking {{booking_number}} is confirmed', '<p>Dear {{guest_name}}, your stay at {{hotel_name}} is confirmed.</p>', 'Dear {{guest_name}}, your stay is confirmed.', '["guest_name","booking_number","hotel_name","check_in_date","check_out_date"]'::jsonb, true),
    (807102, 'stg_pre_arrival', 'Pre-Arrival Reminder', 'Your stay starts in 2 days — {{booking_number}}', '<p>We look forward to welcoming you, {{guest_name}}.</p>', 'We look forward to welcoming you, {{guest_name}}.', '["guest_name","booking_number","check_in_date"]'::jsonb, true),
    (807103, 'stg_checkout_receipt', 'Checkout Receipt', 'Receipt for booking {{booking_number}}', '<p>Thank you for staying with us.</p>', 'Thank you for staying with us.', '["guest_name","booking_number","total_amount"]'::jsonb, true),
    (807104, 'stg_retired_template', 'Retired Template', 'Legacy subject', '<p>Legacy</p>', 'Legacy', NULL, false);

INSERT INTO public.email_campaigns (
    id, name, campaign_type, topic, status, subject, body_html, body_text,
    template_id, promotion_id, segment_id, scheduled_at, started_at, completed_at,
    total_recipients, sent_count, failed_count, created_by
)
OVERRIDING SYSTEM VALUE VALUES
    -- Completed campaign that drove the voucher claims.
    (807201, 'Weekend Escape Launch', 'promotion', 'promotion', 'completed', 'This weekend only: 15% off', '<p>Book the Weekend Escape…</p>', 'Book the Weekend Escape…',
        807101, 807001, NULL, (SELECT today-25 FROM staging_ref)::timestamptz, (SELECT today-25 FROM staging_ref)::timestamptz, (SELECT today-25 FROM staging_ref)::timestamptz + interval '20 minutes', 84, 82, 2, 800007),
    -- Campaign with zero sends (no bookings / empty reach).
    (807202, 'Merdeka Flash Sale (ended)', 'promotion', 'promotion', 'completed', '48-hour flash sale', '<p>Flash sale…</p>', 'Flash sale…',
        NULL, 807004, NULL, (SELECT today-40 FROM staging_ref)::timestamptz, (SELECT today-40 FROM staging_ref)::timestamptz, (SELECT today-40 FROM staging_ref)::timestamptz + interval '10 minutes', 0, 0, 0, 800007),
    -- Running campaign.
    (807203, 'Member Voucher Push', 'promotion', 'promotion', 'running', 'Your RM20 member voucher is here', '<p>Claim your voucher…</p>', 'Claim your voucher…',
        NULL, 807002, NULL, (SELECT today-15 FROM staging_ref)::timestamptz, (SELECT today-15 FROM staging_ref)::timestamptz, NULL, 120, 96, 4, 800007),
    -- Scheduled announcement.
    (807204, 'Pool Maintenance Notice', 'announcement', 'announcement', 'scheduled', 'Pool closed for maintenance — next week', '<p>Please note…</p>', 'Please note…',
        NULL, NULL, NULL, (SELECT today+3 FROM staging_ref)::timestamptz, NULL, NULL, 0, 0, 0, 800007),
    -- Draft.
    (807205, 'CNY Early Bird (draft)', 'promotion', 'promotion', 'draft', 'Celebrate CNY early', '<p>Draft…</p>', 'Draft…',
        NULL, 807007, NULL, NULL, NULL, NULL, 0, 0, 0, 800007),
    -- Failed campaign for the error view.
    (807206, 'Expedia Partner Blast', 'announcement', 'announcement', 'failed', 'Partner announcement', '<p>…</p>', '…',
        NULL, NULL, NULL, (SELECT today-8 FROM staging_ref)::timestamptz, (SELECT today-8 FROM staging_ref)::timestamptz, NULL, 0, 0, 0, 800007);
UPDATE public.email_campaigns SET error = 'SMTP provider rejected sender domain' WHERE id = 807206;

INSERT INTO public.email_deliveries (
    id, campaign_id, kind, guest_id, topic, recipient_email, subject, body_html,
    voucher_id, status, attempts, next_attempt_at, provider_message_id,
    idempotency_key, last_error, sent_at
)
OVERRIDING SYSTEM VALUE VALUES
    (807301, 807201, 'campaign', 801001, 'promotion', 'aisha.rahman@staging.hotel-app.test', 'This weekend only: 15% off', '<p>…</p>', NULL, 'sent', 1, (SELECT today-25 FROM staging_ref)::timestamptz, 'msg-stg-0001', 'stg-del-0001', NULL, (SELECT today-25 FROM staging_ref)::timestamptz + interval '1 minute'),
    (807302, 807201, 'campaign', 801002, 'promotion', 'marcus.tan@staging.hotel-app.test', 'This weekend only: 15% off', '<p>…</p>', NULL, 'sent', 1, (SELECT today-25 FROM staging_ref)::timestamptz, 'msg-stg-0002', 'stg-del-0002', NULL, (SELECT today-25 FROM staging_ref)::timestamptz + interval '1 minute'),
    (807303, 807201, 'campaign', 801018, 'promotion', 'daniel.lee@staging.hotel-app.test', 'This weekend only: 15% off', '<p>…</p>', NULL, 'failed', 5, (SELECT today-25 FROM staging_ref)::timestamptz + interval '1 hour', NULL, 'stg-del-0003', 'SMTP 550 mailbox unavailable', NULL),
    (807304, 807203, 'campaign', 801003, 'promotion', 'emily.wilson@staging.hotel-app.test', 'Your RM20 member voucher is here', '<p>…</p>', 805003, 'sent', 1, (SELECT today-15 FROM staging_ref)::timestamptz, 'msg-stg-0004', 'stg-del-0004', NULL, (SELECT today-15 FROM staging_ref)::timestamptz + interval '2 minutes'),
    (807305, 807203, 'campaign', 801016, 'promotion', 'gerald.frost@staging.hotel-app.test', 'Your RM20 member voucher is here', '<p>…</p>', 805004, 'sent', 1, (SELECT today-15 FROM staging_ref)::timestamptz, 'msg-stg-0005', 'stg-del-0005', NULL, (SELECT today-15 FROM staging_ref)::timestamptz + interval '2 minutes'),
    (807306, NULL, 'booking_confirmation', 801006, 'booking_confirmation', 'chen.wei@staging.hotel-app.test', 'Your booking B-STG-1006 is confirmed', '<p>…</p>', NULL, 'sent', 1, (SELECT today-2 FROM staging_ref)::timestamptz, 'msg-stg-0006', 'stg-del-0006', NULL, (SELECT today-2 FROM staging_ref)::timestamptz + interval '1 minute'),
    (807307, NULL, 'pre_arrival_reminder', 801014, 'pre_arrival_reminder', 'lucy.kim@staging.hotel-app.test', 'Your stay starts in 2 days', '<p>…</p>', NULL, 'queued', 0, (SELECT today+3 FROM staging_ref)::timestamptz, NULL, 'stg-del-0007', NULL, NULL),
    (807308, NULL, 'checkout_receipt', 801004, 'checkout_receipt', 'kenji.takahashi@staging.hotel-app.test', 'Receipt for booking B-STG-1004', '<p>…</p>', NULL, 'sent', 1, (SELECT today FROM staging_ref)::timestamptz + interval '10 hours', 'msg-stg-0008', 'stg-del-0008', NULL, (SELECT today FROM staging_ref)::timestamptz + interval '10 hours'),
    -- Suppressed recipient (unsubscribed earlier — matches suppression row).
    (807309, 807203, 'campaign', 801019, 'promotion', 'daniel.leigh@staging.hotel-app.test', 'Your RM20 member voucher is here', '<p>…</p>', NULL, 'suppressed', 0, (SELECT today-15 FROM staging_ref)::timestamptz, NULL, 'stg-del-0009', 'Recipient suppressed', NULL);

INSERT INTO public.email_suppressions (id, email, reason, source, notes)
OVERRIDING SYSTEM VALUE VALUES
    (807401, 'daniel.leigh@staging.hotel-app.test', 'unsubscribe', 'guest_portal', 'Unsubscribed from marketing'),
    (807402, 'bounced.guest@staging.hotel-app.test', 'bounce', 'smtp_provider', 'Hard bounce 550'),
    (807403, 'complaint.guest@staging.hotel-app.test', 'complaint', 'smtp_provider', NULL);
"#;
