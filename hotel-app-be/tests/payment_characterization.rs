//! Characterization tests for the payment domain functions that previously
//! had ZERO test callers: `record_payment`, `approve_payment`,
//! `reject_payment`, `refund_deposit` / `revert_deposit_refund`, and the
//! network-free boundary of `capture_paypal_payment`. Business logic lives in
//! `src/services/payments.rs` (thin orchestration: transactions, audit,
//! notifications) over `src/repositories/payment.rs` (the actual SQL).
//!
//! Requires `DATABASE_URL` (PostgreSQL); tests skip gracefully without it,
//! same convention as `tests/invoice_numbering.rs` / `tests/ledger_service.rs`.
//!
//! Fixture IDs live in the assigned 940_2xx block (940_200-940_299). NOTE:
//! `tests/booking_service.rs` already occupies 940_201/940_202/940_203
//! (guest_id and one room_id) inside that same numeric range -- grepped and
//! confirmed before picking IDs below; every ID here starts at 940_210 to
//! stay clear of that collision. No ID is reused across two test fns in this
//! file (grepped before use, per `.claude/rules/lessons.md` 2026-07-27).
//!
//! KNOWN BUGS (do not enshrine -- see the two `#[ignore]`d tests at the
//! bottom of this file for the decided-correct behavior instead):
//! (a) `create_payment` (via `calculate_payment_summary`) charges a room-only
//!     `base_price * nights` recalculation instead of the booking's
//!     `billable_total()` (`total_amount + tourism_tax_amount +
//!     extra_bed_charge`), and `PaymentRequest.amount` is never read at all
//!     (repositories/payment.rs:229 binds `summary.total_amount`).
//! (b) `approve_payment` completes a pending payment without re-verifying the
//!     gateway capture, so it can confirm a payment for which no money was
//!     ever actually collected.

use hotel_app_be::constants::PaymentMethod;
use hotel_app_be::core::error::ApiError;
use hotel_app_be::models::{PaymentRequest, RecordPaymentRequest, UpdatePaymentRequest};
use hotel_app_be::repositories::booking::BookingRepository;
use hotel_app_be::repositories::payment::PaymentRepository;
use hotel_app_be::services::payments;
use rust_decimal::Decimal;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::Barrier;
use tokio::time::{Duration, sleep, timeout};

/// Parse a decimal literal for test fixtures/assertions.
fn d(s: &str) -> Decimal {
    Decimal::from_str(s).unwrap()
}

// Serializes test fns within THIS binary (same pattern as
// tests/booking_service.rs / tests/invoice_numbering.rs / tests/ledger_service.rs).
fn pg_serial_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!(
                "Skipping PostgreSQL payment-characterization test because DATABASE_URL is not set"
            );
            return None;
        }
    };
    let guard = pg_serial_lock().lock_owned().await;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL test database");
    Some((pool, guard))
}

async fn ensure_admin_actor(pool: &PgPool, actor_id: i64) {
    sqlx::query(
        "INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'staff', true, true) \
         ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username",
    )
    .bind(actor_id)
    .bind(format!("pay_test_actor_{actor_id}"))
    .bind(format!("pay-test-actor-{actor_id}@hotel.local"))
    .bind("Payment Test Actor")
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_room_type(pool: &PgPool, room_type_id: i64, base_price: Decimal) {
    sqlx::query(
        "INSERT INTO room_types (id, code, name, base_price, max_occupancy, keycard_deposit_amount, service_charge_percentage) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 2, 0, 0) \
         ON CONFLICT (id) DO UPDATE SET base_price = EXCLUDED.base_price, keycard_deposit_amount = 0, service_charge_percentage = 0",
    )
    .bind(room_type_id)
    .bind(format!("PAYRT{room_type_id}"))
    .bind(format!("Payment Test Room Type {room_type_id}"))
    .bind(base_price)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_room(pool: &PgPool, room_id: i64, room_type_id: i64) {
    sqlx::query(
        "INSERT INTO rooms (id, room_number, room_type_id, status) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'available') \
         ON CONFLICT (id) DO UPDATE SET room_number = EXCLUDED.room_number, room_type_id = EXCLUDED.room_type_id, status = 'available'",
    )
    .bind(room_id)
    .bind(format!("PAY{room_id}"))
    .bind(room_type_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_guest(pool: &PgPool, guest_id: i64) {
    // tourism_type is pinned to 'local' (never left NULL) so
    // `trg_enforce_booking_tourism_tax` always computes tourism_tax_amount = 0
    // for every fixture in this file -- see the invariant assertion at the end
    // of `seed_booking` below.
    sqlx::query(
        "INSERT INTO guests (id, full_name, first_name, last_name, email, tourism_type) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Payment', $3, $4, 'local') \
         ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, tourism_type = 'local'",
    )
    .bind(guest_id)
    .bind(format!("Payment Test Guest {guest_id}"))
    .bind(format!("Guest{guest_id}"))
    .bind(format!("pay-test-guest-{guest_id}@hotel.local"))
    .execute(pool)
    .await
    .unwrap();
}

/// Everything needed to seed one booking fixture (plus its room/room_type/guest).
struct BookingFixture {
    room_type_id: i64,
    room_id: i64,
    guest_id: i64,
    booking_id: i64,
    actor_id: i64,
    status: &'static str,
    check_in: &'static str,
    check_out: &'static str,
    base_price: Decimal,
    subtotal: Decimal,
    total_amount: Decimal,
}

/// Seeds a room_type/room/guest/booking fixture set. `tourism_tax_amount` and
/// `extra_bed_charge` are explicitly pinned to 0 on every (re-)seed below --
/// `seed_guest` also pins `tourism_type = 'local'` so
/// `trg_enforce_booking_tourism_tax` (which recomputes `tourism_tax_amount` on
/// every insert/update of this booking) always lands on 0 too. The resulting
/// `billable_total() == total_amount` invariant is ASSERTED once at the end of
/// this function, immediately after seeding, for every fixture in this file --
/// not merely claimed in prose.
async fn seed_booking(pool: &PgPool, f: &BookingFixture) {
    seed_room_type(pool, f.room_type_id, f.base_price).await;
    seed_room(pool, f.room_id, f.room_type_id).await;
    seed_guest(pool, f.guest_id).await;

    // check_in/check_out/status are compile-time-controlled string literals
    // (never user input), inlined the same way tests/invoice_numbering.rs
    // inlines its date literals. tourism_tax_amount/extra_bed_charge are
    // literal 0s (never bind params) for the same reason.
    let sql = format!(
        "INSERT INTO bookings (
            id, booking_number, guest_id, guest_name, guest_email, room_id,
            check_in_date, check_out_date, adults, children,
            room_rate, subtotal, total_amount, status, payment_status, created_by,
            tourism_tax_amount, extra_bed_charge
         )
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, '{check_in}', '{check_out}', 1, 0,
                 $7, $8, $9, '{status}', 'unpaid', $10, 0, 0)
         ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            payment_status = 'unpaid',
            check_in_date = EXCLUDED.check_in_date,
            check_out_date = EXCLUDED.check_out_date,
            room_rate = EXCLUDED.room_rate,
            subtotal = EXCLUDED.subtotal,
            total_amount = EXCLUDED.total_amount,
            tourism_tax_amount = 0,
            extra_bed_charge = 0",
        check_in = f.check_in,
        check_out = f.check_out,
        status = f.status,
    );

    sqlx::query(&sql)
        .bind(f.booking_id)
        .bind(format!("BK-PAY-{}", f.booking_id))
        .bind(f.guest_id)
        .bind(format!("Payment Test Guest {}", f.guest_id))
        .bind(format!("pay-test-guest-{}@hotel.local", f.guest_id))
        .bind(f.room_id)
        .bind(f.base_price)
        .bind(f.subtotal)
        .bind(f.total_amount)
        .bind(f.actor_id)
        .execute(pool)
        .await
        .unwrap();

    let summary = PaymentRepository::workflow_summary_row(pool, f.booking_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        summary.billable_total(),
        f.total_amount,
        "fixture invariant violated for booking {}: billable_total() ({}) must equal total_amount ({}) -- tourism_type/tourism_tax_amount/extra_bed_charge pinning regressed",
        f.booking_id,
        summary.billable_total(),
        f.total_amount
    );
}

/// Inserts a `pending` payment row directly (mirrors what
/// `PaymentRepository::insert_pending_payment_tx` produces for a guest bank
/// transfer claim / PayPal pre-capture record), so `approve_payment` /
/// `reject_payment` / `capture_paypal_payment` have something to act on
/// without going through the guest-facing claim endpoints.
async fn insert_pending_payment(
    pool: &PgPool,
    booking_id: i64,
    payment_method: &str,
    payment_type: &str,
    amount: Decimal,
    created_by: i64,
) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO payments (uuid, booking_id, amount, payment_method, payment_type, status, created_by) \
         VALUES (gen_uuidv7(), $1, $2, $3, $4, 'pending', $5) RETURNING id",
    )
    .bind(booking_id)
    .bind(amount)
    .bind(payment_method)
    .bind(payment_type)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .expect("inserting a fixture pending payment should succeed")
}

