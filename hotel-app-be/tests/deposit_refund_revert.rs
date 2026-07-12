mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use hotel_app_be::services::payments;
    use sqlx::Row;

    /// Insert a booking with a keycard deposit refund payment already recorded,
    /// mirroring what `PaymentRepository::refund_deposit` produces.
    async fn seed_booking_with_refund(pool: &sqlx::SqlitePool, id: i64) {
        sqlx::query(
            "INSERT INTO room_types (id, name, code, base_price) VALUES (?1, 'Revert Test', ?2, 100.0)",
        )
        .bind(id)
        .bind(format!("REV{id}"))
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) VALUES (?1, ?2, ?1, 'available')",
        )
        .bind(id)
        .bind(format!("R{id}"))
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name) VALUES (?1, 'Revert', 'Guest')",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();

        // total_amount fully covered by a booking payment so the post-revert
        // status recompute lands on 'paid' (refund rows are excluded anyway).
        sqlx::query(
            "INSERT INTO bookings \
             (id, booking_number, guest_id, room_id, check_in_date, check_out_date, \
              rate_per_night, total_amount, status, payment_status) \
             VALUES (?1, ?2, ?1, ?1, '2026-06-20', '2026-06-21', 100.0, 100.0, 'checked_in', 'paid')",
        )
        .bind(id)
        .bind(format!("BK-REV-{id}"))
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO payments (booking_id, amount, payment_method, payment_type, status, description, processed_by) \
             VALUES (?1, 100.0, 'cash', 'booking', 'completed', 'Room charge', 1)",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();

        // The deposit refund row that the revert should remove.
        sqlx::query(
            "INSERT INTO payments (booking_id, amount, payment_method, payment_type, status, description, processed_by) \
             VALUES (?1, 50.0, 'cash', 'refund', 'refunded', 'Keycard deposit refund', 1)",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn count_refund_rows(pool: &sqlx::SqlitePool, booking_id: i64) -> i64 {
        sqlx::query(
            "SELECT COUNT(*) AS c FROM payments \
             WHERE booking_id = ?1 AND payment_type = 'refund' AND description = 'Keycard deposit refund'",
        )
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .unwrap()
        .get::<i64, _>("c")
    }

    #[tokio::test]
    async fn revert_deposit_refund_removes_refund_row_and_recomputes_status() {
        let pool = super::common::setup_test_db().await;
        seed_booking_with_refund(&pool, 9810).await;

        assert_eq!(count_refund_rows(&pool, 9810).await, 1);

        let result = payments::revert_deposit_refund(&pool, 1, 9810)
            .await
            .expect("revert should succeed when a deposit refund exists");

        assert_eq!(result["booking_id"], 9810);
        assert_eq!(result["deposit_refunded"], false);
        assert!(result["reverted_payment_id"].as_i64().unwrap() > 0);

        // The refund row is gone, so the deposit reads as not-refunded again.
        assert_eq!(count_refund_rows(&pool, 9810).await, 0);

        // Booking payment status is recomputed from the remaining booking payment.
        let status: String = sqlx::query("SELECT payment_status FROM bookings WHERE id = ?1")
            .bind(9810_i64)
            .fetch_one(&pool)
            .await
            .unwrap()
            .get("payment_status");
        assert_eq!(status, "paid");
    }

    #[tokio::test]
    async fn revert_deposit_refund_errors_when_no_refund_exists() {
        let pool = super::common::setup_test_db().await;
        seed_booking_with_refund(&pool, 9811).await;

        // First revert removes the only refund.
        payments::revert_deposit_refund(&pool, 1, 9811)
            .await
            .expect("first revert should succeed");

        // Second revert has nothing to undo and must fail.
        let err = payments::revert_deposit_refund(&pool, 1, 9811)
            .await
            .expect_err("revert with no refund should error");

        let message = format!("{err:?}");
        assert!(
            message.contains("No deposit refund to revert"),
            "unexpected error: {message}"
        );

        // The non-refund booking payment is untouched.
        let booking_payments: i64 = sqlx::query(
            "SELECT COUNT(*) AS c FROM payments WHERE booking_id = ?1 AND payment_type = 'booking'",
        )
        .bind(9811_i64)
        .fetch_one(&pool)
        .await
        .unwrap()
        .get("c");
        assert_eq!(booking_payments, 1);
    }
}
