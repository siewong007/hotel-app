//! Data transfer routes for export/import/overwrite of booking data

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{ensure_super_admin, require_permission_helper};
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
            // Full database exports include audit/session history and can exceed
            // the former 100 MB business-data limit.
            post(import_data).layer(DefaultBodyLimit::max(1024 * 1024 * 1024)),
        )
}

async fn export_data(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<axum::response::Response, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "settings:manage").await?;
    handlers::data_transfer::export_booking_data_handler(State(pool), user_id).await
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
    // Import can clear whole tables, so it stays behind the super-admin flag
    // even though export/preview ride on the grantable settings:manage.
    ensure_super_admin(&pool, user_id).await?;
    handlers::data_transfer::import_booking_data_handler(State(pool), user_id, Json(input)).await
}
