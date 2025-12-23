//! Authentication routes
//!
//! Routes for login, registration, 2FA, and passkey authentication.

use axum::{
    routing::{get, post},
    Router,
    extract::State,
    http::HeaderMap,
    response::Json,
};
use sqlx::PgPool;
use crate::handlers;
use crate::models;
use crate::core::error::ApiError;

/// Create authentication routes
pub fn routes() -> Router<PgPool> {
    Router::new()
        // Basic auth routes
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/register", post(register))
        .route("/auth/verify-email", post(verify_email))
        .route("/auth/resend-verification", post(resend_verification))
        // 2FA routes
        .route("/auth/2fa/setup", post(setup_2fa))
        .route("/auth/2fa/enable", post(enable_2fa))
        .route("/auth/2fa/disable", post(disable_2fa))
        .route("/auth/2fa/status", get(get_2fa_status))
        .route("/auth/2fa/verify", post(verify_2fa))
        .route("/auth/2fa/regenerate-backup-codes", post(regenerate_backup_codes))
        // Passkey routes
        .route("/auth/passkey/register/start", post(passkey_register_start))
        .route("/auth/passkey/register/finish", post(passkey_register_finish))
        .route("/auth/passkey/login/start", post(passkey_login_start))
        .route("/auth/passkey/login/finish", post(passkey_login_finish))
}

// Basic auth handlers

async fn login(
    State(pool): State<PgPool>,
    Json(req): Json<models::LoginRequest>,
) -> Result<Json<models::AuthResponse>, ApiError> {
    handlers::auth::login_handler(State(pool), Json(req)).await
}

async fn refresh(
    State(pool): State<PgPool>,
    Json(req): Json<models::RefreshTokenRequest>,
) -> Result<Json<models::RefreshTokenResponse>, ApiError> {
    handlers::auth::refresh_token_handler(State(pool), Json(req)).await
}

async fn logout(
    State(pool): State<PgPool>,
    Json(req): Json<models::RefreshTokenRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::auth::logout_handler(State(pool), Json(req)).await
}

async fn register(
    State(pool): State<PgPool>,
    Json(req): Json<models::RegisterRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::auth::register_handler(State(pool), Json(req)).await
}

async fn verify_email(
    State(pool): State<PgPool>,
    Json(req): Json<models::EmailVerificationConfirm>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::auth::verify_email_handler(State(pool), Json(req)).await
}

async fn resend_verification(
    State(pool): State<PgPool>,
    Json(req): Json<models::ResendVerificationRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::auth::resend_verification_handler(State(pool), Json(req)).await
}

// 2FA handlers

async fn setup_2fa(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(req): Json<models::TwoFactorSetupRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::two_factor::setup_2fa_handler(State(pool), headers, Json(req)).await
}

async fn enable_2fa(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(req): Json<models::TwoFactorEnableRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::two_factor::enable_2fa_handler(State(pool), headers, Json(req)).await
}

async fn disable_2fa(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(req): Json<models::TwoFactorDisableRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::two_factor::disable_2fa_handler(State(pool), headers, Json(req)).await
}

async fn get_2fa_status(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<models::TwoFactorStatusResponse>, ApiError> {
    handlers::two_factor::get_2fa_status_handler(State(pool), headers).await
}

async fn verify_2fa(
    State(pool): State<PgPool>,
    Json(req): Json<models::TwoFactorVerifyRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::two_factor::verify_2fa_code_handler(State(pool), Json(req)).await
}

async fn regenerate_backup_codes(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(req): Json<models::RegenerateBackupCodesRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::two_factor::regenerate_backup_codes_handler(State(pool), headers, Json(req)).await
}

// Passkey handlers

async fn passkey_register_start(
    State(pool): State<PgPool>,
    Json(req): Json<models::PasskeyRegistrationStart>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::passkey::passkey_register_start_handler(State(pool), Json(req)).await
}

async fn passkey_register_finish(
    State(pool): State<PgPool>,
    Json(req): Json<models::PasskeyRegistrationFinish>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::passkey::passkey_register_finish_handler(State(pool), Json(req)).await
}

async fn passkey_login_start(
    State(pool): State<PgPool>,
    Json(req): Json<models::PasskeyLoginStart>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::passkey::passkey_login_start_handler(State(pool), Json(req)).await
}

async fn passkey_login_finish(
    State(pool): State<PgPool>,
    Json(req): Json<models::PasskeyLoginFinish>,
) -> Result<Json<models::AuthResponse>, ApiError> {
    handlers::passkey::passkey_login_finish_handler(State(pool), Json(req)).await
}
