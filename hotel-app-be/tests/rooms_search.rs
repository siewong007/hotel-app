//! Integration tests for room availability search.
//!
//! SQLite-backed tests are gated so the default PostgreSQL build is not forced
//! to create a database.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use axum::extract::{Query, State};
    use hotel_app_be::handlers::rooms::search_rooms_handler;
    use hotel_app_be::models::SearchQuery;

    async fn seed_search_rooms(pool: &sqlx::SqlitePool) {
        sqlx::query(
            "INSERT INTO room_types (id, name, code, description, base_price, max_occupancy)
             VALUES
             (901, 'Search Standard', 'SSTD', 'Standard test room', 120.0, 2),
             (902, 'Search Deluxe', 'SDLX', 'Deluxe test room', 240.0, 3),
             (903, 'Search Suite', 'SSTE', 'Suite test room', 420.0, 4)",
        )
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO rooms
             (id, room_number, room_type_id, custom_price, status, is_active, created_at, updated_at)
             VALUES
             (9001, 'S101', 901, NULL, 'available', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
             (9002, 'S201', 902, NULL, 'available', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
             (9003, 'S202', 902, 275.0, 'available', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
             (9004, 'S301', 903, NULL, 'available', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
             (9005, 'S401', 902, NULL, 'maintenance', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    fn room_numbers(rooms: &[hotel_app_be::models::RoomWithRating]) -> Vec<String> {
        rooms.iter().map(|room| room.room_number.clone()).collect()
    }

    #[tokio::test]
    async fn search_rooms_filters_by_room_type_name_or_code() {
        let pool = common::setup_test_db().await;
        seed_search_rooms(&pool).await;

        let response = search_rooms_handler(
            State(pool),
            Query(SearchQuery {
                room_type: Some("search deluxe".to_string()),
                max_price: None,
                check_in_date: None,
                check_out_date: None,
                exclude_booking_id: None,
            }),
        )
        .await
        .expect("room search should succeed");

        assert_eq!(room_numbers(&response.0), vec!["S201", "S202"]);
    }

    #[tokio::test]
    async fn search_rooms_filters_by_room_type_code_and_max_price() {
        let pool = common::setup_test_db().await;
        seed_search_rooms(&pool).await;

        let response = search_rooms_handler(
            State(pool),
            Query(SearchQuery {
                room_type: Some("sdlx".to_string()),
                max_price: Some(250.0),
                check_in_date: None,
                check_out_date: None,
                exclude_booking_id: None,
            }),
        )
        .await
        .expect("room search should succeed");

        assert_eq!(room_numbers(&response.0), vec!["S201"]);
    }

    #[tokio::test]
    async fn search_rooms_combines_date_availability_with_type_and_price_filters() {
        let pool = common::setup_test_db().await;
        seed_search_rooms(&pool).await;

        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name) VALUES (9001, 'Search', 'Guest')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO bookings
             (id, booking_number, guest_id, room_id, room_type_id, check_in_date, check_out_date,
              rate_per_night, total_amount, status)
             VALUES
             (9001, 'BK-20300101-search01', 9001, 9002, 902, '2030-01-10', '2030-01-12',
              240.0, 480.0, 'confirmed')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let response = search_rooms_handler(
            State(pool),
            Query(SearchQuery {
                room_type: Some("Search Deluxe".to_string()),
                max_price: Some(300.0),
                check_in_date: Some("2030-01-10".to_string()),
                check_out_date: Some("2030-01-12".to_string()),
                exclude_booking_id: None,
            }),
        )
        .await
        .expect("room search should succeed");

        assert_eq!(room_numbers(&response.0), vec!["S202"]);
    }
}
