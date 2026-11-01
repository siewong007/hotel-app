//! A guest cancelling a whole multi-room booking that is (partly) paid is
//! routed into the per-room staff review: one cancellation request per room,
//! filed in one call, nothing voided, and the desk bell rung once.
//! Opt-in through `DATABASE_URL`; rows are hard-deleted after each test.
use hotel_app_be::modules::guest_portal::service::cancel_my_booking_group;
use hotel_app_be::modules::support::hub::SupportHub;
use sqlx::{PgPool, postgres::PgPoolOptions};

#[derive(Clone)]
struct Fixture {
    guest_id: i64,
    group_id: i64,
    bookings: Vec<i64>,
    room_type_id: i64,
}

async fn fixture(pool: &PgPool) -> Fixture {
    let tag = format!(
        "{:x}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let guest_id: i64 = sqlx::query_scalar(
        "INSERT INTO guests (nick_name, email, ic_number) VALUES ($1, $2, 'A1234567') RETURNING id",
    )
    .bind(format!("Group Cancel {tag}"))
    .bind(format!("group-cancel-{tag}@example.com"))
    .fetch_one(pool)
    .await
    .unwrap();
    let room_type_id: i64 = sqlx::query_scalar(
        "INSERT INTO room_types (code, name, base_price, max_occupancy) \
         VALUES ($1, $2, 100.00, 2) RETURNING id",
    )
    .bind(format!("GC{tag}"))
    .bind(format!("Cancel Type {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let group_id: i64 = sqlx::query_scalar(
        "INSERT INTO booking_groups (group_number, guest_id, check_in_date, check_out_date) \
         VALUES ($1, $2, CURRENT_DATE + 10, CURRENT_DATE + 12) RETURNING id",
    )
    .bind(format!("GGC{tag}"))
    .bind(guest_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let mut bookings = Vec::new();
    for i in 0..2 {
        let room_id: i64 = sqlx::query_scalar(
            "INSERT INTO rooms (room_number, room_type_id, status, is_active) \
             VALUES ($1, $2, 'available', true) RETURNING id",
        )
        .bind(format!("GC{i}{tag}"))
        .bind(room_type_id)
        .fetch_one(pool)
        .await
        .unwrap();
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, \
                 room_rate, subtotal, total_amount, status, payment_status, currency, booking_group_id) \
             VALUES ($1, $2, $3, CURRENT_DATE + 10, CURRENT_DATE + 12, 100.00, 200.00, 200.00, \
                 'confirmed', 'unpaid', 'MYR', $4) RETURNING id",
        )
        .bind(format!("BGC{i}{tag}"))
        .bind(guest_id)
        .bind(room_id)
        .bind(group_id)
        .fetch_one(pool)
        .await
        .unwrap();
        bookings.push(id);
    }
    // Only the first room is paid: the whole group still goes to review.
    sqlx::query(
        "INSERT INTO payments (booking_id, amount, payment_method, payment_type, status) \
         VALUES ($1, 200.00, 'Cash', 'booking', 'completed')",
    )
    .bind(bookings[0])
    .execute(pool)
    .await
    .unwrap();
    Fixture {
        guest_id,
        group_id,
        bookings,
        room_type_id,
    }
}

