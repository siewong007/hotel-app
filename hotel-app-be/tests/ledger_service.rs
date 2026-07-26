//! Integration tests for the ledger domain (customer ledgers + city/company
//! ledger auto-posting from bookings) and companies.
//!
//! These are the money paths: nothing in this repo previously fetched a
//! `customer_ledgers`/`customer_ledger_payments` row in a test, and two
//! sqlx decode-type bugs shipped straight through `cargo check`/clippy/the
//! full test suite as a result (see `.claude/rules/lessons.md` 2026-07-26d
//! and 2026-07-26o). Every test here that reads a ledger/payment row back
//! out via `services::ledgers` exercises the real `FromRow` decode of
//! `created_at`/`due_date` etc., not just the write path.
//!
//! Business logic lives in `src/repositories/ledger.rs` (`services::ledgers`
//! is a thin passthrough) and in the company-billing auto-post + delta-sync
//! blocks of `update_booking_handler` in
//! `src/repositories/bookings/lifecycle.rs`. See `.claude/refs/ledger-workflow.md`.
//!
//! Requires `DATABASE_URL` (PostgreSQL); tests skip gracefully without it,
//! the same convention as `tests/booking_service.rs` / `tests/invoice_numbering.rs`.
//!
//! Fixture IDs live in the 910_xxx range (checked free against tests/*.rs
//! before writing this file): users 910_0xx, bookings 910_1xx, guests
//! 910_2xx, rooms 910_3xx, room_types 910_4xx, companies 910_5xx. String
//! uniques are prefixed "Lgr910"/"lgr910".
//!
//! While writing the void-booking test we found that `void_booking`
//! (`src/services/bookings.rs`) never touches `customer_ledgers` at all: a
//! company-billed booking's auto-posted city-ledger row is left exactly as
//! it was (still `pending`, `void_at` still NULL) after the booking itself
//! is voided. The test below asserts that CURRENT behavior rather than
//! inventing a void-propagation policy that doesn't exist in the code --
//! see the report back to the caller for the product-gap flag. Separately,
//! `.claude/refs/ledger-workflow.md` line 23 claims `void_ledger` "stamps
//! ... status `cancelled`"; the actual code (ledger.rs:961) sets
//! `status = 'void'` (a distinct value in the `valid_status` CHECK
//! constraint) -- a stale doc anchor, not exercised by these tests since
//! they don't call `void_ledger` itself.

fn pg_serial_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

mod postgres_tests {
    use axum::Json;
    use axum::extract::{Extension, Path, State};
    use chrono::{Duration, NaiveDate, Utc};
    use hotel_app_be::core::db::hotel_today;
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::{
        BookingUpdateInput, CompanyCreateRequest, CompanyUpdateRequest,
        CustomerLedgerCreateRequest, CustomerLedgerPaymentRequest,
    };
    use hotel_app_be::services::{bookings, companies, ledgers};
    use rust_decimal::Decimal;
    use sqlx::{PgPool, postgres::PgPoolOptions};

    async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping PostgreSQL ledger-service test because DATABASE_URL is not set");
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

    /// All-`None` `BookingUpdateInput`, so each test only spells out the
    /// fields it actually changes via `..empty_booking_update()`.
    fn empty_booking_update() -> BookingUpdateInput {
        BookingUpdateInput {
            room_id: None,
            check_in_date: None,
            check_out_date: None,
            actual_check_out: None,
            total_amount: None,
            status: None,
            payment_status: None,
            post_type: None,
            rate_code: None,
            is_tourist: None,
            tourism_tax_amount: None,
            extra_bed_count: None,
            extra_bed_charge: None,
            late_checkout_penalty: None,
            payment_method: None,
            market_code: None,
            discount_percentage: None,
            rate_override_weekday: None,
            rate_override_weekend: None,
            check_in_time: None,
            check_out_time: None,
            deposit_paid: None,
            deposit_amount: None,
            company_id: None,
            company_name: None,
            clear_company: None,
            payment_note: None,
            remarks: None,
            special_requests: None,
            source: None,
            booking_channel_id: None,
            ota_reference: None,
            room_rate_override: None,
            daily_rates: None,
            cleaning_preference: None,
        }
    }

