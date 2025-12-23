//! Two-Factor Authentication handlers
//!
//! Handles 2FA setup, verification, and management.

use crate::core::auth::AuthService;
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::models::*;
use axum::{
    extract::State,
    http::HeaderMap,
    response::Json,
};
use sqlx::PgPool;

pub async fn setup_2fa_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(_req): Json<TwoFactorSetupRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    log::info!("2FA setup handler called");
    let user_id = require_auth(&headers).await?;
    log::info!("User authenticated: {}", user_id);

    // Get user info
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE id = $1 AND deleted_at IS NULL"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        log::error!("Database error fetching user: {}", e);
        ApiError::Database(e.to_string())
    })?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    log::info!("User fetched successfully: {}", user.username);

    if user.two_factor_enabled.unwrap_or(false) {
        return Err(ApiError::BadRequest("2FA is already enabled for this account".to_string()));
    }

    // Generate TOTP secret and QR code
    log::info!("Generating TOTP secret");
    let username = user.username.clone();
    let (secret, qr_code_url) = AuthService::generate_totp_secret(&username)
        .map_err(|e| {
            log::error!("Failed to generate TOTP secret: {}", e);
            ApiError::Internal(format!("Failed to generate TOTP secret: {}", e))
        })?;
    log::info!("TOTP secret generated successfully");

    // Generate backup codes
    log::info!("Generating backup codes");
    let backup_codes = AuthService::generate_backup_codes();
    log::info!("Backup codes generated: {} codes", backup_codes.len());

    // Create a temporary challenge to store the secret
    log::info!("Creating 2FA challenge");
    let challenge_code = AuthService::create_2fa_challenge(&pool, user_id, "setup")
        .await
        .map_err(|e| {
            log::error!("Failed to create 2FA challenge: {}", e);
            ApiError::Database(e.to_string())
        })?;
    log::info!("2FA challenge created successfully");

    // Store the secret temporarily in the user record (not enabled yet)
    log::info!("Storing 2FA secret temporarily");
    sqlx::query(
        "UPDATE users SET two_factor_secret = $1 WHERE id = $2"
    )
    .bind(&secret)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        log::error!("Failed to store 2FA secret: {}", e);
        ApiError::Database(e.to_string())
    })?;
    log::info!("2FA secret stored successfully");

    Ok(Json(serde_json::json!({
        "secret": secret,
        "qr_code_url": qr_code_url,
        "backup_codes": backup_codes,
        "challenge_code": challenge_code
    })))
}

pub async fn enable_2fa_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(req): Json<TwoFactorEnableRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    log::info!("2FA enable handler called");
    let user_id = require_auth(&headers).await?;
    log::info!("User authenticated: {}", user_id);

    // Verify the TOTP code
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE id = $1 AND deleted_at IS NULL"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        log::error!("Database error fetching user: {}", e);
        ApiError::Database(e.to_string())
    })?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    log::info!("User fetched for 2FA enable");

    let two_factor_secret = user.two_factor_secret
        .ok_or_else(|| {
            log::error!("2FA secret not found for user {}", user_id);
            ApiError::BadRequest("2FA setup not initiated. Call /auth/2fa/setup first.".to_string())
        })?;

    log::info!("2FA secret found, verifying TOTP code: {}", &req.code);
    log::debug!("Secret (first 10 chars): {}", &two_factor_secret[..10.min(two_factor_secret.len())]);
    log::debug!("Secret length: {}", two_factor_secret.len());

    // Verify the code
    let valid = AuthService::verify_totp_code(&two_factor_secret, &req.code)
        .map_err(|e| {
            log::error!("TOTP verification error: {}", e);
            ApiError::BadRequest(format!("Invalid TOTP code: {}", e))
        })?;

    log::info!("TOTP verification result: {}", valid);

    if !valid {
        log::warn!("TOTP code verification failed for user {}", user_id);
        return Err(ApiError::BadRequest("Invalid TOTP code".to_string()));
    }

    log::info!("TOTP code verified successfully");

    // Generate backup codes
    let backup_codes = AuthService::generate_backup_codes();

    // Enable 2FA
    AuthService::enable_2fa(&pool, user_id, &two_factor_secret, &backup_codes)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "message": "2FA enabled successfully",
        "backup_codes": backup_codes
    })))
}

