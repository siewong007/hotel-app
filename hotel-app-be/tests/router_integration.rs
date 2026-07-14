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
    use hotel_app_be::core::auth::AuthService;
    use hotel_app_be::core::config;
    use hotel_app_be::routes::create_router;
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
            axum::serve(listener, app.into_make_service())
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
        let base_url = spawn_app(pool).await;

        let token = AuthService::generate_jwt(
            user_id,
            "router_test_housekeeper".to_string(),
            vec!["housekeeping".to_string()],
        )
        .expect("jwt should generate");

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
        let base_url = spawn_app(pool).await;

        // User id 1 is the default admin seeded by 001_initial_schema.sql
        // with role_id 1 (admin), which is granted every permission
        // including rooms:read.
        let token = AuthService::generate_jwt(1, "admin".to_string(), vec!["admin".to_string()])
            .expect("jwt should generate");

        let response = reqwest::Client::new()
            .get(format!("{base_url}/api/rooms"))
            .bearer_auth(token)
            .send()
            .await
            .expect("request should complete");

        assert_eq!(response.status(), reqwest::StatusCode::OK);
    }

    #[tokio::test]
    async fn guest_request_to_global_search_returns_403() {
        let pool = common::setup_test_db().await;
        let user_id = 920_003;
        insert_user_with_role(&pool, user_id, "router_test_guest", 6).await;
        let base_url = spawn_app(pool).await;

        let token = AuthService::generate_jwt(
            user_id,
            "router_test_guest".to_string(),
            vec!["guest".to_string()],
        )
        .expect("jwt should generate");

        let response = reqwest::Client::new()
            .get(format!("{base_url}/api/search?q=room"))
            .bearer_auth(token)
            .send()
            .await
            .expect("request should complete");

        assert_eq!(response.status(), reqwest::StatusCode::FORBIDDEN);
    }
}
