//! System settings workflows

use super::models::{
    MarketCodesResponse, PublicSetting, RateCodesResponse, SystemSetting, SystemSettingUpdate,
};
use super::repository::SettingsRepository;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::models::AuditEvent;
use crate::services::audit::AuditLog;

/// Categories whose keys change authentication or account security. The
/// generic `settings:update` grant covers business preferences; anything under
/// an elevated category additionally requires `settings:manage`.
const ELEVATED_SETTING_CATEGORIES: &[&str] = &["security"];

/// Update/reset guard for the target setting's category. Callers already
/// passed `settings:update` at the route; this adds `settings:manage` for
/// elevated categories once the row's category is known.
async fn ensure_category_allowed(
    pool: &DbPool,
    user_id: i64,
    category: Option<&str>,
) -> Result<(), ApiError> {
    if ELEVATED_SETTING_CATEGORIES.contains(&category.unwrap_or("general")) {
        crate::core::middleware::check_permission(pool, user_id, "settings:manage").await?;
    }
    Ok(())
}

pub async fn list_system_settings(
    pool: &DbPool,
    category: Option<&str>,
) -> Result<Vec<SystemSetting>, ApiError> {
    let settings = SettingsRepository::find_all(pool).await?;
    Ok(match category {
        Some(category) => settings
            .into_iter()
            .filter(|setting| setting.category.as_deref() == Some(category))
            .collect(),
        None => settings,
    })
}

pub async fn list_public_settings(pool: &DbPool) -> Result<Vec<PublicSetting>, ApiError> {
    SettingsRepository::find_public(pool).await
}

/// Hotel-local clock when today's new reservations appear on the strip.
pub const NEW_RESERVATION_VISIBLE_TIME_KEY: &str = "new_reservation_visible_time";

/// No existing setting is a morning "show new bookings" clock (check-in is
/// 15:00, check-out 11:00, night audit 23:00), so the product default is 14:00.
pub const DEFAULT_NEW_RESERVATION_VISIBLE_TIME: &str = "14:00";

/// Accept `HH:MM` only, 00:00 through 23:59.
pub fn normalize_clock_time(raw: &str) -> Result<String, ApiError> {
    let trimmed = raw.trim();
    let mut parts = trimmed.split(':');
    let hour_text = parts.next().unwrap_or("");
    let minute_text = parts.next().unwrap_or("");
    let extra = parts.next();
    let bad = || ApiError::BadRequest("Time must be HH:MM in 24-hour form".to_string());
    if extra.is_some()
        || hour_text.len() != 2
        || minute_text.len() != 2
        || !hour_text.chars().all(|c| c.is_ascii_digit())
        || !minute_text.chars().all(|c| c.is_ascii_digit())
    {
        return Err(bad());
    }
    let hour: u32 = hour_text.parse().map_err(|_| bad())?;
    let minute: u32 = minute_text.parse().map_err(|_| bad())?;
    if hour > 23 || minute > 59 {
        return Err(bad());
    }
    Ok(format!("{hour:02}:{minute:02}"))
}

/// `settings:update` covers every ordinary setting (admins). The new-reservation
/// clock is also editable by a manager, and by nobody else.
pub async fn authorize_setting_editor(
    pool: &DbPool,
    user_id: i64,
    key: &str,
) -> Result<(), ApiError> {
    let can_update =
        crate::core::auth::AuthService::check_permission(pool, user_id, "settings:update")
            .await
            .map_err(|err| ApiError::Database(err.to_string()))?;
    if can_update {
        return Ok(());
    }
    if key == NEW_RESERVATION_VISIBLE_TIME_KEY {
        let roles = crate::core::auth::AuthService::get_user_roles(pool, user_id)
            .await
            .map_err(|err| ApiError::Database(err.to_string()))?;
        if roles
            .iter()
            .any(|role| matches!(role.as_str(), "admin" | "manager" | "super_admin"))
        {
            return Ok(());
        }
        return Err(ApiError::Forbidden(
            "Only an admin or a manager can change when new reservations appear".to_string(),
        ));
    }
    Err(ApiError::Forbidden(
        "Missing permission: settings:update".to_string(),
    ))
}

pub async fn update_system_setting(
    pool: &DbPool,
    key: &str,
    mut input: SystemSettingUpdate,
    user_id: i64,
) -> Result<SystemSetting, ApiError> {
    if key == NEW_RESERVATION_VISIBLE_TIME_KEY {
        input.value = normalize_clock_time(&input.value)?;
    }
    // Read before the write: `system_settings` keeps only `updated_by`/`updated_at`,
    // so the row itself cannot say what a value was replaced with. Two admins
    // racing the same key could make the recorded `old_value` one revision stale,
    // which is acceptable for a trail gated behind `settings:update`. The row
    // load doubles as the category lookup for the elevated-permission check.
    let existing = SettingsRepository::find_by_key(pool, key)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Setting '{}' not found", key)))?;
    ensure_category_allowed(pool, user_id, existing.category.as_deref()).await?;
    let old_value = Some(existing.value);

    let setting = SettingsRepository::update_value_by_user(pool, key, &input.value, user_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Setting '{}' not found", key)))?;
    settings_cache::invalidate_key(pool, key).await;

    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "settings_changed",
            resource_type: "system_setting",
            resource_id: Some(setting.id),
            details: Some(serde_json::json!({
                "key": key,
                "old_value": old_value,
                "new_value": setting.value
            })),
            ..Default::default()
        },
    )
    .await?;

    Ok(setting)
}

/// Restore a setting to its seeded default. The permission shape matches an
/// update: `settings:update` at the route, `settings:manage` for elevated
/// categories.
pub async fn reset_system_setting(
    pool: &DbPool,
    key: &str,
    user_id: i64,
) -> Result<SystemSetting, ApiError> {
    let existing = SettingsRepository::find_by_key(pool, key)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Setting '{}' not found", key)))?;
    ensure_category_allowed(pool, user_id, existing.category.as_deref()).await?;
    if existing.default_value.is_none() {
        return Err(ApiError::BadRequest(format!(
            "Setting '{key}' has no recorded default to reset to"
        )));
    }

    let setting = SettingsRepository::reset_to_default(pool, key, user_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("Setting '{}' not found", key)))?;
    settings_cache::invalidate_key(pool, key).await;

    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "settings_reset",
            resource_type: "system_setting",
            resource_id: Some(setting.id),
            details: Some(serde_json::json!({
                "key": key,
                "old_value": existing.value,
                "new_value": setting.value
            })),
            ..Default::default()
        },
    )
    .await?;

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
    let auto_checkin_requires_ekyc =
        SettingsRepository::get_value(pool, "auto_checkin_requires_ekyc")
            .await?
            .unwrap_or_else(|| "true".to_string())
            != "false";

    let mut checked_in = 0;
    let mut marked_late = 0;

    if auto_checkin_enabled == "true" {
        checked_in = SettingsRepository::auto_check_in_bookings(
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

#[cfg(test)]
mod clock_time_tests {
    use super::normalize_clock_time;

    #[test]
    fn accepts_a_24_hour_clock() {
        assert_eq!(normalize_clock_time("14:00").unwrap(), "14:00");
        assert_eq!(normalize_clock_time(" 09:05 ").unwrap(), "09:05");
    }

    #[test]
    fn rejects_anything_that_is_not_hh_mm() {
        for raw in ["2pm", "14", "14:00:00", "24:00", "14:60", "9:00"] {
            assert!(normalize_clock_time(raw).is_err(), "{raw}");
        }
    }
}
