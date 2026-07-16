mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use chrono::{Duration, Utc};
    use hotel_app_be::modules::guest_booking::repository::GuestBookingRepository;

    #[tokio::test]
    async fn daily_walk_in_reserve_reduces_only_online_inventory() {
        let pool = crate::common::setup_test_db().await;
        let stay_date = Utc::now().date_naive() + Duration::days(14);
        sqlx::query(
            "INSERT INTO rooms (room_number, room_type_id, status, is_active)
             VALUES ('ONLINE-INVENTORY-01', 1, 'available', 1)",
        )
        .execute(&pool)
        .await
        .expect("room should be inserted");

        GuestBookingRepository::upsert_online_inventory(&pool, 1, stay_date, 1, true, 1)
            .await
            .expect("allocation should save");
        let allocations = GuestBookingRepository::list_online_inventory(&pool, stay_date)
            .await
            .expect("allocations should load");
        let standard = allocations
            .iter()
            .find(|item| item.room_type_id == 1)
            .expect("standard room allocation");
        assert_eq!(standard.physical_available_rooms, 1);
        assert_eq!(standard.walk_in_reserved_rooms, 1);
        assert_eq!(standard.online_available_rooms, 0);

        let (reserved, enabled) = GuestBookingRepository::online_allocation_for_stay(
            &pool,
            1,
            stay_date,
            stay_date + Duration::days(1),
        )
        .await
        .expect("stay allocation should load");
        assert_eq!(reserved, 1);
        assert!(enabled);
    }
}
