//! Guest portal handlers
//!
//! Handles guest self-service features including pre-check-in.

use std::net::SocketAddr;

use axum::{
    Json,
    extract::{ConnectInfo, Extension, Multipart, Path, Query, State},
    http::HeaderMap,
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::rate_limiter::RateLimiters;
use crate::models::{
    AutoCheckinResponse, GuestPortalBenefitsResponse, GuestPortalBookingResponse,
    GuestPortalBookingSummary, GuestPortalClaimAccountRequest, GuestPortalClaimAccountResponse,
    GuestPortalCreditsResponse, GuestPortalMeResponse, GuestPortalMembershipResponse,
    GuestPortalPage, GuestPortalPageQuery, GuestPortalTransaction, GuestPortalVerifyRequest,
    GuestPortalVerifyResponse, PreCheckInUpdateRequest,
};
use crate::modules::consent::service::ConsentContext;
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

/// POST /guest-portal/claim-account
///
/// Token in `X-Booking-Access-Token` only — this request carries a password, so
/// it is never accepted with the token in the URL.
pub async fn claim_account(
    State(pool): State<DbPool>,
    token: String,
    consent_context: ConsentContext,
    Json(request): Json<GuestPortalClaimAccountRequest>,
) -> Result<Json<GuestPortalClaimAccountResponse>, ApiError> {
    Ok(Json(
        guest_portal_service::claim_booking_account(&pool, &token, request, &consent_context)
            .await?,
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

/// PATCH /guest-portal/me/profile
pub async fn update_my_profile(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(input): Json<crate::models::GuestPortalProfileUpdate>,
) -> Result<Json<GuestPortalMeResponse>, ApiError> {
    let guest_id =
        guest_portal_service::require_guest_session_for_read(&headers, &pool, &limiters).await?;
    Ok(Json(
        guest_portal_service::update_my_profile(&pool, guest_id, input).await?,
    ))
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
        guest_portal_service::get_my_bookings(
            &pool,
            guest_id,
            limit,
            offset,
            page.search.as_deref(),
        )
        .await?,
    ))
}

pub async fn cancel_my_booking(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    Extension(hub): Extension<crate::modules::support::hub::SupportHub>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(booking_id): Path<i64>,
    Json(input): Json<crate::models::GuestBookingCancellationRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let guest_id =
        guest_portal_service::require_guest_session_for_read(&headers, &pool, &limiters).await?;
    let ip = crate::routes::extract_client_ip(&headers, peer_addr).to_string();
    Ok(Json(
        guest_portal_service::cancel_my_booking(
            &pool,
            &hub,
            guest_id,
            booking_id,
            input.reason,
            Some(ip),
            user_agent(&headers),
        )
        .await?,
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

/// GET /guest-portal/me/credits
pub async fn get_my_credits(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
) -> Result<Json<GuestPortalCreditsResponse>, ApiError> {
    let guest_id =
        guest_portal_service::require_guest_session_for_read(&headers, &pool, &limiters).await?;
    Ok(Json(
        guest_portal_service::get_my_credits(&pool, guest_id).await?,
    ))
}

// ---------------------------------------------------------------------------
// Guest payments (public config + session/token bank-transfer & PayPal)
// ---------------------------------------------------------------------------

/// GET /guest-portal/payment-config
///
/// Bank details and the PayPal client id. The route wrapper requires a booking
/// access token or a guest portal session before this runs.
pub async fn get_payment_config() -> Result<Json<crate::models::GuestPaymentConfig>, ApiError> {
    Ok(Json(crate::services::payments::guest_payment_config()))
}

/// Per-guest rate limit for the authenticated payment-write routes. Keyed on
/// `guest_id` (these are already authenticated, so IP keying is unnecessary).
/// Mirrors the 100-attempts-per-10-minutes payment limit used by the
/// unauthenticated routes.
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
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<crate::models::GuestBookingPaymentRequest>,
) -> Result<Json<crate::models::PaymentActionResponse>, ApiError> {
    let guest_id = guest_portal_service::require_guest_session(&headers, &pool).await?;
    check_guest_payment_rate_limit(&limiters, guest_id).await?;
    let context = ConsentContext::from_request(&headers, peer_addr);
    Ok(Json(
        guest_portal_service::session_bank_transfer(
            &pool,
            guest_id,
            input.booking_id,
            &input.consents,
            &context,
        )
        .await?,
    ))
}

/// Pull the `file` field out of a receipt upload.
///
/// Shared with the emailed recovery path so both routes agree on what counts
/// as a receipt upload; the size, type and payment-state checks live further
/// in, in `save_payment_receipt`.
pub(crate) async fn receipt_upload_bytes(mut multipart: Multipart) -> Result<Vec<u8>, ApiError> {
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|_| ApiError::BadRequest("Unable to read receipt upload.".to_string()))?
    {
        if field.name() == Some("file") {
            // Stream the field in chunks and abort past the size cap. The
            // `Multipart` extractor ignores `DefaultBodyLimit`, so `field.bytes()`
            // would buffer the whole upload before `save_payment_receipt` could
            // reject it — an unbounded memory sink on an authenticated route.
            // The cap mirrors the service check so the client-visible error is
            // identical either way.
            let mut bytes = Vec::new();
            while let Some(chunk) = field
                .chunk()
                .await
                .map_err(|_| ApiError::BadRequest("Unable to read receipt upload.".to_string()))?
            {
                if bytes.len() + chunk.len() > crate::services::payments::MAX_PAYMENT_RECEIPT_BYTES
                {
                    return Err(ApiError::BadRequest(
                        "Receipt file size must be between 1 byte and 10MB".to_string(),
                    ));
                }
                bytes.extend_from_slice(&chunk);
            }
            return Ok(bytes);
        }
    }
    Err(ApiError::BadRequest(
        "Select a receipt file to upload.".to_string(),
    ))
}

pub async fn session_upload_payment_receipt(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(payment_id): Path<i64>,
    multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    let guest_id = guest_portal_service::require_guest_session(&headers, &pool).await?;
    let bytes = receipt_upload_bytes(multipart).await?;
    guest_portal_service::session_upload_payment_receipt(&pool, guest_id, payment_id, &bytes)
        .await?;
    Ok(Json(serde_json::json!({ "uploaded": true })))
}

/// POST /guest-portal/me/payments/paypal/create-order
pub async fn session_paypal_create_order(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<crate::models::GuestBookingPaymentRequest>,
) -> Result<Json<crate::models::PaypalCreateOrderResponse>, ApiError> {
    let guest_id = guest_portal_service::require_guest_session(&headers, &pool).await?;
    check_guest_payment_rate_limit(&limiters, guest_id).await?;
    let context = ConsentContext::from_request(&headers, peer_addr);
    Ok(Json(
        guest_portal_service::session_create_paypal_order(
            &pool,
            guest_id,
            input.booking_id,
            &input.consents,
            &context,
        )
        .await?,
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
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(input): Json<crate::models::TokenPaymentRequest>,
) -> Result<Json<crate::models::PaymentActionResponse>, ApiError> {
    let context = ConsentContext::from_request(&headers, peer_addr);
    Ok(Json(
        guest_portal_service::token_bank_transfer(&pool, &token, &input.consents, &context).await?,
    ))
}

pub async fn token_upload_payment_receipt(
    State(pool): State<DbPool>,
    Path((token, payment_id)): Path<(String, i64)>,
    multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    let bytes = receipt_upload_bytes(multipart).await?;
    guest_portal_service::token_upload_payment_receipt(&pool, &token, payment_id, &bytes).await?;
    Ok(Json(serde_json::json!({ "uploaded": true })))
}

/// POST /guest-portal/booking/{token}/payments/paypal/create-order
pub async fn token_paypal_create_order(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(input): Json<crate::models::TokenPaymentRequest>,
) -> Result<Json<crate::models::PaypalCreateOrderResponse>, ApiError> {
    let context = ConsentContext::from_request(&headers, peer_addr);
    Ok(Json(
        guest_portal_service::token_create_paypal_order(&pool, &token, &input.consents, &context)
            .await?,
    ))
}

/// POST /guest-portal/booking/{token}/payments/paypal/capture
pub async fn token_paypal_capture(
    State(pool): State<DbPool>,
    Path(token): Path<String>,
    Json(input): Json<crate::models::PaypalCaptureRequest>,
) -> Result<Json<crate::models::PaymentActionResponse>, ApiError> {
    Ok(Json(
        guest_portal_service::token_capture_paypal(
            &pool,
            &token,
            &input.order_id,
            input.payment_id,
        )
        .await?,
    ))
}

fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::extract::FromRequest;
    use axum::http::Request;

    async fn receipt_multipart(payload: &[u8]) -> Multipart {
        let boundary = "testboundary";
        let mut body = format!(
            "--{boundary}\r\ncontent-disposition: form-data; name=\"file\"; \
             filename=\"receipt.bin\"\r\ncontent-type: application/octet-stream\r\n\r\n"
        )
        .into_bytes();
        body.extend_from_slice(payload);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let request = Request::builder()
            .method("POST")
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(body))
            .unwrap();
        // `()` satisfies the state bound; Multipart never reads it.
        Multipart::from_request(request, &()).await.unwrap()
    }

    #[tokio::test]
    async fn receipt_upload_accepts_small_file() {
        let bytes = receipt_upload_bytes(receipt_multipart(b"tiny").await)
            .await
            .unwrap();
        assert_eq!(bytes, b"tiny");
    }

    #[tokio::test]
    async fn receipt_upload_rejects_oversized_field() {
        // Past the cap the read must fail rather than buffer the whole field —
        // `field.bytes()` used to allow unbounded memory growth. In this
        // harness the request carries no DefaultBodyLimit extension, so
        // axum's 2MB multipart default trips first; on the real routes the
        // 10MB route layer and the per-field MAX_PAYMENT_RECEIPT_BYTES check
        // bound it identically.
        let payload = vec![b'x'; crate::services::payments::MAX_PAYMENT_RECEIPT_BYTES + 1];
        let err = receipt_upload_bytes(receipt_multipart(&payload).await)
            .await
            .unwrap_err();
        assert!(
            matches!(err, ApiError::BadRequest(_)),
            "expected BadRequest, got {err:?}"
        );
    }

    #[tokio::test]
    async fn receipt_upload_missing_file_field() {
        let boundary = "testboundary";
        let body = format!("--{boundary}--\r\n");
        let request = Request::builder()
            .method("POST")
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(body))
            .unwrap();
        let multipart = Multipart::from_request(request, &()).await.unwrap();
        let err = receipt_upload_bytes(multipart).await.unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(_)));
    }
}
