-- Recompute every booking group's totals, room count, payment status and
-- status from its non-voided member bookings.
--
-- Groups written before the group-status hook (#308) kept the payment status
-- they were created with even after every room was paid. This is the same
-- calculation as BookingGroupRepository::refresh_totals_tx and
-- derive_group_payment_status:
--   * live members are bookings with status <> 'voided';
--   * member payment status defaults to 'unpaid'; 'void' members are ignored;
--   * no live statuses -> 'void'; all equal -> that status; any
--     paid/paid_rate/partial in a mix -> 'partial'; otherwise the first (by id);
--   * no live members -> group status 'voided', else 'active'.
-- Idempotent: rows already in step are left untouched.
WITH members AS (
    SELECT g.id,
           COUNT(b.id) FILTER (WHERE b.status <> 'voided')::int AS room_count,
           COALESCE(SUM(b.subtotal) FILTER (WHERE b.status <> 'voided'), 0) AS subtotal,
           COALESCE(SUM(b.discount_amount) FILTER (WHERE b.status <> 'voided'), 0) AS discount_amount,
           COALESCE(SUM(b.tax_amount) FILTER (WHERE b.status <> 'voided'), 0) AS tax_amount,
           COALESCE(SUM(b.tourism_tax_amount) FILTER (WHERE b.status <> 'voided'), 0) AS tourism_tax_amount,
           COALESCE(SUM(b.total_amount) FILTER (WHERE b.status <> 'voided'), 0) AS total_amount,
           COALESCE(
               array_agg(COALESCE(b.payment_status::text, 'unpaid') ORDER BY b.id)
                   FILTER (WHERE b.status <> 'voided'
                           AND COALESCE(b.payment_status::text, 'unpaid') <> 'void'),
               ARRAY[]::text[]) AS live_statuses
    FROM public.booking_groups g
    LEFT JOIN public.bookings b ON b.booking_group_id = g.id
    GROUP BY g.id
), derived AS (
    SELECT m.*,
           CASE
               WHEN cardinality(m.live_statuses) = 0 THEN 'void'
               WHEN (SELECT COUNT(DISTINCT s) FROM unnest(m.live_statuses) s) = 1
                   THEN m.live_statuses[1]
               WHEN m.live_statuses && ARRAY['paid', 'paid_rate', 'partial']::text[]
                   THEN 'partial'
               ELSE m.live_statuses[1]
           END AS payment_status,
           CASE WHEN m.room_count = 0 THEN 'voided' ELSE 'active' END AS status
    FROM members m
)
UPDATE public.booking_groups g SET
    room_count = d.room_count,
    subtotal = d.subtotal,
    discount_amount = d.discount_amount,
    tax_amount = d.tax_amount,
    tourism_tax_amount = d.tourism_tax_amount,
    total_amount = d.total_amount,
    payment_status = d.payment_status,
    status = d.status,
    updated_at = CURRENT_TIMESTAMP
FROM derived d
WHERE g.id = d.id
  AND (g.room_count, g.subtotal, g.discount_amount, g.tax_amount,
       g.tourism_tax_amount, g.total_amount, g.payment_status::text, g.status::text)
      IS DISTINCT FROM
      (d.room_count, d.subtotal, d.discount_amount, d.tax_amount,
       d.tourism_tax_amount, d.total_amount, d.payment_status, d.status);