    /// Upserts a shared test actor with `bookings:update`/`bookings:manage`
    /// granted via the (repo-wide, idempotently-created) 'admin' role --
    /// mirrors `ensure_admin_actor` in `tests/booking_service.rs`.
    /// `update_booking_handler` and `void_booking` check these permissions
    /// internally; `services::ledgers`/`services::companies` do not (RBAC
    /// for those domains is gated at the routes layer, not exercised here).
    async fn ensure_test_actor(pool: &PgPool, actor_id: i64) {
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
             ('bookings:manage', 'bookings', 'manage', 'Manage bookings', true) \
             ON CONFLICT (name) DO NOTHING",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id) \
             SELECT r.id, p.id FROM roles r CROSS JOIN permissions p \
             WHERE r.name = 'admin' AND p.name IN ('bookings:update', 'bookings:manage') \
             ON CONFLICT DO NOTHING",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'staff', true, true) \
             ON CONFLICT (id) DO UPDATE SET \
                 username = EXCLUDED.username, email = EXCLUDED.email, full_name = EXCLUDED.full_name, \
                 is_active = true, is_verified = true",
        )
        .bind(actor_id)
        .bind(format!("lgr910_actor_{actor_id}"))
        .bind(format!("lgr910-actor-{actor_id}@hotel.local"))
        .bind(format!("Ledger Test Actor {actor_id}"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) \
             SELECT $1, id FROM roles WHERE name = 'admin' ON CONFLICT DO NOTHING",
        )
        .bind(actor_id)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Deletes every `customer_ledgers`/`customer_ledger_payments` row for a
    /// given `company_name` (children before parent). Safe to call whether
    /// or not any rows exist.
    async fn cleanup_ledgers_by_company(pool: &PgPool, company_name: &str) {
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

    /// Seeds a single company-billed, confirmed booking (room/room-type/guest
    /// included). Upsert-reset so reruns against a persistent dev DB are
    /// deterministic regardless of a prior run's leftover status/actual_check_out.
    /// Fixture ids and stay details for a company-billed booking.
    ///
    /// Deliberately no `Default`: every field must be stated at the call site
    /// so a forgotten id cannot silently become 0.
    struct CompanyBilledBookingFixture<'a> {
        actor_id: i64,
        booking_id: i64,
        guest_id: i64,
        room_id: i64,
        room_type_id: i64,
        company_name: &'a str,
        room_rate: Decimal,
        nights: i64,
        check_in: NaiveDate,
        check_out: NaiveDate,
    }

    async fn seed_company_billed_booking(pool: &PgPool, fixture: CompanyBilledBookingFixture<'_>) {
        let CompanyBilledBookingFixture {
            actor_id,
            booking_id,
            guest_id,
            room_id,
            room_type_id,
            company_name,
            room_rate,
            nights,
            check_in,
            check_out,
        } = fixture;
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 2) \
             ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, base_price = EXCLUDED.base_price",
        )
        .bind(room_type_id)
        .bind(format!("LGR{room_type_id}"))
        .bind(format!("Ledger Test Room Type {room_type_id}"))
        .bind(room_rate)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'reserved') \
             ON CONFLICT (id) DO UPDATE SET room_number = EXCLUDED.room_number, room_type_id = EXCLUDED.room_type_id, status = 'reserved'",
        )
        .bind(room_id)
        .bind(format!("LGR{room_id}"))
        .bind(room_type_id)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO guests (id, full_name, first_name, last_name, email) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Ledger', $3, $4) \
             ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name",
        )
        .bind(guest_id)
        .bind(format!("Ledger Test Guest {guest_id}"))
        .bind(format!("Guest{guest_id}"))
        .bind(format!("lgr910-guest-{guest_id}@hotel.local"))
        .execute(pool)
        .await
        .unwrap();

        let subtotal = room_rate * Decimal::from(nights);
        sqlx::query(
            "INSERT INTO bookings (
                id, booking_number, guest_id, guest_name, guest_email, room_id,
                check_in_date, check_out_date, adults, children,
                room_rate, subtotal, total_amount, status, payment_status,
                company_name, created_by
             )
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 0,
                     $9, $10, $10, 'confirmed', 'unpaid', $11, $12)
             ON CONFLICT (id) DO UPDATE SET
                 booking_number = EXCLUDED.booking_number,
                 guest_id = EXCLUDED.guest_id,
                 room_id = EXCLUDED.room_id,
                 check_in_date = EXCLUDED.check_in_date,
                 check_out_date = EXCLUDED.check_out_date,
                 room_rate = EXCLUDED.room_rate,
                 subtotal = EXCLUDED.subtotal,
                 total_amount = EXCLUDED.total_amount,
                 status = 'confirmed',
                 payment_status = 'unpaid',
                 company_name = EXCLUDED.company_name,
                 company_id = NULL,
                 actual_check_out = NULL,
                 created_by = EXCLUDED.created_by",
        )
        .bind(booking_id)
        .bind(format!("BK-LGR-{booking_id}"))
        .bind(guest_id)
        .bind(format!("Ledger Test Guest {guest_id}"))
        .bind(format!("lgr910-guest-{guest_id}@hotel.local"))
        .bind(room_id)
        .bind(check_in)
        .bind(check_out)
        .bind(room_rate)
        .bind(subtotal)
        .bind(company_name)
        .bind(actor_id)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Children before parents; `room_status_change_log` has no `ON DELETE`
    /// clause on its `room_id` FK (see `.claude/rules/lessons.md` 2026-07-26e)
    /// so it must be cleared explicitly before deleting the room.
    async fn cleanup_booking_fixture(
        pool: &PgPool,
        booking_id: i64,
        guest_id: i64,
        room_id: i64,
        room_type_id: i64,
        company_name: &str,
    ) {
        cleanup_ledgers_by_company(pool, company_name).await;
        sqlx::query(
            "DELETE FROM customer_ledger_payments WHERE ledger_id IN \
             (SELECT id FROM customer_ledgers WHERE booking_id = $1)",
        )
        .bind(booking_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM customer_ledgers WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM payments WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM booking_modifications WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM booking_history WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM bookings WHERE id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .unwrap();
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
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(room_type_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn fetch_room_charge_ledger_id(pool: &PgPool, booking_id: i64) -> i64 {
        sqlx::query_scalar(
            "SELECT id FROM customer_ledgers \
             WHERE booking_id = $1 AND post_type = 'room_charge' AND COALESCE(is_reversal, false) = false \
             ORDER BY id DESC LIMIT 1",
        )
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .expect("auto-posted room_charge ledger row should exist for this booking")
    }

    // -----------------------------------------------------------------
    // Scenarios 1 + 4: checkout auto-posts a company/city-ledger row, then
    // a later total-amount edit propagates as a delta (not a raw overwrite).
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_checkout_auto_posts_company_ledger_and_syncs_total_delta() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 910_001;
        let room_type_id = 910_401;
        let room_id = 910_301;
        let guest_id = 910_201;
        let booking_id = 910_101;
        let company_id = 910_501;
        let company_name = "Lgr910 Auto Post Co";

        ensure_test_actor(&pool, actor_id).await;
        sqlx::query("DELETE FROM companies WHERE id = $1 OR company_name = $2")
            .bind(company_id)
            .bind(company_name)
            .execute(&pool)
            .await
            .unwrap();
        cleanup_booking_fixture(&pool, booking_id, guest_id, room_id, room_type_id, company_name).await;

        sqlx::query(
            "INSERT INTO companies (id, company_name, is_active, payment_terms_days, created_by) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, true, 45, $3) \
             ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name, payment_terms_days = 45, is_active = true",
        )
        .bind(company_id)
        .bind(company_name)
        .bind(actor_id)
        .execute(&pool)
        .await
        .unwrap();

        let check_in = NaiveDate::from_ymd_opt(2031, 2, 10).unwrap();
        let check_out = NaiveDate::from_ymd_opt(2031, 2, 12).unwrap();
        seed_company_billed_booking(
            &pool,
            CompanyBilledBookingFixture {
                actor_id,
                booking_id,
                guest_id,
                room_id,
                room_type_id,
                company_name,
                room_rate: Decimal::new(10_000, 2),
                nights: // 100.00/night
                2,
                check_in,
                check_out,
            },
        )
        .await;

        // --- Scenario 1: checkout auto-posts a company/city-ledger row ---
        let Json(booking_after_checkout) = bookings::update_booking_handler(
            State(pool.clone()),
            Extension(actor_id),
            Path(booking_id),
            Json(BookingUpdateInput {
                status: Some("checked_out".to_string()),
                ..empty_booking_update()
            }),
        )
        .await
        .expect("checkout transition should succeed for a company-billed booking");
        assert_eq!(booking_after_checkout.status, "checked_out");
        assert_eq!(booking_after_checkout.total_amount, Decimal::new(20_000, 2));

        let ledger_id = fetch_room_charge_ledger_id(&pool, booking_id).await;
        let ledger = ledgers::get_customer_ledger(&pool, ledger_id)
            .await
            .expect("auto-posted ledger row should be fetchable through the service layer");

        let expected_due_date = hotel_today(&pool).await.unwrap() + Duration::days(45);
        assert_eq!(
            ledger.amount,
            Decimal::new(20_000, 2),
            "amount should mirror the booking's total_amount at the moment of checkout"
        );
        assert_eq!(ledger.status, "pending");
        assert_eq!(ledger.paid_amount, Decimal::ZERO);
        assert_eq!(
            ledger.due_date,
            Some(expected_due_date),
            "due_date should resolve from the billed company's payment_terms_days (45), not the global default"
        );
        assert_eq!(ledger.folio_type.as_deref(), Some("city_ledger"));
        assert_eq!(ledger.transaction_type.as_deref(), Some("debit"));
        assert_eq!(ledger.post_type.as_deref(), Some("room_charge"));
        assert_eq!(ledger.company_name, company_name);
        assert_eq!(ledger.booking_id, Some(booking_id));

        // Post a manual extra charge (amount += 50.00) so the ledger amount
        // (250.00) diverges from the booking total (200.00). After the +100.00
        // booking edit below, delta semantics yield 350.00 while a
        // recompute-from-booking-total would yield 300.00 — without this the
        // two implementations are numerically indistinguishable
        // (adversarial-review finding, 2026-07-26).
        sqlx::query("UPDATE customer_ledgers SET amount = amount + 50.00 WHERE id = $1")
            .bind(ledger_id)
            .execute(&pool)
            .await
            .unwrap();

        // --- Scenario 4: a later total-amount change propagates as a delta ---
        let Json(booking_after_rate_change) = bookings::update_booking_handler(
            State(pool.clone()),
            Extension(actor_id),
            Path(booking_id),
            Json(BookingUpdateInput {
                room_rate_override: Some(150.0),
                ..empty_booking_update()
            }),
        )
        .await
        .expect("a rate-override edit after checkout should still succeed");
        assert_eq!(booking_after_rate_change.total_amount, Decimal::new(30_000, 2));

        let ledger_after_delta = ledgers::get_customer_ledger(&pool, ledger_id)
            .await
            .expect("ledger row should still exist after the booking edit");
        assert_eq!(
            ledger_after_delta.amount,
            Decimal::new(35_000, 2),
            "ledger amount should apply the total_amount delta (250.00 + 100.00 -> 350.00); a recompute from the booking total would give 300.00"
        );
        assert_eq!(
            ledger_after_delta.paid_amount,
            Decimal::ZERO,
            "delta sync must never touch paid_amount"
        );
        assert_eq!(ledger_after_delta.balance_due, Decimal::new(35_000, 2));

        cleanup_booking_fixture(&pool, booking_id, guest_id, room_id, room_type_id, company_name).await;
        sqlx::query("DELETE FROM companies WHERE id = $1")
            .bind(company_id)
            .execute(&pool)
            .await
            .unwrap();
    }

    // -----------------------------------------------------------------
    // Scenario 3: voiding a booking currently leaves its auto-posted ledger
    // row completely untouched -- documents CURRENT behavior (see the file
    // doc comment above); this is not an assertion of intended policy.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_void_booking_leaves_auto_posted_ledger_row_untouched() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 910_001;
        let room_type_id = 910_402;
        let room_id = 910_302;
        let guest_id = 910_202;
        let booking_id = 910_102;
        let company_name = "Lgr910 Void Co";

        ensure_test_actor(&pool, actor_id).await;
        cleanup_booking_fixture(&pool, booking_id, guest_id, room_id, room_type_id, company_name).await;

        let check_in = NaiveDate::from_ymd_opt(2031, 3, 10).unwrap();
        let check_out = NaiveDate::from_ymd_opt(2031, 3, 11).unwrap();
        seed_company_billed_booking(
            &pool,
            CompanyBilledBookingFixture {
                actor_id,
                booking_id,
                guest_id,
                room_id,
                room_type_id,
                company_name,
                room_rate: Decimal::new(12_000, 2),
                nights: // 120.00/night
                1,
                check_in,
                check_out,
            },
        )
        .await;

let Json(_) = bookings::update_booking_handler(
            State(pool.clone()),
            Extension(actor_id),
            Path(booking_id),
            Json(BookingUpdateInput {
                status: Some("checked_out".to_string()),
                ..empty_booking_update()
            }),
        )
        .await
        .expect("checkout transition should succeed");

        let ledger_id = fetch_room_charge_ledger_id(&pool, booking_id).await;
        let before = ledgers::get_customer_ledger(&pool, ledger_id)
            .await
            .expect("ledger row should exist before voiding");

        bookings::void_booking(&pool, actor_id, booking_id, Some("Lgr910 test void".to_string()))
            .await
            .expect("voiding a checked-out, company-billed booking should succeed");

        let booking_status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(booking_status, "voided");

        let after = ledgers::get_customer_ledger(&pool, ledger_id)
            .await
            .expect("ledger row must still exist -- void_booking has no ledger-side effect today");
        assert_eq!(
            after.status, before.status,
            "current behavior: void_booking does not cancel/void the associated ledger row"
        );
        assert_eq!(after.amount, before.amount);
        assert_eq!(after.paid_amount, before.paid_amount);
        assert_eq!(
            after.void_at, None,
            "void_booking never sets customer_ledgers.void_at -- the receivable stays open"
        );
        assert_eq!(
            after.booking_id,
            Some(booking_id),
            "customer_ledgers.booking_id is left pointing at the now-voided booking"
        );

        cleanup_booking_fixture(&pool, booking_id, guest_id, room_id, room_type_id, company_name).await;
    }

    // -----------------------------------------------------------------
    // Scenarios 2 + 5: ledger payments reduce the outstanding balance with
    // exact Decimal math, and fetched ledger/payment rows decode their
    // TIMESTAMPTZ created_at columns cleanly (regression for 2026-07-26d/o).
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_ledger_payments_reduce_balance_with_exact_decimal_math() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 910_001;
        let company_name = "Lgr910 Payment Test Co";

        ensure_test_actor(&pool, actor_id).await;
        cleanup_ledgers_by_company(&pool, company_name).await;

        let ledger = ledgers::create_customer_ledger(
            &pool,
            actor_id,
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
                description: "Lgr910 payment test charge".to_string(),
                expense_type: "miscellaneous".to_string(),
                amount: 500.0,
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
            },
        )
        .await
        .expect("creating a standalone customer ledger should succeed");

        assert_eq!(ledger.amount, Decimal::new(50_000, 2));
        assert_eq!(ledger.paid_amount, Decimal::ZERO);
        assert_eq!(ledger.balance_due, Decimal::new(50_000, 2));
        assert_eq!(ledger.status, "pending");
        let now = Utc::now();
        assert!(
            ledger.created_at <= now && (now - ledger.created_at).num_minutes() < 5,
            "created_at should decode as a sane, recent UTC instant, got {:?}",
            ledger.created_at
        );

        let payment1 = ledgers::create_ledger_payment(
            &pool,
            ledger.id,
            actor_id,
            CustomerLedgerPaymentRequest {
                payment_amount: 200.0,
                payment_method: "cash".to_string(),
                payment_reference: None,
                receipt_number: Some("LGR910-RCT-1".to_string()),
                receipt_file_url: None,
                notes: None,
                payment_date: None,
            },
        )
        .await
        .expect("first partial payment should succeed");
        assert_eq!(payment1.payment_amount, Decimal::new(20_000, 2));

        let mid = ledgers::get_customer_ledger(&pool, ledger.id).await.unwrap();
        assert_eq!(mid.paid_amount, Decimal::new(20_000, 2));
        assert_eq!(mid.balance_due, Decimal::new(30_000, 2));
        assert_eq!(mid.status, "partial");

        let payment2 = ledgers::create_ledger_payment(
            &pool,
            ledger.id,
            actor_id,
            CustomerLedgerPaymentRequest {
                payment_amount: 300.0,
                payment_method: "bank_transfer".to_string(),
                payment_reference: None,
                receipt_number: Some("LGR910-RCT-2".to_string()),
                receipt_file_url: None,
                notes: None,
                payment_date: None,
            },
        )
        .await
        .expect("final payment should fully settle the ledger");
        assert_eq!(payment2.payment_amount, Decimal::new(30_000, 2));

        let with_payments = ledgers::get_customer_ledger_with_payments(&pool, ledger.id)
            .await
            .expect("ledger-with-payments fetch should decode cleanly");
        assert_eq!(with_payments.ledger.paid_amount, Decimal::new(50_000, 2));
        assert_eq!(with_payments.ledger.balance_due, Decimal::ZERO);
        assert_eq!(with_payments.ledger.status, "paid");
        assert_eq!(with_payments.payments.len(), 2);
        let total_paid: Decimal = with_payments.payments.iter().map(|p| p.payment_amount).sum();
        assert_eq!(total_paid, Decimal::new(50_000, 2), "exact decimal sum of the two payments");
        for payment in &with_payments.payments {
            assert!(
                payment.created_at <= Utc::now(),
                "payment created_at should decode as a valid UTC instant, got {:?}",
                payment.created_at
            );
        }

        cleanup_ledgers_by_company(&pool, company_name).await;
    }

    // -----------------------------------------------------------------
    // Scenario 6: company CRUD basics used by city-ledger billing.
    // -----------------------------------------------------------------
    #[tokio::test]
    async fn postgres_company_crud_create_conflict_and_partial_update() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 910_001;
        let fixed_company_id = 910_503;
        let create_name = "Lgr910 Create Co";
        let fixed_name = "Lgr910 Update Co";

        ensure_test_actor(&pool, actor_id).await;
        sqlx::query("DELETE FROM companies WHERE company_name = $1")
            .bind(create_name)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM companies WHERE id = $1 OR company_name = $2")
            .bind(fixed_company_id)
            .bind(fixed_name)
            .execute(&pool)
            .await
            .unwrap();

        let created = companies::create_company(
            &pool,
            CompanyCreateRequest {
                company_name: create_name.to_string(),
                registration_number: None,
                contact_person: None,
                contact_email: None,
                contact_phone: None,
                billing_address: None,
                billing_city: None,
                billing_state: None,
                billing_postal_code: None,
                billing_country: None,
                credit_limit: Some(10_000.0),
                payment_terms_days: Some(20),
                notes: None,
            },
            actor_id,
        )
        .await
        .expect("creating a new company should succeed");
        assert_eq!(created.company_name, create_name);
        assert_eq!(created.payment_terms_days, Some(20));
        assert!(created.is_active);

        let conflict = companies::create_company(
            &pool,
            CompanyCreateRequest {
                company_name: create_name.to_string(),
                registration_number: None,
                contact_person: None,
                contact_email: None,
                contact_phone: None,
                billing_address: None,
                billing_city: None,
                billing_state: None,
                billing_postal_code: None,
                billing_country: None,
                credit_limit: None,
                payment_terms_days: None,
                notes: None,
            },
            actor_id,
        )
        .await;
        assert!(
            matches!(conflict, Err(ApiError::Conflict(_))),
            "duplicate company_name should be rejected as a conflict, got {:?}",
            conflict.err()
        );

        sqlx::query(
            "INSERT INTO companies (id, company_name, contact_person, billing_city, payment_terms_days, is_active, created_by) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Original Contact', 'Original City', 30, true, $3) \
             ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name, contact_person = 'Original Contact', \
                 billing_city = 'Original City', payment_terms_days = 30, is_active = true",
        )
        .bind(fixed_company_id)
        .bind(fixed_name)
        .bind(actor_id)
        .execute(&pool)
        .await
        .unwrap();

        let updated = companies::update_company(
            &pool,
            fixed_company_id,
            CompanyUpdateRequest {
                company_name: None,
                registration_number: None,
                contact_person: Some("Updated Contact".to_string()),
                contact_email: None,
                contact_phone: None,
                billing_address: None,
                billing_city: None,
                billing_state: None,
                billing_postal_code: None,
                billing_country: None,
                is_active: None,
                credit_limit: None,
                payment_terms_days: Some(15),
                notes: None,
            },
        )
        .await
        .expect("partial update of an existing company should succeed");
        assert_eq!(
            updated.company_name, fixed_name,
            "unspecified fields must be preserved (COALESCE semantics)"
        );
        assert_eq!(updated.contact_person.as_deref(), Some("Updated Contact"));
        assert_eq!(updated.payment_terms_days, Some(15));
        assert_eq!(
            updated.billing_city.as_deref(),
            Some("Original City"),
            "fields absent from the update request must survive untouched"
        );

        sqlx::query("DELETE FROM companies WHERE id = $1")
            .bind(created.id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM companies WHERE id = $1")
            .bind(fixed_company_id)
            .execute(&pool)
            .await
            .unwrap();
    }
}
