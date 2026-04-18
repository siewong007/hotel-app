//! Authentication routes (login, registration, email verification).
//!
//! 2FA routes are in `routes::two_factor`, passkey routes in `routes::passkey`.

use axum::{
    routing::post,
    Router,
    extract::{Extension, State},
    http::HeaderMap,
    response::Json,
};
use crate::core::db::DbPool;
use crate::core::rate_limiter::RateLimiters;
use crate::handlers;
use crate::models;
use crate::core::error::ApiError;
use super::extract_client_ip;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/register", post(register))
        .route("/auth/verify-email", post(verify_email))
        .route("/auth/resend-verification", post(resend_verification))
}

// Basic auth handlers

async fn login(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(req): Json<models::LoginRequest>,
) -> Result<Json<models::AuthResponse>, ApiError> {
    let ip = extract_client_ip(&headers);
    let (allowed, retry_after) = limiters.auth.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!("Too many login attempts. Please try again in {} seconds.", retry_after),
            retry_after,
        ));
    }
    handlers::auth::login_handler(State(pool), Json(req)).await
}

async fn refresh(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(req): Json<models::RefreshTokenRequest>,
) -> Result<Json<models::RefreshTokenResponse>, ApiError> {
    let ip = extract_client_ip(&headers);
    let (allowed, retry_after) = limiters.sensitive.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!("Too many refresh attempts. Please try again in {} seconds.", retry_after),
            retry_after,
        ));
    }
    handlers::auth::refresh_token_handler(State(pool), Json(req)).await
}

async fn logout(
    State(pool): State<DbPool>,
    Json(req): Json<models::RefreshTokenRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::auth::logout_handler(State(pool), Json(req)).await
}

async fn register(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(req): Json<models::RegisterRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ip = extract_client_ip(&headers);
    let (allowed, retry_after) = limiters.register.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!("Too many registration attempts. Please try again in {} seconds.", retry_after),
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

