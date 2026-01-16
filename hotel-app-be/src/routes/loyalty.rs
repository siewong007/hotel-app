//! Loyalty program routes
//!
//! Routes for loyalty points, tiers, rewards, and statistics.

use axum::{
    routing::{get, post, put, delete},
    Router,
    extract::{State, Path, Query, Extension},
    http::HeaderMap,
    response::Json,
};
use crate::core::db::DbPool;
use std::collections::HashMap;
use crate::handlers;
use crate::models;
use crate::core::middleware::{require_permission_helper, require_auth, require_admin_helper};
use crate::core::error::ApiError;

/// Create loyalty routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        // Admin loyalty management routes
        .route("/loyalty/programs", get(get_programs))
        .route("/loyalty/memberships", get(get_memberships))
        .route("/loyalty/statistics", get(get_statistics))
        .route("/loyalty/memberships/:id/points/add", post(add_points))
        .route("/loyalty/memberships/:id/points/redeem", post(redeem_points))
        // User loyalty routes
        .route("/loyalty/my-membership", get(get_my_membership))
        .route("/loyalty/rewards", get(get_rewards))
        .route("/loyalty/rewards/redeem", post(redeem_reward))
        // Admin reward CRUD routes
        .route("/api/rewards", get(get_all_rewards))
        .route("/api/rewards/:id", get(get_single_reward))
        .route("/api/rewards", post(create_reward))
        .route("/api/rewards/:id", put(update_reward))
        .route("/api/rewards/:id", delete(delete_reward))
        .route("/api/rewards/redemptions", get(get_redemptions))
        .route("/api/rewards/:id/redeem", post(redeem_reward_by_id))
}

// Admin handlers

async fn get_programs(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::LoyaltyProgram>>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;
    handlers::loyalty::get_loyalty_programs_handler(State(pool)).await
}

async fn get_memberships(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::LoyaltyMembershipWithDetails>>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;
    handlers::loyalty::get_loyalty_memberships_handler(State(pool)).await
}

async fn get_statistics(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::LoyaltyStatistics>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;
    handlers::loyalty::get_loyalty_statistics_handler(State(pool)).await
}

async fn add_points(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::AddPointsInput>,
) -> Result<Json<models::PointsTransaction>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:write").await?;
    handlers::loyalty::add_points_handler(State(pool), path, Json(input)).await
}

async fn redeem_points(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::AddPointsInput>,
) -> Result<Json<models::PointsTransaction>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:write").await?;
    handlers::loyalty::redeem_points_handler(State(pool), path, Json(input)).await
}

// User loyalty handlers

async fn get_my_membership(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::UserLoyaltyMembership>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::loyalty::get_user_loyalty_membership_handler(State(pool), Extension(user_id)).await
}

async fn get_rewards(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::LoyaltyReward>>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::loyalty::get_loyalty_rewards_handler(State(pool), Extension(user_id)).await
}

async fn redeem_reward(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::RedeemRewardInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::loyalty::redeem_reward_handler(State(pool), Extension(user_id), Json(input)).await
}

// Admin reward CRUD handlers

async fn get_all_rewards(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<HashMap<String, String>>,
) -> Result<Json<Vec<models::LoyaltyReward>>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::loyalty::get_rewards_handler(State(pool), query).await
}

async fn get_single_reward(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::LoyaltyReward>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::loyalty::get_reward_handler(State(pool), path).await
}

async fn create_reward(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::RewardInput>,
) -> Result<Json<models::LoyaltyReward>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::loyalty::create_reward_handler(State(pool), Json(input)).await
}

async fn update_reward(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::RewardUpdateInput>,
) -> Result<Json<models::LoyaltyReward>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::loyalty::update_reward_handler(State(pool), path, Json(input)).await
}

async fn delete_reward(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::loyalty::delete_reward_handler(State(pool), path).await
}

async fn get_redemptions(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::RewardRedemptionWithDetails>>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::loyalty::get_reward_redemptions_handler(State(pool)).await
}

async fn redeem_reward_by_id(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::RedeemRewardInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::loyalty::redeem_reward_for_user_handler(State(pool), Extension(user_id), path, Json(input)).await
}
