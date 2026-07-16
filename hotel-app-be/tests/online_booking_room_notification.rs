mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use hotel_app_be::services::payments::queue_paid_online_booking_room_assignment;
    use sqlx::Row;

    #[tokio::test]
    async fn paid_online_booking_queues_one_room_assignment_email() {
        let pool = crate::common::setup_test_db().await;

        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name, full_name, email, is_active)
             VALUES (8801, 'Online', 'Guest', 'Online Guest', 'online-guest@example.com', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status, is_active)
             VALUES (8801, 'WEB-801', 1, 'available', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO bookings (
                id, booking_number, guest_id, room_id, room_type_id,
                check_in_date, check_out_date, rate_per_night, total_amount,
                status, payment_status, source, portal_request_id
             ) VALUES (
                8801, 'WEB-BOOK-8801', 8801, 8801, 1,
                '2026-08-20', '2026-08-22', 200, 400,
                'confirmed', 'paid', 'website', 'request-8801'
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO payments (
                booking_id, amount, payment_method, payment_type, status
             ) VALUES (8801, 400, 'online_banking', 'booking', 'completed')",
        )
        .execute(&pool)
        .await
        .unwrap();

        queue_paid_online_booking_room_assignment(&pool, 8801)
            .await
            .unwrap();
        queue_paid_online_booking_room_assignment(&pool, 8801)
            .await
            .unwrap();

        let rows = sqlx::query(
            "SELECT subject, body_html, idempotency_key
             FROM email_deliveries
             WHERE idempotency_key = 'online-room-assignment:8801'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            rows.len(),
            1,
            "payment retries must not duplicate the email"
        );
        assert!(rows[0].get::<String, _>("subject").contains("WEB-801"));
        assert!(
            rows[0]
                .get::<String, _>("body_html")
                .contains("WEB-BOOK-8801")
        );
        assert_eq!(
            rows[0].get::<String, _>("idempotency_key"),
            "online-room-assignment:8801"
        );
    }

    #[tokio::test]
    async fn unpaid_booking_does_not_queue_room_assignment_email() {
        let pool = crate::common::setup_test_db().await;

        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name, full_name, email, is_active)
             VALUES (8802, 'Waiting', 'Guest', 'Waiting Guest', 'waiting@example.com', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status, is_active)
             VALUES (8802, 'WEB-802', 1, 'available', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO bookings (
                id, booking_number, guest_id, room_id, room_type_id,
                check_in_date, check_out_date, rate_per_night, total_amount,
                status, payment_status, source, portal_request_id
             ) VALUES (
                8802, 'WEB-BOOK-8802', 8802, 8802, 1,
                '2026-08-20', '2026-08-22', 200, 400,
                'pending', 'unpaid', 'website', 'request-8802'
             )",
        )
        .execute(&pool)
        .await
        .unwrap();

        queue_paid_online_booking_room_assignment(&pool, 8802)
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM email_deliveries")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}
