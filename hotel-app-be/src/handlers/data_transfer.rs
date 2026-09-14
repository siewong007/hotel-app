//! Data transfer handlers for export + the staged backup-import pipeline
//! (`upload → preview → execute → poll`). All import endpoints are
//! super-admin only; the guard itself lives in `routes/data_transfer.rs`.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    ExportPreview, ImportExecuteRequest, ImportJobStatus, ImportPreview, ImportPreviewRequest,
};
use crate::services::data_transfer as data_transfer_service;
use crate::services::data_transfer_jobs::{self, StageUploadError};
use axum::{
    body::Body,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use uuid::Uuid;

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

/// Stage an uploaded backup under `private_uploads/data-transfer/` — the body
/// streams straight to disk and the response carries the staged upload id.
/// A 413 has no `ApiError` variant, so the service's own error enum maps here.
pub async fn stage_backup_upload_handler(body: Body) -> Result<Response, ApiError> {
    match data_transfer_jobs::stage_backup_upload(body).await {
        Ok(response) => Ok(Json(response).into_response()),
        Err(StageUploadError::PayloadTooLarge) => Ok((
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(serde_json::json!({
                "error": "the uploaded backup exceeds the 256 MB limit"
            })),
        )
            .into_response()),
        Err(StageUploadError::BadRequest(message)) => Err(ApiError::BadRequest(message)),
        Err(StageUploadError::Internal(error)) => Err(error),
    }
}

/// Pre-flight diff of a staged backup against this database.
pub async fn preview_import_handler(
    State(pool): State<DbPool>,
    Json(request): Json<ImportPreviewRequest>,
) -> Result<Json<ImportPreview>, ApiError> {
    Ok(Json(
        data_transfer_jobs::preview_import(&pool, request.upload_id).await?,
    ))
}

/// Start an import job for a staged upload — `202` with the job id.
pub async fn execute_import_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(request): Json<ImportExecuteRequest>,
) -> Result<Response, ApiError> {
    let response = data_transfer_jobs::start_import_job(&pool, user_id, request).await?;
    Ok((StatusCode::ACCEPTED, Json(response)).into_response())
}

/// Poll an import job's status. Finished entries expire after an hour.
pub async fn import_job_status_handler(
    Path(job_id): Path<Uuid>,
) -> Result<Json<ImportJobStatus>, ApiError> {
    data_transfer_jobs::import_job_status(job_id)
        .map(Json)
        .ok_or_else(|| ApiError::NotFound("import job not found or expired".to_string()))
}

/// Discard a staged upload the caller no longer intends to import.
pub async fn delete_staged_upload_handler(
    Path(upload_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    data_transfer_jobs::delete_staged_upload(upload_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
