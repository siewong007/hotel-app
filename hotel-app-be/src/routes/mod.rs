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
// Loyalty routes live in modules::loyalty::routes (merged below).
pub mod maintenance;
pub mod night_audit;
pub mod passkey;
pub mod payment_retry;
pub mod payments;
pub mod profile;
pub mod rates;
pub mod rbac;
pub mod rooms;
pub mod search;
pub mod two_factor;
pub mod users;
pub mod webhooks;

use crate::core::config::{self, AllowedOrigins};
use crate::core::db::DbPool;
use crate::core::rate_limiter::RateLimiters;
use crate::core::{AuthService, middleware};
use axum::{
    Router,
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::get,
};
use std::net::{IpAddr, SocketAddr};
use tower::ServiceBuilder;
use tower_http::{
    catch_panic::CatchPanicLayer, cors::CorsLayer, services::ServeDir,
    set_header::SetResponseHeaderLayer, trace::TraceLayer,
};

/// Extract client IP from trusted proxy headers or the direct peer address.
///
/// `X-Forwarded-For` is parsed **right-to-left**: proxies append the peer they
/// saw, so the last entry is the only one this deployment's proxy added. The
/// leftmost entry is client-controlled; trusting it (the historical behaviour)
/// let one host rotate a spoofed IP per request and bypass every per-IP rate
/// limiter. Callers behind a proxy should also set
/// `header_up X-Forwarded-For {remote_host}` so the proxy replaces, rather
/// than appends to, whatever the client sent.
pub(crate) fn extract_client_ip(headers: &axum::http::HeaderMap, peer_addr: SocketAddr) -> IpAddr {
    extract_client_ip_with(config::get().trust_proxy_headers, headers, peer_addr)
}

/// Header carrying the browser's IANA timezone, used as the approximate
/// location shown against a signed-in device. Must stay in the CORS
/// `allow_headers` list below or the preflight fails for cross-origin
/// deployments only — green locally, broken in production.
pub(crate) const CLIENT_TIMEZONE_HEADER: &str = "x-client-timezone";

/// Reads the client-reported IANA timezone, or `None` when absent or malformed.
pub(crate) fn extract_client_timezone(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get(CLIENT_TIMEZONE_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(sanitize_client_timezone)
}

/// Accepts only IANA-zone-shaped values. This string is client-supplied and is
/// rendered back to the account owner, so it is validated rather than
/// truncated: anything unexpected is dropped instead of stored.
fn sanitize_client_timezone(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 64 {
        return None;
    }
    // "UTC" and "Asia/Kuala_Lumpur" are both valid; "America/Argentina/Salta"
    // is the deepest real shape, so cap at three segments.
    let segments: Vec<&str> = value.split('/').collect();
    if segments.len() > 3 {
        return None;
    }
    let segment_ok = |segment: &&str| {
        !segment.is_empty()
            && segment
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '+'))
    };
    if !segments.iter().all(segment_ok) {
        return None;
    }
    Some(value.to_string())
}

/// Pure core of [`extract_client_ip`], split out so the proxy-trust decision
/// has a deterministic unit test despite the process-global config.
fn extract_client_ip_with(
    trust_proxy_headers: bool,
    headers: &axum::http::HeaderMap,
    peer_addr: SocketAddr,
) -> IpAddr {
    if !trust_proxy_headers {
        return peer_addr.ip();
    }

    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.rsplit(',').next())
        .and_then(|s| s.trim().parse().ok())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.trim().parse().ok())
        })
        .unwrap_or_else(|| peer_addr.ip())
}

/// Session-bound JWTs are checked against their active refresh-session record
/// before any authenticated API handler runs. Guest portal bearer tokens use a
/// separate authentication scheme, so only a non-JWT bearer is allowed through
/// to the guest portal's own validator.
async fn enforce_active_session(
    State(pool): State<DbPool>,
    request: Request,
    next: Next,
) -> Response {
    let has_bearer_token = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("Bearer "));
    if !has_bearer_token {
        return next.run(request).await;
    }

    let claims = match middleware::extract_claims(request.headers()).await {
        Ok(claims) => claims,
        Err(_error) if request.uri().path().contains("/guest-portal/") => {
            return next.run(request).await;
        }
        Err(error) => return error.into_response(),
    };
    let Some(session_id) = claims.sid else {
        return crate::core::error::ApiError::Unauthorized(
            "Session-bound authentication is required".to_string(),
        )
        .into_response();
    };
    let Ok(user_id) = claims.sub.parse::<i64>() else {
        return crate::core::error::ApiError::Unauthorized("Invalid user ID in token".to_string())
            .into_response();
    };

    match AuthService::is_session_active(&pool, user_id, &session_id).await {
        Ok(true) => next.run(request).await,
        Ok(false) => {
            crate::core::error::ApiError::Unauthorized("Session has been logged out".to_string())
                .into_response()
        }
        Err(error) => {
            crate::core::error::ApiError::Database(format!("Session validation failed: {error}"))
                .into_response()
        }
    }
}

