//! PostgreSQL runtime coverage for guest portal persistence.
//!
//! This test is intentionally opt-in through `DATABASE_URL`, matching the
//! existing PostgreSQL workflow tests. It exercises the production `$N`
//! placeholder path.

mod postgres_tests {
    use chrono::Utc;
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::GuestPortalClaimAccountRequest;
    use hotel_app_be::models::guest::GuestUpdateInput;
    use hotel_app_be::modules::consent::models::{ConsentAcceptance, ConsentDocument};
    use hotel_app_be::modules::consent::service::ConsentContext;
    use hotel_app_be::modules::guest_booking::repository::GuestBookingRepository;
    use hotel_app_be::modules::guest_booking::validation::ValidatedAnonymousGuest;
    use hotel_app_be::repositories::ekyc::EkycRepository;
    use hotel_app_be::repositories::guest_portal::GuestPortalRepository;
    use hotel_app_be::repositories::guest_portal_session::GuestPortalSessionRepository;
    use hotel_app_be::services::auto_checkin;
    use hotel_app_be::services::guest_portal as guest_portal_service;
    use sqlx::{PgPool, Row, postgres::PgPoolOptions};
    use std::sync::LazyLock;
    use std::sync::atomic::{AtomicU64, Ordering};

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
                // Fixture cleanup deletes users, which SET NULLs audit_logs;
                // the baseline's append-only trigger forbids that, so test
                // pools opt out session-locally.
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

    /// Every test fn in this binary runs concurrently and each seeds fixtures
    /// keyed on this value. A bare `Utc::now()` nanosecond reading is NOT
    /// unique across them — macOS clock granularity is coarser than a
    /// nanosecond, so two tests starting together can read the same value and
    /// the second one dies on `idx_guests_nick_name_unique` while seeding
    /// (observed 2026-09-10). One base reading plus a counter is unique within
    /// the process, and the base moves ~1e9 per second between runs, so it
    /// cannot collide with a row a crashed run left behind either.
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

