//! PostgreSQL runtime coverage for guest-portal complimentary-night credits.
//!
//! sqlx type-checks plain `sqlx::query()` at runtime, not compile time, so the
//! credit read, the conditional decrement, and the complimentary columns on the
//! portal booking insert can only be proven by executing them against a real
//! database. Opt-in through `DATABASE_URL`, matching the other PostgreSQL tests.

mod postgres_tests {
    use chrono::NaiveDate;
    use hotel_app_be::modules::guest_booking::models::BookingInsert;
    use hotel_app_be::modules::guest_booking::repository::GuestBookingRepository;
    use hotel_app_be::repositories::guest_portal_session::GuestPortalSessionRepository;
    use rust_decimal::Decimal;
    use sqlx::{PgPool, Row, postgres::PgPoolOptions};

    /// Every test fn in a binary runs concurrently, so each one owns a private
    /// slice of ids. Sharing even an upsert-only room type across them
    /// deadlocks on the conflicting row. The `993_` range was verified free
    /// across `tests/` before it was chosen.
    struct Fixture {
        guest_id: i64,
        other_guest_id: i64,
        room_type_id: i64,
        other_room_type_id: i64,
        room_id: i64,
    }

    fn fixture(slot: i64) -> Fixture {
        Fixture {
            guest_id: 993_010 + slot * 10,
            other_guest_id: 993_011 + slot * 10,
            room_type_id: 993_310 + slot * 10,
            other_room_type_id: 993_311 + slot * 10,
            room_id: 993_610 + slot * 10,
        }
    }

    async fn pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping guest portal credits test because DATABASE_URL is not set");
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

