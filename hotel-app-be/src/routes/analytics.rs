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
use sqlx::PgPool;
use std::collections::HashMap;
use crate::handlers;
use crate::core::middleware::require_permission_helper;
use crate::core::error::ApiError;

/// Create analytics routes
pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/analytics/occupancy", get(get_occupancy))
        .route("/analytics/bookings", get(get_booking_analytics))
        .route("/analytics/benchmark", get(get_benchmark))
        .route("/analytics/personalized", get(get_personalized))
        .route("/reports/generate", get(generate_report))
}

async fn get_occupancy(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::analytics::get_occupancy_report_handler(State(pool), headers).await
}

async fn get_booking_analytics(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::analytics::get_booking_analytics_handler(State(pool), headers).await
}

async fn get_benchmark(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::analytics::get_occupancy_report_handler(State(pool), headers).await
}

async fn get_personalized(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    query: Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::analytics::get_personalized_report_handler(State(pool), headers, query).await
}

async fn generate_report(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    query: Query<handlers::analytics::ReportQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;
    handlers::analytics::generate_report_handler(State(pool), query).await
}
