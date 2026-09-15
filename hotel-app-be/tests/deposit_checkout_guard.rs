//! Integration tests for the checkout deposit guard in
//! `repositories::bookings::lifecycle::ensure_checkout_balance_resolved`
//! (spec: `docs/superpowers/specs/2026-09-13-deposit-checkout-guard-design.md`).
//!
//! A `checked_out`/`completed` transition through `update_booking_handler` —
//! the single entry point every caller (Bookings page, Rooms grid, ledger
//! view, direct API) funnels through — must be rejected while a held deposit
//! is unresolved:
//!
//! ```text
//! deposit_held = max(Σ deposit/completed rows, mirror assertion)
//! unresolved   = max(deposit_held − deposit_refunded − deposit_forfeited, 0)
//! ```
//!
//! The mirror (`bookings.deposit_paid`/`deposit_amount`) can only ADD a block
//! — flag-only legacy deposits with no payment rows behind them still block —
//! it never mints refundable money. The deposit check is NOT exempted by
//! company billing, and a waive folded into the checkout request itself does
//! not satisfy it: the guard reads pre-update state, so resolution (refund /
//! forfeit / waive) is a separate prior call.
//!
//! This file also covers deposit record-path method binding: a
//! `deposit_payment_method` on the update payload — the tender the desk
//! actually collected — is what lands on the minted deposit payment row,
//! falling back to the booking-level `payment_method` when absent or blank.
//!
//! Requires `DATABASE_URL` (PostgreSQL); tests skip gracefully without it,
//! the same convention as tests/booking_service.rs / tests/ledger_service.rs.
//!
//! Fixture IDs live in the 987_xxx block (verified unused across tests/*.rs
//! before writing this file): actors 987_0xx, bookings 987_1xx, guests
//! 987_2xx, rooms 987_3xx, room_types 987_4xx.

use axum::Json;
use axum::extract::{Extension, Path, State};
use hotel_app_be::core::error::ApiError;
use hotel_app_be::models::{Booking, BookingUpdateInput};
use hotel_app_be::modules::payments::repository::PaymentRepository;
use hotel_app_be::modules::bookings::service as bookings;
use rust_decimal::Decimal;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::str::FromStr;

/// Parse a decimal literal for test fixtures/assertions.
fn d(s: &str) -> Decimal {
    Decimal::from_str(s).unwrap()
}

// Serializes test fns within THIS binary against the other PostgreSQL
// workflow files (same pattern as tests/booking_service.rs /
// tests/payment_characterization.rs).
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
                "Skipping PostgreSQL deposit-checkout-guard test because DATABASE_URL is not set"
            );
            return None;
        }
    };
    let guard = pg_serial_lock().lock_owned().await;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        // The baseline's append-only trigger on audit_logs forbids the fixture
        // cleanups below; test pools opt out session-locally.
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET app.allow_audit_mutation = 'on'")
                    .execute(conn)
                    .await
                    .map(|_| ())
            })
        })
        .connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL test database");

    // A successful checkout queues a transactional receipt email whose footer
    // reads process config (public base URL + token secret). Production always
    // initializes config at startup; mirror that here.
    if std::env::var("SETTINGS_CACHE_TTL_SECS").is_err() {
        // SAFETY: single-test binary; no concurrent environment readers.
        unsafe { std::env::set_var("SETTINGS_CACHE_TTL_SECS", "0") };
    }
    if std::env::var("JWT_SECRET").is_err() {
        // SAFETY: single-test binary; no concurrent environment readers.
        unsafe {
            std::env::set_var("JWT_SECRET", "test-secret-test-secret-test-secret");
        }
    }
    hotel_app_be::core::config::init_from_env().expect("test config initialises from env");

    Some((pool, guard))
}

/// `update_booking_handler` checks `bookings:update`/`bookings:manage`
/// internally, so the fixture actor needs them granted via a role.
async fn ensure_admin_actor(pool: &PgPool, actor_id: i64) {
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
    .bind(format!("dcg987_actor_{actor_id}"))
    .bind(format!("dcg987-actor-{actor_id}@hotel.local"))
    .bind(format!("Deposit Guard Actor {actor_id}"))
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
    hotel_app_be::core::rbac_cache::invalidate_all();
}

