//! SQLite-compatible booking queries
//!
//! This module contains query constants for both PostgreSQL and SQLite.

// =============================================================================
// Get Bookings Query
// =============================================================================

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
pub const GET_BOOKINGS_QUERY: &str = r#"
    SELECT
        b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
        g.guest_type as guest_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
        b.payment_status, b.payment_method, b.source, b.remarks, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date
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
        g.guest_type::text as guest_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
        b.payment_status, b.payment_method, b.source, b.remarks, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date
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
        g.guest_type as guest_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
        b.payment_status, b.payment_method, b.source, b.remarks, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date
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
        g.guest_type::text as guest_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
        b.payment_status, b.payment_method, b.source, b.remarks, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date
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
        g.guest_type as guest_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
        b.payment_status, b.payment_method, b.source, b.remarks, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date
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
        g.guest_type::text as guest_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
        b.payment_status, b.payment_method, b.source, b.remarks, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date
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
        g.guest_type as guest_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
        b.payment_status, b.payment_method, b.source, b.remarks, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date
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
        g.guest_type::text as guest_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
        b.payment_status, b.payment_method, b.source, b.remarks, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date
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
        g.guest_type as guest_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
        b.payment_status, b.payment_method, b.source, b.remarks, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date
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
        g.guest_type::text as guest_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
        b.payment_status, b.payment_method, b.source, b.remarks, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date
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
        g.guest_type as guest_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
        b.payment_status, b.payment_method, b.source, b.remarks, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date
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
        g.guest_type::text as guest_type,
        b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
        b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
        b.payment_status, b.payment_method, b.source, b.remarks, b.is_complimentary, b.complimentary_reason,
        b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
        b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
        b.created_at, b.is_posted, b.posted_date
    FROM bookings b
    INNER JOIN guests g ON b.guest_id = g.id
    INNER JOIN rooms r ON b.room_id = r.id
    INNER JOIN room_types rt ON r.room_type_id = rt.id
    WHERE b.status IN ('checked_in', 'auto_checked_in')
    ORDER BY b.created_at DESC
"#;
