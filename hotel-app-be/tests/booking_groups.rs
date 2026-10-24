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
        let guest_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (nick_name, email) VALUES ($1, $2) RETURNING id",
        )
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
            &[
                seed.room_type_ids[1],
                seed.room_type_ids[0],
                seed.room_type_ids[1],
            ],
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

        let a = insert_booking(
            &mut tx,
            seed.guest_id,
            seed.room_ids[0],
            format!("GA-{suffix:x}"),
            "200.00",
            "210.00",
            "unpaid",
        )
        .await;
        let b = insert_booking(
            &mut tx,
            seed.guest_id,
            seed.room_ids[1],
            format!("GB-{suffix:x}"),
            "300.00",
            "310.00",
            "unpaid",
        )
        .await;
        BookingGroupRepository::attach_tx(&mut tx, group.id, &[a, b])
            .await
            .unwrap();

        let group = BookingGroupRepository::refresh_totals_tx(&mut tx, group.id)
            .await
            .unwrap();
        assert_eq!(group.room_count, 2);
        assert_eq!(group.subtotal, dec("500.00"));
        assert_eq!(group.discount_amount, dec("20.00"));
        // Triggers may normalise tourism tax / totals on insert, so compare
        // against what the member rows actually hold.
        let (tourism, total): (Decimal, Decimal) = sqlx::query_as(
            "SELECT COALESCE(SUM(tourism_tax_amount), 0), COALESCE(SUM(total_amount), 0) \
             FROM bookings WHERE id = ANY($1)",
        )
        .bind(vec![a, b])
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(group.tourism_tax_amount, tourism);
        assert_eq!(group.total_amount, total);
        let b_total: Decimal =
            sqlx::query_scalar("SELECT total_amount FROM bookings WHERE id = $1")
                .bind(b)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert_eq!(group.payment_status, "unpaid");

        // Single-room cancel: only that room's share leaves the group.
        sqlx::query("UPDATE bookings SET status = 'voided', payment_status = 'void' WHERE id = $1")
            .bind(a)
            .execute(&mut *tx)
            .await
            .unwrap();
        let group = BookingGroupRepository::refresh_totals_tx(&mut tx, group.id)
            .await
            .unwrap();
        assert_eq!(group.room_count, 1);
        assert_eq!(group.total_amount, b_total);
        assert_eq!(group.status, "active");

        sqlx::query("UPDATE bookings SET status = 'voided', payment_status = 'void' WHERE id = $1")
            .bind(b)
            .execute(&mut *tx)
            .await
            .unwrap();
        let group = BookingGroupRepository::refresh_totals_tx(&mut tx, group.id)
            .await
            .unwrap();
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
        let foreign = insert_booking(
            &mut tx,
            other,
            seed.room_ids[0],
            format!("GF-{suffix:x}"),
            "200.00",
            "200.00",
            "unpaid",
        )
        .await;
        assert!(
            BookingGroupRepository::attach_tx(&mut tx, group.id, &[foreign])
                .await
                .is_err()
        );
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

    /// End to end through the anonymous multi-room checkout: 2 × X + 1 × Y in
    /// one transaction, linked to one group with matching totals; a replay is
    /// idempotent; a cart that no longer fits is refused with nothing written.
    #[tokio::test]
    async fn postgres_anonymous_group_checkout_is_all_or_nothing() {
        use chrono::Duration;
        use hotel_app_be::modules::consent::models::{ConsentAcceptance, ConsentDocument};
        use hotel_app_be::modules::guest_booking::availability::AvailabilityHub;
        use hotel_app_be::modules::guest_booking::group::{
            self, AnonymousGroupBookingRequest, GroupQuoteRequest, GroupRoomRequest,
        };
        use hotel_app_be::modules::guest_booking::models::AnonymousGuestDetails;

        let Ok(database_url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let pool = PgPoolOptions::new()
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
            .expect("connect");
        if std::env::var("JWT_SECRET").is_err() {
            // SAFETY: set before any config read in this binary.
            unsafe { std::env::set_var("JWT_SECRET", "test-secret-test-secret-test-secret") };
        }
        let _ = hotel_app_be::core::config::init_from_env();

        let suffix = unique_suffix();
        let tag = format!("{suffix:x}");
        let mut type_ids = Vec::new();
        for (prefix, rooms) in [("P", 2), ("Q", 1)] {
            let type_id: i64 = sqlx::query_scalar(
                "INSERT INTO room_types (code, name, base_price, max_occupancy) \
                 VALUES ($1, $2, 100.00, 2) RETURNING id",
            )
            .bind(format!("{prefix}{tag}"))
            .bind(format!("Cart Type {prefix} {suffix}"))
            .fetch_one(&pool)
            .await
            .unwrap();
            for n in 0..rooms {
                sqlx::query(
                    "INSERT INTO rooms (room_number, room_type_id, status, is_active) \
                     VALUES ($1, $2, 'available', true)",
                )
                .bind(format!("{prefix}{n}{tag}"))
                .bind(type_id)
                .execute(&pool)
                .await
                .unwrap();
            }
            type_ids.push(type_id);
        }
        let (x, y) = (type_ids[0], type_ids[1]);
        let today: NaiveDate = sqlx::query_scalar("SELECT CURRENT_DATE")
            .fetch_one(&pool)
            .await
            .unwrap();
        let check_in = (today + Duration::days(14)).format("%Y-%m-%d").to_string();
        let check_out = (today + Duration::days(16)).format("%Y-%m-%d").to_string();
        let room = |room_type_id| GroupRoomRequest {
            room_type_id,
            adults: Some(1),
            children: Some(0),
            extra_beds: None,
        };
        let cart = vec![room(x), room(x), room(y)];
        let quote = group::quote_group(
            &pool,
            None,
            &GroupQuoteRequest {
                check_in_date: check_in.clone(),
                check_out_date: check_out.clone(),
                rooms: cart.clone(),
                tourism_type: Some("local".to_string()),
                discounts: Default::default(),
            },
        )
        .await
        .expect("group quote");
        assert_eq!(quote.room_count, 3);
        let granted = |document: ConsentDocument| ConsentAcceptance {
            document,
            version: document.current_version().to_string(),
            granted: true,
            locale: "en".to_string(),
        };
        let request =
            |n: u8, rooms: Vec<GroupRoomRequest>, total: Decimal| AnonymousGroupBookingRequest {
                client_request_id: format!("group-e2e-{suffix}-{n}"),
                check_in_date: check_in.clone(),
                check_out_date: check_out.clone(),
                rooms,
                expected_total: total,
                special_requests: None,
                cleaning_preference: None,
                smoking_preference: None,
                guest: AnonymousGuestDetails {
                    first_name: format!("Cart{tag}{n}"),
                    last_name: None,
                    email: format!("group-cart-{suffix}-{n}@hotel.test"),
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
        let first = group::create_anonymous(
            &pool,
            &hub,
            request(1, cart.clone(), quote.total_amount),
            None,
            None,
        )
        .await
        .expect("group checkout");
        assert_eq!(first.rooms.len(), 3);
        assert_eq!(first.room_count, 3);
        assert_eq!(first.total_amount, quote.total_amount);
        assert!(first.access_token.is_some());
        let linked: i64 = sqlx::query_scalar(
            "SELECT COUNT(DISTINCT room_id) FROM bookings WHERE booking_group_id = $1",
        )
        .bind(first.group_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(linked, 3, "three distinct rooms in one group");

        let replay = group::create_anonymous(
            &pool,
            &hub,
            request(1, cart.clone(), quote.total_amount),
            None,
            None,
        )
        .await
        .expect("replay");
        assert_eq!(replay.group_id, first.group_id);

        // X is now full: a cart with one X room is refused, nothing written.
        let one_x_total = first.rooms[0].total_amount;
        let full = group::create_anonymous(
            &pool,
            &hub,
            request(2, vec![room(x)], one_x_total),
            None,
            None,
        )
        .await;
        assert!(full.is_err(), "sold-out type must be refused");
        let leaked: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM booking_groups g JOIN guests gu ON gu.id = g.guest_id \
             WHERE gu.email = $1",
        )
        .bind(format!("group-cart-{suffix}-2@hotel.test"))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(leaked, 0);

        // One bank-transfer claim covers the whole group...
        let guest_of_group: i64 =
            sqlx::query_scalar("SELECT guest_id FROM booking_groups WHERE id = $1")
                .bind(first.group_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let claim = hotel_app_be::modules::payments::service::create_group_bank_transfer_claim(
            &pool,
            guest_of_group,
            first.group_id,
        )
        .await
        .expect("group bank transfer claim");
        assert_eq!(claim.payment_ids.len(), 3);
        assert_eq!(claim.amount, quote.total_amount);
        let awaiting: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM bookings WHERE booking_group_id = $1 \
             AND status = 'pending_confirmation'",
        )
        .bind(first.group_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(awaiting, 3, "every room awaits the one staff review");
        // ...a second claim is refused while the first is under review...
        assert!(
            hotel_app_be::modules::payments::service::create_group_bank_transfer_claim(
                &pool,
                guest_of_group,
                first.group_id,
            )
            .await
            .is_err()
        );
        let staff: Option<i64> = sqlx::query_scalar("SELECT id FROM users ORDER BY id LIMIT 1")
            .fetch_optional(&pool)
            .await
            .unwrap();
        let count_where = |sql: &'static str| {
            let pool = pool.clone();
            let group_id = first.group_id;
            async move {
                sqlx::query_scalar::<_, i64>(sql)
                    .bind(group_id)
                    .fetch_one(&pool)
                    .await
                    .unwrap()
            }
        };
        let claim = if let Some(staff) = staff {
            // Approval is all-or-nothing: if one room cannot be completed
            // (here: it already carries another completed payment), no room
            // of the group is confirmed and every claim stays pending.
            let blocker: i64 = sqlx::query_scalar(
                "INSERT INTO payments (uuid, booking_id, amount, currency, payment_method, \
                 payment_type, status) SELECT gen_uuidv7(), id, 1, 'MYR', 'cash', 'booking', \
                 'completed' FROM bookings WHERE booking_group_id = $1 ORDER BY id DESC LIMIT 1 \
                 RETURNING id",
            )
            .bind(first.group_id)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert!(
                hotel_app_be::modules::payments::service::approve_payment(
                    &pool,
                    staff,
                    claim.payment_ids[0],
                )
                .await
                .is_err(),
                "a failing room must fail the whole group approval"
            );
            assert_eq!(
                count_where(
                    "SELECT COUNT(*) FROM bookings WHERE booking_group_id = $1 \
                     AND status = 'confirmed'"
                )
                .await,
                0,
                "no partly confirmed group"
            );
            assert_eq!(
                count_where(
                    "SELECT COUNT(*) FROM payments p JOIN bookings b ON b.id = p.booking_id \
                     WHERE b.booking_group_id = $1 AND p.status = 'pending'"
                )
                .await,
                3
            );
            sqlx::query("DELETE FROM payments WHERE id = $1")
                .bind(blocker)
                .execute(&pool)
                .await
                .unwrap();

            // Rejection is one transaction too: every room returns to
            // pending_payment together.
            hotel_app_be::modules::payments::service::reject_payment(
                &pool,
                staff,
                claim.payment_ids[1],
                "Transfer not received",
            )
            .await
            .expect("reject group claim");
            assert_eq!(
                count_where(
                    "SELECT COUNT(*) FROM bookings WHERE booking_group_id = $1 \
                     AND status = 'pending_payment'"
                )
                .await,
                3,
                "one rejection resets every room"
            );
            assert_eq!(
                count_where(
                    "SELECT COUNT(*) FROM payments p JOIN bookings b ON b.id = p.booking_id \
                     WHERE b.booking_group_id = $1 AND p.status = 'pending'"
                )
                .await,
                0
            );
            hotel_app_be::modules::payments::service::create_group_bank_transfer_claim(
                &pool,
                guest_of_group,
                first.group_id,
            )
            .await
            .expect("second group claim after rejection")
        } else {
            claim
        };
        // ...and one approval confirms every room.
        if let Some(staff) = staff {
            hotel_app_be::modules::payments::service::approve_payment(
                &pool,
                staff,
                claim.payment_ids[0],
            )
            .await
            .expect("approve group claim");
            let confirmed: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM bookings WHERE booking_group_id = $1 AND status = 'confirmed'",
            )
            .bind(first.group_id)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(confirmed, 3, "one approval confirms the whole group");
            let completed: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM payments WHERE id = ANY($1) AND status = 'completed'",
            )
            .bind(&claim.payment_ids)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(completed, 3);
        }

        // Cleanup of committed fixtures.
        let booking_ids: Vec<i64> = first.rooms.iter().map(|r| r.booking_id).collect();
        let guest_id: i64 = sqlx::query_scalar("SELECT guest_id FROM booking_groups WHERE id = $1")
            .bind(first.group_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        for statement in [
            "DELETE FROM email_deliveries WHERE booking_id = ANY($1)",
            "DELETE FROM payments WHERE booking_id = ANY($1)",
            "DELETE FROM consent_records WHERE booking_id = ANY($1)",
            "DELETE FROM booking_history WHERE booking_id = ANY($1)",
            "DELETE FROM bookings WHERE id = ANY($1)",
        ] {
            let _ = sqlx::query(statement)
                .bind(&booking_ids)
                .execute(&pool)
                .await;
        }
        let _ = sqlx::query("DELETE FROM email_deliveries WHERE idempotency_key = $1")
            .bind(format!("booking-group-confirmation:{}", first.group_id))
            .execute(&pool)
            .await;
        let _ = sqlx::query("DELETE FROM booking_groups WHERE id = $1")
            .bind(first.group_id)
            .execute(&pool)
            .await;
        let _ = sqlx::query("DELETE FROM guests WHERE id = $1 OR email = $2")
            .bind(guest_id)
            .bind(format!("group-cart-{suffix}-2@hotel.test"))
            .execute(&pool)
            .await;
        for type_id in type_ids {
            let _ = sqlx::query("DELETE FROM rooms WHERE room_type_id = $1")
                .bind(type_id)
                .execute(&pool)
                .await;
            let _ = sqlx::query("DELETE FROM room_types WHERE id = $1")
                .bind(type_id)
                .execute(&pool)
                .await;
        }
    }

    #[tokio::test]
    async fn postgres_guest_cancels_one_room_then_the_rest_of_the_group() {
        use hotel_app_be::modules::bookings::service::{
            cancel_pending_booking_by_guest, cancel_pending_group_by_guest,
        };
        let Some(pool) = pool().await else { return };
        let suffix = unique_suffix();
        let mut tx = pool.begin().await.unwrap();
        let seed = seed(&mut tx, suffix).await;
        let user_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, email, password_hash, full_name, user_type, guest_id, \
                 is_active, is_verified) \
             VALUES ($1, $2, 'x', 'Group Guest', 'guest', $3, true, true) RETURNING id",
        )
        .bind(format!("grpcancel{suffix}"))
        .bind(format!("grpcancel-{suffix}@hotel.test"))
        .bind(seed.guest_id)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
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
                portal_request_id: Some(format!("grpc-{suffix}")),
                created_by: None,
            },
        )
        .await
        .unwrap();
        let mut ids = Vec::new();
        for (n, room_id) in seed.room_ids.iter().enumerate() {
            ids.push(
                insert_booking(
                    &mut tx,
                    seed.guest_id,
                    *room_id,
                    format!("GC{n}-{suffix:x}"),
                    "200.00",
                    "210.00",
                    "unpaid",
                )
                .await,
            );
        }
        BookingGroupRepository::attach_tx(&mut tx, group.id, &ids)
            .await
            .unwrap();
        BookingGroupRepository::refresh_totals_tx(&mut tx, group.id)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        // One room: the group keeps the other and its totals shrink.
        cancel_pending_booking_by_guest(&pool, user_id, ids[0], None)
            .await
            .expect("single room cancel");
        let (status, rooms): (String, i32) =
            sqlx::query_as("SELECT status, room_count FROM booking_groups WHERE id = $1")
                .bind(group.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((status.as_str(), rooms), ("active", 1));

        // Someone else's account can't cancel the group.
        let stranger = cancel_pending_group_by_guest(&pool, -1, group.id, None).await;
        assert!(stranger.is_err());

        // The rest of the group, in one go.
        let result = cancel_pending_group_by_guest(&pool, user_id, group.id, None)
            .await
            .expect("group cancel");
        assert_eq!(result["booking_ids"], serde_json::json!([ids[1]]));
        let (status, rooms): (String, i32) =
            sqlx::query_as("SELECT status, room_count FROM booking_groups WHERE id = $1")
                .bind(group.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((status.as_str(), rooms), ("voided", 0));
        let live: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM bookings WHERE booking_group_id = $1 AND status <> 'voided'",
        )
        .bind(group.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(live, 0);
        // Already cancelled: a second click is refused, not a silent no-op.
        assert!(
            cancel_pending_group_by_guest(&pool, user_id, group.id, None)
                .await
                .is_err()
        );
    }
}

