//! Inbound webhook routes (external services calling us).
//!
//! No bearer auth by design — each handler cryptographically verifies its
//! provider's delivery instead — and IP rate-limited so unverifiable junk
//! cannot burn upstream verification calls.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::rate_limiter::RateLimiters;
use crate::handlers;
use axum::{
    Json, Router,
    extract::{ConnectInfo, Extension, State},
    http::HeaderMap,
    routing::post,
};
use std::net::SocketAddr;

pub fn routes() -> Router<DbPool> {
    Router::new().route("/webhooks/paypal", post(paypal_webhook))
}

async fn paypal_webhook(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: String,
) -> Result<Json<serde_json::Value>, ApiError> {
    let client_ip = super::extract_client_ip(&headers, peer_addr);
    let (allowed, retry_after) = limiters.webhook.check_with_retry(client_ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!("Too many requests. Please try again in {retry_after} seconds."),
            retry_after,
        ));
    }
    handlers::webhooks::paypal_webhook(&pool, client_ip, &headers, &body).await
}
