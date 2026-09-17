// =============================================================================
// Get Bookings Base Query (no ORDER BY — used for dynamic filtering)
// =============================================================================

// The money columns below (payment_status, total_paid, total_refunded,
// balance_due, deposit_refunded, invoice_number) used to be written as 17
// correlated subqueries in the select list — the same four lookups repeated,
// because PostgreSQL does not de-duplicate textually identical subqueries and
// turns each occurrence into its own SubPlan re-executed per output row.
//
// Measured on production, both shapes run back to back on the same box, same
// config, same page (500 rows at offset 1500, 3,107 bookings):
//
//     old: 16 SubPlans, ~32,000 subquery executions   38,190 shared buffers
//     new: 0 SubPlans, 4 LATERAL joins                20,997 shared buffers  (-45%)
//
// Buffer count is the honest metric here and it is deterministic — identical on
// every repetition. Wall-clock on this host is NOT: the container is capped at
// 0.30 CPU on a shared Proxmox node, and repeated runs of the SAME query ranged
// 24-97ms for both shapes, so the medians overlap and no speed-up multiple can
// be claimed from them. An earlier draft of this comment claimed "6.2x faster,
// 82.9ms -> 13.3ms"; that compared the full query against a trimmed two-lateral
// prototype with far fewer output columns, and was wrong. What is established is
// that the same result now costs a little under half the buffer traffic, with
// no new index (uq_customer_ledgers_booking_room_charge and the payments
// booking key already existed). Production latency effects are visible in
// pg_stat_statements, which this change also finally enabled.
//
// Equivalence rests on one schema fact: uq_customer_ledgers_booking_room_charge
// is a UNIQUE partial index over exactly this predicate (booking_id) WHERE
// post_type='room_charge' AND COALESCE(is_reversal,false)=false, so the ledger
// lookup matches at most one row and its ORDER BY ... LIMIT 1 was vestigial.
// There is therefore no tie for the rewrite to break. The NULL semantics are
// preserved deliberately: a ledger row that exists with a NULL paid_amount must
// still fall through to the payments sum, which COALESCE(bk_charge.paid_amount,
// ...) does exactly as the original nested COALESCE did.
//
// Aliases are prefixed bk_ because booking_list.rs already binds `cl` and `pay`
// inside its own filter subqueries.
pub const GET_BOOKINGS_BASE_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.nick_name as guest_name, g.email as guest_email,
        g.guest_type::text as guest_type, g.tourism_type::text as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        -- Occupancy. Load-bearing, not cosmetic: the bookings board sums these
        -- into its "In-house guests" card, and while they were missing from this
        -- select list every booking silently counted as exactly one guest, so the
        -- card could never exceed the room count.
        b.adults, b.children,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- values below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount + COALESCE(b.tourism_tax_amount, 0) + COALESCE(b.extra_bed_charge, 0) <= 0 THEN 'paid'
            WHEN COALESCE(bk_charge.paid_amount, COALESCE(bk_pay.completed_paid, 0)) >= COALESCE(bk_charge.amount, b.total_amount + COALESCE(b.tourism_tax_amount, 0) + COALESCE(b.extra_bed_charge, 0)) THEN 'paid'
            WHEN COALESCE(bk_charge.paid_amount, COALESCE(bk_pay.completed_paid, 0)) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.booking_channel_id,
        bc.name AS booking_channel_name, bc.channel_type AS booking_channel_type,
        b.ota_reference, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE(bk_charge.paid_amount, COALESCE(bk_pay.completed_paid, 0)) AS total_paid,
        COALESCE(bk_pay.refunded, 0) AS total_refunded,
        CASE WHEN COALESCE(bk_charge.amount, b.total_amount + COALESCE(b.tourism_tax_amount, 0) + COALESCE(b.extra_bed_charge, 0)) - COALESCE(bk_charge.paid_amount, COALESCE(bk_pay.completed_paid, 0)) > 0 THEN COALESCE(bk_charge.amount, b.total_amount + COALESCE(b.tourism_tax_amount, 0) + COALESCE(b.extra_bed_charge, 0)) - COALESCE(bk_charge.paid_amount, COALESCE(bk_pay.completed_paid, 0)) ELSE 0 END AS balance_due,
        COALESCE(bk_pay.has_refund, FALSE) AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        b.cleaning_preference,
        COALESCE(bk_inv.invoice_number, bk_cli.invoice_number) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    LEFT JOIN booking_channels bc ON bc.id = b.booking_channel_id
    LEFT JOIN LATERAL (
        SELECT cl.amount, cl.paid_amount
        FROM customer_ledgers cl
        WHERE cl.booking_id = b.id
          AND cl.post_type = 'room_charge'
          AND COALESCE(cl.is_reversal, FALSE) = FALSE
        ORDER BY cl.created_at DESC
        LIMIT 1
    ) bk_charge ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            SUM(p.amount) FILTER (
                WHERE p.status = 'completed'
                  AND COALESCE(p.payment_type, 'booking') NOT IN ('refund', 'deposit', 'deposit_forfeited')
            ) AS completed_paid,
            SUM(p.amount) FILTER (
                WHERE p.status <> 'void'
                  AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')
            ) AS refunded,
            bool_or(p.status <> 'void' AND COALESCE(p.payment_type, 'booking') = 'refund') AS has_refund
        FROM payments p
        WHERE p.booking_id = b.id
    ) bk_pay ON TRUE
    LEFT JOIN LATERAL (
        SELECT inv.invoice_number
        FROM invoices inv
        WHERE inv.booking_id = b.id
        ORDER BY inv.created_at DESC
        LIMIT 1
    ) bk_inv ON TRUE
    LEFT JOIN LATERAL (
        SELECT cl.invoice_number
        FROM customer_ledgers cl
        WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL
        ORDER BY cl.created_at DESC
        LIMIT 1
    ) bk_cli ON TRUE
