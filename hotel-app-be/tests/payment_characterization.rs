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
use hotel_app_be::models::{PaymentRequest, RecordPaymentRequest};
use hotel_app_be::repositories::booking::BookingRepository;
use hotel_app_be::repositories::payment::PaymentRepository;
use hotel_app_be::services::payments;
use rust_decimal::Decimal;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::str::FromStr;

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
