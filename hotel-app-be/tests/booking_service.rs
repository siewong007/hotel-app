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
    assert_eq!(
        parts.len(),
        3,
        "number should have 3 dash-separated segments: {n}"
    );
    assert_eq!(parts[0], "BK");
    assert_eq!(
        parts[1].len(),
        8,
        "date segment should be 8 digits (YYYYMMDD): {n}"
    );
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
    let numbers: std::collections::HashSet<String> = (0..200)
        .map(|_| booking::generate_booking_number())
        .collect();
    assert_eq!(
        numbers.len(),
        200,
        "Generated duplicate booking numbers within 200 samples"
    );
}

// ---------------------------------------------------------------------------
// SQLite integration tests — in-memory DB, sqlite feature only
// ---------------------------------------------------------------------------

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use super::*;
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::services::bookings;
    use sqlx::Row;

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
            "INSERT INTO room_types (id, name, code, base_price) VALUES (9901, 'Test Standard', 'TSTD9901', 100.0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) VALUES (9901, 'T9901', 9901, 'available')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name) VALUES (9901, 'Test', 'Guest')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO bookings \
             (id, booking_number, guest_id, room_id, \
              check_in_date, check_out_date, rate_per_night, total_amount, status) \
             VALUES (9901, 'BK-20260418-deadbeef', 9901, 9901, '2026-04-18', '2026-04-19', 150.0, 150.0, 'confirmed')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let b = booking::fetch_booking_by_id(&pool, 9901)
            .await
            .expect("fetch_booking_by_id should succeed for existing row");

        assert_eq!(b.id, 9901);
        assert_eq!(b.booking_number, "BK-20260418-deadbeef");
        assert_eq!(b.guest_id, 9901);
        assert_eq!(b.room_id, 9901);
        assert_eq!(b.status, "confirmed");

        // Date fields round-trip correctly.
        use chrono::NaiveDate;
        assert_eq!(
            b.check_in_date,
            NaiveDate::from_ymd_opt(2026, 4, 18).unwrap()
        );
        assert_eq!(
            b.check_out_date,
            NaiveDate::from_ymd_opt(2026, 4, 19).unwrap()
        );

        // total_amount exists in the SQLite schema under the same column name.
        use rust_decimal::Decimal;
        assert_eq!(b.total_amount, Decimal::from(150));
    }

    async fn seed_room_guest_booking(
        pool: &sqlx::SqlitePool,
        booking_id: i64,
        guest_id: i64,
        room_id: i64,
        status: &str,
        check_in: &str,
        check_out: &str,
    ) {
        sqlx::query(
            "INSERT OR IGNORE INTO rooms (id, room_number, room_type_id, status) VALUES (?1, ?2, 1, 'available')",
        )
        .bind(room_id)
        .bind(format!("T{room_id}"))
        .execute(pool)
        .await
        .unwrap();

        sqlx::query("INSERT INTO guests (id, first_name, last_name) VALUES (?1, ?2, ?3)")
            .bind(guest_id)
            .bind("Reactivate")
            .bind(format!("Guest{guest_id}"))
            .execute(pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO bookings \
             (id, booking_number, guest_id, room_id, room_type_id, check_in_date, check_out_date, \
              rate_per_night, total_amount, status, created_by) \
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, 150.0, 150.0, ?7, 1)",
        )
        .bind(booking_id)
        .bind(format!("BK-20300101-{booking_id}"))
        .bind(guest_id)
        .bind(room_id)
        .bind(check_in)
        .bind(check_out)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn reactivate_booking_confirms_voided_booking_and_reserves_room() {
        let pool = common::setup_test_db().await;
        seed_room_guest_booking(
            &pool,
            9910,
            9910,
            9910,
            "voided",
            "2030-01-10",
            "2030-01-12",
        )
        .await;

        let booking = bookings::reactivate_booking(&pool, 1, 9910)
            .await
            .expect("voided booking should reactivate");

        assert_eq!(booking.id, 9910);
        assert_eq!(booking.status, "confirmed");

        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = ?1")
            .bind(9910_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(room_status, "reserved");

        let history = sqlx::query(
            "SELECT previous_status, new_status, change_reason FROM booking_history WHERE booking_id = ?1",
        )
        .bind(9910_i64)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(history.get::<String, _>("previous_status"), "voided");
        assert_eq!(history.get::<String, _>("new_status"), "confirmed");
        assert_eq!(
            history.get::<String, _>("change_reason"),
            "Booking reactivated"
        );

        let modification_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM booking_modifications WHERE booking_id = ?1 AND modification_type = 'reactivation'",
        )
        .bind(9910_i64)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(modification_count, 1);
    }

    #[tokio::test]
    async fn reactivate_booking_rejects_non_voided_status() {
        let pool = common::setup_test_db().await;
        seed_room_guest_booking(
            &pool,
            9920,
            9920,
            9920,
            "confirmed",
            "2030-02-10",
            "2030-02-12",
        )
        .await;

        let result = bookings::reactivate_booking(&pool, 1, 9920).await;

        assert!(
            matches!(result, Err(ApiError::BadRequest(ref message)) if message.contains("Only voided bookings can be reactivated")),
            "expected non-voided status rejection, got: {result:?}"
        );
    }

    #[tokio::test]
    async fn reactivate_booking_rejects_room_date_conflict() {
        let pool = common::setup_test_db().await;
        seed_room_guest_booking(
            &pool,
            9930,
            9930,
            9930,
            "voided",
            "2030-03-10",
            "2030-03-12",
        )
        .await;
        seed_room_guest_booking(
            &pool,
            9931,
            9931,
            9930,
            "confirmed",
            "2030-03-11",
            "2030-03-13",
        )
        .await;

        let result = bookings::reactivate_booking(&pool, 1, 9930).await;

        assert!(
            matches!(result, Err(ApiError::BadRequest(ref message)) if message.contains("room is already booked")),
            "expected conflict rejection, got: {result:?}"
        );

        let status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = ?1")
            .bind(9930_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "voided");
    }

    #[tokio::test]
    async fn reactivate_booking_preserves_identity_financials_and_existing_records() {
        let pool = common::setup_test_db().await;
        seed_room_guest_booking(
            &pool,
            9940,
            9940,
            9940,
            "voided",
            "2030-04-10",
            "2030-04-12",
        )
        .await;

        sqlx::query(
            "UPDATE bookings SET rate_per_night = 275.50, total_amount = 551.00, paid_amount = 125.00, deposit_amount = 50.00 WHERE id = ?1",
        )
        .bind(9940_i64)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO payments (payment_number, booking_id, guest_id, amount, payment_method, payment_type, status, processed_by) \
             VALUES ('PAY-9940-1', ?1, ?2, 125.00, 'cash', 'booking', 'completed', 1)",
        )
        .bind(9940_i64)
        .bind(9940_i64)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO customer_ledgers (ledger_number, guest_id, booking_id, transaction_type, transaction_date, description, debit_amount, balance, created_by) \
             VALUES ('LED-9940-1', ?1, ?2, 'room_charge', '2030-04-10', 'Existing ledger', 551.00, 551.00, 1)",
        )
        .bind(9940_i64)
        .bind(9940_i64)
        .execute(&pool)
        .await
        .unwrap();

        let before = sqlx::query(
            "SELECT booking_number, rate_per_night, total_amount, paid_amount, deposit_amount FROM bookings WHERE id = ?1",
        )
        .bind(9940_i64)
        .fetch_one(&pool)
        .await
        .unwrap();
        let payment_count_before: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE booking_id = ?1")
                .bind(9940_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let ledger_count_before: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM customer_ledgers WHERE booking_id = ?1")
                .bind(9940_i64)
                .fetch_one(&pool)
                .await
                .unwrap();

        let booking = bookings::reactivate_booking(&pool, 1, 9940)
            .await
            .expect("voided booking should reactivate");

        let after = sqlx::query(
            "SELECT booking_number, rate_per_night, total_amount, paid_amount, deposit_amount FROM bookings WHERE id = ?1",
        )
        .bind(9940_i64)
        .fetch_one(&pool)
        .await
        .unwrap();
        let payment_count_after: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE booking_id = ?1")
                .bind(9940_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let ledger_count_after: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM customer_ledgers WHERE booking_id = ?1")
                .bind(9940_i64)
                .fetch_one(&pool)
                .await
                .unwrap();

        assert_eq!(booking.id, 9940);
        assert_eq!(
            after.get::<String, _>("booking_number"),
            before.get::<String, _>("booking_number")
        );
        assert_eq!(
            after.get::<f64, _>("rate_per_night"),
            before.get::<f64, _>("rate_per_night")
        );
        assert_eq!(
            after.get::<f64, _>("total_amount"),
            before.get::<f64, _>("total_amount")
        );
        assert_eq!(
            after.get::<f64, _>("paid_amount"),
            before.get::<f64, _>("paid_amount")
        );
        assert_eq!(
            after.get::<f64, _>("deposit_amount"),
            before.get::<f64, _>("deposit_amount")
        );
        assert_eq!(payment_count_after, payment_count_before);
        assert_eq!(ledger_count_after, ledger_count_before);
    }

    #[tokio::test]
    async fn repeated_reactivation_returns_controlled_error_without_duplicate_audit_rows() {
        let pool = common::setup_test_db().await;
        seed_room_guest_booking(
            &pool,
            9950,
            9950,
            9950,
            "voided",
            "2030-05-10",
            "2030-05-12",
        )
        .await;

        bookings::reactivate_booking(&pool, 1, 9950)
            .await
            .expect("first reactivation should succeed");
        let result = bookings::reactivate_booking(&pool, 1, 9950).await;

        assert!(
            matches!(result, Err(ApiError::BadRequest(ref message)) if message.contains("Only voided bookings can be reactivated")),
            "expected repeated reactivation rejection, got: {result:?}"
        );

        let history_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_history WHERE booking_id = ?1")
                .bind(9950_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let modification_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM booking_modifications WHERE booking_id = ?1 AND modification_type = 'reactivation'",
        )
        .bind(9950_i64)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(history_count, 1);
        assert_eq!(modification_count, 1);
    }

    #[tokio::test]
    async fn reactivate_booking_enforces_service_authorization_boundary() {
        let pool = common::setup_test_db().await;
        seed_room_guest_booking(
            &pool,
            9960,
            9960,
            9960,
            "voided",
            "2030-06-10",
            "2030-06-12",
        )
        .await;
        sqlx::query(
            "INSERT INTO users (id, uuid, username, email, full_name, user_type, is_active, is_verified) \
             VALUES (9960, '99600000-0000-4000-8000-000000000000', 'no_role_9960', 'no-role-9960@hotel.local', 'No Role', 'staff', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = bookings::reactivate_booking(&pool, 9960, 9960).await;

        assert!(
            matches!(result, Err(ApiError::Forbidden(ref message)) if message.contains("permission")),
            "expected forbidden reactivation, got: {result:?}"
        );

        let status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = ?1")
            .bind(9960_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        let history_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_history WHERE booking_id = ?1")
                .bind(9960_i64)
                .fetch_one(&pool)
                .await
                .unwrap();

        assert_eq!(status, "voided");
        assert_eq!(history_count, 0);
    }

    #[tokio::test]
    async fn void_booking_marks_booking_voided_releases_room_and_cancels_payments() {
        let pool = common::setup_test_db().await;
        seed_room_guest_booking(
            &pool,
            9970,
            9970,
            9970,
            "confirmed",
            "2030-07-10",
            "2030-07-12",
        )
        .await;

        sqlx::query("UPDATE rooms SET status = 'reserved' WHERE id = ?1")
            .bind(9970_i64)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO payments (payment_number, booking_id, guest_id, amount, payment_method, payment_type, status, processed_by) \
             VALUES ('PAY-9970-1', ?1, ?2, 100.00, 'cash', 'booking', 'completed', 1)",
        )
        .bind(9970_i64)
        .bind(9970_i64)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO customer_ledgers (ledger_number, guest_id, booking_id, transaction_type, transaction_date, description, debit_amount, balance, created_by) \
             VALUES ('LED-9970-1', ?1, ?2, 'room_charge', '2030-07-10', 'Existing ledger', 300.00, 300.00, 1)",
        )
        .bind(9970_i64)
        .bind(9970_i64)
        .execute(&pool)
        .await
        .unwrap();

        let ledger_count_before: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM customer_ledgers WHERE booking_id = ?1")
                .bind(9970_i64)
                .fetch_one(&pool)
                .await
                .unwrap();

        let result = bookings::void_booking(&pool, 1, 9970, Some("Guest cancelled".to_string()))
            .await
            .expect("confirmed booking should void");

        assert_eq!(result["booking_id"].as_i64(), Some(9970));
        assert_eq!(result["complimentary_nights_credited"].as_i64(), Some(0));

        let booking_status: String =
            sqlx::query_scalar("SELECT status FROM bookings WHERE id = ?1")
                .bind(9970_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = ?1")
            .bind(9970_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        let payment_status: String =
            sqlx::query_scalar("SELECT status FROM payments WHERE booking_id = ?1")
                .bind(9970_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let ledger_count_after: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM customer_ledgers WHERE booking_id = ?1")
                .bind(9970_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let history = sqlx::query(
            "SELECT previous_status, new_status, change_reason FROM booking_history WHERE booking_id = ?1",
        )
        .bind(9970_i64)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(booking_status, "voided");
        assert_eq!(room_status, "available");
        assert_eq!(payment_status, "cancelled");
        assert_eq!(ledger_count_after, ledger_count_before);
        assert_eq!(history.get::<String, _>("previous_status"), "confirmed");
        assert_eq!(history.get::<String, _>("new_status"), "voided");
        assert_eq!(history.get::<String, _>("change_reason"), "Guest cancelled");
    }

    #[tokio::test]
    async fn void_booking_rejects_already_voided_without_duplicate_audit_rows() {
        let pool = common::setup_test_db().await;
        seed_room_guest_booking(
            &pool,
            9980,
            9980,
            9980,
            "confirmed",
            "2030-08-10",
            "2030-08-12",
        )
        .await;

        bookings::void_booking(&pool, 1, 9980, None)
            .await
            .expect("first void should succeed");
        let result = bookings::void_booking(&pool, 1, 9980, None).await;

        assert!(
            matches!(result, Err(ApiError::BadRequest(ref message)) if message.contains("already voided")),
            "expected repeated void rejection, got: {result:?}"
        );

        let history_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_history WHERE booking_id = ?1")
                .bind(9980_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let modification_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM booking_modifications WHERE booking_id = ?1 AND modification_type = 'voided'",
        )
        .bind(9980_i64)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(history_count, 1);
        assert_eq!(modification_count, 1);
    }

    #[tokio::test]
    async fn void_booking_rejects_checked_out_booking() {
        let pool = common::setup_test_db().await;
        seed_room_guest_booking(
            &pool,
            9985,
            9985,
            9985,
            "checked_out",
            "2030-08-20",
            "2030-08-22",
        )
        .await;

        let result = bookings::void_booking(&pool, 1, 9985, None).await;

        assert!(
            matches!(result, Err(ApiError::BadRequest(ref message)) if message.contains("checked_out")),
            "expected checked-out void rejection, got: {result:?}"
        );

        let status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = ?1")
            .bind(9985_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "checked_out");
    }

    #[tokio::test]
    async fn void_booking_enforces_service_authorization_boundary() {
        let pool = common::setup_test_db().await;
        seed_room_guest_booking(
            &pool,
            9990,
            9990,
            9990,
            "confirmed",
            "2030-09-10",
            "2030-09-12",
        )
        .await;
        sqlx::query(
            "INSERT INTO users (id, uuid, username, email, full_name, user_type, is_active, is_verified) \
             VALUES (9990, '99900000-0000-4000-8000-000000000000', 'no_role_9990', 'no-role-9990@hotel.local', 'No Role', 'staff', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = bookings::void_booking(&pool, 9990, 9990, None).await;

        assert!(
            matches!(result, Err(ApiError::Forbidden(ref message)) if message.contains("permission")),
            "expected forbidden void, got: {result:?}"
        );

        let status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = ?1")
            .bind(9990_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        let history_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_history WHERE booking_id = ?1")
                .bind(9990_i64)
                .fetch_one(&pool)
                .await
                .unwrap();

        assert_eq!(status, "confirmed");
        assert_eq!(history_count, 0);
    }

    #[tokio::test]
    async fn void_booking_restores_complimentary_room_type_credits() {
        let pool = common::setup_test_db().await;
        seed_room_guest_booking(
            &pool,
            9995,
            9995,
            9995,
            "confirmed",
            "2030-10-10",
            "2030-10-12",
        )
        .await;
        sqlx::query("UPDATE bookings SET is_complimentary = 1 WHERE id = ?1")
            .bind(9995_i64)
            .execute(&pool)
            .await
            .unwrap();

        let result = bookings::void_booking(&pool, 1, 9995, None)
            .await
            .expect("complimentary booking should void");

        let credits: i64 = sqlx::query_scalar(
            "SELECT nights_available FROM guest_complimentary_credits WHERE guest_id = ?1 AND room_type_id = 1",
        )
        .bind(9995_i64)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(result["complimentary_nights_credited"].as_i64(), Some(2));
        assert_eq!(credits, 2);
    }
}
