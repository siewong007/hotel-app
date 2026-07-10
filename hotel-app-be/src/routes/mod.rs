//! Route definitions organized by domain
//!
//! This module provides a modular structure for routes.
//! Each submodule defines routes for a specific domain.

pub mod analytics;
pub mod audit;
pub mod auth;
pub mod booking_channels;
pub mod bookings;
pub mod companies;
pub mod data_transfer;
// eKYC routes now live in modules::ekyc::routes
// (the old routes/ekyc.rs file is preserved for backward reference during migration)
pub mod guest_portal;
pub mod guests;
pub mod housekeeping;
pub mod ledgers;
// Loyalty routes now live in modules::loyalty::routes (merged below); the old
// routes/loyalty.rs file is preserved on disk for backward reference during
// migration but is no longer wired into the router.
#[allow(dead_code)]
pub mod loyalty;
pub mod night_audit;
pub mod passkey;
pub mod payments;
pub mod profile;
pub mod rates;
pub mod rbac;
pub mod rooms;
pub mod search;
pub mod two_factor;

use crate::core::config::{self, AllowedOrigins};
use crate::core::db::DbPool;
use crate::core::rate_limiter::RateLimiters;
use axum::{Router, http::Method, routing::get};
use std::net::{IpAddr, SocketAddr};
use tower::ServiceBuilder;
use tower_http::{
    cors::CorsLayer, services::ServeDir, set_header::SetResponseHeaderLayer, trace::TraceLayer,
};

/// Extract client IP from trusted proxy headers or the direct peer address.
pub(crate) fn extract_client_ip(headers: &axum::http::HeaderMap, peer_addr: SocketAddr) -> IpAddr {
    if !config::get().trust_proxy_headers {
        return peer_addr.ip();
    }

    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .and_then(|s| s.trim().parse().ok())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.trim().parse().ok())
        })
        .unwrap_or_else(|| peer_addr.ip())
}

/// Health check handler
async fn health_handler() -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::json!({"status": "ok"}))
}

/// WebSocket status handler
async fn websocket_status_handler() -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::json!({"status": "connected"}))
}

/// Create the complete application router by composing all domain routes
pub fn create_router(pool: DbPool) -> Router {
    let allowed_origins = &config::get().allowed_origins;

    // CORS configuration - use permissive settings for desktop app (when "*" is specified)
    // or specific origins for web deployment
    let cors = match allowed_origins {
        AllowedOrigins::Any => {
            log::info!("Using permissive CORS (allow any origin) for desktop mode");
            CorsLayer::new()
                .allow_origin(tower_http::cors::Any)
                .allow_headers(tower_http::cors::Any)
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::PATCH,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
        }
        AllowedOrigins::List(origins) => {
            log::info!("CORS allowed origins: {:?}", origins);

            CorsLayer::new()
                .allow_origin(origins.clone())
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
                .allow_credentials(true)
        }
    };

    // Initialize rate limiters
    let rate_limiters = RateLimiters::new();

    // All domain routes live under the `/api` prefix so that frontend
    // navigation paths (e.g. `/bookings/123`) never collide with the API and
    // can be served by the SPA. Infra-facing routes (`/health`, `/ws/status`,
    // `/uploads`) stay at the root because Docker/desktop healthchecks and
    // static asset URLs depend on them.
    let api_routes = Router::new()
        .merge(auth::routes())
        .merge(booking_channels::routes())
        .merge(rooms::routes())
        .merge(guests::routes())
        .merge(housekeeping::routes())
        .merge(bookings::routes())
        .merge(rates::routes())
        .merge(payments::routes())
        .merge(ledgers::routes())
        .merge(crate::modules::loyalty::routes::routes())
        .merge(rbac::routes())
        .merge(profile::routes())
        .merge(analytics::routes())
        .merge(crate::modules::settings::routes::routes())
        .merge(crate::modules::ekyc::routes::routes())
        .merge(guest_portal::routes())
        .merge(companies::routes())
        .merge(audit::routes())
        .merge(search::routes())
        .merge(night_audit::routes())
        .merge(data_transfer::routes())
        .merge(passkey::routes())
        .merge(two_factor::routes());

    // Build all routes
    let app = Router::new()
        // Public routes
        .route("/health", get(health_handler))
        .route("/ws/status", get(websocket_status_handler))
        // Serve only explicitly public uploads. Sensitive documents use authenticated routes.
        .nest_service("/uploads", ServeDir::new("uploads/public"))
        // Merge all domain routes under /api
        .nest("/api", api_routes)
        .with_state(pool)
        .layer(axum::Extension(rate_limiters));

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
                     script-src 'self'; \
                     style-src 'self'; \
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