async fn fetch_payment_status(pool: &PgPool, payment_id: i64) -> String {
    sqlx::query_scalar("SELECT status FROM payments WHERE id = $1")
        .bind(payment_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn fetch_booking_status(pool: &PgPool, booking_id: i64) -> (String, String) {
    sqlx::query_as("SELECT status, payment_status FROM bookings WHERE id = $1")
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn latest_booking_history(
    pool: &PgPool,
    booking_id: i64,
) -> Option<(Option<String>, String)> {
    sqlx::query_as(
        "SELECT previous_status, new_status FROM booking_history \
         WHERE booking_id = $1 ORDER BY id DESC LIMIT 1",
    )
    .bind(booking_id)
    .fetch_optional(pool)
    .await
    .unwrap()
}

async fn audit_log_exists(pool: &PgPool, action: &str, resource_id: i64) -> bool {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM audit_logs \
         WHERE action = $1 AND resource_type = 'payment' AND resource_id = $2)",
    )
    .bind(action)
    .bind(resource_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn payment_request(booking_id: i64, amount: f64, idempotency_key: &str) -> RecordPaymentRequest {
    RecordPaymentRequest {
        booking_id,
        amount,
        payment_method: "cash".to_string(),
        payment_type: None,
        transaction_reference: None,
        notes: None,
        payment_date: None,
        idempotency_key: idempotency_key.to_string(),
    }
}

async fn seed_idempotency_booking(
    pool: &PgPool,
    actor_id: i64,
    room_type_id: i64,
    room_id: i64,
    guest_id: i64,
    booking_id: i64,
) {
    cleanup(
        pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(pool, actor_id).await;
    seed_booking(
        pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "pending",
            check_in: "2031-06-20",
            check_out: "2031-06-21",
            base_price: d("300.00"),
            subtotal: d("300.00"),
            total_amount: d("300.00"),
        },
    )
    .await;
}

async fn cleanup_idempotency_booking(
    pool: &PgPool,
    actor_id: i64,
    room_type_id: i64,
    room_id: i64,
    guest_id: i64,
    booking_id: i64,
) {
    cleanup(
        pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
}

async fn install_payment_insert_delay(pool: &PgPool) {
    remove_payment_insert_delay(pool).await.unwrap();
    sqlx::query(
        r#"
        CREATE FUNCTION payment_characterization_delay_insert()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            PERFORM pg_sleep(0.25);
            RETURN NEW;
        END;
        $$
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TRIGGER payment_characterization_delay_insert \
         BEFORE INSERT ON payments FOR EACH ROW \
         EXECUTE FUNCTION payment_characterization_delay_insert()",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn remove_payment_insert_delay(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("DROP TRIGGER IF EXISTS payment_characterization_delay_insert ON payments")
        .execute(pool)
        .await?;
    sqlx::query("DROP FUNCTION IF EXISTS payment_characterization_delay_insert()")
        .execute(pool)
        .await?;
    Ok(())
}

async fn install_payment_completion_delay(pool: &PgPool) {
    remove_payment_completion_delay(pool).await.unwrap();
    sqlx::query(
        r#"
        CREATE FUNCTION payment_characterization_delay_completion()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            PERFORM pg_sleep(0.25);
            RETURN NEW;
        END;
        $$
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TRIGGER payment_characterization_delay_completion \
         BEFORE UPDATE OF status ON payments FOR EACH ROW \
         WHEN (OLD.status IN ('pending', 'processing') AND NEW.status = 'completed') \
         EXECUTE FUNCTION payment_characterization_delay_completion()",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn remove_payment_completion_delay(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("DROP TRIGGER IF EXISTS payment_characterization_delay_completion ON payments")
        .execute(pool)
        .await?;
    sqlx::query("DROP FUNCTION IF EXISTS payment_characterization_delay_completion()")
        .execute(pool)
        .await?;
    Ok(())
}

async fn wait_for_advisory_waiter(pool: &PgPool) {
    timeout(Duration::from_secs(5), async {
        loop {
            let is_waiting: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity \
                 WHERE wait_event = 'advisory' AND query LIKE '%payments%')",
            )
            .fetch_one(pool)
            .await
            .unwrap();
            if is_waiting {
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("a payment mutation must reach the test advisory gate");
}

async fn install_payment_mutation_gate(pool: &PgPool, operation: &str, advisory_key: i64) {
    remove_payment_mutation_gate(pool).await.unwrap();
    let function_sql = format!(
        r#"
        CREATE FUNCTION payment_characterization_gate_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            PERFORM pg_advisory_xact_lock({advisory_key});
            RETURN COALESCE(NEW, OLD);
        END;
        $$
        "#,
    );
    sqlx::query(&function_sql).execute(pool).await.unwrap();
    let trigger_sql = format!(
        "CREATE TRIGGER payment_characterization_gate_mutation \
         BEFORE {operation} ON payments FOR EACH ROW \
         EXECUTE FUNCTION payment_characterization_gate_mutation()"
    );
    sqlx::query(&trigger_sql).execute(pool).await.unwrap();
}

async fn remove_payment_mutation_gate(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("DROP TRIGGER IF EXISTS payment_characterization_gate_mutation ON payments")
        .execute(pool)
        .await?;
    sqlx::query("DROP FUNCTION IF EXISTS payment_characterization_gate_mutation()")
        .execute(pool)
        .await?;
    Ok(())
}

async fn install_booking_recompute_failure(pool: &PgPool, booking_id: i64) {
    remove_booking_recompute_failure(pool).await.unwrap();
    // Isolate the service-owned recompute boundary. The baseline also carries
    // a database trigger as defense in depth; disabling it here proves the Rust
    // transaction itself does not commit a replay row before its recompute.
    sqlx::query("ALTER TABLE payments DISABLE TRIGGER trg_sync_booking_payment_status")
        .execute(pool)
        .await
        .unwrap();
    let function_sql = format!(
        r#"
        CREATE FUNCTION payment_characterization_fail_recompute()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF NEW.id = {booking_id} THEN
                RAISE EXCEPTION 'forced payment-status recompute failure';
            END IF;
            RETURN NEW;
        END;
        $$
        "#,
    );
    sqlx::query(&function_sql).execute(pool).await.unwrap();
    sqlx::query(
        "CREATE TRIGGER payment_characterization_fail_recompute \
         BEFORE UPDATE OF payment_status ON bookings FOR EACH ROW \
         EXECUTE FUNCTION payment_characterization_fail_recompute()",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn remove_booking_recompute_failure(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("DROP TRIGGER IF EXISTS payment_characterization_fail_recompute ON bookings")
        .execute(pool)
        .await?;
    sqlx::query("DROP FUNCTION IF EXISTS payment_characterization_fail_recompute()")
        .execute(pool)
        .await?;
    sqlx::query("ALTER TABLE payments ENABLE TRIGGER trg_sync_booking_payment_status")
        .execute(pool)
        .await?;
    Ok(())
}

/// Deletes a set of fixtures seeded by `seed_booking`/`ensure_admin_actor`.
/// `payments`/`booking_history`/`payment_receipt_requests` cascade-delete
/// when their booking is deleted; `room_status_change_log` does NOT (FK on
/// room_id, no ON DELETE) -- see `.claude/rules/lessons.md` 2026-07-26e.
/// `audit_logs` has no FK to booking at all, so it is cleaned explicitly.
async fn cleanup(
    pool: &PgPool,
    room_type_ids: &[i64],
    room_ids: &[i64],
    guest_ids: &[i64],
    booking_ids: &[i64],
    actor_ids: &[i64],
) {
    for &booking_id in booking_ids {
        sqlx::query(
            "DELETE FROM audit_logs WHERE resource_type = 'payment' \
             AND (details->>'booking_id')::bigint = $1",
        )
        .bind(booking_id)
        .execute(pool)
        .await
        .ok();
        sqlx::query("DELETE FROM bookings WHERE id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .ok();
    }
    for &guest_id in guest_ids {
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .ok();
    }
    for &room_id in room_ids {
        sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .ok();
    }
    for &room_type_id in room_type_ids {
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(room_type_id)
            .execute(pool)
            .await
            .ok();
    }
    for &actor_id in actor_ids {
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(actor_id)
            .execute(pool)
            .await
            .ok();
    }
}

/// (1) `record_payment`: zero/negative amounts are rejected before any money
/// moves; a partial payment recomputes `unpaid -> partial`; an amount that
/// would exceed the outstanding balance is rejected without moving money; a
/// payment that exactly settles the balance recomputes `partial -> paid` AND
/// auto-confirms a `pending` booking (with a booking_history row); and once
/// fully settled, any further booking payment is rejected. All amount
/// comparisons exercise the real `rust_decimal::Decimal` boundary logic in
/// `services::payments::record_payment` / `recompute_booking_payment_status`.
#[tokio::test]
async fn record_payment_recomputes_status_and_confirms_booking_on_full_settlement() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let actor_id = 940_210;
    let room_type_id = 940_211;
    let room_id = 940_212;
    let guest_id = 940_213;
    let booking_id = 940_214;

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "pending",
            check_in: "2031-06-01",
            check_out: "2031-06-02",
            base_price: d("100.00"),
            subtotal: d("100.00"),
            total_amount: d("300.00"),
        },
    )
    .await;

    let zero = payments::record_payment(
        &pool,
        actor_id,
        RecordPaymentRequest {
            booking_id,
            amount: 0.0,
            payment_method: "cash".to_string(),
            payment_type: None,
            transaction_reference: None,
            notes: None,
            payment_date: None,
            idempotency_key: "payment-char-940214-zero".to_string(),
        },
    )
    .await;
    assert!(
        matches!(zero, Err(ApiError::BadRequest(_))),
        "zero amount must be rejected: {zero:?}"
    );

    let negative = payments::record_payment(
        &pool,
        actor_id,
        RecordPaymentRequest {
            booking_id,
            amount: -10.0,
            payment_method: "cash".to_string(),
            payment_type: None,
            transaction_reference: None,
            notes: None,
            payment_date: None,
            idempotency_key: "payment-char-940214-negative".to_string(),
        },
    )
    .await;
    assert!(
        matches!(negative, Err(ApiError::BadRequest(_))),
        "negative amount must be rejected: {negative:?}"
    );

    let summary_before = PaymentRepository::workflow_summary_row(&pool, booking_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        summary_before.total_paid,
        Decimal::ZERO,
        "rejected zero/negative attempts must not move money"
    );
    assert_eq!(summary_before.payment_status, "unpaid");

    let partial = payments::record_payment(
        &pool,
        actor_id,
        RecordPaymentRequest {
            booking_id,
            amount: 100.0,
            payment_method: "cash".to_string(),
            payment_type: None,
            transaction_reference: Some("TXN-PAY-940214-A".to_string()),
            notes: None,
            payment_date: None,
            idempotency_key: "payment-char-940214-partial".to_string(),
        },
    )
    .await
    .expect("partial payment should succeed");
    assert_eq!(
        partial.get("total_amount").unwrap().as_str().unwrap(),
        "100.00"
    );
    assert_eq!(
        partial.get("payment_method").unwrap().as_str().unwrap(),
        "cash"
    );
    assert_eq!(
        partial.get("payment_status").unwrap().as_str().unwrap(),
        "completed"
    );

    let (status_after_partial, payment_status_after_partial) =
        fetch_booking_status(&pool, booking_id).await;
    assert_eq!(payment_status_after_partial, "partial");
    assert_eq!(
        status_after_partial, "pending",
        "booking must not auto-confirm on a partial payment"
    );

    // Balance due is now 200.00; requesting 250.00 must be rejected and must
    // not move any money.
    let overlimit = payments::record_payment(
        &pool,
        actor_id,
        RecordPaymentRequest {
            booking_id,
            amount: 250.0,
            payment_method: "cash".to_string(),
            payment_type: None,
            transaction_reference: None,
            notes: None,
            payment_date: None,
            idempotency_key: "payment-char-940214-overlimit".to_string(),
        },
    )
    .await;
    assert!(
        matches!(overlimit, Err(ApiError::BadRequest(_))),
        "amount exceeding the outstanding balance must be rejected: {overlimit:?}"
    );

    let summary_mid = PaymentRepository::workflow_summary_row(&pool, booking_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        summary_mid.total_paid,
        d("100.00"),
        "a rejected overlimit attempt must not move money"
    );

    let full = payments::record_payment(
        &pool,
        actor_id,
        RecordPaymentRequest {
            booking_id,
            amount: 200.0,
            payment_method: "card".to_string(),
            payment_type: None,
            transaction_reference: Some("TXN-PAY-940214-B".to_string()),
            notes: None,
            payment_date: None,
            idempotency_key: "payment-char-940214-full".to_string(),
        },
    )
    .await
    .expect("full settlement payment should succeed");
    assert_eq!(
        full.get("total_amount").unwrap().as_str().unwrap(),
        "200.00"
    );

    let (status_after_full, payment_status_after_full) =
        fetch_booking_status(&pool, booking_id).await;
    assert_eq!(payment_status_after_full, "paid");
    assert_eq!(
        status_after_full, "confirmed",
        "booking must auto-confirm once fully settled"
    );

    let history = latest_booking_history(&pool, booking_id).await;
    assert_eq!(
        history,
        Some((Some("pending".to_string()), "confirmed".to_string()))
    );

    let after_paid = payments::record_payment(
        &pool,
        actor_id,
        RecordPaymentRequest {
            booking_id,
            amount: 50.0,
            payment_method: "cash".to_string(),
            payment_type: None,
            transaction_reference: None,
            notes: None,
            payment_date: None,
            idempotency_key: "payment-char-940214-after-paid".to_string(),
        },
    )
    .await;
    assert!(
        matches!(after_paid, Err(ApiError::BadRequest(_))),
        "a fully settled booking must reject further booking payments: {after_paid:?}"
    );

    let summary_final = PaymentRepository::workflow_summary_row(&pool, booking_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(summary_final.total_paid, d("300.00"));

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
}

/// A booking-row lock must serialize full-settlement attempts that arrive
/// together. Removing that lock lets both requests read RM300 as outstanding
/// before the trigger releases either insert, recording RM600 in total.
#[tokio::test]
async fn concurrent_full_booking_payments_record_only_one_row() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_300, 940_301, 940_302, 940_303, 940_304);
    seed_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;
    install_payment_insert_delay(&pool).await;

    let barrier = Arc::new(Barrier::new(2));
    let first_pool = pool.clone();
    let first_barrier = barrier.clone();
    let first = async move {
        first_barrier.wait().await;
        payments::record_payment(
            &first_pool,
            actor_id,
            payment_request(booking_id, 300.0, "payment-char-940304-race-a"),
        )
        .await
    };
    let second_pool = pool.clone();
    let second_barrier = barrier.clone();
    let second = async move {
        second_barrier.wait().await;
        payments::record_payment(
            &second_pool,
            actor_id,
            payment_request(booking_id, 300.0, "payment-char-940304-race-b"),
        )
        .await
    };
    let (first, second) = tokio::join!(first, second);
    let (payment_count, payment_total): (i64, Decimal) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM payments WHERE booking_id = $1",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let trigger_cleanup = remove_payment_insert_delay(&pool).await;
    cleanup_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;
    trigger_cleanup.expect("the test-only payment insert trigger must be removed");

    let successes = [first.as_ref(), second.as_ref()]
        .into_iter()
        .filter(|result| result.is_ok())
        .count();
    assert_eq!(
        successes, 1,
        "one full-payment request must be rejected after the locked balance is re-read: first={first:?}, second={second:?}"
    );
    assert!(
        [first, second]
            .into_iter()
            .any(|result| matches!(result, Err(ApiError::BadRequest(_)))),
        "the serialized second request must be refused for its now-zero balance"
    );
    assert_eq!(payment_count, 1, "only one payment row may be committed");
    assert_eq!(payment_total, d("300.00"));
}

/// Guest claims must serialize on the booking row. Removing either the lock or
/// the status re-read lets both requests pass their initial reads while the
/// insert trigger holds them, producing two active claims for one booking.
#[tokio::test]
async fn concurrent_bank_transfer_claims_create_at_most_one_active_payment() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_600, 940_601, 940_602, 940_603, 940_604);
    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "pending_payment",
            check_in: "2031-06-22",
            check_out: "2031-06-23",
            base_price: d("300.00"),
            subtotal: d("300.00"),
            total_amount: d("300.00"),
        },
    )
    .await;
    let booking = BookingRepository::find_by_id(&pool, booking_id)
        .await
        .unwrap()
        .expect("the guest-payment booking must exist");
    install_payment_insert_delay(&pool).await;

    let barrier = Arc::new(Barrier::new(2));
    let first_pool = pool.clone();
    let first_barrier = barrier.clone();
    let first_booking = booking.clone();
    let first = async move {
        first_barrier.wait().await;
        payments::create_bank_transfer_claim(&first_pool, &first_booking).await
    };
    let second_pool = pool.clone();
    let second_barrier = barrier.clone();
    let second = async move {
        second_barrier.wait().await;
        payments::create_bank_transfer_claim(&second_pool, &booking).await
    };
    let (first, second) = tokio::join!(first, second);
    let active_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM payments \
         WHERE booking_id = $1 AND status IN ('pending', 'processing', 'completed')",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let payment_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    let trigger_cleanup = remove_payment_insert_delay(&pool).await;
    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    trigger_cleanup.expect("the test-only payment insert trigger must be removed");

    let successes = [first.as_ref(), second.as_ref()]
        .into_iter()
        .filter(|result| result.is_ok())
        .count();
    assert_eq!(
        successes, 1,
        "exactly one claim may succeed: first={first:?}, second={second:?}"
    );
    assert!(
        [first, second]
            .into_iter()
            .any(|result| matches!(result, Err(ApiError::BadRequest(_)))),
        "the request that acquires the booking lock after the winner must reject its stale awaiting-payment state"
    );
    assert_eq!(active_count, 1, "only one active guest claim may remain");
    assert_eq!(
        payment_count, 1,
        "the losing claim transaction must roll back its row"
    );
}

/// Legacy pending rows can exist from before guest initiation was serialized.
/// Removing the booking lock before the completed-payment check lets both
/// approvals observe no sibling completion and commit independently.
#[tokio::test]
async fn concurrent_legacy_payment_approvals_complete_at_most_one_payment() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_610, 940_611, 940_612, 940_613, 940_614);
    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "pending_payment",
            check_in: "2031-06-24",
            check_out: "2031-06-25",
            base_price: d("300.00"),
            subtotal: d("300.00"),
            total_amount: d("300.00"),
        },
    )
    .await;
    let first_payment = insert_pending_payment(
        &pool,
        booking_id,
        "bank_transfer",
        "booking",
        d("300.00"),
        actor_id,
    )
    .await;
    let second_payment = insert_pending_payment(
        &pool,
        booking_id,
        "bank_transfer",
        "booking",
        d("300.00"),
        actor_id,
    )
    .await;
    install_payment_completion_delay(&pool).await;

    let barrier = Arc::new(Barrier::new(2));
    let first_pool = pool.clone();
    let first_barrier = barrier.clone();
    let first = async move {
        first_barrier.wait().await;
        payments::approve_payment(&first_pool, actor_id, first_payment).await
    };
    let second_pool = pool.clone();
    let second_barrier = barrier.clone();
    let second = async move {
        second_barrier.wait().await;
        payments::approve_payment(&second_pool, actor_id, second_payment).await
    };
    let (first, second) = tokio::join!(first, second);
    let completed_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM payments WHERE booking_id = $1 AND status = 'completed'",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let pending_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM payments WHERE booking_id = $1 AND status = 'pending'",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let approval_audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs \
         WHERE action = 'payment_approved' AND resource_type = 'payment' \
           AND (details->>'booking_id')::bigint = $1",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let trigger_cleanup = remove_payment_completion_delay(&pool).await;
    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    trigger_cleanup.expect("the test-only payment completion trigger must be removed");

    let successes = [first.as_ref(), second.as_ref()]
        .into_iter()
        .filter(|result| result.is_ok())
        .count();
    assert_eq!(
        successes, 1,
        "exactly one approval may succeed: first={first:?}, second={second:?}"
    );
    assert!(
        [first, second]
            .into_iter()
            .any(|result| matches!(result, Err(ApiError::Conflict(_)))),
        "the approval that sees the completed sibling under the booking lock must conflict"
    );
    assert_eq!(completed_count, 1, "only one legacy payment may complete");
    assert_eq!(
        pending_count, 1,
        "the losing approval must roll back before changing its row"
    );
    assert_eq!(
        approval_audit_count, 1,
        "the losing approval must roll back its audit event"
    );
}

