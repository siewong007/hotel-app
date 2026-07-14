//! HTTP adapters for the support workflow.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};

use super::models::{
    CreateGuestSupportConversationRequest, GuestSupportConversationDetail,
    GuestSupportConversationListResponse, GuestSupportMessageRequest, SupportActionRequest,
    SupportConversationDetail, SupportConversationListResponse, SupportListQuery, SupportMessageRequest,
};
use super::service;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{require_any_permission_helper, require_auth, require_permission_helper};
use crate::services::guest_portal;

#[derive(Debug, serde::Deserialize)]
pub struct GuestSupportListQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

fn client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
}

pub async fn list_staff_conversations_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<SupportListQuery>,
) -> Result<Json<SupportConversationListResponse>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "support:read").await?;
    Ok(Json(service::list_staff_conversations(&pool, actor_id, query).await?))
}

pub async fn get_staff_conversation_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(conversation_id): Path<i64>,
) -> Result<Json<SupportConversationDetail>, ApiError> {
    require_permission_helper(&pool, &headers, "support:read").await?;
    Ok(Json(service::get_staff_conversation(&pool, conversation_id).await?))
}

pub async fn list_support_agents_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<super::models::SupportAgent>>, ApiError> {
    require_any_permission_helper(&pool, &headers, &["support:assign", "support:manage"]).await?;
    Ok(Json(service::list_support_agents(&pool).await?))
}

pub async fn send_staff_message_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(conversation_id): Path<i64>,
    Json(request): Json<SupportMessageRequest>,
) -> Result<Json<SupportConversationDetail>, ApiError> {
    let actor_id = require_auth(&headers).await?;
    Ok(Json(
        service::send_staff_message(
            &pool,
            actor_id,
            conversation_id,
            request,
            client_ip(&headers),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn apply_staff_action_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(conversation_id): Path<i64>,
    Json(request): Json<SupportActionRequest>,
) -> Result<Json<SupportConversationDetail>, ApiError> {
    let actor_id = require_auth(&headers).await?;
    Ok(Json(
        service::apply_staff_action(
            &pool,
            actor_id,
            conversation_id,
            request.into(),
            client_ip(&headers),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn list_guest_conversations_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<GuestSupportListQuery>,
) -> Result<Json<GuestSupportConversationListResponse>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    Ok(Json(
        service::list_guest_conversations(&pool, guest_id, query.page, query.page_size).await?,
    ))
}

pub async fn create_guest_conversation_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(request): Json<CreateGuestSupportConversationRequest>,
) -> Result<Json<GuestSupportConversationDetail>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    Ok(Json(
        service::create_guest_conversation(
            &pool,
            guest_id,
            request,
            client_ip(&headers),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn get_guest_conversation_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(conversation_id): Path<i64>,
) -> Result<Json<GuestSupportConversationDetail>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    Ok(Json(
        service::get_guest_conversation(&pool, guest_id, conversation_id).await?,
    ))
}

pub async fn send_guest_message_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(conversation_id): Path<i64>,
    Json(request): Json<GuestSupportMessageRequest>,
) -> Result<Json<GuestSupportConversationDetail>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    Ok(Json(
        service::send_guest_message(
            &pool,
            guest_id,
            conversation_id,
            request,
            client_ip(&headers),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn reopen_guest_conversation_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(conversation_id): Path<i64>,
) -> Result<Json<GuestSupportConversationDetail>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    Ok(Json(
        service::reopen_guest_conversation(
            &pool,
            guest_id,
            conversation_id,
            client_ip(&headers),
            user_agent(&headers),
        )
        .await?,
    ))
}