"#;

// =============================================================================
// Get Bookings Query (kept for backward compat)
// =============================================================================

// =============================================================================
// Get Booking By ID Query
// =============================================================================

pub const GET_BOOKING_BY_ID_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.nick_name as guest_name, g.email as guest_email,
        g.guest_type::text as guest_type, g.tourism_type::text as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        -- Occupancy -- keep in step with GET_BOOKINGS_BASE_QUERY above.
        b.adults, b.children,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount + COALESCE(b.tourism_tax_amount, 0) + COALESCE(b.extra_bed_charge, 0) <= 0 THEN 'paid'
            WHEN COALESCE((SELECT cl.paid_amount FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.post_type = 'room_charge' AND COALESCE(cl.is_reversal, FALSE) = FALSE ORDER BY cl.created_at DESC LIMIT 1), COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') NOT IN ('refund', 'deposit', 'deposit_forfeited')), 0)) >= COALESCE((SELECT cl.amount FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.post_type = 'room_charge' AND COALESCE(cl.is_reversal, FALSE) = FALSE ORDER BY cl.created_at DESC LIMIT 1), b.total_amount + COALESCE(b.tourism_tax_amount, 0) + COALESCE(b.extra_bed_charge, 0)) THEN 'paid'
            WHEN COALESCE((SELECT cl.paid_amount FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.post_type = 'room_charge' AND COALESCE(cl.is_reversal, FALSE) = FALSE ORDER BY cl.created_at DESC LIMIT 1), COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') NOT IN ('refund', 'deposit', 'deposit_forfeited')), 0)) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.booking_channel_id,
        bc.name AS booking_channel_name, bc.channel_type AS booking_channel_type,
        b.ota_reference, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT cl.paid_amount FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.post_type = 'room_charge' AND COALESCE(cl.is_reversal, FALSE) = FALSE ORDER BY cl.created_at DESC LIMIT 1), COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') NOT IN ('refund', 'deposit', 'deposit_forfeited')), 0)) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status <> 'void' AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN COALESCE((SELECT cl.amount FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.post_type = 'room_charge' AND COALESCE(cl.is_reversal, FALSE) = FALSE ORDER BY cl.created_at DESC LIMIT 1), b.total_amount + COALESCE(b.tourism_tax_amount, 0) + COALESCE(b.extra_bed_charge, 0)) - COALESCE((SELECT cl.paid_amount FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.post_type = 'room_charge' AND COALESCE(cl.is_reversal, FALSE) = FALSE ORDER BY cl.created_at DESC LIMIT 1), COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') NOT IN ('refund', 'deposit', 'deposit_forfeited')), 0)) > 0 THEN COALESCE((SELECT cl.amount FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.post_type = 'room_charge' AND COALESCE(cl.is_reversal, FALSE) = FALSE ORDER BY cl.created_at DESC LIMIT 1), b.total_amount + COALESCE(b.tourism_tax_amount, 0) + COALESCE(b.extra_bed_charge, 0)) - COALESCE((SELECT cl.paid_amount FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.post_type = 'room_charge' AND COALESCE(cl.is_reversal, FALSE) = FALSE ORDER BY cl.created_at DESC LIMIT 1), COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') NOT IN ('refund', 'deposit', 'deposit_forfeited')), 0)) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.status <> 'void' AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        b.cleaning_preference,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    LEFT JOIN booking_channels bc ON bc.id = b.booking_channel_id
    WHERE b.id = $1
"#;

// =============================================================================
// Today's Check-ins Query
// =============================================================================

// =============================================================================
// Today's Check-outs Query
// =============================================================================

// =============================================================================
// Active Bookings Query
// =============================================================================
