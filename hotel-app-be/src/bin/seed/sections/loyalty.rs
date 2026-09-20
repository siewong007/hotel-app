//! Loyalty: members, accounts, dual-membership view, points ledger, reward
//! catalog, redemptions, complimentary credits. Ported from staging.sql §80.
//! Points transactions reference bookings (802101/802102/802116) and payments
//! (804102/804103/804112) — scenarios including this module also need
//! bookings_ops + bookings_matrix + finance.

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL).execute(&mut **tx).await?;
    Ok(())
}

const SQL: &str = r#"
-- Members + accounts against the seeded loyalty program/tiers.
WITH prog AS (SELECT id FROM public.loyalty_programs ORDER BY id LIMIT 1),
     tier AS (SELECT id, code FROM public.loyalty_tiers)
INSERT INTO public.loyalty_members (id, guest_id, member_number, status, enrolled_at, closed_at)
OVERRIDING SYSTEM VALUE
SELECT 808000 + rn, guest_id, member_number, status, enrolled_at, closed_at FROM (VALUES
    (1, 801001, 'LM-STG-0001', 'active',    (SELECT today-200 FROM staging_ref)::timestamptz, NULL::timestamptz),
    (2, 801002, 'LM-STG-0002', 'active',    (SELECT today-160 FROM staging_ref)::timestamptz, NULL::timestamptz),
    (3, 801003, 'LM-STG-0003', 'active',    (SELECT today-120 FROM staging_ref)::timestamptz, NULL::timestamptz),
    (4, 801006, 'LM-STG-0004', 'active',    (SELECT today-90  FROM staging_ref)::timestamptz, NULL::timestamptz),
    (5, 801009, 'LM-STG-0005', 'suspended', (SELECT today-300 FROM staging_ref)::timestamptz, NULL::timestamptz),
    (6, 801017, 'LM-STG-0006', 'closed',    (SELECT today-400 FROM staging_ref)::timestamptz, (SELECT today-30 FROM staging_ref)::timestamptz)
) v(rn, guest_id, member_number, status, enrolled_at, closed_at);

WITH tier AS (SELECT id, code FROM public.loyalty_tiers)
INSERT INTO public.loyalty_accounts (id, member_id, current_tier_id, lifetime_points, qualifying_points, qualifying_nights, qualifying_spend, tier_evaluation_year)
OVERRIDING SYSTEM VALUE
SELECT 808100 + v.rn, 808000 + v.rn, t.id, v.lifetime, v.qual_pts, v.qual_nights, v.qual_spend,
       EXTRACT(year FROM (SELECT today FROM staging_ref))::int
FROM (VALUES
    (1, 'gold',     12400, 6200, 18, 7400.00),
    (2, 'silver',    4300, 2100,  9, 2600.00),
    (3, 'platinum', 31200,14400, 34,18600.00),
    (4, 'gold',     18900, 8100, 22, 9800.00),
    (5, 'bronze',    1200,  400,  2,  520.00),
    (6, 'silver',    5600,    0, 14, 3900.00)
) v(rn, tier_code, lifetime, qual_pts, qual_nights, qual_spend)
JOIN tier t ON t.code = v.tier_code;

WITH prog AS (SELECT id FROM public.loyalty_programs ORDER BY id LIMIT 1),
     tier AS (SELECT id, code FROM public.loyalty_tiers)
INSERT INTO public.loyalty_memberships (id, guest_id, program_id, tier_id, member_number, points_balance, lifetime_points, status, enrolled_at, expires_at, last_activity_at)
OVERRIDING SYSTEM VALUE
SELECT 808200 + v.rn, v.guest_id, prog.id, t.id, v.member_number, v.balance, v.lifetime, v.status,
       v.enrolled_at, v.expires_at, v.last_activity_at
FROM (VALUES
    (1, 801001, 'LM-STG-0001', 1800, 12400, 'active',    (SELECT today-200 FROM staging_ref)::timestamptz, NULL::timestamptz, (SELECT today-10 FROM staging_ref)::timestamptz, 'gold'::text),
    (2, 801002, 'LM-STG-0002',  640,  4300, 'active',    (SELECT today-160 FROM staging_ref)::timestamptz, NULL::timestamptz, (SELECT today-11 FROM staging_ref)::timestamptz, 'silver'::text),
    (3, 801003, 'LM-STG-0003', 5200, 31200, 'active',    (SELECT today-120 FROM staging_ref)::timestamptz, NULL::timestamptz, (SELECT today-2  FROM staging_ref)::timestamptz, 'platinum'::text),
    (4, 801006, 'LM-STG-0004', 2900, 18900, 'active',    (SELECT today-90  FROM staging_ref)::timestamptz, NULL::timestamptz, (SELECT today-1  FROM staging_ref)::timestamptz, 'gold'::text),
    (5, 801009, 'LM-STG-0005',  120,  1200, 'suspended', (SELECT today-300 FROM staging_ref)::timestamptz, NULL::timestamptz, (SELECT today-60 FROM staging_ref)::timestamptz, 'bronze'::text),
    (6, 801017, 'LM-STG-0006',    0,  5600, 'inactive',  (SELECT today-400 FROM staging_ref)::timestamptz, (SELECT today-30 FROM staging_ref)::timestamptz, (SELECT today-30 FROM staging_ref)::timestamptz, 'silver'::text)
) v(rn, guest_id, member_number, balance, lifetime, status, enrolled_at, expires_at, last_activity_at, tier_code)
CROSS JOIN prog
LEFT JOIN tier t ON t.code = v.tier_code;

