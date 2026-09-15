//! Live-PostgreSQL coverage for `room_types.images` on the admin update path.
//! Skipped without `DATABASE_URL` — the jsonb row mapping needs one test that
//! actually fetches from a real database (SQLx here is runtime-checked).

use hotel_app_be::modules::rooms::queries as rq;
use rust_decimal::Decimal;
use sqlx::PgPool;

fn noop_update<'a>(images: &'a Option<Vec<String>>) -> rq::RoomTypeUpdate<'a> {
    rq::RoomTypeUpdate {
        name: &None,
        code: &None,
        description: &None,
        base_price: None,
        weekday_rate: None,
        weekend_rate: None,
        max_occupancy: None,
        bed_type: &None,
        bed_count: None,
        allows_extra_bed: None,
        max_extra_beds: None,
        extra_bed_charge: None,
        is_active: None,
        sort_order: None,
        images,
    }
}

#[tokio::test]
async fn room_type_images_round_trip_through_update() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping room type images test because DATABASE_URL is not set");
            return;
        }
    };
    let pool = PgPool::connect(&database_url)
        .await
        .expect("connect to test database");

    // Own type so the test never mutates seeded data; cleaned up at the end.
    let code = format!("TIMG{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
    let id = rq::insert_room_type(
        &pool,
        rq::NewRoomType {
            name: "Image Round-Trip Type",
            code: &code,
            description: &None,
            base_price: Decimal::new(10000, 2),
            weekday_rate: None,
            weekend_rate: None,
            max_occupancy: 2,
            bed_type: &None,
            bed_count: 1,
            allows_extra_bed: false,
            max_extra_beds: 0,
            extra_bed_charge: Decimal::ZERO,
            sort_order: 0,
        },
    )
    .await
    .expect("insert room type");

    let images = vec![
        "/uploads/room-types/a.jpg".to_string(),
        "/uploads/room-types/b.png".to_string(),
    ];
    rq::update_room_type(&pool, id, noop_update(&Some(images.clone())))
        .await
        .expect("update images");
    let fetched = rq::fetch_room_type_by_id(&pool, id).await.expect("fetch");
    assert_eq!(fetched.images, images);

    // A patch without images leaves the column untouched.
    rq::update_room_type(&pool, id, noop_update(&None))
        .await
        .expect("noop update");
    let fetched = rq::fetch_room_type_by_id(&pool, id).await.expect("fetch");
    assert_eq!(fetched.images, images);

    // An empty array clears the list.
    rq::update_room_type(&pool, id, noop_update(&Some(Vec::new())))
        .await
        .expect("clear images");
    let fetched = rq::fetch_room_type_by_id(&pool, id).await.expect("fetch");
    assert!(fetched.images.is_empty());

    rq::delete_room_type(&pool, id).await.expect("cleanup");
}

#[tokio::test]
async fn public_room_types_lists_active_types_with_images_only() {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping public room types test because DATABASE_URL is not set");
            return;
        }
    };
    let pool = PgPool::connect(&database_url)
        .await
        .expect("connect to test database");

    let suffix = &uuid::Uuid::new_v4().simple().to_string()[..8];
    let active_code = format!("TPUB{suffix}");
    let active_id = rq::insert_room_type(
        &pool,
        rq::NewRoomType {
            name: "Public Images Type",
            code: &active_code,
            description: &None,
            base_price: Decimal::new(10000, 2),
            weekday_rate: None,
            weekend_rate: None,
            max_occupancy: 2,
            bed_type: &None,
            bed_count: 1,
            allows_extra_bed: false,
            max_extra_beds: 0,
            extra_bed_charge: Decimal::ZERO,
            sort_order: 0,
        },
    )
    .await
    .expect("insert active type");
    let inactive_code = format!("TPRH{suffix}");
    let inactive_id = rq::insert_room_type(
        &pool,
        rq::NewRoomType {
            name: "Hidden Images Type",
            code: &inactive_code,
            description: &None,
            base_price: Decimal::new(10000, 2),
            weekday_rate: None,
            weekend_rate: None,
            max_occupancy: 2,
            bed_type: &None,
            bed_count: 1,
            allows_extra_bed: false,
            max_extra_beds: 0,
            extra_bed_charge: Decimal::ZERO,
            sort_order: 0,
        },
    )
    .await
    .expect("insert inactive type");

    let images = vec!["/uploads/room-types/pub.jpg".to_string()];
    rq::update_room_type(&pool, active_id, noop_update(&Some(images.clone())))
        .await
        .expect("set images");
    sqlx::query("UPDATE room_types SET is_active = false WHERE id = $1")
        .bind(inactive_id)
        .execute(&pool)
        .await
        .expect("deactivate type");

    let listed = hotel_app_be::modules::guest_booking::repository::GuestBookingRepository::list_public_room_types(&pool)
        .await
        .expect("list public room types");

    let active = listed
        .iter()
        .find(|t| t.id == active_id)
        .expect("active type listed");
    assert_eq!(active.images, images);
    assert!(listed.iter().all(|t| t.id != inactive_id));

    rq::delete_room_type(&pool, active_id).await.expect("cleanup");
    rq::delete_room_type(&pool, inactive_id)
        .await
        .expect("cleanup");
}
