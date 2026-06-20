mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use hotel_app_be::models::{CustomerLedgerCreateRequest, CustomerLedgerPaymentRequest};
    use hotel_app_be::services::ledgers;
    use sqlx::Row;
    use rust_decimal::Decimal;

    #[tokio::test]
    async fn create_ledger_payment_is_idempotent_and_atomic() {
        let pool = super::common::setup_test_db().await;

        sqlx::query("INSERT INTO room_types (id, name, code, base_price) VALUES (7702, 'Type 1', 'T1', 100.0)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO rooms (id, room_number, room_type_id, status) VALUES (7702, '101', 7702, 'available')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO guests (id, first_name, last_name) VALUES (7702, 'Guest', 'One')").execute(&pool).await.unwrap();

        // Similar setup, create a ledger first
        sqlx::query(
            "INSERT INTO bookings (id, booking_number, guest_id, room_id, check_in_date, check_out_date, rate_per_night, total_amount, status) VALUES (7702, 'BK-PAY', 7702, 7702, '2026-06-20', '2026-06-21', 100.0, 150.0, 'confirmed')",
        ).execute(&pool).await.unwrap();

        sqlx::query(
            "INSERT INTO customer_ledgers (id, company_name, description, expense_type, amount, status, booking_id)
             VALUES (7702, 'Test Company', 'Desc', 'accommodation', 100.0, 'pending', 7702)"
        ).execute(&pool).await.unwrap();

        let req = CustomerLedgerPaymentRequest {
            payment_amount: 50.0,
            payment_method: "Cash".to_string(),
            payment_reference: Some("REF-123".to_string()),
            payment_date: Some("2026-06-20".to_string()),
            receipt_number: Some("RC-7702-1".to_string()),
            receipt_file_url: None,
            notes: Some("First payment".to_string()),
        };

        let payment1 = ledgers::create_ledger_payment(&pool, 7702, 1, req).await.expect("Payment 1 failed");

        let req2 = CustomerLedgerPaymentRequest {
            payment_amount: 50.0,
            payment_method: "Cash".to_string(),
            payment_reference: Some("REF-123".to_string()),
            payment_date: Some("2026-06-20".to_string()),
            receipt_number: Some("RC-7702-1".to_string()),
            receipt_file_url: None,
            notes: Some("First payment".to_string()),
        };

        // Try second payment with same receipt_number -> should fail
        let payment2 = ledgers::create_ledger_payment(&pool, 7702, 1, req2).await;
        assert!(payment2.is_err(), "Second payment with same receipt number should be rejected (idempotency)");
        
        if let Err(e) = payment2 {
            assert!(e.to_string().contains("Receipt number already exists"));
        }
    }
}
