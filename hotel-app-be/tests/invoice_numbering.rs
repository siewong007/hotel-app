//! Integration tests for invoice-number generation
//! (`services::invoice_numbers::next_invoice_number` /
//! `backfill_missing_booking_invoices`).
//!
//! Format: `INV-YYYYMM-XXXX` (4-digit zero-padded sequence), the sequence is
//! shared across the `invoices` and `customer_ledgers` tables and scoped to
//! the current month — see src/services/invoice_numbers.rs and
//! src/repositories/invoice_numbers.rs. `next_invoke_number` is a bare
//! `SELECT MAX(seq)+1` with no row lock/advisory lock, so the only thing
//! that actually prevents two concurrent callers from committing the same
//! number is the `UNIQUE (invoice_number)` constraint on both tables — the
//! concurrency test below asserts that invariant rather than assuming the
//! generator itself serializes.
//!
//! Requires `DATABASE_URL` (PostgreSQL); tests skip gracefully without it,
//! same as `tests/booking_service.rs`.
//!
//! While writing the concurrency test below we found that the higher-level
//! `services::payments::generate_invoice` entry point (via
//! `PaymentRepository::create_generated_invoice`) was broken for every
//! booking: `GeneratedInvoiceBookingDetailsRow.check_in`/`check_out`
//! (src/repositories/payment.rs, introduced in commit feea5d9558) were typed
//! `chrono::NaiveDateTime` but `bookings.check_in_date`/`check_out_date` are
//! `DATE` columns, so sqlx rejected the decode at runtime ("Rust type
//! NaiveDateTime ... is not compatible with SQL type DATE"). The same
//! mismatch existed in `PaymentBookingStay` (src/models/payment.rs), which
//! `calculate_payment_summary` — and therefore `create_payment` — decodes
//! the same columns into. Both are fixed (retyped to `chrono::NaiveDate`),
//! and test (5) below exercises `generate_invoice` and
//! `calculate_payment_summary` end-to-end against a live booking so the
//! decode paths can never silently regress again.

use hotel_app_be::core::error::ApiError;
use hotel_app_be::repositories::invoice_numbers as invoice_repo;
use hotel_app_be::services::invoice_numbers::{
    backfill_missing_booking_invoices, next_invoice_number,
};
use hotel_app_be::services::payments;
use sqlx::{PgPool, postgres::PgPoolOptions};

// The tests in this file share a single Postgres database and some of them
// (the backfill idempotence test especially) reason about GLOBAL state
// (`bookings_missing_invoices` scans the whole `bookings` table). Run in
// parallel, a fixture booking transiently lacking an invoice in one test can
// be picked up by another test's backfill call. This process-global async
// mutex serializes them, same pattern as tests/booking_service.rs's
// `pg_serial_lock`.
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
                "Skipping PostgreSQL invoice-numbering test because DATABASE_URL is not set"
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

/// Mirrors what `backfill_missing_booking_invoices` does per-row (and what
/// `services::payments::generate_invoice` does when no invoice exists yet):
/// compute the next number, then persist it. Kept here (rather than calling
/// `generate_invoice`) so the concurrency test stays focused on the
/// numbering invariant without the invoice-detail enrichment;
/// `generate_invoice` itself is covered end-to-end by test (5).
async fn generate_and_persist(pool: &PgPool, booking_id: i64) -> Result<String, ApiError> {
    let invoice_number = next_invoice_number(pool).await?;
    invoice_repo::insert_booking_invoice(pool, booking_id, &invoice_number).await?;
    Ok(invoice_number)
}

// Fixture IDs live in the 950_xxx range. Grepped tests/*.rs before choosing
// this range (2026-07-26): 930_xxx/940_xxx/960_xxx/970_xxx are already used
// by booking_service.rs and auth_session.rs — 950_xxx was free.

async fn ensure_admin_actor(pool: &PgPool, actor_id: i64) {
    sqlx::query(
        "INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'staff', true, true) \
         ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username",
    )
    .bind(actor_id)
    .bind(format!("inv_test_actor_{actor_id}"))
    .bind(format!("inv-test-actor-{actor_id}@hotel.local"))
    .bind("Invoice Test Actor")
    .execute(pool)
    .await
    .unwrap();
}

