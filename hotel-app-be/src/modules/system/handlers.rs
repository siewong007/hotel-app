//! Handlers for the operational-health surfaces.

use axum::{
    extract::{Path, State},
    response::Json,
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::modules::system::models::{JobRunRow, StaffNotificationsResponse, SystemHealthResponse};
use crate::modules::system::service;

pub async fn get_system_health_handler(
    State(pool): State<DbPool>,
) -> Result<Json<SystemHealthResponse>, ApiError> {
    Ok(Json(service::system_health(&pool).await?))
}

pub async fn get_job_failures_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<JobRunRow>>, ApiError> {
    Ok(Json(service::recent_job_failures(&pool).await?))
}

pub async fn get_my_notifications_handler(
    State(pool): State<DbPool>,
    user_id: i64,
) -> Result<Json<StaffNotificationsResponse>, ApiError> {
    Ok(Json(service::my_notifications(&pool, user_id).await?))
}

pub async fn mark_notification_read_handler(
    State(pool): State<DbPool>,
    Path(notification_id): Path<i64>,
    user_id: i64,
) -> Result<Json<serde_json::Value>, ApiError> {
    service::mark_notification_read(&pool, user_id, notification_id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn mark_all_notifications_read_handler(
    State(pool): State<DbPool>,
    user_id: i64,
) -> Result<Json<serde_json::Value>, ApiError> {
    service::mark_all_notifications_read(&pool, user_id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
