//! Live-PostgreSQL coverage for per-night voucher redemption allocations.
//!
//! sqlx type-checks plain `sqlx::query()` at runtime, so the
//! `INSERT … RETURNING` plus the batch allocations insert can only be proven
//! by executing them against a real database. Opt-in through `DATABASE_URL`,
//! matching the other PostgreSQL tests.

mod postgres_tests {
    use chrono::NaiveDate;
    use hotel_app_be::modules::guest_booking::models::VoucherPricing;
    use hotel_app_be::modules::guest_booking::repository::{
        GuestBookingRepository, VoucherRedemptionAllocation, VoucherRedemptionValues,
    };
    use rust_decimal::Decimal;
    use sqlx::{PgPool, Row, postgres::PgPoolOptions};

    /// Private id band — every table touched uses BASE so concurrent test
    /// binaries never share a row.
    const BASE: i64 = 995_000;

    async fn pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping voucher allocation test because DATABASE_URL is not set");
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

    /// Reseed the fixture to a known state; deletes run child-first so foreign
    /// keys never block a repeat run.
    async fn seed(pool: &PgPool) {
        for statement in [
            "DELETE FROM voucher_redemption_allocations WHERE booking_id = $1",
            "DELETE FROM voucher_redemptions WHERE booking_id = $1",
            "DELETE FROM vouchers WHERE id = $1",
            "DELETE FROM bookings WHERE id = $1",
            "DELETE FROM promotion_room_types WHERE promotion_id = $1",
            "DELETE FROM promotions WHERE id = $1",
            "DELETE FROM room_status_change_log WHERE room_id = $1",
            "DELETE FROM rooms WHERE id = $1",
            "DELETE FROM room_types WHERE id = $1",
            "DELETE FROM guests WHERE id = $1",
        ] {
            sqlx::query(statement)
                .bind(BASE)
                .execute(pool)
                .await
                .expect("clear fixture row");
        }
        sqlx::query(
            "INSERT INTO guests (id, nick_name, email) OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'Alloc Guest', 'alloc-guest@hotel.test')",
        )
        .bind(BASE)
        .execute(pool)
        .await
        .expect("seed guest");
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'ALLOC', 'Alloc Room', 150.00, 2)",
        )
        .bind(BASE)
        .execute(pool)
        .await
        .expect("seed room type");
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'ALLOC1', $1, 'available')",
        )
        .bind(BASE)
        .execute(pool)
        .await
        .expect("seed room");
        sqlx::query(
            "INSERT INTO promotions (id, slug, name, status, promotion_kind, \
             discount_type, discount_value) OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'alloc-test-promo', 'Alloc Test', 'published', 'voucher', \
             'percentage', 10)",
        )
        .bind(BASE)
        .execute(pool)
        .await
        .expect("seed promotion");
        sqlx::query(
            "INSERT INTO vouchers (id, promotion_id, guest_id, code, status, source) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $1, $1, 'ALLOCTEST1', 'available', 'admin_issue')",
        )
        .bind(BASE)
        .execute(pool)
        .await
        .expect("seed voucher");
        sqlx::query(
            "INSERT INTO bookings (id, booking_number, guest_id, room_id, \
             check_in_date, check_out_date, room_rate, subtotal, total_amount) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'ALLOC-B1', $1, $1, \
             '2026-10-01', '2026-10-03', 150, 300, 270)",
        )
        .bind(BASE)
        .execute(pool)
        .await
        .expect("seed booking");
    }

    #[tokio::test]
    async fn redeem_writes_reconciling_allocations() {
        let Some(pool) = pool().await else {
            return;
        };
        seed(&pool).await;
        let voucher = VoucherPricing {
            voucher_id: BASE,
            promotion_id: BASE,
            promotion_name: "Alloc Test".to_string(),
            discount_type: "percentage".to_string(),
            discount_value: Decimal::from(10),
            max_discount_amount: None,
            is_cancellable: true,
        };
        let allocations = vec![
            VoucherRedemptionAllocation {
                stay_date: NaiveDate::from_ymd_opt(2026, 10, 1).expect("valid date"),
                gross_amount: Decimal::from(150),
                discount_amount: Decimal::from(15),
                net_amount: Decimal::from(135),
            },
            VoucherRedemptionAllocation {
                stay_date: NaiveDate::from_ymd_opt(2026, 10, 2).expect("valid date"),
                gross_amount: Decimal::from(150),
                discount_amount: Decimal::from(15),
                net_amount: Decimal::from(135),
            },
        ];
        let mut tx = pool.begin().await.expect("begin transaction");
        GuestBookingRepository::redeem_voucher_tx(
            &mut tx,
            VoucherRedemptionValues {
                voucher: &voucher,
                booking_id: BASE,
                guest_id: BASE,
                actor_user_id: None,
                subtotal: Decimal::from(300),
                discount_amount: Decimal::from(30),
                total_amount: Decimal::from(270),
                allocations,
            },
        )
        .await
        .expect("redemption commits");
        tx.commit().await.expect("commit");

        let rows = sqlx::query(
            "SELECT a.stay_date, a.gross_amount::text AS gross, \
             a.discount_amount::text AS discount, a.net_amount::text AS net \
             FROM voucher_redemption_allocations a \
             JOIN voucher_redemptions r ON r.id = a.redemption_id \
             WHERE a.booking_id = $1 ORDER BY a.stay_date",
        )
        .bind(BASE)
        .fetch_all(&pool)
        .await
        .expect("fetch allocations");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].get::<String, _>("discount"), "15.00");
        assert_eq!(rows[1].get::<String, _>("net"), "135.00");

        let voucher_status: String =
            sqlx::query_scalar("SELECT status FROM vouchers WHERE id = $1")
                .bind(BASE)
                .fetch_one(&pool)
                .await
                .expect("fetch voucher status");
        assert_eq!(voucher_status, "redeemed");
    }
}
