//! Guest portal handlers
//!
//! Handles guest self-service features including pre-check-in.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    AutoCheckinResponse, GuestPortalBenefitsResponse, GuestPortalBookingResponse,
    GuestPortalBookingSummary, GuestPortalMembershipResponse, GuestPortalMeResponse,
    GuestPortalPage, GuestPortalPageQuery, GuestPortalTransaction, GuestPortalVerifyRequest,
    GuestPortalVerifyResponse, PreCheckInUpdateRequest,
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

/// POST /guest-portal/auto-checkin/:token
pub async fn auto_checkin_by_token(
    State(pool): State<DbPool>,
    Path(token): Path<String>,
) -> Result<Json<AutoCheckinResponse>, ApiError> {
    Ok(Json(
        guest_portal_service::auto_checkin_by_token(&pool, &token).await?,
    ))
}

// ---------------------------------------------------------------------------
// Session-authenticated guest-scoped read handlers
// ---------------------------------------------------------------------------

/// GET /guest-portal/me
pub async fn get_me(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<GuestPortalMeResponse>, ApiError> {
    let guest_id = guest_portal_service::require_guest_session(&headers, &pool).await?;
    Ok(Json(guest_portal_service::get_me(&pool, guest_id).await?))
}

/// GET /guest-portal/me/bookings
pub async fn get_my_bookings(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(page): Query<GuestPortalPageQuery>,
) -> Result<Json<GuestPortalPage<GuestPortalBookingSummary>>, ApiError> {
    let guest_id = guest_portal_service::require_guest_session(&headers, &pool).await?;
    let (limit, offset) = page.limit_offset();
    Ok(Json(
        guest_portal_service::get_my_bookings(&pool, guest_id, limit, offset).await?,
    ))
}

/// GET /guest-portal/me/transactions
pub async fn get_my_transactions(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(page): Query<GuestPortalPageQuery>,
) -> Result<Json<GuestPortalPage<GuestPortalTransaction>>, ApiError> {
    let guest_id = guest_portal_service::require_guest_session(&headers, &pool).await?;
    let (limit, offset) = page.limit_offset();
    Ok(Json(
        guest_portal_service::get_my_transactions(&pool, guest_id, limit, offset).await?,
    ))
}

/// GET /guest-portal/me/membership
pub async fn get_my_membership(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<GuestPortalMembershipResponse>, ApiError> {
    let guest_id = guest_portal_service::require_guest_session(&headers, &pool).await?;
    Ok(Json(
        guest_portal_service::get_my_membership(&pool, guest_id).await?,
    ))
}

/// GET /guest-portal/me/benefits
pub async fn get_my_benefits(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<GuestPortalBenefitsResponse>, ApiError> {
    let guest_id = guest_portal_service::require_guest_session(&headers, &pool).await?;
    Ok(Json(
        guest_portal_service::get_my_benefits(&pool, guest_id).await?,
    ))
}