    /// Reset this fixture to a known state. Deletes run child-first so foreign
    /// keys never block the reseed, and the seeds upsert so a row left behind
    /// by an earlier run still ends up in the expected state.
    async fn seed(pool: &PgPool, fixture: &Fixture) {
        sqlx::query("DELETE FROM bookings WHERE guest_id IN ($1, $2)")
            .bind(fixture.guest_id)
            .bind(fixture.other_guest_id)
            .execute(pool)
            .await
            .expect("clear fixture bookings");
        sqlx::query("DELETE FROM guest_complimentary_credits WHERE guest_id IN ($1, $2)")
            .bind(fixture.guest_id)
            .bind(fixture.other_guest_id)
            .execute(pool)
            .await
            .expect("clear fixture credits");

        for room_type_id in [fixture.room_type_id, fixture.other_room_type_id] {
            sqlx::query(
                "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
                 OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 150.00, 2) \
                 ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name",
            )
            .bind(room_type_id)
            .bind(format!("CR{room_type_id}"))
            .bind(format!("Credit Test Room Type {room_type_id}"))
            .execute(pool)
            .await
            .expect("seed room type");
        }

        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'available') \
             ON CONFLICT (id) DO UPDATE SET room_type_id = EXCLUDED.room_type_id",
        )
        .bind(fixture.room_id)
        .bind(format!("CR{}", fixture.room_id))
        .bind(fixture.room_type_id)
        .execute(pool)
        .await
        .expect("seed room");

        for guest_id in [fixture.guest_id, fixture.other_guest_id] {
            sqlx::query(
                "INSERT INTO guests (id, full_name, email) \
                 OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3) \
                 ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name",
            )
            .bind(guest_id)
            .bind(format!("Credit Guest {guest_id}"))
            .bind(format!("credit-guest-{guest_id}@hotel.test"))
            .execute(pool)
            .await
            .expect("seed guest");
        }
    }

    async fn grant_credits(pool: &PgPool, guest_id: i64, room_type_id: i64, nights: i32) {
        sqlx::query(
            "INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (guest_id, room_type_id) DO UPDATE SET nights_available = EXCLUDED.nights_available",
        )
        .bind(guest_id)
        .bind(room_type_id)
        .bind(nights)
        .execute(pool)
        .await
        .expect("grant credits");
    }

    async fn remaining_nights(pool: &PgPool, guest_id: i64, room_type_id: i64) -> i32 {
        sqlx::query_scalar(
            "SELECT nights_available FROM guest_complimentary_credits \
             WHERE guest_id = $1 AND room_type_id = $2",
        )
        .bind(guest_id)
        .bind(room_type_id)
        .fetch_one(pool)
        .await
        .expect("read remaining nights")
    }

    #[tokio::test]
    async fn credits_are_scoped_to_the_session_guest_and_exclude_exhausted_rows() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(1);
        seed(&pool, &f).await;
        grant_credits(&pool, f.guest_id, f.room_type_id, 3).await;
        // An exhausted row must not appear as a spendable balance.
        grant_credits(&pool, f.guest_id, f.other_room_type_id, 0).await;
        // Another guest's credits must never leak into this guest's balance.
        grant_credits(&pool, f.other_guest_id, f.room_type_id, 9).await;

        let credits = GuestPortalSessionRepository::complimentary_credits(&pool, f.guest_id)
            .await
            .expect("read complimentary credits");

        assert_eq!(credits.len(), 1, "only the positive-balance row is returned");
        let credit = &credits[0];
        assert_eq!(credit.room_type_id, f.room_type_id);
        assert_eq!(credit.nights_available, 3);
        assert_eq!(credit.room_type_code, format!("CR{}", f.room_type_id));
        assert!(credit.room_type_name.contains("Credit Test Room Type"));
    }

    #[tokio::test]
    async fn available_credits_read_per_room_type_and_default_to_zero() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(2);
        seed(&pool, &f).await;
        grant_credits(&pool, f.guest_id, f.room_type_id, 2).await;

        assert_eq!(
            GuestBookingRepository::complimentary_credits_available(
                &pool,
                f.guest_id,
                f.room_type_id
            )
            .await
            .expect("read available credits"),
            2
        );
        // No row at all for this room type means no credits, not an error.
        assert_eq!(
            GuestBookingRepository::complimentary_credits_available(
                &pool,
                f.guest_id,
                f.other_room_type_id
            )
            .await
            .expect("read available credits for a room type with no grant"),
            0
        );
    }

    #[tokio::test]
    async fn redeeming_more_nights_than_held_is_rejected_and_changes_nothing() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(3);
        seed(&pool, &f).await;
        grant_credits(&pool, f.guest_id, f.room_type_id, 2).await;

        let mut tx = pool.begin().await.expect("begin");
        let result = GuestBookingRepository::redeem_complimentary_credits_tx(
            &mut tx,
            f.guest_id,
            f.room_type_id,
            3,
        )
        .await;
        assert!(result.is_err(), "overdrawing credits must fail");
        tx.rollback().await.expect("rollback");

        assert_eq!(
            remaining_nights(&pool, f.guest_id, f.room_type_id).await,
            2,
            "a rejected redemption leaves the balance untouched"
        );
    }

    #[tokio::test]
    async fn a_second_redemption_cannot_overdraw_the_same_balance() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(4);
        seed(&pool, &f).await;
        grant_credits(&pool, f.guest_id, f.room_type_id, 2).await;

        // Both redemptions would pass a read-then-check, but the balance check
        // lives in the UPDATE's WHERE clause, so the second matches no row.
        let mut tx = pool.begin().await.expect("begin");
        GuestBookingRepository::redeem_complimentary_credits_tx(
            &mut tx,
            f.guest_id,
            f.room_type_id,
            2,
        )
        .await
        .expect("first redemption succeeds");
        let second = GuestBookingRepository::redeem_complimentary_credits_tx(
            &mut tx,
            f.guest_id,
            f.room_type_id,
            1,
        )
        .await;
        assert!(second.is_err(), "the balance is already spent");
        tx.commit().await.expect("commit");

        assert_eq!(remaining_nights(&pool, f.guest_id, f.room_type_id).await, 0);
    }

    fn booking_insert(f: &Fixture, request_id: &str, settled_by_credits: bool) -> BookingInsert {
        BookingInsert {
            portal_request_id: format!("{request_id}-{}", f.guest_id),
            guest_id: f.guest_id,
            actor_user_id: None,
            room_id: f.room_id,
            booking_number: format!("CRD-{request_id}-{}", f.guest_id),
            check_in_date: NaiveDate::from_ymd_opt(2031, 3, 10).unwrap(),
            check_out_date: NaiveDate::from_ymd_opt(2031, 3, 12).unwrap(),
            adults: 1,
            children: 0,
            room_rate: Decimal::from(150),
            subtotal: Decimal::from(300),
            discount_amount: if settled_by_credits {
                Decimal::from(300)
            } else {
                Decimal::from(150)
            },
            total_amount: if settled_by_credits {
                Decimal::ZERO
            } else {
                Decimal::from(150)
            },
            currency: "MYR".to_string(),
            special_requests: None,
            cleaning_preference: None,
            booking_channel_id: None,
            nightly_rates: serde_json::json!({ "2031-03-10": "150.00", "2031-03-11": "150.00" }),
            complimentary_reason: Some("Guest portal: credits".to_string()),
            settled_by_credits,
        }
    }

    #[tokio::test]
    async fn a_stay_fully_covered_by_credits_is_booked_confirmed_and_paid() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(5);
        seed(&pool, &f).await;

        let mut tx = pool.begin().await.expect("begin");
        let booking_id =
            GuestBookingRepository::insert_booking_tx(&mut tx, &booking_insert(&f, "full", true))
                .await
                .expect("insert fully complimentary booking");
        tx.commit().await.expect("commit");

        let row = sqlx::query(
            "SELECT status, payment_status, is_complimentary, complimentary_reason, total_amount \
             FROM bookings WHERE id = $1",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .expect("read booking back");

        assert_eq!(row.get::<String, _>("status"), "confirmed");
        assert_eq!(row.get::<String, _>("payment_status"), "paid");
        assert!(row.get::<bool, _>("is_complimentary"));
        assert_eq!(
            row.get::<Option<String>, _>("complimentary_reason")
                .as_deref(),
            Some("Guest portal: credits")
        );
        assert_eq!(row.get::<Decimal, _>("total_amount"), Decimal::ZERO);
    }

    #[tokio::test]
    async fn a_partly_credited_stay_still_goes_through_payment() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(6);
        seed(&pool, &f).await;

        let mut tx = pool.begin().await.expect("begin");
        let booking_id = GuestBookingRepository::insert_booking_tx(
            &mut tx,
            &booking_insert(&f, "partial", false),
        )
        .await
        .expect("insert partially complimentary booking");
        tx.commit().await.expect("commit");

        let row = sqlx::query(
            "SELECT status, payment_status, is_complimentary FROM bookings WHERE id = $1",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .expect("read booking back");

        assert_eq!(row.get::<String, _>("status"), "pending_payment");
        assert_eq!(row.get::<String, _>("payment_status"), "unpaid");
        assert!(
            row.get::<bool, _>("is_complimentary"),
            "credits funded part of the stay, so the booking is flagged complimentary"
        );
    }

    /// The stays list filters server-side. The predicate binds the term as NULL
    /// when absent instead of branching the SQL, so it can only be trusted once
    /// PostgreSQL has actually planned both shapes.
    #[tokio::test]
    async fn stays_search_filters_server_side_and_escapes_wildcards() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(8);
        seed(&pool, &f).await;

        for (suffix, status) in [("ALPHA", "confirmed"), ("BETA", "pending_payment")] {
            sqlx::query(
                "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, \
                 check_out_date, adults, children, room_rate, subtotal, total_amount, status, \
                 payment_status) \
                 VALUES ($1, $2, $3, '2031-05-10', '2031-05-12', 1, 0, 100, 200, 200, $4, 'unpaid')",
            )
            .bind(format!("SRCH-{suffix}-{}", f.guest_id))
            .bind(f.guest_id)
            .bind(f.room_id)
            .bind(status)
            .execute(&pool)
            .await
            .expect("seed searchable booking");
        }

        let all = GuestPortalSessionRepository::list_bookings(&pool, f.guest_id, 20, 0, None)
            .await
            .expect("unfiltered list");
        assert_eq!(all.1, 2, "no search term returns every booking");

        let by_number =
            GuestPortalSessionRepository::list_bookings(&pool, f.guest_id, 20, 0, Some("ALPHA"))
                .await
                .expect("search by booking number");
        assert_eq!(by_number.1, 1, "total reflects the filter, not the page");
        assert!(by_number.0[0].booking_number.contains("ALPHA"));

        let by_status = GuestPortalSessionRepository::list_bookings(
            &pool,
            f.guest_id,
            20,
            0,
            Some("pending_payment"),
        )
        .await
        .expect("search by status");
        assert_eq!(by_status.1, 1);

        let by_date =
            GuestPortalSessionRepository::list_bookings(&pool, f.guest_id, 20, 0, Some("2031-05"))
                .await
                .expect("search by stay date");
        assert_eq!(by_date.1, 2, "both stays fall in that month");

        // A blank term must not be treated as a filter.
        let blank =
            GuestPortalSessionRepository::list_bookings(&pool, f.guest_id, 20, 0, Some("   "))
                .await
                .expect("blank search");
        assert_eq!(blank.1, 2);

        // A bare wildcard is a literal character, not "match everything".
        let wildcard =
            GuestPortalSessionRepository::list_bookings(&pool, f.guest_id, 20, 0, Some("%"))
                .await
                .expect("wildcard search");
        assert_eq!(wildcard.1, 0, "'%' is escaped, so it matches nothing");
    }

    #[tokio::test]
    async fn a_booking_with_no_credits_is_not_flagged_complimentary() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(7);
        seed(&pool, &f).await;

        let mut insert = booking_insert(&f, "plain", false);
        insert.complimentary_reason = None;
        let mut tx = pool.begin().await.expect("begin");
        let booking_id = GuestBookingRepository::insert_booking_tx(&mut tx, &insert)
            .await
            .expect("insert ordinary portal booking");
        tx.commit().await.expect("commit");

        let row = sqlx::query(
            "SELECT status, is_complimentary, complimentary_reason FROM bookings WHERE id = $1",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .expect("read booking back");

        assert_eq!(row.get::<String, _>("status"), "pending_payment");
        assert!(!row.get::<bool, _>("is_complimentary"));
        assert!(
            row.get::<Option<String>, _>("complimentary_reason")
                .is_none()
        );
    }
}
