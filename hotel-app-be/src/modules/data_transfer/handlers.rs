//! Data transfer handlers for export + the staged backup-import pipeline
//! (`upload → preview → execute → poll`). All endpoints are guarded by the
//! `data_transfer:*` permission set in `routes/data_transfer.rs`.

use crate::core::auth::Claims;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    ExportPreview, ExportScope, ImportExecuteRequest, ImportJobStatus, ImportPreview,
    ImportPreviewRequest, StepUpRequest, StepUpResponse, TransferHistory,
};
use super::service as data_transfer_service;
use super::jobs::{self as data_transfer_jobs, StageUploadError};
use super::step_up as data_transfer_step_up;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use uuid::Uuid;

/// Export transferable data as a `hotel-backup` v1 file in the requested
/// scope (`standard`, `full`, `backup`, or `system`).
///
/// An encrypted document is not JSON and must not be labelled as such — it
/// gets `application/octet-stream` and a `.enc` extension so neither a
/// browser nor an operator mistakes it for something readable.
pub async fn export_booking_data_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    scope: ExportScope,
    passphrase: Option<String>,
) -> Result<Response, ApiError> {
    let encrypted = passphrase.is_some() || scope.requires_encryption();
    let body =
        data_transfer_service::export_booking_data_body(&pool, user_id, scope, passphrase).await?;
    let (extension, content_type) = if encrypted {
        ("json.enc", "application/octet-stream")
    } else {
        ("json", "application/json")
    };
    let filename = format!(
        "saliminn-backup-{}-{}.{extension}",
        scope.label(),
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ")
    );
    Ok(Response::builder()
        .status(axum::http::StatusCode::OK)
        .header("Content-Type", content_type)
        .header(
            "Content-Disposition",
            format!("attachment; filename=\"{filename}\""),
        )
        .body(body)
        .unwrap())
}

/// Preview record counts for the entities the requested scope would emit.
pub async fn preview_export_counts_handler(
    State(pool): State<DbPool>,
    scope: ExportScope,
) -> Result<Json<ExportPreview>, ApiError> {
    Ok(Json(
        data_transfer_service::preview_export_counts(&pool, scope).await?,
    ))
}

/// Re-authentication for privileged data-transfer operations — verifies the
/// caller's credentials and mints a short-lived `X-Step-Up` token.
pub async fn step_up_handler(
    State(pool): State<DbPool>,
    claims: Claims,
    request: StepUpRequest,
) -> Result<Json<StepUpResponse>, ApiError> {
    Ok(Json(
        data_transfer_step_up::issue_step_up(&pool, &claims, &request).await?,
    ))
}

/// Audited export/import activity for the transfer-history panel — capped at
/// 500 rows and always pinned to the data-transfer audit actions.
pub async fn transfer_history_handler(
    State(pool): State<DbPool>,
    limit: Option<i64>,
) -> Result<Json<TransferHistory>, ApiError> {
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let (rows, total) = crate::services::audit::get_recent_events_by_actions(
        &pool,
        &[
            "data_export",
            "data_import",
            data_transfer_step_up::STEP_UP_ACTION,
            data_transfer_step_up::STEP_UP_DENIED_ACTION,
        ],
        90,
        limit,
    )
    .await?;
    let entries = rows
        .into_iter()
        .map(|row| crate::models::TransferHistoryEntry {
            id: row.id,
            action: row.action,
            user_id: row.user_id,
            username: row.username,
            created_at: row.created_at.to_rfc3339(),
            details: row.details,
        })
        .collect();
    Ok(Json(TransferHistory { entries, total }))
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
        data_transfer_jobs::preview_import(&pool, request.upload_id, request.passphrase).await?,
    ))
}

/// Start an import job for a staged upload — `202` with the job id.
pub async fn execute_import_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    headers: HeaderMap,
    Json(request): Json<ImportExecuteRequest>,
) -> Result<Response, ApiError> {
    data_transfer_jobs::enforce_import_permissions(&pool, user_id, &headers, &request).await?;
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