    #[tokio::test]
    async fn postgres_guest_portal_session_revocation_removes_only_the_target_token() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = unique_suffix();
        let guest_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (nick_name, email) VALUES ($1, $2) RETURNING id",
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
        let suffix = unique_suffix();
        let guest_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (nick_name, email) VALUES ($1, $2) RETURNING id",
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
            "INSERT INTO guests (nick_name, email) VALUES ($1, $2) RETURNING id",
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
        let suffix = unique_suffix();
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
        let suffix = unique_suffix();
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
    async fn postgres_anonymous_guest_insert_fails_when_the_nickname_is_taken() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = unique_suffix();
        let base_name = format!("Anon Name {suffix}");
        let existing_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (nick_name, email) VALUES ($1, $2) RETURNING id",
        )
        .bind(&base_name)
        .bind(format!("anon-existing-{suffix}@hotel.test"))
        .fetch_one(&pool)
        .await
        .expect("seed colliding guest name");

        let details = ValidatedAnonymousGuest {
            nick_name: base_name.clone(),
            first_name: "Anon".to_string(),
            last_name: Some(format!("Name {suffix}")),
            email: format!("anon-new-{suffix}@hotel.test"),
            phone: None,
            tourism_type: "local".to_string(),
        };
        let mut tx = pool.begin().await.expect("begin");
        let result =
            GuestBookingRepository::insert_anonymous_guest_tx(&mut tx, &details, "en").await;
        tx.rollback().await.expect("rollback");
        assert!(
            matches!(result, Err(ApiError::GuestNameTaken)),
            "taken nickname must fail instead of storing a (2) suffix: {result:?}"
        );

        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(existing_id)
            .execute(&pool)
            .await
            .expect("clean up anonymous name fixture");
    }

    // ------------------------------------------------------------------
    // POST /guest-portal/claim-account
    // ------------------------------------------------------------------

    fn registration_consents() -> Vec<ConsentAcceptance> {
        let granted = |document: ConsentDocument| ConsentAcceptance {
            document,
            version: document.current_version().to_string(),
            granted: true,
            locale: "en".to_string(),
        };
        vec![
            granted(ConsentDocument::TermsOfService),
            granted(ConsentDocument::PrivacyNotice),
        ]
    }

    /// Issue a booking access token for a seeded booking and return the raw
    /// value the guest would hold.
    async fn issue_token(pool: &PgPool, booking_id: i64) -> String {
        let token = format!("{:0>64}", booking_id);
        GuestPortalRepository::update_precheckin_token(
            pool,
            booking_id,
            &token,
            Utc::now() + chrono::Duration::hours(48),
        )
        .await
        .expect("issue booking access token");
        token
    }

    fn claim_request(suffix: u64, tag: &str) -> GuestPortalClaimAccountRequest {
        GuestPortalClaimAccountRequest {
            booking_number: format!("TKN-{tag}"),
            guest_name: format!("Token Guest {suffix}"),
            username: format!("claim{suffix}"),
            password: "Sup3rSecret!pass".to_string(),
            email: Some(format!("claim-{suffix}@hotel.test")),
            consents: registration_consents(),
            marketing_opt_in: false,
        }
    }

    async fn delete_claimed_users(pool: &PgPool, guest_id: i64) {
        sqlx::query("DELETE FROM users WHERE guest_id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .ok();
    }

    /// The point of the endpoint: `auth::register` would insert a SECOND guest
    /// row (and refuse outright, because this guest's name is already taken),
    /// leaving the account bound to a profile the booking knows nothing about.
    /// eKYC and auto check-in both resolve the guest through `users.guest_id`,
    /// so anything other than the booking's own `guest_id` silently breaks the
    /// whole pre-check-in chain.
    #[tokio::test]
    async fn postgres_claim_account_binds_the_new_user_to_the_bookings_guest() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = unique_suffix();
        let tag = fixture_tag(suffix);
        let (guest_id, room_type_id, room_id, booking_id) = seed_booking(&pool, suffix).await;
        let token = issue_token(&pool, booking_id).await;

        let response = guest_portal_service::claim_booking_account(
            &pool,
            &token,
            claim_request(suffix, &tag),
            &ConsentContext::default(),
        )
        .await
        .expect("claim must succeed for a valid token and matching booking details");

        assert_eq!(response.username, format!("claim{suffix}"));
        assert!(
            response.email_verification_required,
            "an account claimed with a real address must still verify it"
        );
        assert!(
            !response.session.token.is_empty(),
            "the claim must hand back a usable portal session"
        );

        let (user_id, user_guest_id, is_active, is_verified): (i64, i64, bool, bool) =
            sqlx::query_as(
                "SELECT id, guest_id, is_active, is_verified FROM users WHERE username = $1",
            )
            .bind(format!("claim{suffix}"))
            .fetch_one(&pool)
            .await
            .expect("claimed account must exist");
        assert_eq!(
            user_guest_id, guest_id,
            "the account must bind to the booking's guest, not a new profile"
        );
        assert!(is_active);
        assert!(
            !is_verified,
            "email verification must still gate password login"
        );

        let guest_rows: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM guests WHERE nick_name = $1")
                .bind(format!("Token Guest {suffix}"))
                .fetch_one(&pool)
                .await
                .expect("count guest profiles");
        assert_eq!(guest_rows, 1, "claiming must never insert a second guest");

        let has_guest_role: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id \
             WHERE ur.user_id = $1 AND r.name = 'guest')",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("read granted roles");
        assert!(has_guest_role, "a claimed account must hold the guest role");

        // The portal session the response carries must resolve back to this
        // guest, or the wizard cannot continue into eKYC.
        let session_guest_id =
            GuestPortalSessionRepository::find_guest_id_for_authenticated_user(&pool, user_id)
                .await
                .expect("resolve guest for the claimed account");
        assert_eq!(session_guest_id, Some(guest_id));

        let consent_rows: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM consent_records WHERE user_id = $1 AND guest_id = $2",
        )
        .bind(user_id)
        .bind(guest_id)
        .fetch_one(&pool)
        .await
        .expect("count consent records");
        assert_eq!(
            consent_rows, 2,
            "both mandatory registration consents must be recorded against the claim"
        );

        delete_claimed_users(&pool, guest_id).await;
        cleanup_booking(&pool, guest_id, room_type_id, room_id, booking_id).await;
    }

    /// Front-desk eKYC provisions a login-disabled anchor account to satisfy
    /// `ekyc_verifications.user_id`. A claim must upgrade THAT row: both
    /// `EkycRepository::find_guest_user` and
    /// `GuestPortalSessionRepository::find_guest_user_id` resolve
    /// `ORDER BY id LIMIT 1`, so a second row would shadow the anchor and
    /// orphan the verification pointing at it.
    #[tokio::test]
    async fn postgres_claim_account_upgrades_the_login_disabled_ekyc_anchor() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = unique_suffix();
        let tag = fixture_tag(suffix);
        let (guest_id, room_type_id, room_id, booking_id) = seed_booking(&pool, suffix).await;
        let anchor_id =
            EkycRepository::provision_guest_user(&pool, guest_id, &format!("Token Guest {suffix}"))
                .await
                .expect("provision the front-desk eKYC anchor account");
        let token = issue_token(&pool, booking_id).await;

        guest_portal_service::claim_booking_account(
            &pool,
            &token,
            claim_request(suffix, &tag),
            &ConsentContext::default(),
        )
        .await
        .expect("a login-disabled anchor must be claimable");

        let accounts: Vec<(i64, bool, bool)> = sqlx::query_as(
            "SELECT id, is_active, (password_hash IS NOT NULL) FROM users WHERE guest_id = $1",
        )
        .bind(guest_id)
        .fetch_all(&pool)
        .await
        .expect("read accounts for the guest");
        assert_eq!(
            accounts.len(),
            1,
            "the anchor must be upgraded in place, not shadowed by a second account"
        );
        assert_eq!(accounts[0].0, anchor_id);
        assert!(accounts[0].1, "the upgraded anchor must become active");
        assert!(accounts[0].2, "the upgraded anchor must gain a password");

        delete_claimed_users(&pool, guest_id).await;
        cleanup_booking(&pool, guest_id, room_type_id, room_id, booking_id).await;
    }

    /// The booking token stays valid after a claim (it also carries the payment
    /// and receipt links), so the only thing standing between a forwarded link
    /// and an account takeover is this conflict.
    #[tokio::test]
    async fn postgres_claim_account_refuses_a_second_claim_on_the_same_booking() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = unique_suffix();
        let tag = fixture_tag(suffix);
        let (guest_id, room_type_id, room_id, booking_id) = seed_booking(&pool, suffix).await;
        let token = issue_token(&pool, booking_id).await;

        guest_portal_service::claim_booking_account(
            &pool,
            &token,
            claim_request(suffix, &tag),
            &ConsentContext::default(),
        )
        .await
        .expect("first claim must succeed");

        let mut second = claim_request(suffix, &tag);
        second.username = format!("claim{suffix}b");
        second.email = Some(format!("claim-{suffix}-b@hotel.test"));
        let result = guest_portal_service::claim_booking_account(
            &pool,
            &token,
            second,
            &ConsentContext::default(),
        )
        .await;

        assert!(
            matches!(result, Err(ApiError::Conflict(_))),
            "a booking whose account is already claimed must conflict: {result:?}"
        );
        let accounts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE guest_id = $1")
            .bind(guest_id)
            .fetch_one(&pool)
            .await
            .expect("count accounts");
        assert_eq!(accounts, 1, "a refused claim must not create an account");

        delete_claimed_users(&pool, guest_id).await;
        cleanup_booking(&pool, guest_id, room_type_id, room_id, booking_id).await;
    }

    /// A valid token alone must not be enough: the holder also has to know what
    /// is on the booking. Both halves fail identically so a probe cannot learn
    /// which one was wrong.
    #[tokio::test]
    async fn postgres_claim_account_rejects_a_token_holder_who_fails_the_booking_details() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = unique_suffix();
        let tag = fixture_tag(suffix);
        let (guest_id, room_type_id, room_id, booking_id) = seed_booking(&pool, suffix).await;
        let token = issue_token(&pool, booking_id).await;

        let mut wrong_name = claim_request(suffix, &tag);
        wrong_name.guest_name = "Someone Else".to_string();
        let by_name = guest_portal_service::claim_booking_account(
            &pool,
            &token,
            wrong_name,
            &ConsentContext::default(),
        )
        .await;

        let mut wrong_number = claim_request(suffix, &tag);
        wrong_number.booking_number = format!("TKN-{tag}X");
        let by_number = guest_portal_service::claim_booking_account(
            &pool,
            &token,
            wrong_number,
            &ConsentContext::default(),
        )
        .await;

        for result in [by_name, by_number] {
            assert!(
                matches!(result, Err(ApiError::Unauthorized(_))),
                "a mismatched booking detail must not mint an account: {result:?}"
            );
        }
        let accounts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE guest_id = $1")
            .bind(guest_id)
            .fetch_one(&pool)
            .await
            .expect("count accounts");
        assert_eq!(accounts, 0);

        cleanup_booking(&pool, guest_id, room_type_id, room_id, booking_id).await;
    }

    /// `update_booking_precheckin` binds through a homogeneous `Vec<String>`,
    /// so writing `pre_checkin_completed_at` as an RFC3339 string sent `text`
    /// at a `timestamptz` column: it compiled, passed clippy, and returned 500
    /// on every single call. Nothing reached the endpoint until the wizard did.
    ///
    /// The token assertion is the other half of the fix: this call used to null
    /// `pre_checkin_token`, which also authorizes payment, receipt upload and
    /// the account claim — so pre-checking in locked an anonymous guest out of
    /// paying for that very booking.
    #[tokio::test]
    async fn postgres_precheckin_completion_writes_a_timestamp_and_keeps_the_token() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = unique_suffix();
        let (guest_id, room_type_id, room_id, booking_id) = seed_booking(&pool, suffix).await;
        let token = issue_token(&pool, booking_id).await;

        GuestPortalRepository::update_booking_precheckin(
            &pool,
            booking_id,
            None,
            Some("Late arrival, around 11pm".to_string()),
        )
        .await
        .expect("pre-check-in completion must not fail on a timestamptz column");

        let (completed, completed_at, requests, stored_token): (
            bool,
            Option<chrono::DateTime<Utc>>,
            Option<String>,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT pre_checkin_completed, pre_checkin_completed_at, special_requests, \
             pre_checkin_token FROM bookings WHERE id = $1",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .expect("read back the pre-checked-in booking");

        assert!(completed);
        assert!(
            completed_at.is_some(),
            "the completion timestamp must actually land in the column"
        );
        assert_eq!(requests.as_deref(), Some("Late arrival, around 11pm"));
        assert!(
            stored_token.is_some(),
            "the booking access token must survive pre-check-in — payment and \
             the account claim ride on it"
        );

        let found = GuestPortalRepository::find_booking_by_token(&pool, &token)
            .await
            .expect("look the booking up again")
            .expect("the token must still authenticate after pre-check-in");
        assert_eq!(found.id, booking_id);

        delete_claimed_users(&pool, guest_id).await;
        cleanup_booking(&pool, guest_id, room_type_id, room_id, booking_id).await;
    }

    /// `checkin_booking_flow` refuses check-in without an IC / passport on file,
    /// and the auto path sends no patch that could supply one — but the
    /// eligibility summary did not consult that column. The result was a
    /// summary that reported check-in as open, a "Check in now" button, and a
    /// 400 on every press that the guest could not act on. Both directions are
    /// asserted: without the document it must block, with it must clear.
    #[tokio::test]
    async fn postgres_auto_checkin_eligibility_requires_an_identity_document() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = unique_suffix();
        let (guest_id, room_type_id, room_id, booking_id) = seed_booking(&pool, suffix).await;

        // Arrival is today, payment is done: only eKYC and identity are left.
        sqlx::query(
            "UPDATE bookings SET status = 'confirmed', payment_status = 'paid', \
             check_in_date = CURRENT_DATE, check_out_date = CURRENT_DATE + 2 WHERE id = $1",
        )
        .bind(booking_id)
        .execute(&pool)
        .await
        .expect("make the booking checkable-in");
        sqlx::query("UPDATE rooms SET status = 'available' WHERE id = $1")
            .bind(room_id)
            .execute(&pool)
            .await
            .expect("room must be ready");

        let user_id =
            EkycRepository::provision_guest_user(&pool, guest_id, &format!("Token Guest {suffix}"))
                .await
                .expect("provision the eKYC anchor account");
        sqlx::query(
            "INSERT INTO ekyc_verifications ( \
                user_id, guest_id, full_name, date_of_birth, nationality, phone, email, \
                current_address, id_type, id_number, id_issuing_country, id_issue_date, \
                id_expiry_date, id_front_image_path, selfie_image_path, status, \
                self_checkin_enabled, verified_at, submitted_at, updated_at) \
             VALUES ($1, $2, 'Token Guest', DATE '1990-01-01', 'MY', '0123456789', \
                'token@hotel.test', '1 Test Street', 'passport', 'A1234567', 'MY', \
                DATE '2020-01-01', DATE '2030-01-01', '/tmp/f.jpg', '/tmp/s.jpg', 'approved', \
                true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        )
        .bind(user_id)
        .bind(guest_id)
        .execute(&pool)
        .await
        .expect("approve eKYC with self check-in enabled");

        let blocked = auto_checkin::auto_checkin_eligibility(&pool, booking_id)
            .await
            .expect("read eligibility without an identity document");
        assert!(
            !blocked.can_auto_checkin,
            "approved eKYC alone must not report check-in as open when the \
             check-in flow would refuse for a missing IC"
        );
        assert_eq!(
            blocked.auto_checkin_block_reason.as_deref(),
            Some("Add your IC or passport number to your details to check in online."),
            "the reason must tell the guest what to do about it"
        );

        sqlx::query("UPDATE guests SET ic_number = 'A1234567' WHERE id = $1")
            .bind(guest_id)
            .execute(&pool)
            .await
            .expect("put an identity document on file");

        let open = auto_checkin::auto_checkin_eligibility(&pool, booking_id)
            .await
            .expect("read eligibility with an identity document");
        assert!(
            open.can_auto_checkin,
            "with eKYC approved and an IC on file, check-in must be open: {:?}",
            open.auto_checkin_block_reason
        );

        sqlx::query("DELETE FROM ekyc_verifications WHERE guest_id = $1")
            .bind(guest_id)
            .execute(&pool)
            .await
            .ok();
        delete_claimed_users(&pool, guest_id).await;
        cleanup_booking(&pool, guest_id, room_type_id, room_id, booking_id).await;
    }
}
