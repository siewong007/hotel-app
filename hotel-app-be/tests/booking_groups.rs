//! PostgreSQL coverage for multi-room booking groups (`booking_groups` +
//! `bookings.booking_group_id`). Opt-in through `DATABASE_URL`; every test
//! runs inside a transaction that is rolled back, so no rows are left behind.
mod postgres_tests {
    use chrono::{NaiveDate, Utc};
    use hotel_app_be::modules::booking_groups::models::NewBookingGroup;
    use hotel_app_be::modules::booking_groups::repository::BookingGroupRepository;
    use rust_decimal::Decimal;
    use sqlx::{PgPool, Postgres, Transaction, postgres::PgPoolOptions};
    use std::sync::LazyLock;
    use std::sync::atomic::{AtomicU64, Ordering};

    async fn pool() -> Option<PgPool> {
        let Ok(database_url) = std::env::var("DATABASE_URL") else {
            eprintln!("Skipping booking-group PostgreSQL test because DATABASE_URL is not set");
            return None;
        };
        Some(
            PgPoolOptions::new()
                .max_connections(2)
                .connect(&database_url)
                .await
                .expect("failed to connect to PostgreSQL test database"),
        )
    }

    fn unique_suffix() -> u64 {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        static BASE: LazyLock<u64> = LazyLock::new(|| {
            Utc::now()
                .timestamp_nanos_opt()
                .unwrap_or_default()
                .unsigned_abs()
        });
        *BASE + SEQ.fetch_add(1, Ordering::Relaxed)
    }

