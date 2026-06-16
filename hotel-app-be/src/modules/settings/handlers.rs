//! System settings handlers
//!
//! Handles system configuration and settings management.

use super::models::*;
use super::service as settings_service;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use axum::{
    extract::{Path, State},
    response::Json,
};

/// Get all system settings
pub async fn get_system_settings_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<SystemSetting>>, ApiError> {
    Ok(Json(settings_service::list_system_settings(&pool).await?))
}

/// Update a system setting by key
pub async fn update_system_setting_handler(
    State(pool): State<DbPool>,
    Path(key): Path<String>,
    user_id: i64,
    Json(input): Json<SystemSettingUpdate>,
) -> Result<Json<SystemSetting>, ApiError> {
    Ok(Json(
        settings_service::update_system_setting(&pool, &key, input, user_id).await?,
    ))
}

/// Get available rate codes from settings
pub async fn get_rate_codes_handler(
    State(pool): State<DbPool>,
) -> Result<Json<RateCodesResponse>, ApiError> {
    Ok(Json(settings_service::get_rate_codes(&pool).await?))
}

/// Get available market codes from settings
pub async fn get_market_codes_handler(
    State(pool): State<DbPool>,
) -> Result<Json<MarketCodesResponse>, ApiError> {
    Ok(Json(settings_service::get_market_codes(&pool).await?))
}

/// Process auto check-in and late checkout based on system settings
pub async fn process_auto_checkin_checkout_handler(
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        settings_service::process_auto_checkin_checkout(&pool).await?,
    ))
}
