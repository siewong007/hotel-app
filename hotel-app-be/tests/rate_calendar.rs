//! Live-PostgreSQL coverage for the rate calendar resolution and the bulk
//! room-rate band upsert.
//!
//! The calendar's plan-resolution predicate (priority, validity, day-of-week
//! flags, band bounds, base fallback, custom_price overlay) only proves itself
//! against a real database. Opt-in through `DATABASE_URL`, matching the other
//! PostgreSQL tests.

mod postgres_tests {
    use chrono::NaiveDate;
    use hotel_app_be::modules::revenue::repository::RevenueRepository;
    use hotel_app_be::modules::revenue::validation::RevenueRange;
    use rust_decimal::Decimal;
    use sqlx::{PgPool, postgres::PgPoolOptions};

    /// Private id bands — each test keys its fixture rows off its own base so
    /// the parallel tests in this binary never collide, and every unique-coded
    /// row carries the band tag.
    const CAL_BASE: i64 = 997_000;
    const BULK_BASE: i64 = 997_100;

    fn date(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, day).expect("valid test date")
    }

    async fn pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping rate calendar test because DATABASE_URL is not set");
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

    /// Reseed child-first; all rows key off `base` and unique-coded rows carry
    /// `tag`, so the parallel tests in this binary never collide.
    async fn seed(pool: &PgPool, base: i64, tag: &str) {
        let (type_a, type_b) = (format!("RCA{tag}"), format!("RCB{tag}"));
        let (room_a1, room_a2, room_b1) = (
            format!("RA1{tag}"),
            format!("RA2{tag}"),
            format!("RB1{tag}"),
        );
        let (name_a, name_b) = (
            format!("Calendar Room {tag}"),
            format!("Calendar Basic {tag}"),
        );
        let (low_code, high_code) = (format!("LOW{tag}"), format!("HIGH{tag}"));
        let (low_name, high_name) = (format!("Low Plan {tag}"), format!("High Plan {tag}"));
        let (booking_no, guest_email, guest_name) = (
            format!("RC-SOLD-{tag}"),
            format!("calendar-guest-{tag}@hotel.test"),
            format!("Calendar Guest {tag}"),
        );
        for statement in [
            "DELETE FROM online_inventory_allocations WHERE room_type_id IN ($1, $1 + 1)",
            "DELETE FROM room_rates WHERE rate_plan_id IN ($1, $1 + 1)",
            "DELETE FROM rate_plans WHERE id IN ($1, $1 + 1)",
            "DELETE FROM bookings WHERE guest_id = $1",
            "DELETE FROM guests WHERE id = $1",
            "DELETE FROM room_status_change_log WHERE room_id IN \
                (SELECT id FROM rooms WHERE room_type_id IN ($1, $1 + 1))",
            "DELETE FROM rooms WHERE room_type_id IN ($1, $1 + 1)",
            "DELETE FROM room_types WHERE id IN ($1, $1 + 1)",
        ] {
            sqlx::query(statement)
                .bind(base)
                .execute(pool)
                .await
                .expect("clear fixture row");
        }
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $4, 100.00, 2), \
                    ($1 + 1, $3, $5, 80.00, 2)",
        )
        .bind(base)
        .bind(&type_a)
        .bind(&type_b)
        .bind(&name_a)
        .bind(&name_b)
        .execute(pool)
        .await
        .expect("seed room types");
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $1, 'available'), \
                    ($1 + 1, $3, $1, 'available'), \
                    ($1 + 2, $4, $1 + 1, 'available')",
        )
        .bind(base)
        .bind(&room_a1)
        .bind(&room_a2)
        .bind(&room_b1)
        .execute(pool)
        .await
        .expect("seed rooms");
        sqlx::query(
            "INSERT INTO guests (id, nick_name, email) OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $3)",
        )
        .bind(base)
        .bind(&guest_name)
        .bind(&guest_email)
        .execute(pool)
        .await
        .expect("seed guest");

        // LOW: priority 10, band 150 covering Oct 1-7.
        sqlx::query(
            "INSERT INTO rate_plans (id, name, code, plan_type, adjustment_type, \
             is_active, priority) OVERRIDING SYSTEM VALUE \
             VALUES ($1, $3, $2, 'standard', 'override', true, 10)",
        )
        .bind(base)
        .bind(&low_code)
        .bind(&low_name)
        .execute(pool)
        .await
        .expect("seed low plan");
        // HIGH: priority 20, band 220 covering Oct 1-7, but NOT Sundays.
        sqlx::query(
            "INSERT INTO rate_plans (id, name, code, plan_type, adjustment_type, \
             applies_sunday, is_active, priority) OVERRIDING SYSTEM VALUE \
             VALUES ($1 + 1, $3, $2, 'standard', 'override', \
             false, true, 20)",
        )
        .bind(base)
        .bind(&high_code)
        .bind(&high_name)
        .execute(pool)
        .await
        .expect("seed high plan");
        sqlx::query(
            "INSERT INTO room_rates (rate_plan_id, room_type_id, price, \
             effective_from, effective_to) VALUES \
             ($1, $1, 150.00, '2026-10-01', '2026-10-07'), \
             ($1 + 1, $1, 220.00, '2026-10-01', '2026-10-07')",
        )
        .bind(base)
        .execute(pool)
        .await
        .expect("seed room rates");

        // Online-channel override on Oct 3 only.
        sqlx::query(
            "INSERT INTO online_inventory_allocations \
             (room_type_id, stay_date, custom_price) \
             VALUES ($1, '2026-10-03', 260.00)",
        )
        .bind(base)
        .execute(pool)
        .await
        .expect("seed allocation");

        // Sold stay Oct 2-4 in a Calendar Room (2 nights).
        sqlx::query(
            "INSERT INTO bookings (id, booking_number, guest_id, room_id, \
             check_in_date, check_out_date, room_rate, subtotal, total_amount, \
             status, created_at) OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $1, $1, '2026-10-02', '2026-10-04', \
             100, 200, 200, 'confirmed', '2026-09-28 10:00:00+00')",
        )
        .bind(base)
        .bind(&booking_no)
        .execute(pool)
        .await
        .expect("seed booking");
    }

    fn cell(
        cells: &[hotel_app_be::modules::revenue::models::RateCalendarCell],
        room_type_id: i64,
        day: u32,
    ) -> &hotel_app_be::modules::revenue::models::RateCalendarCell {
        cells
            .iter()
            .find(|c| c.room_type_id == room_type_id && c.stay_date == date(day))
            .expect("cell for room type and date")
    }

    #[tokio::test]
    async fn calendar_resolves_priority_dow_fallback_and_overlay() {
        let Some(pool) = pool().await else {
            return;
        };
        seed(&pool, CAL_BASE, "C").await;
        let range = RevenueRange {
            from: date(1),
            to: date(7),
        };
        let (room_types, cells) = RevenueRepository::rate_calendar(&pool, &range)
            .await
            .expect("rate calendar");

        assert!(
            room_types
                .iter()
                .any(|rt| rt.room_type_id == CAL_BASE && rt.code == "RCAC")
        );

        // Oct 1 is a Thursday: HIGH (priority 20) beats LOW (priority 10).
        let oct1 = cell(&cells, CAL_BASE, 1);
        assert_eq!(oct1.rate_plan_code, "HIGHC");
        assert_eq!(oct1.plan_rate, Decimal::from(220));
        assert!(!oct1.is_base_rate);
        assert_eq!(oct1.effective_rate, Decimal::from(220));

        // Oct 4 is a Sunday: HIGH's applies_sunday=false drops it to LOW.
        let oct4 = cell(&cells, CAL_BASE, 4);
        assert_eq!(oct4.rate_plan_code, "LOWC");
        assert_eq!(oct4.plan_rate, Decimal::from(150));

        // Oct 3 carries the custom_price overlay; effective price follows it.
        let oct3 = cell(&cells, CAL_BASE, 3);
        assert_eq!(oct3.custom_price, Some(Decimal::from(260)));
        assert_eq!(oct3.effective_rate, Decimal::from(260));

        // Occupancy: the confirmed booking covers Oct 2-3 only.
        assert_eq!(oct1.sold_rooms, 0);
        assert_eq!(oct3.sold_rooms, 1);
        assert_eq!(oct3.physical_rooms, 2);
        assert_eq!(oct3.available_rooms, 1);
        assert_eq!(oct3.occupancy_pct, Decimal::new(500, 1));

        // Calendar Basic has no bands anywhere: base-price fallback.
        let basic = cell(&cells, CAL_BASE + 1, 1);
        assert!(basic.is_base_rate);
        assert_eq!(basic.rate_plan_code, "BASE");
        assert_eq!(basic.plan_rate, Decimal::from(80));
    }

    #[tokio::test]
    async fn bulk_upsert_inserts_then_updates_exact_bands() {
        use hotel_app_be::models::BulkRoomRateInput;
        let Some(pool) = pool().await else {
            return;
        };
        seed(&pool, BULK_BASE, "B").await;

        let input = |price: f64, from: &str, to: &str| BulkRoomRateInput {
            rate_plan_id: BULK_BASE,
            room_type_ids: vec![BULK_BASE, BULK_BASE + 1],
            effective_from: from.to_string(),
            effective_to: to.to_string(),
            price,
        };

        let created = hotel_app_be::services::rates::bulk_upsert_room_rates(
            &pool,
            BULK_BASE,
            input(180.0, "2026-11-01", "2026-11-10"),
        )
        .await
        .expect("bulk insert");
        assert_eq!(created.len(), 2);
        assert!(created.iter().all(|r| r.price == Decimal::from(180)));

        // Identical call must update the same rows, not insert duplicates.
        let updated = hotel_app_be::services::rates::bulk_upsert_room_rates(
            &pool,
            BULK_BASE,
            input(190.0, "2026-11-01", "2026-11-10"),
        )
        .await
        .expect("bulk update");
        assert_eq!(updated.len(), 2);
        let created_ids: Vec<i64> = created.iter().map(|r| r.id).collect();
        assert!(updated.iter().all(|r| created_ids.contains(&r.id)));
        assert!(updated.iter().all(|r| r.price == Decimal::from(190)));

        // A different band start inserts new rows rather than updating; the
        // unique key is (plan, room_type, effective_from), so a same-start
        // band is always an in-place reprice.
        let inserted = hotel_app_be::services::rates::bulk_upsert_room_rates(
            &pool,
            BULK_BASE,
            input(200.0, "2026-11-11", "2026-11-15"),
        )
        .await
        .expect("bulk second band");
        assert!(inserted.iter().all(|r| !created_ids.contains(&r.id)));

        // Validation: empty type list, inverted range, missing plan.
        let empty = BulkRoomRateInput {
            rate_plan_id: BULK_BASE,
            room_type_ids: vec![],
            effective_from: "2026-11-01".to_string(),
            effective_to: "2026-11-10".to_string(),
            price: 100.0,
        };
        assert!(
            hotel_app_be::services::rates::bulk_upsert_room_rates(&pool, BULK_BASE, empty)
                .await
                .is_err()
        );
        let inverted = BulkRoomRateInput {
            rate_plan_id: BULK_BASE,
            room_type_ids: vec![BULK_BASE],
            effective_from: "2026-11-10".to_string(),
            effective_to: "2026-11-01".to_string(),
            price: 100.0,
        };
        assert!(
            hotel_app_be::services::rates::bulk_upsert_room_rates(&pool, BULK_BASE, inverted)
                .await
                .is_err()
        );
        let missing_plan = BulkRoomRateInput {
            rate_plan_id: BULK_BASE + 9_999,
            room_type_ids: vec![BULK_BASE],
            effective_from: "2026-11-01".to_string(),
            effective_to: "2026-11-10".to_string(),
            price: 100.0,
        };
        assert!(
            hotel_app_be::services::rates::bulk_upsert_room_rates(&pool, BULK_BASE, missing_plan)
                .await
                .is_err()
        );
    }
}