/// Updating a payment must hold the booking lock before it locks and refetches
/// the payment. The gate freezes the update after it has reached the payment
/// row; a concurrent create must then wait and revalidate the new balance.
#[tokio::test]
async fn concurrent_create_and_update_cannot_overpay_booking() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_700, 940_701, 940_702, 940_703, 940_704);
    seed_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;
    let original = payments::record_payment(
        &pool,
        actor_id,
        payment_request(booking_id, 100.0, "payment-char-940704-original"),
    )
    .await
    .unwrap();
    let payment_id = original["id"].as_i64().unwrap();

    const GATE: i64 = 940_704;
    install_payment_mutation_gate(&pool, "UPDATE", GATE).await;
    let mut gate_connection = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(GATE)
        .execute(&mut *gate_connection)
        .await
        .unwrap();

    let update_pool = pool.clone();
    let update = tokio::spawn(async move {
        payments::update_payment(
            &update_pool,
            actor_id,
            payment_id,
            UpdatePaymentRequest {
                amount: Some(200.0),
                payment_method: None,
                transaction_reference: None,
                notes: None,
                payment_date: None,
            },
        )
        .await
    });
    wait_for_advisory_waiter(&pool).await;

    let create_pool = pool.clone();
    let create = tokio::spawn(async move {
        payments::record_payment(
            &create_pool,
            actor_id,
            payment_request(booking_id, 200.0, "payment-char-940704-concurrent"),
        )
        .await
    });
    sleep(Duration::from_millis(100)).await;
    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(GATE)
        .execute(&mut *gate_connection)
        .await
        .unwrap();

    let updated = timeout(Duration::from_secs(5), update)
        .await
        .expect("update must not deadlock")
        .unwrap();
    let created = timeout(Duration::from_secs(5), create)
        .await
        .expect("create must not deadlock")
        .unwrap();
    let payment_total: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount), 0) FROM payments \
         WHERE booking_id = $1 AND status = 'completed'",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (booking_status, payment_status) = fetch_booking_status(&pool, booking_id).await;

    let trigger_cleanup = remove_payment_mutation_gate(&pool).await;
    cleanup_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;
    trigger_cleanup.expect("the update gate must be removed");

    assert!(
        updated.is_ok(),
        "the lock-owning update must succeed: {updated:?}"
    );
    assert!(
        matches!(created, Err(ApiError::BadRequest(_))),
        "create must re-read the RM100 balance after the update: {created:?}"
    );
    assert_eq!(payment_total, d("200.00"));
    assert_eq!(booking_status, "pending");
    assert_eq!(payment_status, "partial");
}

