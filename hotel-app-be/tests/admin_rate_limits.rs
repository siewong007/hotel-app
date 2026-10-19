//! HTTP-level coverage for the staff administration rate limit
//! (`core::rate_limiter::limit_staff_admin`), driven through the real router:
//!
//! - every `/users` and `/rbac` route sits behind it: once a staff member's
//!   write budget is spent, their next write to either router is a 429 with
//!   `Retry-After`,
//! - reads draw on a separate budget, so a spent write budget leaves reads
//!   alone, and a spent read budget refuses reads,
//! - budgets belong to the signed-in staff member, not the address: someone
//!   else at the same desk is unaffected.
//!
//! The fixture users hold no permissions at all. The limit runs before the
//! permission check, so an allowed request answers 403 and a refused one 429,
//! and nothing is ever written. How the limiter counts is covered by its unit
//! tests and `tests/distributed_state.rs`; this file proves the wiring.
//!
//! Fixture users live in the `920_980_0xx` id band and are deleted at the end
//! of the test. Runs only with `DATABASE_URL` set.

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode, header};
use hotel_app_be::AuthService;
use hotel_app_be::core::rate_limiter::{KeyedRateLimiter, RateLimiters};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use tower::ServiceExt;

const TEST_JWT_SECRET: &str = "hotel-app-be-admin-rate-limit-secret-32chars";
const SPENDER_ID: i64 = 920_980_001;
const NEIGHBOUR_ID: i64 = 920_980_002;
/// Both staff members sit behind one address, like a hotel front desk.
const DESK: SocketAddr = SocketAddr::new(
    std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 241, 0, 1)),
    40_000,
);

async fn setup() -> Option<(PgPool, axum::Router)> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping admin rate-limit tests because DATABASE_URL is not set");
            return None;
        }
    };
    unsafe {
        std::env::set_var("JWT_SECRET", TEST_JWT_SECRET);
    }
    hotel_app_be::core::config::init_from_env().expect("test app configuration must initialize");
    AuthService::init_jwt_secret(TEST_JWT_SECRET)
        .expect("test JWT secret must satisfy production validation");

    let pool = PgPoolOptions::new()
        .max_connections(4)
        // Deleting a `users` fixture fires `audit_logs`'s ON DELETE SET NULL
        // into an append-only table; opt out session-locally like the sibling
        // fixtures do.
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
        .expect("rate-limit test database must connect");
    cleanup(&pool).await;
    for (id, username) in [
        (SPENDER_ID, "admin_rl_spender"),
        (NEIGHBOUR_ID, "admin_rl_neighbour"),
    ] {
        sqlx::query(
            "INSERT INTO users \
             (id, username, email, full_name, user_type, is_active, is_verified, \
              is_locked, is_super_admin) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $3, 'Admin Rate Limit Actor', 'staff', true, true, false, false) \
             ON CONFLICT (id) DO UPDATE SET \
                 username = EXCLUDED.username, email = EXCLUDED.email, \
                 is_active = true, is_verified = true, is_locked = false, \
                 is_super_admin = false, deleted_at = NULL",
        )
        .bind(id)
        .bind(username)
        .bind(format!("{username}@hotel.local"))
        .execute(&pool)
        .await
        .expect("actor fixture must be inserted");
    }
    hotel_app_be::core::rbac_cache::clear_all();
    let app = hotel_app_be::routes::create_router(pool.clone());
    Some((pool, app))
}

async fn cleanup(pool: &PgPool) {
    let ids = [SPENDER_ID, NEIGHBOUR_ID];
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = ANY($1)")
        .bind(ids)
        .execute(pool)
        .await
        .expect("session cleanup must run");
    sqlx::query("DELETE FROM audit_logs WHERE user_id = ANY($1)")
        .bind(ids)
        .execute(pool)
        .await
        .expect("audit cleanup must run");
    let buckets: Vec<String> = ids
        .iter()
        .flat_map(|id| [format!("admin_read:{id}"), format!("admin_write:{id}")])
        .collect();
    sqlx::query("DELETE FROM rate_limit_buckets WHERE bucket = ANY($1)")
        .bind(buckets)
        .execute(pool)
        .await
        .expect("bucket cleanup must run");
    sqlx::query("DELETE FROM users WHERE id = ANY($1)")
        .bind(ids)
        .execute(pool)
        .await
        .expect("actor cleanup must run");
}

