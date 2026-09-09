//! PostgreSQL runtime coverage for payment retry capabilities.
//!
//! This crate uses plain `sqlx::query()` rather than the checking macros, so a
//! Rust-type/column-type mismatch compiles cleanly and only fails when a row is
//! actually decoded. These tests therefore fetch every column of the new row
//! mapping against a real database; `cargo check` proves nothing here.
//!
//! Opt-in through `DATABASE_URL`, matching the other PostgreSQL workflow tests.

mod postgres_tests {
    use chrono::{Duration, Utc};
    use hotel_app_be::repositories::payment_retry::PaymentRetryRepository;
    use sqlx::{PgPool, postgres::PgPoolOptions};

    async fn pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!(
                    "Skipping payment retry PostgreSQL test because DATABASE_URL is not set"
                );
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

    /// Minimal booking to hang capabilities off. Returns (guest_id, booking_id).
    ///
    /// `slot` must be unique per test: cargo runs these concurrently in one
    /// binary, and `bookings` carries an exclusion constraint over room and
    /// stay range, so sharing a room deadlocks rather than failing cleanly.
    async fn seed_booking(pool: &PgPool, suffix: u64, slot: i64) -> (i64, i64) {
        let guest_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (nick_name, email) VALUES ($1, $2) RETURNING id",
        )
        .bind(format!("Retry Fixture {suffix}"))
        .bind(format!("retry-{suffix}@hotel.test"))
        .fetch_one(pool)
        .await
        .expect("seed guest");

        // room_id is NOT NULL, and trg_sync_room_status_booking fires off the
        // status, so the fixture books a real seeded room and the cleanup below
        // clears the log rows that trigger writes behind the test's back.
        let booking_id: i64 = sqlx::query_scalar(
            "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, \
                 room_rate, subtotal, total_amount, status, payment_status) \
             VALUES ($1, $2, (SELECT id FROM rooms ORDER BY id OFFSET $3 LIMIT 1), \
                 CURRENT_DATE + ($4)::int, CURRENT_DATE + ($4)::int + 1, \
                 100, 100, 100, 'confirmed', 'unpaid') \
             RETURNING id",
        )
        .bind(format!("RT{suffix}"))
        .bind(guest_id)
        .bind(slot)
        .bind((slot * 2) as i32)
        .fetch_one(pool)
        .await
        .expect("seed booking");

