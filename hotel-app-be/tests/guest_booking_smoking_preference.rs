//! PostgreSQL coverage for the guest-portal smoking preference.
//!
//! Opt-in through `DATABASE_URL`, like the other PostgreSQL suites. The
//! allocation tests run inside a transaction that is rolled back, so they
//! leave no rows behind; the end-to-end anonymous booking test cleans up the
//! fixtures it commits.
//!
//! Background: an anonymous website booking at Saliminn was auto-assigned
//! smoking room 210 (lowest free `rooms.id` in the type) and staff had to move
//! the guest to non-smoking 207 by hand. Allocation now prefers rooms whose
//! `is_smoking` matches the guest's preference — non-smoking when there is no
//! preference — and falls back to any free room rather than refusing.

mod postgres_tests {
    use chrono::{Duration, NaiveDate, Utc};
    use hotel_app_be::modules::consent::models::{ConsentAcceptance, ConsentDocument};
    use hotel_app_be::modules::guest_booking::availability::AvailabilityHub;
    use hotel_app_be::modules::guest_booking::models::{
        AnonymousBookingRequest, AnonymousGuestDetails, BookingInsert, BookingQuoteRequest,
        SmokingPreference,
    };
    use hotel_app_be::modules::guest_booking::repository::GuestBookingRepository;
    use hotel_app_be::modules::guest_booking::service;
    use rust_decimal::Decimal;
    use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgPoolOptions};
    use std::sync::LazyLock;
    use std::sync::atomic::{AtomicU64, Ordering};

    async fn pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!(
                    "Skipping smoking-preference PostgreSQL test because DATABASE_URL is not set"
                );
                return None;
            }
        };
        Some(
            PgPoolOptions::new()
                .max_connections(2)
                .after_connect(|conn, _| {
                    Box::pin(async move {
                        sqlx::query("SET app.allow_audit_mutation = 'on'")
                            .execute(conn)
                            .await
                            .map(|_| ())
                    })
                })
                .connect(&database_url)
                .await
                .expect("failed to connect to PostgreSQL test database"),
        )
    }

    /// Unique per test within the process and across runs (see
    /// guest_portal_postgres.rs for why a bare clock reading is not enough).
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

    /// `room_types.code` / `rooms.room_number` are varchar(20).
    fn tag(suffix: u64) -> String {
        format!("{suffix:x}")
    }

    struct Rooms {
        room_type_id: i64,
        /// Inserted first, so it has the LOWEST id — the room the old
        /// `ORDER BY r.id` rule would always have picked.
        smoking_low: i64,
        non_smoking: i64,
        smoking_high: i64,
    }

    async fn insert_room(
        tx: &mut Transaction<'_, Postgres>,
        room_type_id: i64,
        number: String,
        is_smoking: bool,
    ) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO rooms (room_number, room_type_id, status, is_active, is_smoking) \
             VALUES ($1, $2, 'available', true, $3) RETURNING id",
        )
        .bind(number)
        .bind(room_type_id)
        .bind(is_smoking)
        .fetch_one(&mut **tx)
        .await
        .expect("insert room")
    }

    async fn seed_rooms(tx: &mut Transaction<'_, Postgres>, suffix: u64) -> Rooms {
        let tag = tag(suffix);
        let room_type_id: i64 = sqlx::query_scalar(
            "INSERT INTO room_types (code, name, base_price, max_occupancy) \
             VALUES ($1, $2, 100.00, 2) RETURNING id",
        )
        .bind(format!("S{tag}"))
        .bind(format!("Smoking Pref Type {suffix}"))
        .fetch_one(&mut **tx)
        .await
        .expect("insert room type");
        let smoking_low = insert_room(tx, room_type_id, format!("A{tag}"), true).await;
        let non_smoking = insert_room(tx, room_type_id, format!("B{tag}"), false).await;
        let smoking_high = insert_room(tx, room_type_id, format!("C{tag}"), true).await;
        assert!(smoking_low < non_smoking && non_smoking < smoking_high);
        Rooms {
            room_type_id,
            smoking_low,
            non_smoking,
            smoking_high,
        }
    }

    fn stay() -> (NaiveDate, NaiveDate) {
        let check_in = Utc::now().date_naive() + Duration::days(20);
        (check_in, check_in + Duration::days(2))
    }

    async fn block_room(
        tx: &mut Transaction<'_, Postgres>,
        room_id: i64,
        suffix: u64,
        check_in: NaiveDate,
        check_out: NaiveDate,
    ) {
        let guest_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (nick_name, email) VALUES ($1, $2) RETURNING id",
        )
        .bind(format!("Smoking Blocker {suffix}"))
        .bind(format!("smoking-blocker-{suffix}@hotel.test"))
        .fetch_one(&mut **tx)
        .await
        .expect("insert blocking guest");
        sqlx::query(
            "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, \
                 room_rate, subtotal, total_amount, status, payment_status) \
             VALUES ($1, $2, $3, $4, $5, 100.00, 200.00, 200.00, 'confirmed', 'unpaid')",
        )
        .bind(format!("SMK-{}", tag(suffix)))
        .bind(guest_id)
        .bind(room_id)
        .bind(check_in)
        .bind(check_out)
        .execute(&mut **tx)
        .await
        .expect("insert blocking booking");
    }

    #[tokio::test]
    async fn postgres_no_preference_fills_non_smoking_rooms_first() {
        let Some(pool) = pool().await else {
            return;
        };
        let mut tx = pool.begin().await.unwrap();
        let rooms = seed_rooms(&mut tx, unique_suffix()).await;
        let (check_in, check_out) = stay();

        let allocated = GuestBookingRepository::allocate_room_tx(
            &mut tx,
            rooms.room_type_id,
            check_in,
            check_out,
            None,
        )
        .await
        .expect("a room is free");
        assert_eq!(
            allocated.room_id, rooms.non_smoking,
            "no preference must skip the lower-id smoking room"
        );
        assert!(!allocated.is_smoking);
        tx.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn postgres_non_smoking_preference_gets_a_non_smoking_room() {
        let Some(pool) = pool().await else {
            return;
        };
        let mut tx = pool.begin().await.unwrap();
        let rooms = seed_rooms(&mut tx, unique_suffix()).await;
        let (check_in, check_out) = stay();

        let allocated = GuestBookingRepository::allocate_room_tx(
            &mut tx,
            rooms.room_type_id,
            check_in,
            check_out,
            Some(SmokingPreference::NonSmoking),
        )
        .await
        .expect("a room is free");
        assert_eq!(allocated.room_id, rooms.non_smoking);
        assert!(!allocated.is_smoking);
        tx.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn postgres_smoking_preference_gets_the_lowest_id_smoking_room() {
        let Some(pool) = pool().await else {
            return;
        };
        let mut tx = pool.begin().await.unwrap();
        let rooms = seed_rooms(&mut tx, unique_suffix()).await;
        let (check_in, check_out) = stay();

        let allocated = GuestBookingRepository::allocate_room_tx(
            &mut tx,
            rooms.room_type_id,
            check_in,
            check_out,
            Some(SmokingPreference::Smoking),
        )
        .await
        .expect("a room is free");
        assert_eq!(
            allocated.room_id, rooms.smoking_low,
            "ties still break on r.id"
        );
        assert!(allocated.is_smoking);
        tx.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn postgres_preference_falls_back_to_a_non_matching_room_instead_of_refusing() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = unique_suffix();
        let mut tx = pool.begin().await.unwrap();
        let rooms = seed_rooms(&mut tx, suffix).await;
        let (check_in, check_out) = stay();
        // The only non-smoking room is taken for the stay.
        block_room(&mut tx, rooms.non_smoking, suffix, check_in, check_out).await;

        let allocated = GuestBookingRepository::allocate_room_tx(
            &mut tx,
            rooms.room_type_id,
            check_in,
            check_out,
            Some(SmokingPreference::NonSmoking),
        )
        .await
        .expect("soft preference must still allocate a room");
        assert_eq!(allocated.room_id, rooms.smoking_low);
        assert!(allocated.is_smoking);
        assert!(
            hotel_app_be::modules::guest_booking::validation::smoking_preference_note(
                Some(SmokingPreference::NonSmoking),
                allocated.is_smoking,
            )
            .is_some(),
            "a mismatch must produce a staff note"
        );

        // Block every smoking room too: now the type is genuinely full.
        block_room(&mut tx, rooms.smoking_low, suffix + 1, check_in, check_out).await;
        block_room(&mut tx, rooms.smoking_high, suffix + 2, check_in, check_out).await;
        let full = GuestBookingRepository::allocate_room_tx(
            &mut tx,
            rooms.room_type_id,
            check_in,
            check_out,
            Some(SmokingPreference::NonSmoking),
        )
        .await;
        assert!(full.is_err(), "a full room type still refuses");
        tx.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn postgres_insert_booking_stores_preference_and_internal_note() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = unique_suffix();
        let mut tx = pool.begin().await.unwrap();
        let rooms = seed_rooms(&mut tx, suffix).await;
        let (check_in, check_out) = stay();
        let guest_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (nick_name, email) VALUES ($1, $2) RETURNING id",
        )
        .bind(format!("Smoking Store {suffix}"))
        .bind(format!("smoking-store-{suffix}@hotel.test"))
        .fetch_one(&mut *tx)
        .await
        .unwrap();

        let insert = |room_id: i64, request: &str, preference, note: Option<&str>| BookingInsert {
            portal_request_id: format!("{request}-{suffix}"),
            guest_id,
            actor_user_id: None,
            room_id,
            booking_number: format!("SP{request}-{}", tag(suffix)),
            check_in_date: check_in,
            check_out_date: check_out,
            adults: 1,
            children: 0,
            room_rate: Decimal::from(100),
            subtotal: Decimal::from(200),
            discount_amount: Decimal::ZERO,
            total_amount: Decimal::from(200),
            currency: "MYR".to_string(),
            special_requests: None,
            cleaning_preference: None,
            smoking_preference: preference,
            internal_notes: note.map(str::to_string),
            booking_channel_id: None,
            nightly_rates: serde_json::json!({}),
            complimentary_reason: None,
            settled_by_credits: false,
            is_tourist: false,
            tourism_tax_amount: Decimal::ZERO,
            commission_amount: None,
            net_revenue: None,
            channel_pricing_snapshot: None,
        };

        let with_pref = GuestBookingRepository::insert_booking_tx(
            &mut tx,
            &insert(
                rooms.smoking_low,
                "a",
                Some(SmokingPreference::NonSmoking),
                Some("Smoking preference not met: requested non-smoking"),
            ),
        )
        .await
        .expect("insert booking with preference");
        let without_pref = GuestBookingRepository::insert_booking_tx(
            &mut tx,
            &insert(rooms.non_smoking, "b", None, None),
        )
        .await
        .expect("insert booking without preference");

        let row =
            sqlx::query("SELECT smoking_preference, internal_notes FROM bookings WHERE id = $1")
                .bind(with_pref)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert_eq!(
            row.get::<Option<String>, _>("smoking_preference")
                .as_deref(),
            Some("non_smoking")
        );
        assert_eq!(
            row.get::<Option<String>, _>("internal_notes").as_deref(),
            Some("Smoking preference not met: requested non-smoking")
        );
        let row =
            sqlx::query("SELECT smoking_preference, internal_notes FROM bookings WHERE id = $1")
                .bind(without_pref)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert_eq!(row.get::<Option<String>, _>("smoking_preference"), None);
        assert_eq!(row.get::<Option<String>, _>("internal_notes"), None);

        // The column's CHECK refuses anything outside the vocabulary.
        let bad = sqlx::query("UPDATE bookings SET smoking_preference = 'vape' WHERE id = $1")
            .bind(with_pref)
            .execute(&mut *tx)
            .await;
        assert!(
            bad.is_err(),
            "bookings_smoking_preference_check must reject 'vape'"
        );
        tx.rollback().await.unwrap();
    }

    /// End to end through the public (anonymous) booking service: the
    /// preference is validated, drives allocation, is stored, and is echoed on
    /// the confirmation.
    #[tokio::test]
    async fn postgres_anonymous_booking_with_non_smoking_preference_avoids_smoking_rooms() {
        let Some(pool) = pool().await else {
            return;
        };
        if std::env::var("JWT_SECRET").is_err() {
            // SAFETY: set before any config read in this binary.
            unsafe { std::env::set_var("JWT_SECRET", "test-secret-test-secret-test-secret") };
        }
        let _ = hotel_app_be::core::config::init_from_env();

        let suffix = unique_suffix();
        let mut tx = pool.begin().await.unwrap();
        let rooms = seed_rooms(&mut tx, suffix).await;
        tx.commit().await.unwrap();

        let today: NaiveDate = sqlx::query_scalar("SELECT CURRENT_DATE")
            .fetch_one(&pool)
            .await
            .unwrap();
        let check_in = (today + Duration::days(14)).format("%Y-%m-%d").to_string();
        let check_out = (today + Duration::days(15)).format("%Y-%m-%d").to_string();
        let quote = service::quote(
            &pool,
            None,
            BookingQuoteRequest {
                room_type_id: rooms.room_type_id,
                check_in_date: check_in.clone(),
                check_out_date: check_out.clone(),
                adults: Some(1),
                children: Some(0),
                voucher_id: None,
                complimentary_dates: None,
                tourism_type: Some("local".to_string()),
            },
        )
        .await
        .expect("quote");
        let granted = |document: ConsentDocument| ConsentAcceptance {
            document,
            version: document.current_version().to_string(),
            granted: true,
            locale: "en".to_string(),
        };
        let request = |preference: &str, n: u8| AnonymousBookingRequest {
            client_request_id: format!("smoking-e2e-{suffix}-{n}"),
            room_type_id: rooms.room_type_id,
            check_in_date: check_in.clone(),
            check_out_date: check_out.clone(),
            adults: Some(1),
            children: Some(0),
            expected_total: quote.total_amount,
            special_requests: None,
            cleaning_preference: None,
            smoking_preference: Some(preference.to_string()),
            guest: AnonymousGuestDetails {
                first_name: format!("SmokePref{}{n}", tag(suffix)),
                last_name: None,
                email: format!("smoke-pref-{suffix}-{n}@hotel.test"),
                phone: None,
                tourism_type: "local".to_string(),
            },
            consents: vec![
                granted(ConsentDocument::TermsOfService),
                granted(ConsentDocument::PrivacyNotice),
            ],
            marketing_opt_in: false,
        };
        let hub = AvailabilityHub::default();

        let invalid = service::create_anonymous(&pool, &hub, request("vape", 0), None, None).await;
        assert!(
            invalid.is_err(),
            "an unknown preference is refused before any write"
        );

        let first = service::create_anonymous(&pool, &hub, request("non_smoking", 1), None, None)
            .await
            .expect("anonymous booking with non-smoking preference");
        assert_eq!(first.smoking_preference.as_deref(), Some("non_smoking"));
        // Second non-smoking request: no matching room is left, so it falls
        // back to a smoking room and leaves a staff note.
        let second = service::create_anonymous(&pool, &hub, request("non_smoking", 2), None, None)
            .await
            .expect("soft preference falls back instead of refusing");

        let rows = sqlx::query(
            "SELECT id, room_id, smoking_preference, internal_notes, guest_id FROM bookings \
             WHERE id = ANY($1) ORDER BY id",
        )
        .bind(vec![first.booking_id, second.booking_id])
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(rows[0].get::<i64, _>("room_id"), rooms.non_smoking);
        assert_eq!(
            rows[0]
                .get::<Option<String>, _>("smoking_preference")
                .as_deref(),
            Some("non_smoking")
        );
        assert_eq!(rows[0].get::<Option<String>, _>("internal_notes"), None);
        assert_eq!(rows[1].get::<i64, _>("room_id"), rooms.smoking_low);
        assert!(
            rows[1]
                .get::<Option<String>, _>("internal_notes")
                .unwrap_or_default()
                .starts_with("Smoking preference not met: requested non-smoking")
        );

        // The staff read path exposes the preference and the booked room's
        // smoking flag, so the UI can flag the mismatch.
        for (booking_id, room_is_smoking) in [(first.booking_id, false), (second.booking_id, true)]
        {
            let row =
                sqlx::query(hotel_app_be::modules::bookings::queries::GET_BOOKING_BY_ID_QUERY)
                    .bind(booking_id)
                    .fetch_one(&pool)
                    .await
                    .expect("staff booking read");
            let staff_view = hotel_app_be::models::row_mappers::row_to_booking_with_details(&row);
            assert_eq!(
                staff_view.smoking_preference.as_deref(),
                Some("non_smoking")
            );
            assert_eq!(staff_view.room_is_smoking, Some(room_is_smoking));
        }

        // Cleanup of the committed fixtures.
        let guest_ids: Vec<i64> = rows.iter().map(|row| row.get("guest_id")).collect();
        let booking_ids = vec![first.booking_id, second.booking_id];
        for statement in [
            "DELETE FROM consent_records WHERE booking_id = ANY($1)",
            "DELETE FROM email_deliveries WHERE idempotency_key = ANY(SELECT 'booking-confirmation:' || x FROM unnest($1::bigint[]) x)",
            "DELETE FROM booking_history WHERE booking_id = ANY($1)",
            "DELETE FROM bookings WHERE id = ANY($1)",
        ] {
            let _ = sqlx::query(statement)
                .bind(&booking_ids)
                .execute(&pool)
                .await;
        }
        let _ = sqlx::query("DELETE FROM guests WHERE id = ANY($1)")
            .bind(&guest_ids)
            .execute(&pool)
            .await;
        let _ = sqlx::query("DELETE FROM rooms WHERE room_type_id = $1")
            .bind(rooms.room_type_id)
            .execute(&pool)
            .await;
        let _ = sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(rooms.room_type_id)
            .execute(&pool)
            .await;
    }
}
