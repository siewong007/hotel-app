//! Guest Relations workspace integration coverage against a live PostgreSQL
//! database.
//!
//! Patch `0019_guest_relations.sql` put the guest-relations surface
//! (`/api/guests/{id}/interactions|preferences|reviews|loyalty|vouchers|
//! communications|support` plus `POST /api/support/conversations` and the
//! `guests:reveal` gate on sensitive identifiers) behind real SQL for the
//! first time. Because this crate uses runtime-checked `sqlx::query()` (no
//! compile-time macros), every test below exercises the full
//! route -> handler -> service -> repository stack through `oneshot` so
//! column/type mismatches (numeric `overall_rating`, enum `id_type`, `tags`
//! text[], `UNNEST` preference deletes, support SLA projections) surface here
//! rather than in production.
//!
//! Fixture rows use the dedicated `986_xxx` id block (users `986_0xx`,
//! roles `986_1xx`, guests `986_2xx`, room/room-type `986_3xx`, promotion
//! `986_4xx`, bookings `986_5xx`) and every seeded artifact carries a
//! `Grt986`/`grt986` marker so reruns against a persistent dev database are
//! deterministic and never collide with other suites' fixtures. The seeded
//! system roles are too broad for the authz matrix below (receptionist holds
//! `guests:manage`, which would silently pass the private-note checks), so
//! the fixture creates custom roles with exactly the permissions under test,
//! following `tests/rbac_profile.rs`.
//!
//! All tests skip gracefully when `DATABASE_URL` is unset.

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode, header},
};
use chrono::{Duration, Utc};
use hotel_app_be::{AuthService, core, routes};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::net::SocketAddr;
use tower::ServiceExt;

const TEST_JWT_SECRET: &str = "hotel-app-be-guest-relations-test-secret-32chars";

// --- users ---------------------------------------------------------------
const USER_AUTHOR: i64 = 986_001; // guests:read + guests:update (interaction author)
const USER_COLLEAGUE: i64 = 986_002; // guests:read + guests:update (non-author)
const USER_MANAGER: i64 = 986_003; // guests:manage (implies read/update/reveal)
const USER_READER: i64 = 986_004; // guests:read only
const USER_AGENT: i64 = 986_005; // support:read + support:write (no assign)
const USER_LEAD: i64 = 986_006; // support:read + support:write + support:assign
const USER_REVIEWER: i64 = 986_007; // reviews:read + reviews:update
const USER_COMMS: i64 = 986_008; // communications:read
const USER_NOPERM: i64 = 986_009; // no roles at all
const USER_IDS: [i64; 9] = [
    USER_AUTHOR,
    USER_COLLEAGUE,
    USER_MANAGER,
    USER_READER,
    USER_AGENT,
    USER_LEAD,
    USER_REVIEWER,
    USER_COMMS,
    USER_NOPERM,
];

// --- custom fixture roles -------------------------------------------------
const ROLE_EDITOR: i64 = 986_101; // guests:read, guests:update
const ROLE_READER: i64 = 986_102; // guests:read
const ROLE_MANAGER: i64 = 986_103; // guests:manage
const ROLE_AGENT: i64 = 986_104; // support:read, support:write
const ROLE_LEAD: i64 = 986_105; // support:read, support:write, support:assign
const ROLE_REVIEWER: i64 = 986_106; // reviews:read, reviews:update
const ROLE_COMMS: i64 = 986_107; // communications:read

// --- guests ---------------------------------------------------------------
const GUEST_MAIN: i64 = 986_201; // interactions/preferences/reviews/vouchers target
const GUEST_PLAIN: i64 = 986_202; // non-member; vip_status = '' (empty-string filter check)
const GUEST_VIP: i64 = 986_203; // vip_status + tags + id_type (decode + reveal target)
const GUEST_BLACK: i64 = 986_204; // is_blacklisted = true
const GUEST_OPEN_SUPPORT: i64 = 986_205; // waiting_for_staff conversation seeded
const GUEST_CLOSED_SUPPORT: i64 = 986_206; // closed conversation seeded
const GUEST_BOUNCE: i64 = 986_207; // suppressed email + opt-in + subscription + delivery
const GUEST_TIERLESS: i64 = 986_208; // loyalty member on a NULL-code tier
const GUEST_MEMBER: i64 = 986_209; // loyalty member on the seeded silver tier
const GUEST_IDS: [i64; 9] = [
    GUEST_MAIN,
    GUEST_PLAIN,
    GUEST_VIP,
    GUEST_BLACK,
    GUEST_OPEN_SUPPORT,
    GUEST_CLOSED_SUPPORT,
    GUEST_BOUNCE,
    GUEST_TIERLESS,
    GUEST_MEMBER,
];

const ROOM_TYPE_ID: i64 = 986_301;
const ROOM_ID: i64 = 986_302;
const BOOKING_MAIN: i64 = 986_501;
const BOOKING_PLAIN: i64 = 986_502;
const PROMOTION_ID: i64 = 986_401;

const BOUNCE_EMAIL: &str = "grt986.bounce@hotel.local";

struct Fixture {
    pool: PgPool,
    app: Router,
    /// Seeded `guest_reviews.id` for `GUEST_MAIN` (set by `seed_domain_rows`).
    review_id: i64,
    author: String,
    colleague: String,
    manager: String,
    reader: String,
    agent: String,
    lead: String,
    reviewer: String,
    comms: String,
    noperm: String,
    _guard: tokio::sync::OwnedMutexGuard<()>,
}

