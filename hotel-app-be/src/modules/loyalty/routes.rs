use super::handlers;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{require_any_permission_helper, require_auth};
use crate::modules::loyalty::models;
use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::Json as JsonResponse,
    routing::{get, post, put},
};

const LOYALTY_READ_PERMISSIONS: &[&str] = &["loyalty:read", "loyalty:manage", "analytics:read"];
const LOYALTY_MANAGE_PERMISSIONS: &[&str] = &["loyalty:manage"];

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/loyalty/me", get(me))
        .route("/loyalty/enroll", post(enroll))
        .route("/loyalty/me/activity", get(activity))
        .route("/loyalty/rewards", get(guest_rewards))
        .route("/loyalty/rewards/{id}/redeem", post(redeem_reward))
        .route("/admin/loyalty/members", get(admin_members))
        .route("/admin/loyalty/members/{id}", get(admin_member_detail))
        .route(
            "/admin/loyalty/members/{id}/adjustments",
            post(manual_adjustment),
        )
        .route("/admin/loyalty/rules", get(rules))
        .route("/admin/loyalty/rules", put(update_rules))
        .route("/admin/loyalty/rewards", get(admin_rewards))
        .route("/admin/loyalty/rewards", post(create_reward))
        .route("/admin/loyalty/rewards/{id}", put(update_reward))
        .route("/admin/loyalty/redemptions", get(redemptions))
        .route(
            "/admin/loyalty/redemptions/{id}/approve",
            put(approve_redemption),
        )
        .route(
            "/admin/loyalty/redemptions/{id}/reject",
            put(reject_redemption),
        )
}

async fn me(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<JsonResponse<models::LoyaltyMeResponse>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::me_handler(State(pool), Extension(user_id)).await
}

async fn enroll(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<JsonResponse<models::LoyaltyEnrollmentResponse>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::enroll_handler(State(pool), Extension(user_id)).await
}

async fn activity(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<JsonResponse<Vec<models::LoyaltyTransaction>>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::activity_handler(State(pool), Extension(user_id)).await
}

async fn guest_rewards(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::LoyaltyRewardQuery>,
) -> Result<JsonResponse<Vec<models::LoyaltyReward>>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::guest_rewards_handler(State(pool), Extension(user_id), query).await
}

async fn redeem_reward(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::RedeemRewardInput>,
) -> Result<JsonResponse<models::LoyaltyRedemption>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::redeem_reward_handler(State(pool), Extension(user_id), path, Json(input)).await
}

async fn admin_members(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::LoyaltyMemberQuery>,
) -> Result<JsonResponse<Vec<models::LoyaltyMemberSummary>>, ApiError> {
    require_any_permission_helper(&pool, &headers, LOYALTY_READ_PERMISSIONS).await?;
    handlers::admin_members_handler(State(pool), query).await
}

async fn admin_member_detail(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<JsonResponse<models::LoyaltyMemberDetail>, ApiError> {
    require_any_permission_helper(&pool, &headers, LOYALTY_READ_PERMISSIONS).await?;
    handlers::admin_member_detail_handler(State(pool), path).await
}

async fn manual_adjustment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::ManualAdjustmentInput>,
) -> Result<JsonResponse<models::LoyaltyTransaction>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, LOYALTY_MANAGE_PERMISSIONS).await?;
    handlers::manual_adjustment_handler(State(pool), Extension(actor_user_id), path, Json(input))
        .await
}

async fn rules(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<JsonResponse<models::LoyaltyProgramRules>, ApiError> {
    require_any_permission_helper(&pool, &headers, LOYALTY_READ_PERMISSIONS).await?;
    handlers::rules_handler(State(pool)).await
}

async fn update_rules(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::LoyaltyRulesInput>,
) -> Result<JsonResponse<models::LoyaltyProgramRules>, ApiError> {
    require_any_permission_helper(&pool, &headers, LOYALTY_MANAGE_PERMISSIONS).await?;
    handlers::update_rules_handler(State(pool), Json(input)).await
}

async fn admin_rewards(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::LoyaltyRewardQuery>,
) -> Result<JsonResponse<Vec<models::LoyaltyReward>>, ApiError> {
    require_any_permission_helper(&pool, &headers, LOYALTY_READ_PERMISSIONS).await?;
    handlers::admin_rewards_handler(State(pool), query).await
}

async fn create_reward(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::RewardInput>,
) -> Result<JsonResponse<models::LoyaltyReward>, ApiError> {
    require_any_permission_helper(&pool, &headers, LOYALTY_MANAGE_PERMISSIONS).await?;
    handlers::create_reward_handler(State(pool), Json(input)).await
}

async fn update_reward(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::RewardUpdateInput>,
) -> Result<JsonResponse<models::LoyaltyReward>, ApiError> {
    require_any_permission_helper(&pool, &headers, LOYALTY_MANAGE_PERMISSIONS).await?;
    handlers::update_reward_handler(State(pool), path, Json(input)).await
}

async fn redemptions(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::LoyaltyRedemptionQuery>,
) -> Result<JsonResponse<Vec<models::LoyaltyRedemption>>, ApiError> {
    require_any_permission_helper(&pool, &headers, LOYALTY_READ_PERMISSIONS).await?;
    handlers::redemptions_handler(State(pool), query).await
}

async fn approve_redemption(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<JsonResponse<models::LoyaltyRedemption>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, LOYALTY_MANAGE_PERMISSIONS).await?;
    handlers::approve_redemption_handler(State(pool), Extension(actor_user_id), path).await
}

async fn reject_redemption(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::RejectRedemptionInput>,
) -> Result<JsonResponse<models::LoyaltyRedemption>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, LOYALTY_MANAGE_PERMISSIONS).await?;
    handlers::reject_redemption_handler(State(pool), Extension(actor_user_id), path, Json(input))
        .await
}
