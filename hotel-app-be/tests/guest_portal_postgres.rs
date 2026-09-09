//! PostgreSQL runtime coverage for guest portal persistence.
//!
//! This test is intentionally opt-in through `DATABASE_URL`, matching the
//! existing PostgreSQL workflow tests. It exercises the production `$N`
//! placeholder path.

mod postgres_tests {
    use chrono::Utc;
    use hotel_app_be::models::guest::GuestUpdateInput;
    use hotel_app_be::modules::guest_booking::repository::GuestBookingRepository;
    use hotel_app_be::modules::guest_booking::validation::ValidatedAnonymousGuest;
    use hotel_app_be::repositories::guest_portal::GuestPortalRepository;
    use hotel_app_be::repositories::guest_portal_session::GuestPortalSessionRepository;
    use sqlx::{PgPool, Row, postgres::PgPoolOptions};

    async fn pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping guest portal PostgreSQL test because DATABASE_URL is not set");
                return None;
            }
        };
        Some(
            PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url)
                .await
                .expect("failed to connect to PostgreSQL test database"),
        )
    }

    #[tokio::test]
    async fn postgres_guest_portal_session_revocation_removes_only_the_target_token() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now()
            .timestamp_nanos_opt()
            .unwrap_or_default()
            .unsigned_abs();
        let guest_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (full_name, email) VALUES ($1, $2) RETURNING id",
        )
        .bind(format!("Guest Portal PG {suffix}"))
        .bind(format!("guest-portal-pg-{suffix}@hotel.test"))
        .fetch_one(&pool)
        .await
        .expect("insert guest fixture");
        let target = format!("target-{suffix}");
        let other = format!("other-{suffix}");
        for token_hash in [&target, &other] {
            sqlx::query(
                "INSERT INTO guest_portal_sessions (guest_id, token_hash, expires_at) \
                 VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 hour')",
            )
            .bind(guest_id)
            .bind(token_hash)
            .execute(&pool)
            .await
            .expect("insert portal session fixture");
        }

        GuestPortalSessionRepository::delete_session(&pool, &target)
            .await
            .expect("revoke target portal session");

        let rows = sqlx::query(
            "SELECT token_hash FROM guest_portal_sessions WHERE guest_id = $1 ORDER BY token_hash",
        )
        .bind(guest_id)
        .fetch_all(&pool)
        .await
        .expect("read portal sessions");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get::<String, _>("token_hash"), other);

        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(&pool)
            .await
            .expect("clean up guest portal fixture");
    }

    /// Regression: the portal pre-check-in guest patch used to name the
    /// nonexistent columns `address_line1` and `state_province` (the real
    /// `guests` columns are `address_line_1` and `state`), so every portal
    /// pre-check-in submission aborted with an undefined-column error. The
    /// DTO field names stay camel-case-adjacent (`address_line1`,
    /// `state_province`); only the SQL column names were wrong.
    #[tokio::test]
    async fn postgres_guest_precheckin_persists_address_and_state() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now()
            .timestamp_nanos_opt()
            .unwrap_or_default()
            .unsigned_abs();
        let guest_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (full_name, email) VALUES ($1, $2) RETURNING id",
        )
        .bind(format!("Precheckin Address {suffix}"))
        .bind(format!("precheckin-address-{suffix}@hotel.test"))
        .fetch_one(&pool)
        .await
        .expect("insert guest fixture");

        let update = GuestUpdateInput {
            address_line1: Some("12 Jalan Isolation".to_string()),
            city: Some("Kuala Lumpur".to_string()),
            state_province: Some("Selangor".to_string()),
            ..Default::default()
        };
        GuestPortalRepository::update_guest_precheckin(&pool, guest_id, &update)
            .await
            .expect("portal pre-checkin guest patch must succeed");

        let (address_line_1, city, state): (String, String, String) =
            sqlx::query_as("SELECT address_line_1, city, state FROM guests WHERE id = $1")
                .bind(guest_id)
                .fetch_one(&pool)
                .await
                .expect("read back patched guest");
        assert_eq!(address_line_1, "12 Jalan Isolation");
        assert_eq!(city, "Kuala Lumpur");
        assert_eq!(state, "Selangor");

        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(&pool)
            .await
            .expect("clean up precheckin fixture");
    }

    /// `room_types.code` and `rooms.room_number` are varchar(20). A decimal
    /// nanosecond timestamp is 19 digits (`TK` + 19 = 21), which CI rejects.
    fn fixture_tag(suffix: u64) -> String {
        format!("{suffix:x}")
    }

    #[test]
    fn fixture_codes_fit_varchar_20_even_for_u64_max() {
        let tag = fixture_tag(u64::MAX);
        assert!(format!("T{tag}").len() <= 20);
        assert!(format!("R{tag}").len() <= 20);
        assert!(
            format!("TK{suffix}", suffix = u64::MAX).len() > 20,
            "the old decimal tag must stay over the column limit or this test is stale"
        );
    }

    async fn seed_booking(pool: &PgPool, suffix: u64) -> (i64, i64, i64, i64) {
        let tag = fixture_tag(suffix);
        let guest_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (full_name, email) VALUES ($1, $2) RETURNING id",
        )
        .bind(format!("Token Guest {suffix}"))
        .bind(format!("token-guest-{suffix}@hotel.test"))
        .fetch_one(pool)
        .await
        .expect("insert guest");
        let room_type_id: i64 = sqlx::query_scalar(
            "INSERT INTO room_types (code, name, base_price, max_occupancy) \
             VALUES ($1, $2, 100.00, 2) RETURNING id",
        )
        .bind(format!("T{tag}"))
        .bind(format!("Token Room Type {suffix}"))
        .fetch_one(pool)
        .await
        .expect("insert room type");
        let room_id: i64 = sqlx::query_scalar(
            "INSERT INTO rooms (room_number, room_type_id, status, is_active) \
             VALUES ($1, $2, 'available', true) RETURNING id",
        )
        .bind(format!("R{tag}"))
        .bind(room_type_id)
        .fetch_one(pool)
        .await
        .expect("insert room");
        let booking_id: i64 = sqlx::query_scalar(
            "INSERT INTO bookings (
                booking_number, guest_id, room_id, check_in_date, check_out_date,
                room_rate, subtotal, total_amount, status, payment_status
             ) VALUES ($1, $2, $3, CURRENT_DATE + 10, CURRENT_DATE + 12,
                       100.00, 200.00, 200.00, 'pending_payment', 'unpaid')
             RETURNING id",
        )
        .bind(format!("TKN-{tag}"))
        .bind(guest_id)
        .bind(room_id)
        .fetch_one(pool)
        .await
        .expect("insert booking");
        (guest_id, room_type_id, room_id, booking_id)
    }

    async fn cleanup_booking(
        pool: &PgPool,
        guest_id: i64,
        room_type_id: i64,
        room_id: i64,
        booking_id: i64,
    ) {
        sqlx::query("DELETE FROM bookings WHERE id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(room_type_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .ok();
    }

    #[tokio::test]
    async fn postgres_issued_booking_token_is_hashed_at_rest_and_accepted_in_plaintext() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now()
            .timestamp_nanos_opt()
            .unwrap_or_default()
            .unsigned_abs();
        let (guest_id, room_type_id, room_id, booking_id) = seed_booking(&pool, suffix).await;
        let token = "a".repeat(64);
        let expires_at = Utc::now() + chrono::Duration::hours(48);
        GuestPortalRepository::update_precheckin_token(&pool, booking_id, &token, expires_at)
            .await
            .expect("issue hashed booking token");

        let stored: String =
            sqlx::query_scalar("SELECT pre_checkin_token FROM bookings WHERE id = $1")
                .bind(booking_id)
                .fetch_one(&pool)
                .await
                .expect("read stored token");
        assert!(
            stored.starts_with("sha256:"),
            "new tokens must be stored as a prefixed hash, got {stored}"
        );
        assert_ne!(stored, token);

        let found = GuestPortalRepository::find_booking_by_token(&pool, &token)
            .await
            .expect("lookup by presented token")
            .expect("hashed row must match the plaintext token");
        assert_eq!(found.id, booking_id);

        let dumped = GuestPortalRepository::find_booking_by_token(&pool, &stored)
            .await
            .expect("lookup of dumped hash");
        assert!(
            dumped.is_none(),
            "a database dump of pre_checkin_token must not authenticate"
        );

        cleanup_booking(&pool, guest_id, room_type_id, room_id, booking_id).await;
    }

    #[tokio::test]
    async fn postgres_legacy_plaintext_booking_token_still_authenticates() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now()
            .timestamp_nanos_opt()
            .unwrap_or_default()
            .unsigned_abs();
        let (guest_id, room_type_id, room_id, booking_id) = seed_booking(&pool, suffix).await;
        let token = "b".repeat(64);
        sqlx::query(
            "UPDATE bookings SET pre_checkin_token = $1, \
             pre_checkin_token_expires_at = CURRENT_TIMESTAMP + INTERVAL '2 days' \
             WHERE id = $2",
        )
        .bind(&token)
        .bind(booking_id)
        .execute(&pool)
        .await
        .expect("seed legacy plaintext token");

        let found = GuestPortalRepository::find_booking_by_token(&pool, &token)
            .await
            .expect("lookup legacy token")
            .expect("plaintext rows issued before hashing must still match");
        assert_eq!(found.id, booking_id);

        cleanup_booking(&pool, guest_id, room_type_id, room_id, booking_id).await;
    }

    #[tokio::test]
    async fn postgres_anonymous_guest_insert_retries_when_the_name_is_taken() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now()
            .timestamp_nanos_opt()
            .unwrap_or_default()
            .unsigned_abs();
        let base_name = format!("Anon Name {suffix}");
        let existing_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (full_name, email) VALUES ($1, $2) RETURNING id",
        )
        .bind(&base_name)
        .bind(format!("anon-existing-{suffix}@hotel.test"))
        .fetch_one(&pool)
        .await
        .expect("seed colliding guest name");

        let details = ValidatedAnonymousGuest {
            full_name: base_name.clone(),
            first_name: "Anon".to_string(),
            last_name: Some(format!("Name {suffix}")),
            email: format!("anon-new-{suffix}@hotel.test"),
            phone: None,
            tourism_type: "local".to_string(),
        };
        let mut tx = pool.begin().await.expect("begin");
        let guest_id = GuestBookingRepository::insert_anonymous_guest_tx(&mut tx, &details, "en")
            .await
            .expect("insert must retry with a suffix instead of failing the transaction");
        tx.commit().await.expect("commit");

        let stored_name: String = sqlx::query_scalar("SELECT full_name FROM guests WHERE id = $1")
            .bind(guest_id)
            .fetch_one(&pool)
            .await
            .expect("read disambiguated name");
        assert_eq!(stored_name, format!("{base_name} (2)"));
        assert_ne!(guest_id, existing_id);

        sqlx::query("DELETE FROM guests WHERE id IN ($1, $2)")
            .bind(guest_id)
            .bind(existing_id)
            .execute(&pool)
            .await
            .expect("clean up anonymous name fixture");
    }
}
