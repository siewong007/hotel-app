//! System settings routes
//!
//! Routes for system configuration and settings.

use super::handlers;
use super::models;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{require_auth, require_permission_helper};
use axum::{
    Router,
    extract::{Path, State},
    http::HeaderMap,
    response::Json,
    routing::{get, patch, post},
};

/// Create settings routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/settings", get(get_settings))
        .route("/settings/{key}", patch(update_setting))
        .route("/system/process-checkins", post(process_checkins))
}

async fn get_settings(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::SystemSetting>>, ApiError> {
    require_permission_helper(&pool, &headers, "settings:read").await?;
    handlers::get_system_settings_handler(State(pool)).await
}

async fn update_setting(
    State(pool): State<DbPool>,
    path: Path<String>,
    headers: HeaderMap,
    Json(input): Json<models::SystemSettingUpdate>,
) -> Result<Json<models::SystemSetting>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "settings:update").await?;
    handlers::update_system_setting_handler(State(pool), path, user_id, Json(input)).await
}

async fn process_checkins(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Require authentication - only authenticated users can trigger auto check-in/checkout
    let _user_id = require_auth(&headers).await?;
    handlers::process_auto_checkin_checkout_handler(State(pool)).await
}
