//! eKYC routes
//!
//! Routes for electronic Know Your Customer verification.

use axum::{
    routing::{get, post, patch},
    Router,
    extract::{State, Path, Multipart},
    http::HeaderMap,
    response::Json,
};
use sqlx::PgPool;
use crate::handlers;
use crate::models;
use crate::core::middleware::require_permission_helper;
use crate::core::error::ApiError;

/// Create eKYC routes
pub fn routes() -> Router<PgPool> {
    Router::new()
        // User eKYC routes
        .route("/ekyc/upload-document", post(upload_document))
        .route("/ekyc/submit", post(submit_ekyc))
        .route("/ekyc/status", get(get_status))
        .route("/ekyc/self-checkin", post(self_checkin))
        // Admin eKYC routes
        .route("/ekyc/verifications", get(get_all_verifications))
        .route("/ekyc/verifications/:id", get(get_verification))
        .route("/ekyc/verifications/:id", patch(update_verification))
}

async fn upload_document(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::ekyc::upload_document_handler(State(pool), headers, multipart).await
}

async fn submit_ekyc(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::EkycSubmissionRequest>,
) -> Result<Json<models::EkycStatusResponse>, ApiError> {
    handlers::ekyc::submit_ekyc_handler(State(pool), headers, Json(input)).await
}

async fn get_status(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Option<models::EkycStatusResponse>>, ApiError> {
    handlers::ekyc::get_ekyc_status_handler(State(pool), headers).await
}

async fn self_checkin(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::SelfCheckinRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::ekyc::self_checkin_handler(State(pool), headers, Json(input)).await
}

async fn get_all_verifications(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::EkycVerification>>, ApiError> {
    require_permission_helper(&pool, &headers, "ekyc:manage").await?;
    handlers::ekyc::get_all_ekyc_handler(State(pool)).await
}

async fn get_verification(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::EkycVerification>, ApiError> {
    require_permission_helper(&pool, &headers, "ekyc:manage").await?;
    handlers::ekyc::get_ekyc_by_id_handler(State(pool), path).await
}

async fn update_verification(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::EkycVerificationUpdate>,
) -> Result<Json<models::EkycVerification>, ApiError> {
    require_permission_helper(&pool, &headers, "ekyc:verify").await?;
    handlers::ekyc::update_ekyc_handler(State(pool), headers, path, Json(input)).await
}