/// Handler for `CatchPanicLayer`: turn a panicked request task into the same
/// generic JSON 500 every other internal error returns. The panic payload is
/// logged server-side only.
fn panic_response(panic: Box<dyn std::any::Any + Send>) -> Response {
    let detail = panic
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".to_string());
    log::error!("Request handler panicked: {}", detail);
    crate::core::error::ApiError::Internal(format!("Request handler panicked: {detail}"))
        .into_response()
}

/// Rewrite error responses that never reached `ApiError` — extractor rejections,
/// unrouted-path 404s, method mismatches, body-size limits — into the same
/// `{"error": ...}` JSON shape every handled error returns. Status and headers
/// (CORS, security headers, Retry-After) are preserved; only the body changes.
/// Error responses already carrying a JSON body pass through untouched.
async fn normalize_error_response(response: Response) -> Response {
    let status = response.status();
    if !status.is_client_error() && !status.is_server_error() {
        return response;
    }
    let is_json = response
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/json"));
    if is_json {
        return response;
    }

    let message = match status {
        StatusCode::NOT_FOUND => "We couldn't find what you were looking for.",
        StatusCode::METHOD_NOT_ALLOWED => "That method isn't allowed here.",
        StatusCode::PAYLOAD_TOO_LARGE => "That request was too large.",
        StatusCode::UNSUPPORTED_MEDIA_TYPE => "That content type isn't supported.",
        s if s.is_client_error() => "That request couldn't be processed.",
        _ => "Something went wrong on our end. Please try again.",
    };

    let (mut parts, _) = response.into_parts();
    parts.headers.remove(axum::http::header::CONTENT_LENGTH);
    parts.headers.insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/json"),
    );
    Response::from_parts(
        parts,
        axum::body::Body::from(serde_json::json!({ "error": message }).to_string()),
    )
}

/// Count every request's status and latency into `core::metrics`.
///
/// This exists instead of raising `RUST_LOG` to capture request telemetry.
/// `TraceLayer` emits its spans at DEBUG while production runs `RUST_LOG=warn`
/// (`deploy/docker-compose.prod.yml`), so those events are filtered out; raising
/// the level globally would instead log every SQL statement, including guest
/// PII, into a file with no rotation. Counters give the alerter what it needs
/// (traffic volume, error rate, slow-request rate) at a fixed cost per request
/// and with no PII.
///
/// A 5xx is additionally logged at WARN so it survives production filtering and
/// leaves a line an operator can correlate with the counter.
async fn record_request_metrics(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let started = std::time::Instant::now();

    let response = next.run(request).await;

    let status = response.status();
    let elapsed_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    crate::core::metrics::record_response(status.as_u16(), elapsed_ms);

    if status.is_server_error() {
        log::warn!("{method} {path} -> {} in {elapsed_ms}ms", status.as_u16());
    }

    response
}

