//! Integration tests for the guests, rates, and loyalty domains.
//!
//! These three domains had zero prior integration coverage (guests: 15
//! endpoints, rates: 11, loyalty: 13 -- see
//! `.claude/reports/be-test-coverage-2026-07-26.md` Part E) despite guest
//! credits and loyalty points being money-adjacent. Tests call the
//! service/repository layer directly against PostgreSQL, the same way
//! `tests/booking_service.rs` and `tests/auth_session.rs` do.
//!
//! IMPORTANT loyalty naming note: this repo has TWO loyalty stacks.
//! `services::loyalty` + `repositories::loyalty` + `models::loyalty` +
//! `routes::loyalty` (programs/memberships/points-add/points-redeem) is DEAD
//! CODE -- `routes::loyalty::routes()` is never `.merge()`d into
//! `create_router` (see `routes/mod.rs` lines 19-23,220; only
//! `modules::loyalty::routes::routes()` is). The LIVE stack is
//! `modules::loyalty::{service, repository, models}` (members/accounts/tiers/
//! transactions/rewards/redemptions), reached in production via `guests.rs`'s
//! `ensure_member_for_guest` call. All loyalty tests below exercise the LIVE
//! stack; see the end-of-file report for the dead-code finding.
//!
//! Fixture ID convention: fixed IDs live in block 985_xxx (users 985_0xx,
//! bookings 985_1xx, guests 985_2xx, rooms 985_3xx, room_types 985_4xx).
//! `rate_plans`/`room_rates`/`loyalty_members`/`loyalty_rewards` are identity
//! columns with no explicit-ID insert path in the service layer under test,
//! so those rows get server-assigned IDs and are instead pinned by a
//! deterministic `gst985...` unique code/name for idempotent start/end
//! cleanup -- the closest available equivalent to a fixed ID for tables the
//! service itself must be the one to insert into.

mod postgres_tests {
    use chrono::{Duration, NaiveDate, Utc};
    use hotel_app_be::constants::{GuestType, TourismType};
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::{
        AddGuestCreditsRequest, ApplicableRateQuery, BookWithCreditsRequest, GuestInput,
        GuestUpdateInput, RatePlanInput, RatePlanUpdateInput, RoomRateInput, RoomRateUpdateInput,
        UpdateGuestCreditsRequest,
    };
    use hotel_app_be::modules::loyalty::models::{
        GiftPointsInput, ManualAdjustmentInput, RedeemRewardInput, RewardInput,
    };
    use hotel_app_be::modules::loyalty::service as loyalty_service;
    use hotel_app_be::repositories::bookings::{
        add_guest_credits_handler, book_with_credits_handler, delete_guest_credits_handler,
        update_guest_credits_handler,
    };
    use hotel_app_be::services::guests as guest_service;
    use hotel_app_be::services::rates as rate_service;
    use hotel_app_be::{AuthService, Claims};
    use axum::Json;
    use axum::extract::{Extension, Path, State};
    use axum::http::HeaderMap;
    use rust_decimal::Decimal;
    use sqlx::{PgPool, postgres::PgPoolOptions};
    use std::str::FromStr;