impl Fixture {
    async fn new() -> Option<Self> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping guest relations tests because DATABASE_URL is not set");
                return None;
            }
        };
        let guard = fixture_lock().lock_owned().await;

        unsafe {
            std::env::set_var("JWT_SECRET", TEST_JWT_SECRET);
        }
        core::config::init_from_env().expect("test app configuration must initialize");
        AuthService::init_jwt_secret(TEST_JWT_SECRET)
            .expect("test JWT secret must satisfy production validation");

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("guest relations test database must connect");

        Self::cleanup(&pool).await;
        Self::seed_users_and_roles(&pool).await;
        Self::seed_guests(&pool).await;
        Self::seed_rooms_and_bookings(&pool).await;
        let review_id = Self::seed_domain_rows(&pool).await;
        core::rbac_cache::invalidate_all();

        let token = |user_id: i64, username: &'static str, role: &'static str| {
            let pool = pool.clone();
            async move {
                format!(
                    "Bearer {}",
                    Self::session_token(&pool, user_id, username, role).await
                )
            }
        };
        let fixture = Self {
            author: token(USER_AUTHOR, "grt986_author", "grt986_editor").await,
            colleague: token(USER_COLLEAGUE, "grt986_colleague", "grt986_editor").await,
            manager: token(USER_MANAGER, "grt986_manager", "grt986_manager").await,
            reader: token(USER_READER, "grt986_reader", "grt986_reader").await,
            agent: token(USER_AGENT, "grt986_agent", "grt986_sup_agent").await,
            lead: token(USER_LEAD, "grt986_lead", "grt986_sup_lead").await,
            reviewer: token(USER_REVIEWER, "grt986_reviewer", "grt986_reviewer").await,
            comms: token(USER_COMMS, "grt986_comms", "grt986_comms").await,
            noperm: token(USER_NOPERM, "grt986_noperm", "grt986_noperm").await,
            app: routes::create_router(pool.clone()),
            pool,
            review_id,
            _guard: guard,
        };
        Some(fixture)
    }

    // ------------------------------------------------------------------
    // Fixture seeding
    // ------------------------------------------------------------------

    async fn upsert_user(pool: &PgPool, id: i64, username: &str) {
        sqlx::query(
            "INSERT INTO users \
             (id, username, email, full_name, user_type, is_active, is_verified, is_locked) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $3, $4, 'staff', true, true, false) \
             ON CONFLICT (id) DO UPDATE SET \
                 username = EXCLUDED.username, email = EXCLUDED.email, \
                 full_name = EXCLUDED.full_name, user_type = 'staff', \
                 is_active = true, is_verified = true, is_locked = false, \
                 deleted_at = NULL",
        )
        .bind(id)
        .bind(username)
        .bind(format!("{username}@hotel.local"))
        .bind(format!("Grt986 {username}"))
        .execute(pool)
        .await
        .expect("user fixture must be inserted");
    }

    async fn upsert_role(pool: &PgPool, id: i64, name: &str, permissions: &[&str]) {
        sqlx::query(
            "INSERT INTO roles (id, name, display_name, description, is_system_role, priority) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $3, 'guest_relations.rs fixture role', false, 10) \
             ON CONFLICT (id) DO UPDATE SET \
                 name = EXCLUDED.name, display_name = EXCLUDED.display_name, \
                 is_system_role = false",
        )
        .bind(id)
        .bind(name)
        .bind(name.replace('_', " "))
        .execute(pool)
        .await
        .expect("role fixture must be inserted");

        // Reset to exactly the permission set under test.
        sqlx::query("DELETE FROM role_permissions WHERE role_id = $1")
            .bind(id)
            .execute(pool)
            .await
            .expect("role permission reset must succeed");
        for permission in permissions {
            let permission_id: i64 =
                sqlx::query_scalar("SELECT id FROM permissions WHERE name = $1")
                    .bind(permission)
                    .fetch_one(pool)
                    .await
                    .unwrap_or_else(|e| panic!("seeded permission '{permission}' must exist: {e}"));
            sqlx::query(
                "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)",
            )
            .bind(id)
            .bind(permission_id)
            .execute(pool)
            .await
            .expect("role permission fixture must be inserted");
        }
    }

    async fn assign_role(pool: &PgPool, user_id: i64, role_id: i64) {
        sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(user_id)
            .bind(role_id)
            .execute(pool)
            .await
            .expect("role assignment must be inserted");
    }

    async fn seed_users_and_roles(pool: &PgPool) {
        for (id, username) in [
            (USER_AUTHOR, "grt986_author"),
            (USER_COLLEAGUE, "grt986_colleague"),
            (USER_MANAGER, "grt986_manager"),
            (USER_READER, "grt986_reader"),
            (USER_AGENT, "grt986_agent"),
            (USER_LEAD, "grt986_lead"),
            (USER_REVIEWER, "grt986_reviewer"),
            (USER_COMMS, "grt986_comms"),
            (USER_NOPERM, "grt986_noperm"),
        ] {
            Self::upsert_user(pool, id, username).await;
        }

        Self::upsert_role(pool, ROLE_EDITOR, "grt986_editor", &["guests:read", "guests:update"])
            .await;
        Self::upsert_role(pool, ROLE_READER, "grt986_reader", &["guests:read"]).await;
        Self::upsert_role(pool, ROLE_MANAGER, "grt986_manager", &["guests:manage"]).await;
        Self::upsert_role(
            pool,
            ROLE_AGENT,
            "grt986_sup_agent",
            &["support:read", "support:write"],
        )
        .await;
        Self::upsert_role(
            pool,
            ROLE_LEAD,
            "grt986_sup_lead",
            &["support:read", "support:write", "support:assign"],
        )
        .await;
        Self::upsert_role(
            pool,
            ROLE_REVIEWER,
            "grt986_reviewer",
            &["reviews:read", "reviews:update"],
        )
        .await;
        Self::upsert_role(pool, ROLE_COMMS, "grt986_comms", &["communications:read"]).await;

        Self::assign_role(pool, USER_AUTHOR, ROLE_EDITOR).await;
        Self::assign_role(pool, USER_COLLEAGUE, ROLE_EDITOR).await;
        Self::assign_role(pool, USER_MANAGER, ROLE_MANAGER).await;
        Self::assign_role(pool, USER_READER, ROLE_READER).await;
        Self::assign_role(pool, USER_AGENT, ROLE_AGENT).await;
        Self::assign_role(pool, USER_LEAD, ROLE_LEAD).await;
        Self::assign_role(pool, USER_REVIEWER, ROLE_REVIEWER).await;
        Self::assign_role(pool, USER_COMMS, ROLE_COMMS).await;
        // USER_NOPERM deliberately gets no role assignment.
    }

    async fn upsert_guest(pool: &PgPool, id: i64, nick_name: &str, email: Option<&str>) {
        sqlx::query(
            "INSERT INTO guests \
             (id, nick_name, first_name, last_name, email, guest_type, tourism_type) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, 'Grt986', $3, $4, 'non_member'::guest_type, 'local'::tourism_type) \
             ON CONFLICT (id) DO UPDATE SET \
                 nick_name = EXCLUDED.nick_name, email = EXCLUDED.email, deleted_at = NULL",
        )
        .bind(id)
        .bind(nick_name)
        .bind(nick_name.rsplit(' ').next().unwrap_or(nick_name))
        .bind(email)
        .execute(pool)
        .await
        .expect("guest fixture must be inserted");
    }

    async fn seed_guests(pool: &PgPool) {
        Self::upsert_guest(pool, GUEST_MAIN, "Grt986 Main", Some("grt986.main@hotel.local")).await;
        // `vip_status = ''` pins the `vip_status <> ''` half of the vip filter.
        Self::upsert_guest(pool, GUEST_PLAIN, "Grt986 Plain", Some("grt986.plain@hotel.local"))
            .await;
        sqlx::query("UPDATE guests SET vip_status = '' WHERE id = $1")
            .bind(GUEST_PLAIN)
            .execute(pool)
            .await
            .unwrap();

        Self::upsert_guest(pool, GUEST_VIP, "Grt986 Vip", Some("grt986.vip@hotel.local")).await;
        sqlx::query(
            "UPDATE guests SET vip_status = 'gold', tags = ARRAY['vip','returning']::text[], \
                 id_type = 'passport'::identificationtype, id_number = 'P123456X', \
                 date_of_birth = '1990-04-12', id_expiry = '2031-01-01', \
                 id_country = 'Malaysia', is_blacklisted = false \
             WHERE id = $1",
        )
        .bind(GUEST_VIP)
        .execute(pool)
        .await
        .unwrap();

        Self::upsert_guest(pool, GUEST_BLACK, "Grt986 Black", None).await;
        sqlx::query(
            "UPDATE guests SET is_blacklisted = true, blacklist_reason = 'chargeback abuse' \
             WHERE id = $1",
        )
        .bind(GUEST_BLACK)
        .execute(pool)
        .await
        .unwrap();

        Self::upsert_guest(pool, GUEST_OPEN_SUPPORT, "Grt986 Opensup", None).await;
        Self::upsert_guest(pool, GUEST_CLOSED_SUPPORT, "Grt986 Closedsup", None).await;

        // BOUNCE carries every communications fixture dimension: opt-in true,
        // contact prefs, a suppressed address, one subscription, one delivery.
        Self::upsert_guest(pool, GUEST_BOUNCE, "Grt986 Bounce", Some(BOUNCE_EMAIL)).await;
        sqlx::query(
            "UPDATE guests SET marketing_opt_in = true, \
                 communication_preference = 'email', language_preference = 'en' \
             WHERE id = $1",
        )
        .bind(GUEST_BOUNCE)
        .execute(pool)
        .await
        .unwrap();

        Self::upsert_guest(pool, GUEST_TIERLESS, "Grt986 Tierless", None).await;
        Self::upsert_guest(pool, GUEST_MEMBER, "Grt986 Member", None).await;

        // GUEST_MAIN: communication prefs populated but marketing_opt_in left
        // NULL so the communications summary exercises the COALESCE-to-false
        // path; email intentionally absent from email_suppressions.
        sqlx::query(
            "UPDATE guests SET communication_preference = 'sms', language_preference = 'ms' \
             WHERE id = $1",
        )
        .bind(GUEST_MAIN)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_rooms_and_bookings(pool: &PgPool) {
        sqlx::query(
            "INSERT INTO room_types \
             (id, code, name, base_price, max_occupancy, keycard_deposit_amount, \
              service_charge_percentage) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'GRT986', 'Grt986 Room Type', 100, 2, 0, 0)",
        )
        .bind(ROOM_TYPE_ID)
        .execute(pool)
        .await
        .expect("room type fixture must be inserted");
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'GRT986-1', $2, 'available')",
        )
        .bind(ROOM_ID)
        .bind(ROOM_TYPE_ID)
        .execute(pool)
        .await
        .expect("room fixture must be inserted");

        // Distinct date ranges — `bookings_no_room_date_overlap` forbids two
        // rows on the same room over the same stay window.
        for (booking_id, guest_id, number, check_in, check_out) in [
            (BOOKING_MAIN, GUEST_MAIN, "BK-GRT986-501", "2030-01-01", "2030-01-02"),
            (BOOKING_PLAIN, GUEST_PLAIN, "BK-GRT986-502", "2030-02-01", "2030-02-02"),
        ] {
            sqlx::query(
                "INSERT INTO bookings \
                 (id, booking_number, guest_id, guest_name, guest_email, room_id, \
                  check_in_date, check_out_date, adults, children, room_rate, subtotal, \
                  total_amount, status, payment_status, created_by, tourism_tax_amount, \
                  extra_bed_charge) \
                 OVERRIDING SYSTEM VALUE \
                 VALUES ($1, $2, $3, 'Grt986 Booking Guest', NULL, $4, $5::date, \
                         $6::date, 1, 0, 100, 100, 100, 'confirmed', 'unpaid', \
                         NULL, 0, 0)",
            )
            .bind(booking_id)
            .bind(number)
            .bind(guest_id)
            .bind(ROOM_ID)
            .bind(check_in)
            .bind(check_out)
            .execute(pool)
            .await
            .expect("booking fixture must be inserted");
        }
    }

    /// Seeds the cross-domain rows the read endpoints project over. Returns
    /// the seeded `guest_reviews.id` so the response test can address it.
    async fn seed_domain_rows(pool: &PgPool) -> i64 {
        // Review on GUEST_MAIN — numeric(3,2) `overall_rating` is the decode
        // hazard this suite exists to pin (`overall_rating::float8` -> f64).
        let review_id: i64 = sqlx::query_scalar(
            "INSERT INTO guest_reviews \
             (guest_id, booking_id, overall_rating, title, content, is_published) \
             VALUES ($1, $2, 4.50, 'Grt986 review', 'Wonderful stay', true) \
             RETURNING id",
        )
        .bind(GUEST_MAIN)
        .bind(BOOKING_MAIN)
        .fetch_one(pool)
        .await
        .expect("review fixture must be inserted");

        // Loyalty member on the seeded silver tier: account balances plus two
        // ledger rows (+400 earned, -60 redeemed-available) so
        // available_points = SUM(available_delta) = 340, and one approved
        // redemption joined to a fixture reward for `recent_redemptions`.
        let silver_tier: i64 =
            sqlx::query_scalar("SELECT id FROM loyalty_tiers WHERE code = 'silver' LIMIT 1")
                .fetch_one(pool)
                .await
                .expect("seeded silver loyalty tier must exist");
        let member_id: i64 = sqlx::query_scalar(
            "INSERT INTO loyalty_members (guest_id, member_number, status) \
             VALUES ($1, 'GRT986-M1', 'active') RETURNING id",
        )
        .bind(GUEST_MEMBER)
        .fetch_one(pool)
        .await
        .expect("loyalty member fixture must be inserted");
        let account_id: i64 = sqlx::query_scalar(
            "INSERT INTO loyalty_accounts \
             (member_id, current_tier_id, lifetime_points, qualifying_points, \
              qualifying_nights, qualifying_spend) \
             VALUES ($1, $2, 1200, 1200, 7, 0) RETURNING id",
        )
        .bind(member_id)
        .bind(silver_tier)
        .fetch_one(pool)
        .await
        .expect("loyalty account fixture must be inserted");
        sqlx::query(
            "INSERT INTO loyalty_transactions \
             (member_id, account_id, transaction_type, points_delta, available_delta, \
              balance_after, description) \
             VALUES ($1, $2, 'earned', 400, 400, 400, 'grt986 earn'), \
                    ($1, $2, 'redeemed', -100, -60, 340, 'grt986 redeem')",
        )
        .bind(member_id)
        .bind(account_id)
        .execute(pool)
        .await
        .expect("loyalty transactions fixture must be inserted");
        let spend_txn: i64 = sqlx::query_scalar(
            "SELECT id FROM loyalty_transactions \
             WHERE member_id = $1 AND transaction_type = 'redeemed' LIMIT 1",
        )
        .bind(member_id)
        .fetch_one(pool)
        .await
        .unwrap();
        let reward_id: i64 = sqlx::query_scalar(
            "INSERT INTO loyalty_rewards (name, category, points_cost) \
             VALUES ('Grt986 Reward', 'fixture', 100) RETURNING id",
        )
        .fetch_one(pool)
        .await
        .expect("loyalty reward fixture must be inserted");
        sqlx::query(
            "INSERT INTO loyalty_redemptions \
             (member_id, reward_id, transaction_id, points_spent, status, reviewed_at) \
             VALUES ($1, $2, $3, 100, 'approved', CURRENT_TIMESTAMP)",
        )
        .bind(member_id)
        .bind(reward_id)
        .bind(spend_txn)
        .execute(pool)
        .await
        .expect("loyalty redemption fixture must be inserted");

        // Loyalty member on a tier whose `code` is NULL — the summary mapper
        // must fall back to "" rather than fail the row decode.
        let tierless_tier: i64 = sqlx::query_scalar(
            "INSERT INTO loyalty_tiers (program_id, name, code, min_points, sort_order, is_active) \
             VALUES (1, 'Grt986 Tierless', NULL, 0, 99, true) RETURNING id",
        )
        .fetch_one(pool)
        .await
        .expect("null-code tier fixture must be inserted");
        let tierless_member: i64 = sqlx::query_scalar(
            "INSERT INTO loyalty_members (guest_id, member_number, status) \
             VALUES ($1, 'GRT986-M2', 'active') RETURNING id",
        )
        .bind(GUEST_TIERLESS)
        .fetch_one(pool)
        .await
        .expect("tierless loyalty member fixture must be inserted");
        sqlx::query(
            "INSERT INTO loyalty_accounts (member_id, current_tier_id) VALUES ($1, $2)",
        )
        .bind(tierless_member)
        .bind(tierless_tier)
        .execute(pool)
        .await
        .expect("tierless loyalty account fixture must be inserted");

        // Promotion + voucher join fixture.
        sqlx::query(
            "INSERT INTO promotions \
             (id, slug, name, status, promotion_kind, discount_type, discount_value) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'grt986-promo', 'Grt986 Promo', 'published', 'voucher', \
                     'percentage', 10)",
        )
        .bind(PROMOTION_ID)
        .execute(pool)
        .await
        .expect("promotion fixture must be inserted");
        sqlx::query(
            "INSERT INTO vouchers (promotion_id, guest_id, code, status, source, expires_at) \
             VALUES ($1, $2, 'GRT986-VC1', 'available', 'admin_issue', \
                     CURRENT_TIMESTAMP + INTERVAL '30 days')",
        )
        .bind(PROMOTION_ID)
        .bind(GUEST_MAIN)
        .execute(pool)
        .await
        .expect("voucher fixture must be inserted");

        // Communications fixtures on GUEST_BOUNCE.
        sqlx::query(
            "INSERT INTO email_suppressions (email, reason, source) \
             VALUES ($1, 'bounce', 'grt986-fixture')",
        )
        .bind(BOUNCE_EMAIL)
        .execute(pool)
        .await
        .expect("suppression fixture must be inserted");
        sqlx::query(
            "INSERT INTO notification_subscriptions \
             (guest_id, channel, topic, subscribed, source) \
             VALUES ($1, 'email', 'promotion', true, 'grt986-fixture')",
        )
        .bind(GUEST_BOUNCE)
        .execute(pool)
        .await
        .expect("subscription fixture must be inserted");
        sqlx::query(
            "INSERT INTO email_deliveries \
             (kind, guest_id, topic, recipient_email, subject, body_html, status, \
              idempotency_key) \
             VALUES ('booking_confirmation', $1, 'booking_confirmation', $2, \
                     'Grt986 booking confirmation', '<p>hi</p>', 'sent', \
                     'grt986-delivery-1')",
        )
        .bind(GUEST_BOUNCE)
        .bind(BOUNCE_EMAIL)
        .execute(pool)
        .await
        .expect("delivery fixture must be inserted");

        // Support conversations backing the guest-filtered list and the
        // has_open_support guest-list filter.
        for (guest_id, number, status) in [
            (GUEST_OPEN_SUPPORT, "SUP-GRT986-OPEN", "waiting_for_staff"),
            (GUEST_CLOSED_SUPPORT, "SUP-GRT986-CLOSED", "closed"),
        ] {
            sqlx::query(
                "INSERT INTO support_conversations \
                 (conversation_number, guest_id, subject, category, status, closed_at) \
                 VALUES ($2, $1, 'Grt986 seeded case', 'complaint', $3, \
                         CASE WHEN $3 = 'closed' THEN CURRENT_TIMESTAMP ELSE NULL END)",
            )
            .bind(guest_id)
            .bind(number)
            .bind(status)
            .execute(pool)
            .await
            .expect("support conversation fixture must be inserted");
        }

        review_id
    }

    async fn session_token(pool: &PgPool, user_id: i64, username: &str, role_name: &str) -> String {
        let refresh_token = AuthService::generate_refresh_token();
        let session_id = AuthService::store_refresh_token(
            pool,
            user_id,
            &refresh_token,
            1,
            Some("127.0.0.1"),
            Some("guest-relations-test"),
            Some("Asia/Kuala_Lumpur"),
        )
        .await
        .expect("active session fixture must be inserted");
        AuthService::generate_session_jwt(
            user_id,
            username.to_string(),
            vec![role_name.to_string()],
            session_id,
        )
        .expect("test access token must encode")
    }

    // ------------------------------------------------------------------
    // Cleanup — every artifact this file can create, children first.
    // `support_conversations.guest_id` and `vouchers.guest_id` are
    // RESTRICTed, and `guest_notes.created_by`/`guest_reviews.response_by`
    // reference users without cascade, so the guest rows must go before the
    // users and after the restricted children.
    // ------------------------------------------------------------------
    async fn cleanup(pool: &PgPool) {
        // Every statement here is keyed to the 986_xxx fixture block, so a
        // crashed prior run cannot leak rows into this one. `audit_logs` is
        // append-only (a trigger forbids DELETE); its `user_id` is SET NULL
        // when the fixture users go, which is the most cleanup it allows.
        let guest_scoped: &[&str] = &[
            "DELETE FROM vouchers WHERE guest_id = ANY($1)",
            "DELETE FROM support_conversations WHERE guest_id = ANY($1) \
                 OR conversation_number LIKE 'SUP-GRT986-%'",
            "DELETE FROM email_deliveries WHERE guest_id = ANY($1) \
                 OR idempotency_key LIKE 'grt986-%'",
            "DELETE FROM notification_subscriptions WHERE guest_id = ANY($1)",
            "DELETE FROM guest_reviews WHERE guest_id = ANY($1)",
            "DELETE FROM guest_notes WHERE guest_id = ANY($1)",
            "DELETE FROM guest_preferences WHERE guest_id = ANY($1)",
            "DELETE FROM loyalty_redemptions WHERE member_id IN \
                 (SELECT id FROM loyalty_members WHERE guest_id = ANY($1))",
            "DELETE FROM loyalty_transactions WHERE member_id IN \
                 (SELECT id FROM loyalty_members WHERE guest_id = ANY($1))",
            "DELETE FROM loyalty_accounts WHERE member_id IN \
                 (SELECT id FROM loyalty_members WHERE guest_id = ANY($1))",
            "DELETE FROM loyalty_members WHERE guest_id = ANY($1)",
            "DELETE FROM booking_history WHERE booking_id IN \
                 (SELECT id FROM bookings WHERE guest_id = ANY($1) \
                  OR booking_number LIKE 'BK-GRT986-%')",
            "DELETE FROM payments WHERE booking_id IN \
                 (SELECT id FROM bookings WHERE guest_id = ANY($1) \
                  OR booking_number LIKE 'BK-GRT986-%')",
            "DELETE FROM bookings WHERE guest_id = ANY($1) OR booking_number LIKE 'BK-GRT986-%'",
            "DELETE FROM guests WHERE id = ANY($1)",
        ];
        for sql in guest_scoped {
            sqlx::query(sqlx::AssertSqlSafe(*sql))
                .bind(&GUEST_IDS[..])
                .execute(pool)
                .await
                .unwrap_or_else(|e| panic!("guest relations cleanup failed for `{sql}`: {e}"));
        }

        sqlx::query("DELETE FROM email_suppressions WHERE email LIKE 'grt986.%'")
            .execute(pool)
            .await
            .expect("suppression cleanup");
        sqlx::query("DELETE FROM loyalty_rewards WHERE name = 'Grt986 Reward'")
            .execute(pool)
            .await
            .expect("reward cleanup");
        sqlx::query("DELETE FROM loyalty_tiers WHERE name = 'Grt986 Tierless'")
            .execute(pool)
            .await
            .expect("tier cleanup");
        sqlx::query("DELETE FROM promotions WHERE id = $1 OR slug = 'grt986-promo'")
            .bind(PROMOTION_ID)
            .execute(pool)
            .await
            .expect("promotion cleanup");
        sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
            .bind(ROOM_ID)
            .execute(pool)
            .await
            .expect("room status log cleanup");
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(ROOM_ID)
            .execute(pool)
            .await
            .expect("room cleanup");
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(ROOM_TYPE_ID)
            .execute(pool)
            .await
            .expect("room type cleanup");

        // Fixture users and roles are PERSISTENT: `audit_logs.user_id` has an
        // ON DELETE SET NULL action, and the append-only trigger on
        // audit_logs forbids that UPDATE, so any user who has written an audit
        // row can never be deleted. The upserts in `seed_users_and_roles`
        // (plus the role_permissions reset in `upsert_role`) keep reruns
        // deterministic; only the per-run refresh tokens are trimmed.
        sqlx::query("DELETE FROM refresh_tokens WHERE user_id = ANY($1)")
            .bind(&USER_IDS[..])
            .execute(pool)
            .await
            .expect("refresh token cleanup");
    }

    // ------------------------------------------------------------------
    // HTTP helpers — ConnectInfo is injected because support handlers
    // extract it (production attaches it via
    // into_make_service_with_connect_info).
    // ------------------------------------------------------------------
    async fn call(
        &self,
        method: &str,
        uri: &str,
        authorization: Option<&str>,
        payload: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(value) = authorization {
            builder = builder.header(header::AUTHORIZATION, value);
        }
        if payload.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        let body = payload
            .map(|value| Body::from(value.to_string()))
            .unwrap_or_else(Body::empty);
        let mut request = builder.body(body).expect("HTTP request must build");
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40_000))));
        let response = self
            .app
            .clone()
            .oneshot(request)
            .await
            .expect("router response must complete");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body must be readable");
        let text = String::from_utf8(bytes.to_vec()).expect("body UTF-8");
        let value = serde_json::from_str(&text).unwrap_or(Value::String(text));
        (status, value)
    }

    fn guest_uri(&self, guest_id: i64, suffix: &str) -> String {
        format!("/api/guests/{guest_id}{suffix}")
    }
}

