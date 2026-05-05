//! SQLite-compatible booking queries
//!
//! This module contains query constants for both PostgreSQL and SQLite.

// =============================================================================
// Get Bookings Base Query (no ORDER BY — used for dynamic filtering)
// =============================================================================

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_BOOKINGS_BASE_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type as guest_type, g.tourism_type as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
"#;

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub const GET_BOOKINGS_BASE_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type::text as guest_type, g.tourism_type::text as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
"#;

// =============================================================================
// Get Bookings Query (kept for backward compat)
// =============================================================================

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_BOOKINGS_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type as guest_type, g.tourism_type as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    ORDER BY b.created_at DESC
"#;

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub const GET_BOOKINGS_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type::text as guest_type, g.tourism_type::text as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    ORDER BY b.created_at DESC
"#;

// =============================================================================
// Get User Bookings Query
// =============================================================================

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_USER_BOOKINGS_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type as guest_type, g.tourism_type as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    WHERE g.email = ?1
    ORDER BY b.created_at DESC
"#;

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub const GET_USER_BOOKINGS_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type::text as guest_type, g.tourism_type::text as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    WHERE g.email = $1
    ORDER BY b.created_at DESC
"#;

// =============================================================================
// Get Booking By ID Query
// =============================================================================

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_BOOKING_BY_ID_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type as guest_type, g.tourism_type as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    WHERE b.id = ?1
"#;

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub const GET_BOOKING_BY_ID_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type::text as guest_type, g.tourism_type::text as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    WHERE b.id = $1
"#;

// =============================================================================
// Get User Email Query
// =============================================================================

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_USER_EMAIL_QUERY: &str = "SELECT email FROM users WHERE id = ?1";

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub const GET_USER_EMAIL_QUERY: &str = "SELECT email FROM users WHERE id = $1";

// =============================================================================
// Today's Check-ins Query
// =============================================================================

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_TODAYS_CHECKINS_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type as guest_type, g.tourism_type as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    WHERE b.check_in_date = date('now')
    ORDER BY b.created_at DESC
"#;

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub const GET_TODAYS_CHECKINS_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type::text as guest_type, g.tourism_type::text as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    WHERE b.check_in_date = CURRENT_DATE
    ORDER BY b.created_at DESC
"#;

// =============================================================================
// Today's Check-outs Query
// =============================================================================

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_TODAYS_CHECKOUTS_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type as guest_type, g.tourism_type as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    WHERE b.check_out_date = date('now')
    ORDER BY b.created_at DESC
"#;

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub const GET_TODAYS_CHECKOUTS_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type::text as guest_type, g.tourism_type::text as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    WHERE b.check_out_date = CURRENT_DATE
    ORDER BY b.created_at DESC
"#;

// =============================================================================
// Active Bookings Query
// =============================================================================

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_ACTIVE_BOOKINGS_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type as guest_type, g.tourism_type as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    WHERE b.status IN ('checked_in', 'auto_checked_in')
    ORDER BY b.created_at DESC
"#;

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
pub const GET_ACTIVE_BOOKINGS_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type::text as guest_type, g.tourism_type::text as guest_tourism_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date,
        COALESCE(NULLIF(b.room_rate, 0), COALESCE(r.custom_price, rt.base_price)) as room_rate,
        b.total_amount, b.status,
        -- payment_status is derived live from the payments table so the chip
        -- never goes out of sync with the live total_paid / balance_due
        -- subqueries below. Stored bookings.payment_status is intentionally
        -- ignored unless the booking is voided or complimentary.
        CASE
            WHEN b.status = 'voided' THEN 'voided'
            WHEN COALESCE(b.is_complimentary, FALSE) THEN COALESCE(b.payment_status, 'paid')
            WHEN b.total_amount <= 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) >= b.total_amount THEN 'paid'
            WHEN COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN 'partial'
            ELSE 'unpaid'
        END AS payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) AS total_paid,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND (p.status = 'refunded' OR COALESCE(p.payment_type, 'booking') = 'refund')), 0) AS total_refunded,
        CASE WHEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) > 0 THEN b.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed' AND COALESCE(p.payment_type, 'booking') != 'refund'), 0) ELSE 0 END AS balance_due,
        EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND COALESCE(p.payment_type, 'booking') = 'refund') AS deposit_refunded,
        b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date,
        b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
        b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out, b.daily_rates,
        COALESCE(
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1),
            (SELECT cl.invoice_number FROM customer_ledgers cl WHERE cl.booking_id = b.id AND cl.invoice_number IS NOT NULL ORDER BY cl.created_at DESC LIMIT 1)
        ) AS invoice_number
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    WHERE b.status IN ('checked_in', 'auto_checked_in')
    ORDER BY b.created_at DESC
"#;
