//! Booking channel routes.

use axum::{
    Router,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Json,
    routing::{get, put},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{check_any_permission, require_permission_helper};
use super::handlers;
use crate::models::{
    BookingChannel, BookingChannelInput, BookingChannelUpdate, ChannelCommissionRule,
    ChannelCommissionRuleInput, ChannelCommissionRuleUpdate, ChannelMappings, ChannelMatrix,
    ChannelMatrixQuery, ChannelPricePreview, ChannelPricePreviewRequest, ChannelPricingRule,
    ChannelPricingRuleInput, ChannelPricingRuleUpdate, ChannelRatePlanMapping,
    ChannelRatePlanMappingInput, ChannelRoomTypeMapping, ChannelRoomTypeMappingInput,
};
use super::service::PricingRuleResponse;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/booking-channels", get(list_channels).post(create_channel))
        .route(
            "/booking-channels/{id}",
            put(update_channel).delete(deactivate_channel),
        )
        .route(
            "/booking-channels/{id}/pricing-rules",
            get(list_pricing_rules).post(create_pricing_rule),
        )
        .route(
            "/booking-channels/{id}/commission-rules",
            get(list_commission_rules).post(create_commission_rule),
        )
        .route(
            "/booking-channels/{id}/mappings",
            get(get_channel_mappings),
        )
        .route(
            "/booking-channels/{id}/mappings/room-types",
            put(upsert_room_type_mapping),
        )
        .route(
            "/booking-channels/{id}/mappings/rate-plans",
            put(upsert_rate_plan_mapping),
        )
        .route(
            "/channel-pricing-rules/{id}",
            axum::routing::patch(update_pricing_rule).delete(delete_pricing_rule),
        )
        .route(
            "/channel-commission-rules/{id}",
            axum::routing::patch(update_commission_rule).delete(delete_commission_rule),
        )
        .route(
            "/channel-room-type-mappings/{id}",
            axum::routing::delete(delete_room_type_mapping),
        )
        .route(
            "/channel-rate-plan-mappings/{id}",
            axum::routing::delete(delete_rate_plan_mapping),
        )
        .route("/channel-pricing/preview", axum::routing::post(preview))
        .route("/channel-pricing/matrix", get(matrix))
}

/// The channel registry powers both booking attribution (receptionists pick a
/// source channel on every booking) and revenue tooling — either surface may
/// list it.
async fn can_list_channels(pool: &DbPool, headers: &HeaderMap) -> Result<i64, ApiError> {
    let user_id = crate::core::middleware::require_auth(headers).await?;
    check_any_permission(
        pool,
        user_id,
        &[
            "channels:read",
            "analytics:read",
            "reports:execute",
            "bookings:read",
        ],
    )
    .await?;
    Ok(user_id)
}

async fn list_channels(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<BookingChannel>>, ApiError> {
    can_list_channels(&pool, &headers).await?;
    handlers::list_handler(State(pool)).await
}

async fn create_channel(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<BookingChannelInput>,
) -> Result<Json<BookingChannel>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "channels:write").await?;
    handlers::create_handler(State(pool), user_id, Json(input)).await
}

async fn update_channel(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<BookingChannelUpdate>,
) -> Result<Json<BookingChannel>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "channels:write").await?;
    handlers::update_handler(State(pool), user_id, path, Json(input)).await
}

async fn deactivate_channel(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<BookingChannel>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "channels:manage").await?;
    handlers::deactivate_handler(State(pool), user_id, path).await
}

// ---------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------

async fn list_pricing_rules(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Vec<ChannelPricingRule>>, ApiError> {
    require_permission_helper(&pool, &headers, "channels:read").await?;
    handlers::list_pricing_rules_handler(State(pool), path).await
}

async fn create_pricing_rule(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<ChannelPricingRuleInput>,
) -> Result<Json<PricingRuleResponse>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "channels:write").await?;
    handlers::create_pricing_rule_handler(State(pool), user_id, path, Json(input)).await
}

async fn update_pricing_rule(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<ChannelPricingRuleUpdate>,
) -> Result<Json<PricingRuleResponse>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "channels:write").await?;
    handlers::update_pricing_rule_handler(State(pool), user_id, path, Json(input)).await
}

async fn delete_pricing_rule(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "channels:manage").await?;
    handlers::delete_pricing_rule_handler(State(pool), user_id, path).await
}

// ---------------------------------------------------------------------------
// Commission rules
// ---------------------------------------------------------------------------

async fn list_commission_rules(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Vec<ChannelCommissionRule>>, ApiError> {
    require_permission_helper(&pool, &headers, "channels:read").await?;
    handlers::list_commission_rules_handler(State(pool), path).await
}

async fn create_commission_rule(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<ChannelCommissionRuleInput>,
) -> Result<Json<ChannelCommissionRule>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "channels:write").await?;
    handlers::create_commission_rule_handler(State(pool), user_id, path, Json(input)).await
}

async fn update_commission_rule(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<ChannelCommissionRuleUpdate>,
) -> Result<Json<ChannelCommissionRule>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "channels:write").await?;
    handlers::update_commission_rule_handler(State(pool), user_id, path, Json(input)).await
}

async fn delete_commission_rule(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "channels:manage").await?;
    handlers::delete_commission_rule_handler(State(pool), user_id, path).await
}

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------

async fn get_channel_mappings(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<ChannelMappings>, ApiError> {
    require_permission_helper(&pool, &headers, "channels:read").await?;
    handlers::get_mappings_handler(State(pool), path).await
}

async fn upsert_room_type_mapping(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<ChannelRoomTypeMappingInput>,
) -> Result<Json<ChannelRoomTypeMapping>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "channels:write").await?;
    handlers::upsert_room_type_mapping_handler(State(pool), user_id, path, Json(input)).await
}

async fn upsert_rate_plan_mapping(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<ChannelRatePlanMappingInput>,
) -> Result<Json<ChannelRatePlanMapping>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "channels:write").await?;
    handlers::upsert_rate_plan_mapping_handler(State(pool), user_id, path, Json(input)).await
}

async fn delete_room_type_mapping(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "channels:write").await?;
    handlers::delete_room_type_mapping_handler(State(pool), path).await
}

async fn delete_rate_plan_mapping(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "channels:write").await?;
    handlers::delete_rate_plan_mapping_handler(State(pool), path).await
}

// ---------------------------------------------------------------------------
// Preview & matrix
// ---------------------------------------------------------------------------

async fn preview(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<ChannelPricePreviewRequest>,
) -> Result<Json<ChannelPricePreview>, ApiError> {
    require_permission_helper(&pool, &headers, "channels:read").await?;
    handlers::preview_handler(State(pool), Json(input)).await
}

async fn matrix(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<ChannelMatrixQuery>,
) -> Result<Json<ChannelMatrix>, ApiError> {
    require_permission_helper(&pool, &headers, "channels:read").await?;
    handlers::matrix_handler(State(pool), Query(query)).await
}