/// Health check handler.
///
/// Verifies the database connection pool can actually serve a query rather
/// than returning a hardcoded 200. The pool (not the HTTP listener) is what
/// is most likely to fail in production (DB restart, network partition,
/// exhausted connections), so a naive /health would falsely report healthy
/// while every real request 500s.
async fn health_handler(
    axum::extract::State(pool): axum::extract::State<DbPool>,
) -> impl axum::response::IntoResponse {
    match sqlx::query("SELECT 1").execute(&pool).await {
        Ok(_) => (
            axum::http::StatusCode::OK,
            axum::response::Json(serde_json::json!({"status": "ok"})),
        ),
        Err(err) => {
            log::error!("Health check failed: database unreachable: {err}");
            (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                axum::response::Json(
                    serde_json::json!({"status": "error", "message": "database unreachable"}),
                ),
            )
        }
    }
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
                    // Turnstile token on /auth/login and /auth/register. Omitting
                    // it breaks the preflight for cross-origin deployments only —
                    // the development branch above allows any header, so this is
                    // the kind of gap that ships green and 403s in production.
                    axum::http::HeaderName::from_static(
                        crate::services::turnstile::TURNSTILE_HEADER,
                    ),
                    axum::http::HeaderName::from_static(CLIENT_TIMEZONE_HEADER),
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
    let availability_hub = crate::modules::guest_booking::availability::AvailabilityHub::default();
    let support_hub = crate::modules::support::hub::SupportHub::default();
    let loyalty_hub = crate::modules::loyalty::hub::LoyaltyHub::default();

    // All domain routes live under the `/api` prefix so that frontend
    // navigation paths (e.g. `/bookings/123`) never collide with the API and
    // can be served by the SPA. Infra-facing routes (`/health`, `/ws/status`,
    // `/uploads`) stay at the root because Docker/desktop healthchecks and
    // static asset URLs depend on them.
    let api_routes = Router::new()
        .merge(auth::routes())
        .merge(payment_retry::routes())
        .merge(booking_channels::routes())
        .merge(rooms::routes())
        .merge(guests::routes())
        .merge(housekeeping::routes())
        .merge(maintenance::routes())
        .merge(bookings::routes())
        .merge(rates::routes())
        .merge(payments::routes())
        .merge(ledgers::routes())
        .merge(crate::modules::loyalty::routes::routes())
        .merge(crate::modules::promotions::routes::routes())
        .merge(crate::modules::communications::routes::routes())
        .merge(rbac::routes())
        .merge(users::routes())
        .merge(profile::routes())
        .merge(analytics::routes())
        .merge(crate::modules::settings::routes::routes())
        .merge(crate::modules::ekyc::routes::routes())
        .merge(crate::modules::support::routes::routes())
        .merge(crate::modules::teams::routes::routes())
        .merge(crate::modules::guest_booking::routes::routes())
        .merge(guest_portal::routes())
        .merge(companies::routes())
        .merge(audit::routes())
        .merge(search::routes())
        .merge(night_audit::routes())
        .merge(data_transfer::routes())
        .merge(passkey::routes())
        .merge(two_factor::routes())
        .merge(webhooks::routes())
        .layer(axum::middleware::from_fn_with_state(
            pool.clone(),
            enforce_active_session,
        ));

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
        .layer(axum::Extension(rate_limiters))
        .layer(axum::Extension(loyalty_hub))
        .layer(axum::Extension(availability_hub))
        .layer(axum::Extension(support_hub));

    // Add middleware layers
    app.layer(
        ServiceBuilder::new()
            // Outermost: a handler panic becomes the same JSON 500 every other
            // internal error produces, instead of an aborted connection.
            .layer(CatchPanicLayer::custom(panic_response))
            .layer(TraceLayer::new_for_http())
            // Normalizes error responses that never reached ApiError — extractor
            // rejections, unrouted-path 404s, body-size limits — into the
            // `{"error": ...}` shape clients always parse.
            .layer(axum::middleware::map_response(normalize_error_response))
            // Sits outside the router and the CORS layer, so it observes every
            // response on the way out: 404s for unrouted paths, 429s from the
            // per-route rate limiters, and CORS preflight replies alike.
            .layer(axum::middleware::from_fn(record_request_metrics))
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
                     script-src 'self' https://challenges.cloudflare.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com; \
                     style-src 'self' https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com; \
                     img-src 'self' data: https:; \
                     font-src 'self' data:; \
                     connect-src 'self' https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com; \
                     frame-src 'self' https://challenges.cloudflare.com https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com; \
                     frame-ancestors 'none';",
                ),
            ))
            .layer(SetResponseHeaderLayer::if_not_present(
                axum::http::header::REFERRER_POLICY,
                axum::http::HeaderValue::from_static("strict-origin-when-cross-origin"),
            )),
    )
}

#[cfg(test)]
mod client_timezone_tests {
    use super::sanitize_client_timezone;

    #[test]
    fn accepts_real_zone_shapes() {
        for zone in ["UTC", "Asia/Kuala_Lumpur", "America/Argentina/Salta", "Etc/GMT+8"] {
            assert_eq!(sanitize_client_timezone(zone).as_deref(), Some(zone));
        }
    }

    #[test]
    fn trims_surrounding_whitespace() {
        assert_eq!(
            sanitize_client_timezone("  Europe/London  ").as_deref(),
            Some("Europe/London")
        );
    }

    #[test]
    fn rejects_anything_not_zone_shaped() {
        // The value is stored and rendered back to the account owner, so
        // free-text, markup and over-long input are dropped, not truncated.
        for value in [
            "",
            "   ",
            "<script>alert(1)</script>",
            "Asia/Kuala Lumpur",
            "a/b/c/d",
            "Asia//Tokyo",
            "/Tokyo",
        ] {
            assert_eq!(sanitize_client_timezone(value), None, "accepted {value:?}");
        }
        assert_eq!(sanitize_client_timezone(&"A".repeat(65)), None);
    }
}

#[cfg(test)]
mod client_ip_tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    const PEER: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)), 5555);

    fn headers_with_xff(value: &str) -> axum::http::HeaderMap {
        axum::http::HeaderMap::from_iter([(
            axum::http::HeaderName::from_static("x-forwarded-for"),
            axum::http::HeaderValue::from_str(value).expect("valid header value"),
        )])
    }

    #[test]
    fn untrusted_proxy_ignores_forwarded_for_entirely() {
        let headers = headers_with_xff("203.0.113.9");
        assert_eq!(
            extract_client_ip_with(false, &headers, PEER),
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))
        );
    }

    #[test]
    fn trusted_proxy_takes_last_hop_not_the_client_controlled_first() {
        // The attacker sends "spoofed" as their X-Forwarded-For; the proxy
        // appends the real peer address. Only the last entry is trustworthy.
        let headers = headers_with_xff("203.0.113.9, 198.51.100.7");
        assert_eq!(
            extract_client_ip_with(true, &headers, PEER),
            IpAddr::V4(Ipv4Addr::new(198, 51, 100, 7))
        );
    }

    #[test]
    fn trusted_proxy_falls_back_to_peer_on_garbage_header() {
        let headers = headers_with_xff("not-an-ip");
        assert_eq!(
            extract_client_ip_with(true, &headers, PEER),
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))
        );
    }
}
