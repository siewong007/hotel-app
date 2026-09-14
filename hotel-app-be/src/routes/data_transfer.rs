//! Data transfer routes for export + staged backup imports
//!
//! Imports run as a staged pipeline — `upload → preview → execute → poll` —
//! so a 256 MB backup never buffers inside a request handler and never blocks
//! one for the minutes a restore can take.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{ensure_super_admin, require_permission_helper};
use crate::handlers;
use crate::models;
use axum::{
    Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, State},
    http::HeaderMap,
    response::{Json, Response},
    routing::{delete, get, post},
};
use uuid::Uuid;

/// Backup uploads cap at 256 MB — above that, split the export first. The
/// limit also bounds what preview/execute ever stage on disk.
const MAX_UPLOAD_BODY_BYTES: usize = 256 * 1024 * 1024;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/data-transfer/export/preview", get(preview_export_counts))
        .route("/data-transfer/export", get(export_data))
        .route(
            "/data-transfer/import/uploads",
            post(stage_backup_upload).layer(DefaultBodyLimit::max(MAX_UPLOAD_BODY_BYTES)),
        )
        .route("/data-transfer/import/preview", post(preview_import))
        .route("/data-transfer/import/execute", post(execute_import))
        .route(
            "/data-transfer/import/jobs/{job_id}",
            get(import_job_status),
        )
        .route(
            "/data-transfer/import/uploads/{upload_id}",
            delete(discard_staged_upload),
        )
}

/// Import endpoints clear whole tables and remap references, so they stay
/// behind the super-admin flag even though export/preview ride on the
/// grantable `settings:manage` permission.
async fn require_super_admin(pool: &DbPool, headers: &HeaderMap) -> Result<i64, ApiError> {
    let user_id = require_permission_helper(pool, headers, "settings:manage").await?;
    ensure_super_admin(pool, user_id).await?;
    Ok(user_id)
}

async fn export_data(State(pool): State<DbPool>, headers: HeaderMap) -> Result<Response, ApiError> {
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

async fn stage_backup_upload(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, ApiError> {
    require_super_admin(&pool, &headers).await?;
    handlers::data_transfer::stage_backup_upload_handler(body).await
}

async fn preview_import(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(request): Json<models::ImportPreviewRequest>,
) -> Result<Json<models::ImportPreview>, ApiError> {
    require_super_admin(&pool, &headers).await?;
    handlers::data_transfer::preview_import_handler(State(pool), Json(request)).await
}

async fn execute_import(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(request): Json<models::ImportExecuteRequest>,
) -> Result<Response, ApiError> {
    let user_id = require_super_admin(&pool, &headers).await?;
    handlers::data_transfer::execute_import_handler(State(pool), user_id, Json(request)).await
}

async fn import_job_status(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<Json<models::ImportJobStatus>, ApiError> {
    require_super_admin(&pool, &headers).await?;
    handlers::data_transfer::import_job_status_handler(Path(job_id)).await
}

async fn discard_staged_upload(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(upload_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, ApiError> {
    require_super_admin(&pool, &headers).await?;
    handlers::data_transfer::delete_staged_upload_handler(Path(upload_id)).await
}
