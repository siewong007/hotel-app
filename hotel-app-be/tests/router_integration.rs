//! End-to-end tests against the real HTTP/router/auth-middleware stack.
//!
//! Every other test in this crate calls service functions directly,
//! bypassing `routes::create_router` entirely. That leaves route-merge
//! regressions (a handler silently losing its `.merge()` in
//! `routes/mod.rs`) and auth/permission-middleware wiring regressions with
//! zero coverage. These tests build the real router, bind it to a loopback
//! TCP port with `axum::serve` (mirroring `main.rs`), and issue real HTTP
//! requests with `reqwest`.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use crate::common;
    use chrono::{Duration, Utc};
    use hotel_app_be::core::auth::AuthService;
    use hotel_app_be::core::config;
    use hotel_app_be::modules::promotions::{models::PromotionInput, service as promotion_service};
    use hotel_app_be::repositories::guest_portal_session::GuestPortalSessionRepository;
    use hotel_app_be::routes::create_router;
    use serde_json::Value;
    use sha2::{Digest, Sha256};
    use std::net::SocketAddr;
    use std::sync::Once;

    static INIT: Once = Once::new();

    /// `core::config` and the JWT secret are process-global `OnceLock`s, so
    /// they can only be initialized once per test binary — all tests in this
    /// file therefore share one JWT secret and one `AppConfig`.
    fn init_config() {
        INIT.call_once(|| {
            // Safety: single-threaded init guarded by `Once`, before any
            // other test in this binary reads the env var.
            unsafe {
                std::env::set_var(
                    "JWT_SECRET",
                    "router-integration-test-secret-key-32-chars-min",
                );
            }
            let _ = config::init_from_env();
        });
    }

    /// Start the real `create_router()` app on an OS-assigned loopback port
    /// and return its base URL, mirroring the bind/serve calls in `main.rs`.
    async fn spawn_app(pool: sqlx::SqlitePool) -> String {
        init_config();

        let app = create_router(pool);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("failed to bind test listener");
        let addr: SocketAddr = listener
            .local_addr()
            .expect("listener must have a local addr");

        tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .expect("test server crashed");
        });

        format!("http://{addr}")
    }

    async fn insert_user_with_role(pool: &sqlx::SqlitePool, id: i64, username: &str, role_id: i64) {
        sqlx::query(
            "INSERT INTO users (id, uuid, username, email, password_hash, full_name, is_active, is_verified)
             VALUES (?1, ?2, ?3, ?4, 'hash', 'Router Test User', 1, 1)",
        )
        .bind(id)
        .bind(format!("00000000-0000-0000-0002-{id:012}"))
        .bind(username)
        .bind(format!("{username}@hotel.local"))
        .execute(pool)
        .await
        .unwrap();

        sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES (?1, ?2)")
            .bind(id)
            .bind(role_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn staff_token(
        pool: &sqlx::SqlitePool,
        user_id: i64,
        username: &str,
        roles: Vec<String>,
    ) -> String {
        let session_id = AuthService::store_refresh_token(
            pool,
            user_id,
            &format!("router-session-{user_id}-{username}"),
            30,
            None,
            None,
        )
        .await
        .expect("test session should be created");
        AuthService::generate_session_jwt(user_id, username.to_string(), roles, session_id)
            .expect("session JWT should generate")
    }

    fn promotion_input(slug: &str, name: &str) -> PromotionInput {
        PromotionInput {
            slug: slug.to_string(),
            name: name.to_string(),
            description: Some("A public route integration test campaign.".to_string()),
            terms: Some("Eligible stays only.".to_string()),
            promotion_kind: "voucher".to_string(),
            discount_type: "percentage".to_string(),
            discount_value: 15.0,
            max_discount_amount: Some(50.0),
            currency: Some("USD".to_string()),
            claim_starts_at: None,
            claim_ends_at: None,
            stay_starts_on: None,
            stay_ends_on: None,
            min_nights: Some(1),
            max_nights: None,
            min_subtotal: Some(0.0),
            claim_limit: None,
            per_guest_limit: Some(1),
            is_public: Some(true),
            is_cancellable: None,
            room_type_ids: None,
            expected_version: None,
        }
    }

    async fn create_published_promotion(
        pool: &sqlx::SqlitePool,
        slug: &str,
        name: &str,
    ) -> hotel_app_be::modules::promotions::models::Promotion {
        let draft = promotion_service::create_admin_promotion(
            pool,
            1,
            promotion_input(slug, name),
            None,
            None,
        )
        .await
        .expect("test promotion should be created");

        promotion_service::publish_admin_promotion(
            pool,
            1,
            draft.id,
            Some(draft.version),
            None,
            None,
        )
        .await
        .expect("test promotion should be published")
    }

    async fn insert_guest(pool: &sqlx::SqlitePool, guest_id: i64) {
        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name, full_name, email, phone) \
             VALUES (?1, 'Promotion', 'Route Guest', 'Promotion Route Guest', ?2, '60123456789')",
        )
        .bind(guest_id)
        .bind(format!("promotion-route-{guest_id}@hotel.local"))
        .execute(pool)
        .await
        .expect("test guest should be inserted");
    }

    async fn create_guest_portal_token(pool: &sqlx::SqlitePool, guest_id: i64) -> String {
        let token = format!("promotion-route-session-{guest_id}");
        let token_hash = hex::encode(Sha256::digest(token.as_bytes()));
        GuestPortalSessionRepository::create_session(
            pool,
            guest_id,
            &token_hash,
            Utc::now() + Duration::hours(1),
        )
        .await
        .expect("test guest session should be created");
        token
    }

    #[tokio::test]
    async fn unauthenticated_request_to_protected_endpoint_returns_401() {
        let pool = common::setup_test_db().await;
        let base_url = spawn_app(pool).await;

        let response = reqwest::Client::new()
            .get(format!("{base_url}/api/rooms"))
            .send()
            .await
            .expect("request should complete");

        assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn authenticated_request_with_insufficient_permission_returns_403() {
        let pool = common::setup_test_db().await;
        // Housekeeping (role_id 4) is granted rooms:read/update plus its own
        // domain permissions by 015_housekeeping_maintenance.sql (housekeeping
        // staff need to see room status to know what to clean) - so /api/rooms
        // is NOT a permission this role lacks. It has zero payments/ledgers/
        // companies/rbac permissions, so use a payments:read-gated route
        // instead to exercise a genuine 403.
        let user_id = 920_002;
        insert_user_with_role(&pool, user_id, "router_test_housekeeper", 4).await;
        let base_url = spawn_app(pool.clone()).await;

        let token = staff_token(
            &pool,
            user_id,
            "router_test_housekeeper",
            vec!["housekeeping".to_string()],
        )
        .await;

        let response = reqwest::Client::new()
            .get(format!("{base_url}/api/payments/booking/1"))
            .bearer_auth(token)
            .send()
            .await
            .expect("request should complete");

        assert_eq!(response.status(), reqwest::StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn authenticated_permitted_request_returns_200() {
        let pool = common::setup_test_db().await;
        let base_url = spawn_app(pool.clone()).await;

        // User id 1 is the default admin seeded by 001_initial_schema.sql
        // with role_id 1 (admin), which is granted every permission
        // including rooms:read.
        let token = staff_token(&pool, 1, "admin", vec!["admin".to_string()]).await;

        let response = reqwest::Client::new()
            .get(format!("{base_url}/api/rooms"))
            .bearer_auth(token)
            .send()
            .await
            .expect("request should complete");

        assert_eq!(response.status(), reqwest::StatusCode::OK);
    }

    #[tokio::test]
    async fn sessionless_staff_jwt_is_rejected_by_router_middleware() {
        let pool = common::setup_test_db().await;
        let base_url = spawn_app(pool).await;
        let legacy_token =
            AuthService::generate_jwt(1, "admin".to_string(), vec!["admin".to_string()])
                .expect("legacy jwt should generate for rejection test");

        let response = reqwest::Client::new()
            .get(format!("{base_url}/api/rooms"))
            .bearer_auth(legacy_token)
            .send()
            .await
            .expect("request should complete");

        assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn deactivated_staff_session_is_rejected_by_router_middleware() {
        let pool = common::setup_test_db().await;
        let base_url = spawn_app(pool.clone()).await;
        let session_id = AuthService::store_refresh_token(
            &pool,
            1,
            "deactivated-router-session",
            30,
            None,
            None,
        )
        .await
        .expect("test session should be created");
        let token = AuthService::generate_session_jwt(
            1,
            "admin".to_string(),
            vec!["admin".to_string()],
            session_id,
        )
        .expect("session JWT should generate");

        sqlx::query("UPDATE users SET is_active = 0 WHERE id = 1")
            .execute(&pool)
            .await
            .expect("admin account should deactivate for the test");

        let response = reqwest::Client::new()
            .get(format!("{base_url}/api/rooms"))
            .bearer_auth(token)
            .send()
            .await
            .expect("request should complete");

        assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn guest_request_to_global_search_returns_403() {
        let pool = common::setup_test_db().await;
        let user_id = 920_003;
        insert_user_with_role(&pool, user_id, "router_test_guest", 6).await;
        let base_url = spawn_app(pool.clone()).await;

        let token = staff_token(
            &pool,
            user_id,
            "router_test_guest",
            vec!["guest".to_string()],
        )
        .await;

        let response = reqwest::Client::new()
            .get(format!("{base_url}/api/search?q=room"))
            .bearer_auth(token)
            .send()
            .await
            .expect("request should complete");

        assert_eq!(response.status(), reqwest::StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn authenticated_guest_can_create_a_portal_session_in_sqlite() {
        let pool = common::setup_test_db().await;
        let user_id = 920_004;
        let guest_id = 930_004;
        insert_guest(&pool, guest_id).await;
        insert_user_with_role(&pool, user_id, "router_portal_guest", 6).await;
        sqlx::query("UPDATE users SET user_type = 'guest', guest_id = ?1 WHERE id = ?2")
            .bind(guest_id)
            .bind(user_id)
            .execute(&pool)
            .await
            .expect("guest account should link to its guest profile");

        let base_url = spawn_app(pool.clone()).await;
        let token = staff_token(
            &pool,
            user_id,
            "router_portal_guest",
            vec!["guest".to_string()],
        )
        .await;

        let response = reqwest::Client::new()
            .post(format!("{base_url}/api/guest-portal/session"))
            .bearer_auth(token)
            .send()
            .await
            .expect("guest portal session request should complete");

        assert_eq!(response.status(), reqwest::StatusCode::OK);
        let body: Value = response
            .json()
            .await
            .expect("guest portal session should return JSON");
        assert!(
            body["token"]
                .as_str()
                .is_some_and(|value| !value.is_empty())
        );
        assert_eq!(body["guest"]["full_name"], "Promotion Route Guest");
    }

    #[tokio::test]
    async fn public_guest_payment_config_is_available_without_auth() {
        let pool = common::setup_test_db().await;
        let base_url = spawn_app(pool).await;

        let response = reqwest::Client::new()
            .get(format!("{base_url}/api/guest-portal/payment-config"))
            .send()
            .await
            .expect("public payment-config request should complete");

        assert_eq!(response.status(), reqwest::StatusCode::OK);
        let body: Value = response
            .json()
            .await
            .expect("payment-config response should be JSON");
        assert!(body["paypal_enabled"].is_boolean());
        assert!(body["bank_details"].is_object());
    }

    #[tokio::test]
    async fn public_promotion_catalogue_is_available_without_auth_and_hides_drafts() {
        let pool = common::setup_test_db().await;
        let published =
            create_published_promotion(&pool, "router-public-promotion", "Router public promotion")
                .await;
        let draft = promotion_service::create_admin_promotion(
            &pool,
            1,
            promotion_input("router-hidden-draft", "Router hidden draft"),
            None,
            None,
        )
        .await
        .expect("test draft promotion should be created");
        let base_url = spawn_app(pool.clone()).await;
        let client = reqwest::Client::new();

        let catalogue = client
            .get(format!("{base_url}/api/promotions"))
            .send()
            .await
            .expect("public catalogue request should complete");
        assert_eq!(catalogue.status(), reqwest::StatusCode::OK);
        let body: Value = catalogue
            .json()
            .await
            .expect("catalogue should return JSON");
        let items = body["items"].as_array().expect("catalogue items array");
        assert!(items.iter().any(|item| item["id"] == published.id));
        assert!(!items.iter().any(|item| item["id"] == draft.id));
        assert!(items.iter().all(|item| item.get("code").is_none()));

        let public_detail = client
            .get(format!("{base_url}/api/promotions/{}", published.slug))
            .send()
            .await
            .expect("public promotion detail request should complete");
        assert_eq!(public_detail.status(), reqwest::StatusCode::OK);

        let draft_detail = client
            .get(format!("{base_url}/api/promotions/{}", draft.slug))
            .send()
            .await
            .expect("draft promotion detail request should complete");
        assert_eq!(draft_detail.status(), reqwest::StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn guest_claim_requires_a_portal_session_and_staff_voucher_list_masks_the_code() {
        let pool = common::setup_test_db().await;
        let guest_id = 920_101;
        insert_guest(&pool, guest_id).await;
        let promotion =
            create_published_promotion(&pool, "router-guest-claim", "Router guest claim promotion")
                .await;
        let portal_token = create_guest_portal_token(&pool, guest_id).await;
        let base_url = spawn_app(pool.clone()).await;
        let client = reqwest::Client::new();
        let claim_url = format!(
            "{base_url}/api/guest-portal/me/promotions/{}/claim",
            promotion.id
        );

        let missing_session = client
            .post(&claim_url)
            .json(&serde_json::json!({"client_request_id": "missing-session"}))
            .send()
            .await
            .expect("unauthenticated claim request should complete");
        assert_eq!(missing_session.status(), reqwest::StatusCode::UNAUTHORIZED);
        let missing_session_body: Value = missing_session
            .json()
            .await
            .expect("unauthenticated response should be JSON");
        assert_eq!(
            missing_session_body["error"],
            Value::String("Missing guest session token.".to_string())
        );

        let guest_claim = client
            .post(&claim_url)
            .bearer_auth(&portal_token)
            .json(&serde_json::json!({"client_request_id": "valid-session"}))
            .send()
            .await
            .expect("authenticated claim request should complete");
        assert_eq!(guest_claim.status(), reqwest::StatusCode::OK);
        let guest_voucher: Value = guest_claim
            .json()
            .await
            .expect("guest claim response should be JSON");
        let raw_code = guest_voucher["code"]
            .as_str()
            .expect("guest owner should receive the unmasked voucher code")
            .to_string();
        assert_eq!(guest_voucher["guest_id"], guest_id);

        let admin_token = staff_token(&pool, 1, "admin", vec!["admin".to_string()]).await;
        let staff_list = client
            .get(format!("{base_url}/api/admin/vouchers"))
            .bearer_auth(admin_token)
            .send()
            .await
            .expect("staff voucher list request should complete");
        assert_eq!(staff_list.status(), reqwest::StatusCode::OK);
        let staff_body: Value = staff_list
            .json()
            .await
            .expect("staff voucher list should be JSON");
        let staff_voucher = staff_body["items"]
            .as_array()
            .expect("staff voucher list items")
            .iter()
            .find(|item| item["promotion_id"] == promotion.id && item["guest_id"] == guest_id)
            .expect("staff list should include the claimed voucher");
        assert!(staff_voucher["code"].is_null());
        assert_ne!(staff_voucher["code_masked"], raw_code);
        assert_eq!(
            staff_voucher["code_masked"],
            format!("••••{}", &raw_code[raw_code.len() - 4..])
        );
    }

    #[tokio::test]
    async fn guest_booking_retry_returns_the_original_booking_without_duplicate_side_effects() {
        let pool = common::setup_test_db().await;
        let guest_id = 920_103;
        insert_guest(&pool, guest_id).await;
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status, is_active)
             VALUES (920103, 'PORTAL-103', 1, 'available', 1)",
        )
        .execute(&pool)
        .await
        .expect("test room should be inserted");
        let portal_token = create_guest_portal_token(&pool, guest_id).await;
        let base_url = spawn_app(pool.clone()).await;
        let client = reqwest::Client::new();
        let check_in = (Utc::now().date_naive() + Duration::days(10)).to_string();
        let check_out = (Utc::now().date_naive() + Duration::days(12)).to_string();

        let quote_response = client
            .post(format!("{base_url}/api/guest-portal/me/booking-quote"))
            .bearer_auth(&portal_token)
            .json(&serde_json::json!({
                "room_type_id": 1,
                "check_in_date": check_in.clone(),
                "check_out_date": check_out.clone(),
                "adults": 1,
                "children": 0
            }))
            .send()
            .await
            .expect("quote request should complete");
        assert_eq!(quote_response.status(), reqwest::StatusCode::OK);
        let quote: Value = quote_response.json().await.expect("quote should be JSON");

        let create_body = serde_json::json!({
            "client_request_id": "portal-retry-920103",
            "room_type_id": 1,
            "check_in_date": check_in,
            "check_out_date": check_out,
            "adults": 1,
            "children": 0,
            "expected_total": quote["total_amount"],
            "special_requests": "Quiet room, please",
            "cleaning_preference": false
        });
        let first_response = client
            .post(format!("{base_url}/api/guest-portal/me/bookings"))
            .bearer_auth(&portal_token)
            .json(&create_body)
            .send()
            .await
            .expect("first create request should complete");
        assert_eq!(first_response.status(), reqwest::StatusCode::OK);
        let first: Value = first_response
            .json()
            .await
            .expect("first confirmation should be JSON");

        let retry_response = client
            .post(format!("{base_url}/api/guest-portal/me/bookings"))
            .bearer_auth(&portal_token)
            .json(&create_body)
            .send()
            .await
            .expect("retry create request should complete");
        assert_eq!(retry_response.status(), reqwest::StatusCode::OK);
        let retry: Value = retry_response
            .json()
            .await
            .expect("retry confirmation should be JSON");

        assert_eq!(retry["booking_id"], first["booking_id"]);
        assert_eq!(retry["booking_number"], first["booking_number"]);
        let booking_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM bookings
             WHERE guest_id = ?1 AND portal_request_id = 'portal-retry-920103'",
        )
        .bind(guest_id)
        .fetch_one(&pool)
        .await
        .expect("booking count should load");
        assert_eq!(booking_count, 1);
        let confirmation_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM email_deliveries
             WHERE idempotency_key = ?1",
        )
        .bind(format!(
            "booking-confirmation:{}",
            first["booking_id"].as_i64().expect("numeric booking id")
        ))
        .fetch_one(&pool)
        .await
        .expect("confirmation count should load");
        assert_eq!(confirmation_count, 1);
    }

    #[tokio::test]
    async fn admin_promotion_and_voucher_routes_require_their_permissions() {
        let pool = common::setup_test_db().await;
        let user_id = 920_102;
        insert_user_with_role(&pool, user_id, "router_promotion_housekeeper", 4).await;
        let base_url = spawn_app(pool.clone()).await;
        let client = reqwest::Client::new();

        for endpoint in ["admin/promotions", "admin/vouchers"] {
            let unauthenticated = client
                .get(format!("{base_url}/api/{endpoint}"))
                .send()
                .await
                .expect("unauthenticated admin request should complete");
            assert_eq!(
                unauthenticated.status(),
                reqwest::StatusCode::UNAUTHORIZED,
                "{endpoint} must require staff authentication"
            );
        }

        let housekeeping_token = staff_token(
            &pool,
            user_id,
            "router_promotion_housekeeper",
            vec!["housekeeping".to_string()],
        )
        .await;
        for endpoint in ["admin/promotions", "admin/vouchers"] {
            let forbidden = client
                .get(format!("{base_url}/api/{endpoint}"))
                .bearer_auth(&housekeeping_token)
                .send()
                .await
                .expect("under-permitted admin request should complete");
            assert_eq!(
                forbidden.status(),
                reqwest::StatusCode::FORBIDDEN,
                "{endpoint} must enforce its domain permission"
            );
        }
    }
}
