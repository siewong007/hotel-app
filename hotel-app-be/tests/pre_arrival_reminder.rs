//! Integration tests for the pre-arrival reminder scheduler tick
//! (`modules/communications/scheduler::tick_pre_arrival_reminders`).
//!
//! Skipped without `DATABASE_URL`. Exercises the settings gate, the window
//! selection, and the once-per-booking idempotency key against live PostgreSQL.

use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

const ROOM_TYPE_ID: i64 = 977_401;
const ROOM_ID: i64 = 977_301;
const GUEST_ID: i64 = 977_201;
const BOOKING_ID: i64 = 977_101;

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

    // The scheduler reads its toggle through the TTL-cached settings reader;
    // collapse the cache so the test's direct system_settings writes are seen
    // on the very next tick.
    unsafe { std::env::set_var("SETTINGS_CACHE_TTL_SECS", "0") };
    if std::env::var("JWT_SECRET").is_err() {
        // SAFETY: single-test binary; no concurrent environment readers.
        unsafe {
            std::env::set_var("JWT_SECRET", "test-secret-test-secret-test-secret");
        }
    }
    hotel_app_be::core::config::init_from_env()
        .expect("test config initialises from env");

    Some(pool)
}

async fn cleanup(pool: &PgPool) {
    sqlx::query("DELETE FROM email_deliveries WHERE guest_id = $1")
        .bind(GUEST_ID)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
        .bind(ROOM_ID)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM bookings WHERE id = $1")
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

async fn set_setting(pool: &PgPool, key: &str, value: &str) {
    sqlx::query(
        "INSERT INTO system_settings (key, value) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_arrival(pool: &PgPool, check_in_date: &str, status: &str) {
    sqlx::query(
        "INSERT INTO guests (id, full_name, first_name, last_name, email) \
         OVERRIDING SYSTEM VALUE VALUES ($1, 'Arrival Guest', 'Arrival', 'Guest', 'arrival-guest@hotel.local')",
    )
    .bind(GUEST_ID)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO room_types (id, name, code, base_price, max_occupancy, allows_extra_bed, max_extra_beds, extra_bed_charge, is_active, sort_order) \
         OVERRIDING SYSTEM VALUE VALUES ($1, 'Arrival Suite', 'ARRV', 150.00, 2, false, 0, 0, true, 0)",
    )
    .bind(ROOM_TYPE_ID)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO rooms (id, room_number, room_type_id, status) \
         OVERRIDING SYSTEM VALUE VALUES ($1, 'R-977', $2, 'available')",
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
            is_complimentary, created_by
         )
         OVERRIDING SYSTEM VALUE VALUES ($1, 'BK-ARRV-1', $2, 'Arrival Guest', 'arrival-guest@hotel.local', $3,
                 $4::date, $4::date + 2, 1, 0,
                 150.00, 300.00, 300.00, $5, 'unpaid', false, 1000)",
    )
    .bind(BOOKING_ID)
    .bind(GUEST_ID)
    .bind(ROOM_ID)
    .bind(check_in_date)
    .bind(status)
    .execute(pool)
    .await
    .unwrap();
}

async fn reminder_delivery_count(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM email_deliveries WHERE idempotency_key = $1")
        .bind(format!("pre-arrival:{BOOKING_ID}"))
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn pre_arrival_reminder_fires_once_inside_the_window_and_respects_the_toggle() {
    let Some(pool) = pg_pool().await else {
        return;
    };

    cleanup(&pool).await;

    // Booking arriving tomorrow: inside every sensible window.
    let tomorrow: chrono::NaiveDate =
        sqlx::query_scalar("SELECT CURRENT_DATE + 1").fetch_one(&pool).await.unwrap();
    seed_arrival(&pool, &tomorrow.format("%Y-%m-%d").to_string(), "confirmed").await;

    // Disabled (default): nothing queued.
    set_setting(&pool, "pre_arrival_reminder_enabled", "false").await;
    let queued = hotel_app_be::modules::communications::scheduler::tick_pre_arrival_reminders(&pool)
        .await
        .expect("disabled tick should not error");
    assert_eq!(queued, 0);
    assert_eq!(reminder_delivery_count(&pool).await, 0);

    // Enabled: exactly one delivery with the booking-scoped key.
    set_setting(&pool, "pre_arrival_reminder_enabled", "true").await;
    let queued = hotel_app_be::modules::communications::scheduler::tick_pre_arrival_reminders(&pool)
        .await
        .expect("enabled tick should not error");
    assert_eq!(queued, 1);
    assert_eq!(reminder_delivery_count(&pool).await, 1);

    // Second tick: the NOT EXISTS guard means no duplicate.
    let queued = hotel_app_be::modules::communications::scheduler::tick_pre_arrival_reminders(&pool)
        .await
        .expect("repeat tick should not error");
    assert_eq!(queued, 0);
    assert_eq!(reminder_delivery_count(&pool).await, 1);

    let kind: String = sqlx::query_scalar(
        "SELECT kind FROM email_deliveries WHERE idempotency_key = $1",
    )
    .bind(format!("pre-arrival:{BOOKING_ID}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(kind, "pre_arrival_reminder");

    cleanup(&pool).await;
}
