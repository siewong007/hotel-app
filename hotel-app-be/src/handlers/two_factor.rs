//! Two-Factor Authentication handlers
//!
//! Handles 2FA setup, verification, and management.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::two_factor as two_factor_service;
use axum::{extract::State, response::Json};

pub async fn setup_2fa_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(req): Json<TwoFactorSetupRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        two_factor_service::setup_2fa(&pool, user_id, req).await?,
    ))
}

pub async fn enable_2fa_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(req): Json<TwoFactorEnableRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        two_factor_service::enable_2fa(&pool, user_id, req).await?,
    ))
}

pub async fn disable_2fa_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(req): Json<TwoFactorDisableRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        two_factor_service::disable_2fa(&pool, user_id, req).await?,
    ))
}

pub async fn get_2fa_status_handler(
    State(pool): State<DbPool>,
    user_id: i64,
) -> Result<Json<TwoFactorStatusResponse>, ApiError> {
    Ok(Json(
        two_factor_service::get_2fa_status(&pool, user_id).await?,
    ))
}

pub async fn verify_2fa_code_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(req): Json<TwoFactorVerifyRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        two_factor_service::verify_2fa_code(&pool, user_id, req).await?,
    ))
}

pub async fn regenerate_backup_codes_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(req): Json<RegenerateBackupCodesRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        two_factor_service::regenerate_backup_codes(&pool, user_id, req).await?,
    ))
}
