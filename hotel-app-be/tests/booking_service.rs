//! Integration tests for `services::booking`
//!
//! Pure unit tests run under any feature. SQLite integration tests are gated
//! with `#[cfg(all(feature = "sqlite", not(feature = "postgres")))]` and
//! require an in-memory database; run them with:
//!
//!   cargo test --features sqlite --no-default-features

mod common;

use hotel_app_be::services::booking;

// The PostgreSQL workflow tests share a single database and exercise DDL on the
// `audit_logs` table (installing/dropping failure triggers). Run in parallel
// they deadlock — a trigger's AccessExclusiveLock races other tests' inserts.
// This process-global async mutex serializes them; each test holds the guard
// for its whole body via the value returned from `setup_pg_pool`.
#[cfg(all(feature = "postgres", not(feature = "sqlite")))]
fn pg_serial_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

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

        let result = bookings::void_booking(&pool, 1, 9970, Some("Guest voided".to_string()))
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
        assert_eq!(payment_status, "void");
        assert_eq!(ledger_count_after, ledger_count_before);
        assert_eq!(history.get::<String, _>("previous_status"), "confirmed");
        assert_eq!(history.get::<String, _>("new_status"), "voided");
        assert_eq!(history.get::<String, _>("change_reason"), "Guest voided");
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
    async fn void_booking_allows_checked_out_booking_for_abandoned_review() {
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
        sqlx::query("UPDATE bookings SET is_posted = 1, posted_date = '2030-08-20' WHERE id = ?1")
            .bind(9985_i64)
            .execute(&pool)
            .await
            .unwrap();

        let result = bookings::void_booking(&pool, 1, 9985, None).await;

        assert!(
            result.is_ok(),
            "expected checked-out void to succeed, got: {result:?}"
        );
        let payload = result.unwrap();
        assert_eq!(payload["night_audit_rerun_required"].as_bool(), Some(true));
        assert_eq!(
            payload["affected_night_audit_dates"][0].as_str(),
            Some("2030-08-20")
        );

        let status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = ?1")
            .bind(9985_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "voided");
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

    #[tokio::test]
    async fn void_booking_rolls_back_all_side_effects_when_late_audit_fails() {
        let pool = common::setup_test_db().await;
        seed_room_guest_booking(
            &pool,
            9996,
            9996,
            9996,
            "confirmed",
            "2030-11-10",
            "2030-11-12",
        )
        .await;
        sqlx::query("UPDATE rooms SET status = 'reserved' WHERE id = ?1")
            .bind(9996_i64)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE bookings SET is_complimentary = 1, payment_status = 'partial' WHERE id = ?1",
        )
        .bind(9996_i64)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO payments (payment_number, booking_id, guest_id, amount, payment_method, payment_type, status, processed_by) \
             VALUES ('PAY-9996-1', ?1, ?2, 100.00, 'cash', 'booking', 'completed', 1)",
        )
        .bind(9996_i64)
        .bind(9996_i64)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query("DROP TABLE audit_logs")
            .execute(&pool)
            .await
            .unwrap();

        let result =
            bookings::void_booking(&pool, 1, 9996, Some("force rollback".to_string())).await;

        assert!(
            matches!(result, Err(ApiError::Database(ref message)) if message.contains("audit_logs")),
            "expected late audit failure, got: {result:?}"
        );

        let booking = sqlx::query(
            "SELECT status, payment_status, cancelled_at, cancelled_by FROM bookings WHERE id = ?1",
        )
        .bind(9996_i64)
        .fetch_one(&pool)
        .await
        .unwrap();
        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = ?1")
            .bind(9996_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        let payment_status: String =
            sqlx::query_scalar("SELECT status FROM payments WHERE booking_id = ?1")
                .bind(9996_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let history_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_history WHERE booking_id = ?1")
                .bind(9996_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let modification_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_modifications WHERE booking_id = ?1")
                .bind(9996_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let credited_nights: Option<i64> = sqlx::query_scalar(
            "SELECT nights_available FROM guest_complimentary_credits WHERE guest_id = ?1 AND room_type_id = 1",
        )
        .bind(9996_i64)
        .fetch_optional(&pool)
        .await
        .unwrap();

        assert_eq!(booking.get::<String, _>("status"), "confirmed");
        assert_eq!(booking.get::<String, _>("payment_status"), "partial");
        assert!(booking.get::<Option<String>, _>("cancelled_at").is_none());
        assert!(booking.get::<Option<i64>, _>("cancelled_by").is_none());
        assert_eq!(room_status, "reserved");
        assert_eq!(payment_status, "completed");
        assert_eq!(history_count, 0);
        assert_eq!(modification_count, 0);
        assert_eq!(credited_nights, None);
    }

    // -----------------------------------------------------------------------
    // Manual check-in
    // -----------------------------------------------------------------------

    use hotel_app_be::models::CheckInRequest;

    /// Seed a confirmed/pending booking ready for check-in. Future dates keep
    /// the room-occupied path active and `created_by = 1` (the seeded admin).
    async fn seed_checkin_booking(pool: &sqlx::SqlitePool, id: i64, status: &str) {
        seed_room_guest_booking(pool, id, id, id, status, "2030-12-10", "2030-12-12").await;
    }

    #[tokio::test]
    async fn checkin_marks_booking_checked_in_sets_timestamp_and_occupies_room() {
        let pool = common::setup_test_db().await;
        seed_checkin_booking(&pool, 8010, "confirmed").await;

        let booking = bookings::manual_checkin(&pool, 1, 8010, None)
            .await
            .expect("confirmed booking should check in");
        assert_eq!(booking.status, "checked_in");

        let row = sqlx::query("SELECT status, actual_check_in FROM bookings WHERE id = ?1")
            .bind(8010_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.get::<String, _>("status"), "checked_in");
        assert!(
            row.get::<Option<String>, _>("actual_check_in").is_some(),
            "actual_check_in should be stamped"
        );

        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = ?1")
            .bind(8010_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(room_status, "occupied");

        let history = sqlx::query(
            "SELECT previous_status, new_status FROM booking_history WHERE booking_id = ?1",
        )
        .bind(8010_i64)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(history.get::<String, _>("previous_status"), "confirmed");
        assert_eq!(history.get::<String, _>("new_status"), "checked_in");

        let modification_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM booking_modifications WHERE booking_id = ?1 AND modification_type = 'check_in'",
        )
        .bind(8010_i64)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(modification_count, 1);
    }

    #[tokio::test]
    async fn checkin_returns_not_found_for_missing_booking() {
        let pool = common::setup_test_db().await;
        let result = bookings::manual_checkin(&pool, 1, 4040, None).await;
        assert!(
            matches!(result, Err(ApiError::NotFound(_))),
            "expected NotFound, got: {result:?}"
        );
    }

    #[tokio::test]
    async fn checkin_enforces_service_authorization_boundary() {
        let pool = common::setup_test_db().await;
        seed_checkin_booking(&pool, 8030, "confirmed").await;
        // An authenticated staff user with no booking role, who did not create
        // the booking (created_by = 1) → 403 Forbidden, not 401.
        sqlx::query(
            "INSERT INTO users (id, uuid, username, email, full_name, user_type, is_active, is_verified) \
             VALUES (8030, '80300000-0000-4000-8000-000000000000', 'no_role_8030', 'no-role-8030@hotel.local', 'No Role', 'staff', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = bookings::manual_checkin(&pool, 8030, 8030, None).await;
        assert!(
            matches!(result, Err(ApiError::Forbidden(ref m)) if m.contains("permission")),
            "expected Forbidden, got: {result:?}"
        );

        let status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = ?1")
            .bind(8030_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        let history_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_history WHERE booking_id = ?1")
                .bind(8030_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "confirmed");
        assert_eq!(history_count, 0);
    }

    #[tokio::test]
    async fn checkin_rejects_invalid_source_state() {
        let pool = common::setup_test_db().await;
        seed_checkin_booking(&pool, 8040, "checked_out").await;

        let result = bookings::manual_checkin(&pool, 1, 8040, None).await;
        assert!(
            matches!(result, Err(ApiError::BadRequest(ref m)) if m.contains("checked_out")),
            "expected invalid-state rejection, got: {result:?}"
        );

        let status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = ?1")
            .bind(8040_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "checked_out");
    }

    #[tokio::test]
    async fn repeated_checkin_is_rejected_without_duplicate_side_effects() {
        let pool = common::setup_test_db().await;
        seed_checkin_booking(&pool, 8050, "confirmed").await;

        bookings::manual_checkin(&pool, 1, 8050, None)
            .await
            .expect("first check-in succeeds");
        let result = bookings::manual_checkin(&pool, 1, 8050, None).await;
        assert!(
            matches!(result, Err(ApiError::BadRequest(ref m)) if m.contains("checked_in")),
            "expected repeated check-in rejection, got: {result:?}"
        );

        let history_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_history WHERE booking_id = ?1")
                .bind(8050_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let modification_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM booking_modifications WHERE booking_id = ?1 AND modification_type = 'check_in'",
        )
        .bind(8050_i64)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(history_count, 1);
        assert_eq!(modification_count, 1);
    }

    #[tokio::test]
    async fn checkin_rejects_room_under_maintenance() {
        let pool = common::setup_test_db().await;
        seed_checkin_booking(&pool, 8060, "confirmed").await;
        sqlx::query("UPDATE rooms SET status = 'maintenance' WHERE id = ?1")
            .bind(8060_i64)
            .execute(&pool)
            .await
            .unwrap();

        let result = bookings::manual_checkin(&pool, 1, 8060, None).await;
        assert!(
            matches!(result, Err(ApiError::BadRequest(ref m)) if m.contains("maintenance")),
            "expected maintenance rejection, got: {result:?}"
        );

        let status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = ?1")
            .bind(8060_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "confirmed");
    }

    #[tokio::test]
    async fn checkin_persists_guest_and_booking_field_edits() {
        let pool = common::setup_test_db().await;
        seed_checkin_booking(&pool, 8070, "confirmed").await;

        let checkin: CheckInRequest = serde_json::from_value(serde_json::json!({
            "guest_update": {"email": "arrival@example.com", "city": "Penang"},
            "booking_update": {"market_code": "WALKIN", "special_requests": "High floor"}
        }))
        .unwrap();
        bookings::manual_checkin(&pool, 1, 8070, Some(checkin))
            .await
            .expect("check-in with edits succeeds");

        let guest = sqlx::query("SELECT email, city FROM guests WHERE id = ?1")
            .bind(8070_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            guest.get::<Option<String>, _>("email"),
            Some("arrival@example.com".to_string())
        );
        assert_eq!(
            guest.get::<Option<String>, _>("city"),
            Some("Penang".to_string())
        );

        let booking =
            sqlx::query("SELECT market_code, special_requests, status FROM bookings WHERE id = ?1")
                .bind(8070_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            booking.get::<Option<String>, _>("market_code"),
            Some("WALKIN".to_string())
        );
        assert_eq!(
            booking.get::<Option<String>, _>("special_requests"),
            Some("High floor".to_string())
        );
    }

    #[tokio::test]
    async fn checkin_persists_company_billing_edits() {
        let pool = common::setup_test_db().await;
        seed_checkin_booking(&pool, 8071, "confirmed").await;

        let checkin: CheckInRequest = serde_json::from_value(serde_json::json!({
            "booking_update": {
                "company_id": 999,
                "company_name": "Test Company Bhd",
                "payment_method": "Direct Billing"
            }
        }))
        .unwrap();
        bookings::manual_checkin(&pool, 1, 8071, Some(checkin))
            .await
            .expect("check-in with company edits succeeds");

        let booking = sqlx::query("SELECT company_id, company_name, payment_method, status FROM bookings WHERE id = ?1")
            .bind(8071_i64)
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(booking.get::<Option<i64>, _>("company_id"), Some(999));
        assert_eq!(
            booking.get::<Option<String>, _>("company_name"),
            Some("Test Company Bhd".to_string())
        );
        assert_eq!(
            booking.get::<Option<String>, _>("payment_method"),
            Some("Direct Billing".to_string())
        );
        assert_eq!(booking.get::<String, _>("status"), "checked_in");
    }

    #[tokio::test]
    async fn checkin_records_payment_once_and_recomputes_status() {
        let pool = common::setup_test_db().await;
        seed_checkin_booking(&pool, 8080, "confirmed").await;

        let checkin: CheckInRequest = serde_json::from_value(serde_json::json!({
            "payment_record": {"amount": 150.0, "payment_method": "cash", "payment_type": "booking", "notes": "full"}
        }))
        .unwrap();
        bookings::manual_checkin(&pool, 1, 8080, Some(checkin))
            .await
            .expect("check-in with payment succeeds");

        let payment_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE booking_id = ?1")
                .bind(8080_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(payment_count, 1, "exactly one payment should be recorded");

        let amount: f64 = sqlx::query_scalar("SELECT amount FROM payments WHERE booking_id = ?1")
            .bind(8080_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(amount, 150.0);

        // Seeded total is 150.0; a 150.0 payment recomputed in the same tx → paid.
        let payment_status: String =
            sqlx::query_scalar("SELECT payment_status FROM bookings WHERE id = ?1")
                .bind(8080_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(payment_status, "paid");
    }

    #[tokio::test]
    async fn checkin_does_not_duplicate_existing_financial_records() {
        let pool = common::setup_test_db().await;
        seed_checkin_booking(&pool, 8090, "confirmed").await;
        sqlx::query(
            "INSERT INTO payments (payment_number, booking_id, guest_id, amount, payment_method, payment_type, status, processed_by) \
             VALUES ('PAY-8090-1', ?1, ?1, 100.00, 'cash', 'booking', 'completed', 1)",
        )
        .bind(8090_i64)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO customer_ledgers (ledger_number, guest_id, booking_id, transaction_type, transaction_date, description, debit_amount, balance, created_by) \
             VALUES ('LED-8090-1', ?1, ?1, 'room_charge', '2030-12-10', 'Existing', 300.00, 300.00, 1)",
        )
        .bind(8090_i64)
        .execute(&pool)
        .await
        .unwrap();

        // Check-in without a payment_record must not touch existing financials.
        bookings::manual_checkin(&pool, 1, 8090, None)
            .await
            .expect("check-in succeeds");

        let payment_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE booking_id = ?1")
                .bind(8090_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let ledger_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM customer_ledgers WHERE booking_id = ?1")
                .bind(8090_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(payment_count, 1);
        assert_eq!(ledger_count, 1);
    }

    #[tokio::test]
    async fn checkin_rolls_back_all_side_effects_when_late_audit_fails() {
        let pool = common::setup_test_db().await;
        seed_checkin_booking(&pool, 8100, "confirmed").await;
        sqlx::query("UPDATE rooms SET status = 'reserved' WHERE id = ?1")
            .bind(8100_i64)
            .execute(&pool)
            .await
            .unwrap();

        // Force the in-transaction audit write (which runs after the booking
        // transition, payment, and guest edit) to fail.
        sqlx::query("DROP TABLE audit_logs")
            .execute(&pool)
            .await
            .unwrap();

        let checkin: CheckInRequest = serde_json::from_value(serde_json::json!({
            "guest_update": {"city": "ShouldRollBack"},
            "payment_record": {"amount": 75.0, "payment_method": "cash", "payment_type": "booking"}
        }))
        .unwrap();
        let result = bookings::manual_checkin(&pool, 1, 8100, Some(checkin)).await;
        assert!(
            matches!(result, Err(ApiError::Database(ref m)) if m.contains("audit_logs")),
            "expected late audit failure, got: {result:?}"
        );

        let status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = ?1")
            .bind(8100_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        let actual_check_in: Option<String> =
            sqlx::query_scalar("SELECT actual_check_in FROM bookings WHERE id = ?1")
                .bind(8100_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = ?1")
            .bind(8100_i64)
            .fetch_one(&pool)
            .await
            .unwrap();
        let payment_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE booking_id = ?1")
                .bind(8100_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let history_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_history WHERE booking_id = ?1")
                .bind(8100_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let modification_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_modifications WHERE booking_id = ?1")
                .bind(8100_i64)
                .fetch_one(&pool)
                .await
                .unwrap();
        let city: Option<String> = sqlx::query_scalar("SELECT city FROM guests WHERE id = ?1")
            .bind(8100_i64)
            .fetch_one(&pool)
            .await
            .unwrap();

        // Every preceding write — status, timestamp, room, payment, history,
        // modification, and the guest edit — must roll back as one unit.
        assert_eq!(status, "confirmed");
        assert!(
            actual_check_in.is_none(),
            "actual_check_in must not be stamped after rollback"
        );
        assert_eq!(room_status, "reserved");
        assert_eq!(payment_count, 0, "the check-in payment must roll back");
        assert_eq!(history_count, 0);
        assert_eq!(modification_count, 0);
        assert!(city.is_none(), "the guest edit must roll back");
    }
}

#[cfg(all(feature = "postgres", not(feature = "sqlite")))]
mod postgres_tests {
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::services::bookings;
    use rust_decimal::Decimal;
    use sqlx::{PgPool, Row, postgres::PgPoolOptions};

    async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping PostgreSQL workflow test because DATABASE_URL is not set");
                return None;
            }
        };

        // Serialize against the other PostgreSQL workflow tests (shared DB + DDL).
        let guard = super::pg_serial_lock().lock_owned().await;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database");
        Some((pool, guard))
    }

    async fn ensure_admin_actor(pool: &PgPool, actor_id: i64) {
        sqlx::query(
            "INSERT INTO roles (name, display_name, description, is_system_role, priority) \
             VALUES ('admin', 'Administrator', 'Test admin role', true, 100) \
             ON CONFLICT (name) DO NOTHING",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO permissions (name, resource, action, description, is_system_permission) VALUES \
             ('bookings:update', 'bookings', 'update', 'Update bookings', true), \
             ('bookings:delete', 'bookings', 'delete', 'Delete bookings', true), \
             ('bookings:manage', 'bookings', 'manage', 'Manage bookings', true) \
             ON CONFLICT (name) DO NOTHING",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id) \
             SELECT r.id, p.id FROM roles r CROSS JOIN permissions p \
             WHERE r.name = 'admin' AND p.name IN ('bookings:update', 'bookings:delete', 'bookings:manage') \
             ON CONFLICT DO NOTHING",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) \
             VALUES ($1, $2, $3, $4, 'staff', true, true) \
             ON CONFLICT (id) DO UPDATE SET \
                 username = EXCLUDED.username, \
                 email = EXCLUDED.email, \
                 full_name = EXCLUDED.full_name, \
                 is_active = true, \
                 is_verified = true",
        )
        .bind(actor_id)
        .bind(format!("pg_void_actor_{actor_id}"))
        .bind(format!("pg-void-actor-{actor_id}@hotel.local"))
        .bind(format!("PG Void Actor {actor_id}"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) \
             SELECT $1, id FROM roles WHERE name = 'admin' \
             ON CONFLICT DO NOTHING",
        )
        .bind(actor_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn cleanup_pg_fixture(
        pool: &PgPool,
        actor_id: i64,
        room_type_id: i64,
        room_ids: &[i64],
        guest_ids: &[i64],
        booking_ids: &[i64],
    ) {
        for booking_id in booking_ids {
            sqlx::query("DELETE FROM payments WHERE booking_id = $1")
                .bind(booking_id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM booking_history WHERE booking_id = $1")
                .bind(booking_id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM booking_modifications WHERE booking_id = $1")
                .bind(booking_id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query(
                "DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1",
            )
            .bind(booking_id)
            .execute(pool)
            .await
            .unwrap();
            sqlx::query("DELETE FROM bookings WHERE id = $1")
                .bind(booking_id)
                .execute(pool)
                .await
                .unwrap();
        }

        for guest_id in guest_ids {
            sqlx::query("DELETE FROM guest_complimentary_credits WHERE guest_id = $1")
                .bind(guest_id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM user_guests WHERE guest_id = $1")
                .bind(guest_id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM guests WHERE id = $1")
                .bind(guest_id)
                .execute(pool)
                .await
                .unwrap();
        }

        for room_id in room_ids {
            sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
                .bind(room_id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM rooms WHERE id = $1")
                .bind(room_id)
                .execute(pool)
                .await
                .unwrap();
        }

        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(room_type_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
            .bind(actor_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(actor_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn seed_pg_booking(
        pool: &PgPool,
        actor_id: i64,
        booking_id: i64,
        guest_id: i64,
        room_id: i64,
        room_type_id: i64,
        status: &str,
        is_complimentary: bool,
    ) {
        ensure_admin_actor(pool, actor_id).await;
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
             VALUES ($1, $2, $3, 150.00, 2) \
             ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, base_price = EXCLUDED.base_price",
        )
        .bind(room_type_id)
        .bind(format!("PGRT{room_type_id}"))
        .bind(format!("PG Test Room Type {room_type_id}"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             VALUES ($1, $2, $3, 'reserved') \
             ON CONFLICT (id) DO UPDATE SET room_number = EXCLUDED.room_number, room_type_id = EXCLUDED.room_type_id, status = EXCLUDED.status",
        )
        .bind(room_id)
        .bind(format!("PG{room_id}"))
        .bind(room_type_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO guests (id, full_name, first_name, last_name, email) \
             VALUES ($1, $2, 'Postgres', $3, $4) \
             ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email",
        )
        .bind(guest_id)
        .bind(format!("Postgres Guest {guest_id}"))
        .bind(format!("Guest{guest_id}"))
        .bind(format!("pg-guest-{guest_id}@hotel.local"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO bookings (
                id, booking_number, guest_id, guest_name, guest_email, room_id,
                check_in_date, check_out_date, adults, children,
                room_rate, subtotal, total_amount, status, payment_status,
                is_complimentary, created_by
             )
             VALUES ($1, $2, $3, $4, $5, $6, '2031-01-10', '2031-01-12', 1, 0,
                     150.00, 300.00, 300.00, $7, 'partial', $8, $9)",
        )
        .bind(booking_id)
        .bind(format!("BK-PG-{booking_id}"))
        .bind(guest_id)
        .bind(format!("Postgres Guest {guest_id}"))
        .bind(format!("pg-guest-{guest_id}@hotel.local"))
        .bind(room_id)
        .bind(status)
        .bind(is_complimentary)
        .bind(actor_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_pg_completed_payment(pool: &PgPool, booking_id: i64, actor_id: i64) {
        sqlx::query(
            "INSERT INTO payments (booking_id, amount, payment_method, payment_type, status, created_by, processed_by) \
             VALUES ($1, $2, 'cash', 'booking', 'completed', $3, $3)",
        )
        .bind(booking_id)
        .bind(Decimal::new(10_000, 2))
        .bind(actor_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn count_pg_rows(pool: &PgPool, table: &str, booking_id: i64) -> i64 {
        let query = format!("SELECT COUNT(*) FROM {table} WHERE booking_id = $1");
        sqlx::query_scalar::<_, i64>(&query)
            .bind(booking_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn postgres_void_booking_updates_workflow_side_effects() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 930_001;
        let booking_id = 930_101;
        let guest_id = 930_201;
        let room_id = 930_301;
        let room_type_id = 930_401;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            actor_id,
            booking_id,
            guest_id,
            room_id,
            room_type_id,
            "confirmed",
            false,
        )
        .await;
        insert_pg_completed_payment(&pool, booking_id, actor_id).await;

        let result =
            bookings::void_booking(&pool, actor_id, booking_id, Some("PG void".to_string()))
                .await
                .expect("postgres booking should void");

        let booking = sqlx::query("SELECT status, payment_status FROM bookings WHERE id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let payment_status: String =
            sqlx::query_scalar("SELECT status FROM payments WHERE booking_id = $1")
                .bind(booking_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1 AND action = 'booking_voided'",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(result["booking_id"].as_i64(), Some(booking_id));
        assert_eq!(booking.get::<String, _>("status"), "voided");
        assert_eq!(booking.get::<String, _>("payment_status"), "void");
        assert_eq!(room_status, "available");
        assert_eq!(payment_status, "void");
        assert_eq!(count_pg_rows(&pool, "booking_history", booking_id).await, 1);
        assert_eq!(
            count_pg_rows(&pool, "booking_modifications", booking_id).await,
            1
        );
        assert_eq!(audit_count, 1);

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }

    #[tokio::test]
    async fn postgres_concurrent_void_allows_only_one_success() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 930_002;
        let booking_id = 930_102;
        let guest_id = 930_202;
        let room_id = 930_302;
        let room_type_id = 930_402;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            actor_id,
            booking_id,
            guest_id,
            room_id,
            room_type_id,
            "confirmed",
            false,
        )
        .await;

        let pool_a = pool.clone();
        let pool_b = pool.clone();
        let (first, second) = tokio::join!(
            bookings::void_booking(&pool_a, actor_id, booking_id, None),
            bookings::void_booking(&pool_b, actor_id, booking_id, None)
        );

        let success_count = usize::from(first.is_ok()) + usize::from(second.is_ok());
        assert_eq!(
            success_count, 1,
            "exactly one concurrent void should succeed: first={first:?}, second={second:?}"
        );
        let failed = if first.is_ok() { second } else { first };
        assert!(
            matches!(failed, Err(ApiError::BadRequest(_))),
            "second void should return a controlled state error"
        );
        assert_eq!(count_pg_rows(&pool, "booking_history", booking_id).await, 1);
        assert_eq!(
            count_pg_rows(&pool, "booking_modifications", booking_id).await,
            1
        );

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }

    #[tokio::test]
    async fn postgres_reactivation_rejects_room_date_conflict() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 930_003;
        let voided_booking_id = 930_103;
        let conflicting_booking_id = 930_104;
        let voided_guest_id = 930_203;
        let conflicting_guest_id = 930_204;
        let room_id = 930_303;
        let room_type_id = 930_403;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[voided_guest_id, conflicting_guest_id],
            &[voided_booking_id, conflicting_booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            actor_id,
            voided_booking_id,
            voided_guest_id,
            room_id,
            room_type_id,
            "voided",
            false,
        )
        .await;
        sqlx::query(
            "INSERT INTO guests (id, full_name, first_name, last_name, email) \
             VALUES ($1, $2, 'Conflict', $3, $4)",
        )
        .bind(conflicting_guest_id)
        .bind(format!("Conflict Guest {conflicting_guest_id}"))
        .bind(format!("Guest{conflicting_guest_id}"))
        .bind(format!("pg-conflict-{conflicting_guest_id}@hotel.local"))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO bookings (
                id, booking_number, guest_id, guest_name, guest_email, room_id,
                check_in_date, check_out_date, adults, children,
                room_rate, subtotal, total_amount, status, payment_status, created_by
             )
             VALUES ($1, $2, $3, $4, $5, $6, '2031-01-11', '2031-01-13', 1, 0,
                     150.00, 300.00, 300.00, 'confirmed', 'partial', $7)",
        )
        .bind(conflicting_booking_id)
        .bind(format!("BK-PG-{conflicting_booking_id}"))
        .bind(conflicting_guest_id)
        .bind(format!("Conflict Guest {conflicting_guest_id}"))
        .bind(format!("pg-conflict-{conflicting_guest_id}@hotel.local"))
        .bind(room_id)
        .bind(actor_id)
        .execute(&pool)
        .await
        .unwrap();

        let result = bookings::reactivate_booking(&pool, actor_id, voided_booking_id).await;

        assert!(
            matches!(result, Err(ApiError::BadRequest(ref message)) if message.contains("already booked")),
            "expected conflict rejection, got: {result:?}"
        );
        let status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = $1")
            .bind(voided_booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "voided");

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[voided_guest_id, conflicting_guest_id],
            &[voided_booking_id, conflicting_booking_id],
        )
        .await;
    }

    #[tokio::test]
    async fn postgres_void_restores_complimentary_credits() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 930_004;
        let booking_id = 930_105;
        let guest_id = 930_205;
        let room_id = 930_305;
        let room_type_id = 930_405;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            actor_id,
            booking_id,
            guest_id,
            room_id,
            room_type_id,
            "confirmed",
            true,
        )
        .await;

        let result = bookings::void_booking(&pool, actor_id, booking_id, None)
            .await
            .expect("complimentary postgres booking should void");

        let credits: i32 = sqlx::query_scalar(
            "SELECT nights_available FROM guest_complimentary_credits WHERE guest_id = $1 AND room_type_id = $2",
        )
        .bind(guest_id)
        .bind(room_type_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(result["complimentary_nights_credited"].as_i64(), Some(2));
        assert_eq!(credits, 2);

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }

    async fn install_audit_failure_trigger(pool: &PgPool, booking_id: i64) {
        let function_name = format!("fail_void_audit_{booking_id}");
        let trigger_name = format!("trg_fail_void_audit_{booking_id}");
        sqlx::query(&format!(
            "DROP TRIGGER IF EXISTS {trigger_name} ON audit_logs"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(&format!("DROP FUNCTION IF EXISTS {function_name}()"))
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(&format!(
            r#"
            CREATE FUNCTION {function_name}() RETURNS trigger AS $$
            BEGIN
                IF NEW.action = 'booking_voided'
                   AND NEW.resource_type = 'booking'
                   AND NEW.resource_id = {booking_id} THEN
                    RAISE EXCEPTION 'forced audit failure for booking {booking_id}';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
            "#
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(&format!(
            "CREATE TRIGGER {trigger_name} BEFORE INSERT ON audit_logs \
             FOR EACH ROW EXECUTE FUNCTION {function_name}()"
        ))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn drop_audit_failure_trigger(pool: &PgPool, booking_id: i64) {
        let function_name = format!("fail_void_audit_{booking_id}");
        let trigger_name = format!("trg_fail_void_audit_{booking_id}");
        sqlx::query(&format!(
            "DROP TRIGGER IF EXISTS {trigger_name} ON audit_logs"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(&format!("DROP FUNCTION IF EXISTS {function_name}()"))
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn postgres_void_rolls_back_when_late_audit_insert_fails() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 930_005;
        let booking_id = 930_106;
        let guest_id = 930_206;
        let room_id = 930_306;
        let room_type_id = 930_406;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            actor_id,
            booking_id,
            guest_id,
            room_id,
            room_type_id,
            "confirmed",
            true,
        )
        .await;
        insert_pg_completed_payment(&pool, booking_id, actor_id).await;
        install_audit_failure_trigger(&pool, booking_id).await;

        let result = bookings::void_booking(&pool, actor_id, booking_id, None).await;
        drop_audit_failure_trigger(&pool, booking_id).await;

        assert!(
            matches!(result, Err(ApiError::Database(_))),
            "expected forced audit failure, got: {result:?}"
        );

        let booking = sqlx::query(
            "SELECT status, payment_status, cancelled_at IS NULL AS no_cancelled_at, cancelled_by IS NULL AS no_cancelled_by \
             FROM bookings WHERE id = $1",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let payment_status: String =
            sqlx::query_scalar("SELECT status FROM payments WHERE booking_id = $1")
                .bind(booking_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let credits_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM guest_complimentary_credits WHERE guest_id = $1 AND room_type_id = $2",
        )
        .bind(guest_id)
        .bind(room_type_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(booking.get::<String, _>("status"), "confirmed");
        assert_eq!(booking.get::<String, _>("payment_status"), "partial");
        assert!(booking.get::<bool, _>("no_cancelled_at"));
        assert!(booking.get::<bool, _>("no_cancelled_by"));
        assert_eq!(room_status, "reserved");
        assert_eq!(payment_status, "completed");
        assert_eq!(count_pg_rows(&pool, "booking_history", booking_id).await, 0);
        assert_eq!(
            count_pg_rows(&pool, "booking_modifications", booking_id).await,
            0
        );
        assert_eq!(credits_count, 0);

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }

    // -----------------------------------------------------------------------
    // Manual check-in (PostgreSQL)
    // -----------------------------------------------------------------------

    async fn install_checkin_audit_failure_trigger(pool: &PgPool, booking_id: i64) {
        let function_name = format!("fail_checkin_audit_{booking_id}");
        let trigger_name = format!("trg_fail_checkin_audit_{booking_id}");
        sqlx::query(&format!(
            "DROP TRIGGER IF EXISTS {trigger_name} ON audit_logs"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(&format!("DROP FUNCTION IF EXISTS {function_name}()"))
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(&format!(
            r#"
            CREATE FUNCTION {function_name}() RETURNS trigger AS $$
            BEGIN
                IF NEW.action = 'booking_checkin'
                   AND NEW.resource_type = 'booking'
                   AND NEW.resource_id = {booking_id} THEN
                    RAISE EXCEPTION 'forced audit failure for booking {booking_id}';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
            "#
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(&format!(
            "CREATE TRIGGER {trigger_name} BEFORE INSERT ON audit_logs \
             FOR EACH ROW EXECUTE FUNCTION {function_name}()"
        ))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn drop_checkin_audit_failure_trigger(pool: &PgPool, booking_id: i64) {
        let function_name = format!("fail_checkin_audit_{booking_id}");
        let trigger_name = format!("trg_fail_checkin_audit_{booking_id}");
        sqlx::query(&format!(
            "DROP TRIGGER IF EXISTS {trigger_name} ON audit_logs"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(&format!("DROP FUNCTION IF EXISTS {function_name}()"))
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn postgres_checkin_updates_workflow_side_effects() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_001;
        let booking_id = 940_101;
        let guest_id = 940_201;
        let room_id = 940_301;
        let room_type_id = 940_401;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            actor_id,
            booking_id,
            guest_id,
            room_id,
            room_type_id,
            "confirmed",
            false,
        )
        .await;

        let checkin: hotel_app_be::models::CheckInRequest =
            serde_json::from_value(serde_json::json!({
                "payment_record": {"amount": 150.0, "payment_method": "cash", "payment_type": "booking", "notes": "pg full"}
            }))
            .unwrap();
        let booking = bookings::manual_checkin(&pool, actor_id, booking_id, Some(checkin))
            .await
            .expect("postgres booking should check in");
        assert_eq!(booking.status, "checked_in");

        let row = sqlx::query(
            "SELECT status, actual_check_in IS NOT NULL AS has_actual FROM bookings WHERE id = $1",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1 AND action = 'booking_checkin'",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(row.get::<String, _>("status"), "checked_in");
        assert!(row.get::<bool, _>("has_actual"));
        assert_eq!(room_status, "occupied");
        assert_eq!(count_pg_rows(&pool, "payments", booking_id).await, 1);
        assert_eq!(count_pg_rows(&pool, "booking_history", booking_id).await, 1);
        assert_eq!(
            count_pg_rows(&pool, "booking_modifications", booking_id).await,
            1
        );
        assert_eq!(audit_count, 1);

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }

    #[tokio::test]
    async fn postgres_concurrent_checkin_allows_only_one_success() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_002;
        let booking_id = 940_102;
        let guest_id = 940_202;
        let room_id = 940_302;
        let room_type_id = 940_402;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            actor_id,
            booking_id,
            guest_id,
            room_id,
            room_type_id,
            "confirmed",
            false,
        )
        .await;

        let pool_a = pool.clone();
        let pool_b = pool.clone();
        let (first, second) = tokio::join!(
            bookings::manual_checkin(&pool_a, actor_id, booking_id, None),
            bookings::manual_checkin(&pool_b, actor_id, booking_id, None)
        );

        let success_count = usize::from(first.is_ok()) + usize::from(second.is_ok());
        assert_eq!(
            success_count, 1,
            "exactly one concurrent check-in should succeed: first={first:?}, second={second:?}"
        );
        let failed = if first.is_ok() { second } else { first };
        assert!(
            matches!(failed, Err(ApiError::BadRequest(_))),
            "the losing check-in should return a controlled state error, got: {failed:?}"
        );
        assert_eq!(count_pg_rows(&pool, "booking_history", booking_id).await, 1);
        assert_eq!(
            count_pg_rows(&pool, "booking_modifications", booking_id).await,
            1
        );

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }

    #[tokio::test]
    async fn postgres_checkin_rolls_back_when_late_audit_insert_fails() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_003;
        let booking_id = 940_103;
        let guest_id = 940_203;
        let room_id = 940_303;
        let room_type_id = 940_403;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            actor_id,
            booking_id,
            guest_id,
            room_id,
            room_type_id,
            "confirmed",
            false,
        )
        .await;
        install_checkin_audit_failure_trigger(&pool, booking_id).await;

        let checkin: hotel_app_be::models::CheckInRequest =
            serde_json::from_value(serde_json::json!({
                "payment_record": {"amount": 75.0, "payment_method": "cash", "payment_type": "booking"}
            }))
            .unwrap();
        let result = bookings::manual_checkin(&pool, actor_id, booking_id, Some(checkin)).await;
        drop_checkin_audit_failure_trigger(&pool, booking_id).await;

        assert!(
            matches!(result, Err(ApiError::Database(_))),
            "expected forced audit failure, got: {result:?}"
        );

        let row = sqlx::query(
            "SELECT status, actual_check_in IS NULL AS no_actual FROM bookings WHERE id = $1",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();

        // The whole check-in unwinds: status, timestamp, room, payment, and the
        // history/modification writes all roll back together.
        assert_eq!(row.get::<String, _>("status"), "confirmed");
        assert!(row.get::<bool, _>("no_actual"));
        assert_eq!(room_status, "reserved");
        assert_eq!(count_pg_rows(&pool, "payments", booking_id).await, 0);
        assert_eq!(count_pg_rows(&pool, "booking_history", booking_id).await, 0);
        assert_eq!(
            count_pg_rows(&pool, "booking_modifications", booking_id).await,
            0
        );

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }
}

#[cfg(all(feature = "postgres", not(feature = "sqlite")))]
mod postgres_reactivation_tests {
    use axum::extract::{Extension, Path, State};
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::services::bookings;
    use sqlx::postgres::PgPoolOptions;
    use sqlx::{PgPool, Row};

    async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("skipping PostgreSQL booking workflow test; DATABASE_URL is not set");
                return None;
            }
        };

        // Serialize against the other PostgreSQL workflow tests (shared DB + DDL).
        let guard = super::pg_serial_lock().lock_owned().await;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("connect to PostgreSQL test database");
        Some((pool, guard))
    }

    async fn cleanup_pg_fixture(
        pool: &PgPool,
        actor_id: i64,
        role_name: &str,
        room_type_id: i64,
        room_id: i64,
        guest_id: i64,
        booking_id: i64,
    ) {
        sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM booking_modifications WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM booking_history WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM bookings WHERE id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(room_type_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query(
            "DELETE FROM user_roles WHERE user_id = $1 OR role_id IN (SELECT id FROM roles WHERE name = $2)",
        )
        .bind(actor_id)
        .bind(role_name)
        .execute(pool)
        .await
        .ok();
        sqlx::query(
            "DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name = $1)",
        )
        .bind(role_name)
        .execute(pool)
        .await
        .ok();
        sqlx::query("DELETE FROM roles WHERE name = $1")
            .bind(role_name)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(actor_id)
            .execute(pool)
            .await
            .ok();
    }

    async fn seed_pg_reactivation_fixture(
        pool: &PgPool,
        actor_id: i64,
        role_name: &str,
        room_type_id: i64,
        room_id: i64,
        guest_id: i64,
        booking_id: i64,
    ) {
        sqlx::query(
            "INSERT INTO users (id, username, email, full_name, is_active, is_verified) \
             VALUES ($1, $2, $3, 'Reactivation Actor', true, true)",
        )
        .bind(actor_id)
        .bind(format!("reactivation_actor_{actor_id}"))
        .bind(format!("reactivation_actor_{actor_id}@example.com"))
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO permissions (name, resource, action, description, is_system_permission) \
             VALUES ('bookings:update', 'bookings', 'update', 'Update bookings', true) \
             ON CONFLICT (name) DO NOTHING",
        )
        .execute(pool)
        .await
        .unwrap();

        let role_id: i64 = sqlx::query_scalar(
            "INSERT INTO roles (name, display_name, is_system_role) \
             VALUES ($1, 'Reactivation Test Role', false) \
             RETURNING id",
        )
        .bind(role_name)
        .fetch_one(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id) \
             SELECT $1, id FROM permissions WHERE name = 'bookings:update'",
        )
        .bind(role_id)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)")
            .bind(actor_id)
            .bind(role_id)
            .execute(pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO guests (id, full_name) VALUES ($1, 'Reactivation Guest')")
            .bind(guest_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price) VALUES ($1, $2, $3, 100.00)",
        )
        .bind(room_type_id)
        .bind(format!("RCT{room_type_id}"))
        .bind(format!("Reactivation Room Type {room_type_id}"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO rooms (id, room_number, room_type_id, status) VALUES ($1, $2, $3, 'available')")
            .bind(room_id)
            .bind(format!("RCT-{room_id}"))
            .bind(room_type_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO bookings (
                id, booking_number, guest_id, room_id, check_in_date, check_out_date,
                room_rate, subtotal, total_amount, status, payment_status
             )
             VALUES ($1, $2, $3, $4, CURRENT_DATE + 30, CURRENT_DATE + 32, 100.00, 200.00, 200.00, 'voided', 'void')",
        )
        .bind(booking_id)
        .bind(format!("BK-RCT-{booking_id}"))
        .bind(guest_id)
        .bind(room_id)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn postgres_concurrent_reactivation_allows_only_one_success() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_001;
        let role_name = "reactivation_test_role_940001";
        let room_type_id = 940_101;
        let room_id = 940_201;
        let guest_id = 940_301;
        let booking_id = 940_401;

        cleanup_pg_fixture(
            &pool,
            actor_id,
            role_name,
            room_type_id,
            room_id,
            guest_id,
            booking_id,
        )
        .await;
        seed_pg_reactivation_fixture(
            &pool,
            actor_id,
            role_name,
            room_type_id,
            room_id,
            guest_id,
            booking_id,
        )
        .await;

        let first = bookings::reactivate_booking_handler(
            State(pool.clone()),
            Extension(actor_id),
            Path(booking_id),
        );
        let second = bookings::reactivate_booking_handler(
            State(pool.clone()),
            Extension(actor_id),
            Path(booking_id),
        );
        let (first_result, second_result) = tokio::join!(first, second);

        let successes = [first_result.as_ref(), second_result.as_ref()]
            .iter()
            .filter(|result| result.is_ok())
            .count();
        assert_eq!(
            successes, 1,
            "exactly one concurrent reactivation should succeed"
        );

        let failures = [first_result, second_result]
            .into_iter()
            .filter_map(Result::err)
            .collect::<Vec<_>>();
        assert_eq!(failures.len(), 1);
        assert!(
            matches!(failures[0], ApiError::BadRequest(_)),
            "repeated reactivation should return a controlled bad request: {:?}",
            failures[0]
        );

        let booking = sqlx::query("SELECT status FROM bookings WHERE id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(booking.get::<String, _>("status"), "confirmed");

        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(room_status, "reserved");

        let history_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_history WHERE booking_id = $1")
                .bind(booking_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let modification_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_modifications WHERE booking_id = $1")
                .bind(booking_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1 AND action = 'booking_reactivated'",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(history_count, 1);
        assert_eq!(modification_count, 1);
        assert_eq!(audit_count, 1);

        cleanup_pg_fixture(
            &pool,
            actor_id,
            role_name,
            room_type_id,
            room_id,
            guest_id,
            booking_id,
        )
        .await;
    }
}

#[cfg(all(feature = "postgres", not(feature = "sqlite")))]
mod postgres_creation_tests {
    use axum::extract::{Extension, State};
    use axum::Json;
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::BookingInput;
    use hotel_app_be::repositories::bookings::create_booking_handler;
    use sqlx::postgres::PgPoolOptions;
    use sqlx::PgPool;

    async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => return None,
        };
        if database_url.is_empty() {
            return None;
        }
        let guard = super::pg_serial_lock().lock_owned().await;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database");
        Some((pool, guard))
    }

    async fn cleanup(pool: &PgPool, room_id: i64, guest_id: i64, actor_id: i64) {
        sqlx::query("DELETE FROM booking_modifications WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)").bind(room_id).execute(pool).await.unwrap();
        sqlx::query("DELETE FROM booking_history WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)").bind(room_id).execute(pool).await.unwrap();
        sqlx::query("DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)").bind(room_id).execute(pool).await.unwrap();
        sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id IN (SELECT id FROM bookings WHERE room_id = $1)").bind(room_id).execute(pool).await.unwrap();
        sqlx::query("DELETE FROM bookings WHERE room_id = $1").bind(room_id).execute(pool).await.unwrap();
        sqlx::query("DELETE FROM guests WHERE id = $1").bind(guest_id).execute(pool).await.unwrap();
        sqlx::query("DELETE FROM rooms WHERE id = $1").bind(room_id).execute(pool).await.unwrap();
        sqlx::query("DELETE FROM user_roles WHERE user_id = $1").bind(actor_id).execute(pool).await.unwrap();
        sqlx::query("DELETE FROM users WHERE id = $1").bind(actor_id).execute(pool).await.unwrap();
    }

    async fn seed_data(pool: &PgPool, room_id: i64, guest_id: i64, actor_id: i64) {
        sqlx::query("INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) VALUES ($1, $2, $3, $4, 'staff', true, true) ON CONFLICT DO NOTHING")
            .bind(actor_id).bind(format!("pg_creation_actor_{actor_id}")).bind(format!("pg-create-{actor_id}@hotel.local")).bind(format!("Actor {actor_id}")).execute(pool).await.unwrap();
        
        sqlx::query("INSERT INTO guests (id, first_name, last_name) VALUES ($1, 'Create', 'Guest') ON CONFLICT DO NOTHING")
            .bind(guest_id).execute(pool).await.unwrap();

        sqlx::query("INSERT OR IGNORE INTO room_types (id, name, code, base_price) VALUES (1, 'Base', 'BASE', 100.0) ON CONFLICT DO NOTHING")
            .execute(pool).await.unwrap();

        sqlx::query("INSERT INTO rooms (id, room_number, room_type_id, status, is_active) VALUES ($1, $2, 1, 'available', true) ON CONFLICT DO NOTHING")
            .bind(room_id).bind(format!("R{room_id}")).execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn postgres_concurrent_creation_allows_only_one_success() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else { return; };
        let actor_id = 960_001;
        let guest_id = 960_201;
        let room_id = 960_301;
        
        cleanup(&pool, room_id, guest_id, actor_id).await;
        seed_data(&pool, room_id, guest_id, actor_id).await;

        let input = BookingInput {
            guest_id, room_id,
            check_in_date: "2027-03-01".to_string(), check_out_date: "2027-03-05".to_string(),
            post_type: None, rate_code: None, booking_remarks: None, is_tourist: None, tourism_tax_amount: None,
            extra_bed_count: None, extra_bed_charge: None, late_checkout_penalty: None, payment_method: None, payment_status: None,
            amount_paid: None, source: None, booking_number: None, deposit_paid: None, deposit_amount: None,
            room_rate_override: None, special_requests: None, daily_rates: None, cleaning_preference: None, company_id: None, company_name: None,
        };

        let pool_a = pool.clone();
        let pool_b = pool.clone();
        let input_a = Json(serde_json::from_str::<BookingInput>(&serde_json::to_string(&input).unwrap()).unwrap());
        let input_b = Json(serde_json::from_str::<BookingInput>(&serde_json::to_string(&input).unwrap()).unwrap());

        let (first, second) = tokio::join!(
            create_booking_handler(State(pool_a), Extension(actor_id), input_a),
            create_booking_handler(State(pool_b), Extension(actor_id), input_b)
        );

        let success_count = usize::from(first.is_ok()) + usize::from(second.is_ok());
        assert_eq!(success_count, 1, "exactly one concurrent creation should succeed: first={first:?}, second={second:?}");

        cleanup(&pool, room_id, guest_id, actor_id).await;
    }

    #[tokio::test]
    async fn postgres_creation_is_idempotent_with_booking_number() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else { return; };
        let actor_id = 960_002;
        let guest_id = 960_202;
        let room_id = 960_302;
        
        cleanup(&pool, room_id, guest_id, actor_id).await;
        seed_data(&pool, room_id, guest_id, actor_id).await;

        let booking_number = "BK-IDEMPOTENT-TEST-960".to_string();
        sqlx::query("DELETE FROM bookings WHERE booking_number = $1").bind(&booking_number).execute(&pool).await.unwrap();

        let input = BookingInput {
            guest_id, room_id,
            check_in_date: "2027-04-01".to_string(), check_out_date: "2027-04-05".to_string(),
            post_type: None, rate_code: None, booking_remarks: None, is_tourist: None, tourism_tax_amount: None,
            extra_bed_count: None, extra_bed_charge: None, late_checkout_penalty: None, payment_method: None, payment_status: None,
            amount_paid: None, source: None, booking_number: Some(booking_number.clone()), deposit_paid: None, deposit_amount: None,
            room_rate_override: None, special_requests: None, daily_rates: None, cleaning_preference: None, company_id: None, company_name: None,
        };

        let input_a = Json(serde_json::from_str::<BookingInput>(&serde_json::to_string(&input).unwrap()).unwrap());
        let input_b = Json(serde_json::from_str::<BookingInput>(&serde_json::to_string(&input).unwrap()).unwrap());

        let first = create_booking_handler(State(pool.clone()), Extension(actor_id), input_a).await;
        assert!(first.is_ok(), "first creation should succeed");

        let second = create_booking_handler(State(pool.clone()), Extension(actor_id), input_b).await;
        assert!(matches!(second, Err(ApiError::Database(_))), "second creation with same booking number should fail uniquely: {:?}", second);

        cleanup(&pool, room_id, guest_id, actor_id).await;
    }
}
