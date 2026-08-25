//! Integration tests for the transactional checkout-receipt email
//! (`services/payments::queue_checkout_receipt_email`).
//!
//! Skipped without `DATABASE_URL`, like the other PostgreSQL-gated suites in
//! this directory. The queue function is exercised directly: driving the full
//! checkout lifecycle here would only re-test RBAC + balance-guard fixtures
//! already covered by `booking_service.rs`, while the receipt logic — skip
//! rules, idempotency key, row shape — lives entirely in the queue function.

use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

const ROOM_TYPE_ID: i64 = 976_401;
const ROOM_ID: i64 = 976_301;
const GUEST_ID: i64 = 976_201;
const BOOKING_ID: i64 = 976_101;

async fn pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => return None,
    };
    let pool = PgPoolOptions::new()
        .max_connections(3)
        .connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL test database");

    // The receipt footer signs an unsubscribe token and renders a public URL,
    // which reads process config.
    if std::env::var("JWT_SECRET").is_err() {
        // SAFETY: single-test binary; no concurrent environment readers.
        unsafe {
            std::env::set_var("JWT_SECRET", "checkout-receipt-test-secret-0123456789ab");
        }
    }
    hotel_app_be::core::config::init_from_env()
        .expect("test config initialises from env");

    Some(pool)
}

async fn cleanup(pool: &PgPool) {
    sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
        .bind(ROOM_ID)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM email_deliveries WHERE guest_id = $1")
        .bind(GUEST_ID)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM payments WHERE booking_id = $1")
        .bind(BOOKING_ID)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "DELETE FROM bookings WHERE room_id = $1 AND id = $2",
    )
    .bind(ROOM_ID)
    .bind(BOOKING_ID)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM rooms WHERE id = $1")
        .bind(ROOM_ID)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM room_types WHERE id = $1")
        .bind(ROOM_TYPE_ID)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM guests WHERE id = $1")
        .bind(GUEST_ID)
        .execute(pool)
        .await
        .unwrap();
}

async fn seed_fixture(pool: &PgPool, company_id: Option<i64>, guest_email: Option<&str>) {
    sqlx::query(
        "INSERT INTO guests (id, full_name, first_name, last_name, email) \
         OVERRIDING SYSTEM VALUE VALUES ($1, 'Receipt Guest', 'Receipt', 'Guest', $2)",
    )
    .bind(GUEST_ID)
    .bind(guest_email)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO room_types (id, name, code, base_price, max_occupancy, allows_extra_bed, max_extra_beds, extra_bed_charge, is_active, sort_order) \
         OVERRIDING SYSTEM VALUE VALUES ($1, 'Receipt Suite', 'RCPT', 150.00, 2, false, 0, 0, true, 0) \
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(ROOM_TYPE_ID)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO rooms (id, room_number, room_type_id, status) \
         OVERRIDING SYSTEM VALUE VALUES ($1, 'R-976', $2, 'available')",
    )
    .bind(ROOM_ID)
    .bind(ROOM_TYPE_ID)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO bookings (
            id, booking_number, guest_id, guest_name, guest_email, room_id,
            check_in_date, check_out_date, adults, children,
            room_rate, subtotal, total_amount, status, payment_status,
            is_complimentary, created_by, company_id
         )
         OVERRIDING SYSTEM VALUE VALUES ($1, 'BK-RCPT-1', $2, 'Receipt Guest', $3, $4,
                 '2031-01-10', '2031-01-12', 1, 0,
                 150.00, 300.00, 300.00, 'checked_out', 'paid', false, $5, $6)",
    )
    .bind(BOOKING_ID)
    .bind(GUEST_ID)
    .bind(guest_email)
    .bind(ROOM_ID)
    .bind(1000_i64) // created_by FK -> users; the suite seeds users from id 1000
    .bind(company_id)
    .execute(pool)
    .await
    .unwrap();

    // Fully paid so the receipt shows a zero balance.
    sqlx::query(
        "INSERT INTO payments (booking_id, amount, payment_method, payment_type, status, created_by, processed_by) \
         VALUES ($1, 300.00, 'cash', 'booking', 'completed', $2, $2)",
    )
    .bind(BOOKING_ID)
    .bind(1000_i64) // created_by FK -> users
    .execute(pool)
    .await
    .unwrap();
}

async fn delivery_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM email_deliveries WHERE idempotency_key = $1")
        .bind("checkout-receipt:INV-RCPT-1")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn checkout_receipt_queues_once_per_invoice_and_skips_company_or_emailless_guests() {
    let Some(pool) = pg_pool().await else {
        return;
    };

    cleanup(&pool).await;

    // Happy path: personal folio with an emailed guest.
    seed_fixture(&pool, None, Some("receipt-guest@hotel.local")).await;
    hotel_app_be::services::payments::queue_checkout_receipt_email(&pool, BOOKING_ID, "INV-RCPT-1")
        .await
        .expect("first queue should succeed");
    assert_eq!(delivery_count(&pool).await, 1);

    // Retry with the same invoice number must not double-send.
    hotel_app_be::services::payments::queue_checkout_receipt_email(&pool, BOOKING_ID, "INV-RCPT-1")
        .await
        .expect("idempotent re-queue should succeed");
    assert_eq!(delivery_count(&pool).await, 1);

    let (kind, topic): (String, String) = sqlx::query_as(
        "SELECT kind, topic FROM email_deliveries WHERE idempotency_key = $1",
    )
    .bind("checkout-receipt:INV-RCPT-1")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(kind, "checkout_receipt");
    assert_eq!(topic, "checkout_receipt");

    // Company-billed folio: no personal receipt.
    cleanup(&pool).await;
    seed_fixture(
        &pool,
        Some(5), // seeded company row; non-null company_id flips the skip rule
        Some("receipt-guest@hotel.local"),
    ).await;
    hotel_app_be::services::payments::queue_checkout_receipt_email(&pool, BOOKING_ID, "INV-RCPT-2")
        .await
        .expect("company-billed skip should not error");
    assert_eq!(delivery_count_named(&pool, "INV-RCPT-2").await, 0);

    // Guest without an email on file: nothing to send to.
    cleanup(&pool).await;
    seed_fixture(&pool, None, None).await;
    hotel_app_be::services::payments::queue_checkout_receipt_email(&pool, BOOKING_ID, "INV-RCPT-3")
        .await
        .expect("emailless skip should not error");
    assert_eq!(delivery_count_named(&pool, "INV-RCPT-3").await, 0);

    cleanup(&pool).await;
}

async fn delivery_count_named(pool: &PgPool, invoice_number: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM email_deliveries WHERE idempotency_key = $1")
        .bind(format!("checkout-receipt:{invoice_number}"))
        .fetch_one(pool)
        .await
        .unwrap()
}
