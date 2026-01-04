//! Route definitions organized by domain
//!
//! This module provides a modular structure for routes.
//! Each submodule defines routes for a specific domain.

pub mod analytics;
pub mod audit;
pub mod auth;
pub mod bookings;
pub mod companies;
pub mod ekyc;
pub mod guest_portal;
pub mod guests;
pub mod ledgers;
pub mod loyalty;
pub mod night_audit;
pub mod payments;
pub mod profile;
pub mod rates;
pub mod rbac;
pub mod rooms;
pub mod settings;

use axum::{http::Method, routing::get, Router};
use sqlx::PgPool;
use tower::ServiceBuilder;
use tower_http::{
    cors::CorsLayer,
    services::ServeDir,
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};

/// Health check handler
async fn health_handler() -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::json!({"status": "ok"}))
}

/// WebSocket status handler
async fn websocket_status_handler() -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::json!({"status": "connected"}))
}

/// Create the complete application router by composing all domain routes
pub fn create_router(pool: PgPool) -> Router {
    // Get allowed origins from environment variable
    let allowed_origins = std::env::var("ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:3000,http://localhost:5173".to_string());

    let origins: Vec<axum::http::HeaderValue> = allowed_origins
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    log::info!("CORS allowed origins: {:?}", origins);

    // CORS configuration
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_credentials(true);

    // Build all routes
    let app = Router::new()
        // Public routes
        .route("/health", get(health_handler))
        .route("/ws/status", get(websocket_status_handler))
        // Serve static files from uploads directory
        .nest_service("/uploads", ServeDir::new("uploads"))
        // Merge all domain routes
        .merge(auth::routes())
        .merge(rooms::routes())
        .merge(guests::routes())
        .merge(bookings::routes())
        .merge(rates::routes())
        .merge(payments::routes())
        .merge(ledgers::routes())
        .merge(loyalty::routes())
        .merge(rbac::routes())
        .merge(profile::routes())
        .merge(analytics::routes())
        .merge(settings::routes())
        .merge(ekyc::routes())
        .merge(guest_portal::routes())
        .merge(companies::routes())
        .merge(audit::routes())
        .merge(night_audit::routes())
        .with_state(pool);

    // Add middleware layers
    app.layer(
        ServiceBuilder::new()
            .layer(TraceLayer::new_for_http())
            .layer(cors)
            // Security headers
            .layer(SetResponseHeaderLayer::if_not_present(
                axum::http::header::STRICT_TRANSPORT_SECURITY,
                axum::http::HeaderValue::from_static("max-age=31536000; includeSubDomains"),
            ))
            .layer(SetResponseHeaderLayer::if_not_present(
                axum::http::header::X_CONTENT_TYPE_OPTIONS,
                axum::http::HeaderValue::from_static("nosniff"),
            ))
            .layer(SetResponseHeaderLayer::if_not_present(
                axum::http::header::X_FRAME_OPTIONS,
                axum::http::HeaderValue::from_static("DENY"),
            ))
            .layer(SetResponseHeaderLayer::if_not_present(
                axum::http::header::X_XSS_PROTECTION,
                axum::http::HeaderValue::from_static("1; mode=block"),
            ))
            .layer(SetResponseHeaderLayer::if_not_present(
                axum::http::header::CONTENT_SECURITY_POLICY,
                axum::http::HeaderValue::from_static(
                    "default-src 'self'; \
                     script-src 'self' 'unsafe-inline' 'unsafe-eval'; \
                     style-src 'self' 'unsafe-inline'; \
                     img-src 'self' data: https:; \
                     font-src 'self' data:; \
                     connect-src 'self'; \
                     frame-ancestors 'none';",
                ),
            ))
            .layer(SetResponseHeaderLayer::if_not_present(
                axum::http::header::REFERRER_POLICY,
                axum::http::HeaderValue::from_static("strict-origin-when-cross-origin"),
            )),
    )
}
