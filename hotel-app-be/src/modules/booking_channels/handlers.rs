//! Booking channel handlers.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::NaiveDate;

use super::service::{self, PricingRuleResponse};
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    BookingChannel, BookingChannelInput, BookingChannelUpdate, ChannelCommissionRule,
    ChannelCommissionRuleInput, ChannelCommissionRuleUpdate, ChannelMappings, ChannelMatrix,
    ChannelMatrixQuery, ChannelPricePreview, ChannelPricePreviewRequest, ChannelPricingRuleInput,
    ChannelPricingRuleUpdate, ChannelRatePlanMapping, ChannelRatePlanMappingInput,
    ChannelRoomTypeMapping, ChannelRoomTypeMappingInput,
};

pub async fn list_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<BookingChannel>>, ApiError> {
    Ok(Json(service::list(&pool).await?))
}

pub async fn create_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(input): Json<BookingChannelInput>,
) -> Result<Json<BookingChannel>, ApiError> {
    Ok(Json(service::create(&pool, user_id, input).await?))
}

pub async fn update_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(id): Path<i64>,
    Json(input): Json<BookingChannelUpdate>,
) -> Result<Json<BookingChannel>, ApiError> {
    Ok(Json(service::update(&pool, id, user_id, input).await?))
}

pub async fn deactivate_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(id): Path<i64>,
) -> Result<Json<BookingChannel>, ApiError> {
    Ok(Json(service::deactivate(&pool, id, user_id).await?))
}

// ---------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------

pub async fn list_pricing_rules_handler(
    State(pool): State<DbPool>,
    Path(channel_id): Path<i64>,
) -> Result<Json<Vec<crate::models::ChannelPricingRule>>, ApiError> {
    Ok(Json(service::list_pricing_rules(&pool, channel_id).await?))
}

pub async fn create_pricing_rule_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(channel_id): Path<i64>,
    Json(input): Json<ChannelPricingRuleInput>,
) -> Result<Json<PricingRuleResponse>, ApiError> {
    Ok(Json(
        service::create_pricing_rule(&pool, channel_id, user_id, input).await?,
    ))
}

pub async fn update_pricing_rule_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(rule_id): Path<i64>,
    Json(input): Json<ChannelPricingRuleUpdate>,
) -> Result<Json<PricingRuleResponse>, ApiError> {
    Ok(Json(
        service::update_pricing_rule(&pool, rule_id, user_id, input).await?,
    ))
}

pub async fn delete_pricing_rule_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(rule_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    service::delete_pricing_rule(&pool, rule_id, user_id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

// ---------------------------------------------------------------------------
// Commission rules
// ---------------------------------------------------------------------------

pub async fn list_commission_rules_handler(
    State(pool): State<DbPool>,
    Path(channel_id): Path<i64>,
) -> Result<Json<Vec<ChannelCommissionRule>>, ApiError> {
    Ok(Json(
        service::list_commission_rules(&pool, channel_id).await?,
    ))
}

pub async fn create_commission_rule_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(channel_id): Path<i64>,
    Json(input): Json<ChannelCommissionRuleInput>,
) -> Result<Json<ChannelCommissionRule>, ApiError> {
    Ok(Json(
        service::create_commission_rule(&pool, channel_id, user_id, input).await?,
    ))
}

pub async fn update_commission_rule_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(rule_id): Path<i64>,
    Json(input): Json<ChannelCommissionRuleUpdate>,
) -> Result<Json<ChannelCommissionRule>, ApiError> {
    Ok(Json(
        service::update_commission_rule(&pool, rule_id, user_id, input).await?,
    ))
}

pub async fn delete_commission_rule_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(rule_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    service::delete_commission_rule(&pool, rule_id, user_id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------

pub async fn get_mappings_handler(
    State(pool): State<DbPool>,
    Path(channel_id): Path<i64>,
) -> Result<Json<ChannelMappings>, ApiError> {
    Ok(Json(service::get_mappings(&pool, channel_id).await?))
}

pub async fn upsert_room_type_mapping_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(channel_id): Path<i64>,
    Json(input): Json<ChannelRoomTypeMappingInput>,
) -> Result<Json<ChannelRoomTypeMapping>, ApiError> {
    Ok(Json(
        service::upsert_room_type_mapping(&pool, channel_id, user_id, input).await?,
    ))
}

pub async fn upsert_rate_plan_mapping_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(channel_id): Path<i64>,
    Json(input): Json<ChannelRatePlanMappingInput>,
) -> Result<Json<ChannelRatePlanMapping>, ApiError> {
    Ok(Json(
        service::upsert_rate_plan_mapping(&pool, channel_id, user_id, input).await?,
    ))
}

pub async fn delete_room_type_mapping_handler(
    State(pool): State<DbPool>,
    Path(mapping_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    service::delete_room_type_mapping(&pool, mapping_id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

pub async fn delete_rate_plan_mapping_handler(
    State(pool): State<DbPool>,
    Path(mapping_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    service::delete_rate_plan_mapping(&pool, mapping_id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

// ---------------------------------------------------------------------------
// Preview & matrix
// ---------------------------------------------------------------------------

pub async fn preview_handler(
    State(pool): State<DbPool>,
    Json(input): Json<ChannelPricePreviewRequest>,
) -> Result<Json<ChannelPricePreview>, ApiError> {
    Ok(Json(service::preview(&pool, input).await?))
}

pub async fn matrix_handler(
    State(pool): State<DbPool>,
    Query(query): Query<ChannelMatrixQuery>,
) -> Result<Json<ChannelMatrix>, ApiError> {
    let date = match &query.date {
        Some(raw) => NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d")
            .map_err(|_| ApiError::BadRequest("Invalid date. Use YYYY-MM-DD".to_string()))?,
        None => crate::core::db::hotel_today(&pool).await?,
    };
    Ok(Json(
        service::matrix(&pool, date, query.rate_plan_id).await?,
    ))
}
