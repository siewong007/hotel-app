//! Data transfer handlers for export/import/overwrite of booking-related data

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{BookingDataExport, ExportPreview, ImportRequest};
use crate::services::data_transfer as data_transfer_service;
use axum::{extract::State, response::Json};
use serde_json::Value;

/// Export all booking-related data
pub async fn export_booking_data_handler(
    State(pool): State<DbPool>,
) -> Result<Json<BookingDataExport>, ApiError> {
    Ok(Json(
        data_transfer_service::export_booking_data(&pool).await?,
    ))
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
