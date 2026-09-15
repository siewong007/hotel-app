//! Data transfer routes for export + staged backup imports
//!
//! Imports run as a staged pipeline — `upload → preview → execute → poll` —
//! so a 256 MB backup never buffers inside a request handler and never blocks
//! one for the minutes a restore can take.

use std::net::SocketAddr;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{
    check_permission, extract_claims, extract_user_id, require_permission_helper,
};
use crate::core::rate_limiter::RateLimiters;
use super::handlers as handlers;
use crate::models;
use axum::{
    Router,
    body::Body,
    extract::{ConnectInfo, DefaultBodyLimit, Extension, Path, Query, State},
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
        .route("/data-transfer/step-up", post(step_up))
        .route("/data-transfer/history", get(transfer_history))
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

/// Every data-transfer endpoint runs on the grantable `data_transfer:*`
/// permission set — no `settings:manage`, no super-admin flag. Conditional
/// permissions (`export_sensitive`, `import_sensitive`, `override`,
/// `restore`) and step-up re-authentication are enforced deeper, where the
/// file and request mode are known.
async fn export_data(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<models::ExportScopeQuery>,
) -> Result<Response, ApiError> {
    let claims = extract_claims(&headers).await?;
    let user_id = extract_user_id(&claims)?;
    let permission = if query.scope.includes_sensitive() {
        "data_transfer:export_sensitive"
    } else {
        "data_transfer:export"
    };
    check_permission(&pool, user_id, permission).await?;
    if query.scope.includes_sensitive() {
        super::step_up::require_step_up(&headers, &claims)?;
    }
    handlers::export_booking_data_handler(State(pool), user_id, query.scope).await
}

async fn preview_export_counts(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<models::ExportScopeQuery>,
) -> Result<Json<models::ExportPreview>, ApiError> {
    let claims = extract_claims(&headers).await?;
    let user_id = extract_user_id(&claims)?;
    // Seeing the sensitive tiers' entity list still requires the export
    // permission — the preview is a map of exactly what a file would carry.
    let permission = if query.scope.includes_sensitive() {
        "data_transfer:export_sensitive"
    } else {
        "data_transfer:view"
    };
    check_permission(&pool, user_id, permission).await?;
    handlers::preview_export_counts_handler(State(pool), query.scope).await
}

/// Re-authenticate for a privileged operation. Gated on authentication alone
/// — the token it mints only unlocks endpoints that check the operation's own
/// permission — but rate-limited like every credential check.
async fn step_up(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<models::StepUpRequest>,
) -> Result<Json<models::StepUpResponse>, ApiError> {
    let ip = crate::routes::extract_client_ip(&headers, peer_addr);
    let (allowed, retry_after) = limiters.sensitive.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!("Too many attempts. Please try again in {retry_after} seconds."),
            retry_after,
        ));
    }
    let claims = extract_claims(&headers).await?;
    handlers::step_up_handler(State(pool), claims, request).await
}

async fn transfer_history(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<models::TransferHistoryQuery>,
) -> Result<Json<models::TransferHistory>, ApiError> {
    require_permission_helper(&pool, &headers, "data_transfer:view").await?;
    handlers::transfer_history_handler(State(pool), query.limit).await
}

async fn stage_backup_upload(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, ApiError> {
    require_permission_helper(&pool, &headers, "data_transfer:import").await?;
    handlers::stage_backup_upload_handler(body).await
}

async fn preview_import(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(request): Json<models::ImportPreviewRequest>,
) -> Result<Json<models::ImportPreview>, ApiError> {
    require_permission_helper(&pool, &headers, "data_transfer:import").await?;
    handlers::preview_import_handler(State(pool), Json(request)).await
}

async fn execute_import(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(request): Json<models::ImportExecuteRequest>,
) -> Result<Response, ApiError> {
    let user_id =
        require_permission_helper(&pool, &headers, "data_transfer:import").await?;
    handlers::execute_import_handler(State(pool), user_id, headers, Json(request))
        .await
}

async fn import_job_status(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<Json<models::ImportJobStatus>, ApiError> {
    require_permission_helper(&pool, &headers, "data_transfer:import").await?;
    handlers::import_job_status_handler(Path(job_id)).await
}

async fn discard_staged_upload(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(upload_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, ApiError> {
    require_permission_helper(&pool, &headers, "data_transfer:import").await?;
    handlers::delete_staged_upload_handler(Path(upload_id)).await
}
