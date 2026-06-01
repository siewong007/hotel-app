//! Night audit routes

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::handlers::night_audit;
use crate::models::{
    AuditDetailsResponse, ListAuditsQuery, NightAuditPreview, NightAuditResponse,
    NightAuditRunWithUser, RunNightAuditRequest,
};
use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
};
use std::collections::HashMap;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/night-audit/preview", get(get_preview))
        .route("/night-audit/run", post(run_audit))
        .route("/night-audit", get(list_audits))
        .route("/night-audit/{id}", get(get_audit))
        .route("/night-audit/{id}/details", get(get_audit_details))
        .route("/bookings/{id}/posted", get(is_booking_posted))
}

async fn get_preview(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<HashMap<String, String>>,
) -> Result<Json<NightAuditPreview>, ApiError> {
    require_permission_helper(&pool, &headers, "night_audit:read").await?;
    night_audit::get_night_audit_preview(State(pool), query).await
}

async fn run_audit(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<RunNightAuditRequest>,
) -> Result<Json<NightAuditResponse>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "night_audit:execute").await?;
    night_audit::run_night_audit(State(pool), Extension(user_id), Json(input)).await
}

async fn list_audits(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<ListAuditsQuery>,
) -> Result<Json<Vec<NightAuditRunWithUser>>, ApiError> {
    require_permission_helper(&pool, &headers, "night_audit:read").await?;
    night_audit::list_night_audits(State(pool), query).await
}

async fn get_audit(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<NightAuditRunWithUser>, ApiError> {
    require_permission_helper(&pool, &headers, "night_audit:read").await?;
    night_audit::get_night_audit(State(pool), path).await
}

async fn get_audit_details(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<AuditDetailsResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "night_audit:read").await?;
    night_audit::get_night_audit_details(State(pool), path).await
}

async fn is_booking_posted(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "bookings:read").await?;
    night_audit::is_booking_posted(State(pool), path).await
}