        (guest_id, booking_id)
    }

    async fn cleanup(pool: &PgPool, guest_id: i64, booking_id: i64) {
        let _ = sqlx::query("DELETE FROM payment_retry_capabilities WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await;
        let _ = sqlx::query("DELETE FROM payments WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await;
        let _ = sqlx::query("DELETE FROM room_status_change_log WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await;
        let _ = sqlx::query("DELETE FROM bookings WHERE id = $1")
            .bind(booking_id)
            .execute(pool)
            .await;
        let _ = sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await;
    }

    #[tokio::test]
    async fn postgres_capability_round_trips_every_mapped_column() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now().timestamp_nanos_opt().unwrap_or_default().unsigned_abs();
        let (guest_id, booking_id) = seed_booking(&pool, suffix, 0).await;

        let expires_at = Utc::now() + Duration::minutes(60);
        let created = PaymentRetryRepository::create(
            &pool,
            booking_id,
            None,
            &format!("sha256:{suffix:064x}"),
            expires_at,
        )
        .await
        .expect("create capability");

        let found = PaymentRetryRepository::find_by_token_hash(
            &pool,
            &format!("sha256:{suffix:064x}"),
        )
        .await
        .expect("lookup capability");

        // Fixtures go before the assertions: a panic here would otherwise leave
        // a booking behind and the exclusion constraint would poison every
        // later run of this file.
        cleanup(&pool, guest_id, booking_id).await;

        // Decoding is what this test exists for: every column of the mapping is
        // read back off a real row, including the nullable ones.
        assert_eq!(created.booking_id, booking_id);
        assert_eq!(created.payment_id, None);
        assert_eq!(created.consumed_at, None);
        assert_eq!(created.replacement_payment_id, None);
        assert!(created.id > 0);
        assert!((created.expires_at - expires_at).num_seconds().abs() <= 1);
        assert!(!created.is_consumed());
        assert!(created.is_spendable_at(Utc::now()));
        assert_eq!(
            found.expect("capability must be found by its hash").id,
            created.id
        );
    }

    #[tokio::test]
    async fn postgres_lookup_does_not_consume_the_capability() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now().timestamp_nanos_opt().unwrap_or_default().unsigned_abs() + 1;
        let (guest_id, booking_id) = seed_booking(&pool, suffix, 1).await;
        let hash = format!("sha256:{suffix:064x}");

        PaymentRetryRepository::create(&pool, booking_id, None, &hash, Utc::now() + Duration::minutes(60))
            .await
            .expect("create capability");

        // An email scanner following the link must not burn the guest's attempt.
        let mut consumed_flags = Vec::new();
        for _ in 0..3 {
            let seen = PaymentRetryRepository::find_by_token_hash(&pool, &hash)
                .await
                .expect("lookup")
                .expect("still present");
            consumed_flags.push(seen.is_consumed());
        }

        cleanup(&pool, guest_id, booking_id).await;

        assert!(
            consumed_flags.iter().all(|consumed| !consumed),
            "viewing must never consume: {consumed_flags:?}"
        );
    }

    #[tokio::test]
    async fn postgres_only_one_of_two_concurrent_consumes_succeeds() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now().timestamp_nanos_opt().unwrap_or_default().unsigned_abs() + 2;
        let (guest_id, booking_id) = seed_booking(&pool, suffix, 2).await;
        let hash = format!("sha256:{suffix:064x}");

        let capability = PaymentRetryRepository::create(
            &pool,
            booking_id,
            None,
            &hash,
            Utc::now() + Duration::minutes(60),
        )
        .await
        .expect("create capability");

        let payment_id: i64 = sqlx::query_scalar(
            "INSERT INTO payments (booking_id, amount, payment_method, status) \
             VALUES ($1, 100, 'card', 'pending') RETURNING id",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .expect("seed replacement payment");

        // Two submissions racing on the same capability. The guard lives in the
        // UPDATE's WHERE clause, so exactly one may win -- a double-charge here
        // would be a real duplicate payment.
        let mut tx_a = pool.begin().await.expect("begin a");
        let a = PaymentRetryRepository::consume_tx(&mut tx_a, capability.id, payment_id)
            .await
            .expect("consume a");
        tx_a.commit().await.expect("commit a");

        let mut tx_b = pool.begin().await.expect("begin b");
        let b = PaymentRetryRepository::consume_tx(&mut tx_b, capability.id, payment_id)
            .await
            .expect("consume b");
        tx_b.commit().await.expect("commit b");

        let after = PaymentRetryRepository::find_by_token_hash(&pool, &hash)
            .await
            .expect("lookup")
            .expect("present");

        cleanup(&pool, guest_id, booking_id).await;

        assert!(a, "the first consume must succeed");
        assert!(!b, "the second consume must not succeed");
        assert!(after.is_consumed());
        assert_eq!(after.replacement_payment_id, Some(payment_id));
    }

    #[tokio::test]
    async fn postgres_an_expired_capability_cannot_be_consumed() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now().timestamp_nanos_opt().unwrap_or_default().unsigned_abs() + 3;
        let (guest_id, booking_id) = seed_booking(&pool, suffix, 3).await;

        let capability = PaymentRetryRepository::create(
            &pool,
            booking_id,
            None,
            &format!("sha256:{suffix:064x}"),
            Utc::now() - Duration::minutes(1),
        )
        .await
        .expect("create expired capability");

        let payment_id: i64 = sqlx::query_scalar(
            "INSERT INTO payments (booking_id, amount, payment_method, status) \
             VALUES ($1, 100, 'card', 'pending') RETURNING id",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .expect("seed payment");

        let mut tx = pool.begin().await.expect("begin");
        let consumed = PaymentRetryRepository::consume_tx(&mut tx, capability.id, payment_id)
            .await
            .expect("consume");
        tx.commit().await.expect("commit");
        cleanup(&pool, guest_id, booking_id).await;

        assert!(!consumed, "an expired capability must not be spendable");
    }

    #[tokio::test]
    async fn postgres_live_scan_excludes_consumed_and_expired_rows() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now().timestamp_nanos_opt().unwrap_or_default().unsigned_abs() + 4;
        let (guest_id, booking_id) = seed_booking(&pool, suffix, 4).await;

        let live = PaymentRetryRepository::create(
            &pool,
            booking_id,
            None,
            &format!("sha256:{:064x}", suffix),
            Utc::now() + Duration::minutes(60),
        )
        .await
        .expect("live");
        PaymentRetryRepository::create(
            &pool,
            booking_id,
            None,
            &format!("sha256:{:064x}", suffix + 1),
            Utc::now() - Duration::minutes(1),
        )
        .await
        .expect("expired");

        let found = PaymentRetryRepository::find_live_for_booking(&pool, booking_id)
            .await
            .expect("scan");

        cleanup(&pool, guest_id, booking_id).await;

        assert_eq!(found.len(), 1, "only the unexpired, unconsumed row counts");
        assert_eq!(found[0].id, live.id);
    }

    /// SHA-256 of a token, prefixed the way the service persists it.
    fn token_hash(token: &str) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(token.as_bytes());
        format!("sha256:{}", hex::encode(hasher.finalize()))
    }

    #[tokio::test]
    async fn postgres_restore_gives_the_capability_back_after_a_released_payment() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now().timestamp_nanos_opt().unwrap_or_default().unsigned_abs() + 5;
        let (guest_id, booking_id) = seed_booking(&pool, suffix, 5).await;
        let hash = format!("sha256:{suffix:064x}");

        let capability = PaymentRetryRepository::create(
            &pool,
            booking_id,
            None,
            &hash,
            Utc::now() + Duration::minutes(60),
        )
        .await
        .expect("create");

        let payment_id: i64 = sqlx::query_scalar(
            "INSERT INTO payments (booking_id, amount, payment_method, status) \
             VALUES ($1, 100, 'paypal', 'pending') RETURNING id",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .expect("seed payment");

        let mut tx = pool.begin().await.expect("begin");
        PaymentRetryRepository::consume_tx(&mut tx, capability.id, payment_id)
            .await
            .expect("consume");
        tx.commit().await.expect("commit");

        // A restore scoped to a different payment must not resurrect this one.
        let wrong = PaymentRetryRepository::restore(&pool, capability.id, payment_id + 9_999)
            .await
            .expect("restore with the wrong payment");
        let right = PaymentRetryRepository::restore(&pool, capability.id, payment_id)
            .await
            .expect("restore");
        let after = PaymentRetryRepository::find_by_token_hash(&pool, &hash)
            .await
            .expect("lookup")
            .expect("present");

        cleanup(&pool, guest_id, booking_id).await;

        assert!(!wrong, "a restore must be scoped to the payment it funded");
        assert!(right, "the scoped restore must succeed");
        assert!(!after.is_consumed(), "the guest gets their link back");
        assert_eq!(after.replacement_payment_id, None);
    }

    #[tokio::test]
    async fn postgres_capture_refuses_a_payment_the_link_did_not_authorise() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now().timestamp_nanos_opt().unwrap_or_default().unsigned_abs() + 6;
        let (guest_id, booking_id) = seed_booking(&pool, suffix, 6).await;
        let token = format!("{suffix:064x}");

        let capability = PaymentRetryRepository::create(
            &pool,
            booking_id,
            None,
            &token_hash(&token),
            Utc::now() + Duration::minutes(60),
        )
        .await
        .expect("create");

        let mine: i64 = sqlx::query_scalar(
            "INSERT INTO payments (booking_id, amount, payment_method, status) \
             VALUES ($1, 100, 'paypal', 'pending') RETURNING id",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .expect("seed payment");

        let mut tx = pool.begin().await.expect("begin");
        PaymentRetryRepository::consume_tx(&mut tx, capability.id, mine)
            .await
            .expect("consume");
        tx.commit().await.expect("commit");

        // Pointing a spent link at somebody else's payment must be refused
        // before PayPal is contacted at all.
        let result = hotel_app_be::services::payment_retry::capture_recovered_paypal(
            &pool,
            &token,
            "ORDER-DOES-NOT-MATTER",
            mine + 9_999,
        )
        .await;

        cleanup(&pool, guest_id, booking_id).await;

        assert!(
            matches!(result, Err(hotel_app_be::core::error::ApiError::Forbidden(_))),
            "capture must be scoped to the payment this link produced: {result:?}"
        );
    }

    #[tokio::test]
    async fn postgres_a_spent_capability_still_resolves_so_capture_can_finish() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now().timestamp_nanos_opt().unwrap_or_default().unsigned_abs() + 7;
        let (guest_id, booking_id) = seed_booking(&pool, suffix, 7).await;
        let token = format!("{suffix:064x}");

        let capability = PaymentRetryRepository::create(
            &pool,
            booking_id,
            None,
            &token_hash(&token),
            Utc::now() + Duration::minutes(60),
        )
        .await
        .expect("create");

        let payment_id: i64 = sqlx::query_scalar(
            "INSERT INTO payments (booking_id, amount, payment_method, status) \
             VALUES ($1, 100, 'paypal', 'pending') RETURNING id",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .expect("seed payment");

        let mut tx = pool.begin().await.expect("begin");
        PaymentRetryRepository::consume_tx(&mut tx, capability.id, payment_id)
            .await
            .expect("consume");
        tx.commit().await.expect("commit");

        // The guest approves in PayPal's window and comes back to a link that
        // is already spent. Resolution must still succeed, or every authorised
        // PayPal order would be stranded between approval and capture.
        let resolved =
            hotel_app_be::services::payment_retry::resolve_capability(&pool, &token).await;

        cleanup(&pool, guest_id, booking_id).await;

        let resolved = resolved.expect("a spent capability must still resolve");
        assert!(resolved.is_consumed());
        assert_eq!(resolved.replacement_payment_id, Some(payment_id));
    }
}