/// Seeds a single confirmed booking (with its room/room-type/guest) that has
/// no invoice yet. Mirrors `seed_pg_booking` in tests/booking_service.rs.
#[allow(clippy::too_many_arguments)]
async fn seed_booking(
    pool: &PgPool,
    room_type_id: i64,
    room_id: i64,
    guest_id: i64,
    booking_id: i64,
    actor_id: i64,
) {
    sqlx::query(
        "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 150.00, 2) \
         ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name",
    )
    .bind(room_type_id)
    .bind(format!("INVRT{room_type_id}"))
    .bind(format!("Invoice Test Room Type {room_type_id}"))
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO rooms (id, room_number, room_type_id, status) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'available') \
         ON CONFLICT (id) DO UPDATE SET room_number = EXCLUDED.room_number, room_type_id = EXCLUDED.room_type_id, status = 'available'",
    )
    .bind(room_id)
    .bind(format!("INV{room_id}"))
    .bind(room_type_id)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO guests (id, full_name, first_name, last_name, email) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Invoice', $3, $4) \
         ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name",
    )
    .bind(guest_id)
    .bind(format!("Invoice Test Guest {guest_id}"))
    .bind(format!("Guest{guest_id}"))
    .bind(format!("inv-test-guest-{guest_id}@hotel.local"))
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO bookings (
            id, booking_number, guest_id, guest_name, guest_email, room_id,
            check_in_date, check_out_date, adults, children,
            room_rate, subtotal, total_amount, status, payment_status, created_by
         )
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, '2031-02-10', '2031-02-12', 1, 0,
                 150.00, 300.00, 300.00, 'confirmed', 'unpaid', $7)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(booking_id)
    .bind(format!("BK-INV-{booking_id}"))
    .bind(guest_id)
    .bind(format!("Invoice Test Guest {guest_id}"))
    .bind(format!("inv-test-guest-{guest_id}@hotel.local"))
    .bind(room_id)
    .bind(actor_id)
    .execute(pool)
    .await
    .unwrap();
}