/// Deletion must lock booking -> payment. While the delete is paused after
/// reaching its payment row, create must wait until the deleted installment is
/// absent instead of confirming against money that is about to disappear.
#[tokio::test]
async fn concurrent_create_and_delete_cannot_confirm_underpaid_booking() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_710, 940_711, 940_712, 940_713, 940_714);
    seed_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;
    let original = payments::record_payment(
        &pool,
        actor_id,
        payment_request(booking_id, 100.0, "payment-char-940714-original"),
    )
    .await
    .unwrap();
    let payment_id = original["id"].as_i64().unwrap();

    const GATE: i64 = 940_714;
    install_payment_mutation_gate(&pool, "DELETE", GATE).await;
    let mut gate_connection = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(GATE)
        .execute(&mut *gate_connection)
        .await
        .unwrap();

    let delete_pool = pool.clone();
    let delete =
        tokio::spawn(
            async move { payments::delete_payment(&delete_pool, actor_id, payment_id).await },
        );
    wait_for_advisory_waiter(&pool).await;

    let create_pool = pool.clone();
    let create = tokio::spawn(async move {
        payments::record_payment(
            &create_pool,
            actor_id,
            payment_request(booking_id, 200.0, "payment-char-940714-concurrent"),
        )
        .await
    });
    sleep(Duration::from_millis(100)).await;
    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(GATE)
        .execute(&mut *gate_connection)
        .await
        .unwrap();

    let deleted = timeout(Duration::from_secs(5), delete)
        .await
        .expect("delete must not deadlock")
        .unwrap();
    let created = timeout(Duration::from_secs(5), create)
        .await
        .expect("create must not deadlock")
        .unwrap();
    let payment_total: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount), 0) FROM payments \
         WHERE booking_id = $1 AND status = 'completed'",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (booking_status, payment_status) = fetch_booking_status(&pool, booking_id).await;

    let trigger_cleanup = remove_payment_mutation_gate(&pool).await;
    cleanup_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;
    trigger_cleanup.expect("the delete gate must be removed");

    assert!(deleted.is_ok(), "the delete must succeed: {deleted:?}");
    assert!(
        created.is_ok(),
        "the partial create must succeed: {created:?}"
    );
    assert_eq!(payment_total, d("200.00"));
    assert_eq!(booking_status, "pending");
    assert_eq!(payment_status, "partial");
}

/// Approval and rejection must acquire locks in the same booking -> payment
/// order. Pausing rejection at the payment row used to create a deterministic
/// payment -> booking / booking -> payment deadlock with approval.
#[tokio::test]
async fn concurrent_approval_and_rejection_have_one_terminal_transition_without_deadlock() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_720, 940_721, 940_722, 940_723, 940_724);
    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "pending_confirmation",
            check_in: "2031-07-01",
            check_out: "2031-07-02",
            base_price: d("300.00"),
            subtotal: d("300.00"),
            total_amount: d("300.00"),
        },
    )
    .await;
    let payment_id = insert_pending_payment(
        &pool,
        booking_id,
        "bank_transfer",
        "booking",
        d("300.00"),
        actor_id,
    )
    .await;

    const GATE: i64 = 940_724;
    install_payment_mutation_gate(&pool, "UPDATE", GATE).await;
    let mut gate_connection = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(GATE)
        .execute(&mut *gate_connection)
        .await
        .unwrap();

    let reject_pool = pool.clone();
    let rejection = tokio::spawn(async move {
        payments::reject_payment(&reject_pool, actor_id, payment_id, "Concurrent review").await
    });
    wait_for_advisory_waiter(&pool).await;

    let approve_pool = pool.clone();
    let approval = tokio::spawn(async move {
        payments::approve_payment(&approve_pool, actor_id, payment_id).await
    });
    sleep(Duration::from_millis(100)).await;
    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(GATE)
        .execute(&mut *gate_connection)
        .await
        .unwrap();

    let rejection = timeout(Duration::from_secs(5), rejection)
        .await
        .expect("rejection must finish")
        .unwrap();
    let approval = timeout(Duration::from_secs(5), approval)
        .await
        .expect("approval must finish")
        .unwrap();
    let terminal_audits: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE resource_type = 'payment' \
         AND resource_id = $1 AND action IN ('payment_approved', 'payment_rejected')",
    )
    .bind(payment_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let payment_status = fetch_payment_status(&pool, payment_id).await;

    let trigger_cleanup = remove_payment_mutation_gate(&pool).await;
    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    trigger_cleanup.expect("the approval/rejection gate must be removed");

    for result in [&rejection, &approval] {
        assert!(
            !matches!(result, Err(ApiError::Database(message)) if message.contains("deadlock")),
            "booking-first lock order must not deadlock: rejection={rejection:?}, approval={approval:?}"
        );
    }
    assert_eq!(
        [rejection.as_ref(), approval.as_ref()]
            .into_iter()
            .filter(|result| result.is_ok())
            .count(),
        1,
        "exactly one terminal transition must win: rejection={rejection:?}, approval={approval:?}"
    );
    assert!(matches!(payment_status.as_str(), "completed" | "void"));
    assert_eq!(terminal_audits, 1);
}

