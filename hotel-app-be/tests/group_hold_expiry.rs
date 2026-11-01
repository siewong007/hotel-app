//! The unpaid-hold sweep never releases a group room before the hold deadline
//! the guest was shown (`booking_groups.hold_expires_at`).
//! Opt-in through `DATABASE_URL`; rows are hard-deleted afterwards.
use hotel_app_be::modules::bookings::{group_hold_is_engaged, stale_unpaid_hold_ids};
use sqlx::{PgPool, postgres::PgPoolOptions};

struct Fixture {
    guest_id: i64,
    group_id: i64,
    room_type_id: i64,
    booking_id: i64,
}

async fn fixture(pool: &PgPool) -> Fixture {
    let tag = format!(
        "{:x}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let guest_id: i64 = sqlx::query_scalar(
        "INSERT INTO guests (nick_name, email, ic_number) VALUES ($1, $2, 'A1234567') RETURNING id",
    )
    .bind(format!("Hold {tag}"))
    .bind(format!("hold-{tag}@example.com"))
    .fetch_one(pool)
    .await
    .unwrap();
    let room_type_id: i64 = sqlx::query_scalar(
        "INSERT INTO room_types (code, name, base_price, max_occupancy) \
         VALUES ($1, $2, 100.00, 2) RETURNING id",
    )
    .bind(format!("HX{tag}"))
    .bind(format!("Hold Type {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    // Promised deadline still 1 hour away, although the booking is 5 hours old.
    let group_id: i64 = sqlx::query_scalar(
        "INSERT INTO booking_groups (group_number, guest_id, check_in_date, check_out_date, hold_expires_at) \
         VALUES ($1, $2, CURRENT_DATE + 10, CURRENT_DATE + 12, CURRENT_TIMESTAMP + interval '1 hour') RETURNING id",
    )
    .bind(format!("GHX{tag}"))
    .bind(guest_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let room_id: i64 = sqlx::query_scalar(
        "INSERT INTO rooms (room_number, room_type_id, status, is_active) \
         VALUES ($1, $2, 'available', true) RETURNING id",
    )
    .bind(format!("HX{tag}"))
    .bind(room_type_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let booking_id: i64 = sqlx::query_scalar(
        "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, \
             room_rate, subtotal, total_amount, status, payment_status, currency, booking_group_id, \
             source, created_at) \
         VALUES ($1, $2, $3, CURRENT_DATE + 10, CURRENT_DATE + 12, 100.00, 200.00, 200.00, \
             'pending_payment', 'unpaid', 'MYR', $4, 'website', CURRENT_TIMESTAMP - interval '5 hours') \
         RETURNING id",
    )
    .bind(format!("BHX{tag}"))
    .bind(guest_id)
    .bind(room_id)
    .bind(group_id)
    .fetch_one(pool)
    .await
    .unwrap();
    Fixture {
        guest_id,
        group_id,
        room_type_id,
        booking_id,
    }
}

async fn cleanup(pool: &PgPool, f: &Fixture) {
    for sql in [
        "DELETE FROM bookings WHERE guest_id = $1",
        "DELETE FROM booking_groups WHERE guest_id = $1",
        "DELETE FROM guests WHERE id = $1",
    ] {
        let _ = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(f.guest_id)
            .execute(pool)
            .await;
    }
    let _ = sqlx::query("DELETE FROM rooms WHERE room_type_id = $1")
        .bind(f.room_type_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM room_types WHERE id = $1")
        .bind(f.room_type_id)
        .execute(pool)
        .await;
}

#[tokio::test]
async fn group_room_is_kept_until_the_promised_hold_deadline() {
    let Ok(database_url) = std::env::var("DATABASE_URL") else {
        return;
    };
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("connect");
    let f = fixture(&pool).await;
    let (pool2, booking_id, group_id) = (pool.clone(), f.booking_id, f.group_id);
    let result = tokio::spawn(async move {
        let pool = pool2;
        // 2-hour setting has passed, but the guest was promised one more hour.
        let ids = stale_unpaid_hold_ids(&pool, 2, 10_000).await.unwrap();
        assert!(!ids.contains(&booking_id));
        assert!(group_hold_is_engaged(&pool, booking_id).await.unwrap());

        sqlx::query(
            "UPDATE booking_groups SET hold_expires_at = CURRENT_TIMESTAMP - interval '1 minute' WHERE id = $1",
        )
        .bind(group_id)
        .execute(&pool)
        .await
        .unwrap();
        let ids = stale_unpaid_hold_ids(&pool, 2, 10_000).await.unwrap();
        assert!(ids.contains(&booking_id), "released once the deadline passes");
        assert!(!group_hold_is_engaged(&pool, booking_id).await.unwrap());
    })
    .await;
    cleanup(&pool, &f).await;
    if let Err(err) = result {
        std::panic::resume_unwind(err.into_panic());
    }
}
