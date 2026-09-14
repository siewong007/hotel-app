//! Operational-health routes (System Health + Jobs admin surfaces).
//!
//! Gated on `settings:manage` — the same grant that guards data transfer and
//! security settings — rather than inventing a `system:read` permission for a
//! read-only surface.

use axum::{
    Router,
    extract::{Path, State},
    http::HeaderMap,
    response::Json,
    routing::{get, post},
};

use super::handlers;
use super::models;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{require_auth, require_permission_helper};

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/system/health", get(get_system_health))
        .route("/system/jobs/failures", get(get_job_failures))
        .route("/system/notifications", get(get_my_notifications))
        .route(
            "/system/notifications/{id}/read",
            post(mark_notification_read),
        )
        .route(
            "/system/notifications/read-all",
            post(mark_all_notifications_read),
        )
}

async fn get_system_health(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::SystemHealthResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "settings:manage").await?;
    handlers::get_system_health_handler(State(pool)).await
}

async fn get_job_failures(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::JobRunRow>>, ApiError> {
    require_permission_helper(&pool, &headers, "settings:manage").await?;
    handlers::get_job_failures_handler(State(pool)).await
}

// Notifications are self-scoped: authentication is enough, the audience
// filter (effective permission names) decides what each caller can see.
async fn get_my_notifications(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::StaffNotificationsResponse>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::get_my_notifications_handler(State(pool), user_id).await
}

async fn mark_notification_read(
    State(pool): State<DbPool>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::mark_notification_read_handler(State(pool), Path(id), user_id).await
}

async fn mark_all_notifications_read(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::mark_all_notifications_read_handler(State(pool), user_id).await
}
