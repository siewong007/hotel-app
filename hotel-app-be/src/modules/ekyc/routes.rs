//! eKYC routes.

use axum::body::Body;
use axum::http::header;
use axum::{
    Router,
    extract::{ConnectInfo, Extension, Multipart, Path, Query, State},
    http::HeaderMap,
    response::{Json, Response},
    routing::{get, post},
};
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;

use super::models;
use super::service;
use super::validation;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{require_auth, require_permission_helper};
use crate::core::rate_limiter::RateLimiters;

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
        .route(
            "/ekyc/admin/applications",
            get(list_admin_applications).post(create_admin_application),
        )
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
}

/// Per-user and per-IP budget for account-API eKYC writes.
///
/// Shares the `guest_portal_ekyc` buckets with the portal routes deliberately.
/// `submit_ekyc` only accepts `user_type = 'guest'` callers and `/auth/register`
/// is public, so this endpoint is reachable by anyone who registers — limiting
/// only the portal surface would leave an equivalent, unmetered way in. The key
/// is prefixed `user:` rather than `guest:` because this path authenticates by
/// account, so the two surfaces get separate buckets per identity.
async fn enforce_account_ekyc_limit(
    limiters: &RateLimiters,
    user_id: i64,
    headers: &HeaderMap,
    peer_addr: SocketAddr,
) -> Result<(), ApiError> {
    let (ip_allowed, ip_retry_after) = limiters
        .guest_portal_ekyc_ip
        .check_with_retry(crate::routes::extract_client_ip(headers, peer_addr))
        .await;
    if !ip_allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many verification requests from this connection. Please try again in {ip_retry_after} seconds."
            ),
            ip_retry_after,
        ));
    }

    let (allowed, retry_after) = limiters
        .guest_portal_ekyc
        .check_with_retry(format!("user:{user_id}"))
        .await;
    if allowed {
        Ok(())
    } else {
        Err(ApiError::TooManyRequestsRetryAfter(
            format!("Too many verification attempts. Please try again in {retry_after} seconds."),
            retry_after,
        ))
    }
}

async fn upload_document(
    State(_pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    enforce_account_ekyc_limit(&limiters, user_id, &headers, peer_addr).await?;
    Ok(Json(
        service::store_document_upload(multipart, user_id).await?,
    ))
}

async fn submit_ekyc(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<models::EkycSubmissionRequest>,
) -> Result<Json<models::EkycStatusResponse>, ApiError> {
    let user_id = require_auth(&headers).await?;
    enforce_account_ekyc_limit(&limiters, user_id, &headers, peer_addr).await?;
    let ip = client_ip(&headers, peer_addr);
    let ua = user_agent(&headers);
    Ok(Json(
        service::submit_ekyc(
            &pool,
            user_id,
            input,
            service::SubmissionChannel::AccountApi,
            ip,
            ua,
        )
        .await?,
    ))
}

async fn get_status(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Option<models::EkycStatusResponse>>, ApiError> {
    let user_id = require_auth(&headers).await?;
    Ok(Json(service::get_ekyc_status(&pool, user_id).await?))
}

async fn self_checkin(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::SelfCheckinRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    Ok(Json(service::self_checkin(&pool, user_id, input).await?))
}

async fn get_dashboard(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::EkycDashboardMetrics>, ApiError> {
    require_permission_helper(&pool, &headers, "ekyc:read").await?;
    Ok(Json(service::admin_dashboard(&pool).await?))
}

async fn list_admin_applications(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(params): Query<models::EkycListQuery>,
) -> Result<Json<models::EkycAdminListResponse>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "ekyc:read").await?;
    Ok(Json(
        service::list_admin_applications(
            &pool,
            actor_id,
            params,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

async fn get_admin_application(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<models::EkycApplicationDetail>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "ekyc:read").await?;
    Ok(Json(
        service::get_admin_application(
            &pool,
            actor_id,
            id,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

async fn create_admin_application(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<models::EkycAdminCreateRequest>,
) -> Result<Json<models::EkycApplicationDetail>, ApiError> {
    let actor_id = require_auth(&headers).await?;
    Ok(Json(
        service::admin_create_verification(
            &pool,
            actor_id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

async fn apply_review_action(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<models::EkycReviewActionRequest>,
) -> Result<Json<models::EkycApplicationDetail>, ApiError> {
    let actor_id = require_auth(&headers).await?;
    Ok(Json(
        service::apply_review_action(
            &pool,
            actor_id,
            id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

async fn reveal_sensitive(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<models::EkycSensitiveRevealRequest>,
) -> Result<Json<models::EkycSensitiveRevealResponse>, ApiError> {
    let actor_id = require_auth(&headers).await?;
    Ok(Json(
        service::reveal_sensitive_field(
            &pool,
            actor_id,
            id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

async fn reason_codes(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::EkycReasonCode>>, ApiError> {
    require_permission_helper(&pool, &headers, "ekyc:review").await?;
    Ok(Json(service::reason_codes(&pool).await?))
}

async fn export_admin_applications(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(params): Query<models::EkycListQuery>,
) -> Result<Response, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "ekyc:export").await?;
    let csv = service::export_admin_applications_csv(
        &pool,
        actor_id,
        params,
        client_ip(&headers, peer_addr),
        user_agent(&headers),
    )
    .await?;

    Response::builder()
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"ekyc_applications.csv\"",
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .body(Body::from(csv))
        .map_err(|e| ApiError::Internal(format!("Failed to build CSV response: {}", e)))
}

async fn get_all_verifications(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::EkycApplicationSummary>>, ApiError> {
    require_permission_helper(&pool, &headers, "ekyc:read").await?;
    Ok(Json(service::list_ekyc(&pool).await?))
}

async fn get_verification(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<models::EkycApplicationDetail>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "ekyc:read").await?;
    Ok(Json(
        service::get_admin_application(
            &pool,
            actor_id,
            id,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

async fn get_document(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path((id, kind)): Path<(i64, String)>,
) -> Result<Response, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "ekyc:download_documents").await?;

    service::record_document_download(
        &pool,
        actor_id,
        id,
        &kind,
        client_ip(&headers, peer_addr),
        user_agent(&headers),
    )
    .await?;

    let path = service::get_document_path(&pool, id, &kind).await?;
    let prefix = format!("{}/", validation::EKYC_UPLOAD_DIR);
    if !path.starts_with(&prefix) {
        return Err(ApiError::NotFound("Document not found".to_string()));
    }

    let filename = &path[prefix.len()..];
    if filename.contains('/') || filename.contains('\\') {
        return Err(ApiError::NotFound("Document not found".to_string()));
    }

    let file_path = PathBuf::from(validation::EKYC_UPLOAD_DIR).join(filename);
    let bytes =
        fs::read(&file_path).map_err(|_| ApiError::NotFound("Document not found".to_string()))?;
    let content_type = match validation::image_extension(&bytes) {
        Some("jpg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    };

    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(bytes))
        .map_err(|e| ApiError::Internal(format!("Failed to build document response: {}", e)))
}


fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(512).collect())
}

/// Resolve the caller's address through the canonical helper, which only
/// consults `X-Forwarded-For`/`X-Real-IP` when `trust_proxy_headers` is set.
///
/// This module previously read those headers unconditionally and never looked
/// at the socket, so identity-verification audit rows recorded whatever
/// address the client claimed.
fn client_ip(headers: &HeaderMap, peer_addr: SocketAddr) -> Option<String> {
    Some(crate::routes::extract_client_ip(headers, peer_addr).to_string())
}
