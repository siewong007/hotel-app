//! Loyalty program handlers.
//!
//! Handlers translate HTTP inputs and outputs for loyalty programs,
//! memberships, points, and rewards.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::loyalty as svc;
use axum::{
    extract::{Extension, Path, Query, State},
    response::Json,
};
use std::collections::HashMap;

pub async fn get_loyalty_programs_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<LoyaltyProgram>>, ApiError> {
    Ok(Json(svc::list_programs(&pool).await?))
}

pub async fn get_loyalty_memberships_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<LoyaltyMembershipWithDetails>>, ApiError> {
    Ok(Json(svc::list_memberships(&pool).await?))
}

pub async fn get_loyalty_statistics_handler(
    State(pool): State<DbPool>,
) -> Result<Json<LoyaltyStatistics>, ApiError> {
    Ok(Json(svc::statistics(&pool).await?))
}

pub async fn add_points_handler(
    State(pool): State<DbPool>,
    Path(membership_id): Path<i64>,
    Json(input): Json<AddPointsInput>,
) -> Result<Json<PointsTransaction>, ApiError> {
    Ok(Json(svc::add_points(&pool, membership_id, input).await?))
}

pub async fn redeem_points_handler(
    State(pool): State<DbPool>,
    Path(membership_id): Path<i64>,
    Json(input): Json<AddPointsInput>,
) -> Result<Json<PointsTransaction>, ApiError> {
    Ok(Json(svc::redeem_points(&pool, membership_id, input).await?))
}

pub async fn get_user_loyalty_membership_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<UserLoyaltyMembership>, ApiError> {
    Ok(Json(svc::user_membership(&pool, user_id).await?))
}

pub async fn get_loyalty_rewards_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<LoyaltyReward>>, ApiError> {
    Ok(Json(svc::rewards_for_user(&pool, user_id).await?))
}

pub async fn redeem_reward_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<RedeemRewardInput>,
) -> Result<Json<RewardRedemptionResponse>, ApiError> {
    Ok(Json(svc::redeem_reward(&pool, user_id, input).await?))
}

pub async fn get_rewards_handler(
    State(pool): State<DbPool>,
    query: Query<HashMap<String, String>>,
) -> Result<Json<Vec<LoyaltyReward>>, ApiError> {
    Ok(Json(
        svc::list_rewards(&pool, query.get("category").map(String::as_str)).await?,
    ))
}

pub async fn get_reward_handler(
    State(pool): State<DbPool>,
    Path(reward_id): Path<i64>,
) -> Result<Json<LoyaltyReward>, ApiError> {
    Ok(Json(svc::get_reward(&pool, reward_id).await?))
}

pub async fn create_reward_handler(
    State(pool): State<DbPool>,
    Json(input): Json<RewardInput>,
) -> Result<Json<LoyaltyReward>, ApiError> {
    Ok(Json(svc::create_reward(&pool, input).await?))
}

pub async fn update_reward_handler(
    State(pool): State<DbPool>,
    Path(reward_id): Path<i64>,
    Json(input): Json<RewardUpdateInput>,
) -> Result<Json<LoyaltyReward>, ApiError> {
    Ok(Json(svc::update_reward(&pool, reward_id, input).await?))
}

pub async fn delete_reward_handler(
    State(pool): State<DbPool>,
    Path(reward_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::delete_reward(&pool, reward_id).await?;

    Ok(Json(serde_json::json!({
        "message": "Reward deactivated successfully"
    })))
}

pub async fn get_reward_redemptions_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<RewardRedemptionWithDetails>>, ApiError> {
    Ok(Json(svc::reward_redemptions(&pool).await?))
}

pub async fn redeem_reward_for_user_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(reward_id): Path<i64>,
    Json(input): Json<RedeemRewardInput>,
) -> Result<Json<RewardRedemptionResponse>, ApiError> {
    Ok(Json(
        svc::redeem_reward_by_id(&pool, user_id, reward_id, input).await?,
    ))
}