/// Replaying the same normalized key and canonical payload must return the
/// original row, without recording a second status/history/audit workflow.
#[tokio::test]
async fn record_payment_replays_exact_idempotency_key_without_side_effects() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_310, 940_311, 940_312, 940_313, 940_314);
    seed_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;

    let mut first_request = payment_request(booking_id, 300.0, "  payment-char-940314-replay  ");
    first_request.payment_method = "card".to_string();
    first_request.transaction_reference = Some("PAY-940314".to_string());
    first_request.notes = Some("Desk payment".to_string());
    first_request.payment_date = Some("2031-06-20".to_string());
    let first = payments::record_payment(&pool, actor_id, first_request)
        .await
        .expect("the first request must record a payment");

    let mut retry_request = payment_request(booking_id, 300.0, "payment-char-940314-replay");
    retry_request.payment_method = "card".to_string();
    retry_request.transaction_reference = Some("PAY-940314".to_string());
    retry_request.notes = Some("Desk payment".to_string());
    retry_request.payment_date = Some("2031-06-20".to_string());
    let retry = payments::record_payment(&pool, actor_id, retry_request)
        .await
        .expect("an exact retry must replay the original payment");
    let payment_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let history_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM booking_history WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs \
         WHERE action = 'payment_recorded' AND resource_type = 'payment' \
           AND (details->>'booking_id')::bigint = $1",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    cleanup_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;

    assert_eq!(
        first["id"], retry["id"],
        "an exact retry returns the original id"
    );
    assert_eq!(
        payment_count, 1,
        "an exact retry cannot insert a second payment"
    );
    assert_eq!(
        history_count, 1,
        "an exact retry cannot append booking history"
    );
    assert_eq!(
        audit_count, 1,
        "an exact retry cannot write a second audit event"
    );
}

/// A transaction reference is also a replay identity. A new idempotency key
/// may replay only the exact canonical request; changed material must conflict.
#[tokio::test]
async fn transaction_reference_replay_requires_exact_canonical_payload() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_730, 940_731, 940_732, 940_733, 940_734);
    seed_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;

    let mut original = payment_request(booking_id, 100.0, "payment-char-940734-original");
    original.payment_method = "card".to_string();
    original.transaction_reference = Some("PAY-940734".to_string());
    original.notes = Some("Original".to_string());
    original.payment_date = Some("2031-07-03".to_string());
    let first = payments::record_payment(&pool, actor_id, original)
        .await
        .unwrap();

    let mut exact = payment_request(booking_id, 100.0, "payment-char-940734-exact-retry");
    exact.payment_method = "card".to_string();
    exact.transaction_reference = Some("PAY-940734".to_string());
    exact.notes = Some("Original".to_string());
    exact.payment_date = Some("2031-07-03".to_string());
    let replay = payments::record_payment(&pool, actor_id, exact)
        .await
        .expect("an exact transaction-reference retry must replay");

    let mut changed_amount = payment_request(booking_id, 150.0, "payment-char-940734-amount");
    changed_amount.payment_method = "card".to_string();
    changed_amount.transaction_reference = Some("PAY-940734".to_string());
    changed_amount.notes = Some("Original".to_string());
    changed_amount.payment_date = Some("2031-07-03".to_string());
    let changed_amount = payments::record_payment(&pool, actor_id, changed_amount).await;

    let mut changed_method = payment_request(booking_id, 100.0, "payment-char-940734-method");
    changed_method.payment_method = "cash".to_string();
    changed_method.transaction_reference = Some("PAY-940734".to_string());
    changed_method.notes = Some("Original".to_string());
    changed_method.payment_date = Some("2031-07-03".to_string());
    let changed_method = payments::record_payment(&pool, actor_id, changed_method).await;

    let mut changed_type = payment_request(booking_id, 100.0, "payment-char-940734-type");
    changed_type.payment_method = "card".to_string();
    changed_type.payment_type = Some("deposit".to_string());
    changed_type.transaction_reference = Some("PAY-940734".to_string());
    changed_type.notes = Some("Original".to_string());
    changed_type.payment_date = Some("2031-07-03".to_string());
    let changed_type = payments::record_payment(&pool, actor_id, changed_type).await;

    let mut changed_notes = payment_request(booking_id, 100.0, "payment-char-940734-notes");
    changed_notes.payment_method = "card".to_string();
    changed_notes.transaction_reference = Some("PAY-940734".to_string());
    changed_notes.notes = Some("Changed".to_string());
    changed_notes.payment_date = Some("2031-07-03".to_string());
    let changed_notes = payments::record_payment(&pool, actor_id, changed_notes).await;

    let mut changed_date = payment_request(booking_id, 100.0, "payment-char-940734-date");
    changed_date.payment_method = "card".to_string();
    changed_date.transaction_reference = Some("PAY-940734".to_string());
    changed_date.notes = Some("Original".to_string());
    changed_date.payment_date = Some("2031-07-04".to_string());
    let changed_date = payments::record_payment(&pool, actor_id, changed_date).await;
    let payment_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    cleanup_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;

    assert_eq!(first["id"], replay["id"]);
    for (field, result) in [
        ("amount", changed_amount),
        ("method", changed_method),
        ("type", changed_type),
        ("notes", changed_notes),
        ("date", changed_date),
    ] {
        assert!(
            matches!(result, Err(ApiError::Conflict(_))),
            "a reused transaction reference with changed {field} must conflict: {result:?}"
        );
    }
    assert_eq!(payment_count, 1);
}

/// Transaction references are global provenance: another booking cannot claim
/// one, even if every other canonical field happens to match.
#[tokio::test]
async fn transaction_reference_cannot_be_reused_by_another_booking() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_a, room_a, guest_a, booking_a) =
        (940_740, 940_741, 940_742, 940_743, 940_744);
    let (room_type_b, room_b, guest_b, booking_b) = (940_745, 940_746, 940_747, 940_748);
    cleanup(
        &pool,
        &[room_type_a, room_type_b],
        &[room_a, room_b],
        &[guest_a, guest_b],
        &[booking_a, booking_b],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    for fixture in [
        BookingFixture {
            room_type_id: room_type_a,
            room_id: room_a,
            guest_id: guest_a,
            booking_id: booking_a,
            actor_id,
            status: "pending",
            check_in: "2031-07-04",
            check_out: "2031-07-05",
            base_price: d("300.00"),
            subtotal: d("300.00"),
            total_amount: d("300.00"),
        },
        BookingFixture {
            room_type_id: room_type_b,
            room_id: room_b,
            guest_id: guest_b,
            booking_id: booking_b,
            actor_id,
            status: "pending",
            check_in: "2031-07-04",
            check_out: "2031-07-05",
            base_price: d("300.00"),
            subtotal: d("300.00"),
            total_amount: d("300.00"),
        },
    ] {
        seed_booking(&pool, &fixture).await;
    }

    let mut first = payment_request(booking_a, 100.0, "payment-char-940744");
    first.transaction_reference = Some("PAY-GLOBAL-940744".to_string());
    payments::record_payment(&pool, actor_id, first)
        .await
        .unwrap();
    let mut second = payment_request(booking_b, 100.0, "payment-char-940748");
    second.transaction_reference = Some("PAY-GLOBAL-940744".to_string());
    let result = payments::record_payment(&pool, actor_id, second).await;

    cleanup(
        &pool,
        &[room_type_a, room_type_b],
        &[room_a, room_b],
        &[guest_a, guest_b],
        &[booking_a, booking_b],
        &[actor_id],
    )
    .await;

    assert!(
        matches!(result, Err(ApiError::Conflict(_))),
        "another booking must not replay a global transaction reference: {result:?}"
    );
}

/// Rows written before fingerprints existed are ambiguous and must never be
/// treated as safe replays merely because their transaction reference matches.
#[tokio::test]
async fn legacy_transaction_reference_without_fingerprint_fails_closed() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_750, 940_751, 940_752, 940_753, 940_754);
    seed_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;
    sqlx::query(
        "INSERT INTO payments \
         (uuid, booking_id, amount, payment_method, payment_type, status, transaction_id, created_by) \
         VALUES (gen_uuidv7(), $1, 100, 'cash', 'booking', 'completed', $2, $3)",
    )
    .bind(booking_id)
    .bind("PAY-LEGACY-940754")
    .bind(actor_id)
    .execute(&pool)
    .await
    .unwrap();

    let mut retry = payment_request(booking_id, 100.0, "payment-char-940754-retry");
    retry.transaction_reference = Some("PAY-LEGACY-940754".to_string());
    let result = payments::record_payment(&pool, actor_id, retry).await;

    cleanup_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;

    assert!(
        matches!(result, Err(ApiError::Conflict(_))),
        "a null legacy fingerprint must fail closed: {result:?}"
    );
}

