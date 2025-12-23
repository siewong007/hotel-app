//! User profile routes
//!
//! Routes for user profile management, 2FA, and passkeys.

use axum::{
    routing::{get, post, patch, delete},
    Router,
    extract::{State, Path, Extension},
    http::HeaderMap,
    response::Json,
};
use sqlx::PgPool;
use crate::handlers;
use crate::models;
use crate::core::middleware::require_auth;
use crate::core::error::ApiError;

/// Create profile routes
pub fn routes() -> Router<PgPool> {
    Router::new()
        // Profile management
        .route("/profile", get(get_profile))
        .route("/profile", patch(update_profile))
        .route("/profile/password", post(update_password))
        // Passkey management
        .route("/profile/passkeys", get(list_passkeys))
        .route("/profile/passkeys/:id", delete(delete_passkey))
        .route("/profile/passkeys/:id", patch(update_passkey))
        // 2FA management (profile-specific endpoints)
        .route("/profile/2fa/setup", post(setup_2fa))
        .route("/profile/2fa/enable", post(enable_2fa))
        .route("/profile/2fa/disable", post(disable_2fa))
        .route("/profile/2fa/status", get(get_2fa_status))
        .route("/profile/2fa/verify", post(verify_2fa))
}

// Profile handlers

async fn get_profile(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<models::UserProfile>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::profile::get_user_profile_handler(State(pool), Extension(user_id)).await
}

async fn update_profile(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::UserProfileUpdate>,
) -> Result<Json<models::UserProfile>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::profile::update_user_profile_handler(State(pool), Extension(user_id), Json(input)).await
}

async fn update_password(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::PasswordUpdateInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::profile::update_password_handler(State(pool), Extension(user_id), Json(input)).await
}

// Passkey handlers

async fn list_passkeys(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::PasskeyInfo>>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::passkey::list_passkeys_handler(State(pool), Extension(user_id)).await
}

async fn delete_passkey(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::passkey::delete_passkey_handler(State(pool), Extension(user_id), path).await
}

async fn update_passkey(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<uuid::Uuid>,
    Json(input): Json<models::PasskeyUpdateInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::passkey::update_passkey_handler(State(pool), Extension(user_id), path, Json(input)).await
}

// 2FA handlers (profile context)

async fn setup_2fa(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::TwoFactorSetupRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::two_factor::setup_2fa_handler(State(pool), headers, Json(input)).await
}

async fn enable_2fa(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::TwoFactorEnableRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::two_factor::enable_2fa_handler(State(pool), headers, Json(input)).await
}

async fn disable_2fa(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::TwoFactorDisableRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::two_factor::disable_2fa_handler(State(pool), headers, Json(input)).await
}

async fn get_2fa_status(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<models::TwoFactorStatusResponse>, ApiError> {
    handlers::two_factor::get_2fa_status_handler(State(pool), headers).await
}

async fn verify_2fa(
    State(pool): State<PgPool>,
    Json(input): Json<models::TwoFactorVerifyRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::two_factor::verify_2fa_code_handler(State(pool), Json(input)).await
}
