//! Tests for city-ledger balance math: creating a ledger, posting a payment
//! against it, and voiding it — exercised through the services::ledgers /
//! repositories::ledger layer against a scratch SQLite database.
//!
//! `balance_due` is a STORED generated column (`amount - paid_amount`, added
//! to SQLite in migration 021_customer_ledgers_balance_due.sql to match
//! schema.sql) — these tests assert on it directly rather than recomputing
//! it, so a regression in either the generated-column expression or in how
//! `create_ledger_payment` updates `paid_amount` will show up here.
//!
//! IMPORTANT (found while writing this coverage, see
//! `balance_due_reads_correctly_for_whole_number_generated_value` below):
//! the SQLite application-level read of `balance_due` used to read back as
//! `0` whenever the true balance was a *whole number* (String/f64-only
//! decode vs INTEGER storage class) -- FIXED 2026-07-12 by adding an i64
//! fallback to get_decimal/get_opt_decimal in src/models/row_mappers.rs.
//! The arithmetic tests below still use fractional balances (`.25`/`.5`/
//! `.75`) simply because they were written that way; the dedicated
//! regression test covers the whole-number path.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use hotel_app_be::models::{
        CustomerLedgerCreateRequest, CustomerLedgerPaymentRequest, LedgerVoidRequest,
    };
    use hotel_app_be::repositories::ledger as repo;
    use hotel_app_be::services::ledgers;
    use rust_decimal::Decimal;
    use sqlx::SqlitePool;

    /// Minimal valid ledger create request, not linked to a booking.
    /// `repositories::ledger::create_customer_ledger`'s existing-charge
    /// dedup guard only triggers when `booking_id` is `Some`, so tests
    /// exercising that guard build their own request with `booking_id` set.
    fn base_req(amount: f64) -> CustomerLedgerCreateRequest {
        CustomerLedgerCreateRequest {
            company_name: "Balance Math Co".into(),
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
            amount,
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

    fn payment_req(amount: f64) -> CustomerLedgerPaymentRequest {
        CustomerLedgerPaymentRequest {
            payment_amount: amount,
            payment_method: "Cash".into(),
            payment_reference: None,
            receipt_number: None,
            receipt_file_url: None,
            notes: None,
            payment_date: None,
        }
    }

    /// Seed the room/guest/booking rows a `customer_ledgers.booking_id`
    /// foreign key needs. Mirrors tests/company_ledger_idempotency.rs.
    async fn seed_booking(pool: &SqlitePool, booking_id: i64) {
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) VALUES (?1, ?2, 1, 'available')",
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

    // ---- Ledger creation ---------------------------------------------

    #[tokio::test]
    async fn create_ledger_sets_balance_due_to_full_amount() {
        let pool = super::common::setup_test_db().await;

        // 199.50 (not a whole number) so this read doesn't hit the SQLite
        // whole-number balance_due decode bug documented below.
        let ledger = ledgers::create_customer_ledger(&pool, 1, base_req(199.50))
            .await
            .expect("create should succeed");

        assert_eq!(
            ledger.paid_amount,
            Decimal::ZERO,
            "a freshly created ledger has no payments yet"
        );
        assert_eq!(
            ledger.balance_due, ledger.amount,
            "generated column balance_due (amount - paid_amount) must equal amount when unpaid"
        );
        assert_eq!(ledger.status, "pending");
    }

    /// KNOWN BUG (found while adding this first test coverage; NOT fixed
    /// here -- production code changes are out of scope for this test-only
    /// task). Every single-row ledger read
    /// (`repositories::ledger::get_customer_ledger`, `create_customer_ledger`,
    /// `create_ledger_payment`, `void_ledger`, ...) returns
    /// `balance_due == 0` whenever the *true* value of
    /// `amount - paid_amount` happens to be a whole number, even though the
    /// true balance is nonzero.
    ///
    /// Root cause: `customer_ledgers.balance_due` is declared
    /// `DECIMAL(10,2) GENERATED ALWAYS AS (amount - paid_amount) STORED`
    /// (database/sqlite_schema.sql section 21).
    /// Under SQLite type-affinity rules a `DECIMAL(...)` declared type gets
    /// NUMERIC affinity, not REAL affinity (REAL affinity requires the
    /// declared type to contain "REAL"/"FLOA"/"DOUB"). NUMERIC affinity
    /// silently stores a *lossless* generated value using SQLite's INTEGER
    /// storage class instead of REAL. `models/row_mappers.rs::get_decimal`
    /// (SQLite variant, ~line 37) only tries decoding the column as
    /// `String` then `f64`; it has no `i64` fallback, so both decode
    /// attempts fail with a type mismatch and it silently falls through to
    /// `.unwrap_or_default()` == `Decimal::ZERO`.
    ///
    /// This does NOT affect `amount`/`paid_amount` themselves (declared
    /// `REAL NOT NULL` / `REAL DEFAULT 0.00` -- REAL affinity always stores
    /// as SQLite's REAL storage class regardless of value), and it does NOT
    /// affect `get_ledger_summary`'s aggregate total (its SQL wraps the sum
    /// in `CAST(balance_due AS REAL)`, forcing REAL affinity explicitly).
    /// It affects every *per-row* ledger read.
    ///
    /// FIXED 2026-07-12: `get_decimal`/`get_opt_decimal` (SQLite variants,
    /// src/models/row_mappers.rs) now carry the `i64` fallback arm this
    /// test's discovery motivated. This is the regression test: a
    /// whole-number balance must read back through the application layer
    /// exactly as the generated column stores it.
    #[tokio::test]
    async fn balance_due_reads_correctly_for_whole_number_generated_value() {
        let pool = super::common::setup_test_db().await;

        let ledger = ledgers::create_customer_ledger(&pool, 1, base_req(200.0))
            .await
            .unwrap();

        // The generated column stores the lossless whole-number value under
        // SQLite's INTEGER storage class (NUMERIC affinity).
        let raw_balance: i64 =
            sqlx::query_scalar("SELECT balance_due FROM customer_ledgers WHERE id = ?1")
                .bind(ledger.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            raw_balance, 200,
            "the generated column itself computes amount - paid_amount correctly"
        );

        // And the application-level read -- what every handler/API response
        // actually returns to the UI -- must agree with it.
        assert_eq!(
            ledger.balance_due,
            Decimal::from(200),
            "whole-number balance_due must survive the row-mapper decode \
             (i64 fallback in get_decimal/get_opt_decimal)"
        );
    }

    // ---- Payment posting -----------------------------------------------

    #[tokio::test]
    async fn partial_payment_updates_paid_amount_and_balance_due() {
        let pool = super::common::setup_test_db().await;
        let ledger = ledgers::create_customer_ledger(&pool, 1, base_req(200.0))
            .await
            .unwrap();

        // 45.50 leaves a fractional (154.50) remainder, avoiding the
        // whole-number balance_due read bug documented above.
        let payment = ledgers::create_ledger_payment(&pool, ledger.id, 1, payment_req(45.50))
            .await
            .expect("partial payment should succeed");

        let updated = repo::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(
            updated.paid_amount, payment.payment_amount,
            "paid_amount must reflect the single payment just recorded"
        );
        assert_eq!(
            updated.balance_due,
            ledger.amount - updated.paid_amount,
            "balance_due must equal amount - paid_amount after a partial payment"
        );
        assert_eq!(updated.status, "partial");
    }

    #[tokio::test]
    async fn two_partial_payments_accumulate_paid_amount() {
        let pool = super::common::setup_test_db().await;
        let ledger = ledgers::create_customer_ledger(&pool, 1, base_req(200.0))
            .await
            .unwrap();

        // 45.50 + 30.25 = 75.75 paid, leaving a fractional (124.25)
        // remainder -- avoids the whole-number balance_due read bug.
        let p1 = ledgers::create_ledger_payment(&pool, ledger.id, 1, payment_req(45.50))
            .await
            .expect("first partial payment should succeed");
        let p2 = ledgers::create_ledger_payment(&pool, ledger.id, 1, payment_req(30.25))
            .await
            .expect("second partial payment should succeed");

        let updated = repo::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(
            updated.paid_amount,
            p1.payment_amount + p2.payment_amount,
            "paid_amount must accumulate across multiple payments"
        );
        assert_eq!(updated.balance_due, ledger.amount - updated.paid_amount);
        assert_eq!(updated.status, "partial");
    }

    #[tokio::test]
    async fn full_payment_zeroes_balance_due_and_marks_paid() {
        let pool = super::common::setup_test_db().await;
        let ledger = ledgers::create_customer_ledger(&pool, 1, base_req(200.0))
            .await
            .unwrap();

        ledgers::create_ledger_payment(&pool, ledger.id, 1, payment_req(200.0))
            .await
            .expect("full payment should succeed");

        let updated = repo::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(updated.paid_amount, ledger.amount);
        // A fully paid balance of exactly zero is the one whole-number case
        // the decode bug above does NOT corrupt (its buggy fallback and the
        // true answer are both 0), so this assertion is reliable.
        assert_eq!(updated.balance_due, Decimal::ZERO);
        assert_eq!(updated.status, "paid");
    }

    #[tokio::test]
    async fn payment_exceeding_outstanding_balance_is_rejected() {
        let pool = super::common::setup_test_db().await;
        // 200.50 (fractional) so the post-rejection balance_due read below
        // doesn't hit the whole-number decode bug.
        let ledger = ledgers::create_customer_ledger(&pool, 1, base_req(200.50))
            .await
            .unwrap();

        let result = ledgers::create_ledger_payment(&pool, ledger.id, 1, payment_req(250.0)).await;
        assert!(
            result.is_err(),
            "a payment larger than the outstanding balance must be rejected"
        );

        // Balance must be untouched by the rejected attempt.
        let unchanged = repo::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(unchanged.paid_amount, Decimal::ZERO);
        assert_eq!(unchanged.balance_due, ledger.amount);
    }

    #[tokio::test]
    async fn payment_against_a_voided_ledger_is_rejected() {
        let pool = super::common::setup_test_db().await;
        let ledger = ledgers::create_customer_ledger(&pool, 1, base_req(200.0))
            .await
            .unwrap();

        ledgers::void_ledger(
            &pool,
            ledger.id,
            1,
            LedgerVoidRequest {
                reason: "void before payment attempt".into(),
            },
        )
        .await
        .expect("void should succeed");

        let result = ledgers::create_ledger_payment(&pool, ledger.id, 1, payment_req(50.0)).await;
        assert!(
            result.is_err(),
            "cannot record a payment against a voided ledger"
        );
    }

    // ---- Voiding ---------------------------------------------------------

    #[tokio::test]
    async fn void_ledger_sets_void_fields_and_status() {
        let pool = super::common::setup_test_db().await;
        let ledger = ledgers::create_customer_ledger(&pool, 1, base_req(200.0))
            .await
            .unwrap();

        let voided = ledgers::void_ledger(
            &pool,
            ledger.id,
            1,
            LedgerVoidRequest {
                reason: "test void".into(),
            },
        )
        .await
        .expect("void should succeed");

        assert_eq!(voided.status, "void");
        assert!(voided.void_at.is_some(), "void_at must be set");
        assert_eq!(voided.void_by, Some(1));
        assert_eq!(voided.void_reason.as_deref(), Some("test void"));
    }

    #[tokio::test]
    async fn voiding_an_already_voided_ledger_is_rejected() {
        let pool = super::common::setup_test_db().await;
        let ledger = ledgers::create_customer_ledger(&pool, 1, base_req(200.0))
            .await
            .unwrap();

        ledgers::void_ledger(
            &pool,
            ledger.id,
            1,
            LedgerVoidRequest {
                reason: "first void".into(),
            },
        )
        .await
        .expect("first void should succeed");

        let second = ledgers::void_ledger(
            &pool,
            ledger.id,
            1,
            LedgerVoidRequest {
                reason: "second void".into(),
            },
        )
        .await;
        assert!(second.is_err(), "double-void must be rejected");
    }

    #[tokio::test]
    async fn voided_ledger_is_excluded_from_outstanding_summary() {
        let pool = super::common::setup_test_db().await;

        // get_ledger_summary's total_outstanding is computed via raw SQL
        // (SUM(CAST(balance_due AS REAL))), which is unaffected by the
        // per-row decode bug above, so whole-number amounts are fine here.
        ledgers::create_customer_ledger(&pool, 1, base_req(100.0))
            .await
            .unwrap();
        let to_void = ledgers::create_customer_ledger(&pool, 1, base_req(200.0))
            .await
            .unwrap();

        let before = ledgers::get_ledger_summary(&pool).await.unwrap();
        assert_eq!(before["total_entries"].as_i64().unwrap(), 2);
        assert_eq!(before["total_outstanding"].as_f64().unwrap(), 300.0);

        ledgers::void_ledger(
            &pool,
            to_void.id,
            1,
            LedgerVoidRequest {
                reason: "void for summary test".into(),
            },
        )
        .await
        .unwrap();

        let after = ledgers::get_ledger_summary(&pool).await.unwrap();
        assert_eq!(
            after["total_entries"].as_i64().unwrap(),
            1,
            "a voided row drops out of total_entries (get_ledger_summary: WHERE status NOT IN ('void'))"
        );
        assert_eq!(
            after["total_outstanding"].as_f64().unwrap(),
            100.0,
            "a voided row's balance_due no longer counts toward total_outstanding"
        );
    }

    #[tokio::test]
    async fn voided_ledger_reports_zero_balance_due_but_the_stored_column_is_unchanged() {
        // models/row_mappers.rs::row_to_customer_ledger deliberately forces
        // balance_due to Decimal::ZERO in its return value whenever
        // status == "void" (or void_at is set) -- a voided charge no longer
        // owes anything, by design. This is separate from (and layered on
        // top of) get_ledger_summary excluding void rows entirely via its
        // status filter. The underlying generated column value itself is
        // untouched by voiding -- verified below via a raw query.
        let pool = super::common::setup_test_db().await;
        let ledger = ledgers::create_customer_ledger(&pool, 1, base_req(200.75))
            .await
            .unwrap();

        let voided = ledgers::void_ledger(
            &pool,
            ledger.id,
            1,
            LedgerVoidRequest {
                reason: "check balance zeroing".into(),
            },
        )
        .await
        .unwrap();

        assert_eq!(
            voided.balance_due,
            Decimal::ZERO,
            "the model-level read reports zero for a voided ledger regardless of amount/paid_amount"
        );
        assert_eq!(
            voided.amount, ledger.amount,
            "amount itself is untouched by voiding"
        );

        // The raw stored generated-column value is unchanged by the void --
        // only the higher-level row_to_customer_ledger mapping zeroes it.
        let raw_balance: f64 =
            sqlx::query_scalar("SELECT balance_due FROM customer_ledgers WHERE id = ?1")
                .bind(ledger.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            raw_balance, 200.75,
            "voiding does not mutate amount/paid_amount, so the generated column is unchanged"
        );
    }

    // ---- Idempotency of repeated posting ---------------------------------

    #[tokio::test]
    async fn create_customer_ledger_dedupes_matching_booking_charge() {
        let pool = super::common::setup_test_db().await;
        seed_booking(&pool, 501).await;

        let mut req1 = base_req(150.0);
        req1.booking_id = Some(501);
        req1.post_type = Some("room_charge".into());

        let mut req2 = base_req(150.0);
        req2.booking_id = Some(501);
        req2.post_type = Some("room_charge".into());

        let first = ledgers::create_customer_ledger(&pool, 1, req1)
            .await
            .expect("first create should succeed");
        let second = ledgers::create_customer_ledger(&pool, 1, req2)
            .await
            .expect("second create with identical booking charge should succeed (idempotent)");

        assert_eq!(
            first.id, second.id,
            "an identical booking-linked charge must be deduped by the existing-charge guard \
             in repositories::ledger::create_customer_ledger, not double-posted"
        );

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM customer_ledgers WHERE booking_id = 501")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 1, "only one row should exist for the deduped charge");
    }

    #[tokio::test]
    async fn create_customer_ledger_does_not_dedupe_a_different_amount_for_the_same_booking() {
        let pool = super::common::setup_test_db().await;
        seed_booking(&pool, 502).await;

        // post_type left as None (not "room_charge") deliberately: a
        // second "room_charge" row for the same booking is separately
        // blocked at the DB level by the partial unique index
        // uq_customer_ledgers_booking_room_charge regardless of amount (see
        // tests/company_ledger_idempotency.rs) -- this test isolates the
        // *application-level* existing-charge guard's amount comparison
        // instead.
        let mut req1 = base_req(150.0);
        req1.booking_id = Some(502);

        let mut req2 = base_req(999.0);
        req2.booking_id = Some(502);

        let first = ledgers::create_customer_ledger(&pool, 1, req1)
            .await
            .unwrap();
        let second = ledgers::create_customer_ledger(&pool, 1, req2)
            .await
            .unwrap();

        assert_ne!(
            first.id, second.id,
            "the existing-charge guard matches on amount too, so a different amount is a new row"
        );
    }

    /// Documents CURRENT behavior: unlike booking-linked charges, a ledger
    /// entry created with no `booking_id` has no dedup guard anywhere in
    /// `repositories::ledger::create_customer_ledger` (the guard is inside
    /// `if let Some(booking_id) = request.booking_id`). Calling create
    /// twice with otherwise-identical fields produces two separate rows.
    /// This is not asserting a bug fix -- just pinning today's behavior so a
    /// future change to the guard's scope is a deliberate, visible diff.
    #[tokio::test]
    async fn create_customer_ledger_without_booking_id_has_no_dedup_guard() {
        let pool = super::common::setup_test_db().await;

        let first = ledgers::create_customer_ledger(&pool, 1, base_req(75.0))
            .await
            .unwrap();
        let second = ledgers::create_customer_ledger(&pool, 1, base_req(75.0))
            .await
            .unwrap();

        assert_ne!(
            first.id, second.id,
            "no booking_id means no idempotency guard today: a repeated identical \
             create_customer_ledger call double-posts"
        );

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM customer_ledgers WHERE company_name = 'Balance Math Co' AND amount = 75.0",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            count, 2,
            "two rows exist -- this is current behavior, not a guarantee"
        );
    }
}
