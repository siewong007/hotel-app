//! Authentication handlers.
//!
//! Handles login, logout, registration, and token management.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::auth as svc;
use axum::{extract::State, response::Json};

pub async fn login_handler(
    State(pool): State<DbPool>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    Ok(Json(svc::login(&pool, req).await?))
}

pub async fn refresh_token_handler(
    State(pool): State<DbPool>,
    Json(req): Json<RefreshTokenRequest>,
) -> Result<Json<RefreshTokenResponse>, ApiError> {
    Ok(Json(svc::refresh_token(&pool, req).await?))
}

pub async fn access_snapshot_handler(
    State(pool): State<DbPool>,
    user_id: i64,
) -> Result<Json<AccessSnapshot>, ApiError> {
    Ok(Json(svc::access_snapshot(&pool, user_id).await?))
}

pub async fn logout_handler(
    State(pool): State<DbPool>,
    Json(req): Json<RefreshTokenRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::logout(&pool, req).await?;

    Ok(Json(
        serde_json::json!({"message": "Logged out successfully"}),
    ))
}

pub async fn register_handler(
    State(pool): State<DbPool>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(svc::register(&pool, req).await?))
}

pub async fn verify_email_handler(
    State(pool): State<DbPool>,
    Json(req): Json<EmailVerificationConfirm>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(svc::verify_email(&pool, req).await?))
}

pub async fn resend_verification_handler(
    State(pool): State<DbPool>,
    Json(req): Json<ResendVerificationRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(svc::resend_verification(&pool, req).await?))
}