/// Tears down a set of fixtures seeded by `seed_booking`/`ensure_admin_actor`.
/// `invoices` rows cascade-delete when their booking is deleted
/// (`invoices_booking_id_fkey ... ON DELETE CASCADE`), so they need no
/// explicit cleanup. `room_status_change_log` does NOT cascade (FK on
/// room_id, no ON DELETE) — the confirmed-booking INSERT above fires
/// `trg_sync_room_status_booking`, which writes a row there via
/// `update_room_status()`, so it must be deleted before the room (see
/// .claude/rules/lessons.md 2026-07-26e).
async fn cleanup(
    pool: &PgPool,
    room_type_id: i64,
    room_ids: &[i64],
    guest_ids: &[i64],
    booking_ids: &[i64],
    actor_id: i64,
) {
    for &booking_id in booking_ids {
        sqlx::query(
            "DELETE FROM audit_logs WHERE resource_type = 'invoice' \
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
    sqlx::query("DELETE FROM room_types WHERE id = $1")
        .bind(room_type_id)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(actor_id)
        .execute(pool)
        .await
        .ok();
}

/// (1) Format: `INV-YYYYMM-XXXX` for the current month.
#[tokio::test]
async fn next_invoice_number_matches_current_month_format() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    // The month comes from CURRENT_DATE under the pool's session timezone
    // (hotel business day), so derive the expectation from the same pool.
    // Captured before generating so a month rollover between the two queries
    // can't produce a false mismatch.
    let expected_yyyymm: String = sqlx::query_scalar("SELECT TO_CHAR(CURRENT_DATE, 'YYYYMM')")
        .fetch_one(&pool)
        .await
        .expect("month lookup should succeed");

    let generated = next_invoice_number(&pool)
        .await
        .expect("next_invoice_number should succeed against a live pool");

    let parts: Vec<&str> = generated.splitn(3, '-').collect();
    assert_eq!(
        parts.len(),
        3,
        "expected INV-YYYYMM-XXXX (3 dash-separated segments): {generated}"
    );
    assert_eq!(parts[0], "INV");
    assert_eq!(
        parts[1], expected_yyyymm,
        "month segment should be the current hotel-business-day YYYYMM"
    );

    assert_eq!(
        parts[2].len(),
        4,
        "sequence segment should be 4 zero-padded digits: {generated}"
    );
    assert!(
        parts[2].chars().all(|c| c.is_ascii_digit()),
        "sequence segment must be all digits: {generated}"
    );
}

/// (2) Sequence behavior across consecutive generations. `next_invoice_number`
/// is a pure `MAX(seq)+1` read — calling it twice with nothing persisted in
/// between returns the SAME number both times (it does not reserve/advance
/// anything on its own); only after a number is actually committed does the
/// next call advance by exactly one.
#[tokio::test]
async fn sequence_increments_only_after_a_number_is_persisted() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let actor_id = 950_001;
    let room_type_id = 950_101;
    let room_id = 950_201;
    let guest_id = 950_301;
    let booking_id = 950_401;

    cleanup(
        &pool,
        room_type_id,
        &[room_id],
        &[guest_id],
        &[booking_id],
        actor_id,
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(&pool, room_type_id, room_id, guest_id, booking_id, actor_id).await;

    let first = next_invoice_number(&pool).await.unwrap();
    let repeat = next_invoice_number(&pool).await.unwrap();
    assert_eq!(
        first, repeat,
        "calling next_invoice_number twice with nothing persisted must return the same number"
    );

    invoice_repo::insert_booking_invoice(&pool, booking_id, &first)
        .await
        .expect("inserting the fixture invoice should succeed");

    let second = next_invoice_number(&pool).await.unwrap();
    assert_ne!(
        first, second,
        "after persisting a number, the next generation must advance"
    );

    let first_prefix = &first[..first.len() - 4];
    let second_prefix = &second[..second.len() - 4];
    assert_eq!(
        first_prefix, second_prefix,
        "prefix (INV-YYYYMM-) must stay the same within one month"
    );

    let first_seq: i64 = first[first.len() - 4..].parse().unwrap();
    let second_seq: i64 = second[second.len() - 4..].parse().unwrap();
    assert_eq!(
        second_seq,
        first_seq + 1,
        "sequence must increment by exactly one after a single persisted invoice: {first} -> {second}"
    );

    cleanup(
        &pool,
        room_type_id,
        &[room_id],
        &[guest_id],
        &[booking_id],
        actor_id,
    )
    .await;
}

/// (3) Concurrency: two concurrent invoice generations (for two different
/// bookings, via `generate_and_persist` — the same `next_invoice_number` +
/// `insert_booking_invoice` pairing `backfill_missing_booking_invoices` uses
/// in production) must never result in two committed rows sharing an
/// invoice_number. `next_invoice_number` itself has no locking, so if both
/// callers' `SELECT MAX` race and see the same value, one INSERT is expected
/// to fail against the `UNIQUE (invoice_number)` constraint rather than
/// silently duplicate — this test tolerates either outcome (both succeed
/// with distinct numbers, or one succeeds and one is rejected) but never
/// tolerates a duplicate.
#[tokio::test]
async fn concurrent_generation_never_commits_duplicate_numbers() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let actor_id = 950_002;
    let room_type_id = 950_102;
    let room_a = 950_202;
    let room_b = 950_203;
    let guest_a = 950_302;
    let guest_b = 950_303;
    let booking_a = 950_402;
    let booking_b = 950_403;

    cleanup(
        &pool,
        room_type_id,
        &[room_a, room_b],
        &[guest_a, guest_b],
        &[booking_a, booking_b],
        actor_id,
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(&pool, room_type_id, room_a, guest_a, booking_a, actor_id).await;
    seed_booking(&pool, room_type_id, room_b, guest_b, booking_b, actor_id).await;

    let pool_a = pool.clone();
    let pool_b = pool.clone();
    let first = generate_and_persist(&pool_a, booking_a);
    let second = generate_and_persist(&pool_b, booking_b);
    let (result_a, result_b) = tokio::join!(first, second);

    let successes = [&result_a, &result_b]
        .iter()
        .filter(|r| r.is_ok())
        .count();
    assert!(
        successes >= 1,
        "at least one of the two concurrent invoice generations should succeed: {result_a:?} / {result_b:?}"
    );

    if let (Ok(number_a), Ok(number_b)) = (&result_a, &result_b) {
        assert_ne!(
            number_a, number_b,
            "two concurrently committed invoice numbers must not collide"
        );
    }

    // Belt-and-suspenders on the actual committed rows, independent of what
    // the two `Result`s above looked like.
    let dup_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM (
            SELECT invoice_number FROM invoices WHERE booking_id IN ($1, $2)
            GROUP BY invoice_number HAVING COUNT(*) > 1
        ) dupes",
    )
    .bind(booking_a)
    .bind(booking_b)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        dup_count, 0,
        "no two committed invoices for these bookings may share a number"
    );

    cleanup(
        &pool,
        room_type_id,
        &[room_a, room_b],
        &[guest_a, guest_b],
        &[booking_a, booking_b],
        actor_id,
    )
    .await;
}

