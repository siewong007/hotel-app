-- Per-room share of a multi-room booking's voucher:
-- `bookings.group_voucher_share`.
--
-- A fixed-amount group voucher is split across the rooms once at checkout.
-- Storing each room's share lets a later room change re-split it under the
-- owner-approved rules (booking_groups::voucher_resplit): a removed unpaid
-- room's share moves to the rooms still unpaid, capped at what they owe; a
-- paid or checked-in room's share is frozen; a removed paid room's share is
-- dropped; a room added later takes none.
--
-- Backfill (conservative): only rooms of a group whose voucher is a fixed
-- amount and that spent no complimentary credits, where the voucher
-- allocation rows hold exactly the voucher discount. Rooms with credits keep
-- 0, so they are simply never re-split (their old behaviour). Additive and
-- idempotent.
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS group_voucher_share numeric(12,2) DEFAULT 0 NOT NULL;

DO $share_check$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.bookings'::regclass
          AND conname = 'bookings_group_voucher_share_check'
    ) THEN
        ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_group_voucher_share_check CHECK (group_voucher_share >= 0);
    END IF;
END;
$share_check$;

WITH shares AS (
    SELECT b.id, SUM(a.discount_amount) AS share
    FROM public.bookings b
    JOIN public.booking_groups g ON g.id = b.booking_group_id
    JOIN public.vouchers v ON v.id = g.voucher_id
    JOIN public.promotions p ON p.id = v.promotion_id
    JOIN public.voucher_redemption_allocations a ON a.booking_id = b.id
    JOIN public.voucher_redemptions r ON r.id = a.redemption_id AND r.voucher_id = g.voucher_id
    WHERE p.discount_type::text <> 'percentage'
      AND COALESCE(b.complimentary_nights, 0) = 0
      AND b.group_voucher_share = 0
    GROUP BY b.id
)
UPDATE public.bookings b SET group_voucher_share = s.share
FROM shares s
WHERE b.id = s.id AND s.share > 0;