/// Staff `POST /bookings/group`: every room and the group commit together or
/// not at all. These tests commit through the real handler, so they use fixed
/// fixture ids and clean up before and after.
mod staff_group_create_tests {
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::BookingInput;
    use hotel_app_be::modules::bookings::group_create::{
        GroupBookingInput, create_group_booking_handler, validate_group_input,
    };
    use sqlx::PgPool;
    use sqlx::postgres::PgPoolOptions;

    const ACTOR: i64 = 961_001;
    const GUEST: i64 = 961_201;
    const OTHER_GUEST: i64 = 961_202;
    const ROOMS: [i64; 3] = [961_301, 961_302, 961_303];

    fn input(guest_id: i64, room_id: i64, check_in: &str, check_out: &str) -> BookingInput {
        serde_json::from_value(serde_json::json!({
            "guest_id": guest_id,
            "room_id": room_id,
            "check_in_date": check_in,
            "check_out_date": check_out,
        }))
        .unwrap()
    }

    fn group(items: Vec<BookingInput>) -> GroupBookingInput {
        GroupBookingInput { bookings: items }
    }

    #[test]
    fn rejects_bad_group_shapes() {
        let (a, b) = ("2031-04-01", "2031-04-03");
        let bad =
            |g: GroupBookingInput| matches!(validate_group_input(&g), Err(ApiError::BadRequest(_)));
        assert!(
            bad(group(vec![input(1, 1, a, b)])),
            "one room is not a group"
        );
        assert!(
            bad(group((1..=6).map(|r| input(1, r, a, b)).collect())),
            "more than 5 rooms"
        );
        assert!(
            bad(group(vec![input(1, 1, a, b), input(2, 2, a, b)])),
            "mixed guests"
        );
        assert!(
            bad(group(vec![input(1, 1, a, b), input(1, 1, a, b)])),
            "repeated room"
        );
        assert!(
            bad(group(vec![input(1, 1, a, b), input(1, 2, a, "2031-04-04")])),
            "mixed dates"
        );
        assert!(validate_group_input(&group(vec![input(1, 1, a, b), input(1, 2, a, b)])).is_ok());
    }

