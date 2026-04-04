//! System settings routes
//!
//! Routes for system configuration and settings.

use axum::{
    routing::{get, post, patch},
    Router,
    extract::{State, Path},
    http::HeaderMap,
    response::Json,
};
use crate::core::db::DbPool;
use crate::core::middleware::require_auth;
use crate::handlers;
use crate::models;
use crate::core::error::ApiError;

/// Create settings routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/settings", get(get_settings))
        .route("/settings/:key", patch(update_setting))
        .route("/system/process-checkins", post(process_checkins))
}

async fn get_settings(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::SystemSetting>>, ApiError> {
    handlers::settings::get_system_settings_handler(State(pool), headers).await
}

async fn update_setting(
    State(pool): State<DbPool>,
    path: Path<String>,
    headers: HeaderMap,
    Json(input): Json<models::SystemSettingUpdate>,
) -> Result<Json<models::SystemSetting>, ApiError> {
    handlers::settings::update_system_setting_handler(State(pool), path, headers, Json(input)).await
}

async fn process_checkins(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Require authentication - only authenticated users can trigger auto check-in/checkout
    let _user_id = require_auth(&headers).await?;
    handlers::settings::process_auto_checkin_checkout_handler(State(pool)).await
}