/// A reused key represents one request only: changing an amount must conflict
/// even when the changed amount would otherwise still fit the balance.
#[tokio::test]
async fn record_payment_rejects_changed_payload_for_existing_idempotency_key() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_320, 940_321, 940_322, 940_323, 940_324);
    seed_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;

    let mut original = payment_request(booking_id, 100.0, "payment-char-940324-conflict");
    original.transaction_reference = Some("PAY-940324".to_string());
    original.notes = Some("Original desk payment".to_string());
    original.payment_date = Some("2031-06-20".to_string());
    payments::record_payment(&pool, actor_id, original)
        .await
        .expect("the original payment must succeed");
    let mut changed_amount = payment_request(booking_id, 200.0, "payment-char-940324-conflict");
    changed_amount.transaction_reference = Some("PAY-940324".to_string());
    changed_amount.notes = Some("Original desk payment".to_string());
    changed_amount.payment_date = Some("2031-06-20".to_string());
    let changed_amount = payments::record_payment(&pool, actor_id, changed_amount).await;
    let mut changed_method = payment_request(booking_id, 100.0, "payment-char-940324-conflict");
    changed_method.payment_method = "card".to_string();
    changed_method.transaction_reference = Some("PAY-940324".to_string());
    changed_method.notes = Some("Original desk payment".to_string());
    changed_method.payment_date = Some("2031-06-20".to_string());
    let changed_method = payments::record_payment(&pool, actor_id, changed_method).await;
    let mut changed_type = payment_request(booking_id, 100.0, "payment-char-940324-conflict");
    changed_type.payment_type = Some("deposit".to_string());
    changed_type.transaction_reference = Some("PAY-940324".to_string());
    changed_type.notes = Some("Original desk payment".to_string());
    changed_type.payment_date = Some("2031-06-20".to_string());
    let changed_type = payments::record_payment(&pool, actor_id, changed_type).await;
    let mut changed_reference = payment_request(booking_id, 100.0, "payment-char-940324-conflict");
    changed_reference.transaction_reference = Some("PAY-940324-changed".to_string());
    changed_reference.notes = Some("Original desk payment".to_string());
    changed_reference.payment_date = Some("2031-06-20".to_string());
    let changed_reference = payments::record_payment(&pool, actor_id, changed_reference).await;
    let mut changed_notes = payment_request(booking_id, 100.0, "payment-char-940324-conflict");
    changed_notes.transaction_reference = Some("PAY-940324".to_string());
    changed_notes.notes = Some("Changed desk payment".to_string());
    changed_notes.payment_date = Some("2031-06-20".to_string());
    let changed_notes = payments::record_payment(&pool, actor_id, changed_notes).await;
    let mut changed_date = payment_request(booking_id, 100.0, "payment-char-940324-conflict");
    changed_date.transaction_reference = Some("PAY-940324".to_string());
    changed_date.notes = Some("Original desk payment".to_string());
    changed_date.payment_date = Some("2031-06-21".to_string());
    let changed_date = payments::record_payment(&pool, actor_id, changed_date).await;
    let (stored_key, stored_fingerprint): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT idempotency_key, idempotency_fingerprint FROM payments WHERE booking_id = $1",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (payment_count, payment_total): (i64, Decimal) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM payments WHERE booking_id = $1",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    cleanup_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;

    for (field, result) in [
        ("amount", &changed_amount),
        ("method", &changed_method),
        ("type", &changed_type),
        ("reference", &changed_reference),
        ("notes", &changed_notes),
        ("requested date", &changed_date),
    ] {
        assert!(
            matches!(result, Err(ApiError::Conflict(_))),
            "reusing a key with a changed {field} must return Conflict: {result:?}"
        );
    }
    assert_eq!(payment_count, 1);
    assert_eq!(payment_total, d("100.00"));
    assert_eq!(stored_key.as_deref(), Some("payment-char-940324-conflict"));
    assert_eq!(stored_fingerprint.as_deref().map(str::len), Some(64));
}

/// Separate keys remain valid for legitimate installments and may settle the
/// same booking together.
#[tokio::test]
async fn record_payment_allows_installments_with_different_idempotency_keys() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_330, 940_331, 940_332, 940_333, 940_334);
    seed_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;

    payments::record_payment(
        &pool,
        actor_id,
        payment_request(booking_id, 100.0, "payment-char-940334-installment-a"),
    )
    .await
    .expect("the first installment must succeed");
    payments::record_payment(
        &pool,
        actor_id,
        payment_request(booking_id, 200.0, "payment-char-940334-installment-b"),
    )
    .await
    .expect("the second installment must succeed");
    let (payment_count, payment_total): (i64, Decimal) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM payments WHERE booking_id = $1",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (_, payment_status) = fetch_booking_status(&pool, booking_id).await;

    cleanup_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;

    assert_eq!(payment_count, 2, "each installment must retain its own row");
    assert_eq!(payment_total, d("300.00"));
    assert_eq!(payment_status, "paid");
}

/// The older completed-payment path must use the same replay rule before its
/// legacy completed-payment guard, and must not emit duplicate side effects.
#[tokio::test]
async fn create_payment_replays_an_exact_idempotency_key() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_340, 940_341, 940_342, 940_343, 940_344);
    seed_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;

    let first = payments::create_payment(
        &pool,
        actor_id,
        PaymentRequest {
            booking_id,
            payment_method: PaymentMethod::Cash,
            amount: Some(300.0),
            transaction_reference: Some("PAY-940344".to_string()),
            card_last_four: None,
            card_brand: None,
            bank_name: None,
            account_reference: None,
            notes: Some("Desk payment".to_string()),
            idempotency_key: "  payment-char-940344-completed  ".to_string(),
        },
    )
    .await
    .expect("the original completed payment must succeed");
    let retry = payments::create_payment(
        &pool,
        actor_id,
        PaymentRequest {
            booking_id,
            payment_method: PaymentMethod::Cash,
            amount: Some(300.0),
            transaction_reference: Some("PAY-940344".to_string()),
            card_last_four: None,
            card_brand: None,
            bank_name: None,
            account_reference: None,
            notes: Some("Desk payment".to_string()),
            idempotency_key: "payment-char-940344-completed".to_string(),
        },
    )
    .await;
    let payment_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs \
         WHERE action = 'payment_created' AND resource_type = 'payment' \
           AND (details->>'booking_id')::bigint = $1",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    cleanup_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;

    let retry = retry.expect("an exact completed-payment retry must replay the original");
    assert_eq!(first.id, retry.id);
    assert_eq!(payment_count, 1);
    assert_eq!(
        audit_count, 1,
        "a completed-payment replay cannot repeat its audit event"
    );
}

/// The legacy completed-payment insert and booking recompute are one atomic
/// unit. A forced recompute failure must leave no replay row behind; after the
/// trigger is removed, retrying the same request must perform the full workflow.
#[tokio::test]
async fn create_payment_rolls_back_when_booking_recompute_fails_then_retry_repairs() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_760, 940_761, 940_762, 940_763, 940_764);
    seed_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;
    install_booking_recompute_failure(&pool, booking_id).await;

    let make_request = || PaymentRequest {
        booking_id,
        payment_method: PaymentMethod::Cash,
        amount: Some(300.0),
        transaction_reference: Some("PAY-940764".to_string()),
        card_last_four: None,
        card_brand: None,
        bank_name: None,
        account_reference: None,
        notes: Some("Atomic legacy payment".to_string()),
        idempotency_key: "payment-char-940764-atomic".to_string(),
    };

    let failed = payments::create_payment(&pool, actor_id, make_request()).await;
    let rows_after_failure: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    remove_booking_recompute_failure(&pool)
        .await
        .expect("the forced recompute failure trigger must be removed");

    let retried = payments::create_payment(&pool, actor_id, make_request()).await;
    let payment_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM payments WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let (_, payment_status) = fetch_booking_status(&pool, booking_id).await;

    cleanup_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;

    assert!(
        matches!(failed, Err(ApiError::Database(_))),
        "the forced recompute failure must surface: {failed:?}"
    );
    assert_eq!(
        rows_after_failure, 0,
        "the insert must roll back with recompute"
    );
    assert!(
        retried.is_ok(),
        "the same request must succeed after repair: {retried:?}"
    );
    assert_eq!(payment_count, 1);
    assert_eq!(payment_status, "paid");
}

/// (2) `approve_payment`: only transitions a `pending` payment to
/// `completed`, confirms the booking, and recomputes `payment_status`. A
/// second approval attempt on the now-`completed` payment must be refused.
#[tokio::test]
async fn approve_payment_only_transitions_from_pending() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let actor_id = 940_220;
    let room_type_id = 940_221;
    let room_id = 940_222;
    let guest_id = 940_223;
    let booking_id = 940_224;

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "pending_payment",
            check_in: "2031-06-03",
            check_out: "2031-06-04",
            base_price: d("100.00"),
            subtotal: d("100.00"),
            total_amount: d("250.00"),
        },
    )
    .await;

    let payment_id = insert_pending_payment(
        &pool,
        booking_id,
        "bank_transfer",
        "booking",
        d("250.00"),
        actor_id,
    )
    .await;

    let approved = payments::approve_payment(&pool, actor_id, payment_id)
        .await
        .expect("approving a pending payment should succeed");
    assert_eq!(approved.payment_id, payment_id);
    assert_eq!(approved.status, "completed");
    assert_eq!(approved.booking_status.as_deref(), Some("confirmed"));

    assert_eq!(fetch_payment_status(&pool, payment_id).await, "completed");
    let (status, payment_status) = fetch_booking_status(&pool, booking_id).await;
    assert_eq!(status, "confirmed");
    assert_eq!(payment_status, "paid");
    assert!(audit_log_exists(&pool, "payment_approved", payment_id).await);

    let second = payments::approve_payment(&pool, actor_id, payment_id).await;
    assert!(
        matches!(second, Err(ApiError::BadRequest(_))),
        "approving an already-completed payment must be refused: {second:?}"
    );

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
}