    async fn setup_pg_pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!(
                    "Skipping PostgreSQL guests/rates/loyalty test because DATABASE_URL is not set"
                );
                return None;
            }
        };

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database");
        Some(pool)
    }

    // -----------------------------------------------------------------
    // Fixture helpers
    // -----------------------------------------------------------------

    async fn upsert_user(pool: &PgPool, user_id: i64, username: &str, email: &str, guest_id: Option<i64>) {
        sqlx::query(
            "INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified, guest_id)
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'staff', true, true, $5)
             ON CONFLICT (id) DO UPDATE SET
                username = EXCLUDED.username,
                email = EXCLUDED.email,
                full_name = EXCLUDED.full_name,
                is_active = true,
                is_verified = true,
                guest_id = EXCLUDED.guest_id",
        )
        .bind(user_id)
        .bind(username)
        .bind(email)
        .bind(format!("Gst985 Actor {user_id}"))
        .bind(guest_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn upsert_guest(
        pool: &PgPool,
        guest_id: i64,
        full_name: &str,
        email: Option<&str>,
        phone: Option<&str>,
        ic_number: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO guests (id, full_name, first_name, last_name, email, phone, ic_number, guest_type, tourism_type)
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $2, $2, $3, $4, $5, 'non_member', 'local')
             ON CONFLICT (id) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                ic_number = EXCLUDED.ic_number,
                deleted_at = NULL",
        )
        .bind(guest_id)
        .bind(full_name)
        .bind(email)
        .bind(phone)
        .bind(ic_number)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_room_type(pool: &PgPool, id: i64, code: &str, name: &str, base_price: &str, max_occupancy: i32) {
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price, max_occupancy)
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4::numeric, $5)
             ON CONFLICT (id) DO UPDATE SET
                code = EXCLUDED.code, name = EXCLUDED.name,
                base_price = EXCLUDED.base_price, max_occupancy = EXCLUDED.max_occupancy",
        )
        .bind(id)
        .bind(code)
        .bind(name)
        .bind(base_price)
        .bind(max_occupancy)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_room(pool: &PgPool, id: i64, room_number: &str, room_type_id: i64, status: &str) {
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status)
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET
                room_number = EXCLUDED.room_number, room_type_id = EXCLUDED.room_type_id, status = EXCLUDED.status",
        )
        .bind(id)
        .bind(room_number)
        .bind(room_type_id)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_booking(
        pool: &PgPool,
        id: i64,
        guest_id: i64,
        room_id: i64,
        check_in: &str,
        check_out: &str,
        status: &str,
    ) {
        let check_in_date = NaiveDate::parse_from_str(check_in, "%Y-%m-%d").unwrap();
        let check_out_date = NaiveDate::parse_from_str(check_out, "%Y-%m-%d").unwrap();
        sqlx::query(
            "INSERT INTO bookings (
                id, booking_number, guest_id, guest_name, room_id,
                check_in_date, check_out_date, adults, children,
                room_rate, subtotal, total_amount, status, payment_status
             )
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 0, 100.00, 200.00, 200.00, $8, 'unpaid')
             ON CONFLICT (id) DO UPDATE SET
                guest_id = EXCLUDED.guest_id, room_id = EXCLUDED.room_id,
                check_in_date = EXCLUDED.check_in_date, check_out_date = EXCLUDED.check_out_date,
                status = EXCLUDED.status",
        )
        .bind(id)
        .bind(format!("BK-GST985-{id}"))
        .bind(guest_id)
        .bind(format!("Gst985 Booking Guest {id}"))
        .bind(room_id)
        .bind(check_in_date)
        .bind(check_out_date)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn delete_room_status_log(pool: &PgPool, room_ids: &[i64]) {
        sqlx::query("DELETE FROM room_status_change_log WHERE room_id = ANY($1)")
            .bind(room_ids)
            .execute(pool)
            .await
            .unwrap();
    }

    /// Deleting a guest cascades away its bookings (and payments/booking_history/
    /// booking_modifications off those bookings), guest_complimentary_credits,
    /// user_guests links, and loyalty_members (and loyalty_accounts/transactions/
    /// redemptions off that member) -- all declared ON DELETE CASCADE from
    /// `guests.id` in the V1 baseline. This is the main cleanup lever used below.
    async fn delete_guests(pool: &PgPool, guest_ids: &[i64]) {
        sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'guest' AND resource_id = ANY($1)")
            .bind(guest_ids)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM guests WHERE id = ANY($1)")
            .bind(guest_ids)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn delete_rooms(pool: &PgPool, room_ids: &[i64]) {
        delete_room_status_log(pool, room_ids).await;
        sqlx::query("DELETE FROM rooms WHERE id = ANY($1)")
            .bind(room_ids)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn delete_room_types(pool: &PgPool, room_type_ids: &[i64]) {
        sqlx::query("DELETE FROM room_types WHERE id = ANY($1)")
            .bind(room_type_ids)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn delete_users(pool: &PgPool, user_ids: &[i64]) {
        sqlx::query("DELETE FROM user_roles WHERE user_id = ANY($1)")
            .bind(user_ids)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM users WHERE id = ANY($1)")
            .bind(user_ids)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn cleanup_rate_plan_by_code(pool: &PgPool, code: &str) {
        sqlx::query(
            "DELETE FROM audit_logs WHERE resource_type IN ('rate_plan', 'room_rate')
               AND resource_id IN (SELECT id FROM rate_plans WHERE code = $1)",
        )
        .bind(code)
        .execute(pool)
        .await
        .unwrap();
        // room_rates cascade away with the rate plan (ON DELETE CASCADE).
        sqlx::query("DELETE FROM rate_plans WHERE code = $1")
            .bind(code)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn delete_loyalty_rewards(pool: &PgPool, name_prefix: &str) {
        sqlx::query("DELETE FROM loyalty_rewards WHERE name LIKE $1")
            .bind(format!("{name_prefix}%"))
            .execute(pool)
            .await
            .unwrap();
    }

    /// Deletes the guest (cascading loyalty_members/accounts/transactions/
    /// redemptions) then the actor/enrolling user rows. Order matters: the
    /// guest must go first so `loyalty_transactions.actor_user_id` (FK ->
    /// users, no cascade) is already gone before the users are deleted.
    async fn cleanup_loyalty_fixture(pool: &PgPool, guest_id: i64, user_ids: &[i64]) {
        delete_guests(pool, &[guest_id]).await;
        delete_users(pool, user_ids).await;
    }

    /// Creates a rate plan through the real service function.
    ///
    /// Earlier revisions of this file seeded `rate_plans` via direct SQL
    /// because `services::rates::create_rate_plan` failed on EVERY call:
    /// `blackout_dates` (a `jsonb` column) was bound as a bare
    /// `Option<Vec<String>>`, which sqlx encodes as TEXT[]. That bind was
    /// fixed on 2026-07-26 (`RateRepository::create_rate_plan` now wraps the
    /// value in `sqlx::types::Json`), so plan creation is exercised for real
    /// here -- both the `Some` (jsonb array) and `None` (SQL NULL) paths.
    async fn create_rate_plan_via_service(
        pool: &PgPool,
        actor_id: i64,
        code: &str,
        name: &str,
        priority: i32,
        blackout_dates: Option<Vec<String>>,
    ) -> i64 {
        rate_service::create_rate_plan(
            pool,
            actor_id,
            RatePlanInput {
                name: name.to_string(),
                code: code.to_string(),
                description: None,
                plan_type: None,
                adjustment_type: None,
                adjustment_value: None,
                valid_from: None,
                valid_to: None,
                applies_monday: None,
                applies_tuesday: None,
                applies_wednesday: None,
                applies_thursday: None,
                applies_friday: None,
                applies_saturday: None,
                applies_sunday: None,
                min_nights: None,
                max_nights: None,
                min_advance_booking: None,
                max_advance_booking: None,
                blackout_dates,
                is_active: None,
                priority: Some(priority),
            },
        )
        .await
        .expect("create_rate_plan via the service must succeed")
        .id
    }

    const TEST_JWT_SECRET: &str = "hotel-app-be-guests-rates-loyalty-test-secret-32chars-minimum";

    fn ensure_jwt_secret() {
        let _ = AuthService::init_jwt_secret(TEST_JWT_SECRET);
    }

    /// `book_with_credits_handler` authenticates via `require_auth(&headers)`
    /// (unlike the credits grant/update/delete handlers, which take a plain
    /// `Extension<i64>`), so calling it directly needs a real, signed JWT.
    fn bearer_header_for(user_id: i64) -> HeaderMap {
        ensure_jwt_secret();
        let claims = Claims {
            sub: user_id.to_string(),
            username: format!("gst985_user_{user_id}"),
            iss: "hotel-app-be".to_string(),
            aud: "hotel-web".to_string(),
            exp: Some((Utc::now() + Duration::minutes(30)).timestamp() as usize),
            iat: Utc::now().timestamp() as usize,
            roles: vec!["staff".to_string()],
            sid: Some(format!("gst985-session-{user_id}")),
        };
        let token = jsonwebtoken::encode(
            &jsonwebtoken::Header::default(),
            &claims,
            &jsonwebtoken::EncodingKey::from_secret(TEST_JWT_SECRET.as_bytes()),
        )
        .expect("encoding a test JWT must succeed");

        let mut headers = HeaderMap::new();
        headers.insert(
            "authorization",
            format!("Bearer {token}").parse().expect("header value must be valid"),
        );
        headers
    }

    // -----------------------------------------------------------------
    // Guests: create (sanitization + defaults + validation)
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn guest_create_via_service_sanitizes_text_rejects_bad_email_and_applies_defaults() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 985_001;
        let full_name = "Gst985create Guesty";

        sqlx::query("DELETE FROM guests WHERE full_name = $1")
            .bind(full_name)
            .execute(&pool)
            .await
            .unwrap();
        upsert_user(&pool, actor_id, "gst985_guest_create_actor", "gst985.guestcreateactor@hotel.local", None).await;

        // Malformed email must be rejected and no row created.
        let bad_input = GuestInput {
            first_name: "Gst985create".to_string(),
            last_name: "Guesty".to_string(),
            email: Some("not-an-email".to_string()),
            phone: None,
            ic_number: None,
            nationality: None,
            address_line1: None,
            city: None,
            state_province: None,
            postal_code: None,
            country: None,
            guest_type: None,
            tourism_type: None,
            discount_percentage: None,
            company_name: None,
        };
        let bad_result = guest_service::create_guest(&pool, actor_id, bad_input).await;
        assert!(
            matches!(bad_result, Err(ApiError::BadRequest(_))),
            "malformed email must be rejected: {bad_result:?}"
        );

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM guests WHERE full_name = $1")
            .bind(full_name)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0, "rejected creation must not persist a row");

        // Free text with control characters and stray whitespace must pass
        // through the Sanitizer cleanly, and unspecified fields must default.
        let good_input = GuestInput {
            first_name: "  Gst985create\u{0007} ".to_string(),
            last_name: " Guesty\u{0007} ".to_string(),
            email: Some("  GST985.Create@Example.COM  ".to_string()),
            phone: Some(" +6012-345 6788 ".to_string()),
            ic_number: None,
            nationality: None,
            address_line1: None,
            city: None,
            state_province: None,
            postal_code: None,
            country: None,
            guest_type: None,
            tourism_type: None,
            discount_percentage: None,
            company_name: None,
        };
        let guest = guest_service::create_guest(&pool, actor_id, good_input)
            .await
            .expect("valid guest creation must succeed");

        assert_eq!(guest.full_name, full_name, "control chars stripped, names trimmed and joined");
        assert_eq!(guest.email.as_deref(), Some("gst985.create@example.com"));
        assert_eq!(guest.phone.as_deref(), Some("+60123456788"));
        assert_eq!(guest.guest_type, GuestType::NonMember, "default guest_type");
        assert_eq!(guest.tourism_type, Some(TourismType::Local), "default tourism_type");
        assert_eq!(guest.discount_percentage, 0, "default discount_percentage");
        assert_eq!(guest.company_name, None);

        delete_guests(&pool, &[guest.id]).await;
        delete_users(&pool, &[actor_id]).await;
    }

    // -----------------------------------------------------------------
    // Guests: update + delete (hard delete, blocked while checked in)
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn guest_update_persists_changes_and_delete_is_blocked_while_checked_in() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let guest_id = 985_210;
        let room_type_id = 985_403;
        let room_id = 985_302;
        let booking_id = 985_102;

        async fn cleanup(pool: &PgPool, guest_id: i64, room_type_id: i64, room_id: i64, booking_id: i64) {
            delete_room_status_log(pool, &[room_id]).await;
            sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1")
                .bind(booking_id)
                .execute(pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM bookings WHERE id = $1")
                .bind(booking_id)
                .execute(pool)
                .await
                .unwrap();
            delete_guests(pool, &[guest_id]).await;
            delete_rooms(pool, &[room_id]).await;
            delete_room_types(pool, &[room_type_id]).await;
        }

        cleanup(&pool, guest_id, room_type_id, room_id, booking_id).await;
        upsert_guest(&pool, guest_id, "Gst985 Update Target", Some("gst985.updatetarget@hotel.local"), None, None).await;

        let updated = guest_service::update_guest(
            &pool,
            guest_id,
            GuestUpdateInput {
                first_name: Some("Gst985Updated".to_string()),
                last_name: Some("Target".to_string()),
                email: Some("gst985.updated@hotel.local".to_string()),
                phone: Some("+60111222333".to_string()),
                title: None,
                alt_phone: None,
                ic_number: None,
                nationality: None,
                address_line1: None,
                city: None,
                state_province: None,
                postal_code: None,
                country: None,
                // Deliberately probing the ignored `is_active` field -- see
                // the report: GuestUpdateValues has no is_active member, and
                // every guest SELECT hardcodes `true as is_active`, so this
                // is expected to have NO effect (asserted below).
                is_active: Some(false),
                guest_type: None,
                tourism_type: Some(TourismType::Foreign),
                discount_percentage: Some(10),
                company_name: None,
            },
        )
        .await
        .expect("update must succeed");

        assert_eq!(updated.full_name, "Gst985Updated Target");
        assert_eq!(updated.email.as_deref(), Some("gst985.updated@hotel.local"));
        assert_eq!(updated.phone.as_deref(), Some("+60111222333"));
        assert_eq!(updated.tourism_type, Some(TourismType::Foreign));
        assert_eq!(updated.discount_percentage, 10);
        assert!(updated.is_active, "is_active is not wired into GuestUpdateValues; it must stay true");

        seed_room_type(&pool, room_type_id, "GST985RT3", "Gst985 Delete Block Type", "120.00", 2).await;
        seed_room(&pool, room_id, "GST985R3", room_type_id, "occupied").await;
        seed_booking(&pool, booking_id, guest_id, room_id, "2031-07-10", "2031-07-12", "checked_in").await;

        let blocked = guest_service::delete_guest(&pool, guest_id).await;
        assert!(
            matches!(blocked, Err(ApiError::BadRequest(_))),
            "delete must be blocked while a checked-in booking exists: {blocked:?}"
        );

        sqlx::query("UPDATE bookings SET status = 'checked_out' WHERE id = $1")
            .bind(booking_id)
            .execute(&pool)
            .await
            .unwrap();

        guest_service::delete_guest(&pool, guest_id)
            .await
            .expect("delete must succeed once no longer checked in");

        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM guests WHERE id = $1)")
            .bind(guest_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(!exists, "delete_guest hard-deletes the row (no soft-delete/restore is wired up)");

        cleanup(&pool, guest_id, room_type_id, room_id, booking_id).await;
    }

    // -----------------------------------------------------------------
    // Guests: duplicate detection
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn guest_profile_duplicate_detection_flags_shared_contact_not_dissimilar_guest() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let ids = [985_201_i64, 985_202, 985_203];
        delete_guests(&pool, &ids).await;

        upsert_guest(
            &pool,
            985_201,
            "Gst985 Duplicate Alpha",
            Some("gst985.dup@hotel.local"),
            Some("+60123456700"),
            Some("A985201"),
        )
        .await;
        upsert_guest(
            &pool,
            985_202,
            "Gst985 Duplicate Beta",
            Some("GST985.DUP@HOTEL.LOCAL"),
            Some("60-123 456 700"),
            Some("a-985201"),
        )
        .await;
        upsert_guest(
            &pool,
            985_203,
            "Gst985 Totally Different Person",
            Some("gst985.nomatch@hotel.local"),
            Some("+60199988877"),
            Some("Z000999"),
        )
        .await;

        let profile = guest_service::guest_profile(&pool, 985_201)
            .await
            .expect("profile must resolve");

        let flagged = profile
            .duplicate_candidates
            .iter()
            .find(|c| c.guest.id == 985_202);
        let flagged = flagged.expect("shared email/phone/ic guest must be flagged");
        assert_eq!(flagged.score, 220, "60 phone + 60 email + 100 identity, no name match");
        assert_eq!(flagged.recommended_action, "high_confidence_review");
        assert_eq!(
            flagged.match_reasons,
            vec!["Same normalized phone", "Same normalized email", "Same identity document"]
        );

        assert!(
            !profile.duplicate_candidates.iter().any(|c| c.guest.id == 985_203),
            "a guest with no matching contact fields must not be flagged even if its name is a partial hit"
        );

        delete_guests(&pool, &ids).await;
    }

    // -----------------------------------------------------------------
    // Guest complimentary credits: grant / update / delete arithmetic
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn guest_credits_grant_update_delete_have_exact_arithmetic() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let guest_id = 985_220;
        let room_type_id = 985_404;
        let actor_id = 985_003;

        delete_guests(&pool, &[guest_id]).await;
        delete_room_types(&pool, &[room_type_id]).await;
        delete_users(&pool, &[actor_id]).await;

        upsert_user(&pool, actor_id, "gst985_credits_actor", "gst985.creditsactor@hotel.local", None).await;
        upsert_guest(&pool, guest_id, "Gst985 Credits Guest", Some("gst985.credits@hotel.local"), None, None).await;
        seed_room_type(&pool, room_type_id, "GST985RT4", "Gst985 Credits Type", "80.00", 2).await;

        let grant1 = add_guest_credits_handler(
            State(pool.clone()),
            Extension(actor_id),
            Json(AddGuestCreditsRequest {
                guest_id,
                room_type_id,
                nights: 5,
                reason: Some("Gst985 initial grant".to_string()),
            }),
        )
        .await
        .expect("grant must succeed")
        .0;
        assert_eq!(grant1["credit"]["nights_available"].as_i64(), Some(5));

        let grant2 = add_guest_credits_handler(
            State(pool.clone()),
            Extension(actor_id),
            Json(AddGuestCreditsRequest {
                guest_id,
                room_type_id,
                nights: 3,
                reason: Some("Gst985 top-up".to_string()),
            }),
        )
        .await
        .expect("second grant must accumulate onto the first")
        .0;
        assert_eq!(grant2["credit"]["nights_available"].as_i64(), Some(8));

        let empty_reason = add_guest_credits_handler(
            State(pool.clone()),
            Extension(actor_id),
            Json(AddGuestCreditsRequest {
                guest_id,
                room_type_id,
                nights: 1,
                reason: Some("   ".to_string()),
            }),
        )
        .await;
        assert!(
            matches!(empty_reason, Err(ApiError::BadRequest(_))),
            "a blank reason must be rejected: {empty_reason:?}"
        );

        let updated = update_guest_credits_handler(
            State(pool.clone()),
            Path((guest_id, room_type_id)),
            Json(UpdateGuestCreditsRequest {
                nights_available: Some(2),
                notes: None,
            }),
        )
        .await
        .expect("update must succeed")
        .0;
        assert_eq!(updated["credit"]["nights_available"].as_i64(), Some(2));

        let negative = update_guest_credits_handler(
            State(pool.clone()),
            Path((guest_id, room_type_id)),
            Json(UpdateGuestCreditsRequest {
                nights_available: Some(-1),
                notes: None,
            }),
        )
        .await;
        assert!(
            matches!(negative, Err(ApiError::BadRequest(_))),
            "negative nights_available must be rejected: {negative:?}"
        );

        let _ = delete_guest_credits_handler(State(pool.clone()), Path((guest_id, room_type_id)))
            .await
            .expect("delete must succeed");

        let remaining: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM guest_complimentary_credits WHERE guest_id = $1 AND room_type_id = $2",
        )
        .bind(guest_id)
        .bind(room_type_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(remaining, 0, "delete must remove the credit row entirely");

        delete_guests(&pool, &[guest_id]).await;
        delete_room_types(&pool, &[room_type_id]).await;
        delete_users(&pool, &[actor_id]).await;
    }

    // -----------------------------------------------------------------
    // Booking with credits: availability exclusion + credit consumption
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn book_with_credits_excludes_conflicting_dates_and_consumes_credit_on_success() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let guest_id = 985_225;
        let room_type_id = 985_401;
        let room_id = 985_301;
        let conflict_booking_id = 985_101;
        let actor_id = 985_004;

        async fn cleanup(pool: &PgPool, guest_id: i64, room_type_id: i64, room_id: i64, actor_id: i64) {
            delete_room_status_log(pool, &[room_id]).await;
            // Deleting the guest cascades away BOTH the fixed conflicting
            // booking and the dynamically-created COMP-* booking (and its
            // credits row / user_guests link).
            delete_guests(pool, &[guest_id]).await;
            delete_rooms(pool, &[room_id]).await;
            delete_room_types(pool, &[room_type_id]).await;
            delete_users(pool, &[actor_id]).await;
        }

        cleanup(&pool, guest_id, room_type_id, room_id, actor_id).await;

        upsert_user(&pool, actor_id, "gst985_bwc_actor", "gst985.bwcactor@hotel.local", None).await;
        upsert_guest(&pool, guest_id, "Gst985 BookWithCredits Guest", Some("gst985.bwc@hotel.local"), None, None).await;
        seed_room_type(&pool, room_type_id, "GST985RT1", "Gst985 BWC Type", "100.00", 2).await;
        seed_room(&pool, room_id, "GST985R1", room_type_id, "available").await;

        // Ownership link grants `can_book_with_credits_for_guest` access
        // without needing RBAC role/permission fixtures.
        sqlx::query("INSERT INTO user_guests (user_id, guest_id) VALUES ($1, $2)")
            .bind(actor_id)
            .bind(guest_id)
            .execute(&pool)
            .await
            .unwrap();

        let _ = add_guest_credits_handler(
            State(pool.clone()),
            Extension(actor_id),
            Json(AddGuestCreditsRequest {
                guest_id,
                room_type_id,
                nights: 2,
                reason: Some("Gst985 test grant".to_string()),
            }),
        )
        .await
        .expect("grant must succeed");

        seed_booking(&pool, conflict_booking_id, guest_id, room_id, "2031-08-10", "2031-08-12", "confirmed").await;

        let conflict_attempt = book_with_credits_handler(
            State(pool.clone()),
            bearer_header_for(actor_id),
            Json(BookWithCreditsRequest {
                guest_id,
                room_id,
                check_in_date: "2031-08-10".to_string(),
                check_out_date: "2031-08-12".to_string(),
                adults: Some(1),
                children: Some(0),
                special_requests: None,
                complimentary_dates: vec!["2031-08-10".to_string(), "2031-08-11".to_string()],
            }),
        )
        .await;
        assert!(
            matches!(conflict_attempt, Err(ApiError::BadRequest(_))),
            "an overlapping active booking on the same room must block availability: {conflict_attempt:?}"
        );

        // Credits must be untouched by the rejected attempt.
        let credits_after_conflict: i32 = sqlx::query_scalar(
            "SELECT nights_available FROM guest_complimentary_credits WHERE guest_id = $1 AND room_type_id = $2",
        )
        .bind(guest_id)
        .bind(room_type_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(credits_after_conflict, 2);

        let success = book_with_credits_handler(
            State(pool.clone()),
            bearer_header_for(actor_id),
            Json(BookWithCreditsRequest {
                guest_id,
                room_id,
                check_in_date: "2031-09-10".to_string(),
                check_out_date: "2031-09-12".to_string(),
                adults: Some(1),
                children: Some(0),
                special_requests: None,
                complimentary_dates: vec!["2031-09-10".to_string(), "2031-09-11".to_string()],
            }),
        )
        .await
        .expect("a non-overlapping fully-complimentary booking must succeed")
        .0;

        assert_eq!(success["complimentary_nights"].as_i64(), Some(2));
        assert_eq!(success["paid_nights"].as_i64(), Some(0));
        assert_eq!(success["is_free_gift"].as_bool(), Some(true));
        let total_amount = Decimal::from_str(success["total_amount"].as_str().unwrap()).unwrap();
        assert_eq!(total_amount, Decimal::ZERO, "fully complimentary stay must bill nothing");

        let remaining_nights: i32 = sqlx::query_scalar(
            "SELECT nights_available FROM guest_complimentary_credits WHERE guest_id = $1 AND room_type_id = $2",
        )
        .bind(guest_id)
        .bind(room_type_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(remaining_nights, 0, "2 granted minus 2 consumed");

        cleanup(&pool, guest_id, room_type_id, room_id, actor_id).await;
    }

    // -----------------------------------------------------------------
    // Rate plans + room rates: CRUD lifecycle
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn rate_plan_and_room_rate_crud_lifecycle() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let room_type_id = 985_402;
        let actor_id = 985_005;
        let code = "gst985rpcrud";

        cleanup_rate_plan_by_code(&pool, code).await;
        delete_room_types(&pool, &[room_type_id]).await;
        delete_users(&pool, &[actor_id]).await;

        upsert_user(&pool, actor_id, "gst985_rates_actor", "gst985.ratesactor@hotel.local", None).await;
        seed_room_type(&pool, room_type_id, "GST985RT2", "Gst985 Rates CRUD Type", "60.00", 2).await;

        // Created through the real service, passing blackout_dates to
        // exercise the jsonb bind that was broken until 2026-07-26.
        let plan_id = create_rate_plan_via_service(
            &pool,
            actor_id,
            code,
            "Gst985 CRUD Plan",
            1,
            Some(vec!["2031-12-24".to_string(), "2031-12-25".to_string()]),
        )
        .await;
        let plan = rate_service::get_rate_plan(&pool, plan_id).await.expect("created plan must be readable");
        assert_eq!(plan.code, code);
        assert!(plan.is_active, "is_active defaults to true when unspecified");
        assert_eq!(plan.priority, 1);

        // RatePlan doesn't expose blackout_dates, so verify the stored jsonb
        // directly: it must round-trip as a JSON array, not TEXT[] or a
        // stringified form.
        let stored_blackouts: serde_json::Value =
            sqlx::query_scalar("SELECT blackout_dates FROM rate_plans WHERE id = $1")
                .bind(plan_id)
                .fetch_one(&pool)
                .await
                .expect("blackout_dates must be readable as jsonb");
        assert_eq!(
            stored_blackouts,
            serde_json::json!(["2031-12-24", "2031-12-25"])
        );

        let with_rates_before = rate_service::get_rate_plan_with_rates(&pool, plan.id).await.unwrap();
        assert!(with_rates_before.rates.is_empty());

        let room_rate = rate_service::create_room_rate(
            &pool,
            actor_id,
            RoomRateInput {
                rate_plan_id: plan.id,
                room_type_id,
                price: 88.50,
                effective_from: "2031-01-01".to_string(),
                effective_to: Some("2031-12-31".to_string()),
            },
        )
        .await
        .expect("room rate create must succeed");
        assert_eq!(room_rate.price, Decimal::from_str("88.50").unwrap());

        let with_rates_after = rate_service::get_rate_plan_with_rates(&pool, plan.id).await.unwrap();
        assert_eq!(with_rates_after.rates.len(), 1);

        let updated_plan = rate_service::update_rate_plan(
            &pool,
            actor_id,
            plan.id,
            RatePlanUpdateInput {
                name: Some("Gst985 CRUD Plan Renamed".to_string()),
                priority: Some(7),
                code: None,
                description: None,
                plan_type: None,
                adjustment_type: None,
                adjustment_value: None,
                valid_from: None,
                valid_to: None,
                applies_monday: None,
                applies_tuesday: None,
                applies_wednesday: None,
                applies_thursday: None,
                applies_friday: None,
                applies_saturday: None,
                applies_sunday: None,
                min_nights: None,
                max_nights: None,
                min_advance_booking: None,
                max_advance_booking: None,
                is_active: None,
            },
        )
        .await
        .expect("rate plan update must succeed");
        assert_eq!(updated_plan.name, "Gst985 CRUD Plan Renamed");
        assert_eq!(updated_plan.priority, 7);

        let updated_room_rate = rate_service::update_room_rate(
            &pool,
            actor_id,
            room_rate.id,
            RoomRateUpdateInput {
                price: Some(95.00),
                effective_from: None,
                effective_to: None,
            },
        )
        .await
        .expect("room rate update must succeed");
        assert_eq!(updated_room_rate.price, Decimal::from_str("95.00").unwrap());

        // Updating with no fields set at all must be rejected.
        let no_op_update = rate_service::update_room_rate(
            &pool,
            actor_id,
            room_rate.id,
            RoomRateUpdateInput {
                price: None,
                effective_from: None,
                effective_to: None,
            },
        )
        .await;
        assert!(matches!(no_op_update, Err(ApiError::BadRequest(_))));

        rate_service::delete_rate_plan(&pool, actor_id, plan.id)
            .await
            .expect("delete must succeed");

        let missing_plan = rate_service::get_rate_plan(&pool, plan.id).await;
        assert!(matches!(missing_plan, Err(ApiError::NotFound(_))));

        let remaining_rates: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM room_rates WHERE rate_plan_id = $1")
            .bind(plan.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(remaining_rates, 0, "deleting the rate plan must cascade its room_rates");

        cleanup_rate_plan_by_code(&pool, code).await;
        delete_room_types(&pool, &[room_type_id]).await;
        delete_users(&pool, &[actor_id]).await;
    }

    // -----------------------------------------------------------------
    // Applicable rate: priority selection + base-price fallback
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn applicable_rate_prefers_higher_priority_plan_and_falls_back_to_base_price() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let room_type_id = 985_405;
        let actor_id = 985_006;
        let low_code = "gst985rplow";
        let high_code = "gst985rphi";

        cleanup_rate_plan_by_code(&pool, low_code).await;
        cleanup_rate_plan_by_code(&pool, high_code).await;
        delete_room_types(&pool, &[room_type_id]).await;
        delete_users(&pool, &[actor_id]).await;

        upsert_user(&pool, actor_id, "gst985_rates_priority_actor", "gst985.ratespriority@hotel.local", None).await;
        seed_room_type(&pool, room_type_id, "GST985RT5", "Gst985 Priority Type", "50.00", 2).await;

        // Created through the real service with blackout_dates: None,
        // covering the SQL-NULL side of the fixed jsonb bind.
        let low_plan_id =
            create_rate_plan_via_service(&pool, actor_id, low_code, "Gst985 Low Priority", 5, None).await;
        let high_plan_id =
            create_rate_plan_via_service(&pool, actor_id, high_code, "Gst985 High Priority", 20, None).await;

        // None must land as SQL NULL, not the jsonb value `null`.
        let stored_blackouts: Option<serde_json::Value> =
            sqlx::query_scalar("SELECT blackout_dates FROM rate_plans WHERE id = $1")
                .bind(low_plan_id)
                .fetch_one(&pool)
                .await
                .expect("blackout_dates must be readable");
        assert_eq!(stored_blackouts, None, "blackout_dates None must store SQL NULL");

        rate_service::create_room_rate(
            &pool,
            actor_id,
            RoomRateInput {
                rate_plan_id: low_plan_id,
                room_type_id,
                price: 150.00,
                effective_from: "2031-05-01".to_string(),
                effective_to: Some("2031-05-31".to_string()),
            },
        )
        .await
        .unwrap();
        rate_service::create_room_rate(
            &pool,
            actor_id,
            RoomRateInput {
                rate_plan_id: high_plan_id,
                room_type_id,
                price: 175.00,
                effective_from: "2031-05-01".to_string(),
                effective_to: Some("2031-05-31".to_string()),
            },
        )
        .await
        .unwrap();

        let in_window = rate_service::applicable_rate(
            &pool,
            ApplicableRateQuery {
                room_type_id,
                date: "2031-05-15".to_string(),
            },
        )
        .await
        .unwrap();
        let matched_price = Decimal::from_str(in_window["price"].as_str().unwrap()).unwrap();
        assert_eq!(matched_price, Decimal::from_str("175.00").unwrap(), "higher-priority plan must win");
        assert_eq!(in_window["rate_plan_code"].as_str(), Some(high_code));
        assert!(
            in_window.get("is_base_rate").is_none(),
            "a matched room rate response has no is_base_rate flag"
        );

        let outside_window = rate_service::applicable_rate(
            &pool,
            ApplicableRateQuery {
                room_type_id,
                date: "2031-06-15".to_string(),
            },
        )
        .await
        .unwrap();
        assert_eq!(outside_window["is_base_rate"].as_bool(), Some(true));
        assert_eq!(outside_window["rate_plan_code"].as_str(), Some("BASE"));
        let fallback_price =
            Decimal::from_str(outside_window["price"].as_str().unwrap()).unwrap();
        assert_eq!(
            fallback_price,
            Decimal::from_str("50.00").unwrap(),
            "base-rate fallback must quote the room type's configured base_price"
        );

        cleanup_rate_plan_by_code(&pool, low_code).await;
        cleanup_rate_plan_by_code(&pool, high_code).await;
        delete_room_types(&pool, &[room_type_id]).await;
        delete_users(&pool, &[actor_id]).await;
    }

    // -----------------------------------------------------------------
    // Loyalty (LIVE stack: modules::loyalty): enroll, accrue, negative guard
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn loyalty_enroll_accrue_and_negative_balance_guard() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let guest_id = 985_205;
        let enrolling_user_id = 985_007;
        let actor_id = 985_008;
        let email = "gst985.loyalty1@hotel.local";

        cleanup_loyalty_fixture(&pool, guest_id, &[enrolling_user_id, actor_id]).await;

        upsert_user(&pool, actor_id, "gst985_loyalty_actor1", "gst985.loyaltyactor1@hotel.local", None).await;
        upsert_guest(&pool, guest_id, "Gst985 Loyalty Member", Some(email), None, None).await;
        // `find_guest_for_user` resolves an unlinked user (guest_id IS NULL)
        // to a guest by matching email, case-insensitively.
        upsert_user(&pool, enrolling_user_id, "gst985_loyalty_user1", email, None).await;

        let enrollment = loyalty_service::enroll(&pool, enrolling_user_id)
            .await
            .expect("enroll must succeed");
        assert_eq!(enrollment.member.guest_id, guest_id);
        assert_eq!(enrollment.member.status, "active");
        assert_eq!(enrollment.member.available_points, 0, "a fresh member has no transactions yet");
        let member_id = enrollment.member.id;

        let repeat_enroll = loyalty_service::enroll(&pool, enrolling_user_id).await;
        assert!(
            matches!(repeat_enroll, Err(ApiError::Conflict(_))),
            "re-enrolling an already-enrolled guest must be rejected: {repeat_enroll:?}"
        );

        let gift = loyalty_service::gift_points(
            &pool,
            actor_id,
            member_id,
            GiftPointsInput {
                points: 500,
                reason: "Gst985 accrual test bonus".to_string(),
            },
        )
        .await
        .expect("gift must succeed");
        assert_eq!(gift.points_delta, 500);
        assert_eq!(gift.balance_after, 500);

        let adjust = loyalty_service::manual_adjustment(
            &pool,
            actor_id,
            member_id,
            ManualAdjustmentInput {
                points_delta: -200,
                reason: "Gst985 redemption points used".to_string(),
                allow_negative_balance: None,
            },
        )
        .await
        .expect("adjustment within balance must succeed");
        assert_eq!(adjust.balance_after, 300);

        let over_redeem = loyalty_service::manual_adjustment(
            &pool,
            actor_id,
            member_id,
            ManualAdjustmentInput {
                points_delta: -100_000,
                reason: "Gst985 over-redemption attempt".to_string(),
                allow_negative_balance: None,
            },
        )
        .await;
        assert!(
            matches!(over_redeem, Err(ApiError::BadRequest(_))),
            "balance must not be allowed to go negative: {over_redeem:?}"
        );

        let detail = loyalty_service::admin_member_detail(&pool, member_id)
            .await
            .expect("read-back must succeed");
        assert_eq!(detail.member.available_points, 300, "the rejected adjustment must not change the balance");

        cleanup_loyalty_fixture(&pool, guest_id, &[enrolling_user_id, actor_id]).await;
    }

    // -----------------------------------------------------------------
    // Loyalty: create reward + redeem deducts points
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn loyalty_create_reward_and_redeem_deducts_points() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let guest_id = 985_206;
        let enrolling_user_id = 985_009;
        let actor_id = 985_010;
        let email = "gst985.loyalty2@hotel.local";
        let reward_name_prefix = "gst985";
        let reward_name = "gst985 test reward";

        cleanup_loyalty_fixture(&pool, guest_id, &[enrolling_user_id, actor_id]).await;
        delete_loyalty_rewards(&pool, reward_name_prefix).await;

        upsert_user(&pool, actor_id, "gst985_loyalty_actor2", "gst985.loyaltyactor2@hotel.local", None).await;
        upsert_guest(&pool, guest_id, "Gst985 Reward Member", Some(email), None, None).await;
        upsert_user(&pool, enrolling_user_id, "gst985_loyalty_user2", email, None).await;

        let enrollment = loyalty_service::enroll(&pool, enrolling_user_id)
            .await
            .expect("enroll must succeed");
        let member_id = enrollment.member.id;

        loyalty_service::gift_points(
            &pool,
            actor_id,
            member_id,
            GiftPointsInput {
                points: 150,
                reason: "Gst985 pre-redemption top-up".to_string(),
            },
        )
        .await
        .expect("gift must succeed");

        let reward = loyalty_service::create_reward(
            &pool,
            RewardInput {
                name: reward_name.to_string(),
                description: None,
                category: "gift".to_string(),
                points_cost: 100,
                minimum_tier_id: None,
                requires_approval: Some(false),
                // is_active: the modules::loyalty repository INSERT wraps this
                // bind in COALESCE($n, true), so None would also store true —
                // Some(true) is explicitness, not a requirement.
                is_active: Some(true),
                inventory_count: None,
                valid_from: None,
                valid_to: None,
                terms_conditions: None,
            },
        )
        .await
        .expect("reward create must succeed");
        assert_eq!(reward.points_cost, 100);
        assert!(reward.is_active);

        // The redemption's pending/approved status depends on the (mutable,
        // globally-configured) redemption_approval_required flag; read it
        // fresh so this assertion holds regardless of current configuration.
        let global_requires_approval: bool =
            sqlx::query_scalar("SELECT redemption_approval_required FROM loyalty_program_rules WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        let expected_status = if global_requires_approval { "pending" } else { "approved" };

        let redemption = loyalty_service::redeem_reward_for_guest(
            &pool,
            guest_id,
            Some(actor_id),
            reward.id,
            RedeemRewardInput {
                booking_id: None,
                notes: None,
            },
        )
        .await
        .expect("redemption must succeed");
        assert_eq!(redemption.points_spent, 100);
        assert_eq!(redemption.status, expected_status);

        let detail = loyalty_service::admin_member_detail(&pool, member_id)
            .await
            .expect("read-back must succeed");
        assert_eq!(detail.member.available_points, 50, "150 granted minus 100 redeemed");

        cleanup_loyalty_fixture(&pool, guest_id, &[enrolling_user_id, actor_id]).await;
        delete_loyalty_rewards(&pool, reward_name_prefix).await;
    }
}
