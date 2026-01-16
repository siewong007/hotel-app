//! Guest portal routes
//!
//! Public routes for guest self-service features.

use axum::{
    routing::{get, post},
    Router,
    extract::{State, Path},
    response::Json,
};
use crate::core::db::DbPool;
use crate::handlers;
use crate::models;
use crate::core::error::ApiError;

/// Create guest portal routes (no authentication required)
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/guest-portal/verify", post(verify_booking))
        .route("/guest-portal/booking/:token", get(get_booking))
        .route("/guest-portal/pre-checkin/:token", post(submit_precheckin))
}

async fn verify_booking(
    State(pool): State<DbPool>,
    Json(input): Json<handlers::guest_portal::GuestPortalVerifyRequest>,
) -> Result<Json<handlers::guest_portal::GuestPortalVerifyResponse>, ApiError> {
    handlers::guest_portal::verify_guest_booking(State(pool), Json(input)).await
}

async fn get_booking(
    State(pool): State<DbPool>,
    path: Path<String>,
) -> Result<Json<handlers::guest_portal::GuestPortalBookingResponse>, ApiError> {
    handlers::guest_portal::get_booking_by_token(State(pool), path).await
}

async fn submit_precheckin(
    State(pool): State<DbPool>,
    path: Path<String>,
    Json(input): Json<models::PreCheckInUpdateRequest>,
) -> Result<Json<handlers::guest_portal::GuestPortalBookingResponse>, ApiError> {
    handlers::guest_portal::submit_precheckin_update(State(pool), path, Json(input)).await
}
