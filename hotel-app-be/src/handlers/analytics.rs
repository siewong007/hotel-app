//! Analytics and reporting handlers
//!
//! Handles reports and analytics dashboards.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::ReportQuery;
use crate::services::analytics;
use axum::{
    Json,
    extract::{Extension, Query, State},
};
use std::collections::HashMap;

#[allow(dead_code)]
pub async fn websocket_status_handler() -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!({
        "status": "available",
        "protocol": "ws",
        "endpoint": "/ws",
        "message": "WebSocket server is running"
    })))
}

pub async fn get_occupancy_report_handler(
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(analytics::occupancy_report(&pool).await?))
}

pub async fn get_booking_analytics_handler(
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(analytics::booking_analytics(&pool).await?))
}

pub async fn get_personalized_report_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        analytics::personalized_report(&pool, user_id, params).await?,
    ))
}

pub async fn generate_report_handler(
    State(pool): State<DbPool>,
    Query(params): Query<ReportQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(analytics::generate_report(&pool, params).await?))
}
