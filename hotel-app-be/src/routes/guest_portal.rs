//! Guest portal routes
//!
//! Guest self-service routes.

use super::extract_client_ip;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::rate_limiter::RateLimiters;
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{ConnectInfo, Extension, Path, State},
    http::HeaderMap,
    response::Json,
    routing::{get, post},
};
use std::net::SocketAddr;

/// Create guest portal routes.
///
/// The pre-check-in routes are unauthenticated (path-token gated). Guest portal
/// sessions are created only after normal account authentication; the `/me/*`
/// routes require a valid guest bearer session.
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/guest-portal/verify", post(verify_booking))
        .route("/guest-portal/booking/{token}", get(get_booking))
        .route("/guest-portal/pre-checkin/{token}", post(submit_precheckin))
        .route("/guest-portal/auto-checkin/{token}", post(auto_checkin))
        .route("/guest-portal/session", post(create_session))
        .route("/guest-portal/me", get(handlers::guest_portal::get_me))
        .route(
            "/guest-portal/me/bookings",
            get(handlers::guest_portal::get_my_bookings)
                .post(crate::modules::guest_booking::handlers::create_booking_handler),
        )
        .route(
            "/guest-portal/me/transactions",
            get(handlers::guest_portal::get_my_transactions),
        )
        .route(
            "/guest-portal/me/membership",
            get(handlers::guest_portal::get_my_membership),
        )
        .route(
            "/guest-portal/me/benefits",
            get(handlers::guest_portal::get_my_benefits),
        )
}

async fn create_session(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<models::GuestPortalLoginResponse>, ApiError> {
    let user_id = crate::core::middleware::require_auth(&headers).await?;
    let ip = extract_client_ip(&headers, peer_addr);
    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let response = crate::services::guest_portal::create_authenticated_guest_portal_session(
        &pool,
        user_id,
        Some(ip.to_string()),
        user_agent,
    )
    .await?;
    Ok(Json(response))
}

async fn verify_booking(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<models::GuestPortalVerifyRequest>,
) -> Result<Json<models::GuestPortalVerifyResponse>, ApiError> {
    let ip = extract_client_ip(&headers, peer_addr);
    let (allowed, retry_after) = limiters.guest_portal_verify.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many guest portal verification attempts. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }

    let booking_key = input.booking_number.trim().to_ascii_uppercase();
    let booking_key = if booking_key.is_empty() {
        "<empty>".to_string()
    } else {
        booking_key
    };
    let (allowed, retry_after) = limiters
        .guest_portal_booking
        .check_with_retry(booking_key)
        .await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many attempts for this booking. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }

    handlers::guest_portal::verify_guest_booking(State(pool), Json(input)).await
}

async fn get_booking(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    path: Path<String>,
) -> Result<Json<models::GuestPortalBookingResponse>, ApiError> {
    let (allowed, retry_after) = limiters
        .guest_portal_token_read
        .check_with_retry(path.0.clone())
        .await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many requests for this booking link. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }

    handlers::guest_portal::get_booking_by_token(State(pool), path).await
}

async fn submit_precheckin(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    path: Path<String>,
    Json(input): Json<models::PreCheckInUpdateRequest>,
) -> Result<Json<models::GuestPortalBookingResponse>, ApiError> {
    let (allowed, retry_after) = limiters
        .guest_portal_token
        .check_with_retry(path.0.clone())
        .await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many pre-check-in attempts for this booking. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }

    handlers::guest_portal::submit_precheckin_update(State(pool), path, Json(input)).await
}

async fn auto_checkin(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    path: Path<String>,
) -> Result<Json<models::AutoCheckinResponse>, ApiError> {
    let (allowed, retry_after) = limiters
        .guest_portal_token
        .check_with_retry(path.0.clone())
        .await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many check-in attempts for this booking. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }

    handlers::guest_portal::auto_checkin_by_token(State(pool), path).await
}
