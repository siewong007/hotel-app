//! HTTP adapters for the communications domain.

use axum::{
    Json,
    extract::{ConnectInfo, Path, Query, State},
    http::HeaderMap,
};
use serde::Deserialize;
use std::net::SocketAddr;

use super::models::{
    AudienceCount, CampaignInput, CampaignListQuery, CampaignListResponse, ConsentStatusResponse,
    DeliveryListResponse, EmailCampaign, EmailTemplate, PreferenceUpdateInput, PreferencesResponse,
    PreviewResponse, ScheduleCampaignInput, SuppressionInput, SuppressionListResponse,
    TemplateInput, TestSendInput, UnsubscribeApplyInput,
};
use super::service;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::services::guest_portal;

fn client_ip(headers: &HeaderMap, peer_addr: SocketAddr) -> Option<String> {
    Some(crate::routes::extract_client_ip(headers, peer_addr).to_string())
}

fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
}

#[derive(Debug, Deserialize)]
pub struct PageQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct AudienceQuery {
    pub topic: String,
}

// ----------------------------------------------------------------------
// Staff: campaigns
// ----------------------------------------------------------------------

pub async fn list_campaigns_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<CampaignListQuery>,
) -> Result<Json<CampaignListResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "communications:read").await?;
    Ok(Json(service::list_campaigns(&pool, query).await?))
}

pub async fn create_campaign_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<CampaignInput>,
) -> Result<Json<EmailCampaign>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "communications:compose").await?;
    Ok(Json(
        service::create_campaign(
            &pool,
            actor_id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn get_campaign_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<EmailCampaign>, ApiError> {
    require_permission_helper(&pool, &headers, "communications:read").await?;
    Ok(Json(service::get_campaign(&pool, id).await?))
}

pub async fn update_campaign_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<CampaignInput>,
) -> Result<Json<EmailCampaign>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "communications:compose").await?;
    Ok(Json(
        service::update_campaign(
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

pub async fn preview_campaign_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<PreviewResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "communications:read").await?;
    Ok(Json(service::preview_campaign(&pool, id).await?))
}

pub async fn test_send_campaign_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<TestSendInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "communications:send").await?;
    service::test_send_campaign(
        &pool,
        actor_id,
        id,
        input,
        client_ip(&headers, peer_addr),
        user_agent(&headers),
    )
    .await?;
    Ok(Json(serde_json::json!({ "status": "sent" })))
}

pub async fn schedule_campaign_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<ScheduleCampaignInput>,
) -> Result<Json<EmailCampaign>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "communications:send").await?;
    Ok(Json(
        service::schedule_campaign(
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

pub async fn cancel_campaign_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<EmailCampaign>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "communications:send").await?;
    Ok(Json(
        service::cancel_campaign(
            &pool,
            actor_id,
            id,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn list_campaign_deliveries_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Query(query): Query<PageQuery>,
) -> Result<Json<DeliveryListResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "communications:read").await?;
    Ok(Json(
        service::list_campaign_deliveries(&pool, id, query.page, query.page_size).await?,
    ))
}

// ----------------------------------------------------------------------
// Staff: templates
// ----------------------------------------------------------------------

pub async fn list_templates_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<EmailTemplate>>, ApiError> {
    require_permission_helper(&pool, &headers, "communications:read").await?;
    Ok(Json(service::list_templates(&pool).await?))
}

pub async fn create_template_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<TemplateInput>,
) -> Result<Json<EmailTemplate>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "communications:compose").await?;
    Ok(Json(
        service::create_template(
            &pool,
            actor_id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn update_template_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<TemplateInput>,
) -> Result<Json<EmailTemplate>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "communications:compose").await?;
    Ok(Json(
        service::update_template(
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

pub async fn deactivate_template_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "communications:manage").await?;
    service::deactivate_template(
        &pool,
        actor_id,
        id,
        client_ip(&headers, peer_addr),
        user_agent(&headers),
    )
    .await?;
    Ok(Json(serde_json::json!({ "status": "deactivated" })))
}

// ----------------------------------------------------------------------
// Staff: audience, suppressions, guest consent
// ----------------------------------------------------------------------

pub async fn audience_count_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<AudienceQuery>,
) -> Result<Json<AudienceCount>, ApiError> {
    require_permission_helper(&pool, &headers, "communications:read").await?;
    Ok(Json(service::audience_count(&pool, &query.topic).await?))
}

pub async fn list_suppressions_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<PageQuery>,
) -> Result<Json<SuppressionListResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "communications:manage").await?;
    Ok(Json(
        service::list_suppressions(&pool, query.page, query.page_size).await?,
    ))
}

pub async fn add_suppression_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<SuppressionInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "communications:manage").await?;
    service::add_suppression(
        &pool,
        actor_id,
        input,
        client_ip(&headers, peer_addr),
        user_agent(&headers),
    )
    .await?;
    Ok(Json(serde_json::json!({ "status": "suppressed" })))
}

pub async fn remove_suppression_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(email): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "communications:manage").await?;
    service::remove_suppression(
        &pool,
        actor_id,
        &email,
        client_ip(&headers, peer_addr),
        user_agent(&headers),
    )
    .await?;
    Ok(Json(serde_json::json!({ "status": "removed" })))
}

pub async fn guest_consent_status_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
) -> Result<Json<ConsentStatusResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "communications:read").await?;
    Ok(Json(service::guest_consent_status(&pool, guest_id).await?))
}

pub async fn record_staff_consent_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
    Json(input): Json<PreferenceUpdateInput>,
) -> Result<Json<ConsentStatusResponse>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "communications:manage").await?;
    Ok(Json(
        service::record_staff_consent(
            &pool,
            actor_id,
            guest_id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

// ----------------------------------------------------------------------
// Guest portal: notification preferences
// ----------------------------------------------------------------------

pub async fn get_my_preferences_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<PreferencesResponse>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    Ok(Json(service::get_preferences(&pool, guest_id).await?))
}

pub async fn update_my_preferences_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<PreferenceUpdateInput>,
) -> Result<Json<PreferencesResponse>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    Ok(Json(
        service::update_my_preferences(
            &pool,
            guest_id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

// ----------------------------------------------------------------------
// Public: token-based unsubscribe
// ----------------------------------------------------------------------

pub async fn unsubscribe_view_handler(
    State(pool): State<DbPool>,
    Path(token): Path<String>,
) -> Result<Json<PreferencesResponse>, ApiError> {
    Ok(Json(service::unsubscribe_view(&pool, &token).await?))
}

pub async fn unsubscribe_apply_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(input): Json<UnsubscribeApplyInput>,
) -> Result<Json<PreferencesResponse>, ApiError> {
    Ok(Json(
        service::unsubscribe_apply(
            &pool,
            &token,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}
