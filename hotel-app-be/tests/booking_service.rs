//! Integration tests for `services::booking`
//!
//! Pure unit tests run under any feature. SQLite integration tests are gated
//! with `#[cfg(all(feature = "sqlite", not(feature = "postgres")))]` and
//! require an in-memory database; run them with:
//!
//!   cargo test --features sqlite --no-default-features

mod common;

use hotel_app_be::services::booking;

// ---------------------------------------------------------------------------
// Unit tests — no database needed
// ---------------------------------------------------------------------------

#[test]
fn booking_number_has_correct_format() {
    let n = booking::generate_booking_number();

    // Expected: "BK-YYYYMMDD-XXXXXXXX"
    let parts: Vec<&str> = n.splitn(3, '-').collect();
    assert_eq!(parts.len(), 3, "number should have 3 dash-separated segments: {n}");
    assert_eq!(parts[0], "BK");
    assert_eq!(parts[1].len(), 8, "date segment should be 8 digits (YYYYMMDD): {n}");
    assert!(
        parts[1].chars().all(|c| c.is_ascii_digit()),
        "date segment must be all digits: {n}"
    );
    assert_eq!(parts[2].len(), 8, "UUID suffix should be 8 hex chars: {n}");
    assert!(
        parts[2].chars().all(|c| c.is_ascii_hexdigit() || c == '-'),
        "UUID suffix should be hex: {n}"
    );
}

#[test]
fn booking_numbers_are_unique() {
    let numbers: std::collections::HashSet<String> =
        (0..200).map(|_| booking::generate_booking_number()).collect();
    assert_eq!(numbers.len(), 200, "Generated duplicate booking numbers within 200 samples");
}

// ---------------------------------------------------------------------------
// SQLite integration tests — in-memory DB, sqlite feature only
// ---------------------------------------------------------------------------

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use super::*;
    use hotel_app_be::core::error::ApiError;

    #[tokio::test]
    async fn fetch_booking_by_id_returns_not_found_for_missing_id() {
        let pool = common::setup_test_db().await;

        let result = booking::fetch_booking_by_id(&pool, 99999).await;
        assert!(
            matches!(result, Err(ApiError::NotFound(_))),
            "Expected NotFound, got: {result:?}"
        );
    }

    #[tokio::test]
    async fn fetch_booking_by_id_returns_correct_booking() {
        let pool = common::setup_test_db().await;

        // Seed the minimum required rows.
        //
        // The SQLite bookings table uses `rate_per_night` instead of `room_rate`
        // (the PostgreSQL column name). `row_to_booking` will therefore map
        // `room_rate` to Decimal::ZERO for SQLite rows, while `total_amount`,
        // `status`, booking identifiers, and date fields all read correctly.
        sqlx::query(
            "INSERT INTO room_types (id, name, code, base_price) VALUES (1, 'Standard', 'STD', 100.0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) VALUES (1, '101', 1, 'available')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name) VALUES (1, 'Test', 'Guest')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO bookings \
             (id, booking_number, guest_id, room_id, \
              check_in_date, check_out_date, rate_per_night, total_amount, status) \
             VALUES (1, 'BK-20260418-deadbeef', 1, 1, '2026-04-18', '2026-04-19', 150.0, 150.0, 'confirmed')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let b = booking::fetch_booking_by_id(&pool, 1).await
            .expect("fetch_booking_by_id should succeed for existing row");

        assert_eq!(b.id, 1);
        assert_eq!(b.booking_number, "BK-20260418-deadbeef");
        assert_eq!(b.guest_id, 1);
        assert_eq!(b.room_id, 1);
        assert_eq!(b.status, "confirmed");

        // Date fields round-trip correctly.
        use chrono::NaiveDate;
        assert_eq!(b.check_in_date, NaiveDate::from_ymd_opt(2026, 4, 18).unwrap());
        assert_eq!(b.check_out_date, NaiveDate::from_ymd_opt(2026, 4, 19).unwrap());

        // total_amount exists in the SQLite schema under the same column name.
        use rust_decimal::Decimal;
        assert_eq!(b.total_amount, Decimal::from(150));
    }
}
