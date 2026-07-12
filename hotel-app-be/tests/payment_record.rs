mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use hotel_app_be::models::{RecordPaymentRequest, UpdatePaymentRequest};
    use hotel_app_be::services::payments;
    use sqlx::Row;

    #[tokio::test]
    async fn record_payment_uses_sqlite_payment_schema_and_recomputes_status() {
        let pool = super::common::setup_test_db().await;

        sqlx::query(
            "INSERT INTO room_types (id, name, code, base_price) VALUES (9801, 'Payment Test', 'PAY9801', 100.0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) VALUES (9801, 'P9801', 9801, 'available')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name) VALUES (9801, 'Paying', 'Guest')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO bookings \
             (id, booking_number, guest_id, room_id, check_in_date, check_out_date, \
              rate_per_night, total_amount, status, payment_status) \
             VALUES (9801, 'BK-20260620-payments', 9801, 9801, '2026-06-20', '2026-06-21', \
                     100.0, 150.0, 'confirmed', 'unpaid')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let recorded = payments::record_payment(
            &pool,
            1,
            RecordPaymentRequest {
                booking_id: 9801,
                amount: 50.0,
                payment_method: "Cash".to_string(),
                payment_type: Some("booking".to_string()),
                transaction_reference: Some("TEST-REC-9801".to_string()),
                notes: Some("Front desk partial payment".to_string()),
                payment_date: Some("2026-06-20".to_string()),
            },
        )
        .await
        .expect("record payment should insert using SQLite schema");

        assert_eq!(recorded["booking_id"], 9801);
        assert_eq!(recorded["transaction_reference"], "TEST-REC-9801");
        assert_eq!(recorded["notes"], "Front desk partial payment");
        assert_eq!(recorded["payment_date"], "2026-06-20");

        let payments = payments::get_all_payments(&pool, 9801)
            .await
            .expect("payment list should use SQLite schema aliases");
        assert_eq!(payments.len(), 1);
        assert_eq!(payments[0]["transaction_reference"], "TEST-REC-9801");
        assert_eq!(payments[0]["payment_date"], "2026-06-20");

        let payment_id = recorded["id"]
            .as_i64()
            .expect("payment id should be numeric");
        let updated = payments::update_payment(
            &pool,
            1,
            payment_id,
            UpdatePaymentRequest {
                amount: Some(75.0),
                payment_method: Some("Visa Card".to_string()),
                transaction_reference: None,
                notes: None,
                payment_date: Some("2026-06-19".to_string()),
            },
        )
        .await
        .expect("update payment should update the date using SQLite schema");

        assert_eq!(updated["payment_date"], "2026-06-19");

        let payments = payments::get_all_payments(&pool, 9801)
            .await
            .expect("payment list should include the edited payment date");
        assert_eq!(payments[0]["payment_date"], "2026-06-19");

        let row = sqlx::query(
            "SELECT payment_status, reference_number, description, processed_by FROM payments p \
             JOIN bookings b ON b.id = p.booking_id \
             WHERE p.booking_id = ?1",
        )
        .bind(9801_i64)
        .fetch_one(&pool)
        .await
        .unwrap();

        let payment_status: String = row.get("payment_status");
        let reference_number: String = row.get("reference_number");
        let description: String = row.get("description");
        let processed_by: i64 = row.get("processed_by");

        assert_eq!(payment_status, "partial");
        assert_eq!(reference_number, "TEST-REC-9801");
        assert_eq!(description, "Front desk partial payment");
        assert_eq!(processed_by, 1);
    }

    #[tokio::test]
    async fn record_payment_concurrent_prevents_overpayment() {
        let pool = std::sync::Arc::new(super::common::setup_test_db().await);

        sqlx::query(
            "INSERT INTO room_types (id, name, code, base_price) VALUES (9803, 'Payment Test', 'PAY9803', 100.0)",
        )
        .execute(&*pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) VALUES (9803, 'P9803', 9803, 'available')",
        )
        .execute(&*pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name) VALUES (9803, 'Concurrent', 'Guest')",
        )
        .execute(&*pool)
        .await
        .unwrap();

        // 150.0 total amount
        sqlx::query(
            "INSERT INTO bookings \
             (id, booking_number, guest_id, room_id, check_in_date, check_out_date, \
              rate_per_night, total_amount, status, payment_status) \
             VALUES (9803, 'BK-20260620-concurrent', 9803, 9803, '2026-06-20', '2026-06-21', \
                     100.0, 150.0, 'confirmed', 'unpaid')",
        )
        .execute(&*pool)
        .await
        .unwrap();

        let req1 = RecordPaymentRequest {
            booking_id: 9803,
            amount: 150.0,
            payment_method: "Cash".to_string(),
            payment_type: Some("booking".to_string()),
            transaction_reference: Some("TRX-CONC-1".to_string()),
            notes: None,
            payment_date: None,
        };

        let req2 = RecordPaymentRequest {
            booking_id: 9803,
            amount: 150.0,
            payment_method: "Cash".to_string(),
            payment_type: Some("booking".to_string()),
            transaction_reference: Some("TRX-CONC-2".to_string()),
            notes: None,
            payment_date: None,
        };

        let p1 = pool.clone();
        let p2 = pool.clone();

        let (res1, res2) = tokio::join!(
            tokio::spawn(async move { payments::record_payment(&p1, 1, req1).await }),
            tokio::spawn(async move { payments::record_payment(&p2, 1, req2).await }),
        );

        let first = res1.unwrap();
        let second = res2.unwrap();

        let success_count = first.is_ok() as i32 + second.is_ok() as i32;

        assert_eq!(
            success_count, 1,
            "exactly one concurrent payment should succeed without exceeding balance: first={first:?}, second={second:?}"
        );
    }
}
