//! Integration tests for the company room-charge uniqueness guarantee.
//!
//! These verify the partial unique index `uq_customer_ledgers_booking_room_charge`
//! (migration 013) at the SQL level: it must make a duplicate non-reversal
//! `room_charge` posting for a booking structurally impossible, so concurrent
//! checkouts cannot double-post the city ledger. Run with:
//!
//!   cargo test --features sqlite --no-default-features
//!
//! NOTE: the SQLite `customer_ledgers` table predates the city-ledger feature
//! and has a different column set than PostgreSQL (no `amount`/`is_reversal`),
//! so these tests assert the index behaviour using the columns SQLite actually
//! has. The same guarantee is enforced in PostgreSQL by the matching index in
//! `database/schema.sql`.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use super::common::setup_test_db;
    use sqlx::SqlitePool;

    /// Insert a room-charge ledger row for `booking_id`. `ledger_number` must be
    /// unique per row (NOT NULL UNIQUE in the schema).
    const INSERT_ROOM_CHARGE: &str = "INSERT INTO customer_ledgers \
        (ledger_number, transaction_type, transaction_date, description, balance, booking_id, post_type) \
        VALUES (?1, 'debit', '2026-01-01', 'Room charge', 0, ?2, 'room_charge')";

    /// Seed the room/guest/booking rows a `customer_ledgers.booking_id` foreign
    /// key needs (SQLite enforces foreign keys in the test pool).
    async fn seed_booking(pool: &SqlitePool, booking_id: i64) {
        sqlx::query(
            "INSERT OR IGNORE INTO rooms (id, room_number, room_type_id, status) \
             VALUES (?1, ?2, 1, 'available')",
        )
        .bind(booking_id)
        .bind(format!("T{booking_id}"))
        .execute(pool)
        .await
        .expect("seed room");

        sqlx::query("INSERT INTO guests (id, first_name, last_name) VALUES (?1, 'Ledger', ?2)")
            .bind(booking_id)
            .bind(format!("Guest{booking_id}"))
            .execute(pool)
            .await
            .expect("seed guest");

        sqlx::query(
            "INSERT INTO bookings \
             (id, booking_number, guest_id, room_id, room_type_id, check_in_date, check_out_date, \
              rate_per_night, total_amount, status, created_by) \
             VALUES (?1, ?2, ?1, ?1, 1, '2030-01-01', '2030-01-02', 150.0, 150.0, 'checked_out', 1)",
        )
        .bind(booking_id)
        .bind(format!("BK-2030-{booking_id}"))
        .execute(pool)
        .await
        .expect("seed booking");
    }

    #[tokio::test]
    async fn duplicate_room_charge_for_same_booking_is_rejected() {
        let pool = setup_test_db().await;
        seed_booking(&pool, 1).await;

        sqlx::query(INSERT_ROOM_CHARGE)
            .bind("L-1")
            .bind(1_i64)
            .execute(&pool)
            .await
            .expect("first room_charge insert should succeed");

        let second = sqlx::query(INSERT_ROOM_CHARGE)
            .bind("L-2")
            .bind(1_i64)
            .execute(&pool)
            .await;

        assert!(
            second.is_err(),
            "a second non-reversal room_charge for the same booking must violate the unique index"
        );
    }

    #[tokio::test]
    async fn on_conflict_do_nothing_makes_posting_idempotent() {
        let pool = setup_test_db().await;
        seed_booking(&pool, 7).await;

        let sql = "INSERT INTO customer_ledgers \
            (ledger_number, transaction_type, transaction_date, description, balance, booking_id, post_type) \
            VALUES (?1, 'debit', '2026-01-01', 'Room charge', 0, ?2, 'room_charge') \
            ON CONFLICT DO NOTHING RETURNING id";

        let first: Option<i64> = sqlx::query_scalar(sql)
            .bind("L-1")
            .bind(7_i64)
            .fetch_optional(&pool)
            .await
            .expect("first insert query should run");
        assert!(first.is_some(), "first insert returns the new row id");

        let second: Option<i64> = sqlx::query_scalar(sql)
            .bind("L-2")
            .bind(7_i64)
            .fetch_optional(&pool)
            .await
            .expect("second insert query should run");
        assert!(
            second.is_none(),
            "second insert is a no-op (idempotent retry / concurrent checkout)"
        );

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM customer_ledgers WHERE booking_id = 7 AND post_type = 'room_charge'",
        )
        .fetch_one(&pool)
        .await
        .expect("count query should run");
        assert_eq!(
            count, 1,
            "exactly one room_charge row may exist for the booking"
        );
    }

    #[tokio::test]
    async fn non_room_charge_rows_for_same_booking_are_unaffected() {
        let pool = setup_test_db().await;
        seed_booking(&pool, 3).await;

        sqlx::query(INSERT_ROOM_CHARGE)
            .bind("L-1")
            .bind(3_i64)
            .execute(&pool)
            .await
            .expect("room_charge insert should succeed");

        // A different post_type for the same booking is outside the partial index.
        let payment = sqlx::query(
            "INSERT INTO customer_ledgers \
             (ledger_number, transaction_type, transaction_date, description, balance, booking_id, post_type) \
             VALUES ('L-2', 'credit', '2026-01-01', 'Payment', 0, 3, 'payment')",
        )
        .execute(&pool)
        .await;

        assert!(
            payment.is_ok(),
            "a non-room_charge posting for the same booking must still be allowed"
        );
    }

    #[tokio::test]
    async fn room_charges_for_different_bookings_are_allowed() {
        let pool = setup_test_db().await;
        seed_booking(&pool, 10).await;
        seed_booking(&pool, 11).await;

        sqlx::query(INSERT_ROOM_CHARGE)
            .bind("L-1")
            .bind(10_i64)
            .execute(&pool)
            .await
            .expect("room_charge for booking 10 should succeed");

        let other = sqlx::query(INSERT_ROOM_CHARGE)
            .bind("L-2")
            .bind(11_i64)
            .execute(&pool)
            .await;

        assert!(
            other.is_ok(),
            "room_charge postings for distinct bookings must not collide"
        );
    }
}
