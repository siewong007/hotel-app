//! System settings workflows

use super::models::{MarketCodesResponse, RateCodesResponse, SystemSetting, SystemSettingUpdate};
use super::repository::SettingsRepository;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::settings_cache;

pub async fn list_system_settings(pool: &DbPool) -> Result<Vec<SystemSetting>, ApiError> {
    SettingsRepository::find_all(pool).await
}

pub async fn update_system_setting(
    pool: &DbPool,
    key: &str,
    input: SystemSettingUpdate,
    user_id: i64,
) -> Result<SystemSetting, ApiError> {
    let setting = SettingsRepository::update_value_by_user(pool, key, &input.value, user_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Setting '{}' not found", key)))?;
    settings_cache::invalidate_key(key);
    Ok(setting)
}

pub async fn get_rate_codes(pool: &DbPool) -> Result<RateCodesResponse, ApiError> {
    let value = get_setting_value(pool, "rate_codes").await?;
    let rate_codes: Vec<String> = serde_json::from_str(&value)
        .unwrap_or_else(|_| vec!["RACK".to_string(), "OVR".to_string()]);

    Ok(RateCodesResponse { rate_codes })
}

pub async fn get_market_codes(pool: &DbPool) -> Result<MarketCodesResponse, ApiError> {
    let value = get_setting_value(pool, "market_codes").await?;
    let market_codes: Vec<String> = serde_json::from_str(&value)
        .unwrap_or_else(|_| vec!["WKII".to_string(), "CORP".to_string()]);

    Ok(MarketCodesResponse { market_codes })
}

pub async fn process_auto_checkin_checkout(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
    let auto_checkin_enabled = get_setting_value(pool, "auto_checkin_enabled").await?;
    let late_checkout_enabled = get_setting_value(pool, "late_checkout_enabled").await?;
    let check_in_time = get_setting_value(pool, "check_in_time").await?;
    let check_out_time = get_setting_value(pool, "check_out_time").await?;
    let auto_checkin_requires_ekyc = SettingsRepository::get_value(pool, "auto_checkin_requires_ekyc")
        .await?
        .unwrap_or_else(|| "true".to_string())
        != "false";

    let mut checked_in = 0;
    let mut marked_late = 0;

    if auto_checkin_enabled == "true" {
        checked_in =
            SettingsRepository::auto_check_in_bookings(
                pool,
                &check_in_time,
                &check_out_time,
                auto_checkin_requires_ekyc,
            )
            .await? as i32;

        if checked_in > 0 {
            let _ = SettingsRepository::mark_auto_checked_in_rooms_occupied(pool).await;
        }
    }

    if late_checkout_enabled == "true" {
        marked_late = SettingsRepository::mark_late_checkouts(pool, &check_out_time).await? as i32;
    }

    Ok(serde_json::json!({
        "checked_in": checked_in,
        "marked_late": marked_late
    }))
}

pub async fn get_setting_value(pool: &DbPool, key: &str) -> Result<String, ApiError> {
    let value = SettingsRepository::get_value(pool, key)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Setting '{}' not found", key)))?;

    Ok(value)
}
