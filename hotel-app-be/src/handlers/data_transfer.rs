//! Data transfer handlers for export/import/overwrite of booking-related data

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{BookingDataExport, ImportRequest};
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

/// Import or overwrite booking-related data
pub async fn import_booking_data_handler(
    State(pool): State<DbPool>,
    Json(request): Json<ImportRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        data_transfer_service::import_booking_data(&pool, request).await?,
    ))
}
