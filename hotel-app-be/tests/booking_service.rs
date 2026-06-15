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

        sqlx::query("INSERT INTO guests (id, first_name, last_name) VALUES (1, 'Test', 'Guest')")
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

        let b = booking::fetch_booking_by_id(&pool, 1)
            .await
            .expect("fetch_booking_by_id should succeed for existing row");

        assert_eq!(b.id, 1);
        assert_eq!(b.booking_number, "BK-20260418-deadbeef");
        assert_eq!(b.guest_id, 1);
        assert_eq!(b.room_id, 1);
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
}

#[cfg(all(feature = "postgres", not(feature = "sqlite")))]
mod postgres_tests {
    use axum::extract::{Extension, Path, State};
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::services::bookings;
    use sqlx::postgres::PgPoolOptions;
    use sqlx::{PgPool, Row};

    async fn setup_pg_pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("skipping PostgreSQL booking workflow test; DATABASE_URL is not set");
                return None;
            }
        };

        Some(
            PgPoolOptions::new()
                .max_connections(5)
                .connect(&database_url)
                .await
                .expect("connect to PostgreSQL test database"),
        )
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
        let Some(pool) = setup_pg_pool().await else {
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
