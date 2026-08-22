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
    extract::DefaultBodyLimit,
    extract::{ConnectInfo, Extension, Multipart, Path, State},
    http::HeaderMap,
    response::Json,
    routing::{get, post},
};
use std::net::SocketAddr;

/// Body cap for the portal's multipart upload routes (payment receipt proofs
/// and eKYC identity documents). A phone photo of a passport routinely exceeds
/// axum's 2MB default, which would reject the request before any handler runs.
///
/// Applied per-route rather than to the whole router on purpose: a router-wide
/// layer would also raise the ceiling on the unauthenticated, token-gated
/// `/guest-portal/pre-checkin/{token}` route, widening a DoS surface for no
/// benefit. (A router-wide `.layer()` call placed before the `.route()` calls —
/// as this file previously had — silently applies to nothing, because axum maps
/// the layer over the routes already registered at that point.)
const UPLOAD_BODY_LIMIT: usize = 10 * 1024 * 1024;

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
        .route("/guest-portal/logout", post(handlers::guest_portal::logout))
        .route("/guest-portal/me", get(handlers::guest_portal::get_me))
        .route(
            "/guest-portal/me/bookings",
            get(handlers::guest_portal::get_my_bookings)
                .post(crate::modules::guest_booking::handlers::create_booking_handler),
        )
        .route(
            "/guest-portal/me/bookings/{id}/cancel",
            post(handlers::guest_portal::cancel_my_booking),
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
        .route(
            "/guest-portal/me/credits",
            get(handlers::guest_portal::get_my_credits),
        )
        // Public payment configuration (PayPal client id + bank details).
        .route(
            "/guest-portal/payment-config",
            get(handlers::guest_portal::get_payment_config),
        )
        // Session-authenticated guest payments.
        .route(
            "/guest-portal/me/payments/bank-transfer",
            post(handlers::guest_portal::session_bank_transfer),
        )
        .route(
            "/guest-portal/me/payments/{payment_id}/receipt",
            post(handlers::guest_portal::session_upload_payment_receipt)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT)),
        )
        // Self-service identity verification (eKYC) for the signed-in guest.
        .route(
            "/guest-portal/me/ekyc",
            get(crate::modules::ekyc::portal::get_status_handler),
        )
        .route(
            "/guest-portal/me/ekyc/documents",
            post(crate::modules::ekyc::portal::upload_document_handler)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT)),
        )
        .route(
            "/guest-portal/me/ekyc/submit",
            post(crate::modules::ekyc::portal::submit_handler),
        )
        .route(
            "/guest-portal/me/payments/paypal/create-order",
            post(handlers::guest_portal::session_paypal_create_order),
        )
        .route(
            "/guest-portal/me/payments/paypal/capture",
            post(handlers::guest_portal::session_paypal_capture),
        )
        // Unauthenticated token-based guest payments (rate limited per token).
        .route(
            "/guest-portal/booking/{token}/payments/bank-transfer",
            post(token_bank_transfer),
        )
        .route(
            "/guest-portal/booking/{token}/payments/{payment_id}/receipt",
            post(token_upload_payment_receipt).layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT)),
        )
        .route(
            "/guest-portal/booking/{token}/payments/paypal/create-order",
            post(token_paypal_create_order),
        )
        .route(
            "/guest-portal/booking/{token}/payments/paypal/capture",
            post(token_paypal_capture),
        )
}

/// Allow up to 100 payment-write requests per booking link in 10 minutes,
/// returning a `429` with `Retry-After` when exceeded. Payment traffic uses a
/// dedicated limit so it does not consume the stricter pre-check-in budget.
async fn check_token_payment_rate_limit(
    limiters: &RateLimiters,
    token: &str,
) -> Result<(), ApiError> {
    let (allowed, retry_after) = limiters
        .guest_portal_token_payment
        .check_with_retry(token.to_string())
        .await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many payment attempts for this booking. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    Ok(())
}

async fn token_bank_transfer(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    path: Path<String>,
) -> Result<Json<models::PaymentActionResponse>, ApiError> {
    check_token_payment_rate_limit(&limiters, &path.0).await?;
    handlers::guest_portal::token_bank_transfer(State(pool), path).await
}

