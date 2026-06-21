//! Data transfer routes for export/import/overwrite of booking data

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{DefaultBodyLimit, State},
    http::HeaderMap,
    response::Json,
    routing::{get, post},
};

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/data-transfer/export/preview", get(preview_export_counts))
        .route("/data-transfer/export", get(export_data))
        .route(
            "/data-transfer/import",
            post(import_data).layer(DefaultBodyLimit::max(100 * 1024 * 1024)), // 100MB limit
        )
}

async fn export_data(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::BookingDataExport>, ApiError> {
    require_permission_helper(&pool, &headers, "settings:manage").await?;
    handlers::data_transfer::export_booking_data_handler(State(pool)).await
}

async fn preview_export_counts(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::ExportPreview>, ApiError> {
    require_permission_helper(&pool, &headers, "settings:manage").await?;
    handlers::data_transfer::preview_export_counts_handler(State(pool)).await
}

async fn import_data(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::ImportRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "settings:manage").await?;
    handlers::data_transfer::import_booking_data_handler(State(pool), user_id, Json(input)).await
}
