//! Staff group actions (cancel all / check in all / check out all) reuse the
//! per-room rules: check-in and cancel are all-or-nothing in one transaction,
//! checkout is refused for the whole group while any room has a balance.
//! Opt-in through `DATABASE_URL`; rows are hard-deleted after each test.
use hotel_app_be::modules::bookings::group_actions::{GroupAction, run_group_action};
use sqlx::{PgPool, postgres::PgPoolOptions};

#[derive(Clone)]
struct Fixture {
    guest_id: i64,
    group_id: i64,
    bookings: Vec<i64>,
    room_type_id: i64,
}

async fn fixture(pool: &PgPool, totals: [&str; 2]) -> Fixture {
    let tag = format!(
        "{:x}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let guest_id: i64 = sqlx::query_scalar(
        "INSERT INTO guests (nick_name, email, ic_number) VALUES ($1, $2, 'A1234567') RETURNING id",
    )
    .bind(format!("Group Act {tag}"))
    .bind(format!("group-act-{tag}@example.com"))
    .fetch_one(pool)
    .await
    .unwrap();
    let room_type_id: i64 = sqlx::query_scalar(
        "INSERT INTO room_types (code, name, base_price, max_occupancy) \
         VALUES ($1, $2, 100.00, 2) RETURNING id",
    )
    .bind(format!("GA{tag}"))
    .bind(format!("Act Type {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let group_id: i64 = sqlx::query_scalar(
        "INSERT INTO booking_groups (group_number, guest_id, check_in_date, check_out_date) \
         VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE + 2) RETURNING id",
    )
    .bind(format!("GGA{tag}"))
    .bind(guest_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let mut bookings = Vec::new();
    for (i, total) in totals.iter().enumerate() {
        let room_id: i64 = sqlx::query_scalar(
            "INSERT INTO rooms (room_number, room_type_id, status, is_active) \
             VALUES ($1, $2, 'available', true) RETURNING id",
        )
        .bind(format!("GA{i}{tag}"))
        .bind(room_type_id)
        .fetch_one(pool)
        .await
        .unwrap();
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, \
                 room_rate, subtotal, total_amount, status, payment_status, currency, booking_group_id) \
             VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + 2, 100.00, $4::numeric, $4::numeric, \
                 'confirmed', 'unpaid', 'MYR', $5) RETURNING id",
        )
        .bind(format!("BGA{i}{tag}"))
        .bind(guest_id)
        .bind(room_id)
        .bind(total)
        .bind(group_id)
        .fetch_one(pool)
        .await
        .unwrap();
        bookings.push(id);
    }
    Fixture {
        guest_id,
        group_id,
        bookings,
        room_type_id,
    }
}

