//! eKYC routes.
//!
//! Routes for electronic Know Your Customer verification.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{require_auth, require_permission_helper};
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{Multipart, Path, Query, State},
    http::HeaderMap,
    response::{Json, Response},
    routing::{get, patch, post},
};

/// Create eKYC routes.
pub fn routes() -> Router<DbPool> {
    Router::new()
        // User eKYC routes
        .route("/ekyc/upload-document", post(upload_document))
        .route("/ekyc/submit", post(submit_ekyc))
        .route("/ekyc/status", get(get_status))
        .route("/ekyc/self-checkin", post(self_checkin))
        // Admin eKYC routes
        .route("/ekyc/admin/dashboard", get(get_dashboard))
        .route("/ekyc/admin/applications", get(list_admin_applications))
        .route(
            "/ekyc/admin/applications/export",
            get(export_admin_applications),
        )
        .route("/ekyc/admin/applications/{id}", get(get_admin_application))
        .route(
            "/ekyc/admin/applications/{id}/actions",
            post(apply_review_action),
        )
        .route(
            "/ekyc/admin/applications/{id}/reveal",
            post(reveal_sensitive),
        )
        .route("/ekyc/admin/reason-codes", get(reason_codes))
        .route(
            "/ekyc/admin/applications/{id}/documents/{kind}",
            get(get_document),
        )
        // Legacy admin routes kept for older callers.
        .route("/ekyc/verifications", get(get_all_verifications))
        .route("/ekyc/verifications/{id}", get(get_verification))
        .route(
            "/ekyc/verifications/{id}/documents/{kind}",
            get(get_document),
        )
        .route("/ekyc/verifications/{id}", patch(update_verification))
}

async fn upload_document(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::ekyc::upload_document_handler(State(pool), user_id, multipart).await
}

async fn submit_ekyc(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::EkycSubmissionRequest>,
) -> Result<Json<models::EkycStatusResponse>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::ekyc::submit_ekyc_handler(State(pool), headers, user_id, Json(input)).await
}

async fn get_status(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Option<models::EkycStatusResponse>>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::ekyc::get_ekyc_status_handler(State(pool), user_id).await
}

async fn self_checkin(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::SelfCheckinRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::ekyc::self_checkin_handler(State(pool), user_id, Json(input)).await
}

async fn get_dashboard(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::EkycDashboardMetrics>, ApiError> {
    require_permission_helper(&pool, &headers, "ekyc:read").await?;
    handlers::ekyc::get_dashboard_handler(State(pool)).await
}

async fn list_admin_applications(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<models::EkycListQuery>,
) -> Result<Json<models::EkycAdminListResponse>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "ekyc:read").await?;
    handlers::ekyc::list_admin_applications_handler(State(pool), headers, actor_id, Query(params))
        .await
}

async fn get_admin_application(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::EkycApplicationDetail>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "ekyc:read").await?;
    handlers::ekyc::get_admin_application_handler(State(pool), headers, actor_id, path).await
}

async fn apply_review_action(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::EkycReviewActionRequest>,
) -> Result<Json<models::EkycApplicationDetail>, ApiError> {
    let actor_id = require_auth(&headers).await?;
    handlers::ekyc::apply_review_action_handler(State(pool), headers, actor_id, path, Json(input))
        .await
}

async fn reveal_sensitive(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::EkycSensitiveRevealRequest>,
) -> Result<Json<models::EkycSensitiveRevealResponse>, ApiError> {
    let actor_id = require_auth(&headers).await?;
    handlers::ekyc::reveal_sensitive_handler(State(pool), headers, actor_id, path, Json(input))
        .await
}

async fn reason_codes(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::EkycReasonCode>>, ApiError> {
    require_permission_helper(&pool, &headers, "ekyc:review").await?;
    handlers::ekyc::reason_codes_handler(State(pool)).await
}

async fn export_admin_applications(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<models::EkycListQuery>,
) -> Result<Response, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "ekyc:export").await?;
    handlers::ekyc::export_admin_applications_handler(State(pool), headers, actor_id, Query(params))
        .await
}

async fn get_all_verifications(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::EkycApplicationSummary>>, ApiError> {
    require_permission_helper(&pool, &headers, "ekyc:read").await?;
    handlers::ekyc::get_all_ekyc_handler(State(pool)).await
}

async fn get_verification(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::EkycApplicationDetail>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "ekyc:read").await?;
    handlers::ekyc::get_admin_application_handler(State(pool), headers, actor_id, path).await
}

async fn get_document(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, String)>,
) -> Result<Response, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "ekyc:download_documents").await?;
    handlers::ekyc::get_ekyc_document_handler(State(pool), headers, actor_id, path).await
}

async fn update_verification(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::EkycVerificationUpdate>,
) -> Result<Json<models::EkycApplicationDetail>, ApiError> {
    let admin_id = require_permission_helper(&pool, &headers, "ekyc:verify").await?;
    handlers::ekyc::update_ekyc_handler(State(pool), headers, admin_id, path, Json(input)).await
}