/// (3) `reject_payment`: requires a non-empty reason, transitions a `pending`
/// payment to `void`, returns a `pending_confirmation` booking to
/// `pending_payment`, and never counts the rejected amount as collected
/// money. A second rejection attempt on the now-`void` payment is refused.
#[tokio::test]
async fn reject_payment_requires_reason_and_never_moves_money() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let actor_id = 940_230;
    let room_type_id = 940_231;
    let room_id = 940_232;
    let guest_id = 940_233;
    let booking_id = 940_234;

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "pending_confirmation",
            check_in: "2031-06-05",
            check_out: "2031-06-06",
            base_price: d("100.00"),
            subtotal: d("100.00"),
            total_amount: d("300.00"),
        },
    )
    .await;

    let payment_id = insert_pending_payment(
        &pool,
        booking_id,
        "bank_transfer",
        "booking",
        d("180.00"),
        actor_id,
    )
    .await;

    let empty_reason = payments::reject_payment(&pool, actor_id, payment_id, "   ").await;
    assert!(
        matches!(empty_reason, Err(ApiError::BadRequest(_))),
        "an empty rejection reason must be refused: {empty_reason:?}"
    );
    assert_eq!(
        fetch_payment_status(&pool, payment_id).await,
        "pending",
        "a failed rejection attempt must not change payment state"
    );

    let rejected = payments::reject_payment(&pool, actor_id, payment_id, "Illegible receipt")
        .await
        .expect("rejecting a pending payment with a reason should succeed");
    assert_eq!(rejected.payment_id, payment_id);
    assert_eq!(rejected.status, "void");
    assert_eq!(rejected.booking_status.as_deref(), Some("pending_payment"));

    assert_eq!(fetch_payment_status(&pool, payment_id).await, "void");
    let (status, _payment_status) = fetch_booking_status(&pool, booking_id).await;
    assert_eq!(
        status, "pending_payment",
        "a rejected claim returns the booking to pending_payment"
    );

    let history = latest_booking_history(&pool, booking_id).await;
    assert_eq!(
        history,
        Some((
            Some("pending_confirmation".to_string()),
            "pending_payment".to_string()
        ))
    );

    let summary = PaymentRepository::workflow_summary_row(&pool, booking_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        summary.total_paid,
        Decimal::ZERO,
        "a rejected payment must never be counted as collected money"
    );

    assert!(audit_log_exists(&pool, "payment_rejected", payment_id).await);

    let second = payments::reject_payment(&pool, actor_id, payment_id, "Second attempt").await;
    assert!(
        matches!(second, Err(ApiError::BadRequest(_))),
        "rejecting an already-void payment must be refused: {second:?}"
    );

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
}

/// (4) `refund_deposit` / `revert_deposit_refund` round-trip: a zero amount is
/// rejected; a valid refund of an amount <= a REAL, collected deposit inserts
/// a `refund`/`refunded` payment row and is reflected in the live workflow
/// summary; a second refund attempt on the same booking is rejected (one
/// outstanding refund at a time); reverting deletes the refund row; and
/// reverting again (nothing left) is rejected.
///
/// The room type's `keycard_deposit_amount` is set to 50.00 and a real
/// `completed` deposit payment for 50.00 is recorded via the actual
/// `payments::record_payment` code path (payment_type = "deposit") BEFORE the
/// refund, so the round-trip refunds an amount that was genuinely collected --
/// see the sibling `#[ignore]`d test below for the currently-missing guards
/// that this test must NOT (and does not) rely on.
#[tokio::test]
async fn refund_deposit_and_revert_round_trip() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let actor_id = 940_240;
    let room_type_id = 940_241;
    let room_id = 940_242;
    let guest_id = 940_243;
    let booking_id = 940_244;

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "confirmed",
            check_in: "2031-06-07",
            check_out: "2031-06-08",
            base_price: d("100.00"),
            subtotal: d("100.00"),
            total_amount: d("300.00"),
        },
    )
    .await;

    // A real held deposit: the room type actually charges a 50.00 keycard
    // deposit, and a genuine completed deposit payment for that amount is
    // recorded through the real `record_payment` code path (payment_type =
    // "deposit" skips the booking-balance guard by design -- see
    // services/payments.rs::record_payment) so the refund below has real
    // money behind it instead of refunding a deposit that was never collected.
    sqlx::query("UPDATE room_types SET keycard_deposit_amount = $1 WHERE id = $2")
        .bind(d("50.00"))
        .bind(room_type_id)
        .execute(&pool)
        .await
        .unwrap();
    payments::record_payment(
        &pool,
        actor_id,
        RecordPaymentRequest {
            booking_id,
            amount: 50.0,
            payment_method: "cash".to_string(),
            payment_type: Some("deposit".to_string()),
            transaction_reference: None,
            notes: None,
            payment_date: None,
            idempotency_key: "payment-char-deposit-refund".to_string(),
        },
    )
    .await
    .expect("seeding a real collected 50.00 deposit should succeed");

    let zero_amount = payments::refund_deposit(
        &pool,
        actor_id,
        booking_id,
        serde_json::json!({"payment_method": "cash", "amount": 0}),
    )
    .await;
    assert!(
        matches!(zero_amount, Err(ApiError::BadRequest(_))),
        "a zero deposit amount must be rejected: {zero_amount:?}"
    );

    let refund = payments::refund_deposit(
        &pool,
        actor_id,
        booking_id,
        serde_json::json!({"payment_method": "cash", "amount": 50.0}),
    )
    .await
    .expect("refunding a deposit should succeed");
    assert_eq!(
        refund.get("total_amount").unwrap().as_str().unwrap(),
        "50.00"
    );
    assert_eq!(
        refund.get("payment_method").unwrap().as_str().unwrap(),
        "cash"
    );
    assert_eq!(
        refund.get("payment_type").unwrap().as_str().unwrap(),
        "refund"
    );
    assert_eq!(
        refund.get("payment_status").unwrap().as_str().unwrap(),
        "refunded"
    );
    assert_eq!(
        refund.get("notes").unwrap().as_str().unwrap(),
        "Keycard deposit refund"
    );
    let refund_payment_id = refund.get("id").unwrap().as_i64().unwrap();

    let summary_after_refund = PaymentRepository::workflow_summary_row(&pool, booking_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(summary_after_refund.total_refunded, d("50.00"));
    assert_eq!(summary_after_refund.deposit_refunded, d("50.00"));

    assert!(audit_log_exists(&pool, "payment_refunded", refund_payment_id).await);

    let duplicate = payments::refund_deposit(
        &pool,
        actor_id,
        booking_id,
        serde_json::json!({"payment_method": "cash", "amount": 30.0}),
    )
    .await;
    assert!(
        matches!(duplicate, Err(ApiError::BadRequest(_))),
        "refunding a deposit twice on the same booking must be rejected: {duplicate:?}"
    );

    let revert = payments::revert_deposit_refund(&pool, actor_id, booking_id)
        .await
        .expect("reverting the refund should succeed");
    assert_eq!(
        revert.get("reverted_payment_id").unwrap().as_i64().unwrap(),
        refund_payment_id
    );
    assert!(!revert.get("deposit_refunded").unwrap().as_bool().unwrap());

    let remaining: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM payments WHERE booking_id = $1 AND payment_type = 'refund'",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(remaining, 0, "the reverted refund row must be deleted");

    assert!(audit_log_exists(&pool, "payment_refund_reverted", refund_payment_id).await);

    let revert_again = payments::revert_deposit_refund(&pool, actor_id, booking_id).await;
    assert!(
        matches!(revert_again, Err(ApiError::BadRequest(_))),
        "reverting when there is no outstanding refund must be rejected: {revert_again:?}"
    );

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
}

/// (KNOWN BUG -- ignored) `refund_deposit` must refuse to refund a keycard
/// deposit that was never collected, AND must refuse to refund more than the
/// amount actually held. Neither check exists today: `refund_deposit`
/// (`src/services/payments.rs:390-419`) only checks that the requested amount
/// is positive, and `PaymentRepository::refund_deposit`
/// (`src/repositories/payment.rs:785-829`) only checks whether a refund has
/// already been recorded for this booking -- nothing verifies a deposit was
/// ever held, nor bounds the refund by `room_types.keycard_deposit_amount` /
/// the booking's completed deposit payments. As written, BOTH scenarios below
/// currently SUCCEED, i.e. an unbounded cash payout. Do not assert the
/// current (succeeds) behavior.
#[tokio::test]
#[ignore = "refund_deposit (src/services/payments.rs:390-419) and PaymentRepository::refund_deposit (src/repositories/payment.rs:785-829) never verify a deposit was ever collected and never bound the refund by the amount actually held -- refunding with zero deposit collected, and refunding more than the collected deposit, both currently succeed as an unbounded cash payout; pending fix: bound refund_deposit by the booking's completed deposit payments / room_types.keycard_deposit_amount"]
async fn refund_deposit_refuses_when_no_deposit_held_or_amount_exceeds_it() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let actor_id = 940_290;
    let room_type_id = 940_291;
    let room_id = 940_292;
    let guest_id = 940_293;
    let booking_id = 940_294;

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "confirmed",
            check_in: "2031-06-18",
            check_out: "2031-06-19",
            base_price: d("100.00"),
            subtotal: d("100.00"),
            total_amount: d("300.00"),
        },
    )
    .await;
    sqlx::query("UPDATE room_types SET keycard_deposit_amount = $1 WHERE id = $2")
        .bind(d("50.00"))
        .bind(room_type_id)
        .execute(&pool)
        .await
        .unwrap();

    // Scenario A: no deposit payment was ever collected for this booking.
    let no_deposit_held = payments::refund_deposit(
        &pool,
        actor_id,
        booking_id,
        serde_json::json!({"payment_method": "cash", "amount": 50.0}),
    )
    .await;

    // Scenario B: a deposit WAS collected (real, via the real record_payment
    // code path, same as the sibling non-ignored test above), but the refund
    // request exceeds it.
    payments::record_payment(
        &pool,
        actor_id,
        RecordPaymentRequest {
            booking_id,
            amount: 50.0,
            payment_method: "cash".to_string(),
            payment_type: Some("deposit".to_string()),
            transaction_reference: None,
            notes: None,
            payment_date: None,
            idempotency_key: "payment-char-deposit-over-limit".to_string(),
        },
    )
    .await
    .expect("seeding a real collected 50.00 deposit should succeed");

    let over_the_amount_held = payments::refund_deposit(
        &pool,
        actor_id,
        booking_id,
        serde_json::json!({"payment_method": "cash", "amount": 999.0}),
    )
    .await;

    // Clean up BEFORE asserting: this test is expected to fail (that is the
    // point of `#[ignore]`ing a known bug), and an assertion panic must not
    // skip teardown and leak fixture rows on a persistent, shared database.
    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;

    assert!(
        matches!(no_deposit_held, Err(ApiError::BadRequest(_))),
        "refunding a deposit that was never collected must be refused: {no_deposit_held:?}"
    );
    assert!(
        matches!(over_the_amount_held, Err(ApiError::BadRequest(_))),
        "refunding more than the collected deposit must be refused: {over_the_amount_held:?}"
    );
}

