//! Guest portal routes
//!
//! Public routes for guest self-service features.

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

/// Create guest portal routes (no authentication required)
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/guest-portal/verify", post(verify_booking))
        .route("/guest-portal/booking/{token}", get(get_booking))
        .route("/guest-portal/pre-checkin/{token}", post(submit_precheckin))
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
    path: Path<String>,
) -> Result<Json<models::GuestPortalBookingResponse>, ApiError> {
    handlers::guest_portal::get_booking_by_token(State(pool), path).await
}

async fn submit_precheckin(
    State(pool): State<DbPool>,
    path: Path<String>,
    Json(input): Json<models::PreCheckInUpdateRequest>,
) -> Result<Json<models::GuestPortalBookingResponse>, ApiError> {
    handlers::guest_portal::submit_precheckin_update(State(pool), path, Json(input)).await
}