/// (4) `backfill_missing_booking_invoices` is safe to run repeatedly: a
/// second consecutive run must not touch a booking the first run already
/// backfilled. The function scans ALL bookings lacking an invoice (no
/// per-caller scoping), so this only asserts the invariant that matters for
/// our fixture booking specifically, plus the documented no-op return value
/// for a second run with nothing new to backfill in between.
#[tokio::test]
async fn backfill_missing_booking_invoices_is_idempotent() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let actor_id = 950_003;
    let room_type_id = 950_103;
    let room_id = 950_204;
    let guest_id = 950_304;
    let booking_id = 950_404;

    cleanup(
        &pool,
        room_type_id,
        &[room_id],
        &[guest_id],
        &[booking_id],
        actor_id,
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(&pool, room_type_id, room_id, guest_id, booking_id, actor_id).await;

    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invoices WHERE booking_id = $1")
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(before, 0, "fixture booking must start with no invoice");

    let first_run = backfill_missing_booking_invoices(&pool)
        .await
        .expect("first backfill run should succeed");
    assert!(
        first_run >= 1,
        "first backfill run should have inserted at least our fixture booking's invoice"
    );

    let after_first: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM invoices WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        after_first, 1,
        "fixture booking should have exactly one backfilled invoice"
    );

    let invoice_number: String =
        sqlx::query_scalar("SELECT invoice_number FROM invoices WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        invoice_number.starts_with("INV-"),
        "backfilled invoice should use the INV-YYYYMM-XXXX format: {invoice_number}"
    );

    let second_run = backfill_missing_booking_invoices(&pool)
        .await
        .expect("second backfill run should succeed");
    assert_eq!(
        second_run, 0,
        "second consecutive backfill run must be a no-op"
    );

    let after_second: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM invoices WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        after_second, 1,
        "backfill must not duplicate an invoice for an already-invoiced booking"
    );

    let invoice_number_after: String =
        sqlx::query_scalar("SELECT invoice_number FROM invoices WHERE booking_id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        invoice_number, invoice_number_after,
        "the invoice number must not change on the no-op second run"
    );

    cleanup(
        &pool,
        room_type_id,
        &[room_id],
        &[guest_id],
        &[booking_id],
        actor_id,
    )
    .await;
}

/// (5) End-to-end coverage for `services::payments::generate_invoice` (and
/// the `calculate_payment_summary` decode path) against a live booking.
/// These paths decode `bookings.check_in_date`/`check_out_date` (DATE
/// columns) and shipped broken on 2026-07-22 because nothing exercised them
/// — see the module doc comment. This test is the regression guard: it must
/// return `Ok` with correct stay details, and a second call must reuse the
/// existing invoice rather than creating another.
#[tokio::test]
async fn generate_invoice_returns_enriched_invoice_and_is_idempotent() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };

    let actor_id = 950_004;
    let room_type_id = 950_104;
    let room_id = 950_205;
    let guest_id = 950_305;
    let booking_id = 950_405;

    cleanup(
        &pool,
        room_type_id,
        &[room_id],
        &[guest_id],
        &[booking_id],
        actor_id,
    )
    .await;
    ensure_admin_actor(&pool, actor_id).await;
    seed_booking(&pool, room_type_id, room_id, guest_id, booking_id, actor_id).await;

    let invoice = payments::generate_invoice(&pool, actor_id, booking_id)
        .await
        .expect("generate_invoice must succeed for a live booking fixture");

    assert_eq!(invoice.booking_id, booking_id);
    assert!(
        invoice.invoice_number.starts_with("INV-"),
        "generated invoice should use the INV-YYYYMM-XXXX format: {}",
        invoice.invoice_number
    );
    // Stay details come from the DATE-column decode that used to fail — the
    // seeded booking is 2031-02-10 .. 2031-02-12 (2 nights).
    let expected_check_in = chrono::NaiveDate::from_ymd_opt(2031, 2, 10).unwrap();
    let expected_check_out = chrono::NaiveDate::from_ymd_opt(2031, 2, 12).unwrap();
    assert_eq!(invoice.check_in_date, Some(expected_check_in));
    assert_eq!(invoice.check_out_date, Some(expected_check_out));
    assert_eq!(invoice.number_of_nights, Some(2));

    // `calculate_payment_summary` decodes the same columns via
    // `PaymentBookingStay` (the second site of the mismatch): 2 nights at
    // the seeded 150.00 base price.
    let summary = payments::calculate_payment_summary(&pool, booking_id)
        .await
        .expect("calculate_payment_summary must succeed for a live booking fixture");
    assert_eq!(summary.subtotal, rust_decimal::Decimal::new(300, 0));

    // Idempotency: a second call must return the SAME invoice, not mint a
    // new number or a second row.
    let again = payments::generate_invoice(&pool, actor_id, booking_id)
        .await
        .expect("second generate_invoice call must succeed");
    assert_eq!(again.id, invoice.id);
    assert_eq!(again.invoice_number, invoice.invoice_number);

    let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invoices WHERE booking_id = $1")
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row_count, 1, "exactly one invoice row for the booking");

    cleanup(
        &pool,
        room_type_id,
        &[room_id],
        &[guest_id],
        &[booking_id],
        actor_id,
    )
    .await;
}
