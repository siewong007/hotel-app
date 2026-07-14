//! HTTP adapters for promotions and vouchers.

use axum::{
    Json,
    extract::{ConnectInfo, Path, Query, State},
    http::HeaderMap,
};
use std::net::SocketAddr;

use super::models::{
    ClaimPromotionInput, GuestPromotionListResponse, Promotion, PromotionActionInput, PromotionInput,
    PromotionListQuery, PromotionListResponse, Voucher, VoucherIssueInput, VoucherListResponse,
    VoucherRevokeInput,
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

pub async fn list_public_promotions_handler(
    State(pool): State<DbPool>,
    Query(query): Query<PromotionListQuery>,
) -> Result<Json<PromotionListResponse>, ApiError> {
    Ok(Json(service::list_public_promotions(&pool, query).await?))
}

pub async fn get_public_promotion_handler(
    State(pool): State<DbPool>,
    Path(slug): Path<String>,
) -> Result<Json<Promotion>, ApiError> {
    Ok(Json(service::get_public_promotion(&pool, &slug).await?))
}

pub async fn list_guest_promotions_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<PromotionListQuery>,
) -> Result<Json<GuestPromotionListResponse>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    Ok(Json(
        service::list_guest_promotions(&pool, guest_id, query).await?,
    ))
}

pub async fn claim_guest_promotion_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(promotion_id): Path<i64>,
    Json(input): Json<ClaimPromotionInput>,
) -> Result<Json<Voucher>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    Ok(Json(
        service::claim_guest_promotion(
            &pool,
            guest_id,
            promotion_id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn list_guest_vouchers_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<PromotionListQuery>,
) -> Result<Json<VoucherListResponse>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    Ok(Json(service::list_guest_vouchers(&pool, guest_id, query).await?))
}

pub async fn list_admin_promotions_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<PromotionListQuery>,
) -> Result<Json<PromotionListResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "promotions:read").await?;
    Ok(Json(service::list_admin_promotions(&pool, query).await?))
}

pub async fn get_admin_promotion_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(promotion_id): Path<i64>,
) -> Result<Json<Promotion>, ApiError> {
    require_permission_helper(&pool, &headers, "promotions:read").await?;
    Ok(Json(service::get_admin_promotion(&pool, promotion_id).await?))
}

pub async fn create_admin_promotion_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<PromotionInput>,
) -> Result<Json<Promotion>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "promotions:manage").await?;
    Ok(Json(
        service::create_admin_promotion(
            &pool,
            actor_id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn update_admin_promotion_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(promotion_id): Path<i64>,
    Json(input): Json<PromotionInput>,
) -> Result<Json<Promotion>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "promotions:manage").await?;
    Ok(Json(
        service::update_admin_promotion(
            &pool,
            actor_id,
            promotion_id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn publish_admin_promotion_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(promotion_id): Path<i64>,
    Json(input): Json<PromotionActionInput>,
) -> Result<Json<Promotion>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "promotions:manage").await?;
    Ok(Json(
        service::publish_admin_promotion(
            &pool,
            actor_id,
            promotion_id,
            input.expected_version,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn pause_admin_promotion_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(promotion_id): Path<i64>,
    Json(input): Json<PromotionActionInput>,
) -> Result<Json<Promotion>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "promotions:manage").await?;
    Ok(Json(
        service::pause_admin_promotion(
            &pool,
            actor_id,
            promotion_id,
            input.expected_version,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn archive_admin_promotion_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(promotion_id): Path<i64>,
    Json(input): Json<PromotionActionInput>,
) -> Result<Json<Promotion>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "promotions:manage").await?;
    Ok(Json(
        service::archive_admin_promotion(
            &pool,
            actor_id,
            promotion_id,
            input.expected_version,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn list_admin_vouchers_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<PromotionListQuery>,
) -> Result<Json<VoucherListResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "vouchers:read").await?;
    Ok(Json(service::list_admin_vouchers(&pool, query).await?))
}

pub async fn issue_admin_voucher_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<VoucherIssueInput>,
) -> Result<Json<Voucher>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "vouchers:manage").await?;
    Ok(Json(
        service::issue_admin_voucher(
            &pool,
            actor_id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}

pub async fn revoke_admin_voucher_handler(
    State(pool): State<DbPool>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(voucher_id): Path<i64>,
    Json(input): Json<VoucherRevokeInput>,
) -> Result<Json<Voucher>, ApiError> {
    let actor_id = require_permission_helper(&pool, &headers, "vouchers:manage").await?;
    Ok(Json(
        service::revoke_admin_voucher(
            &pool,
            actor_id,
            voucher_id,
            input,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}