/// (5) `capture_paypal_payment` -- covers every boundary reachable WITHOUT a
/// real network call to PayPal (`services::paypal_client::capture_order`):
/// a payment/booking mismatch is rejected before the gateway is ever
/// contacted; an already-`completed` payment returns success as a safe retry
/// (also without contacting the gateway); and a payment that is neither
/// pending/processing nor completed is rejected outright. The actual
/// successful-capture path (status confirmed via a real PayPal API call) is
/// NOT reachable here -- see the reported blocker.
#[tokio::test]
async fn capture_paypal_payment_boundary_checks_without_network() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let actor_id = 940_260;
    let room_type_id = 940_261;
    let room_a = 940_262;
    let room_b = 940_263;
    let guest_a = 940_264;
    let guest_b = 940_265;
    let booking_a = 940_266;
    let booking_b = 940_267;

    cleanup(
        &pool,
        &[room_type_id],
        &[room_a, room_b],
        &[guest_a, guest_b],
        &[booking_a, booking_b],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id: room_a,
            guest_id: guest_a,
            booking_id: booking_a,
            actor_id,
            status: "pending_payment",
            check_in: "2031-06-09",
            check_out: "2031-06-10",
            base_price: d("100.00"),
            subtotal: d("100.00"),
            total_amount: d("100.00"),
        },
    )
    .await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id: room_b,
            guest_id: guest_b,
            booking_id: booking_b,
            actor_id,
            status: "pending_payment",
            check_in: "2031-06-11",
            check_out: "2031-06-12",
            base_price: d("100.00"),
            subtotal: d("150.00"),
            total_amount: d("150.00"),
        },
    )
    .await;

    let payment_id =
        insert_pending_payment(&pool, booking_a, "paypal", "booking", d("100.00"), actor_id).await;

    let booking_a_row = BookingRepository::find_by_id(&pool, booking_a)
        .await
        .unwrap()
        .expect("booking A must exist");
    let booking_b_row = BookingRepository::find_by_id(&pool, booking_b)
        .await
        .unwrap()
        .expect("booking B must exist");

    let mismatch =
        payments::capture_paypal_payment(&pool, &booking_b_row, "ORDER-MISMATCH", payment_id).await;
    assert!(
        matches!(mismatch, Err(ApiError::Forbidden(_))),
        "a payment that does not belong to the given booking must be rejected before contacting PayPal: {mismatch:?}"
    );

    sqlx::query("UPDATE payments SET status = 'completed' WHERE id = $1")
        .bind(payment_id)
        .execute(&pool)
        .await
        .unwrap();
    let retry = payments::capture_paypal_payment(&pool, &booking_a_row, "ORDER-RETRY", payment_id)
        .await
        .expect("re-capturing an already-completed payment must succeed as a safe retry");
    assert_eq!(retry.payment_id, payment_id);
    assert_eq!(retry.status, "completed");

    sqlx::query("UPDATE payments SET status = 'void' WHERE id = $1")
        .bind(payment_id)
        .execute(&pool)
        .await
        .unwrap();
    let unavailable =
        payments::capture_paypal_payment(&pool, &booking_a_row, "ORDER-VOID", payment_id).await;
    assert!(
        matches!(unavailable, Err(ApiError::BadRequest(_))),
        "a void payment must not be available for capture: {unavailable:?}"
    );

    cleanup(
        &pool,
        &[room_type_id],
        &[room_a, room_b],
        &[guest_a, guest_b],
        &[booking_a, booking_b],
        &[actor_id],
    )
    .await;
}

/// (6, KNOWN BUG -- ignored) `create_payment` must charge the booking's
/// `billable_total()` (decided-correct total per the ledger/payment audit),
/// not `calculate_payment_summary`'s room-only `base_price * nights`
/// recalculation. This booking's fixture deliberately makes the two figures
/// disagree (500.00 billable vs. 200.00 room-only) so the bug cannot pass by
/// accident. Currently FAILS (repositories/payment.rs:229 binds
/// `summary.total_amount`) -- do not assert the current wrong value.
#[tokio::test]
#[ignore = "create_payment/calculate_payment_summary charges a room-only base_price*nights recalculation instead of the decided-correct billable_total() (booking.total_amount + tourism_tax_amount + extra_bed_charge); PaymentRequest.amount is also silently discarded (repositories/payment.rs:229 binds summary.total_amount, never request.amount) -- pending fix: unify the invoice/payment total calculators"]
async fn create_payment_should_charge_the_billable_total_not_the_room_recalculation() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let actor_id = 940_270;
    let room_type_id = 940_271;
    let room_id = 940_272;
    let guest_id = 940_273;
    let booking_id = 940_274;

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "confirmed",
            check_in: "2031-06-13",
            check_out: "2031-06-15", // 2 nights
            base_price: d("100.00"),
            subtotal: d("200.00"),
            total_amount: d("500.00"),
        },
    )
    .await;

    let request = PaymentRequest {
        booking_id,
        payment_method: PaymentMethod::Card,
        amount: Some(500.0),
        transaction_reference: None,
        card_last_four: None,
        card_brand: None,
        bank_name: None,
        account_reference: None,
        notes: None,
        idempotency_key: "payment-char-completed-payment".to_string(),
    };

    let payment_result = payments::create_payment(&pool, actor_id, request).await;

    // Clean up BEFORE asserting: this test is expected to fail (that is the
    // point of `#[ignore]`ing a known bug), and an assertion panic must not
    // skip teardown and leak fixture rows on a persistent, shared database.
    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;

    let payment =
        payment_result.expect("create_payment should succeed against a live booking fixture");
    assert_eq!(
        payment.total_amount,
        d("500.00"),
        "create_payment must charge the booking's billable_total(), not calculate_payment_summary's room-only recalculation"
    );
}

/// (7, KNOWN BUG -- ignored) `approve_payment` must refuse to confirm a
/// payment whose capture was never verified with the gateway. Currently it
/// unconditionally marks any pending payment `completed` regardless of
/// method or gateway evidence, so this assertion FAILS today -- do not
/// assert the current (succeeds) behavior.
///
/// Verified in src that NO such guard exists anywhere today: `approve_payment`
/// (`src/services/payments.rs:1409-1430`) only checks
/// `review.status != "pending"` before calling `complete_and_confirm`, which
/// itself (`src/services/payments.rs:1548-1607`) only guards against a second
/// completed booking payment and a payment that is no longer pending -- grepped
/// the whole crate for "verified"/"unverified" and found no gateway-capture
/// guard on this path. This assertion therefore does not match an existing
/// message; it pins the SPECIFICATION the fix must satisfy: the error must be
/// an `ApiError::BadRequest` (never a permission-layer `Forbidden`, and never
/// the generic `Internal`/`Database` variant a transaction failure would
/// produce) whose message names the actual defect (mentions "captur" and
/// "verif"), so a fix that merely starts failing for an unrelated reason
/// cannot make this test pass by accident.
#[tokio::test]
#[ignore = "approve_payment (src/services/payments.rs:1409) completes a pending payment without re-verifying the gateway capture, so it can confirm a payment for which no money was ever collected; decided-correct behavior is to refuse approval unless the capture is verified -- pending fix: re-query the gateway in approve_payment before confirming, returning ApiError::BadRequest with a message that mentions the capture not being verified"]
async fn approve_payment_refuses_when_capture_is_not_verified() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let actor_id = 940_280;
    let room_type_id = 940_281;
    let room_id = 940_282;
    let guest_id = 940_283;
    let booking_id = 940_284;

    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(
        &pool,
        &BookingFixture {
            room_type_id,
            room_id,
            guest_id,
            booking_id,
            actor_id,
            status: "pending_payment",
            check_in: "2031-06-16",
            check_out: "2031-06-17",
            base_price: d("100.00"),
            subtotal: d("100.00"),
            total_amount: d("200.00"),
        },
    )
    .await;

    // A pending PayPal payment with no evidence the gateway ever captured
    // funds -- exactly what an unverified/forged approval attempt looks like.
    let payment_id = insert_pending_payment(
        &pool,
        booking_id,
        "paypal",
        "booking",
        d("200.00"),
        actor_id,
    )
    .await;

    let result = payments::approve_payment(&pool, actor_id, payment_id).await;

    // Clean up BEFORE asserting -- see the comment in the sibling ignored
    // test above; this assertion is expected to fail today.
    cleanup(
        &pool,
        &[room_type_id],
        &[room_id],
        &[guest_id],
        &[booking_id],
        &[actor_id],
    )
    .await;

    // Assert on the error TYPE and MESSAGE content, not bare is_err()/Err(_):
    // a permission failure (ApiError::Forbidden) or a transaction failure
    // (ApiError::Internal/Database) would also satisfy a bare is_err() check
    // without the intended gateway-capture guard ever having fired.
    match result {
        Err(ApiError::BadRequest(msg)) => {
            let lower = msg.to_lowercase();
            assert!(
                lower.contains("captur") && lower.contains("verif"),
                "approve_payment refused approval, but not for the intended reason (expected a message about the capture not being verified): {msg:?}"
            );
        }
        other => panic!(
            "approve_payment must refuse to confirm a payment whose capture was never verified with the gateway via an ApiError::BadRequest naming the defect, got: {other:?}"
        ),
    }
}
