//! Live-PostgreSQL coverage for the online-inventory range read and the
//! tx-scoped bulk write helpers. Skipped without `DATABASE_URL` — the row
//! mapping touches date/numeric columns, so per the repo rules it needs one
//! test that actually fetches from a real database.

use chrono::NaiveDate;
use hotel_app_be::modules::guest_booking::repository::GuestBookingRepository;
use rust_decimal::Decimal;
use sqlx::PgPool;

const FROM: NaiveDate = match NaiveDate::from_ymd_opt(2036, 1, 5) {
    Some(d) => d,
    None => panic!("bad fixture date"),
};
const TO: NaiveDate = match NaiveDate::from_ymd_opt(2036, 1, 11) {
    Some(d) => d,
    None => panic!("bad fixture date"),
};

#[tokio::test]
async fn range_lists_every_room_type_for_every_date_and_bulk_round_trips() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping online inventory range test because DATABASE_URL is not set");
            return;
        }
    };
    let pool = PgPool::connect(&database_url)
        .await
        .expect("connect to test database");

    let room_type_id: Option<i64> =
        sqlx::query_scalar("SELECT id FROM room_types WHERE is_active = true ORDER BY id LIMIT 1")
            .fetch_optional(&pool)
            .await
            .expect("room type query");
    let Some(room_type_id) = room_type_id else {
        eprintln!("Skipping: no active room type seeded");
        return;
    };

    let rows = GuestBookingRepository::list_online_inventory_range(&pool, FROM, TO)
        .await
        .expect("range read");
    assert!(!rows.is_empty());
    let per_type = rows.iter().filter(|r| r.room_type_id == room_type_id).count();
    assert_eq!(per_type, 7, "one row per date for the room type");
    assert!(
        rows.iter().all(|r| r.standard_price > Decimal::ZERO),
        "every cell resolves a positive standard rate"
    );
    assert!(rows.iter().all(|r| r.stay_date >= FROM && r.stay_date <= TO));

    // Upsert one cell, then reset it — verifies both tx helpers against the
    // real CHECK constraints and leaves no residue behind.
    let mut tx = pool.begin().await.expect("begin");
    GuestBookingRepository::upsert_online_inventory_tx(
        &mut tx,
        room_type_id,
        FROM,
        1,
        true,
        Some(Decimal::new(19995, 2)),
        1,
    )
    .await
    .expect("upsert");
    tx.commit().await.expect("commit upsert");

    let after_upsert = GuestBookingRepository::list_online_inventory_range(&pool, FROM, FROM)
        .await
        .expect("refetch")
        .into_iter()
        .find(|r| r.room_type_id == room_type_id)
        .expect("row exists");
    assert!(after_upsert.is_override);
    assert_eq!(after_upsert.custom_price, Some(Decimal::new(19995, 2)));
    assert_eq!(after_upsert.walk_in_reserved_rooms, 1);

    let mut tx = pool.begin().await.expect("begin delete");
    GuestBookingRepository::delete_online_inventory_tx(&mut tx, room_type_id, FROM)
        .await
        .expect("delete");
    tx.commit().await.expect("commit delete");

    let after_reset = GuestBookingRepository::list_online_inventory_range(&pool, FROM, FROM)
        .await
        .expect("refetch after reset")
        .into_iter()
        .find(|r| r.room_type_id == room_type_id)
        .expect("row still listed");
    assert!(!after_reset.is_override);
    assert_eq!(after_reset.custom_price, None);
    assert_eq!(after_reset.walk_in_reserved_rooms, 0);
}