/// An active session plus its session-bound access token: the session
/// middleware checks `sid` against `refresh_tokens`, so a bare signed JWT is
/// not enough.
async fn bearer(pool: &PgPool, user_id: i64, username: &str) -> String {
    let refresh_token = AuthService::generate_refresh_token();
    let session_id = AuthService::store_refresh_token(
        pool,
        user_id,
        &refresh_token,
        1,
        Some("10.241.0.1"),
        Some("admin-rate-limit-test"),
        None,
    )
    .await
    .expect("session fixture must be inserted");
    let token = AuthService::generate_session_jwt(
        user_id,
        username.to_string(),
        vec!["staff".to_string()],
        session_id,
    )
    .expect("test access token must encode");
    format!("Bearer {token}")
}

/// Status and `Retry-After` of one request through the real router.
async fn send(
    app: &axum::Router,
    method: &str,
    uri: &str,
    authorization: &str,
) -> (StatusCode, Option<String>) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, authorization);
    let body = if method == "GET" {
        Body::empty()
    } else {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
        Body::from("{}")
    };
    let mut request = builder.body(body).expect("request must build");
    request.extensions_mut().insert(ConnectInfo(DESK));
    let response = app
        .clone()
        .oneshot(request)
        .await
        .expect("router response must complete");
    let retry_after = response
        .headers()
        .get(header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    (response.status(), retry_after)
}

/// Spend all of `limiter`'s budget for `user_id` (in the same Postgres
/// buckets the router's limiter counts in), then send one request. The window
/// is fixed, so if it rolls over between the two the request lands in a fresh
/// window: spend and send once more, which cannot straddle a second rollover.
async fn send_after_spending(
    app: &axum::Router,
    limiter: &KeyedRateLimiter,
    user_id: i64,
    method: &str,
    uri: &str,
    authorization: &str,
) -> (StatusCode, Option<String>) {
    let mut outcome = (StatusCode::OK, None);
    for _ in 0..2 {
        let mut spent = false;
        for _ in 0..10_000 {
            if !limiter.check_with_retry(user_id.to_string()).await.0 {
                spent = true;
                break;
            }
        }
        assert!(spent, "the budget must run out within 10,000 requests");
        outcome = send(app, method, uri, authorization).await;
        if outcome.0 == StatusCode::TOO_MANY_REQUESTS {
            break;
        }
    }
    outcome
}

#[tokio::test]
async fn staff_admin_routes_limit_each_staff_member_with_separate_read_and_write_budgets() {
    let Some((pool, app)) = setup().await else {
        return;
    };
    let spender = bearer(&pool, SPENDER_ID, "admin_rl_spender").await;
    let neighbour = bearer(&pool, NEIGHBOUR_ID, "admin_rl_neighbour").await;
    let limiters = RateLimiters::new(pool.clone());

    // Baseline: allowed through the limit, refused by the permission check.
    assert_eq!(
        send(&app, "DELETE", "/api/users/920980999", &spender)
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    // A spent write budget refuses writes on both routers, and says when to
    // come back.
    let (status, retry_after) = send_after_spending(
        &app,
        &limiters.admin_write,
        SPENDER_ID,
        "DELETE",
        "/api/users/920980999",
        &spender,
    )
    .await;
    // (Spent already: re-checking costs one refused count, and keeps the
    // rollover guard between this assertion and its request.)
    let rbac_write = send_after_spending(
        &app,
        &limiters.admin_write,
        SPENDER_ID,
        "POST",
        "/api/rbac/roles",
        &spender,
    )
    .await
    .0;
    let users_read = send(&app, "GET", "/api/users", &spender).await.0;
    let neighbour_write = send(&app, "DELETE", "/api/users/920980999", &neighbour)
        .await
        .0;

    // ... and a spent read budget refuses reads.
    let (read_status, _) = send_after_spending(
        &app,
        &limiters.admin_read,
        SPENDER_ID,
        "GET",
        "/api/rbac/roles",
        &spender,
    )
    .await;
    let neighbour_read = send(&app, "GET", "/api/rbac/roles", &neighbour).await.0;

    cleanup(&pool).await;

    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "a spent write budget refuses /users writes"
    );
    let retry_after: u64 = retry_after
        .expect("a 429 must carry Retry-After")
        .parse()
        .expect("Retry-After must be whole seconds");
    assert!(
        (1..=300).contains(&retry_after),
        "Retry-After {retry_after}s must fall inside the 5-minute window"
    );
    assert_eq!(
        rbac_write,
        StatusCode::TOO_MANY_REQUESTS,
        "/rbac writes share the same budget"
    );
    assert_eq!(
        users_read,
        StatusCode::FORBIDDEN,
        "reads have their own budget"
    );
    assert_eq!(
        neighbour_write,
        StatusCode::FORBIDDEN,
        "another staff member at the same address keeps their own budget"
    );
    assert_eq!(
        read_status,
        StatusCode::TOO_MANY_REQUESTS,
        "a spent read budget refuses reads"
    );
    assert_eq!(neighbour_read, StatusCode::FORBIDDEN);
}
