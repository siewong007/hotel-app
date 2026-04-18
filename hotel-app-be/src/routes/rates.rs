//! Rate plan routes
//!
//! Routes for rate plans and room rates management.

use axum::{
    routing::{get, post, patch, delete},
    Router,
    extract::{State, Path, Query},
    http::HeaderMap,
    response::{IntoResponse, Json},
};
use crate::core::db::DbPool;
use crate::core::middleware::require_permission_helper;
use crate::handlers;
use crate::models;

/// Create rate routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        // Rate plan routes
        .route("/rate-plans", get(get_rate_plans))
        .route("/rate-plans", post(create_rate_plan))
        .route("/rate-plans/{id}", get(get_rate_plan))
        .route("/rate-plans/{id}/with-rates", get(get_rate_plan_with_rates))
        .route("/rate-plans/{id}", patch(update_rate_plan))
        .route("/rate-plans/{id}", delete(delete_rate_plan))
        // Room rate routes
        .route("/room-rates", get(get_room_rates))
        .route("/room-rates", post(create_room_rate))
        .route("/room-rates/by-plan/{rate_plan_id}", get(get_room_rates_by_plan))
        .route("/room-rates/{id}", get(get_room_rate))
        .route("/room-rates/{id}", patch(update_room_rate))
        .route("/room-rates/{id}", delete(delete_room_rate))
        .route("/room-rates/applicable", get(get_applicable_rate))
        // Room types for rate management
        .route("/rate-management/room-types", get(get_room_types_for_rates))
}

// Rate plan handlers

async fn get_rate_plans(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;
    handlers::rates::get_rate_plans(State(pool)).await
}

async fn create_rate_plan(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::RatePlanInput>,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:write").await?;
    handlers::rates::create_rate_plan(State(pool), user_id, Json(input)).await
}

async fn get_rate_plan(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;
    handlers::rates::get_rate_plan(State(pool), path).await
}

async fn get_rate_plan_with_rates(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;
    handlers::rates::get_rate_plan_with_rates(State(pool), path).await
}

async fn update_rate_plan(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::RatePlanUpdateInput>,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;
    handlers::rates::update_rate_plan(State(pool), path, user_id, Json(input)).await
}

async fn delete_rate_plan(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:write").await?;
    handlers::rates::delete_rate_plan(State(pool), path, user_id).await
}

// Room rate handlers

async fn get_room_rates(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;
    handlers::rates::get_room_rates(State(pool)).await
}

async fn create_room_rate(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::RoomRateInput>,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:write").await?;
    handlers::rates::create_room_rate(State(pool), user_id, Json(input)).await
}

async fn get_room_rates_by_plan(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;
    handlers::rates::get_room_rates_by_plan(State(pool), path).await
}

async fn get_room_rate(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;
    handlers::rates::get_room_rate(State(pool), path).await
}

async fn update_room_rate(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::RoomRateUpdateInput>,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;
    handlers::rates::update_room_rate(State(pool), path, user_id, Json(input)).await
}

async fn delete_room_rate(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:write").await?;
    handlers::rates::delete_room_rate(State(pool), path, user_id).await
}

async fn get_applicable_rate(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<handlers::rates::ApplicableRateQuery>,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;
    handlers::rates::get_applicable_rate(State(pool), query).await
}

async fn get_room_types_for_rates(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, handlers::rates::RateError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;
    handlers::rates::get_room_types_for_rates(State(pool)).await
}
