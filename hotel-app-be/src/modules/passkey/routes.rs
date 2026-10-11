//! Passkey (WebAuthn) authentication routes

use super::handlers;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::core::rate_limiter::RateLimiters;
use crate::models;
use crate::routes::extract_client_ip;
use axum::{
    Router,
    extract::{ConnectInfo, Extension, State},
    http::HeaderMap,
    response::Json,
    routing::post,
};
use axum_extra::extract::cookie::CookieJar;
use std::net::SocketAddr;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/auth/passkey/register/start", post(register_start))
        .route("/auth/passkey/register/finish", post(register_finish))
        .route("/auth/passkey/login/start", post(login_start))
        .route("/auth/passkey/login/finish", post(login_finish))
        .route("/auth/passkey/2fa/start", post(second_factor_start))
        .route("/auth/passkey/2fa/finish", post(second_factor_finish))
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
    handlers::passkey_register_start_handler(State(pool), Extension(user_id), Json(req)).await
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
    handlers::passkey_register_finish_handler(State(pool), Extension(user_id), Json(req)).await
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
    handlers::passkey_login_start_handler(State(pool), Json(req)).await
}

async fn login_finish(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    jar: CookieJar,
    Json(req): Json<models::PasskeyLoginFinish>,
) -> Result<(CookieJar, Json<models::AuthResponse>), ApiError> {
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
    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(512).collect());
    handlers::passkey_login_finish_handler(
        State(pool),
        jar,
        Json(req),
        Some(ip.to_string()),
        user_agent,
        crate::routes::extract_client_timezone(&headers),
    )
    .await
}

/// Passkey as the second factor of a password sign-in. Unauthenticated (the
/// session does not exist yet) — the `mfa_token` from the `two_factor_required`
/// answer is the credential — and on the strict login budget like every
/// other sign-in door.
async fn second_factor_start(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<models::PasskeySecondFactorStart>,
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
    handlers::passkey_second_factor_start_handler(State(pool), Json(req)).await
}

async fn second_factor_finish(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    jar: CookieJar,
    Json(req): Json<models::PasskeySecondFactorFinish>,
) -> Result<(CookieJar, Json<models::AuthResponse>), ApiError> {
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
    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(512).collect());
    handlers::passkey_second_factor_finish_handler(
        State(pool),
        jar,
        Json(req),
        Some(ip.to_string()),
        user_agent,
        crate::routes::extract_client_timezone(&headers),
    )
    .await
}
