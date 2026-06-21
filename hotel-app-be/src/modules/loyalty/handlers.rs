use super::models::*;
use super::service;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use axum::{
    Json,
    extract::{Extension, Path, Query, State},
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