-- Points ledger: earn on posted stays, a redemption, an adjustment, an expiry.
INSERT INTO public.loyalty_transactions (
    id, member_id, account_id, transaction_type, points_delta, available_delta,
    balance_after, source_type, source_id, booking_id, payment_id, invoice_id,
    description, actor_user_id, created_at
)
OVERRIDING SYSTEM VALUE VALUES
    (808301, 808001, 808101, 'earned',   486,  486,  486, 'booking', 802116, 802116, 804112, NULL, 'Points earned — B-STG-1016', NULL, (SELECT today-7 FROM staging_ref)::timestamptz),
    (808302, 808001, 808101, 'earned',   640,  640, 1126, 'booking', 802101, 802101, 804102, NULL, 'Points earned — B-STG-1001', NULL, (SELECT today-1 FROM staging_ref)::timestamptz),
    (808303, 808001, 808101, 'redeemed', -500, -500,  626, 'reward',  NULL, NULL,   NULL,   NULL, 'Redeemed — free-night voucher', 800002, (SELECT today-5 FROM staging_ref)::timestamptz),
    (808304, 808002, 808102, 'earned',   486,  486,  486, 'booking', 802116, 802116, 804112, 804503, 'Points earned — B-STG-1016', NULL, (SELECT today-7 FROM staging_ref)::timestamptz),
    (808305, 808002, 808102, 'adjusted',  154,  154,  640, 'manual',  NULL, NULL,   NULL,   NULL, 'Goodwill adjustment — service issue', 800001, (SELECT today-3 FROM staging_ref)::timestamptz),
    (808306, 808003, 808103, 'earned',  1720, 1720, 1720, 'booking', 802102, 802102, 804103, NULL, 'Points earned — B-STG-1002', NULL, (SELECT today-2 FROM staging_ref)::timestamptz),
    (808307, 808004, 808104, 'expired', -300, -300,  2600, 'expiry',  NULL, NULL,   NULL,   NULL, 'Points expired — 24-month rule', NULL, (SELECT today-10 FROM staging_ref)::timestamptz),
    (808308, 808006, 808106, 'reversed', -5600, -5600, 0, 'closure', NULL, NULL,   NULL,   NULL, 'Balance cleared on membership close', 800001, (SELECT today-30 FROM staging_ref)::timestamptz);

-- Reward catalog + redemptions (pending/approved/rejected).
INSERT INTO public.loyalty_rewards (id, name, description, category, points_cost, requires_approval, is_active)
OVERRIDING SYSTEM VALUE VALUES
    (808401, 'Free Night — Standard', 'One free night in a Standard room', 'free_night', 2000, true, true),
    (808402, 'RM50 F&B Voucher',     'Fifty ringgit food & beverage credit', 'voucher',   800, false, true),
    (808403, 'Suite Upgrade',        'One-category upgrade, subject to availability', 'upgrade', 1500, true, true);

INSERT INTO public.loyalty_redemptions (id, member_id, reward_id, transaction_id, points_spent, status, requested_at, reviewed_by, reviewed_at, rejection_reason)
OVERRIDING SYSTEM VALUE VALUES
    (808501, 808001, 808401, 808303, 500, 'approved', (SELECT today-6 FROM staging_ref)::timestamptz, 800001, (SELECT today-5 FROM staging_ref)::timestamptz, NULL),
    (808502, 808003, 808402, NULL,   800, 'pending',  (SELECT today-1 FROM staging_ref)::timestamptz, NULL, NULL, NULL),
    (808503, 808002, 808403, NULL,  1500, 'rejected', (SELECT today-9 FROM staging_ref)::timestamptz, 800001, (SELECT today-8 FROM staging_ref)::timestamptz, 'Insufficient qualifying nights for upgrade reward');

-- Complimentary-night credits on the guest profile.
INSERT INTO public.guest_complimentary_credits (id, guest_id, room_type_id, nights_available, notes)
OVERRIDING SYSTEM VALUE VALUES
    (808601, 801001, 800202, 2, 'VIP goodwill — two premier nights'),
    (808602, 801006, 800201, 1, 'Service recovery credit');
"#;