async fn token_upload_payment_receipt(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    Path((token, payment_id)): Path<(String, i64)>,
    multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    check_token_payment_rate_limit(&limiters, &token).await?;
    handlers::guest_portal::token_upload_payment_receipt(
        State(pool),
        Path((token, payment_id)),
        multipart,
    )
    .await
}

async fn token_paypal_create_order(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    path: Path<String>,
) -> Result<Json<models::PaypalCreateOrderResponse>, ApiError> {
    check_token_payment_rate_limit(&limiters, &path.0).await?;
    handlers::guest_portal::token_paypal_create_order(State(pool), path).await
}

async fn token_paypal_capture(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    path: Path<String>,
    body: Json<models::PaypalCaptureRequest>,
) -> Result<Json<models::PaymentActionResponse>, ApiError> {
    check_token_payment_rate_limit(&limiters, &path.0).await?;
    handlers::guest_portal::token_paypal_capture(State(pool), path, body).await
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

    // booking_number is varchar(50); anything longer is garbage that could
    // never match, so bound the limiter key before it allocates an entry.
    if input.booking_number.len() > 50 {
        return Err(ApiError::BadRequest("Invalid booking number.".to_string()));
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

/// Shape-check an unauthenticated portal path token BEFORE it reaches the
/// keyed rate limiter. Portal tokens are 64-char hex (`generate_portal_token`),
/// so anything longer than 128 chars or containing non-hex characters can
/// never match a real booking — but left unchecked, each distinct value would
/// allocate a keyed-limiter entry (up to hyper's ~400KB per header) and live
/// for the full window, making the limiter map itself the DoS target.
fn ensure_plausible_portal_token(token: &str) -> Result<(), ApiError> {
    let plausible = !token.is_empty()
        && token.len() <= 128
        && token.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    if plausible {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "This booking link is invalid.".to_string(),
        ))
    }
}

async fn get_booking(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    path: Path<String>,
) -> Result<Json<models::GuestPortalBookingResponse>, ApiError> {
    ensure_plausible_portal_token(&path.0)?;
    let ip = extract_client_ip(&headers, peer_addr);
    if !limiters.guest_portal_token_ip.check(ip).await {
        return Err(ApiError::TooManyRequestsRetryAfter(
            "Too many requests. Please try again later.".to_string(),
            900,
        ));
    }
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
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    path: Path<String>,
    Json(input): Json<models::PreCheckInUpdateRequest>,
) -> Result<Json<models::GuestPortalBookingResponse>, ApiError> {
    ensure_plausible_portal_token(&path.0)?;
    let ip = extract_client_ip(&headers, peer_addr);
    if !limiters.guest_portal_token_ip.check(ip).await {
        return Err(ApiError::TooManyRequestsRetryAfter(
            "Too many requests. Please try again later.".to_string(),
            900,
        ));
    }
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
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    path: Path<String>,
) -> Result<Json<models::AutoCheckinResponse>, ApiError> {
    ensure_plausible_portal_token(&path.0)?;
    let ip = extract_client_ip(&headers, peer_addr);
    if !limiters.guest_portal_token_ip.check(ip).await {
        return Err(ApiError::TooManyRequestsRetryAfter(
            "Too many requests. Please try again later.".to_string(),
            900,
        ));
    }
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

#[cfg(test)]
mod portal_token_shape_tests {
    use super::ensure_plausible_portal_token;

    #[test]
    fn accepts_minted_hex_token() {
        let token = "a".repeat(64);
        assert!(ensure_plausible_portal_token(&token).is_ok());
        // uuid-shaped legacy tokens stay plausible too.
        assert!(ensure_plausible_portal_token("3f2b-4c1d-9e8f-0a1b").is_ok());
    }

    #[test]
    fn rejects_empty_oversized_and_non_hex_tokens() {
        assert!(ensure_plausible_portal_token("").is_err());
        assert!(ensure_plausible_portal_token(&"a".repeat(129)).is_err());
        assert!(ensure_plausible_portal_token("../../etc/passwd").is_err());
        // A ~400KB header of garbage must be rejected, never reach a limiter.
        assert!(ensure_plausible_portal_token(&"x".repeat(400_000)).is_err());
    }
}