/// Fixture ids for one booking (plus its room/room_type/guest). `company_name`
/// attaches city-ledger billing, which exempts the bill-balance check but —
/// per spec — must never exempt the deposit check.
struct CheckoutFixture {
    actor_id: i64,
    booking_id: i64,
    guest_id: i64,
    room_id: i64,
    room_type_id: i64,
    company_name: Option<&'static str>,
}

/// Seeds a `checked_in` booking owing 300.00 of room charges (150.00 x 2
/// nights), plus its room/room_type/guest. `tourism_type` is pinned 'local'
/// so `trg_enforce_booking_tourism_tax` always computes tourism_tax_amount = 0
/// and `billable_total() == total_amount` — the deposit check can then be
/// isolated from the balance check by settling exactly 300.00.
async fn seed_checked_in_booking(pool: &PgPool, f: &CheckoutFixture) {
    ensure_admin_actor(pool, f.actor_id).await;
    sqlx::query(
        "INSERT INTO room_types (id, code, name, base_price, max_occupancy, keycard_deposit_amount) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 150.00, 2, 0) \
         ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, base_price = EXCLUDED.base_price, keycard_deposit_amount = 0",
    )
    .bind(f.room_type_id)
    .bind(format!("DCGRT{}", f.room_type_id))
    .bind(format!("Deposit Guard Room Type {}", f.room_type_id))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO rooms (id, room_number, room_type_id, status) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'occupied') \
         ON CONFLICT (id) DO UPDATE SET room_number = EXCLUDED.room_number, room_type_id = EXCLUDED.room_type_id, status = 'occupied'",
    )
    .bind(f.room_id)
    .bind(format!("DCG{}", f.room_id))
    .bind(f.room_type_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO guests (id, nick_name, first_name, last_name, email, tourism_type) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'DepositGuard', $3, $4, 'local') \
         ON CONFLICT (id) DO UPDATE SET nick_name = EXCLUDED.nick_name, tourism_type = 'local'",
    )
    .bind(f.guest_id)
    .bind(format!("Deposit Guard Guest {}", f.guest_id))
    .bind(format!("Guest{}", f.guest_id))
    .bind(format!("dcg987-guest-{}@hotel.local", f.guest_id))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO bookings (
            id, booking_number, guest_id, guest_name, guest_email, room_id,
            check_in_date, check_out_date, adults, children,
            room_rate, subtotal, total_amount, status, payment_status,
            company_name, created_by
         )
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6,
                 '2031-07-10', '2031-07-12', 1, 0,
                 150.00, 300.00, 300.00, 'checked_in', 'unpaid', $7, $8)
         ON CONFLICT (id) DO UPDATE SET
            guest_id = EXCLUDED.guest_id,
            room_id = EXCLUDED.room_id,
            check_in_date = EXCLUDED.check_in_date,
            check_out_date = EXCLUDED.check_out_date,
            room_rate = EXCLUDED.room_rate,
            subtotal = EXCLUDED.subtotal,
            total_amount = EXCLUDED.total_amount,
            status = 'checked_in',
            payment_status = 'unpaid',
            company_id = NULL,
            company_name = EXCLUDED.company_name,
            deposit_paid = false,
            deposit_amount = NULL,
            deposit_paid_at = NULL,
            actual_check_out = NULL",
    )
    .bind(f.booking_id)
    .bind(format!("BK-DCG-{}", f.booking_id))
    .bind(f.guest_id)
    .bind(format!("Deposit Guard Guest {}", f.guest_id))
    .bind(format!("dcg987-guest-{}@hotel.local", f.guest_id))
    .bind(f.room_id)
    .bind(f.company_name)
    .bind(f.actor_id)
    .execute(pool)
    .await
    .unwrap();
}

