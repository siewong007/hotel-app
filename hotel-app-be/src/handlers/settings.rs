//! System settings handlers
//!
//! Handles system configuration and settings management.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::models::*;
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::Json,
};
use sqlx::Row;

/// Get all system settings
pub async fn get_system_settings_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<SystemSetting>>, ApiError> {
    // Require admin permission
    require_permission_helper(&pool, &headers, "settings:read").await?;

    let settings = sqlx::query_as::<_, SystemSetting>(
        "SELECT * FROM system_settings ORDER BY category, key"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(settings))
}

/// Update a system setting by key
pub async fn update_system_setting_handler(
    State(pool): State<DbPool>,
    Path(key): Path<String>,
    headers: HeaderMap,
    Json(input): Json<SystemSettingUpdate>,
) -> Result<Json<SystemSetting>, ApiError> {
    // Require admin permission
    let user_id = require_permission_helper(&pool, &headers, "settings:update").await?;

    let updated = sqlx::query_as::<_, SystemSetting>(
        r#"
        UPDATE system_settings
        SET value = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2
        WHERE key = $3
        RETURNING *
        "#
    )
    .bind(&input.value)
    .bind(user_id)
    .bind(&key)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound(format!("Setting '{}' not found", key)))?;

    Ok(Json(updated))
}

/// Get available rate codes from settings
pub async fn get_rate_codes_handler(
    State(pool): State<DbPool>,
) -> Result<Json<RateCodesResponse>, ApiError> {
    let value = get_setting_value(&pool, "rate_codes").await?;
    let rate_codes: Vec<String> = serde_json::from_str(&value)
        .unwrap_or_else(|_| vec!["RACK".to_string(), "OVR".to_string()]);

    Ok(Json(RateCodesResponse { rate_codes }))
}

/// Get available market codes from settings
pub async fn get_market_codes_handler(
    State(pool): State<DbPool>,
) -> Result<Json<MarketCodesResponse>, ApiError> {
    let value = get_setting_value(&pool, "market_codes").await?;
    let market_codes: Vec<String> = serde_json::from_str(&value)
        .unwrap_or_else(|_| vec!["WKII".to_string(), "CORP".to_string()]);

    Ok(Json(MarketCodesResponse { market_codes }))
}

/// Process auto check-in and late checkout based on system settings
pub async fn process_auto_checkin_checkout_handler(
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get settings
    let auto_checkin_enabled = get_setting_value(&pool, "auto_checkin_enabled").await?;
    let late_checkout_enabled = get_setting_value(&pool, "late_checkout_enabled").await?;
    let check_in_time = get_setting_value(&pool, "check_in_time").await?;
    let check_out_time = get_setting_value(&pool, "check_out_time").await?;

    let mut checked_in = 0;
    let mut marked_late = 0;

    // Auto check-in
    if auto_checkin_enabled == "true" {
        let result = sqlx::query(
            r#"
            UPDATE bookings
            SET status = 'auto_checked_in', updated_at = CURRENT_TIMESTAMP
            WHERE status = 'confirmed'
              AND check_in_date = CURRENT_DATE
              AND CURRENT_TIME >= $1::TIME
              AND CURRENT_TIME < $2::TIME
            "#
        )
        .bind(&check_in_time)
        .bind(&check_out_time)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        checked_in = result.rows_affected() as i32;
    }

    // Mark late checkouts
    if late_checkout_enabled == "true" {
        let result = sqlx::query(
            r#"
            UPDATE bookings
            SET status = 'late_checkout', updated_at = CURRENT_TIMESTAMP
            WHERE status IN ('checked_in', 'auto_checked_in')
              AND check_out_date = CURRENT_DATE
              AND CURRENT_TIME > $1::TIME
            "#
        )
        .bind(&check_out_time)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        marked_late = result.rows_affected() as i32;
    }

    Ok(Json(serde_json::json!({
        "checked_in": checked_in,
        "marked_late": marked_late
    })))
}

/// Helper function to get a setting value by key
pub async fn get_setting_value(pool: &DbPool, key: &str) -> Result<String, ApiError> {
    let row = sqlx::query("SELECT value FROM system_settings WHERE key = $1")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound(format!("Setting '{}' not found", key)))?;

    row.try_get::<Option<String>, _>(0)
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::Database("Setting value is null".to_string()))
}
