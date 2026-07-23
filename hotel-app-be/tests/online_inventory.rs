mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use chrono::{Duration, Utc};
    use hotel_app_be::modules::guest_booking::{
        models::BookingQuoteRequest, repository::GuestBookingRepository, service,
    };
    use rust_decimal::Decimal;

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

        GuestBookingRepository::upsert_online_inventory(&pool, 1, stay_date, 1, true, None, 1)
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
        assert_eq!(standard.custom_price, None);

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

    #[tokio::test]
    async fn custom_online_price_overrides_the_rate_for_its_stay_date() {
        let pool = crate::common::setup_test_db().await;
        let stay_date = Utc::now().date_naive() + Duration::days(14);
        sqlx::query(
            "INSERT INTO rooms (room_number, room_type_id, status, is_active)
             VALUES ('ONLINE-PRICE-01', 1, 'available', 1)",
        )
        .execute(&pool)
        .await
        .expect("room should be inserted");

        let custom_price = Decimal::new(19999, 2);
        GuestBookingRepository::upsert_online_inventory(
            &pool,
            1,
            stay_date,
            0,
            true,
            Some(custom_price),
            1,
        )
        .await
        .expect("allocation should save");

        let prices = GuestBookingRepository::online_custom_prices_for_stay(
            &pool,
            1,
            stay_date,
            stay_date + Duration::days(1),
        )
        .await
        .expect("custom prices should load");

        assert_eq!(prices.get(&stay_date), Some(&custom_price));

        let quote = service::quote(
            &pool,
            1,
            BookingQuoteRequest {
                room_type_id: 1,
                check_in_date: stay_date.to_string(),
                check_out_date: (stay_date + Duration::days(1)).to_string(),
                adults: Some(1),
                children: Some(0),
                voucher_id: None,
            },
        )
        .await
        .expect("online quote should use the custom price");

        assert_eq!(quote.nightly_rates[0].rate_plan_code, "ONLINE_CUSTOM");
        assert_eq!(quote.nightly_rates[0].amount, custom_price);
        assert_eq!(quote.total_amount, custom_price);
    }
}
