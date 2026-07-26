//! Characterization tests for the five previously-uncovered ledger mutation
//! functions: `void_ledger`, `create_ledger_reversal`, `update_ledger_payment`,
//! `delete_ledger_payment`, `update_customer_ledger`.
//!
//! Business logic lives in `src/repositories/ledger.rs`; `src/services/ledgers.rs`
//! is a thin passthrough that additionally sanitizes free text and writes an
//! `audit_logs` row per mutation. All tests here call through the SERVICE
//! layer (not the repository directly) so both of those get exercised.
//!
//! Requires `DATABASE_URL` (PostgreSQL); tests skip gracefully without it,
//! the same convention as `tests/ledger_service.rs` / `tests/booking_service.rs`.
//!
//! Fixture IDs: this file's exclusive block is 940_100-940_199. The only
//! fixed ids created are `users` rows (one actor per test fn, never reused -
//! checked with `grep -n "940_1" tests/*.rs` before writing this file).
//! `customer_ledgers`/`customer_ledger_payments` rows are always
//! auto-generated (IDENTITY columns) and scoped for cleanup by a
//! test-specific `company_name` (e.g. "Lgr940 Void Co"), mirroring
//! `cleanup_ledgers_by_company` in `tests/ledger_service.rs`. Receipt numbers
//! are prefixed `LGR940-RCT-` so they cannot collide with any other test
//! file's rows in the shared, persistent dev database, and stale rows from a
//! prior run of THIS file are removed by the same company-scoped cleanup
//! that runs at the start of every test (proving idempotency on rerun).
//!
//! KNOWN BUGS (do not enshrine — see `.claude/rules/lessons.md` and
//! `docs/ongoing-dev.md` tasks #11 / #19). Three scenarios below are written
//! asserting the DECIDED-CORRECT behavior and marked `#[ignore]` because the
//! current code does the opposite:
//! - `void_ledger` (repositories/ledger.rs:935) never checks `paid_amount`,
//!   so voiding a ledger that has collected payments makes that money vanish
//!   from `get_ledger_summary` (which excludes `status = 'void'` rows).
//!   Correct: refuse the void when `paid_amount > 0`.
//! - `update_customer_ledger` (repositories/ledger.rs:479) lets `status` be
//!   set to `'void'` on a request gated by `ledgers:update`
//!   (`src/routes/ledgers.rs` PATCH `/ledgers/{id}`) instead of
//!   `ledgers:void`, leaving `void_at`/`void_by`/`void_reason` NULL. Correct:
//!   that path must refuse `status = 'void'`.
//! - `get_ledger_summary` (repositories/ledger.rs:896-908) sums
//!   `amount`/`paid_amount`/`balance_due` over every non-void row with NO
//!   `transaction_type` sign handling (`transaction_type` never appears in
//!   that query). Reversing a debit inserts a credit sibling with its own
//!   `paid_amount == amount`/`status = 'paid'`, so the pair DOUBLES reported
//!   `total_amount` and INVENTS collected cash instead of netting the charge
//!   to zero. Correct: a fully reversed charge must leave
//!   `total_amount`/`total_paid`/`total_outstanding` unchanged.

fn pg_serial_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

mod postgres_tests {
    use chrono::Utc;
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::{
        CustomerLedgerCreateRequest, CustomerLedgerPaymentRequest, CustomerLedgerUpdateRequest,
        LedgerReversalRequest, LedgerVoidRequest, UpdateLedgerPaymentRequest,
    };
    use hotel_app_be::services::ledgers;
    use rust_decimal::Decimal;
    use sqlx::{PgPool, postgres::PgPoolOptions};
    use std::str::FromStr;