fn fixture_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

/// Extracts `data.id` values from the paged interactions envelope.
fn interaction_ids(body: &Value) -> Vec<i64> {
    body["data"]
        .as_array()
        .map(|rows| rows.iter().filter_map(|row| row["id"].as_i64()).collect())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// 1. Interactions CRUD through the full HTTP stack
// ---------------------------------------------------------------------------
#[tokio::test]
async fn interactions_crud_lifecycle() {
    let Some(fx) = Fixture::new().await else {
        return;
    };
    let base = fx.guest_uri(GUEST_MAIN, "/interactions");

    // Create — every column of the insert is asserted back out of the row.
    let (status, created) = fx
        .call(
            "POST",
            &base,
            Some(&fx.author),
            Some(json!({
                "interaction_type": "call",
                "subject": "Welcome call",
                "content": "Called to confirm arrival time",
                "booking_id": BOOKING_MAIN,
                "is_alert": true,
                "assigned_to": USER_COLLEAGUE,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "create interaction failed: {created}");
    let note_id = created["id"].as_i64().expect("interaction id must serialize");
    assert_eq!(created["guest_id"].as_i64(), Some(GUEST_MAIN));
    assert_eq!(created["interaction_type"], "call");
    assert_eq!(created["subject"], "Welcome call");
    assert_eq!(created["content"], "Called to confirm arrival time");
    assert_eq!(created["booking_id"].as_i64(), Some(BOOKING_MAIN));
    assert_eq!(created["is_alert"], true);
    assert_eq!(created["is_private"], false);
    assert_eq!(created["created_by"].as_i64(), Some(USER_AUTHOR));
    assert_eq!(created["created_by_name"], "Grt986 grt986_author");
    assert_eq!(created["assigned_to"].as_i64(), Some(USER_COLLEAGUE));
    assert_eq!(created["assigned_to_name"], "Grt986 grt986_colleague");
    assert!(created["follow_up_at"].is_null());
    assert!(created["follow_up_completed_at"].is_null());
    assert!(created["created_at"].is_string() && created["updated_at"].is_string());

    // List — a guests:read-only viewer sees the public row inside the paged
    // envelope, proving list_interactions' joins and pagination decode.
    let (status, listed) = fx.call("GET", &base, Some(&fx.reader), None).await;
    assert_eq!(status, StatusCode::OK, "list interactions failed: {listed}");
    assert_eq!(listed["total"].as_i64(), Some(1));
    assert!(interaction_ids(&listed).contains(&note_id));

    // Patch — merge semantics: untouched fields survive, `subject`/`is_alert`
    // change, and `updated_at` is restamped by the repository.
    let (status, updated) = fx
        .call(
            "PATCH",
            &format!("{base}/{note_id}"),
            Some(&fx.author),
            Some(json!({
                "subject": "Updated subject",
                "content": "Called again, left voicemail",
                "is_alert": false,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "update interaction failed: {updated}");
    assert_eq!(updated["subject"], "Updated subject");
    assert_eq!(updated["content"], "Called again, left voicemail");
    assert_eq!(updated["is_alert"], false);
    assert_eq!(updated["interaction_type"], "call", "unpatched fields must persist");
    assert_eq!(updated["assigned_to"].as_i64(), Some(USER_COLLEAGUE));

    // Delete — hard delete; the row is gone from the list and 404s on fetch.
    let (status, deleted) = fx
        .call("DELETE", &format!("{base}/{note_id}"), Some(&fx.author), None)
        .await;
    assert_eq!(status, StatusCode::OK, "delete interaction failed: {deleted}");
    assert_eq!(deleted["success"], true);

    let (_, listed) = fx.call("GET", &base, Some(&fx.reader), None).await;
    assert_eq!(listed["total"].as_i64(), Some(0));
    let (status, gone) = fx
        .call(
            "PATCH",
            &format!("{base}/{note_id}"),
            Some(&fx.author),
            Some(json!({"subject": "post-delete"})),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "deleted note must 404: {gone}");

    // A booking link that belongs to another guest is rejected.
    let (status, bad_link) = fx
        .call(
            "POST",
            &base,
            Some(&fx.author),
            Some(json!({"content": "wrong booking", "booking_id": BOOKING_PLAIN})),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "cross-guest booking link: {bad_link}");

    // Unknown guests 404 and the permission gate is live on both verbs.
    let missing = fx.guest_uri(999_999_999, "/interactions");
    let (status, _) = fx.call("GET", &missing, Some(&fx.reader), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, denied) = fx.call("GET", &base, Some(&fx.noperm), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "guests:read gate broken: {denied}");
    let (status, denied) = fx
        .call(
            "POST",
            &base,
            Some(&fx.reader),
            Some(json!({"content": "reader cannot write"})),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "guests:update gate broken: {denied}");
}

// ---------------------------------------------------------------------------
// 2. Interaction-type vocabulary: allowlist + normalization
// ---------------------------------------------------------------------------
#[tokio::test]
async fn interaction_type_validation_accepts_allowed_and_rejects_unknown() {
    let Some(fx) = Fixture::new().await else {
        return;
    };
    let base = fx.guest_uri(GUEST_MAIN, "/interactions");

    let (status, rejected) = fx
        .call(
            "POST",
            &base,
            Some(&fx.author),
            Some(json!({"interaction_type": "sms", "content": "not a real type"})),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "unsupported interaction type must 400 before hitting the CHECK: {rejected}"
    );

    for interaction_type in ["note", "call", "email", "in_person", "follow_up"] {
        let (status, created) = fx
            .call(
                "POST",
                &base,
                Some(&fx.author),
                Some(json!({"interaction_type": interaction_type, "content": "typed note"})),
            )
            .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "valid type '{interaction_type}' must be accepted: {created}"
        );
        assert_eq!(created["interaction_type"], interaction_type);
    }

    // Space/hyphen/case normalization lands on the canonical label.
    let (status, normalized) = fx
        .call(
            "POST",
            &base,
            Some(&fx.author),
            Some(json!({"interaction_type": "In Person", "content": "front desk chat"})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "normalization failed: {normalized}");
    assert_eq!(normalized["interaction_type"], "in_person");
    let normalized_id = normalized["id"].as_i64().unwrap();

    let (status, hyphenated) = fx
        .call(
            "POST",
            &base,
            Some(&fx.author),
            Some(json!({"interaction_type": "follow-up", "content": "call them back"})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "hyphen normalization failed: {hyphenated}");
    assert_eq!(hyphenated["interaction_type"], "follow_up");

    // The same allowlist guards PATCH.
    let (status, bad_patch) = fx
        .call(
            "PATCH",
            &format!("{base}/{normalized_id}"),
            Some(&fx.author),
            Some(json!({"interaction_type": "carrier_pigeon"})),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "invalid patch type: {bad_patch}");
    let (status, good_patch) = fx
        .call(
            "PATCH",
            &format!("{base}/{normalized_id}"),
            Some(&fx.author),
            Some(json!({"interaction_type": "EMAIL"})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "patch normalization failed: {good_patch}");
    assert_eq!(good_patch["interaction_type"], "email");

    // Omitted type falls back to the `note` column vocabulary.
    let (status, defaulted) = fx
        .call(
            "POST",
            &base,
            Some(&fx.author),
            Some(json!({"content": "untyped note"})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "default type failed: {defaulted}");
    assert_eq!(defaulted["interaction_type"], "note");
}

// ---------------------------------------------------------------------------
// 3. Private-interaction visibility and mutation authorization
// ---------------------------------------------------------------------------
#[tokio::test]
async fn private_interaction_visibility_requires_author_or_manage() {
    let Some(fx) = Fixture::new().await else {
        return;
    };
    let base = fx.guest_uri(GUEST_MAIN, "/interactions");

    let (status, private) = fx
        .call(
            "POST",
            &base,
            Some(&fx.author),
            Some(json!({
                "interaction_type": "note",
                "content": "Sensitive staff-only remark",
                "is_private": true,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "private create failed: {private}");
    let note_id = private["id"].as_i64().unwrap();
    assert_eq!(private["is_private"], true);

    // Also seed a public note so the list is non-trivially filtered.
    fx.call(
        "POST",
        &base,
        Some(&fx.author),
        Some(json!({"content": "Public remark"})),
    )
    .await;

    // Author sees both rows.
    let (status, author_list) = fx.call("GET", &base, Some(&fx.author), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        author_list["total"].as_i64(),
        Some(2),
        "author must see private + public rows"
    );
    assert!(interaction_ids(&author_list).contains(&note_id));

    // Another guests:update staff member sees only the public row and is
    // denied on mutation of the private one (403, not a misleading 404).
    let (_, colleague_list) = fx.call("GET", &base, Some(&fx.colleague), None).await;
    assert_eq!(
        colleague_list["total"].as_i64(),
        Some(1),
        "non-author must not see the private row: {colleague_list}"
    );
    assert!(!interaction_ids(&colleague_list).contains(&note_id));

    let (status, denied_patch) = fx
        .call(
            "PATCH",
            &format!("{base}/{note_id}"),
            Some(&fx.colleague),
            Some(json!({"content": "colleague overwrite"})),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "colleague patch: {denied_patch}");
    let (status, denied_delete) = fx
        .call("DELETE", &format!("{base}/{note_id}"), Some(&fx.colleague), None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "colleague delete: {denied_delete}");

    // A guests:read-only viewer is filtered the same way.
    let (_, reader_list) = fx.call("GET", &base, Some(&fx.reader), None).await;
    assert_eq!(reader_list["total"].as_i64(), Some(1));
    assert!(!interaction_ids(&reader_list).contains(&note_id));

    // guests:manage sees and can mutate the private row.
    let (_, manager_list) = fx.call("GET", &base, Some(&fx.manager), None).await;
    assert_eq!(manager_list["total"].as_i64(), Some(2));
    assert!(interaction_ids(&manager_list).contains(&note_id));

    let (status, managed) = fx
        .call(
            "PATCH",
            &format!("{base}/{note_id}"),
            Some(&fx.manager),
            Some(json!({"subject": "Manager reviewed"})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "manager patch failed: {managed}");
    assert_eq!(managed["subject"], "Manager reviewed");
}

// ---------------------------------------------------------------------------
// 4. Follow-up lifecycle: schedule, stamp-once completion, reopen, filtering
// ---------------------------------------------------------------------------
#[tokio::test]
async fn follow_up_completion_stamps_clears_and_filters() {
    let Some(fx) = Fixture::new().await else {
        return;
    };
    let base = fx.guest_uri(GUEST_MAIN, "/interactions");
    let follow_up_at = (Utc::now() + Duration::days(3)).to_rfc3339();

    let (status, created) = fx
        .call(
            "POST",
            &base,
            Some(&fx.author),
            Some(json!({
                "interaction_type": "follow_up",
                "content": "Verify the minibar charge dispute",
                "follow_up_at": follow_up_at,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "follow-up create failed: {created}");
    let note_id = created["id"].as_i64().unwrap();
    assert!(created["follow_up_at"].is_string(), "follow_up_at must round-trip");
    assert!(created["follow_up_completed_at"].is_null());

    // Open follow-ups are always visible, even with completed rows hidden.
    let (_, listed) = fx.call("GET", &base, Some(&fx.author), None).await;
    assert!(interaction_ids(&listed).contains(&note_id));

    // Complete it — stamps `follow_up_completed_at`.
    let (status, completed) = fx
        .call(
            "PATCH",
            &format!("{base}/{note_id}"),
            Some(&fx.author),
            Some(json!({"follow_up_completed": true})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "complete failed: {completed}");
    let stamped = completed["follow_up_completed_at"].clone();
    assert!(stamped.is_string(), "completion must stamp a timestamp");

    // Completed follow-ups drop out of the default list …
    let (_, hidden) = fx.call("GET", &base, Some(&fx.author), None).await;
    assert!(
        !interaction_ids(&hidden).contains(&note_id),
        "completed follow-up must be hidden by default: {hidden}"
    );
    // … and reappear under include_completed_followups=true.
    let (_, included) = fx
        .call(
            "GET",
            &format!("{base}?include_completed_followups=true"),
            Some(&fx.author),
            None,
        )
        .await;
    assert!(
        interaction_ids(&included).contains(&note_id),
        "include_completed_followups must surface the row: {included}"
    );

    // Completing again keeps the original stamp (stamps once).
    let (_, completed_again) = fx
        .call(
            "PATCH",
            &format!("{base}/{note_id}"),
            Some(&fx.author),
            Some(json!({"follow_up_completed": true})),
        )
        .await;
    assert_eq!(
        completed_again["follow_up_completed_at"], stamped,
        "re-completing must preserve the original timestamp"
    );

    // Reopen — `false` clears the stamp and returns the row to the open list.
    let (status, reopened) = fx
        .call(
            "PATCH",
            &format!("{base}/{note_id}"),
            Some(&fx.author),
            Some(json!({"follow_up_completed": false})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "reopen failed: {reopened}");
    assert!(reopened["follow_up_completed_at"].is_null());

    let (_, open_again) = fx.call("GET", &base, Some(&fx.author), None).await;
    assert!(interaction_ids(&open_again).contains(&note_id));
}

// ---------------------------------------------------------------------------
// 5. Preferences: upsert conflict path + replace_categories delete
// ---------------------------------------------------------------------------
#[tokio::test]
async fn preferences_upsert_and_replace_categories() {
    let Some(fx) = Fixture::new().await else {
        return;
    };
    let uri = fx.guest_uri(GUEST_MAIN, "/preferences");

    let (status, put) = fx
        .call(
            "PUT",
            &uri,
            Some(&fx.author),
            Some(json!({
                "entries": [
                    {"category": "room", "preference_key": "pillow", "preference_value": "soft"},
                    {"category": "room", "preference_key": "view", "preference_value": "high floor"},
                    {"category": "dietary", "preference_key": "allergy", "preference_value": "nuts"},
                ]
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "preferences PUT failed: {put}");
    assert_eq!(put.as_array().map(Vec::len), Some(3));

    // Upsert the existing key and add a new one, replacing only `room` —
    // `view` must be deleted, `dietary/allergy` must survive, and the whole
    // batch rides one transaction through upsert + UNNEST delete.
    let (status, replaced) = fx
        .call(
            "PUT",
            &uri,
            Some(&fx.author),
            Some(json!({
                "entries": [
                    {"category": "room", "preference_key": "pillow", "preference_value": "firm"},
                    {"category": "occasion", "preference_key": "anniversary", "preference_value": "flowers"},
                ],
                "replace_categories": ["room"]
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "replace PUT failed: {replaced}");

    let (status, listed) = fx.call("GET", &uri, Some(&fx.reader), None).await;
    assert_eq!(status, StatusCode::OK, "preferences list failed: {listed}");
    let rows = listed.as_array().expect("preferences must serialize as an array");
    let find = |category: &str, key: &str| {
        rows.iter()
            .find(|row| row["category"] == category && row["preference_key"] == key)
            .cloned()
    };
    assert_eq!(find("room", "pillow").unwrap()["preference_value"], "firm");
    assert!(
        find("room", "view").is_none(),
        "absent key in a replaced category must be deleted: {listed}"
    );
    assert_eq!(find("dietary", "allergy").unwrap()["preference_value"], "nuts");
    assert_eq!(find("occasion", "anniversary").unwrap()["preference_value"], "flowers");
    assert!(rows.iter().all(|row| row["updated_at"].is_string()));

    // Category allowlist is enforced at the API boundary.
    let (status, bad_category) = fx
        .call(
            "PUT",
            &uri,
            Some(&fx.author),
            Some(json!({
                "entries": [{"category": "minibar", "preference_key": "x", "preference_value": "y"}]
            })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "invalid category: {bad_category}");
}

// ---------------------------------------------------------------------------
// 6. Reviews: numeric rating decode + staff response write
// ---------------------------------------------------------------------------
#[tokio::test]
async fn reviews_list_decode_and_staff_response() {
    let Some(fx) = Fixture::new().await else {
        return;
    };
    let uri = fx.guest_uri(GUEST_MAIN, "/reviews");

    let (status, listed) = fx.call("GET", &uri, Some(&fx.reviewer), None).await;
    assert_eq!(status, StatusCode::OK, "reviews list failed: {listed}");
    let rows = listed.as_array().unwrap();
    let review = rows
        .iter()
        .find(|row| row["id"].as_i64() == Some(fx.review_id))
        .expect("seeded review must be listed");
    // `overall_rating` is numeric(3,2) — the ::float8 cast must decode to f64.
    assert_eq!(review["overall_rating"].as_f64(), Some(4.5));
    assert_eq!(review["title"], "Grt986 review");
    assert_eq!(review["is_published"], true);
    assert!(review["response"].is_null() && review["response_at"].is_null());

    // The route-level gate: reviews:read and reviews:update are separate.
    let (status, denied) = fx.call("GET", &uri, Some(&fx.noperm), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "reviews:read gate broken: {denied}");

    let response_uri = format!("{}/{}/response", uri, fx.review_id);
    let (status, denied) = fx
        .call(
            "POST",
            &response_uri,
            Some(&fx.noperm),
            Some(json!({"response": "nope"})),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "reviews:update gate broken: {denied}");

    let (status, responded) = fx
        .call(
            "POST",
            &response_uri,
            Some(&fx.reviewer),
            Some(json!({"response": "Thank you for staying with us"})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "review response failed: {responded}");
    assert_eq!(responded["response"], "Thank you for staying with us");
    assert!(responded["response_at"].is_string(), "response_at must be stamped");
    assert_eq!(responded["overall_rating"].as_f64(), Some(4.5));

    // `response_by` persists the staff member who wrote it.
    let responder: i64 =
        sqlx::query_scalar("SELECT response_by FROM guest_reviews WHERE id = $1")
            .bind(fx.review_id)
            .fetch_one(&fx.pool)
            .await
            .expect("review row must still exist");
    assert_eq!(responder, USER_REVIEWER);

    // Responses for another guest's review 404 (scoped to guest_id).
    let wrong_guest = fx.guest_uri(GUEST_PLAIN, "/reviews");
    let (status, not_found) = fx
        .call(
            "POST",
            &format!("{}/{}/response", wrong_guest, fx.review_id),
            Some(&fx.reviewer),
            Some(json!({"response": "cross-guest"})),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "cross-guest review: {not_found}");
}

// ---------------------------------------------------------------------------
// 7. Loyalty summary: member + NULL-code tier + non-member
// ---------------------------------------------------------------------------
#[tokio::test]
async fn loyalty_summary_member_nullable_tier_and_non_member() {
    let Some(fx) = Fixture::new().await else {
        return;
    };

    let (status, member) = fx
        .call(
            "GET",
            &fx.guest_uri(GUEST_MEMBER, "/loyalty"),
            Some(&fx.reader),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "loyalty summary failed: {member}");
    assert_eq!(member["member_number"], "GRT986-M1");
    assert_eq!(member["status"], "active");
    assert_eq!(member["tier_code"], "silver");
    assert_eq!(member["tier_name"], "Silver");
    assert_eq!(member["available_points"].as_i64(), Some(340));
    assert_eq!(member["lifetime_points"].as_i64(), Some(1200));
    assert_eq!(member["qualifying_nights"].as_i64(), Some(7));
    let redemptions = member["recent_redemptions"].as_array().unwrap();
    assert_eq!(redemptions.len(), 1, "seeded redemption must appear: {member}");
    assert_eq!(redemptions[0]["reward_name"], "Grt986 Reward");
    assert_eq!(redemptions[0]["points"].as_i64(), Some(100));
    assert_eq!(redemptions[0]["status"], "approved");

    // NULL-code tier: the row must decode with "" rather than fail.
    let (status, tierless) = fx
        .call(
            "GET",
            &fx.guest_uri(GUEST_TIERLESS, "/loyalty"),
            Some(&fx.reader),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "tierless member failed: {tierless}");
    assert_eq!(tierless["member_number"], "GRT986-M2");
    assert_eq!(tierless["tier_code"], "", "NULL tier code must coalesce to empty");
    assert_eq!(tierless["tier_name"], "Grt986 Tierless");
    assert_eq!(tierless["available_points"].as_i64(), Some(0));

    // Non-member: 200 with a JSON null body, not a 404.
    let (status, none) = fx
        .call(
            "GET",
            &fx.guest_uri(GUEST_PLAIN, "/loyalty"),
            Some(&fx.reader),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "non-member loyalty failed: {none}");
    assert!(none.is_null(), "non-member must serialize as null: {none}");
}

// ---------------------------------------------------------------------------
// 8. Vouchers: list shape including the promotions join
// ---------------------------------------------------------------------------
#[tokio::test]
async fn vouchers_list_includes_promotion_join() {
    let Some(fx) = Fixture::new().await else {
        return;
    };

    let (status, listed) = fx
        .call(
            "GET",
            &fx.guest_uri(GUEST_MAIN, "/vouchers"),
            Some(&fx.reader),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "vouchers list failed: {listed}");
    let rows = listed.as_array().unwrap();
    let voucher = rows
        .iter()
        .find(|row| row["code"] == "GRT986-VC1")
        .expect("seeded voucher must be listed");
    assert_eq!(voucher["status"], "available");
    assert_eq!(voucher["source"], "admin_issue");
    assert_eq!(voucher["promotion_id"].as_i64(), Some(PROMOTION_ID));
    assert_eq!(voucher["promotion_name"], "Grt986 Promo");
    assert_eq!(voucher["promotion_slug"], "grt986-promo");
    assert!(voucher["expires_at"].is_string());
    assert!(voucher["redeemed_at"].is_null());

    let (status, empty) = fx
        .call(
            "GET",
            &fx.guest_uri(GUEST_PLAIN, "/vouchers"),
            Some(&fx.reader),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(empty.as_array().map(Vec::len), Some(0));
}

// ---------------------------------------------------------------------------
// 9. Communications: subscriptions, suppression, marketing opt-in COALESCE
// ---------------------------------------------------------------------------
#[tokio::test]
async fn communications_summary_covers_subscriptions_suppression_and_opt_in() {
    let Some(fx) = Fixture::new().await else {
        return;
    };

    let (status, summary) = fx
        .call(
            "GET",
            &fx.guest_uri(GUEST_BOUNCE, "/communications"),
            Some(&fx.comms),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "communications failed: {summary}");
    assert_eq!(summary["marketing_opt_in"], true);
    assert_eq!(summary["communication_preference"], "email");
    assert_eq!(summary["language_preference"], "en");
    assert_eq!(
        summary["email_suppressed"], true,
        "normalized suppression lookup must match the lowercased guest email"
    );
    let subs = summary["subscriptions"].as_array().unwrap();
    assert!(
        subs.iter().any(|s| s["channel"] == "email"
            && s["topic"] == "promotion"
            && s["subscribed"] == true),
        "seeded subscription must appear: {summary}"
    );
    let deliveries = summary["recent_deliveries"].as_array().unwrap();
    assert!(
        deliveries.iter().any(|d| d["kind"] == "booking_confirmation"
            && d["subject"] == "Grt986 booking confirmation"
            && d["status"] == "sent"),
        "seeded delivery must appear: {summary}"
    );

    // NULL marketing_opt_in must COALESCE to false; no suppression row.
    let (status, main) = fx
        .call(
            "GET",
            &fx.guest_uri(GUEST_MAIN, "/communications"),
            Some(&fx.comms),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "main communications failed: {main}");
    assert_eq!(main["marketing_opt_in"], false);
    assert_eq!(main["communication_preference"], "sms");
    assert_eq!(main["email_suppressed"], false);

    let (status, denied) = fx
        .call(
            "GET",
            &fx.guest_uri(GUEST_MAIN, "/communications"),
            Some(&fx.noperm),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "communications:read gate: {denied}");
}

// ---------------------------------------------------------------------------
// 10. Support: guest-filtered list + staff conversation creation
// ---------------------------------------------------------------------------
#[tokio::test]
async fn support_guest_list_and_staff_conversation_create() {
    let Some(fx) = Fixture::new().await else {
        return;
    };

    // Guest-scoped list returns only that guest's conversations, projected
    // through the compact summary query (joins + SLA flags + i16/i32 decodes).
    let (status, listed) = fx
        .call(
            "GET",
            &fx.guest_uri(GUEST_OPEN_SUPPORT, "/support"),
            Some(&fx.agent),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "guest support list failed: {listed}");
    let rows = listed.as_array().unwrap();
    let conversation = rows
        .iter()
        .find(|row| row["conversation_number"] == "SUP-GRT986-OPEN")
        .expect("seeded open conversation must be listed");
    assert_eq!(conversation["status"], "waiting_for_staff");
    assert_eq!(conversation["category"], "complaint");
    assert_eq!(conversation["guest_name"], "Grt986 Opensup");
    assert_eq!(conversation["guest_id"].as_i64(), Some(GUEST_OPEN_SUPPORT));
    assert!(
        rows.iter()
            .all(|row| row["conversation_number"] != "SUP-GRT986-CLOSED"),
        "the list must stay scoped to the requested guest"
    );

    // Staff creation — service_request category, booking link, high priority.
    let (status, created) = fx
        .call(
            "POST",
            "/api/support/conversations",
            Some(&fx.agent),
            Some(json!({
                "guest_id": GUEST_PLAIN,
                "category": "service_request",
                "subject": "Extra towels",
                "message": "Guest asked for extra towels at the desk",
                "booking_id": BOOKING_PLAIN,
                "priority": "high",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "staff create failed: {created}");
    let conversation = &created["conversation"];
    assert_eq!(conversation["status"], "waiting_for_staff");
    assert_eq!(conversation["category"], "service_request");
    assert_eq!(conversation["subject"], "Extra towels");
    assert_eq!(conversation["booking_id"].as_i64(), Some(BOOKING_PLAIN));
    let messages = created["messages"].as_array().unwrap();
    assert_eq!(messages[0]["author_type"], "staff");
    assert_eq!(messages[0]["author_user_id"].as_i64(), Some(USER_AGENT));
    assert_eq!(messages[0]["body"], "Guest asked for extra towels at the desk");
    let events = created["events"].as_array().unwrap();
    assert!(
        events
            .iter()
            .any(|event| event["event_type"] == "created"),
        "a 'created' event row must be written: {created}"
    );

    // The complaint category added by patch 0019 must validate end-to-end.
    let (status, complaint) = fx
        .call(
            "POST",
            "/api/support/conversations",
            Some(&fx.agent),
            Some(json!({
                "guest_id": GUEST_PLAIN,
                "category": "complaint",
                "message": "Guest reports noise from the corridor",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "complaint create failed: {complaint}");
    assert_eq!(complaint["conversation"]["category"], "complaint");
    assert_eq!(complaint["conversation"]["status"], "waiting_for_staff");

    // assignee_id requires support:assign — a write-only agent is denied.
    let (status, denied) = fx
        .call(
            "POST",
            "/api/support/conversations",
            Some(&fx.agent),
            Some(json!({
                "guest_id": GUEST_PLAIN,
                "category": "other",
                "message": "write-only assignment attempt",
                "assignee_id": USER_LEAD,
            })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "assignee without support:assign must 403: {denied}"
    );

    // A support:assign holder may file directly onto an active agent.
    let (status, assigned) = fx
        .call(
            "POST",
            "/api/support/conversations",
            Some(&fx.lead),
            Some(json!({
                "guest_id": GUEST_PLAIN,
                "category": "service_request",
                "message": "VIP arrival inspection",
                "assignee_id": USER_AGENT,
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "assigned create failed: {assigned}");
    assert_eq!(
        assigned["conversation"]["assigned_to_user_id"].as_i64(),
        Some(USER_AGENT)
    );
    let events = assigned["events"].as_array().unwrap();
    assert!(events.iter().any(|event| event["event_type"] == "assigned"));

    // No support permission at all — route-level gate.
    let (status, denied) = fx
        .call(
            "POST",
            "/api/support/conversations",
            Some(&fx.noperm),
            Some(json!({
                "guest_id": GUEST_PLAIN,
                "category": "other",
                "message": "no permissions",
            })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "support:write gate: {denied}");
}

// ---------------------------------------------------------------------------
// 11. guests:reveal gating on the profile and PATCH surfaces
// ---------------------------------------------------------------------------
#[tokio::test]
async fn reveal_gating_on_profile_and_guest_patch() {
    let Some(fx) = Fixture::new().await else {
        return;
    };
    let profile_uri = fx.guest_uri(GUEST_VIP, "/profile");
    let guest_uri = format!("/api/guests/{GUEST_VIP}");

    // guests:read-only caller: profile succeeds but `sensitive` is absent
    // entirely (skip_serializing_if), so "no access" and "no data" are
    // indistinguishable. `guest.tags` still decodes from text[] here.
    let (status, profile) = fx.call("GET", &profile_uri, Some(&fx.reader), None).await;
    assert_eq!(status, StatusCode::OK, "reader profile failed: {profile}");
    assert!(
        profile.get("sensitive").is_none(),
        "sensitive must be omitted for guests:read-only callers: {profile}"
    );
    assert_eq!(
        profile["guest"]["tags"],
        json!(["vip", "returning"]),
        "tags text[] must decode to Vec<String>"
    );

    // guests:manage implies guests:reveal — the sensitive block appears with
    // the `id_type` enum decoded through the `::TEXT` cast.
    let (status, profile) = fx.call("GET", &profile_uri, Some(&fx.manager), None).await;
    assert_eq!(status, StatusCode::OK, "manager profile failed: {profile}");
    let sensitive = profile
        .get("sensitive")
        .expect("sensitive must be present for guests:reveal holders");
    assert_eq!(sensitive["id_type"], "passport");
    assert_eq!(sensitive["id_number"], "P123456X");
    assert_eq!(sensitive["id_country"], "Malaysia");
    assert_eq!(sensitive["date_of_birth"], "1990-04-12");

    // PATCH with a sensitive field needs guests:reveal on top of
    // guests:update — the editor role (update, no reveal) is denied.
    let (status, denied) = fx
        .call(
            "PATCH",
            &guest_uri,
            Some(&fx.author),
            Some(json!({"id_number": "X999999"})),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "sensitive PATCH without reveal must 403: {denied}"
    );

    // The gate is field-scoped, not user-scoped: non-sensitive fields update.
    let (status, updated) = fx
        .call(
            "PATCH",
            &guest_uri,
            Some(&fx.author),
            Some(json!({"vip_status": "platinum"})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "non-sensitive PATCH failed: {updated}");
    assert_eq!(updated["vip_status"], "platinum");

    // A guests:manage caller (implied reveal) may update sensitive fields.
    let (status, updated) = fx
        .call(
            "PATCH",
            &guest_uri,
            Some(&fx.manager),
            Some(json!({"id_number": "X999999"})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "manager sensitive PATCH failed: {updated}");
}

// ---------------------------------------------------------------------------
// 12. Guest-list filters: vip / blacklisted / has_open_support
// ---------------------------------------------------------------------------
#[tokio::test]
async fn guest_list_filters_vip_blacklisted_open_support() {
    let Some(fx) = Fixture::new().await else {
        return;
    };
    let list_ids = |body: &Value| -> Vec<i64> {
        body["data"]
            .as_array()
            .map(|rows| rows.iter().filter_map(|row| row["id"].as_i64()).collect())
            .unwrap_or_default()
    };

    // vip=true requires a non-null, non-empty vip_status — GUEST_PLAIN's ''
    // must be filtered out along with the NULL rows.
    let (status, vip) = fx
        .call("GET", "/api/guests?vip=true", Some(&fx.reader), None)
        .await;
    assert_eq!(status, StatusCode::OK, "vip filter failed: {vip}");
    let ids = list_ids(&vip);
    assert!(ids.contains(&GUEST_VIP), "vip guest missing: {vip}");
    assert!(!ids.contains(&GUEST_PLAIN), "empty vip_status must not match");
    assert!(!ids.contains(&GUEST_MAIN), "NULL vip_status must not match");
    let vip_row = vip["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"].as_i64() == Some(GUEST_VIP))
        .unwrap()
        .clone();
    assert_eq!(vip_row["vip_status"], "gold");
    assert_eq!(vip_row["is_blacklisted"], false);

    // blacklisted=true matches only is_blacklisted = true.
    let (status, blacklisted) = fx
        .call("GET", "/api/guests?blacklisted=true", Some(&fx.reader), None)
        .await;
    assert_eq!(status, StatusCode::OK, "blacklist filter failed: {blacklisted}");
    let ids = list_ids(&blacklisted);
    assert!(ids.contains(&GUEST_BLACK), "blacklisted guest missing");
    assert!(!ids.contains(&GUEST_VIP), "non-blacklisted guest must not match");

    // has_open_support=true follows the inbox definition: any status other
    // than 'closed' counts as open.
    let (status, open_support) = fx
        .call(
            "GET",
            "/api/guests?has_open_support=true",
            Some(&fx.reader),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "open-support filter failed: {open_support}");
    let ids = list_ids(&open_support);
    assert!(ids.contains(&GUEST_OPEN_SUPPORT), "open case guest missing");
    assert!(
        !ids.contains(&GUEST_CLOSED_SUPPORT),
        "a closed conversation must not satisfy the filter"
    );
    assert!(!ids.contains(&GUEST_MAIN), "guest with no cases must not match");
}
