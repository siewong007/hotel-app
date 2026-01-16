//! Analytics routes
//!
//! Routes for reports and analytics dashboards.

use axum::{
    routing::get,
    Router,
    extract::{State, Query},
    http::HeaderMap,
    response::Json,
};
use crate::core::db::DbPool;
use std::collections::HashMap;
use crate::handlers;
use crate::core::middleware::require_permission_helper;
use crate::core::error::ApiError;

/// Create analytics routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/analytics/occupancy", get(get_occupancy))
        .route("/analytics/bookings", get(get_booking_analytics))
        .route("/analytics/benchmark", get(get_benchmark))
        .route("/analytics/personalized", get(get_personalized))
        .route("/reports/generate", get(generate_report))
}

async fn get_occupancy(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::analytics::get_occupancy_report_handler(State(pool), headers).await
}

async fn get_booking_analytics(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::analytics::get_booking_analytics_handler(State(pool), headers).await
}

async fn get_benchmark(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::analytics::get_occupancy_report_handler(State(pool), headers).await
}

async fn get_personalized(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::analytics::get_personalized_report_handler(State(pool), headers, query).await
}

async fn generate_report(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<handlers::analytics::ReportQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Allow users with either analytics:read OR reports:execute permission
    let has_analytics = require_permission_helper(&pool, &headers, "analytics:read").await.is_ok();
    let has_reports = require_permission_helper(&pool, &headers, "reports:execute").await.is_ok();

    if !has_analytics && !has_reports {
        return Err(ApiError::Forbidden("reports:execute or analytics:read permission required".to_string()));
    }

    handlers::analytics::generate_report_handler(State(pool), query).await
}