    async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!(
                    "Skipping PostgreSQL ledger-characterization test because DATABASE_URL is not set"
                );
                return None;
            }
        };
        let guard = super::pg_serial_lock().lock_owned().await;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database");
        Some((pool, guard))
    }

    /// Upserts a single test actor `users` row (FK target for
    /// `created_by`/`updated_by`/`void_by`/`processed_by`). `services::ledgers`
    /// does not itself call `check_permission` (RBAC for this domain is
    /// gated at the routes layer only - see `src/routes/ledgers.rs`), so no
    /// roles/permissions need to be granted to exercise the service functions
    /// directly.
    async fn ensure_test_actor(pool: &PgPool, actor_id: i64) {
        sqlx::query(
            "INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'staff', true, true) \
             ON CONFLICT (id) DO UPDATE SET \
                 username = EXCLUDED.username, email = EXCLUDED.email, full_name = EXCLUDED.full_name, \
                 is_active = true, is_verified = true",
        )
        .bind(actor_id)
        .bind(format!("lgr940_actor_{actor_id}"))
        .bind(format!("lgr940-actor-{actor_id}@hotel.local"))
        .bind(format!("Ledger Char Test Actor {actor_id}"))
        .execute(pool)
        .await
        .unwrap();
    }

    /// Deletes every `customer_ledger_payments`/`audit_logs`/`customer_ledgers`
    /// row for a given `company_name` (children before parents; audit rows
    /// before the ledger row they reference is deleted). Safe to call whether
    /// or not any rows exist - used both to reset state at the start of a
    /// test (idempotency on rerun) and to clean up at the end.
    async fn cleanup_ledger_fixture(pool: &PgPool, company_name: &str) {
        sqlx::query(
            "DELETE FROM customer_ledger_payments WHERE ledger_id IN \
             (SELECT id FROM customer_ledgers WHERE company_name = $1)",
        )
        .bind(company_name)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "DELETE FROM audit_logs WHERE resource_type = 'customer_ledger' AND resource_id IN \
             (SELECT id FROM customer_ledgers WHERE company_name = $1)",
        )
        .bind(company_name)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM customer_ledgers WHERE company_name = $1")
            .bind(company_name)
            .execute(pool)
            .await
            .unwrap();
    }

    /// Deletes the single fixture `users` row created by `ensure_test_actor`.
    /// Must run only AFTER every `customer_ledgers` row that references it
    /// (`created_by`/`updated_by`/`void_by`) has already been deleted by
    /// `cleanup_ledger_fixture` for every company name the test used, or the
    /// delete is a silent no-op against a still-referenced row. Uses `.ok()`
    /// (not `.unwrap()`, mirroring `tests/payment_characterization.rs`'s
    /// `cleanup`) so a residual reference never turns fixture teardown into a
    /// test failure.
    async fn cleanup_actor(pool: &PgPool, actor_id: i64) {
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(actor_id)
            .execute(pool)
            .await
            .ok();
    }

    async fn count_audit_logs(pool: &PgPool, action: &str, resource_id: i64) -> i64 {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs \
             WHERE action = $1 AND resource_type = 'customer_ledger' AND resource_id = $2",
        )
        .bind(action)
        .bind(resource_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// A standalone (no booking/guest) customer-ledger create request with
    /// every optional field `None` except the three the caller supplies.
    /// `due_date` is a fixed future date so `create_customer_ledger` does not
    /// need to look up `companies.payment_terms_days` / `hotel_today`.
    fn standalone_ledger_request(
        company_name: &str,
        description: &str,
        amount: f64,
    ) -> CustomerLedgerCreateRequest {
        CustomerLedgerCreateRequest {
            company_name: company_name.to_string(),
            company_registration_number: None,
            contact_person: None,
            contact_email: None,
            contact_phone: None,
            billing_address_line1: None,
            billing_city: None,
            billing_state: None,
            billing_postal_code: None,
            billing_country: None,
            description: description.to_string(),
            expense_type: "miscellaneous".to_string(),
            amount,
            currency: None,
            booking_id: None,
            guest_id: None,
            invoice_date: None,
            due_date: Some("2031-01-01".to_string()),
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

    fn payment_request(amount: f64, receipt_number: &str) -> CustomerLedgerPaymentRequest {
        CustomerLedgerPaymentRequest {
            payment_amount: amount,
            payment_method: "cash".to_string(),
            payment_reference: None,
            receipt_number: Some(receipt_number.to_string()),
            receipt_file_url: None,
            notes: None,
            payment_date: None,
        }
    }

    /// All-`None` `CustomerLedgerUpdateRequest`, so each test only spells out
    /// the fields it actually changes via `..empty_ledger_update()`.
    fn empty_ledger_update() -> CustomerLedgerUpdateRequest {
        CustomerLedgerUpdateRequest {
            company_name: None,
            company_registration_number: None,
            contact_person: None,
            contact_email: None,
            contact_phone: None,
            billing_address_line1: None,
            billing_city: None,
            billing_state: None,
            billing_postal_code: None,
            billing_country: None,
            description: None,
            expense_type: None,
            amount: None,
            currency: None,
            status: None,
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

    // -----------------------------------------------------------------
    // create_ledger_payment: status recompute boundaries
    // (pending -> partial -> paid, including the `new_total_paid >= total`
    // boundary case) plus the `customer_ledger_created`/`ledger_payment_created`
    // audit rows.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_ledger_lifecycle_status_recompute_boundaries() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_100;
        let company_name = "Lgr940 Lifecycle Co";

        ensure_test_actor(&pool, actor_id).await;
        cleanup_ledger_fixture(&pool, company_name).await;

        let ledger = ledgers::create_customer_ledger(
            &pool,
            actor_id,
            standalone_ledger_request(company_name, "Lgr940 lifecycle charge", 500.0),
        )
        .await
        .expect("creating a standalone customer ledger should succeed");

        assert_eq!(ledger.amount, Decimal::new(50_000, 2));
        assert_eq!(ledger.paid_amount, Decimal::ZERO);
        assert_eq!(ledger.balance_due, Decimal::new(50_000, 2));
        assert_eq!(ledger.status, "pending");
        assert_eq!(
            count_audit_logs(&pool, "customer_ledger_created", ledger.id).await,
            1,
            "create_customer_ledger should write one audit_logs row"
        );

        ledgers::create_ledger_payment(
            &pool,
            ledger.id,
            actor_id,
            payment_request(200.0, "LGR940-RCT-100-1"),
        )
        .await
        .expect("first partial payment should succeed");

        let mid = ledgers::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(mid.paid_amount, Decimal::new(20_000, 2));
        assert_eq!(mid.balance_due, Decimal::new(30_000, 2));
        assert_eq!(mid.status, "partial", "partial boundary: 0 < paid < total");

        ledgers::create_ledger_payment(
            &pool,
            ledger.id,
            actor_id,
            payment_request(300.0, "LGR940-RCT-100-2"),
        )
        .await
        .expect("final payment exactly settling the ledger should succeed");

        let settled = ledgers::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(settled.paid_amount, Decimal::new(50_000, 2));
        assert_eq!(settled.balance_due, Decimal::ZERO);
        assert_eq!(
            settled.status, "paid",
            "paid boundary: new_total_paid >= total_amount exactly"
        );

        assert_eq!(
            count_audit_logs(&pool, "ledger_payment_created", ledger.id).await,
            2,
            "create_ledger_payment should write one audit_logs row per call"
        );

        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;
    }

    // -----------------------------------------------------------------
    // update_ledger_payment: changing an existing payment's amount re-syncs
    // the parent ledger's paid_amount/status, both downward-into-partial and
    // back up to the exact paid boundary.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_update_ledger_payment_resyncs_parent_ledger() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_101;
        let company_name = "Lgr940 UpdatePayment Co";

        ensure_test_actor(&pool, actor_id).await;
        cleanup_ledger_fixture(&pool, company_name).await;

        let ledger = ledgers::create_customer_ledger(
            &pool,
            actor_id,
            standalone_ledger_request(company_name, "Lgr940 update-payment charge", 500.0),
        )
        .await
        .expect("creating a standalone customer ledger should succeed");

        let payment1 = ledgers::create_ledger_payment(
            &pool,
            ledger.id,
            actor_id,
            payment_request(200.0, "LGR940-RCT-101-1"),
        )
        .await
        .expect("first payment should succeed");
        let payment2 = ledgers::create_ledger_payment(
            &pool,
            ledger.id,
            actor_id,
            payment_request(100.0, "LGR940-RCT-101-2"),
        )
        .await
        .expect("second payment should succeed");

        let before = ledgers::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(before.paid_amount, Decimal::new(30_000, 2));
        assert_eq!(before.status, "partial");

        // Raise payment1 200 -> 350: new total paid = 350 + 100 = 450 (still < 500).
        let updated1 = ledgers::update_ledger_payment(
            &pool,
            ledger.id,
            payment1.id,
            actor_id,
            UpdateLedgerPaymentRequest {
                payment_date: "2031-02-01".to_string(),
                payment_amount: Some(350.0),
                payment_method: None,
                payment_reference: None,
                notes: None,
            },
        )
        .await
        .expect("raising a payment amount within the outstanding balance should succeed");
        assert_eq!(updated1.payment_amount, Decimal::new(35_000, 2));

        let mid = ledgers::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(mid.paid_amount, Decimal::new(45_000, 2));
        assert_eq!(mid.status, "partial", "450 < 500 stays partial");

        // Raise payment2 100 -> 150: new total paid = 350 + 150 = 500 exactly.
        ledgers::update_ledger_payment(
            &pool,
            ledger.id,
            payment2.id,
            actor_id,
            UpdateLedgerPaymentRequest {
                payment_date: "2031-02-01".to_string(),
                payment_amount: Some(150.0),
                payment_method: None,
                payment_reference: None,
                notes: None,
            },
        )
        .await
        .expect("raising a payment to exactly settle the ledger should succeed");

        let after = ledgers::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(after.paid_amount, Decimal::new(50_000, 2));
        assert_eq!(after.status, "paid", "paid boundary reached via a payment update");

        assert_eq!(
            count_audit_logs(&pool, "ledger_payment_updated", ledger.id).await,
            2,
            "update_ledger_payment should write one audit_logs row per call"
        );

        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;
    }

    // -----------------------------------------------------------------
    // delete_ledger_payment: removing a payment re-syncs the parent ledger
    // downward, including all the way back to "pending" at zero.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_delete_ledger_payment_resyncs_parent_downward() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_102;
        let company_name = "Lgr940 DeletePayment Co";

        ensure_test_actor(&pool, actor_id).await;
        cleanup_ledger_fixture(&pool, company_name).await;

        let ledger = ledgers::create_customer_ledger(
            &pool,
            actor_id,
            standalone_ledger_request(company_name, "Lgr940 delete-payment charge", 500.0),
        )
        .await
        .expect("creating a standalone customer ledger should succeed");

        let payment1 = ledgers::create_ledger_payment(
            &pool,
            ledger.id,
            actor_id,
            payment_request(300.0, "LGR940-RCT-102-1"),
        )
        .await
        .expect("first payment should succeed");
        let payment2 = ledgers::create_ledger_payment(
            &pool,
            ledger.id,
            actor_id,
            payment_request(200.0, "LGR940-RCT-102-2"),
        )
        .await
        .expect("second payment should succeed");

        let fully_paid = ledgers::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(fully_paid.status, "paid");

        ledgers::delete_ledger_payment(&pool, ledger.id, payment2.id, actor_id)
            .await
            .expect("deleting a payment should succeed");

        let partial = ledgers::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(partial.paid_amount, Decimal::new(30_000, 2));
        assert_eq!(partial.status, "partial", "300 < 500 drops back to partial");

        ledgers::delete_ledger_payment(&pool, ledger.id, payment1.id, actor_id)
            .await
            .expect("deleting the last remaining payment should succeed");

        let empty = ledgers::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(empty.paid_amount, Decimal::ZERO);
        assert_eq!(empty.status, "pending", "zero paid boundary drops back to pending");

        assert_eq!(
            count_audit_logs(&pool, "ledger_payment_deleted", ledger.id).await,
            2,
            "delete_ledger_payment should write one audit_logs row per call"
        );

        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;
    }

    // -----------------------------------------------------------------
    // create_ledger_reversal: inserts an opposite-transaction-type sibling
    // with the original_transaction_id back-pointer and the "REVERSAL: "
    // description prefix, and refuses to reverse a reversal.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_create_ledger_reversal_sibling_and_double_reversal_refusal() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_103;
        let company_name = "Lgr940 Reversal Co";

        ensure_test_actor(&pool, actor_id).await;
        cleanup_ledger_fixture(&pool, company_name).await;

        let original = ledgers::create_customer_ledger(
            &pool,
            actor_id,
            standalone_ledger_request(company_name, "Lgr940 reversal original charge", 400.0),
        )
        .await
        .expect("creating a standalone customer ledger should succeed");
        // transaction_type was not supplied -> repository default is 'debit'.
        assert_eq!(original.transaction_type.as_deref(), Some("debit"));
        assert_eq!(original.is_reversal, Some(false));

        let reversal = ledgers::create_ledger_reversal(
            &pool,
            original.id,
            actor_id,
            LedgerReversalRequest {
                reason: "Lgr940 test reversal reason".to_string(),
                notes: None,
            },
        )
        .await
        .expect("reversing a non-reversal ledger entry should succeed");

        assert_eq!(
            reversal.transaction_type.as_deref(),
            Some("credit"),
            "reversal must carry the opposite transaction_type of the original"
        );
        assert_eq!(reversal.original_transaction_id, Some(original.id));
        assert_eq!(reversal.is_reversal, Some(true));
        assert_eq!(
            reversal.description,
            format!("REVERSAL: {}", original.description)
        );
        assert_eq!(reversal.amount, original.amount);
        // NOT an endorsement of correctness -- this is only the current
        // literal shape of the inserted row (repositories/ledger.rs:1029-1030
        // hardcodes `paid_amount = amount`, `status = 'paid'` for every
        // reversal). Combined with `get_ledger_summary` summing every
        // non-void row with no `transaction_type` sign handling, this shape
        // is exactly what makes a reversal DOUBLE reported `total_amount`
        // and INVENT collected cash instead of netting the original charge
        // to zero -- see the ignored
        // `postgres_create_ledger_reversal_nets_to_zero_in_summary` test
        // below for the decided-correct aggregate behavior.
        assert_eq!(reversal.paid_amount, original.amount);
        assert_eq!(reversal.status, "paid");
        assert_eq!(
            reversal.reversal_reason.as_deref(),
            Some("Lgr940 test reversal reason")
        );

        assert_eq!(
            count_audit_logs(&pool, "customer_ledger_reversed", original.id).await,
            1,
            "create_ledger_reversal should write one audit_logs row against the ORIGINAL ledger id"
        );

        let double_reversal = ledgers::create_ledger_reversal(
            &pool,
            reversal.id,
            actor_id,
            LedgerReversalRequest {
                reason: "Lgr940 attempted double reversal".to_string(),
                notes: None,
            },
        )
        .await;
        assert!(
            double_reversal.is_err(),
            "reversing an already-reversal entry must be refused"
        );
        assert!(
            double_reversal.unwrap_err().to_string().contains("Cannot reverse a reversal"),
            "error message should explain why the reversal was refused"
        );

        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;
    }

    // -----------------------------------------------------------------
    // DECIDED-CORRECT, NOT YET IMPLEMENTED: get_ledger_summary must NET a
    // reversal against its original entry rather than double-count it.
    // repositories/ledger.rs:896-908 sums amount/paid_amount/balance_due
    // over every non-void row with NO transaction_type sign handling
    // (confirmed: `transaction_type` never appears in that query), so today
    // reversing a 400.00 debit DOUBLES reported total_amount to 800.00 and
    // INVENTS 400.00 of collected cash instead of cancelling the charge --
    // do not assert that as correct. Compares deltas against a baseline
    // summary call rather than absolute totals because get_ledger_summary
    // aggregates the whole (shared, persistent) customer_ledgers table, not
    // just this fixture's rows.
    // -----------------------------------------------------------------
    #[tokio::test]
    #[ignore = "get_ledger_summary sums amount/paid_amount/balance_due over all non-void rows with no transaction_type sign handling, so a reversal doubles total_amount and invents collected cash instead of netting to zero — pending fix: make get_ledger_summary sign-aware for reversal pairs"]
    async fn postgres_create_ledger_reversal_nets_to_zero_in_summary() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_108;
        let company_name = "Lgr940 ReversalNet Co";

        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;
        ensure_test_actor(&pool, actor_id).await;

        let baseline = ledgers::get_ledger_summary(&pool)
            .await
            .expect("get_ledger_summary should succeed");
        let baseline_amount =
            Decimal::from_str(baseline["total_amount"].as_str().unwrap()).unwrap();
        let baseline_paid = Decimal::from_str(baseline["total_paid"].as_str().unwrap()).unwrap();
        let baseline_outstanding =
            Decimal::from_str(baseline["total_outstanding"].as_str().unwrap()).unwrap();

        let original = ledgers::create_customer_ledger(
            &pool,
            actor_id,
            standalone_ledger_request(company_name, "Lgr940 reversal-net original charge", 400.0),
        )
        .await
        .expect("creating a standalone customer ledger should succeed");

        ledgers::create_ledger_reversal(
            &pool,
            original.id,
            actor_id,
            LedgerReversalRequest {
                reason: "Lgr940 reversal-net test reason".to_string(),
                notes: None,
            },
        )
        .await
        .expect("reversing a non-reversal ledger entry should succeed");

        let after = ledgers::get_ledger_summary(&pool)
            .await
            .expect("get_ledger_summary should succeed");
        let after_amount = Decimal::from_str(after["total_amount"].as_str().unwrap()).unwrap();
        let after_paid = Decimal::from_str(after["total_paid"].as_str().unwrap()).unwrap();
        let after_outstanding =
            Decimal::from_str(after["total_outstanding"].as_str().unwrap()).unwrap();

        // Clean up BEFORE asserting: this test is expected to fail (that is
        // the point of `#[ignore]`ing a known bug), and an assertion panic
        // must not skip teardown and leak fixture rows on a persistent,
        // shared database.
        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;

        assert_eq!(
            after_amount, baseline_amount,
            "a fully reversed charge must not change total_amount: baseline {baseline_amount}, got {after_amount}"
        );
        assert_eq!(
            after_paid, baseline_paid,
            "a self-paid reversal must not invent collected cash: baseline {baseline_paid}, got {after_paid}"
        );
        assert_eq!(
            after_outstanding, baseline_outstanding,
            "a fully reversed charge must leave outstanding balance unchanged: baseline {baseline_outstanding}, got {after_outstanding}"
        );
    }

    // -----------------------------------------------------------------
    // void_ledger: stamps void_at/void_by/void_reason and refuses a double
    // void, on a ledger with zero payments collected (correct, unambiguous
    // behavior today - the paid_amount > 0 case is covered separately below
    // as an #[ignore]d, decided-correct-but-not-yet-implemented scenario).
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_void_ledger_stamps_fields_and_refuses_double_void() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_104;
        let company_name = "Lgr940 Void Co";

        ensure_test_actor(&pool, actor_id).await;
        cleanup_ledger_fixture(&pool, company_name).await;

        let ledger = ledgers::create_customer_ledger(
            &pool,
            actor_id,
            standalone_ledger_request(company_name, "Lgr940 void charge", 250.0),
        )
        .await
        .expect("creating a standalone customer ledger should succeed");
        assert_eq!(ledger.paid_amount, Decimal::ZERO);

        let before_void = Utc::now();
        let voided = ledgers::void_ledger(
            &pool,
            ledger.id,
            actor_id,
            LedgerVoidRequest {
                reason: "Lgr940 void test reason".to_string(),
            },
        )
        .await
        .expect("voiding an unpaid, non-voided ledger should succeed");

        assert_eq!(voided.status, "void");
        assert_eq!(voided.void_by, Some(actor_id));
        assert_eq!(voided.void_reason.as_deref(), Some("Lgr940 void test reason"));
        let void_at = voided.void_at.expect("void_at should be stamped");
        assert!(
            void_at >= before_void && (Utc::now() - void_at).num_minutes() < 5,
            "void_at should decode as a sane, recent UTC instant, got {void_at:?}"
        );

        assert_eq!(
            count_audit_logs(&pool, "customer_ledger_voided", ledger.id).await,
            1,
            "void_ledger should write one audit_logs row"
        );

        let double_void = ledgers::void_ledger(
            &pool,
            ledger.id,
            actor_id,
            LedgerVoidRequest {
                reason: "Lgr940 attempted double void".to_string(),
            },
        )
        .await;
        assert!(double_void.is_err(), "voiding an already-voided ledger must be refused");
        assert!(
            double_void.unwrap_err().to_string().contains("already voided"),
            "error message should explain why the void was refused"
        );

        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;
    }

    // -----------------------------------------------------------------
    // update_customer_ledger: ordinary field edits apply, updated_by is
    // stamped, and a request with no fields set is rejected.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_update_customer_ledger_ordinary_field_edits() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_105;
        let original_company_name = "Lgr940 Update Co";
        let renamed_company_name = "Lgr940 Update Co Renamed";

        ensure_test_actor(&pool, actor_id).await;
        cleanup_ledger_fixture(&pool, original_company_name).await;
        cleanup_ledger_fixture(&pool, renamed_company_name).await;

        let ledger = ledgers::create_customer_ledger(
            &pool,
            actor_id,
            standalone_ledger_request(original_company_name, "Lgr940 original desc", 100.0),
        )
        .await
        .expect("creating a standalone customer ledger should succeed");

        let updated = ledgers::update_customer_ledger(
            &pool,
            ledger.id,
            actor_id,
            CustomerLedgerUpdateRequest {
                company_name: Some(renamed_company_name.to_string()),
                description: Some("Lgr940 updated desc".to_string()),
                notes: Some("Lgr940 updated notes".to_string()),
                amount: Some(150.0),
                ..empty_ledger_update()
            },
        )
        .await
        .expect("an ordinary field-edit update should succeed");

        assert_eq!(updated.company_name, renamed_company_name);
        assert_eq!(updated.description, "Lgr940 updated desc");
        assert_eq!(updated.notes.as_deref(), Some("Lgr940 updated notes"));
        assert_eq!(updated.amount, Decimal::new(15_000, 2));
        assert_eq!(updated.updated_by, Some(actor_id));
        assert_eq!(
            updated.status, "pending",
            "editing unrelated fields must not change status"
        );

        assert_eq!(
            count_audit_logs(&pool, "customer_ledger_updated", ledger.id).await,
            1,
            "update_customer_ledger should write one audit_logs row"
        );

        cleanup_ledger_fixture(&pool, original_company_name).await;
        cleanup_ledger_fixture(&pool, renamed_company_name).await;
        cleanup_actor(&pool, actor_id).await;
    }

    // -----------------------------------------------------------------
    // update_customer_ledger: an all-`None` request must be REFUSED.
    // The "No fields to update" guard (`if updates.len() < 2`) can never fire,
    // because `updated_by`/`updated_at` are pushed onto `updates`
    // unconditionally BEFORE the check — so an empty request silently succeeds
    // and touches only updated_by/updated_at. Asserts the decided-correct
    // behavior, not today's.
    // -----------------------------------------------------------------
    #[tokio::test]
    #[ignore = "update_customer_ledger's empty-request guard is dead: updated_by/updated_at are pushed onto `updates` before the `updates.len() < 2` check, so an all-None request silently succeeds instead of being refused — pending fix: move the guard above the unconditional pushes (spawned task: Fix dead no-op guard in update_customer_ledger)"]
    async fn postgres_update_customer_ledger_refuses_an_empty_request() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_110;
        let company_name = "Lgr940 EmptyUpdate Co";

        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;
        ensure_test_actor(&pool, actor_id).await;

        let ledger = ledgers::create_customer_ledger(
            &pool,
            actor_id,
            standalone_ledger_request(company_name, "Lgr940 empty-update charge", 100.0),
        )
        .await
        .expect("creating a standalone customer ledger should succeed");

        let empty_update =
            ledgers::update_customer_ledger(&pool, ledger.id, actor_id, empty_ledger_update())
                .await;
        let audit_rows = count_audit_logs(&pool, "customer_ledger_updated", ledger.id).await;

        // Clean up BEFORE asserting: these assertions are expected to panic
        // until the fix lands, and a panic must not leak fixtures into the
        // shared, persistent dev database.
        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;

        let err = empty_update.expect_err(
            "an update request with every field None must be refused, not silently applied",
        );
        assert!(
            err.to_string().contains("No fields to update"),
            "the rejection should say no fields were supplied, got: {err}"
        );
        assert_eq!(
            audit_rows, 0,
            "a refused empty update must not write an audit_logs row"
        );
    }

    // -----------------------------------------------------------------
    // update_customer_ledger: the ledger accounting fields must actually
    // persist. Every one of these was accepted by the API and then silently
    // discarded — no SET clause, no bind, no error — so a client PATCHing
    // tax_amount got a 200 and an unchanged row (silent money loss).
    //
    // Also pins the derived `net_amount`: it is populated only by the
    // `generate_folio_number` BEFORE INSERT trigger, so without an explicit
    // recompute in the UPDATE it keeps its creation-time value and drifts away
    // from amount/tax_amount/service_charge.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_update_customer_ledger_persists_accounting_fields() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_109;
        let company_name = "Lgr940 AccountingFields Co";

        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;
        ensure_test_actor(&pool, actor_id).await;

        let ledger = ledgers::create_customer_ledger(
            &pool,
            actor_id,
            CustomerLedgerCreateRequest {
                tax_amount: Some(10.0),
                service_charge: Some(5.0),
                ..standalone_ledger_request(company_name, "Lgr940 accounting charge", 200.0)
            },
        )
        .await
        .expect("creating a standalone customer ledger should succeed");

        // Every service call runs FIRST and its result is captured as plain
        // data; cleanup happens before any assertion, because the accounting
        // assertions below are expected to panic until the fix lands and a
        // panic must not leak fixtures into the shared, persistent dev DB.
        let baseline_net_amount = ledger.net_amount;

        let updated = ledgers::update_customer_ledger(
            &pool,
            ledger.id,
            actor_id,
            CustomerLedgerUpdateRequest {
                post_type: Some("laundry".to_string()),
                department_code: Some("HK".to_string()),
                transaction_code: Some("TXN-940-109".to_string()),
                room_number: Some("1204".to_string()),
                reference_number: Some("REF-940-109".to_string()),
                tax_amount: Some(20.0),
                service_charge: Some(8.0),
                ..empty_ledger_update()
            },
        )
        .await
        .expect("updating the ledger accounting fields should succeed");

        // Changing ONLY `amount` must also recompute net_amount, using the
        // tax/service values already stored on the row (20 and 8). This is the
        // case where the derived clause reads the untouched columns' old
        // values rather than a bound parameter.
        let reamounted = ledgers::update_customer_ledger(
            &pool,
            ledger.id,
            actor_id,
            CustomerLedgerUpdateRequest {
                amount: Some(300.0),
                ..empty_ledger_update()
            },
        )
        .await
        .expect("updating only the amount should succeed");

        // An unrelated edit must NOT disturb the derived total.
        let renamed = ledgers::update_customer_ledger(
            &pool,
            ledger.id,
            actor_id,
            CustomerLedgerUpdateRequest {
                notes: Some("Lgr940 accounting notes".to_string()),
                ..empty_ledger_update()
            },
        )
        .await
        .expect("editing notes should succeed");

        // `post_type` is constrained by the `valid_post_type` CHECK; an unknown
        // value must be a 400 from the service layer, not a database 500.
        let bad_post_type = ledgers::update_customer_ledger(
            &pool,
            ledger.id,
            actor_id,
            CustomerLedgerUpdateRequest {
                post_type: Some("not_a_real_post_type".to_string()),
                ..empty_ledger_update()
            },
        )
        .await;

        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;

        // Baseline: the BEFORE INSERT trigger computed net_amount = 200 - 10 - 5.
        assert_eq!(
            baseline_net_amount,
            Some(Decimal::new(18_500, 2)),
            "the BEFORE INSERT trigger should seed net_amount from amount/tax/service"
        );

        // These are the fields update_customer_ledger accepts and silently
        // discards today — no SET clause, no bind, no error.
        assert_eq!(updated.post_type.as_deref(), Some("laundry"));
        assert_eq!(updated.department_code.as_deref(), Some("HK"));
        assert_eq!(updated.transaction_code.as_deref(), Some("TXN-940-109"));
        assert_eq!(updated.room_number.as_deref(), Some("1204"));
        assert_eq!(updated.reference_number.as_deref(), Some("REF-940-109"));
        assert_eq!(
            updated.tax_amount,
            Some(Decimal::new(2_000, 2)),
            "tax_amount is a money field and must not be silently discarded"
        );
        assert_eq!(
            updated.service_charge,
            Some(Decimal::new(800, 2)),
            "service_charge is a money field and must not be silently discarded"
        );
        assert_eq!(
            updated.net_amount,
            Some(Decimal::new(17_200, 2)),
            "net_amount must be recomputed as 200 - 20 - 8 when tax/service change"
        );

        assert_eq!(reamounted.amount, Decimal::new(30_000, 2));
        assert_eq!(
            reamounted.tax_amount,
            Some(Decimal::new(2_000, 2)),
            "an amount-only update must leave tax_amount untouched"
        );
        assert_eq!(
            reamounted.net_amount,
            Some(Decimal::new(27_200, 2)),
            "net_amount must be recomputed as 300 - 20 - 8 when only amount changes"
        );

        assert_eq!(
            renamed.net_amount,
            Some(Decimal::new(27_200, 2)),
            "an edit that touches none of amount/tax/service must leave net_amount alone"
        );

        let err = bad_post_type
            .expect_err("an unknown post_type must be rejected rather than hitting the CHECK");
        assert!(
            matches!(err, ApiError::BadRequest(_)),
            "an unknown post_type should be a 400 BadRequest, got: {err:?}"
        );
    }

    // -----------------------------------------------------------------
    // DECIDED-CORRECT, NOT YET IMPLEMENTED: void_ledger must refuse to void
    // a ledger that has collected payments (paid_amount > 0), because
    // get_ledger_summary excludes void rows entirely and the collected money
    // would otherwise vanish from all outstanding/collected totals.
    // Currently void_ledger (repositories/ledger.rs:935) does not check
    // paid_amount at all and will happily void a partially/fully paid ledger
    // -- do not assert that as correct. See docs/ongoing-dev.md task #19
    // "Block voiding a ledger that has collected payments".
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_void_ledger_refuses_when_paid_amount_positive() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_106;
        let company_name = "Lgr940 VoidPaid Co";

        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;
        ensure_test_actor(&pool, actor_id).await;

        let ledger = ledgers::create_customer_ledger(
            &pool,
            actor_id,
            standalone_ledger_request(company_name, "Lgr940 void-paid charge", 500.0),
        )
        .await
        .expect("creating a standalone customer ledger should succeed");

        ledgers::create_ledger_payment(
            &pool,
            ledger.id,
            actor_id,
            payment_request(100.0, "LGR940-RCT-106-1"),
        )
        .await
        .expect("partial payment should succeed");

        let result = ledgers::void_ledger(
            &pool,
            ledger.id,
            actor_id,
            LedgerVoidRequest {
                reason: "Lgr940 attempted void of a paid ledger".to_string(),
            },
        )
        .await;

        // Clean up BEFORE asserting: this test is expected to fail (that is
        // the point of `#[ignore]`ing a known bug), and an assertion panic
        // must not skip teardown and leak fixture rows on a persistent,
        // shared database.
        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;

        let err = result.expect_err(
            "voiding a ledger with paid_amount > 0 must be refused so collected money \
             cannot disappear from get_ledger_summary",
        );
        assert!(
            err.to_string().to_lowercase().contains("paid"),
            "error message should explain the void was refused because payments were already collected: {err}"
        );
    }

    // -----------------------------------------------------------------
    // DECIDED-CORRECT, NOT YET IMPLEMENTED: update_customer_ledger (gated at
    // the route layer by `ledgers:update`, not `ledgers:void`) must refuse a
    // request that sets status = 'void', because that path never stamps
    // void_at/void_by/void_reason. Currently
    // update_customer_ledger (repositories/ledger.rs:479) applies status
    // unconditionally -- do not assert that as correct. See
    // docs/ongoing-dev.md task #11 "Stop update_customer_ledger from voiding
    // without the void permission".
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_update_customer_ledger_refuses_status_void() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_107;
        let company_name = "Lgr940 UpdateVoid Co";

        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;
        ensure_test_actor(&pool, actor_id).await;

        let ledger = ledgers::create_customer_ledger(
            &pool,
            actor_id,
            standalone_ledger_request(company_name, "Lgr940 update-void charge", 300.0),
        )
        .await
        .expect("creating a standalone customer ledger should succeed");

        let result = ledgers::update_customer_ledger(
            &pool,
            ledger.id,
            actor_id,
            CustomerLedgerUpdateRequest {
                status: Some("void".to_string()),
                ..empty_ledger_update()
            },
        )
        .await;

        // Clean up BEFORE asserting: this test is expected to fail (that is
        // the point of `#[ignore]`ing a known bug), and an assertion panic
        // must not skip teardown and leak fixture rows on a persistent,
        // shared database.
        cleanup_ledger_fixture(&pool, company_name).await;
        cleanup_actor(&pool, actor_id).await;

        assert!(
            result.is_err(),
            "update_customer_ledger must refuse status='void' - only void_ledger may void, \
             and only after stamping void_at/void_by/void_reason"
        );
    }
}
