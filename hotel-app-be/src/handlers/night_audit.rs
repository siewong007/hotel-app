//! Night Audit handlers for posting daily data for reporting

use axum::{
    Json,
    extract::{Extension, Path, Query, State},
};
use chrono::NaiveDate;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    AuditDetailsResponse, ListAuditsQuery, NightAuditListResponse, NightAuditPreview,
    NightAuditResponse, NightAuditRunWithUser, RunNightAuditRequest,
};
use crate::services::night_audit;
use std::collections::HashMap;

/// Get preview of what will be posted for a given date
pub async fn get_night_audit_preview(
    State(pool): State<DbPool>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<NightAuditPreview>, ApiError> {
    let audit_date_str = params
        .get("date")
        .ok_or_else(|| ApiError::BadRequest("Date is required".to_string()))?;

    let audit_date = NaiveDate::parse_from_str(audit_date_str, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid date. Use YYYY-MM-DD".to_string()))?;

    Ok(Json(night_audit::preview(&pool, audit_date).await?))
}

/// Run night audit for a specific date
pub async fn run_night_audit(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<RunNightAuditRequest>,
) -> Result<Json<NightAuditResponse>, ApiError> {
    Ok(Json(night_audit::run(&pool, user_id, input).await?))
}

/// List all night audit runs
pub async fn list_night_audits(
    State(pool): State<DbPool>,
    Query(params): Query<ListAuditsQuery>,
) -> Result<Json<NightAuditListResponse>, ApiError> {
    Ok(Json(night_audit::list(&pool, params).await?))
}

/// Get a specific night audit run by ID
pub async fn get_night_audit(
    State(pool): State<DbPool>,
    Path(audit_id): Path<i64>,
) -> Result<Json<NightAuditRunWithUser>, ApiError> {
    Ok(Json(night_audit::get(&pool, audit_id).await?))
}

/// Get audit details including all posted bookings
pub async fn get_night_audit_details(
    State(pool): State<DbPool>,
    Path(audit_id): Path<i64>,
) -> Result<Json<AuditDetailsResponse>, ApiError> {
    Ok(Json(night_audit::details(&pool, audit_id).await?))
}

/// Check if a booking is posted (can be used to prevent editing)
pub async fn is_booking_posted(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        night_audit::booking_posted_status(&pool, booking_id).await?,
    ))
}
