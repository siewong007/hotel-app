use super::models::*;
use super::service;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::modules::loyalty::hub::{LoyaltyHub, serve_guest_socket, serve_socket};
use crate::services::guest_portal;
use axum::{
    Json,
    extract::{Extension, Path, Query, State, WebSocketUpgrade},
    http::{HeaderMap, header::HeaderValue},
    response::Response,
};

pub async fn me_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<LoyaltyMeResponse>, ApiError> {
    Ok(Json(service::me(&pool, user_id).await?))
}

pub async fn enroll_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<LoyaltyEnrollmentResponse>, ApiError> {
    Ok(Json(service::enroll(&pool, user_id).await?))
}

pub async fn activity_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<LoyaltyTransaction>>, ApiError> {
    Ok(Json(service::activity(&pool, user_id).await?))
}

pub async fn guest_rewards_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Query(query): Query<LoyaltyRewardQuery>,
) -> Result<Json<Vec<LoyaltyReward>>, ApiError> {
    Ok(Json(service::rewards(&pool, Some(user_id), query).await?))
}

pub async fn redeem_reward_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(reward_id): Path<i64>,
    Json(input): Json<RedeemRewardInput>,
) -> Result<Json<LoyaltyRedemption>, ApiError> {
    Ok(Json(
        service::redeem_reward(&pool, user_id, reward_id, input).await?,
    ))
}

pub async fn admin_members_handler(
    State(pool): State<DbPool>,
    Query(query): Query<LoyaltyMemberQuery>,
) -> Result<Json<Vec<LoyaltyMemberSummary>>, ApiError> {
    Ok(Json(service::admin_members(&pool, query).await?))
}

pub async fn admin_member_detail_handler(
    State(pool): State<DbPool>,
    Path(member_id): Path<i64>,
) -> Result<Json<LoyaltyMemberDetail>, ApiError> {
    Ok(Json(service::admin_member_detail(&pool, member_id).await?))
}

pub async fn manual_adjustment_handler(
    State(pool): State<DbPool>,
    Extension(actor_user_id): Extension<i64>,
    Path(member_id): Path<i64>,
    Json(input): Json<ManualAdjustmentInput>,
) -> Result<Json<LoyaltyTransaction>, ApiError> {
    Ok(Json(
        service::manual_adjustment(&pool, actor_user_id, member_id, input).await?,
    ))
}

pub async fn gift_points_handler(
    State(pool): State<DbPool>,
    Extension(hub): Extension<LoyaltyHub>,
    Extension(actor_user_id): Extension<i64>,
    Path(member_id): Path<i64>,
    Json(input): Json<GiftPointsInput>,
) -> Result<Json<LoyaltyTransaction>, ApiError> {
    let transaction = service::gift_points(&pool, actor_user_id, member_id, input).await?;
    let member = service::admin_member_detail(&pool, member_id).await?.member;
    hub.publish_member_updated(member_id, member.guest_id);
    Ok(Json(transaction))
}

pub async fn guest_loyalty_socket_handler(
    State(pool): State<DbPool>,
    Extension(hub): Extension<LoyaltyHub>,
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let token = headers
        .get(axum::http::header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .map(str::trim)
                .find(|part| *part != "hotel-guest-loyalty" && !part.is_empty())
        })
        .ok_or_else(|| ApiError::Unauthorized("Missing guest session token".to_string()))?;
    let guest_id = guest_portal::require_guest_session_token(token, &pool).await?;
    Ok(websocket
        .protocols(["hotel-guest-loyalty"])
        .on_upgrade(move |socket| serve_guest_socket(socket, hub, guest_id)))
}

pub async fn loyalty_socket_handler(
    State(pool): State<DbPool>,
    Extension(hub): Extension<LoyaltyHub>,
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let token = headers
        .get(axum::http::header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .map(str::trim)
                .find(|part| *part != "hotel-loyalty" && !part.is_empty())
        })
        .ok_or_else(|| ApiError::Unauthorized("Missing access token".to_string()))?;
    let mut auth_headers = HeaderMap::new();
    let value = HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| ApiError::Unauthorized("Invalid access token".to_string()))?;
    auth_headers.insert(axum::http::header::AUTHORIZATION, value);
    crate::core::middleware::require_any_permission_helper(
        &pool,
        &auth_headers,
        &["loyalty:read", "loyalty:manage", "analytics:read"],
    )
    .await?;
    Ok(websocket
        .protocols(["hotel-loyalty"])
        .on_upgrade(move |socket| serve_socket(socket, hub)))
}

pub async fn rules_handler(
    State(pool): State<DbPool>,
) -> Result<Json<LoyaltyProgramRules>, ApiError> {
    Ok(Json(service::get_rules(&pool).await?))
}

pub async fn update_rules_handler(
    State(pool): State<DbPool>,
    Json(input): Json<LoyaltyRulesInput>,
) -> Result<Json<LoyaltyProgramRules>, ApiError> {
    Ok(Json(service::update_rules(&pool, input).await?))
}

pub async fn admin_rewards_handler(
    State(pool): State<DbPool>,
    Query(query): Query<LoyaltyRewardQuery>,
) -> Result<Json<Vec<LoyaltyReward>>, ApiError> {
    Ok(Json(service::rewards(&pool, None, query).await?))
}

pub async fn create_reward_handler(
    State(pool): State<DbPool>,
    Json(input): Json<RewardInput>,
) -> Result<Json<LoyaltyReward>, ApiError> {
    Ok(Json(service::create_reward(&pool, input).await?))
}

pub async fn update_reward_handler(
    State(pool): State<DbPool>,
    Path(reward_id): Path<i64>,
    Json(input): Json<RewardUpdateInput>,
) -> Result<Json<LoyaltyReward>, ApiError> {
    Ok(Json(service::update_reward(&pool, reward_id, input).await?))
}

pub async fn redemptions_handler(
    State(pool): State<DbPool>,
    Query(query): Query<LoyaltyRedemptionQuery>,
) -> Result<Json<Vec<LoyaltyRedemption>>, ApiError> {
    Ok(Json(service::redemptions(&pool, query).await?))
}

pub async fn approve_redemption_handler(
    State(pool): State<DbPool>,
    Extension(actor_user_id): Extension<i64>,
    Path(redemption_id): Path<i64>,
) -> Result<Json<LoyaltyRedemption>, ApiError> {
    Ok(Json(
        service::approve_redemption(&pool, actor_user_id, redemption_id).await?,
    ))
}

pub async fn reject_redemption_handler(
    State(pool): State<DbPool>,
    Extension(actor_user_id): Extension<i64>,
    Path(redemption_id): Path<i64>,
    Json(input): Json<RejectRedemptionInput>,
) -> Result<Json<LoyaltyRedemption>, ApiError> {
    Ok(Json(
        service::reject_redemption(&pool, actor_user_id, redemption_id, input).await?,
    ))
}