/// Children before parents. `room_status_change_log` has no `ON DELETE` clause
/// on its room_id FK so it must be cleared explicitly; `invoices` /
/// `housekeeping_tasks` / `customer_ledgers` rows a successful checkout writes
/// are cleaned by booking_id/room_id.
async fn cleanup_fixture(pool: &PgPool, f: &CheckoutFixture) {
    sqlx::query(
        "DELETE FROM audit_logs WHERE resource_type = 'payment' AND resource_id IN \
         (SELECT id FROM payments WHERE booking_id = $1)",
    )
    .bind(f.booking_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1")
        .bind(f.booking_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM payments WHERE booking_id = $1")
        .bind(f.booking_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "DELETE FROM customer_ledger_payments WHERE ledger_id IN \
         (SELECT id FROM customer_ledgers WHERE booking_id = $1)",
    )
    .bind(f.booking_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM customer_ledgers WHERE booking_id = $1")
        .bind(f.booking_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM invoices WHERE booking_id = $1")
        .bind(f.booking_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM booking_modifications WHERE booking_id = $1")
        .bind(f.booking_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM booking_history WHERE booking_id = $1")
        .bind(f.booking_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM bookings WHERE id = $1")
        .bind(f.booking_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM housekeeping_tasks WHERE room_id = $1")
        .bind(f.room_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
        .bind(f.room_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM rooms WHERE id = $1")
        .bind(f.room_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM room_types WHERE id = $1")
        .bind(f.room_type_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM guests WHERE id = $1")
        .bind(f.guest_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
        .bind(f.actor_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(f.actor_id)
        .execute(pool)
        .await
        .unwrap();
}

/// A `completed` ledger row of the given type — 'booking' settles the bill,
/// 'deposit' is held collateral. Inserted directly (the same shape
/// `reconcile_booking_deposit_tx` mints) so tests don't depend on the
/// record-payment path's own guards.
async fn insert_completed_payment(
    pool: &PgPool,
    booking_id: i64,
    payment_type: &str,
    amount: Decimal,
    actor_id: i64,
) {
    sqlx::query(
        "INSERT INTO payments (uuid, booking_id, amount, payment_method, payment_type, status, created_by) \
         VALUES (gen_uuidv7(), $1, $2, 'cash', $3, 'completed', $4)",
    )
    .bind(booking_id)
    .bind(amount)
    .bind(payment_type)
    .bind(actor_id)
    .execute(pool)
    .await
    .expect("inserting a fixture completed payment should succeed");
}

/// Legacy flag-only deposit: the mirror asserts money held with no payment
/// rows behind it. Seeded by direct UPDATE because
/// `reconcile_booking_deposit_tx` would mint a real deposit row instead.
async fn set_flag_only_deposit(pool: &PgPool, booking_id: i64, amount: Decimal) {
    sqlx::query(
        "UPDATE bookings SET deposit_paid = true, deposit_amount = $2, \
         deposit_paid_at = CURRENT_TIMESTAMP WHERE id = $1",
    )
    .bind(booking_id)
    .bind(amount)
    .execute(pool)
    .await
    .unwrap();
}

/// Drive the real `update_booking` transition every API caller uses.
async fn update_booking(
    pool: &PgPool,
    actor_id: i64,
    booking_id: i64,
    input: BookingUpdateInput,
) -> Result<Booking, ApiError> {
    bookings::update_booking_handler(
        State(pool.clone()),
        Extension(actor_id),
        Path(booking_id),
        Json(input),
    )
    .await
    .map(|Json(booking)| booking)
}

async fn checkout(pool: &PgPool, actor_id: i64, booking_id: i64) -> Result<Booking, ApiError> {
    update_booking(
        pool,
        actor_id,
        booking_id,
        BookingUpdateInput {
            status: Some("checked_out".to_string()),
            ..Default::default()
        },
    )
    .await
}

fn assert_deposit_block(result: &Result<Booking, ApiError>, expected_amount: &str) {
    let expected = format!(
        "Refund, forfeit, or waive the collected deposit of {expected_amount} before checkout"
    );
    match result {
        Err(ApiError::BadRequest(message)) => assert_eq!(
            *message, expected,
            "the checkout guard must name the unresolved deposit amount"
        ),
        other => panic!("expected the unresolved-deposit BadRequest, got: {other:?}"),
    }
}

async fn booking_status_and_mirror(pool: &PgPool, booking_id: i64) -> (String, bool) {
    sqlx::query_as::<_, (String, bool)>(
        "SELECT status, COALESCE(deposit_paid, false) FROM bookings WHERE id = $1",
    )
    .bind(booking_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// A completed deposit row the guest never got back blocks checkout with the
/// actionable error — even though the room bill itself is fully settled.
#[tokio::test]
async fn checkout_blocked_while_completed_deposit_is_unrefunded() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_001,
        booking_id: 987_101,
        guest_id: 987_201,
        room_id: 987_301,
        room_type_id: 987_401,
        company_name: None,
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;
    insert_completed_payment(&pool, f.booking_id, "booking", d("300.00"), f.actor_id).await;
    insert_completed_payment(&pool, f.booking_id, "deposit", d("100.00"), f.actor_id).await;

    let result = checkout(&pool, f.actor_id, f.booking_id).await;
    assert_deposit_block(&result, "100.00");

    let (status, _) = booking_status_and_mirror(&pool, f.booking_id).await;
    assert_eq!(
        status, "checked_in",
        "a blocked checkout must not move the booking"
    );

    cleanup_fixture(&pool, &f).await;
}

/// `refund_deposit` disbursing the held amount releases the guard.
#[tokio::test]
async fn checkout_succeeds_after_deposit_refunded() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_002,
        booking_id: 987_102,
        guest_id: 987_202,
        room_id: 987_302,
        room_type_id: 987_402,
        company_name: None,
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;
    insert_completed_payment(&pool, f.booking_id, "booking", d("300.00"), f.actor_id).await;
    insert_completed_payment(&pool, f.booking_id, "deposit", d("100.00"), f.actor_id).await;

    assert_deposit_block(&checkout(&pool, f.actor_id, f.booking_id).await, "100.00");

    PaymentRepository::refund_deposit(
        &pool,
        f.actor_id,
        f.booking_id,
        "cash",
        d("100.00"),
        None,
        None,
    )
    .await
    .expect("refunding the held deposit should succeed");

    let booking = checkout(&pool, f.actor_id, f.booking_id)
        .await
        .expect("checkout should succeed once the deposit is refunded");
    assert_eq!(booking.status, "checked_out");

    cleanup_fixture(&pool, &f).await;
}

/// `forfeit_deposit` resolving the full held amount releases the guard — the
/// hotel kept the money and owes nothing back.
#[tokio::test]
async fn checkout_succeeds_after_deposit_forfeited() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_003,
        booking_id: 987_103,
        guest_id: 987_203,
        room_id: 987_303,
        room_type_id: 987_403,
        company_name: None,
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;
    insert_completed_payment(&pool, f.booking_id, "booking", d("300.00"), f.actor_id).await;
    insert_completed_payment(&pool, f.booking_id, "deposit", d("100.00"), f.actor_id).await;

    assert_deposit_block(&checkout(&pool, f.actor_id, f.booking_id).await, "100.00");

    PaymentRepository::forfeit_deposit(
        &pool,
        f.actor_id,
        f.booking_id,
        d("100.00"),
        "Lost keycard",
        None,
    )
    .await
    .expect("forfeiting the held deposit should succeed");

    let booking = checkout(&pool, f.actor_id, f.booking_id)
        .await
        .expect("checkout should succeed once the deposit is forfeited");
    assert_eq!(booking.status, "checked_out");

    cleanup_fixture(&pool, &f).await;
}

/// A partial forfeit resolves only what it covers — the remainder still
/// blocks, and refunding that remainder is what releases the checkout.
#[tokio::test]
async fn partial_forfeit_leaves_the_remainder_blocking() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_004,
        booking_id: 987_104,
        guest_id: 987_204,
        room_id: 987_304,
        room_type_id: 987_404,
        company_name: None,
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;
    insert_completed_payment(&pool, f.booking_id, "booking", d("300.00"), f.actor_id).await;
    insert_completed_payment(&pool, f.booking_id, "deposit", d("100.00"), f.actor_id).await;

    PaymentRepository::forfeit_deposit(
        &pool,
        f.actor_id,
        f.booking_id,
        d("30.00"),
        "Minibar damage",
        None,
    )
    .await
    .expect("a partial forfeit within the ceiling should succeed");

    // 100.00 held − 30.00 forfeited = 70.00 still owed back to the guest.
    assert_deposit_block(&checkout(&pool, f.actor_id, f.booking_id).await, "70.00");

    PaymentRepository::refund_deposit(
        &pool,
        f.actor_id,
        f.booking_id,
        "cash",
        d("70.00"),
        None,
        None,
    )
    .await
    .expect("refunding the remainder should succeed");

    let booking = checkout(&pool, f.actor_id, f.booking_id)
        .await
        .expect("checkout should succeed once the remainder is refunded");
    assert_eq!(booking.status, "checked_out");

    cleanup_fixture(&pool, &f).await;
}

/// Flag-only legacy deposit: `deposit_paid`/`deposit_amount` assert money held
/// with no payment rows behind them. The mirror can only ADD a block — the
/// guest-visible amount is the mirror's assertion.
#[tokio::test]
async fn checkout_blocked_by_flag_only_deposit_without_payment_rows() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_005,
        booking_id: 987_105,
        guest_id: 987_205,
        room_id: 987_305,
        room_type_id: 987_405,
        company_name: None,
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;
    insert_completed_payment(&pool, f.booking_id, "booking", d("300.00"), f.actor_id).await;
    set_flag_only_deposit(&pool, f.booking_id, d("75.00")).await;

    assert_deposit_block(&checkout(&pool, f.actor_id, f.booking_id).await, "75.00");

    let (status, mirror_held) = booking_status_and_mirror(&pool, f.booking_id).await;
    assert_eq!(status, "checked_in");
    assert!(
        mirror_held,
        "the mirror assertion survives the blocked checkout"
    );

    cleanup_fixture(&pool, &f).await;
}

/// A prior waive update (deposit_paid=false + amount=0 — allowed because no
/// deposit row exists) clears the mirror, and only then does checkout pass.
/// Resolution is a separate call BEFORE the checkout request.
#[tokio::test]
async fn prior_waive_update_releases_flag_only_deposit() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_006,
        booking_id: 987_106,
        guest_id: 987_206,
        room_id: 987_306,
        room_type_id: 987_406,
        company_name: None,
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;
    insert_completed_payment(&pool, f.booking_id, "booking", d("300.00"), f.actor_id).await;
    set_flag_only_deposit(&pool, f.booking_id, d("75.00")).await;

    assert_deposit_block(&checkout(&pool, f.actor_id, f.booking_id).await, "75.00");

    update_booking(
        &pool,
        f.actor_id,
        f.booking_id,
        BookingUpdateInput {
            deposit_paid: Some(false),
            deposit_amount: Some(0.0),
            ..Default::default()
        },
    )
    .await
    .expect("waiving a flag-only deposit should succeed (no ledger rows)");

    let (_, mirror_held) = booking_status_and_mirror(&pool, f.booking_id).await;
    assert!(
        !mirror_held,
        "the waive update must clear the deposit mirror"
    );

    let booking = checkout(&pool, f.actor_id, f.booking_id)
        .await
        .expect("checkout should succeed after the deposit was waived");
    assert_eq!(booking.status, "checked_out");

    cleanup_fixture(&pool, &f).await;
}

/// The guard reads pre-update state, so a waive folded into the checkout
/// request itself does NOT satisfy it — the whole update is rejected and the
/// deposit assertion is still on the booking afterwards.
#[tokio::test]
async fn waive_folded_into_checkout_request_does_not_satisfy_guard() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_007,
        booking_id: 987_107,
        guest_id: 987_207,
        room_id: 987_307,
        room_type_id: 987_407,
        company_name: None,
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;
    insert_completed_payment(&pool, f.booking_id, "booking", d("300.00"), f.actor_id).await;
    set_flag_only_deposit(&pool, f.booking_id, d("75.00")).await;

    let result = update_booking(
        &pool,
        f.actor_id,
        f.booking_id,
        BookingUpdateInput {
            status: Some("checked_out".to_string()),
            deposit_paid: Some(false),
            deposit_amount: Some(0.0),
            ..Default::default()
        },
    )
    .await;
    assert_deposit_block(&result, "75.00");

    let (status, mirror_held) = booking_status_and_mirror(&pool, f.booking_id).await;
    assert_eq!(status, "checked_in");
    assert!(
        mirror_held,
        "the rejected checkout must not apply the folded-in waive either"
    );

    cleanup_fixture(&pool, &f).await;
}

/// Company billing exempts the BALANCE check — never the deposit check. A
/// corporate booking owes its room charges to the city ledger (so the bill
/// stays unpaid here) but can still be holding a keycard deposit, and the
/// error it gets is the deposit one, not the balance one.
#[tokio::test]
async fn company_billing_does_not_exempt_the_deposit_guard() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_008,
        booking_id: 987_108,
        guest_id: 987_208,
        room_id: 987_308,
        room_type_id: 987_408,
        company_name: Some("DCG987 Corp"),
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;
    // Deliberately NO bill payment: company billing skips the balance check,
    // so only the deposit guard can be responsible for the rejection below.
    insert_completed_payment(&pool, f.booking_id, "deposit", d("100.00"), f.actor_id).await;

    assert_deposit_block(&checkout(&pool, f.actor_id, f.booking_id).await, "100.00");

    let (status, _) = booking_status_and_mirror(&pool, f.booking_id).await;
    assert_eq!(status, "checked_in");

    cleanup_fixture(&pool, &f).await;
}

/// A deposit asserted via `update_booking` records the caller-supplied
/// `deposit_payment_method` — the tender the desk actually collected — not
/// the booking-level `payment_method` (the room bill's tender).
#[tokio::test]
async fn deposit_assertion_records_deposit_payment_method() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_009,
        booking_id: 987_109,
        guest_id: 987_209,
        room_id: 987_309,
        room_type_id: 987_409,
        company_name: None,
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;

    update_booking(
        &pool,
        f.actor_id,
        f.booking_id,
        BookingUpdateInput {
            deposit_paid: Some(true),
            deposit_amount: Some(50.0),
            deposit_payment_method: Some("E-Wallet".to_string()),
            // The room bill's tender — must NOT leak onto the deposit row.
            payment_method: Some("Debit Card".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("deposit assertion should succeed");

    let recorded: String = sqlx::query_scalar(
        "SELECT payment_method FROM payments \
         WHERE booking_id = $1 AND payment_type = 'deposit' AND status = 'completed'",
    )
    .bind(f.booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(recorded, "E-Wallet");

    cleanup_fixture(&pool, &f).await;
}

/// Fallback chain: absent `deposit_payment_method` still records the
/// booking-level `payment_method` (today's behavior), and a blank value is
/// treated as absent.
#[tokio::test]
async fn deposit_assertion_falls_back_when_method_absent_or_blank() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    // Two fresh bookings: one sends no deposit_payment_method, one sends "   ".
    let absent = CheckoutFixture {
        actor_id: 987_010,
        booking_id: 987_110,
        guest_id: 987_210,
        room_id: 987_310,
        room_type_id: 987_410,
        company_name: None,
    };
    let blank = CheckoutFixture {
        actor_id: 987_011,
        booking_id: 987_111,
        guest_id: 987_211,
        room_id: 987_311,
        room_type_id: 987_411,
        company_name: None,
    };
    for f in [&absent, &blank] {
        cleanup_fixture(&pool, f).await;
        seed_checked_in_booking(&pool, f).await;
    }

    update_booking(
        &pool,
        absent.actor_id,
        absent.booking_id,
        BookingUpdateInput {
            deposit_paid: Some(true),
            deposit_amount: Some(50.0),
            payment_method: Some("Debit Card".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("deposit assertion without deposit_payment_method should succeed");

    update_booking(
        &pool,
        blank.actor_id,
        blank.booking_id,
        BookingUpdateInput {
            deposit_paid: Some(true),
            deposit_amount: Some(60.0),
            deposit_payment_method: Some("   ".to_string()),
            payment_method: Some("Credit Card".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("deposit assertion with blank deposit_payment_method should succeed");

    for (booking_id, expected) in [
        (absent.booking_id, "Debit Card"),
        (blank.booking_id, "Credit Card"),
    ] {
        let recorded: String = sqlx::query_scalar(
            "SELECT payment_method FROM payments \
             WHERE booking_id = $1 AND payment_type = 'deposit' AND status = 'completed'",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            recorded, expected,
            "booking {booking_id} should fall back to the booking-level payment_method"
        );
    }

    cleanup_fixture(&pool, &absent).await;
    cleanup_fixture(&pool, &blank).await;
}

/// `refund_deposit` stores the staff-supplied provenance reference on
/// `payments.transaction_id` (surfaced as `transaction_reference` on the row)
/// and appends the free-text note to the standard refund marker.
#[tokio::test]
async fn refund_deposit_stores_reference_and_note() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_012,
        booking_id: 987_112,
        guest_id: 987_212,
        room_id: 987_312,
        room_type_id: 987_412,
        company_name: None,
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;
    insert_completed_payment(&pool, f.booking_id, "deposit", d("100.00"), f.actor_id).await;

    let row = PaymentRepository::refund_deposit(
        &pool,
        f.actor_id,
        f.booking_id,
        "cash",
        d("100.00"),
        Some("RF-9001"),
        Some("handed to guest at desk"),
    )
    .await
    .expect("refunding with a reference and note should succeed");

    assert_eq!(
        row.transaction_reference.as_deref(),
        Some("RF-9001"),
        "the returned row must expose the stored reference"
    );
    assert_eq!(
        row.notes.as_deref(),
        Some("Keycard deposit refund — handed to guest at desk")
    );

    let stored: (Option<String>, Option<String>) =
        sqlx::query_as("SELECT transaction_id, notes FROM payments WHERE id = $1")
            .bind(row.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored.0.as_deref(), Some("RF-9001"));
    assert_eq!(
        stored.1.as_deref(),
        Some("Keycard deposit refund — handed to guest at desk")
    );

    cleanup_fixture(&pool, &f).await;
}

/// The dup-guard matches on `payment_type` + `status`, not the literal marker
/// note: a refund carrying a custom note still blocks a second active refund.
#[tokio::test]
async fn refund_deposit_still_blocks_second_active_refund() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_013,
        booking_id: 987_113,
        guest_id: 987_213,
        room_id: 987_313,
        room_type_id: 987_413,
        company_name: None,
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;
    insert_completed_payment(&pool, f.booking_id, "deposit", d("100.00"), f.actor_id).await;

    PaymentRepository::refund_deposit(
        &pool,
        f.actor_id,
        f.booking_id,
        "cash",
        d("100.00"),
        None,
        Some("desk disbursement"),
    )
    .await
    .expect("the first refund should succeed");

    let second = PaymentRepository::refund_deposit(
        &pool,
        f.actor_id,
        f.booking_id,
        "cash",
        d("100.00"),
        Some("RF-2"),
        Some("duplicate attempt"),
    )
    .await;
    match second {
        Err(ApiError::BadRequest(message)) => assert_eq!(
            message, "Deposit already refunded",
            "the dup-guard — not the drained ceiling — must reject the second refund"
        ),
        other => panic!("expected BadRequest(\"Deposit already refunded\"), got: {other:?}"),
    }

    cleanup_fixture(&pool, &f).await;
}

/// `revert_deposit_refund` finds the active refund by `payment_type` +
/// `status`: a custom note on the row no longer defeats the matcher, and the
/// row is voided (kept on the books), not deleted.
#[tokio::test]
async fn revert_deposit_refund_matches_type_and_status() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_014,
        booking_id: 987_114,
        guest_id: 987_214,
        room_id: 987_314,
        room_type_id: 987_414,
        company_name: None,
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;
    insert_completed_payment(&pool, f.booking_id, "deposit", d("100.00"), f.actor_id).await;

    let row = PaymentRepository::refund_deposit(
        &pool,
        f.actor_id,
        f.booking_id,
        "cash",
        d("100.00"),
        None,
        Some("recorded in error"),
    )
    .await
    .expect("refunding with a custom note should succeed");

    let voided_id = PaymentRepository::revert_deposit_refund(&pool, f.booking_id)
        .await
        .expect("revert must find the noted refund row");
    assert_eq!(voided_id, row.id);

    let status: String = sqlx::query_scalar("SELECT status FROM payments WHERE id = $1")
        .bind(row.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "void", "the revert must void the refund row");

    cleanup_fixture(&pool, &f).await;
}

/// `forfeit_deposit` appends staff notes to the reason:
/// `Deposit forfeited: {reason} — {notes}`.
#[tokio::test]
async fn forfeit_deposit_appends_staff_notes() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let f = CheckoutFixture {
        actor_id: 987_015,
        booking_id: 987_115,
        guest_id: 987_215,
        room_id: 987_315,
        room_type_id: 987_415,
        company_name: None,
    };
    cleanup_fixture(&pool, &f).await;
    seed_checked_in_booking(&pool, &f).await;
    insert_completed_payment(&pool, f.booking_id, "deposit", d("100.00"), f.actor_id).await;

    let row = PaymentRepository::forfeit_deposit(
        &pool,
        f.actor_id,
        f.booking_id,
        d("40.00"),
        "Room damage",
        Some("broken lamp, photo on file"),
    )
    .await
    .expect("forfeiting with staff notes should succeed");

    assert_eq!(
        row.notes.as_deref(),
        Some("Deposit forfeited: Room damage — broken lamp, photo on file")
    );

    cleanup_fixture(&pool, &f).await;
}
