//! Passkey (WebAuthn) authentication routes

use super::extract_client_ip;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::core::rate_limiter::RateLimiters;
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{ConnectInfo, Extension, State},
    http::HeaderMap,
    response::Json,
    routing::post,
};
use std::net::SocketAddr;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/auth/passkey/register/start", post(register_start))
        .route("/auth/passkey/register/finish", post(register_finish))
        .route("/auth/passkey/login/start", post(login_start))
        .route("/auth/passkey/login/finish", post(login_finish))
}

async fn register_start(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<models::PasskeyRegistrationStart>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ip = extract_client_ip(&headers, peer_addr);
    let (allowed, retry_after) = limiters.sensitive.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many requests. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    let user_id = require_auth(&headers).await?;
    handlers::passkey::passkey_register_start_handler(State(pool), Extension(user_id), Json(req))
        .await
}

async fn register_finish(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<models::PasskeyRegistrationFinish>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ip = extract_client_ip(&headers, peer_addr);
    let (allowed, retry_after) = limiters.sensitive.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many requests. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    let user_id = require_auth(&headers).await?;
    handlers::passkey::passkey_register_finish_handler(State(pool), Extension(user_id), Json(req))
        .await
}

async fn login_start(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<models::PasskeyLoginStart>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ip = extract_client_ip(&headers, peer_addr);
    let (allowed, retry_after) = limiters.auth.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many login attempts. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    handlers::passkey::passkey_login_start_handler(State(pool), Json(req)).await
}

async fn login_finish(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<models::PasskeyLoginFinish>,
) -> Result<Json<models::AuthResponse>, ApiError> {
    let ip = extract_client_ip(&headers, peer_addr);
    let (allowed, retry_after) = limiters.auth.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many login attempts. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    handlers::passkey::passkey_login_finish_handler(State(pool), Json(req)).await
}