async fn cleanup(pool: &PgPool, f: &Fixture) {
    let conversations: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, conversation_number FROM support_conversations WHERE guest_id = $1",
    )
    .bind(f.guest_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let ids: Vec<i64> = conversations.iter().map(|(id, _)| *id).collect();
    let numbers: Vec<String> = conversations.into_iter().map(|(_, n)| n).collect();
    let _ = sqlx::query("DELETE FROM staff_notifications WHERE subject = ANY($1)")
        .bind(&numbers)
        .execute(pool)
        .await;
    let _ = sqlx::query(
        "DELETE FROM audit_logs WHERE resource_type = 'support_conversation' AND resource_id = ANY($1)",
    )
    .bind(&ids)
    .execute(pool)
    .await;
    let _ = sqlx::query("DELETE FROM support_conversations WHERE guest_id = $1")
        .bind(f.guest_id)
        .execute(pool)
        .await;
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT c.table_name::text FROM information_schema.columns c \
         JOIN information_schema.tables t ON t.table_name = c.table_name \
            AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE' \
         WHERE c.table_schema = 'public' AND c.column_name = 'booking_id' \
            AND c.table_name <> 'bookings'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for _ in 0..3 {
        for t in &tables {
            let sql = format!("DELETE FROM {t} WHERE booking_id = ANY($1)");
            let _ = sqlx::query(sqlx::AssertSqlSafe(sql))
                .bind(&f.bookings)
                .execute(pool)
                .await;
        }
    }
    let _ = sqlx::query(
        "DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id = ANY($1)",
    )
    .bind(&f.bookings)
    .execute(pool)
    .await;
    let _ = sqlx::query("DELETE FROM bookings WHERE id = ANY($1)")
        .bind(&f.bookings)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM booking_groups WHERE id = $1")
        .bind(f.group_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM guests WHERE id = $1")
        .bind(f.guest_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM rooms WHERE room_type_id = $1")
        .bind(f.room_type_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM room_types WHERE id = $1")
        .bind(f.room_type_id)
        .execute(pool)
        .await;
}

async fn test_pool() -> Option<PgPool> {
    let database_url = std::env::var("DATABASE_URL").ok()?;
    // SAFETY: set before the first config read; every test sets the same value.
    unsafe {
        if std::env::var("JWT_SECRET").is_err() {
            std::env::set_var("JWT_SECRET", "test-secret-test-secret-test-secret");
        }
    }
    let _ = hotel_app_be::core::config::init_from_env();
    Some(
        PgPoolOptions::new()
            .max_connections(4)
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
            .expect("connect"),
    )
}

async fn run_guarded<F, Fut>(pool: &PgPool, f: &Fixture, body: F)
where
    F: FnOnce(PgPool, Fixture) -> Fut,
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    let result = tokio::spawn(body(pool.clone(), f.clone())).await;
    cleanup(pool, f).await;
    if let Err(err) = result {
        std::panic::resume_unwind(err.into_panic());
    }
}

#[tokio::test]
async fn paid_group_cancel_opens_one_review_per_room_and_rings_once() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let f = fixture(&pool).await;
    run_guarded(&pool, &f, move |pool, f| async move {
        let hub = SupportHub::default();
        let result = cancel_my_booking_group(
            &pool,
            &hub,
            f.guest_id,
            f.group_id,
            Some("Trip cancelled".to_string()),
            None,
            None,
        )
        .await
        .expect("paid group goes to review");
        assert_eq!(result["cancellation_requested"], true);
        let numbers: Vec<String> =
            serde_json::from_value(result["conversation_numbers"].clone()).unwrap();
        assert_eq!(numbers.len(), 2);
        assert_ne!(numbers[0], numbers[1], "one request per room");

        let statuses: Vec<String> =
            sqlx::query_scalar("SELECT status FROM bookings WHERE id = ANY($1) ORDER BY id")
                .bind(&f.bookings)
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(statuses, vec!["confirmed", "confirmed"], "nothing voided");

        let bells: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM staff_notifications \
             WHERE kind = 'guest_support_conversation' AND subject = ANY($1)",
        )
        .bind(&numbers)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(bells, 1, "a batch rings the desk once");

        // Every room is now under review, so a second press is refused.
        let err = cancel_my_booking_group(&pool, &hub, f.guest_id, f.group_id, None, None, None)
            .await
            .expect_err("already under review");
        assert!(err.to_string().contains("already being reviewed"), "{err}");
    })
    .await;
}

#[tokio::test]
async fn paid_group_cancel_is_refused_whole_when_a_room_has_arrived() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let f = fixture(&pool).await;
    run_guarded(&pool, &f, move |pool, f| async move {
        sqlx::query("UPDATE bookings SET status = 'checked_in' WHERE id = $1")
            .bind(f.bookings[1])
            .execute(&pool)
            .await
            .unwrap();
        let hub = SupportHub::default();
        cancel_my_booking_group(&pool, &hub, f.guest_id, f.group_id, None, None, None)
            .await
            .expect_err("an arrived room blocks the batch");
        let opened: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM support_conversations WHERE guest_id = $1")
                .bind(f.guest_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(opened, 0, "no request filed for any room");
    })
    .await;
}
