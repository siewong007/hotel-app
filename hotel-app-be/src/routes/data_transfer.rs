//! Data transfer routes for export/import/overwrite of booking data

use axum::{
    routing::{get, post},
    Router,
    extract::{State, DefaultBodyLimit},
    http::HeaderMap,
    response::Json,
};
use crate::core::db::DbPool;
use crate::handlers;
use crate::core::middleware::require_admin_helper;
use crate::core::error::ApiError;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/data-transfer/export", get(export_data))
        .route("/data-transfer/import",
            post(import_data).layer(DefaultBodyLimit::max(100 * 1024 * 1024)) // 100MB limit
        )
}

async fn export_data(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<handlers::data_transfer::BookingDataExport>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::data_transfer::export_booking_data_handler(State(pool)).await
}

async fn import_data(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<handlers::data_transfer::ImportRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::data_transfer::import_booking_data_handler(State(pool), Json(input)).await
}