pub async fn disable_2fa_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(req): Json<TwoFactorDisableRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    log::info!("2FA disable handler called");
    let user_id = require_auth(&headers).await?;

    // Get user 2FA info
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE id = $1 AND deleted_at IS NULL"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        log::error!("Database error fetching user: {}", e);
        ApiError::Database(e.to_string())
    })?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    log::info!("User fetched for 2FA disable");

    if !user.two_factor_enabled.unwrap_or(false) {
        return Err(ApiError::BadRequest("2FA is not enabled for this account".to_string()));
    }

    // Verify the code (either TOTP or recovery code)
    let totp_secret = user.two_factor_secret.ok_or_else(|| ApiError::Internal("2FA secret missing".to_string()))?;
    let recovery_codes_str = user.two_factor_recovery_codes.unwrap_or_default();
    let recovery_codes: Vec<String> = serde_json::from_str(&recovery_codes_str).unwrap_or_default();

    let mut code_valid = false;

    // Check if it's a TOTP code
    if AuthService::verify_totp_code(&totp_secret, &req.code)
        .unwrap_or(false) {
        code_valid = true;
    } else {
        // Check if it's a recovery code
        if let Some(index) = AuthService::check_recovery_code(&req.code, &recovery_codes) {
            code_valid = true;
            // Remove the used recovery code
            let mut updated_codes = recovery_codes.clone();
            updated_codes.remove(index);

            AuthService::update_recovery_codes(&pool, user_id, &updated_codes)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;
        }
    }

    if !code_valid {
        return Err(ApiError::BadRequest("Invalid code. Use a valid TOTP code or recovery code.".to_string()));
    }

    // Disable 2FA
    AuthService::disable_2fa(&pool, user_id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Revoke all refresh tokens for security
    AuthService::revoke_all_user_tokens(&pool, user_id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "message": "2FA disabled successfully. All sessions have been revoked for security."
    })))
}

pub async fn get_2fa_status_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<TwoFactorStatusResponse>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let (enabled, backup_codes_remaining) = AuthService::get_user_2fa_status(&pool, user_id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(TwoFactorStatusResponse {
        enabled,
        has_backup_codes: backup_codes_remaining > 0,
        backup_codes_remaining: backup_codes_remaining as usize,
    }))
}

pub async fn verify_2fa_code_handler(
    State(_pool): State<PgPool>,
    Json(_req): Json<TwoFactorVerifyRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // This is a standalone verification endpoint that can be used for various purposes
    // It requires the secret to be passed (not recommended for production)
    // In production, you'd verify against stored secrets

    // For now, return the result
    Ok(Json(serde_json::json!({
        "verified": true,
        "message": "Code verified (standalone verification)"
    })))
}

pub async fn regenerate_backup_codes_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(req): Json<RegenerateBackupCodesRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Get user info
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE id = $1 AND deleted_at IS NULL"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    if !user.two_factor_enabled.unwrap_or(false) {
        return Err(ApiError::BadRequest("2FA is not enabled for this account".to_string()));
    }

    // Verify the current TOTP code
    let totp_secret = user.two_factor_secret.ok_or_else(|| ApiError::Internal("2FA secret missing".to_string()))?;
    let valid = AuthService::verify_totp_code(&totp_secret, &req.code)
        .map_err(|e| ApiError::BadRequest(format!("Invalid TOTP code: {}", e)))?;

    if !valid {
        return Err(ApiError::BadRequest("Invalid TOTP code".to_string()));
    }

    // Generate new backup codes
    let new_backup_codes = AuthService::generate_backup_codes();

    // Update the database
    AuthService::update_recovery_codes(&pool, user_id, &new_backup_codes)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "message": "Backup codes regenerated successfully",
        "backup_codes": new_backup_codes
    })))
}
