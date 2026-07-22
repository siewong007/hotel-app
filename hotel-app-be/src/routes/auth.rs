//! Authentication routes (login, registration, email verification).
//!
//! 2FA routes are in `routes::two_factor`, passkey routes in `routes::passkey`.

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
    routing::{get, post},
};
use axum_extra::extract::cookie::CookieJar;
use std::net::SocketAddr;

use crate::handlers::auth::REFRESH_COOKIE;

/// Extracts the refresh token from the `HttpOnly` cookie and wraps it in a
/// `RefreshTokenRequest`. Returns `Unauthorized` when the cookie is absent so a
/// missing session is treated as logged-out rather than a 500.
fn refresh_request_from_cookie(jar: &CookieJar) -> Result<models::RefreshTokenRequest, ApiError> {
    let token = jar
        .get(REFRESH_COOKIE)
        .map(|c| c.value().to_string())
        .ok_or_else(|| ApiError::Unauthorized("Missing refresh token".to_string()))?;
    Ok(models::RefreshTokenRequest {
        refresh_token: token,
    })
}

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/auth/login", post(login))
        .route("/auth/access", get(access_snapshot))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/register", post(register))
        .route("/auth/verify-email", post(verify_email))
        .route("/auth/resend-verification", post(resend_verification))
}

// Basic auth handlers

async fn access_snapshot(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::AccessSnapshot>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::auth::access_snapshot_handler(State(pool), user_id).await
}

async fn login(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    jar: CookieJar,
    Json(req): Json<models::LoginRequest>,
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
    handlers::auth::login_handler(
        State(pool),
        jar,
        Json(req),
        Some(ip.to_string()),
        user_agent,
    )
    .await
}

async fn refresh(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    jar: CookieJar,
) -> Result<(CookieJar, Json<models::RefreshTokenResponse>), ApiError> {
    let ip = extract_client_ip(&headers, peer_addr);
    let (allowed, retry_after) = limiters.sensitive.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many refresh attempts. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    let req = refresh_request_from_cookie(&jar)?;
    handlers::auth::refresh_token_handler(State(pool), jar, req).await
}

async fn logout(
    State(pool): State<DbPool>,
    jar: CookieJar,
) -> Result<(CookieJar, Json<serde_json::Value>), ApiError> {
    let req = refresh_request_from_cookie(&jar)?;
    handlers::auth::logout_handler(State(pool), jar, req).await
}

async fn register(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<models::RegisterRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ip = extract_client_ip(&headers, peer_addr);
    let (allowed, retry_after) = limiters.register.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many registration attempts. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    handlers::auth::register_handler(State(pool), Json(req)).await
}

async fn verify_email(
    State(pool): State<DbPool>,
    Json(req): Json<models::EmailVerificationConfirm>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::auth::verify_email_handler(State(pool), Json(req)).await
}

async fn resend_verification(
    State(pool): State<DbPool>,
    Json(req): Json<models::ResendVerificationRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::auth::resend_verification_handler(State(pool), Json(req)).await
}
