//! Analytics and reporting handlers
//!
//! Handles reports and analytics dashboards.

use super::service;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::ReportQuery;
use axum::{
    Json,
    extract::{Extension, Query, State},
};
use std::collections::HashMap;

pub async fn get_occupancy_report_handler(
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(service::occupancy_report(&pool).await?))
}

pub async fn get_booking_analytics_handler(
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(service::booking_analytics(&pool).await?))
}

pub async fn get_benchmark_report_handler(
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(service::benchmark_report(&pool).await?))
}

pub async fn get_personalized_report_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        service::personalized_report(&pool, user_id, params).await?,
    ))
}

pub async fn generate_report_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<ReportQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        service::generate_report(&pool, user_id, params).await?,
    ))
}