    async fn pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL")
            .ok()
            .filter(|u| !u.is_empty())?;
        Some(
            PgPoolOptions::new()
                .max_connections(3)
                .after_connect(|conn, _| {
                    Box::pin(async move {
                        sqlx::query("SET app.allow_audit_mutation = 'on'")
                            .execute(conn)
                            .await
                            .map(|_| ())
                    })
                })
                .connect(&url)
                .await
                .expect("connect"),
        )
    }

    async fn exec(pool: &PgPool, sql: &str, id: i64) {
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(id)
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("{sql}: {e}"));
    }

    async fn cleanup(pool: &PgPool) {
        for room in ROOMS {
            for sql in [
                "DELETE FROM booking_modifications WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)",
                "DELETE FROM booking_history WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)",
                "DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)",
                "DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id IN (SELECT id FROM bookings WHERE room_id = $1)",
                "DELETE FROM bookings WHERE room_id = $1",
            ] {
                exec(pool, sql, room).await;
            }
        }
        for guest in [GUEST, OTHER_GUEST] {
            exec(
                pool,
                "DELETE FROM booking_groups WHERE guest_id = $1",
                guest,
            )
            .await;
            exec(pool, "DELETE FROM guests WHERE id = $1", guest).await;
        }
        for room in ROOMS {
            exec(
                pool,
                "DELETE FROM room_status_change_log WHERE room_id = $1",
                room,
            )
            .await;
            exec(pool, "DELETE FROM rooms WHERE id = $1", room).await;
        }
        exec(pool, "DELETE FROM user_roles WHERE user_id = $1", ACTOR).await;
        exec(pool, "DELETE FROM users WHERE id = $1", ACTOR).await;
    }

    async fn seed(pool: &PgPool) {
        sqlx::query("INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) OVERRIDING SYSTEM VALUE VALUES ($1, 'pg_group_actor', 'pg-group-actor@hotel.local', 'Group Actor', 'staff', true, true)")
            .bind(ACTOR).execute(pool).await.unwrap();
        for guest in [GUEST, OTHER_GUEST] {
            sqlx::query("INSERT INTO guests (id, first_name, last_name, nick_name) OVERRIDING SYSTEM VALUE VALUES ($1, 'Group', 'Guest', $2)")
                .bind(guest).bind(format!("Staff Group Guest {guest}")).execute(pool).await.unwrap();
        }
        sqlx::query("INSERT INTO room_types (id, name, code, base_price) OVERRIDING SYSTEM VALUE VALUES (1, 'Base', 'BASE', 100.0) ON CONFLICT DO NOTHING")
            .execute(pool).await.unwrap();
        for room in ROOMS {
            sqlx::query("INSERT INTO rooms (id, room_number, room_type_id, status, is_active) OVERRIDING SYSTEM VALUE VALUES ($1, $2, 1, 'available', true)")
                .bind(room).bind(format!("G{room}")).execute(pool).await.unwrap();
        }
    }

    async fn count(pool: &PgPool, sql: &str, id: i64) -> i64 {
        sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// One test drives both paths in sequence so the fixed fixture ids are
    /// never shared by two tests running in parallel.
    #[tokio::test]
    async fn staff_group_create_is_atomic() {
        let Some(pool) = pool().await else {
            eprintln!("Skipping staff group create test: DATABASE_URL not set");
            return;
        };
        cleanup(&pool).await;
        seed(&pool).await;
        let (a, b) = ("2031-05-01", "2031-05-04");

        // Happy path: three rooms, one group, every booking attached.
        let created = create_group_booking_handler(
            &pool,
            ACTOR,
            group(ROOMS.iter().map(|r| input(GUEST, *r, a, b)).collect()),
        )
        .await
        .expect("group create");
        assert_eq!(created.bookings.len(), 3);
        assert_eq!(created.group.room_count, 3);
        assert_eq!(created.group.source, "staff");
        let attached = count(
            &pool,
            "SELECT COUNT(*) FROM bookings WHERE booking_group_id = $1",
            created.group.id,
        )
        .await;
        assert_eq!(attached, 3);
        // Input order is preserved in the response.
        let rooms: Vec<i64> = created.bookings.iter().map(|b| b.room_id).collect();
        assert_eq!(rooms, ROOMS.to_vec());

        // Conflict on the last room: nothing of the second group survives.
        let (c, d) = ("2031-06-01", "2031-06-03");
        create_group_booking_handler(
            &pool,
            ACTOR,
            group(vec![
                input(OTHER_GUEST, ROOMS[1], c, d),
                input(OTHER_GUEST, ROOMS[2], c, d),
            ]),
        )
        .await
        .expect("blocking group");
        let before = count(
            &pool,
            "SELECT COUNT(*) FROM bookings WHERE room_id = $1",
            ROOMS[0],
        )
        .await;
        let result = create_group_booking_handler(
            &pool,
            ACTOR,
            group(vec![
                input(GUEST, ROOMS[0], c, d),
                input(GUEST, ROOMS[2], c, d),
            ]),
        )
        .await;
        assert!(
            result.is_err(),
            "overlapping room must fail the whole group"
        );
        let after = count(
            &pool,
            "SELECT COUNT(*) FROM bookings WHERE room_id = $1",
            ROOMS[0],
        )
        .await;
        assert_eq!(
            before, after,
            "room 1 booking must roll back with the group"
        );
        let groups = count(
            &pool,
            "SELECT COUNT(*) FROM booking_groups WHERE guest_id = $1",
            GUEST,
        )
        .await;
        assert_eq!(
            groups, 1,
            "failed group must not leave a booking_groups row"
        );

        cleanup(&pool).await;
    }
}
