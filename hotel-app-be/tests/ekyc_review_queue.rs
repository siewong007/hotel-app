//! The eKYC review queue's arrival-order prioritisation
//! (`EkycRepository::list_admin`).
//!
//! A guest who files eKYC the day before arrival needs a decision before they
//! land, however recent their application is. The queue therefore carries each
//! applicant's next arrival and an urgency flag, both decided in SQL against
//! the connection's hotel timezone rather than a process clock.
//!
//! Skipped without `DATABASE_URL`. Exercises real SQL: the arrival LATERAL, the
//! `next_arrival` sort key, and the row-count guarantee that a guest with
//! several upcoming bookings still occupies exactly one place in the queue.

use hotel_app_be::models::EkycListQuery;
use hotel_app_be::repositories::ekyc::EkycRepository;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

/// This binary owns the `983_` id block; verified free across `tests/` before
/// it was chosen (re-verify with `grep -rn "983_" tests/` when extending).
const GUEST_SOON: i64 = 983_001;
const GUEST_LATER: i64 = 983_002;
const GUEST_NONE: i64 = 983_003;
const USER_SOON: i64 = 983_101;
const USER_LATER: i64 = 983_102;
const USER_NONE: i64 = 983_103;
const ROOM_TYPE_ID: i64 = 983_201;
const ROOM_ID: i64 = 983_301;
const BOOKING_SOON_A: i64 = 983_401;
const BOOKING_SOON_B: i64 = 983_402;
const BOOKING_LATER: i64 = 983_403;
const BOOKING_PAST: i64 = 983_404;

async fn pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => return None,
    };
    Some(
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database"),
    )
}

async fn cleanup(pool: &PgPool) {
    for (table, column, ids) in [
        (
            "ekyc_verifications",
            "user_id",
            vec![USER_SOON, USER_LATER, USER_NONE],
        ),
        (
            "bookings",
            "id",
            vec![BOOKING_SOON_A, BOOKING_SOON_B, BOOKING_LATER, BOOKING_PAST],
        ),
        ("room_status_change_log", "room_id", vec![ROOM_ID]),
        ("users", "id", vec![USER_SOON, USER_LATER, USER_NONE]),
        ("rooms", "id", vec![ROOM_ID]),
        ("room_types", "id", vec![ROOM_TYPE_ID]),
        ("guests", "id", vec![GUEST_SOON, GUEST_LATER, GUEST_NONE]),
    ] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DELETE FROM {table} WHERE {column} = ANY($1)"
        )))
        .bind(&ids)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("cleanup of {table} failed: {error}"));
    }
}

async fn seed_guest(pool: &PgPool, guest_id: i64, user_id: i64, name: &str) {
    sqlx::query(
        "INSERT INTO guests (id, nick_name, first_name, last_name, email) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Queue', 'Guest', $3)",
    )
    .bind(guest_id)
    .bind(name)
    .bind(format!("queue-{guest_id}@hotel.test"))
    .execute(pool)
    .await
    .expect("insert guest fixture");

    sqlx::query(
        "INSERT INTO users (id, username, email, full_name, user_type, guest_id, is_active, is_verified) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'guest', $5, false, true)",
    )
    .bind(user_id)
    .bind(format!("queue_user_{user_id}"))
    .bind(format!("queue-user-{user_id}@hotel.test"))
    .bind(name)
    .bind(guest_id)
    .execute(pool)
    .await
    .expect("insert portal account fixture");

    sqlx::query(
        "INSERT INTO ekyc_verifications ( \
            user_id, guest_id, full_name, date_of_birth, nationality, phone, email, \
            current_address, id_type, id_number, id_issuing_country, id_issue_date, \
            id_expiry_date, id_front_image_path, selfie_image_path, status, \
            self_checkin_enabled, submitted_at, updated_at) \
         VALUES ($1, $2, $3, DATE '1990-01-01', 'MY', '0123456789', $4, '1 Test Street', \
            'passport', 'A1234567', 'MY', DATE '2020-01-01', DATE '2030-01-01', \
            '/tmp/f.jpg', '/tmp/s.jpg', 'submitted', false, \
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
    )
    .bind(user_id)
    .bind(guest_id)
    .bind(name)
    .bind(format!("queue-{guest_id}@hotel.test"))
    .execute(pool)
    .await
    .expect("insert eKYC application fixture");
}

