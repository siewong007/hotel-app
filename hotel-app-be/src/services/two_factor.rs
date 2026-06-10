//! Two-factor authentication workflows

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::models::{
    RegenerateBackupCodesRequest, TwoFactorDisableRequest, TwoFactorEnableRequest,
    TwoFactorSetupRequest, TwoFactorStatusResponse, TwoFactorVerifyRequest, User,
};
use crate::repositories::user::UserRepository;
use serde_json::Value;
use validator::Validate;

pub async fn setup_2fa(
    pool: &DbPool,
    user_id: i64,
    _req: TwoFactorSetupRequest,
) -> Result<Value, ApiError> {
    log::info!("2FA setup service called for user {}", user_id);
    let user = get_user(pool, user_id).await?;

    if user.two_factor_enabled.unwrap_or(false) {
        return Err(ApiError::BadRequest(
            "2FA is already enabled for this account".to_string(),
        ));
    }

    let username = user.username.clone();
    let issuer_name =
        settings_cache::get_string(pool, "totp_issuer_name", "Hotel Management System").await;
    let (secret, qr_code_url) = AuthService::generate_totp_secret(&username, &issuer_name)
        .map_err(|error| {
            log::error!("Failed to generate TOTP secret: {}", error);
            ApiError::Internal(format!("Failed to generate TOTP secret: {}", error))
        })?;
    let backup_codes = AuthService::generate_backup_codes();
    let challenge_code = AuthService::create_2fa_challenge(pool, user_id, "setup")
        .await
        .map_err(|error| {
            log::error!("Failed to create 2FA challenge: {}", error);
            ApiError::Database(error.to_string())
        })?;

    UserRepository::update_two_factor_secret(pool, user_id, &secret).await?;

    Ok(serde_json::json!({
        "secret": secret,
        "qr_code_url": qr_code_url,
        "backup_codes": backup_codes,
        "challenge_code": challenge_code
    }))
}

pub async fn enable_2fa(
    pool: &DbPool,
    user_id: i64,
    req: TwoFactorEnableRequest,
) -> Result<Value, ApiError> {
    req.validate()
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    let user = get_user(pool, user_id).await?;
    let two_factor_secret = user.two_factor_secret.ok_or_else(|| {
        ApiError::BadRequest("2FA setup not initiated. Call /auth/2fa/setup first.".to_string())
    })?;

    let valid = AuthService::verify_totp_code(&two_factor_secret, &req.code)
        .map_err(|error| ApiError::BadRequest(format!("Invalid TOTP code: {}", error)))?;

    if !valid {
        return Err(ApiError::BadRequest("Invalid 2FA code".to_string()));
    }

    let backup_codes = AuthService::generate_backup_codes();
    AuthService::enable_2fa(pool, user_id, &two_factor_secret, &backup_codes)
        .await
        .map_err(|error| ApiError::Database(error.to_string()))?;

    Ok(serde_json::json!({
        "message": "2FA enabled successfully",
        "backup_codes": backup_codes
    }))
}

pub async fn disable_2fa(
    pool: &DbPool,
    user_id: i64,
    req: TwoFactorDisableRequest,
) -> Result<Value, ApiError> {
    req.validate()
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    let user = get_user(pool, user_id).await?;

    if !user.two_factor_enabled.unwrap_or(false) {
        return Err(ApiError::BadRequest(
            "2FA is not enabled for this account".to_string(),
        ));
    }

    let totp_secret = user
        .two_factor_secret
        .ok_or_else(|| ApiError::Internal("2FA secret missing".to_string()))?;
    let recovery_codes = user.two_factor_recovery_codes.unwrap_or_default();

    let mut code_valid = false;
    if AuthService::verify_totp_code(&totp_secret, &req.code).unwrap_or(false) {
        code_valid = true;
    } else if let Some(index) = AuthService::check_recovery_code(&req.code, &recovery_codes) {
        code_valid = true;
        let mut updated_codes = recovery_codes.clone();
        updated_codes.remove(index);
        AuthService::update_recovery_codes(pool, user_id, &updated_codes)
            .await
            .map_err(|error| ApiError::Database(error.to_string()))?;
    }

    if !code_valid {
        return Err(ApiError::BadRequest(
            "Invalid code. Use a valid TOTP code or recovery code.".to_string(),
        ));
    }

    AuthService::disable_2fa(pool, user_id)
        .await
        .map_err(|error| ApiError::Database(error.to_string()))?;
    AuthService::revoke_all_user_tokens(pool, user_id)
        .await
        .map_err(|error| ApiError::Database(error.to_string()))?;

    Ok(serde_json::json!({
        "message": "2FA disabled successfully. All sessions have been revoked for security."
    }))
}

pub async fn get_2fa_status(
    pool: &DbPool,
    user_id: i64,
) -> Result<TwoFactorStatusResponse, ApiError> {
    let (enabled, backup_codes_remaining) =
        AuthService::get_user_2fa_status(pool, user_id)
            .await
            .map_err(|error| ApiError::Database(error.to_string()))?;

    Ok(TwoFactorStatusResponse {
        enabled,
        has_backup_codes: backup_codes_remaining > 0,
        backup_codes_remaining: backup_codes_remaining as usize,
    })
}

pub async fn verify_2fa_code(
    pool: &DbPool,
    user_id: i64,
    req: TwoFactorVerifyRequest,
) -> Result<Value, ApiError> {
    req.validate()
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    let user = get_user(pool, user_id).await?;

    if !user.two_factor_enabled.unwrap_or(false) {
        return Err(ApiError::BadRequest(
            "2FA is not enabled for this account".to_string(),
        ));
    }

    let secret = user
        .two_factor_secret
        .ok_or_else(|| ApiError::Internal("2FA secret missing".to_string()))?;
    let valid = AuthService::verify_totp_code(&secret, &req.code)
        .map_err(|_| ApiError::Unauthorized("Invalid 2FA code".to_string()))?;

    if !valid {
        return Err(ApiError::Unauthorized("Invalid 2FA code".to_string()));
    }

    Ok(serde_json::json!({ "verified": true }))
}

pub async fn regenerate_backup_codes(
    pool: &DbPool,
    user_id: i64,
    req: RegenerateBackupCodesRequest,
) -> Result<Value, ApiError> {
    req.validate()
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    let user = get_user(pool, user_id).await?;

    if !user.two_factor_enabled.unwrap_or(false) {
        return Err(ApiError::BadRequest(
            "2FA is not enabled for this account".to_string(),
        ));
    }

    let totp_secret = user
        .two_factor_secret
        .ok_or_else(|| ApiError::Internal("2FA secret missing".to_string()))?;
    let valid = AuthService::verify_totp_code(&totp_secret, &req.code)
        .map_err(|error| ApiError::BadRequest(format!("Invalid TOTP code: {}", error)))?;

    if !valid {
        return Err(ApiError::BadRequest("Invalid 2FA code".to_string()));
    }

    let new_backup_codes = AuthService::generate_backup_codes();
    AuthService::update_recovery_codes(pool, user_id, &new_backup_codes)
        .await
        .map_err(|error| ApiError::Database(error.to_string()))?;

    Ok(serde_json::json!({
        "message": "Backup codes regenerated successfully",
        "backup_codes": new_backup_codes
    }))
}

async fn get_user(pool: &DbPool, user_id: i64) -> Result<User, ApiError> {
    UserRepository::find_by_id(pool, user_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("User not found".to_string()))
}