async fn cleanup(pool: &PgPool, f: &Fixture) {
    // Every table that references a booking (history, audit, modifications,
    // ledgers, postings...) — discovered so new side tables are covered too.
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

async fn pool_and_actor() -> Option<(PgPool, i64)> {
    let database_url = std::env::var("DATABASE_URL").ok()?;
    // SAFETY: set before the first config read; every test sets the same value.
    unsafe {
        if std::env::var("JWT_SECRET").is_err() {
            std::env::set_var("JWT_SECRET", "test-secret-test-secret-test-secret");
        }
    }
    let _ = hotel_app_be::core::config::init_from_env();
    let pool = PgPoolOptions::new()
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
        .expect("connect");
    let actor: i64 = sqlx::query_scalar("SELECT id FROM users ORDER BY id LIMIT 1")
        .fetch_one(&pool)
        .await
        .expect("a staff user exists in the test database");
    Some((pool, actor))
}

async fn statuses(pool: &PgPool, f: &Fixture) -> Vec<String> {
    sqlx::query_scalar("SELECT status FROM bookings WHERE id = ANY($1) ORDER BY id")
        .bind(&f.bookings)
        .fetch_all(pool)
        .await
        .unwrap()
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
async fn checkin_all_is_all_or_nothing_and_checkout_all_needs_every_balance_settled() {
    let Some((pool, actor)) = pool_and_actor().await else {
        return;
    };
    let f = fixture(&pool, ["120.00", "80.25"]).await;
    run_guarded(&pool, &f, move |pool, f| async move {
        // One room still awaiting payment → the whole check-in is refused.
        sqlx::query("UPDATE bookings SET status = 'pending' WHERE id = $1")
            .bind(f.bookings[1])
            .execute(&pool)
            .await
            .unwrap();
        let err = run_group_action(&pool, actor, f.bookings[0], GroupAction::CheckIn, None)
            .await
            .expect_err("pending room blocks the group");
        assert!(err.to_string().contains("No rooms were changed"), "{err}");
        assert_eq!(statuses(&pool, &f).await, vec!["confirmed", "pending"]);

        sqlx::query("UPDATE bookings SET status = 'confirmed' WHERE id = $1")
            .bind(f.bookings[1])
            .execute(&pool)
            .await
            .unwrap();
        let done = run_group_action(&pool, actor, f.bookings[1], GroupAction::CheckIn, None)
            .await
            .expect("check in all");
        assert_eq!(done.processed, f.bookings);
        assert_eq!(statuses(&pool, &f).await, vec!["checked_in", "checked_in"]);
        let occupied: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM rooms r JOIN bookings b ON b.room_id = r.id \
             WHERE b.id = ANY($1) AND r.status = 'occupied'",
        )
        .bind(&f.bookings)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(occupied, 2);

        // Unpaid balances → checkout refused for the whole group, nothing changes.
        let err = run_group_action(&pool, actor, f.bookings[0], GroupAction::CheckOut, None)
            .await
            .expect_err("balance blocks checkout");
        assert!(
            err.to_string().contains("No rooms were checked out"),
            "{err}"
        );
        assert_eq!(statuses(&pool, &f).await, vec!["checked_in", "checked_in"]);
    })
    .await;
}

#[tokio::test]
async fn checkout_all_checks_out_every_settled_room() {
    let Some((pool, actor)) = pool_and_actor().await else {
        return;
    };
    let f = fixture(&pool, ["0.00", "0.00"]).await;
    run_guarded(&pool, &f, move |pool, f| async move {
        sqlx::query("UPDATE bookings SET status = 'checked_in' WHERE id = ANY($1)")
            .bind(&f.bookings)
            .execute(&pool)
            .await
            .unwrap();
        let done = run_group_action(&pool, actor, f.bookings[0], GroupAction::CheckOut, None)
            .await
            .expect("check out all");
        assert_eq!(done.processed, f.bookings);
        assert_eq!(
            statuses(&pool, &f).await,
            vec!["checked_out", "checked_out"]
        );
    })
    .await;
}

#[tokio::test]
async fn cancel_all_voids_every_room_in_one_go_and_refuses_once_a_guest_is_in_house() {
    let Some((pool, actor)) = pool_and_actor().await else {
        return;
    };
    let f = fixture(&pool, ["120.00", "80.25"]).await;
    run_guarded(&pool, &f, move |pool, f| async move {
        sqlx::query("UPDATE bookings SET status = 'checked_in' WHERE id = $1")
            .bind(f.bookings[0])
            .execute(&pool)
            .await
            .unwrap();
        run_group_action(&pool, actor, f.bookings[1], GroupAction::Cancel, None)
            .await
            .expect_err("in-house room blocks cancel all");
        assert_eq!(statuses(&pool, &f).await, vec!["checked_in", "confirmed"]);

        sqlx::query("UPDATE bookings SET status = 'confirmed' WHERE id = $1")
            .bind(f.bookings[0])
            .execute(&pool)
            .await
            .unwrap();
        let done = run_group_action(
            &pool,
            actor,
            f.bookings[0],
            GroupAction::Cancel,
            Some("Group cancelled by phone".to_string()),
        )
        .await
        .expect("cancel all");
        assert_eq!(done.processed, f.bookings);
        assert_eq!(statuses(&pool, &f).await, vec!["voided", "voided"]);
        let (group_status, rooms): (String, i32) =
            sqlx::query_as("SELECT status, room_count FROM booking_groups WHERE id = $1")
                .bind(f.group_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(group_status, "voided");
        assert_eq!(rooms, 0);
    })
    .await;
}
