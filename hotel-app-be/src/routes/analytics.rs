//! Analytics routes
//!
//! Routes for reports and analytics dashboards.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{
    require_any_permission_helper, require_auth, require_permission_helper,
};
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{Extension, Query, State},
    http::HeaderMap,
    response::Json,
    routing::get,
};
use std::collections::HashMap;

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
    require_permission_helper(&pool, &headers, "analytics:read").await?;
    handlers::analytics::get_occupancy_report_handler(State(pool)).await
}

async fn get_booking_analytics(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;
    handlers::analytics::get_booking_analytics_handler(State(pool)).await
}

async fn get_benchmark(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;
    handlers::analytics::get_benchmark_report_handler(State(pool)).await
}

async fn get_personalized(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;
    let user_id = require_auth(&headers).await?;
    handlers::analytics::get_personalized_report_handler(State(pool), Extension(user_id), query)
        .await
}

async fn generate_report(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::ReportQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id =
        require_any_permission_helper(&pool, &headers, &["analytics:read", "reports:execute"])
            .await
            .map_err(|err| {
                if matches!(err, ApiError::Forbidden(_)) {
                    ApiError::Forbidden(
                        "reports:execute or analytics:read permission required".to_string(),
                    )
                } else {
                    err
                }
            })?;

    handlers::analytics::generate_report_handler(State(pool), Extension(user_id), query).await
}
