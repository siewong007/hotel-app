//! Edge-layer contract for every response, including ones no handler produced.
//!
//! An unrouted path exercises the full outer middleware stack — security
//! headers, CORS, metrics, the request-id task-local, and the error-body
//! normalizer — without needing any seeded data. These tests pin the headers a
//! browser-facing deployment depends on and the `request_id` correlation field
//! clients can quote back to support.

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use hotel_app_be::{AuthService, core, routes};
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

const TEST_JWT_SECRET: &str = "hotel-app-be-security-headers-secret-32c";

async fn app_or_skip() -> Option<axum::Router> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping security header tests because DATABASE_URL is not set");
            return None;
        }
    };
    unsafe {
        std::env::set_var("JWT_SECRET", TEST_JWT_SECRET);
    }
    core::config::init_from_env().expect("test app configuration must initialize");
    AuthService::init_jwt_secret(TEST_JWT_SECRET)
        .expect("test JWT secret must satisfy production validation");
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("security header test database must connect");
    Some(routes::create_router(pool))
}

#[tokio::test]
async fn unrouted_path_returns_hardened_json_404() {
    let Some(app) = app_or_skip().await else {
        return;
    };

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/definitely-not-a-route")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let headers = response.headers();
    assert_eq!(
        headers.get(header::X_CONTENT_TYPE_OPTIONS).unwrap(),
        "nosniff"
    );
    assert_eq!(headers.get(header::X_FRAME_OPTIONS).unwrap(), "DENY");
    assert!(headers.get(header::STRICT_TRANSPORT_SECURITY).is_some());
    assert!(headers.get(header::CONTENT_SECURITY_POLICY).is_some());
    assert_eq!(
        headers.get(header::CONTENT_TYPE).unwrap(),
        "application/json"
    );

    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert!(
        body["error"].is_string(),
        "normalized body must carry error"
    );
    let request_id = body["request_id"].as_str().expect("request_id echoed");
    assert_eq!(request_id.len(), 36, "minted id should be a UUID");
}

#[tokio::test]
async fn inbound_request_id_is_echoed_to_header_and_body() {
    let Some(app) = app_or_skip().await else {
        return;
    };

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/definitely-not-a-route")
                .header("x-request-id", "audit-req-123")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.headers()["x-request-id"], "audit-req-123");
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(body["request_id"], "audit-req-123");
}

#[tokio::test]
async fn hostile_request_id_is_replaced_not_reflected() {
    let Some(app) = app_or_skip().await else {
        return;
    };

    // Header-injection bait plus oversize — neither may pass through to logs
    // or the body.
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/definitely-not-a-route")
                .header("x-request-id", "x".repeat(500))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let echoed = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(echoed.len(), 36, "hostile id must be replaced with a UUID");
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(body["request_id"].as_str().unwrap(), echoed);
}
