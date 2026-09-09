//! Public payment-recovery endpoints, reached only by an emailed capability.
//!
//! No session, no account, no booking-access token. The capability in the URL
//! is the entire authority, and it authorises exactly one thing: replacing one
//! rejected payment on one booking. Nothing here exposes the guest profile,
//! pre-check-in, or any other booking.
//!
//! Viewing is deliberately side-effect free. Mail clients and security
//! appliances follow links in messages they scan, so a view that consumed the
//! capability would hand the guest a dead link before they ever clicked it.

use axum::{
    Json,
    extract::{ConnectInfo, Multipart, Path, State},
    http::HeaderMap,
};
use std::net::SocketAddr;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::rate_limiter::RateLimiters;
use crate::models::{PaymentActionResponse, PaypalCreateOrderResponse};
use crate::services::payment_retry;

/// What the recovery page may show. Deliberately minimal: a reservation
/// reference the guest can recognise, what they owe, and how they may pay.
/// No guest name, email, address or stay detail -- anyone holding the link can
/// see this, and the link travels by email.
#[derive(Debug, serde::Serialize)]
pub struct PaymentRecoveryView {
    pub booking_number: String,
    pub amount_due: String,
    pub currency: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub payment_methods: Vec<String>,
    /// Public PayPal client id, so the page can render the PayPal button.
    /// `None` when this deployment has no PayPal credentials.
    pub paypal_client_id: Option<String>,
    /// The payment this link already produced, if any. Lets a guest who comes
    /// back later attach evidence to the claim they already raised.
    pub payment_id: Option<i64>,
    /// Whether evidence can still be attached to that payment. Decided here
    /// rather than in the page, because only a pending bank-transfer claim
    /// accepts a receipt -- a captured PayPal payment needs none and the
    /// upload endpoint refuses one.
    pub receipt_uploadable: bool,
    /// True once the link has been spent. The page shows the outcome instead of
    /// a payment form, so a duplicate submission never creates a second payment.
    pub already_submitted: bool,
}

/// Shared ceiling for unauthenticated token-gated requests from one IP.
///
/// The capability is unguessable, so this is not the primary control -- it
/// bounds a flood of distinct garbage tokens, each of which would otherwise
/// cost a hash and a lookup.
async fn require_capacity(limiters: &RateLimiters, headers: &HeaderMap, peer: SocketAddr) -> Result<(), ApiError> {
    let ip = crate::routes::extract_client_ip(headers, peer);
    let (allowed, retry_after) = limiters.guest_portal_token_ip.check_with_retry(ip).await;
    if allowed {
        Ok(())
    } else {
        Err(ApiError::TooManyRequestsRetryAfter(
            format!("Too many payment attempts from this connection. Please try again in {retry_after} seconds."),
            retry_after,
        ))
    }
}

pub async fn view_recovery_handler(
    State(pool): State<DbPool>,
    axum::Extension(limiters): axum::Extension<RateLimiters>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Json<PaymentRecoveryView>, ApiError> {
    require_capacity(&limiters, &headers, peer).await?;
    Ok(Json(payment_retry::describe_recovery(&pool, &token).await?))
}

pub async fn recover_bank_transfer_handler(
    State(pool): State<DbPool>,
    axum::Extension(limiters): axum::Extension<RateLimiters>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Json<PaymentActionResponse>, ApiError> {
    require_capacity(&limiters, &headers, peer).await?;
    Ok(Json(
        payment_retry::recover_with_bank_transfer(&pool, &token).await?,
    ))
}

/// Body for the capture call. The order id comes back from PayPal's approval
/// window; the payment id is the one this capability produced, and the service
/// refuses any other.
#[derive(Debug, serde::Deserialize)]
pub struct CaptureRecoveredPaypalRequest {
    pub order_id: String,
    pub payment_id: i64,
}

pub async fn recover_paypal_create_order_handler(
    State(pool): State<DbPool>,
    axum::Extension(limiters): axum::Extension<RateLimiters>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Json<PaypalCreateOrderResponse>, ApiError> {
    require_capacity(&limiters, &headers, peer).await?;
    Ok(Json(payment_retry::recover_with_paypal(&pool, &token).await?))
}

pub async fn recover_paypal_capture_handler(
    State(pool): State<DbPool>,
    axum::Extension(limiters): axum::Extension<RateLimiters>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(request): Json<CaptureRecoveredPaypalRequest>,
) -> Result<Json<PaymentActionResponse>, ApiError> {
    require_capacity(&limiters, &headers, peer).await?;
    Ok(Json(
        payment_retry::capture_recovered_paypal(
            &pool,
            &token,
            &request.order_id,
            request.payment_id,
        )
        .await?,
    ))
}

/// Attach payment evidence to the claim raised through this link.
///
/// The capability authorises exactly this payment and nothing else -- no
/// pre-check-in, no profile, no other booking -- which is what lets an
/// anonymous guest send proof of a bank transfer without an account.
pub async fn recover_upload_receipt_handler(
    State(pool): State<DbPool>,
    axum::Extension(limiters): axum::Extension<RateLimiters>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path((token, payment_id)): Path<(String, i64)>,
    multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_capacity(&limiters, &headers, peer).await?;
    let bytes = crate::handlers::guest_portal::receipt_upload_bytes(multipart).await?;
    payment_retry::upload_recovered_receipt(&pool, &token, payment_id, &bytes).await?;
    Ok(Json(serde_json::json!({ "uploaded": true })))
}
