//! "My bookings" pages by unit (a multi-room booking or a single booking), so
//! a group's rooms are never split across pages.
//! Opt-in through `DATABASE_URL`; rows are hard-deleted afterwards.
use hotel_app_be::modules::guest_portal::session_repository::GuestPortalSessionRepository;
use sqlx::{PgPool, postgres::PgPoolOptions};

struct Fixture {
    guest_id: i64,
    group_id: i64,
    room_type_id: i64,
    group_rooms: Vec<String>,
}

async fn fixture(pool: &PgPool) -> Fixture {
    let tag = format!(
        "{:x}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let guest_id: i64 = sqlx::query_scalar(
        "INSERT INTO guests (nick_name, email, ic_number) VALUES ($1, $2, 'A1234567') RETURNING id",
    )
    .bind(format!("Paging {tag}"))
    .bind(format!("paging-{tag}@example.com"))
    .fetch_one(pool)
    .await
    .unwrap();
    let room_type_id: i64 = sqlx::query_scalar(
        "INSERT INTO room_types (code, name, base_price, max_occupancy) \
         VALUES ($1, $2, 100.00, 2) RETURNING id",
    )
    .bind(format!("PG{tag}"))
    .bind(format!("Paging Type {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let group_id: i64 = sqlx::query_scalar(
        "INSERT INTO booking_groups (group_number, guest_id, check_in_date, check_out_date) \
         VALUES ($1, $2, CURRENT_DATE + 10, CURRENT_DATE + 12) RETURNING id",
    )
    .bind(format!("GPG{tag}"))
    .bind(guest_id)
    .fetch_one(pool)
    .await
    .unwrap();
    // offset days, in group?
    let plan = [(20, false), (10, true), (10, true), (10, true), (5, false)];
    let mut group_rooms = Vec::new();
    for (i, (days, grouped)) in plan.iter().enumerate() {
        let room_id: i64 = sqlx::query_scalar(
            "INSERT INTO rooms (room_number, room_type_id, status, is_active) \
             VALUES ($1, $2, 'available', true) RETURNING id",
        )
        .bind(format!("PG{i}{tag}"))
        .bind(room_type_id)
        .fetch_one(pool)
        .await
        .unwrap();
        let number = format!("BPG{i}{tag}");
        sqlx::query(
            "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, \
                 room_rate, subtotal, total_amount, status, payment_status, currency, booking_group_id) \
             VALUES ($1, $2, $3, CURRENT_DATE + $4, CURRENT_DATE + $4 + 2, 100.00, 200.00, 200.00, \
                 'confirmed', 'unpaid', 'MYR', $5)",
        )
        .bind(&number)
        .bind(guest_id)
        .bind(room_id)
        .bind(*days)
        .bind(grouped.then_some(group_id))
        .execute(pool)
        .await
        .unwrap();
        if *grouped {
            group_rooms.push(number);
        }
    }
    Fixture {
        guest_id,
        group_id,
        room_type_id,
        group_rooms,
    }
}

async fn cleanup(pool: &PgPool, f: &Fixture) {
    let _ = sqlx::query("DELETE FROM bookings WHERE guest_id = $1")
        .bind(f.guest_id)
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

#[tokio::test]
async fn groups_are_never_split_across_pages() {
    let Ok(database_url) = std::env::var("DATABASE_URL") else {
        return;
    };
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("connect");
    let f = fixture(&pool).await;
    let pool2 = pool.clone();
    let (guest_id, group_rooms) = (f.guest_id, f.group_rooms.clone());
    let result = tokio::spawn(async move {
        let pool = pool2;
        let (page1, total) =
            GuestPortalSessionRepository::list_bookings(&pool, guest_id, 2, 0, None)
                .await
                .unwrap();
        assert_eq!(total, 3, "two singles + one group = three units");
        // Latest single first, then all three rooms of the group together.
        assert_eq!(page1.len(), 4);
        assert!(page1[0].booking_group_id.is_none());
        assert!(page1[1..].iter().all(|b| b.booking_group_id.is_some()));
        let (page2, _) = GuestPortalSessionRepository::list_bookings(&pool, guest_id, 2, 2, None)
            .await
            .unwrap();
        assert_eq!(page2.len(), 1);
        assert!(page2[0].booking_group_id.is_none());

        // Searching one room's number still returns the whole group.
        let (found, total) = GuestPortalSessionRepository::list_bookings(
            &pool,
            guest_id,
            10,
            0,
            Some(&group_rooms[1]),
        )
        .await
        .unwrap();
        assert_eq!(total, 1);
        assert_eq!(found.len(), 3);
    })
    .await;
    cleanup(&pool, &f).await;
    if let Err(err) = result {
        std::panic::resume_unwind(err.into_panic());
    }
}
