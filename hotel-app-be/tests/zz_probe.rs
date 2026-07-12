mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use hotel_app_be::models::{CustomerLedgerCreateRequest, LedgerVoidRequest};
    use hotel_app_be::repositories::ledger as repo;

    fn base_req() -> CustomerLedgerCreateRequest {
        CustomerLedgerCreateRequest {
            company_name: "Test Co".into(),
            company_registration_number: None,
            contact_person: None,
            contact_email: None,
            contact_phone: None,
            billing_address_line1: None,
            billing_city: None,
            billing_state: None,
            billing_postal_code: None,
            billing_country: None,
            description: "Room charge".into(),
            expense_type: "accommodation".into(),
            amount: 200.0,
            currency: None,
            booking_id: None,
            guest_id: None,
            invoice_date: None,
            due_date: None,
            notes: None,
            internal_notes: None,
            folio_type: None,
            transaction_type: None,
            post_type: None,
            department_code: None,
            transaction_code: None,
            room_number: None,
            posting_date: None,
            transaction_date: None,
            reference_number: None,
            tax_amount: None,
            service_charge: None,
        }
    }

    #[tokio::test]
    async fn probe_create_and_void() {
        let pool = super::common::setup_test_db().await;

        let created = repo::create_customer_ledger(&pool, 1, base_req()).await;
        match &created {
            Ok(l) => println!("create ok, id={}", l.id),
            Err(e) => println!("create ERR: {}", e),
        }
        let ledger = created.expect("create should succeed");

        let voided = repo::void_ledger(
            &pool,
            ledger.id,
            1,
            LedgerVoidRequest {
                reason: "test".into(),
            },
        )
        .await;
        match &voided {
            Ok(l) => println!("void ok, status={}", l.status),
            Err(e) => println!("void ERR: {}", e),
        }
    }
}
