//! Data transfer handlers for export/import/overwrite of booking-related data

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{ExportPreview, ImportRequest};
use crate::services::data_transfer as data_transfer_service;
use axum::{
    extract::State,
    response::{Json, Response},
};
use serde_json::Value;

/// Export all booking-related data as a `hotel-backup` v3 file
pub async fn export_booking_data_handler(
    State(pool): State<DbPool>,
    user_id: i64,
) -> Result<Response, ApiError> {
    let body = data_transfer_service::export_booking_data_body(&pool, user_id).await?;
    let filename = format!(
        "saliminn-backup-{}.json",
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ")
    );
    Ok(Response::builder()
        .status(axum::http::StatusCode::OK)
        .header("Content-Type", "application/json")
        .header(
            "Content-Disposition",
            format!("attachment; filename=\"{filename}\""),
        )
        .body(body)
        .unwrap())
}

/// Preview record counts for all transferable tables
pub async fn preview_export_counts_handler(
    State(pool): State<DbPool>,
) -> Result<Json<ExportPreview>, ApiError> {
    Ok(Json(
        data_transfer_service::preview_export_counts(&pool).await?,
    ))
}

/// Import or overwrite booking-related data
pub async fn import_booking_data_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(request): Json<ImportRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        data_transfer_service::import_booking_data(&pool, user_id, request).await?,
    ))
}
