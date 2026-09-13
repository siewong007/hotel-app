//! Live-PostgreSQL coverage for the revenue overview aggregates.
//!
//! sqlx binds/decode run at runtime, and the stay-night spread
//! (`generate_series` over `check_in..check_out`) can only be proven against a
//! real database. Opt-in through `DATABASE_URL`, matching the other
//! PostgreSQL tests.

mod postgres_tests {
    use chrono::NaiveDate;
    use hotel_app_be::modules::revenue::repository::RevenueRepository;
    use hotel_app_be::modules::revenue::validation::RevenueRange;
    use rust_decimal::Decimal;
    use sqlx::{PgPool, postgres::PgPoolOptions};

    /// Private id band — every fixture row keys off BASE.
    const BASE: i64 = 996_000;

    fn date(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, day).expect("valid test date")
    }

    async fn pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping revenue overview test because DATABASE_URL is not set");
                return None;
            }
        };
        Some(
            PgPoolOptions::new()
                .max_connections(2)
                .connect(&database_url)
                .await
                .expect("failed to connect to PostgreSQL test database"),
        )
    }

    /// Reseed child-first; all rows key off BASE so parallel binaries never
    /// collide.
    async fn seed(pool: &PgPool) {
        for statement in [
            "DELETE FROM bookings WHERE guest_id = $1",
            "DELETE FROM guests WHERE id = $1",
            "DELETE FROM rooms WHERE room_type_id = $1",
            "DELETE FROM room_types WHERE id = $1",
        ] {
            sqlx::query(statement)
                .bind(BASE)
                .execute(pool)
                .await
                .expect("clear fixture row");
        }
        sqlx::query(
            "INSERT INTO guests (id, nick_name, email) OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'Revenue Guest', 'revenue-guest@hotel.test')",
        )
        .bind(BASE)
        .execute(pool)
        .await
        .expect("seed guest");
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'REV', 'Revenue Room', 100.00, 2)",
        )
        .bind(BASE)
        .execute(pool)
        .await
        .expect("seed room type");
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'REV1', $1, 'available')",
        )
        .bind(BASE)
        .execute(pool)
        .await
        .expect("seed room");

        // Sold stay: Oct 1-3 (2 nights), subtotal 200 -> 100/night.
        sqlx::query(
            "INSERT INTO bookings (id, booking_number, guest_id, room_id, \
             check_in_date, check_out_date, room_rate, subtotal, total_amount, status, \
             created_at) OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'REV-SOLD', $1, $1, '2026-10-01', '2026-10-03', \
             100, 200, 200, 'confirmed', '2026-09-28 10:00:00+00')",
        )
        .bind(BASE)
        .execute(pool)
        .await
        .expect("seed sold booking");
        // Voided stay overlapping the same window: must contribute nothing to
        // stay metrics but count in the created/voided set.
        sqlx::query(
            "INSERT INTO bookings (id, booking_number, guest_id, room_id, \
             check_in_date, check_out_date, room_rate, subtotal, total_amount, status, \
             created_at) OVERRIDING SYSTEM VALUE \
             VALUES ($1 + 1, 'REV-VOID', $1, $1, '2026-10-01', '2026-10-02', \
             100, 100, 0, 'voided', '2026-09-29 10:00:00+00')",
        )
        .bind(BASE)
        .execute(pool)
        .await
        .expect("seed voided booking");
        // Stay partially inside the window: Oct 3-5, subtotal 200 -> 100/night;
        // a range ending Oct 3 must count only the Oct-3 night.
        sqlx::query(
            "INSERT INTO bookings (id, booking_number, guest_id, room_id, \
             check_in_date, check_out_date, room_rate, subtotal, total_amount, status, \
             created_at) OVERRIDING SYSTEM VALUE \
             VALUES ($1 + 2, 'REV-EDGE', $1, $1, '2026-10-03', '2026-10-05', \
             100, 200, 200, 'confirmed', '2026-10-01 10:00:00+00')",
        )
        .bind(BASE)
        .execute(pool)
        .await
        .expect("seed edge booking");
    }

    #[tokio::test]
    async fn stay_sums_exclude_voids_and_clip_to_window() {
        let Some(pool) = pool().await else {
            return;
        };
        seed(&pool).await;
        let range = RevenueRange {
            from: date(1),
            to: date(3),
        };
        let sums = RevenueRepository::stay_sums(&pool, &range, Some(BASE), None)
            .await
            .expect("stay sums");
        // 100+100 (REV-SOLD nights 1-2) + 100 (REV-EDGE night 3 only).
        assert_eq!(sums.room_revenue, Decimal::from(300));
        assert_eq!(sums.room_nights_sold, 3);
        assert_eq!(sums.stay_bookings, 2);
        assert!(sums.sellable_rooms >= 1);
    }

    #[tokio::test]
    async fn daily_spreads_revenue_per_stay_night() {
        let Some(pool) = pool().await else {
            return;
        };
        seed(&pool).await;
        let range = RevenueRange {
            from: date(1),
            to: date(3),
        };
        let daily = RevenueRepository::daily(&pool, &range, Some(BASE), None)
            .await
            .expect("daily rows");
        assert_eq!(daily.len(), 3);
        assert_eq!(daily[0].date, date(1));
        assert_eq!(daily[0].room_revenue, Decimal::from(100));
        assert_eq!(daily[0].room_nights_sold, 1);
        assert_eq!(daily[2].date, date(3));
        assert_eq!(daily[2].room_revenue, Decimal::from(100));
        let total: Decimal = daily.iter().map(|row| row.room_revenue).sum();
        assert_eq!(total, Decimal::from(300));
    }

    #[tokio::test]
    async fn voided_booking_counts_in_created_and_void_rate_inputs() {
        let Some(pool) = pool().await else {
            return;
        };
        seed(&pool).await;
        // Booking-creation window covering all three fixture bookings.
        let range = RevenueRange {
            from: NaiveDate::from_ymd_opt(2026, 9, 28).expect("valid date"),
            to: NaiveDate::from_ymd_opt(2026, 10, 1).expect("valid date"),
        };
        let sums = RevenueRepository::stay_sums(&pool, &range, Some(BASE), None)
            .await
            .expect("stay sums");
        assert_eq!(sums.bookings_created, 3);
        assert_eq!(sums.voided_created, 1);
        assert_eq!(sums.no_show_created, 0);
    }
}