    fn day(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2031, 3, d).unwrap()
    }

    fn dec(value: &str) -> Decimal {
        value.parse().unwrap()
    }

    struct Seed {
        guest_id: i64,
        room_type_ids: Vec<i64>,
        room_ids: Vec<i64>,
    }

    async fn seed(tx: &mut Transaction<'_, Postgres>, suffix: u64) -> Seed {
        let tag = format!("{suffix:x}");
        let guest_id: i64 =
            sqlx::query_scalar("INSERT INTO guests (nick_name, email) VALUES ($1, $2) RETURNING id")
                .bind(format!("Group Guest {suffix}"))
                .bind(format!("group-guest-{suffix}@hotel.test"))
                .fetch_one(&mut **tx)
                .await
                .unwrap();
        let mut room_type_ids = Vec::new();
        let mut room_ids = Vec::new();
        for (index, prefix) in ["X", "Y"].iter().enumerate() {
            let room_type_id: i64 = sqlx::query_scalar(
                "INSERT INTO room_types (code, name, base_price, max_occupancy) \
                 VALUES ($1, $2, 100.00, 2) RETURNING id",
            )
            .bind(format!("{prefix}{tag}"))
            .bind(format!("Group Type {prefix} {suffix}"))
            .fetch_one(&mut **tx)
            .await
            .unwrap();
            room_type_ids.push(room_type_id);
            let room_id: i64 = sqlx::query_scalar(
                "INSERT INTO rooms (room_number, room_type_id, status, is_active) \
                 VALUES ($1, $2, 'available', true) RETURNING id",
            )
            .bind(format!("{prefix}{index}{tag}"))
            .bind(room_type_id)
            .fetch_one(&mut **tx)
            .await
            .unwrap();
            room_ids.push(room_id);
        }
        Seed {
            guest_id,
            room_type_ids,
            room_ids,
        }
    }

    async fn insert_booking(
        tx: &mut Transaction<'_, Postgres>,
        guest_id: i64,
        room_id: i64,
        number: String,
        subtotal: &str,
        total: &str,
        payment_status: &str,
    ) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, \
                 room_rate, subtotal, discount_amount, tourism_tax_amount, total_amount, status, payment_status) \
             VALUES ($1, $2, $3, $4, $5, 100.00, $6::numeric, 10.00, 20.00, $7::numeric, 'pending_payment', $8) \
             RETURNING id",
        )
        .bind(number)
        .bind(guest_id)
        .bind(room_id)
        .bind(day(10))
        .bind(day(12))
        .bind(subtotal)
        .bind(total)
        .bind(payment_status)
        .fetch_one(&mut **tx)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn group_totals_follow_live_members_and_void_with_the_last_room() {
        let Some(pool) = pool().await else { return };
        let suffix = unique_suffix();
        let mut tx = pool.begin().await.unwrap();
        let seed = seed(&mut tx, suffix).await;

        BookingGroupRepository::lock_room_types_tx(
            &mut tx,
            &[seed.room_type_ids[1], seed.room_type_ids[0], seed.room_type_ids[1]],
        )
        .await
        .expect("locks every cart room type");

        let group = BookingGroupRepository::create_tx(
            &mut tx,
            &NewBookingGroup {
                guest_id: seed.guest_id,
                check_in_date: day(10),
                check_out_date: day(12),
                source: "website".to_string(),
                currency: "MYR".to_string(),
                voucher_id: None,
                hold_expires_at: None,
                portal_request_id: Some(format!("grp-{suffix}")),
                created_by: None,
            },
        )
        .await
        .unwrap();
        assert!(group.group_number.starts_with("GBK-20310310-"));
        assert_eq!(group.status, "active");
        assert_eq!(group.room_count, 0);

        let a = insert_booking(&mut tx, seed.guest_id, seed.room_ids[0], format!("GA-{suffix:x}"), "200.00", "210.00", "unpaid").await;
        let b = insert_booking(&mut tx, seed.guest_id, seed.room_ids[1], format!("GB-{suffix:x}"), "300.00", "310.00", "unpaid").await;
        BookingGroupRepository::attach_tx(&mut tx, group.id, &[a, b]).await.unwrap();

        let group = BookingGroupRepository::refresh_totals_tx(&mut tx, group.id).await.unwrap();
        assert_eq!(group.room_count, 2);
        assert_eq!(group.subtotal, dec("500.00"));
        assert_eq!(group.discount_amount, dec("20.00"));
        assert_eq!(group.tourism_tax_amount, dec("40.00"));
        assert_eq!(group.total_amount, dec("520.00"));
        assert_eq!(group.payment_status, "unpaid");

        // Single-room cancel: only that room's share leaves the group.
        sqlx::query("UPDATE bookings SET status = 'voided', payment_status = 'void' WHERE id = $1")
            .bind(a)
            .execute(&mut *tx)
            .await
            .unwrap();
        let group = BookingGroupRepository::refresh_totals_tx(&mut tx, group.id).await.unwrap();
        assert_eq!(group.room_count, 1);
        assert_eq!(group.total_amount, dec("310.00"));
        assert_eq!(group.status, "active");

        sqlx::query("UPDATE bookings SET status = 'voided', payment_status = 'void' WHERE id = $1")
            .bind(b)
            .execute(&mut *tx)
            .await
            .unwrap();
        let group = BookingGroupRepository::refresh_totals_tx(&mut tx, group.id).await.unwrap();
        assert_eq!(group.room_count, 0);
        assert_eq!(group.status, "voided");
        assert_eq!(group.payment_status, "void");

        tx.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn locking_an_unknown_room_type_is_not_found() {
        let Some(pool) = pool().await else { return };
        let suffix = unique_suffix();
        let mut tx = pool.begin().await.unwrap();
        let seed = seed(&mut tx, suffix).await;
        assert!(
            BookingGroupRepository::lock_room_types_tx(&mut tx, &[seed.room_type_ids[0], -1])
                .await
                .is_err()
        );
        tx.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn attach_refuses_another_guests_booking() {
        let Some(pool) = pool().await else { return };
        let suffix = unique_suffix();
        let mut tx = pool.begin().await.unwrap();
        let seed = seed(&mut tx, suffix).await;
        let other = seed_other_guest(&mut tx, suffix).await;
        let group = BookingGroupRepository::create_tx(
            &mut tx,
            &NewBookingGroup {
                guest_id: seed.guest_id,
                check_in_date: day(10),
                check_out_date: day(12),
                source: "website".to_string(),
                currency: "MYR".to_string(),
                voucher_id: None,
                hold_expires_at: None,
                portal_request_id: None,
                created_by: None,
            },
        )
        .await
        .unwrap();
        let foreign = insert_booking(&mut tx, other, seed.room_ids[0], format!("GF-{suffix:x}"), "200.00", "200.00", "unpaid").await;
        assert!(BookingGroupRepository::attach_tx(&mut tx, group.id, &[foreign]).await.is_err());
        tx.rollback().await.unwrap();
    }

    async fn seed_other_guest(tx: &mut Transaction<'_, Postgres>, suffix: u64) -> i64 {
        sqlx::query_scalar("INSERT INTO guests (nick_name, email) VALUES ($1, $2) RETURNING id")
            .bind(format!("Other Guest {suffix}"))
            .bind(format!("group-other-{suffix}@hotel.test"))
            .fetch_one(&mut **tx)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn group_rejects_inverted_dates_at_the_schema() {
        let Some(pool) = pool().await else { return };
        let suffix = unique_suffix();
        let mut tx = pool.begin().await.unwrap();
        let seed = seed(&mut tx, suffix).await;
        let result = sqlx::query(
            "INSERT INTO booking_groups (group_number, guest_id, check_in_date, check_out_date) \
             VALUES ($1, $2, $3, $3)",
        )
        .bind(format!("GX-{suffix:x}"))
        .bind(seed.guest_id)
        .bind(day(10))
        .execute(&mut *tx)
        .await;
        assert!(result.is_err(), "check_out must be after check_in");
        tx.rollback().await.unwrap();
    }
}
