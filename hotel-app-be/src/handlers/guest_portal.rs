//! Guest portal handlers
//!
//! Handles guest self-service features including pre-check-in.

use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::rate_limiter::RateLimiters;
use crate::models::{
    AutoCheckinResponse, GuestPortalBenefitsResponse, GuestPortalBookingResponse,
    GuestPortalBookingSummary, GuestPortalMeResponse, GuestPortalMembershipResponse,
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

/// POST /guest-portal/logout
pub async fn logout(State(pool): State<DbPool>, headers: HeaderMap) -> Result<(), ApiError> {
    guest_portal_service::logout_guest_session(&headers, &pool).await
}

// ---------------------------------------------------------------------------
// Session-authenticated guest-scoped read handlers
// ---------------------------------------------------------------------------

/// GET /guest-portal/me
pub async fn get_me(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
) -> Result<Json<GuestPortalMeResponse>, ApiError> {
    let guest_id =
        guest_portal_service::require_guest_session_for_read(&headers, &pool, &limiters).await?;
    Ok(Json(guest_portal_service::get_me(&pool, guest_id).await?))
}

/// GET /guest-portal/me/bookings
pub async fn get_my_bookings(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Query(page): Query<GuestPortalPageQuery>,
) -> Result<Json<GuestPortalPage<GuestPortalBookingSummary>>, ApiError> {
    let guest_id =
        guest_portal_service::require_guest_session_for_read(&headers, &pool, &limiters).await?;
    let (limit, offset) = page.limit_offset();
    Ok(Json(
        guest_portal_service::get_my_bookings(&pool, guest_id, limit, offset).await?,
    ))
}

pub async fn cancel_my_booking(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Path(booking_id): Path<i64>,
    Json(input): Json<crate::models::GuestBookingCancellationRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let guest_id =
        guest_portal_service::require_guest_session_for_read(&headers, &pool, &limiters).await?;
    Ok(Json(
        guest_portal_service::cancel_my_booking(&pool, guest_id, booking_id, input.reason).await?,
    ))
}

/// GET /guest-portal/me/transactions
pub async fn get_my_transactions(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Query(page): Query<GuestPortalPageQuery>,
) -> Result<Json<GuestPortalPage<GuestPortalTransaction>>, ApiError> {
    let guest_id =
        guest_portal_service::require_guest_session_for_read(&headers, &pool, &limiters).await?;
    let (limit, offset) = page.limit_offset();
    Ok(Json(
        guest_portal_service::get_my_transactions(&pool, guest_id, limit, offset).await?,
    ))
}

/// GET /guest-portal/me/membership
pub async fn get_my_membership(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
) -> Result<Json<GuestPortalMembershipResponse>, ApiError> {
    let guest_id =
        guest_portal_service::require_guest_session_for_read(&headers, &pool, &limiters).await?;
    Ok(Json(
        guest_portal_service::get_my_membership(&pool, guest_id).await?,
    ))
}

/// GET /guest-portal/me/benefits
pub async fn get_my_benefits(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
) -> Result<Json<GuestPortalBenefitsResponse>, ApiError> {
    let guest_id =
        guest_portal_service::require_guest_session_for_read(&headers, &pool, &limiters).await?;
    Ok(Json(
        guest_portal_service::get_my_benefits(&pool, guest_id).await?,
    ))
}

// ---------------------------------------------------------------------------
// Guest payments (public config + session/token bank-transfer & PayPal)
// ---------------------------------------------------------------------------

/// GET /guest-portal/payment-config (public)
pub async fn get_payment_config()
-> Result<Json<crate::models::GuestPaymentConfig>, ApiError> {
    Ok(Json(crate::services::payments::guest_payment_config()))
}

/// Per-guest rate limit for the authenticated payment-write routes. Keyed on
/// `guest_id` (these are already authenticated, so IP keying is unnecessary).
/// Mirrors the per-token payment limit used by the unauthenticated routes.
async fn check_guest_payment_rate_limit(
    limiters: &RateLimiters,
    guest_id: i64,
) -> Result<(), ApiError> {
    let (allowed, retry_after) = limiters
        .guest_portal_payment
        .check_with_retry(guest_id.to_string())
        .await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many payment attempts. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    Ok(())
}

/// POST /guest-portal/me/payments/bank-transfer
pub async fn session_bank_transfer(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(input): Json<crate::models::GuestBookingPaymentRequest>,
) -> Result<Json<crate::models::PaymentActionResponse>, ApiError> {
    let guest_id = guest_portal_service::require_guest_session(&headers, &pool).await?;
    check_guest_payment_rate_limit(&limiters, guest_id).await?;
    Ok(Json(
        guest_portal_service::session_bank_transfer(&pool, guest_id, input.booking_id).await?,
    ))
}

/// POST /guest-portal/me/payments/paypal/create-order
pub async fn session_paypal_create_order(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(input): Json<crate::models::GuestBookingPaymentRequest>,
) -> Result<Json<crate::models::PaypalCreateOrderResponse>, ApiError> {
    let guest_id = guest_portal_service::require_guest_session(&headers, &pool).await?;
    check_guest_payment_rate_limit(&limiters, guest_id).await?;
    Ok(Json(
        guest_portal_service::session_create_paypal_order(&pool, guest_id, input.booking_id).await?,
    ))
}

/// POST /guest-portal/me/payments/paypal/capture
pub async fn session_paypal_capture(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(input): Json<crate::models::SessionPaypalCaptureRequest>,
) -> Result<Json<crate::models::PaymentActionResponse>, ApiError> {
    let guest_id = guest_portal_service::require_guest_session(&headers, &pool).await?;
    check_guest_payment_rate_limit(&limiters, guest_id).await?;
    Ok(Json(
        guest_portal_service::session_capture_paypal(
            &pool,
            guest_id,
            input.booking_id,
            &input.order_id,
            input.payment_id,
        )
        .await?,
    ))
}

/// POST /guest-portal/booking/{token}/payments/bank-transfer
pub async fn token_bank_transfer(
    State(pool): State<DbPool>,
    Path(token): Path<String>,
) -> Result<Json<crate::models::PaymentActionResponse>, ApiError> {
    Ok(Json(
        guest_portal_service::token_bank_transfer(&pool, &token).await?,
    ))
}

/// POST /guest-portal/booking/{token}/payments/paypal/create-order
pub async fn token_paypal_create_order(
    State(pool): State<DbPool>,
    Path(token): Path<String>,
) -> Result<Json<crate::models::PaypalCreateOrderResponse>, ApiError> {
    Ok(Json(
        guest_portal_service::token_create_paypal_order(&pool, &token).await?,
    ))
}

/// POST /guest-portal/booking/{token}/payments/paypal/capture
pub async fn token_paypal_capture(
    State(pool): State<DbPool>,
    Path(token): Path<String>,
    Json(input): Json<crate::models::PaypalCaptureRequest>,
) -> Result<Json<crate::models::PaymentActionResponse>, ApiError> {
    Ok(Json(
        guest_portal_service::token_capture_paypal(&pool, &token, &input.order_id, input.payment_id)
            .await?,
    ))
}