async fn seed_booking(pool: &PgPool, booking_id: i64, guest_id: i64, day_offset: i64) {
    sqlx::query(
        "INSERT INTO bookings ( \
            id, booking_number, guest_id, room_id, check_in_date, check_out_date, \
            room_rate, subtotal, total_amount, status, payment_status) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, \
            CURRENT_DATE + $5::int, CURRENT_DATE + $5::int + 2, \
            100.00, 200.00, 200.00, 'confirmed', 'paid')",
    )
    .bind(booking_id)
    .bind(format!("BK-QUEUE-{booking_id}"))
    .bind(guest_id)
    .bind(ROOM_ID)
    .bind(day_offset as i32)
    .execute(pool)
    .await
    .expect("insert booking fixture");
}

fn query_for(search: &str) -> EkycListQuery {
    EkycListQuery {
        status: None,
        submission_from: None,
        submission_to: None,
        risk_level: None,
        verification_method: None,
        assigned_reviewer_id: None,
        nationality: None,
        country: None,
        document_type: None,
        provider_result: None,
        manual_review_required: None,
        // Scopes the query to this test's fixtures: the suite shares one
        // database, and other files leave eKYC rows behind.
        search: Some(search.to_string()),
        sort_by: Some("next_arrival".to_string()),
        sort_order: Some("asc".to_string()),
        page: Some(1),
        page_size: Some(50),
    }
}

#[tokio::test]
async fn review_queue_orders_by_arrival_and_counts_each_applicant_once() {
    let Some(pool) = pg_pool().await else {
        return;
    };
    cleanup(&pool).await;

    let tag = "QueueFixture";
    sqlx::query(
        "INSERT INTO room_types (id, name, code, base_price, max_occupancy, is_active) \
         OVERRIDING SYSTEM VALUE VALUES ($1, 'Queue Suite', 'QUEU', 100.00, 2, true)",
    )
    .bind(ROOM_TYPE_ID)
    .execute(&pool)
    .await
    .expect("insert room type fixture");
    sqlx::query(
        "INSERT INTO rooms (id, room_number, room_type_id, status) \
         OVERRIDING SYSTEM VALUE VALUES ($1, 'Q-983', $2, 'available')",
    )
    .bind(ROOM_ID)
    .bind(ROOM_TYPE_ID)
    .execute(&pool)
    .await
    .expect("insert room fixture");

    seed_guest(&pool, GUEST_SOON, USER_SOON, &format!("{tag} Soon")).await;
    seed_guest(&pool, GUEST_LATER, USER_LATER, &format!("{tag} Later")).await;
    seed_guest(&pool, GUEST_NONE, USER_NONE, &format!("{tag} None")).await;

    // Two upcoming stays for the same guest: the queue must still show them once.
    seed_booking(&pool, BOOKING_SOON_A, GUEST_SOON, 1).await;
    seed_booking(&pool, BOOKING_SOON_B, GUEST_SOON, 5).await;
    seed_booking(&pool, BOOKING_LATER, GUEST_LATER, 10).await;
    // Already past: cannot make a review urgent.
    seed_booking(&pool, BOOKING_PAST, GUEST_NONE, -30).await;

    let (total, rows) =
        EkycRepository::list_admin(&pool, &query_for(tag), "next_arrival_date", "ASC", 50, 0)
            .await
            .expect("list the review queue");

    assert_eq!(
        total, 3,
        "a guest with two upcoming bookings must not be counted twice: {rows:#?}"
    );
    assert_eq!(rows.len(), 3, "one queue row per application");

    let names: Vec<&str> = rows
        .iter()
        .map(|row| row.full_name.as_deref().unwrap_or_default())
        .collect();
    assert_eq!(
        names,
        vec![
            format!("{tag} Soon"),
            format!("{tag} Later"),
            format!("{tag} None"),
        ],
        "soonest arrival first, and an applicant with no upcoming stay last"
    );

    let today: chrono::NaiveDate = sqlx::query_scalar("SELECT CURRENT_DATE")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        rows[0].next_arrival_date,
        Some(today + chrono::Duration::days(1)),
        "the EARLIEST of the guest's upcoming stays is what makes the review urgent"
    );
    assert_eq!(rows[0].arrival_imminent, Some(true));
    assert_eq!(
        rows[1].next_arrival_date,
        Some(today + chrono::Duration::days(10))
    );
    assert_eq!(
        rows[1].arrival_imminent,
        Some(false),
        "a stay ten days out is not urgent"
    );
    assert_eq!(
        rows[2].next_arrival_date, None,
        "a stay that has already happened must not surface as an upcoming arrival"
    );
    assert_eq!(rows[2].arrival_imminent, Some(false));

    cleanup(&pool).await;
}
