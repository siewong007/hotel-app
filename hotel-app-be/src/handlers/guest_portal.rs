//! Guest portal handlers
//!
//! Handles guest self-service features including pre-check-in.

use axum::{
    Json,
    extract::{Path, State},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    GuestPortalBookingResponse, GuestPortalVerifyRequest, GuestPortalVerifyResponse,
    PreCheckInUpdateRequest,
};
use crate::services::guest_portal as guest_portal_service;

/// POST /guest-portal/verify
pub async fn verify_guest_booking(
    State(pool): State<DbPool>,
    Json(request): Json<GuestPortalVerifyRequest>,
) -> Result<Json<GuestPortalVerifyResponse>, ApiError> {
    Ok(Json(
        guest_portal_service::verify_guest_booking(&pool, request).await?,
    ))
}

/// GET /guest-portal/booking/:token
pub async fn get_booking_by_token(
    State(pool): State<DbPool>,
    Path(token): Path<String>,
) -> Result<Json<GuestPortalBookingResponse>, ApiError> {
    Ok(Json(
        guest_portal_service::get_booking_by_token(&pool, &token).await?,
    ))
}

/// POST /guest-portal/pre-checkin/:token
pub async fn submit_precheckin_update(
    State(pool): State<DbPool>,
    Path(token): Path<String>,
    Json(request): Json<PreCheckInUpdateRequest>,
) -> Result<Json<GuestPortalBookingResponse>, ApiError> {
    Ok(Json(
        guest_portal_service::submit_precheckin_update(&pool, &token, request).await?,
    ))
}
