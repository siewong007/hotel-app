//! HTTP adapters for the guest-segments admin surface.

use axum::{
    Json,
    extract::{ConnectInfo, Path, Query, State},
    http::HeaderMap,
};
use std::net::SocketAddr;

use super::models::{
    GuestSegment, SegmentFieldOptions, SegmentInput, SegmentListQuery, SegmentListResponse,
    SegmentPreview, SegmentPreviewInput,
};
use super::service;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;

fn client_ip(headers: &HeaderMap, peer_addr: SocketAddr) -> Option<String> {
    Some(crate::routes::extract_client_ip(headers, peer_addr).to_string())
}

fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
}

pub async fn list_segments_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<SegmentListQuery>,
) -> Result<Json<SegmentListResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "segments:read").await?;
    Ok(Json(service::list_segments(&pool, &query).await?))
}

pub async fn get_segment_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<GuestSegment>, ApiError> {
    require_permission_helper(&pool, &headers, "segments:read").await?;
    Ok(Json(service::get_segment(&pool, id).await?))
}

pub async fn create_segment_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<SegmentInput>,
) -> Result<Json<GuestSegment>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "segments:manage").await?;
    Ok(Json(
        service::create_segment(
            &pool,
            actor_id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn update_segment_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<SegmentInput>,
) -> Result<Json<GuestSegment>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "segments:manage").await?;
    Ok(Json(
        service::update_segment(
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

pub async fn delete_segment_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "segments:manage").await?;
    service::delete_segment(
        &pool,
        actor_id,
        id,
        client_ip(&headers, peer_addr),
        user_agent(&headers),
    )
    .await?;
    Ok(Json(serde_json::json!({ "status": "deleted" })))
}

/// Preview of a saved segment: live member count + up to 10 sample names.
pub async fn preview_segment_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<SegmentPreview>, ApiError> {
    require_permission_helper(&pool, &headers, "segments:read").await?;
    Ok(Json(service::preview_saved(&pool, id).await?))
}

/// Preview of unsaved rules from the editor — count only.
pub async fn preview_rules_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<SegmentPreviewInput>,
) -> Result<Json<SegmentPreview>, ApiError> {
    require_permission_helper(&pool, &headers, "segments:read").await?;
    Ok(Json(service::preview_rules(&pool, input).await?))
}

pub async fn field_options_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<SegmentFieldOptions>, ApiError> {
    require_permission_helper(&pool, &headers, "segments:read").await?;
    Ok(Json(service::field_options(&pool).await?))
}
