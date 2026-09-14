//! HTTP adapters for the Guest Relations workspace.
//!
//! Mirrors the support module's style: each handler resolves the caller via
//! `require_permission_helper` (route table in `routes.rs` maps path →
//! permission) and hands the actor id to the service. Handlers stay thin —
//! guest existence, private-note authorization, validation and audit live in
//! `service.rs`.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use serde_json::json;

use super::models::{
    FollowUpQueueQuery, FollowUpQueueResponse, GuestCommunicationsSummary, GuestInteraction,
    GuestInteractionInput, GuestInteractionUpdate, GuestLoyaltySummary, GuestPreference,
    GuestPreferencesPut, GuestReviewResponseInput, GuestReviewRow, GuestVoucherRow,
    InteractionListQuery, InteractionListResponse, OverviewResponse,
};
use super::service;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::modules::support::models::SupportConversationSummary;

pub async fn list_interactions_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
    Query(query): Query<InteractionListQuery>,
) -> Result<Json<InteractionListResponse>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "guests:read").await?;
    Ok(Json(
        service::list_interactions(&pool, actor_id, guest_id, query).await?,
    ))
}

pub async fn create_interaction_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
    Json(input): Json<GuestInteractionInput>,
) -> Result<Json<GuestInteraction>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "guests:update").await?;
    Ok(Json(
        service::create_interaction(&pool, actor_id, guest_id, input).await?,
    ))
}

pub async fn update_interaction_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path((guest_id, note_id)): Path<(i64, i64)>,
    Json(input): Json<GuestInteractionUpdate>,
) -> Result<Json<GuestInteraction>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "guests:update").await?;
    Ok(Json(
        service::update_interaction(&pool, actor_id, guest_id, note_id, input).await?,
    ))
}

pub async fn delete_interaction_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path((guest_id, note_id)): Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "guests:update").await?;
    service::delete_interaction(&pool, actor_id, guest_id, note_id).await?;
    Ok(Json(json!({
        "success": true,
        "message": "Interaction deleted successfully"
    })))
}

pub async fn list_preferences_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
) -> Result<Json<Vec<GuestPreference>>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:read").await?;
    Ok(Json(service::list_preferences(&pool, guest_id).await?))
}

pub async fn put_preferences_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
    Json(input): Json<GuestPreferencesPut>,
) -> Result<Json<Vec<GuestPreference>>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "guests:update").await?;
    Ok(Json(
        service::put_preferences(&pool, actor_id, guest_id, input).await?,
    ))
}

pub async fn list_reviews_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
) -> Result<Json<Vec<GuestReviewRow>>, ApiError> {
    require_permission_helper(&pool, &headers, "reviews:read").await?;
    Ok(Json(service::list_reviews(&pool, guest_id).await?))
}

pub async fn respond_to_review_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path((guest_id, review_id)): Path<(i64, i64)>,
    Json(input): Json<GuestReviewResponseInput>,
) -> Result<Json<GuestReviewRow>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "reviews:update").await?;
    Ok(Json(
        service::respond_to_review(&pool, actor_id, guest_id, review_id, input).await?,
    ))
}

/// 200 with `null` when the guest has no loyalty membership.
pub async fn loyalty_summary_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
) -> Result<Json<Option<GuestLoyaltySummary>>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:read").await?;
    Ok(Json(service::loyalty_summary(&pool, guest_id).await?))
}

pub async fn list_vouchers_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
) -> Result<Json<Vec<GuestVoucherRow>>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:read").await?;
    Ok(Json(service::list_vouchers(&pool, guest_id).await?))
}

pub async fn communications_summary_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
) -> Result<Json<GuestCommunicationsSummary>, ApiError> {
    require_permission_helper(&pool, &headers, "communications:read").await?;
    Ok(Json(service::communications_summary(&pool, guest_id).await?))
}

pub async fn list_support_conversations_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
) -> Result<Json<Vec<SupportConversationSummary>>, ApiError> {
    require_permission_helper(&pool, &headers, "support:read").await?;
    Ok(Json(
        service::list_support_conversations(&pool, guest_id).await?,
    ))
}

/// `GET /guest-relations/overview` — cross-guest dashboard aggregate. The
/// caller needs `guests:read`; the service further gates the `support` /
/// `reviews` sections by `support:read` / `reviews:read`.
pub async fn overview_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<OverviewResponse>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "guests:read").await?;
    Ok(Json(service::overview(&pool, actor_id).await?))
}

/// `GET /guest-relations/follow-ups` — paginated open follow-up queue in the
/// shared `{ data, total, page, page_size }` envelope.
pub async fn follow_ups_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<FollowUpQueueQuery>,
) -> Result<Json<FollowUpQueueResponse>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "guests:read").await?;
    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.unwrap_or(20);
    let (total, data) = service::list_follow_ups(
        &pool,
        actor_id,
        query.due.as_deref().unwrap_or("all"),
        page,
        page_size,
    )
    .await?;
    Ok(Json(FollowUpQueueResponse {
        data,
        total,
        page,
        page_size,
    }))
}
