//! Booking channel business logic: channel CRUD, pricing-rule and
//! commission-rule management, integration mappings, and the shared
//! preview/matrix resolution consumed by staff tooling and booking writes.

use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use serde_json::json;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::AuditEvent;
use crate::models::{
    BookingChannel, BookingChannelInput, BookingChannelUpdate, ChannelCommissionRule,
    ChannelCommissionRuleInput, ChannelCommissionRuleUpdate, ChannelCommissionRuleValues,
    ChannelMappings, ChannelMatrix, ChannelMatrixCell, ChannelPricePreview,
    ChannelPricePreviewRequest, ChannelPricingRule, ChannelPricingRuleInput,
    ChannelPricingRuleUpdate, ChannelPricingRuleValues, ChannelRatePlanMapping,
    ChannelRatePlanMappingInput, ChannelRoomTypeMapping, ChannelRoomTypeMappingInput,
    NightlyChannelPrice,
};
use crate::modules::rates::repository::RateRepository;
use crate::services::audit::AuditLog;

use super::pricing::{self, CommissionConfig, PricedNight};
use super::repository;

// ---------------------------------------------------------------------------
// Channel CRUD
// ---------------------------------------------------------------------------

pub async fn list(pool: &DbPool) -> Result<Vec<BookingChannel>, ApiError> {
    repository::list(pool).await
}

pub async fn create(
    pool: &DbPool,
    user_id: i64,
    input: BookingChannelInput,
) -> Result<BookingChannel, ApiError> {
    let channel = repository::create(pool, user_id, input).await?;
    log_channel_event(pool, user_id, "booking_channel_created", channel.id, &channel.name)
        .await;
    Ok(channel)
}

pub async fn update(
    pool: &DbPool,
    id: i64,
    user_id: i64,
    input: BookingChannelUpdate,
) -> Result<BookingChannel, ApiError> {
    let channel = repository::update(pool, id, user_id, input).await?;
    log_channel_event(pool, user_id, "booking_channel_updated", channel.id, &channel.name)
        .await;
    Ok(channel)
}

pub async fn deactivate(
    pool: &DbPool,
    id: i64,
    user_id: i64,
) -> Result<BookingChannel, ApiError> {
    let channel = repository::deactivate(pool, id, user_id).await?;
    log_channel_event(pool, user_id, "booking_channel_deactivated", channel.id, &channel.name)
        .await;
    Ok(channel)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn parse_date(value: &str, field: &str) -> Result<NaiveDate, ApiError> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest(format!("Invalid {field}. Use YYYY-MM-DD")))
}

fn parse_opt_date(value: Option<&String>, field: &str) -> Result<Option<NaiveDate>, ApiError> {
    value
        .and_then(|raw| {
            let trimmed = raw.trim();
            (!trimmed.is_empty()).then(|| parse_date(trimmed, field))
        })
        .transpose()
}

fn validate_window(from: NaiveDate, to: Option<NaiveDate>) -> Result<(), ApiError> {
    if let Some(to) = to
        && to < from
    {
        return Err(ApiError::BadRequest(
            "effective_to must not be before effective_from".to_string(),
        ));
    }
    Ok(())
}

fn pricing_rule_values(input: &ChannelPricingRuleInput) -> Result<ChannelPricingRuleValues, ApiError> {
    let rule_type = input.rule_type.trim().to_ascii_lowercase().replace('-', "_");
    if !pricing::RULE_TYPES.contains(&rule_type.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid rule_type '{rule_type}'"
        )));
    }
    let value = Decimal::from_f64_retain(input.value)
        .ok_or_else(|| ApiError::BadRequest("Invalid value".to_string()))?;
    if value < Decimal::ZERO {
        return Err(ApiError::BadRequest("value must be non-negative".to_string()));
    }
    if rule_type == "discount_percent" && value > Decimal::new(100, 0) {
        return Err(ApiError::BadRequest(
            "discount_percent value must be between 0 and 100".to_string(),
        ));
    }
    if matches!(rule_type.as_str(), "fixed_price" | "net_rate") && value <= Decimal::ZERO {
        return Err(ApiError::BadRequest(format!(
            "{rule_type} requires a positive nightly price"
        )));
    }
    let effective_from = parse_date(&input.effective_from, "effective_from")?;
    let effective_to = parse_opt_date(input.effective_to.as_ref(), "effective_to")?;
    validate_window(effective_from, effective_to)?;
    let min_price = input
        .min_price
        .and_then(Decimal::from_f64_retain)
        .filter(|v| *v >= Decimal::ZERO);
    let max_price = input
        .max_price
        .and_then(Decimal::from_f64_retain)
        .filter(|v| *v >= Decimal::ZERO);
    if let (Some(min), Some(max)) = (min_price, max_price)
        && min > max
    {
        return Err(ApiError::BadRequest(
            "min_price must not exceed max_price".to_string(),
        ));
    }
    Ok(ChannelPricingRuleValues {
        room_type_id: input.room_type_id,
        rate_plan_id: input.rate_plan_id,
        rule_type,
        value,
        effective_from,
        effective_to,
        min_price,
        max_price,
        priority: input.priority.unwrap_or(0),
        is_active: input.is_active.unwrap_or(true),
        reason: input
            .reason
            .as_deref()
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .map(str::to_string),
    })
}

fn pricing_rule_update_values(
    current: &ChannelPricingRule,
    input: &ChannelPricingRuleUpdate,
) -> Result<ChannelPricingRuleValues, ApiError> {
    let rule_type = input
        .rule_type
        .as_deref()
        .map(|t| t.trim().to_ascii_lowercase().replace('-', "_"))
        .unwrap_or_else(|| current.rule_type.clone());
    if !pricing::RULE_TYPES.contains(&rule_type.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid rule_type '{rule_type}'"
        )));
    }
    let value = input
        .value
        .and_then(Decimal::from_f64_retain)
        .unwrap_or(current.value);
    if value < Decimal::ZERO {
        return Err(ApiError::BadRequest("value must be non-negative".to_string()));
    }
    if rule_type == "discount_percent" && value > Decimal::new(100, 0) {
        return Err(ApiError::BadRequest(
            "discount_percent value must be between 0 and 100".to_string(),
        ));
    }
    let effective_from = input
        .effective_from
        .as_deref()
        .map(|d| parse_date(d, "effective_from"))
        .transpose()?
        .unwrap_or(current.effective_from);
    let effective_to = match &input.effective_to {
        Some(value) => parse_opt_date(value.as_ref(), "effective_to")?,
        None => current.effective_to,
    };
    validate_window(effective_from, effective_to)?;
    let min_price = match input.min_price {
        Some(value) => value.and_then(Decimal::from_f64_retain),
        None => current.min_price,
    };
    let max_price = match input.max_price {
        Some(value) => value.and_then(Decimal::from_f64_retain),
        None => current.max_price,
    };
    if let (Some(min), Some(max)) = (min_price, max_price)
        && min > max
    {
        return Err(ApiError::BadRequest(
            "min_price must not exceed max_price".to_string(),
        ));
    }
    Ok(ChannelPricingRuleValues {
        room_type_id: input.room_type_id.unwrap_or(current.room_type_id),
        rate_plan_id: input.rate_plan_id.unwrap_or(current.rate_plan_id),
        rule_type,
        value,
        effective_from,
        effective_to,
        min_price,
        max_price,
        priority: input.priority.unwrap_or(current.priority),
        is_active: input.is_active.unwrap_or(current.is_active),
        reason: input
            .reason
            .as_deref()
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .map(str::to_string)
            .or_else(|| current.reason.clone()),
    })
}

fn commission_rule_values(
    input: &ChannelCommissionRuleInput,
) -> Result<ChannelCommissionRuleValues, ApiError> {
    let commission_type = input
        .commission_type
        .trim()
        .to_ascii_lowercase()
        .replace('-', "_");
    if !matches!(commission_type.as_str(), "percentage" | "fixed_amount") {
        return Err(ApiError::BadRequest(format!(
            "Invalid commission_type '{commission_type}'"
        )));
    }
    let value = Decimal::from_f64_retain(input.value)
        .ok_or_else(|| ApiError::BadRequest("Invalid value".to_string()))?;
    if value < Decimal::ZERO {
        return Err(ApiError::BadRequest("value must be non-negative".to_string()));
    }
    if commission_type == "percentage" && value > Decimal::new(100, 0) {
        return Err(ApiError::BadRequest(
            "percentage commission must be between 0 and 100".to_string(),
        ));
    }
    let scope = input
        .scope
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase().replace('-', "_"))
        .unwrap_or_else(|| "per_booking".to_string());
    if !matches!(scope.as_str(), "per_booking" | "per_night") {
        return Err(ApiError::BadRequest(format!("Invalid scope '{scope}'")));
    }
    let effective_from = parse_date(&input.effective_from, "effective_from")?;
    let effective_to = parse_opt_date(input.effective_to.as_ref(), "effective_to")?;
    validate_window(effective_from, effective_to)?;
    Ok(ChannelCommissionRuleValues {
        commission_type,
        value,
        scope,
        effective_from,
        effective_to,
        priority: input.priority.unwrap_or(0),
        is_active: input.is_active.unwrap_or(true),
        reason: input
            .reason
            .as_deref()
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .map(str::to_string),
    })
}

fn commission_rule_update_values(
    current: &ChannelCommissionRule,
    input: &ChannelCommissionRuleUpdate,
) -> Result<ChannelCommissionRuleValues, ApiError> {
    let commission_type = input
        .commission_type
        .as_deref()
        .map(|t| t.trim().to_ascii_lowercase().replace('-', "_"))
        .unwrap_or_else(|| current.commission_type.clone());
    if !matches!(commission_type.as_str(), "percentage" | "fixed_amount") {
        return Err(ApiError::BadRequest(format!(
            "Invalid commission_type '{commission_type}'"
        )));
    }
    let value = input
        .value
        .and_then(Decimal::from_f64_retain)
        .unwrap_or(current.value);
    if value < Decimal::ZERO {
        return Err(ApiError::BadRequest("value must be non-negative".to_string()));
    }
    if commission_type == "percentage" && value > Decimal::new(100, 0) {
        return Err(ApiError::BadRequest(
            "percentage commission must be between 0 and 100".to_string(),
        ));
    }
    let scope = input
        .scope
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase().replace('-', "_"))
        .unwrap_or_else(|| current.scope.clone());
    if !matches!(scope.as_str(), "per_booking" | "per_night") {
        return Err(ApiError::BadRequest(format!("Invalid scope '{scope}'")));
    }
    let effective_from = input
        .effective_from
        .as_deref()
        .map(|d| parse_date(d, "effective_from"))
        .transpose()?
        .unwrap_or(current.effective_from);
    let effective_to = match &input.effective_to {
        Some(value) => parse_opt_date(value.as_ref(), "effective_to")?,
        None => current.effective_to,
    };
    validate_window(effective_from, effective_to)?;
    Ok(ChannelCommissionRuleValues {
        commission_type,
        value,
        scope,
        effective_from,
        effective_to,
        priority: input.priority.unwrap_or(current.priority),
        is_active: input.is_active.unwrap_or(current.is_active),
        reason: input
            .reason
            .as_deref()
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .map(str::to_string)
            .or_else(|| current.reason.clone()),
    })
}

// ---------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------

/// Rule payload plus non-blocking overlap warnings — same-scope overlapping
/// windows are legal because priority resolves them, but the operator should
/// know they exist.
#[derive(Debug, serde::Serialize)]
pub struct PricingRuleResponse {
    pub rule: ChannelPricingRule,
    pub warnings: Vec<String>,
}

async fn overlap_warnings(
    pool: &DbPool,
    channel_id: i64,
    values: &ChannelPricingRuleValues,
    exclude_id: Option<i64>,
) -> Result<Vec<String>, ApiError> {
    if !values.is_active {
        return Ok(Vec::new());
    }
    let conflicts = repository::overlapping_pricing_rules(
        pool,
        channel_id,
        values.room_type_id,
        values.rate_plan_id,
        values.effective_from,
        values.effective_to,
        exclude_id,
    )
    .await?;
    Ok(conflicts
        .iter()
        .map(|rule| {
            format!(
                "Overlaps with {} rule #{} ({} → {}, priority {})",
                rule.rule_type,
                rule.id,
                rule.effective_from,
                rule.effective_to
                    .map(|d| d.to_string())
                    .unwrap_or_else(|| "open".to_string()),
                rule.priority
            )
        })
        .collect())
}

pub async fn list_pricing_rules(
    pool: &DbPool,
    channel_id: i64,
) -> Result<Vec<ChannelPricingRule>, ApiError> {
    repository::find_by_id(pool, channel_id).await?;
    repository::list_pricing_rules(pool, channel_id).await
}

pub async fn create_pricing_rule(
    pool: &DbPool,
    channel_id: i64,
    user_id: i64,
    input: ChannelPricingRuleInput,
) -> Result<PricingRuleResponse, ApiError> {
    repository::find_by_id(pool, channel_id).await?;
    let values = pricing_rule_values(&input)?;
    let warnings = overlap_warnings(pool, channel_id, &values, None).await?;
    let rule = repository::insert_pricing_rule(pool, channel_id, user_id, &values).await?;
    log_rule_event(pool, user_id, "channel_pricing_rule_created", &rule).await;
    Ok(PricingRuleResponse { rule, warnings })
}

pub async fn update_pricing_rule(
    pool: &DbPool,
    rule_id: i64,
    user_id: i64,
    input: ChannelPricingRuleUpdate,
) -> Result<PricingRuleResponse, ApiError> {
    let current = repository::find_pricing_rule(pool, rule_id).await?;
    let values = pricing_rule_update_values(&current, &input)?;
    let warnings =
        overlap_warnings(pool, current.channel_id, &values, Some(rule_id)).await?;
    let rule = repository::update_pricing_rule(pool, rule_id, user_id, &values).await?;
    log_rule_event(pool, user_id, "channel_pricing_rule_updated", &rule).await;
    Ok(PricingRuleResponse { rule, warnings })
}

pub async fn delete_pricing_rule(
    pool: &DbPool,
    rule_id: i64,
    user_id: i64,
) -> Result<(), ApiError> {
    let rule = repository::find_pricing_rule(pool, rule_id).await?;
    repository::delete_pricing_rule(pool, rule_id).await?;
    log_rule_event(pool, user_id, "channel_pricing_rule_deleted", &rule).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commission rules
// ---------------------------------------------------------------------------

pub async fn list_commission_rules(
    pool: &DbPool,
    channel_id: i64,
) -> Result<Vec<ChannelCommissionRule>, ApiError> {
    repository::find_by_id(pool, channel_id).await?;
    repository::list_commission_rules(pool, channel_id).await
}

pub async fn create_commission_rule(
    pool: &DbPool,
    channel_id: i64,
    user_id: i64,
    input: ChannelCommissionRuleInput,
) -> Result<ChannelCommissionRule, ApiError> {
    repository::find_by_id(pool, channel_id).await?;
    let values = commission_rule_values(&input)?;
    let rule = repository::insert_commission_rule(pool, channel_id, user_id, &values).await?;
    log_commission_event(pool, user_id, "channel_commission_rule_created", &rule).await;
    Ok(rule)
}

pub async fn update_commission_rule(
    pool: &DbPool,
    rule_id: i64,
    user_id: i64,
    input: ChannelCommissionRuleUpdate,
) -> Result<ChannelCommissionRule, ApiError> {
    // Locate the current row via the channel list — rules are few.
    let current = find_commission_rule(pool, rule_id).await?;
    let values = commission_rule_update_values(&current, &input)?;
    let rule = repository::update_commission_rule(pool, rule_id, user_id, &values).await?;
    log_commission_event(pool, user_id, "channel_commission_rule_updated", &rule).await;
    Ok(rule)
}

pub async fn delete_commission_rule(
    pool: &DbPool,
    rule_id: i64,
    user_id: i64,
) -> Result<(), ApiError> {
    let rule = find_commission_rule(pool, rule_id).await?;
    repository::delete_commission_rule(pool, rule_id).await?;
    log_commission_event(pool, user_id, "channel_commission_rule_deleted", &rule).await;
    Ok(())
}

async fn find_commission_rule(
    pool: &DbPool,
    rule_id: i64,
) -> Result<ChannelCommissionRule, ApiError> {
    // Rules are fetched through their channel; resolve by scanning active rows
    // is wrong for an edit of an inactive rule, so query directly.
    let row = sqlx::query(
        "SELECT id, channel_id, commission_type, value, scope, effective_from,
                effective_to, priority, is_active, reason, created_by, updated_by,
                created_at, updated_at
         FROM channel_commission_rules WHERE id = $1",
    )
    .bind(rule_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Channel commission rule not found".to_string()))?;
    use sqlx::Row;
    Ok(ChannelCommissionRule {
        id: row.try_get("id").unwrap_or_default(),
        channel_id: row.try_get("channel_id").unwrap_or_default(),
        commission_type: row.try_get("commission_type").unwrap_or_default(),
        value: crate::models::row_mappers::get_decimal(&row, "value"),
        scope: row
            .try_get("scope")
            .unwrap_or_else(|_| "per_booking".to_string()),
        effective_from: row
            .try_get("effective_from")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
        effective_to: row.try_get("effective_to").ok().flatten(),
        priority: row.try_get("priority").unwrap_or_default(),
        is_active: row.try_get("is_active").unwrap_or(true),
        reason: row.try_get("reason").ok().flatten(),
        created_by: row.try_get("created_by").ok().flatten(),
        updated_by: row.try_get("updated_by").ok().flatten(),
        created_at: row
            .try_get("created_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
        updated_at: row
            .try_get("updated_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
    })
}

// ---------------------------------------------------------------------------
// Integration mappings
// ---------------------------------------------------------------------------

pub async fn get_mappings(pool: &DbPool, channel_id: i64) -> Result<ChannelMappings, ApiError> {
    repository::find_by_id(pool, channel_id).await?;
    repository::get_mappings(pool, channel_id).await
}

pub async fn upsert_room_type_mapping(
    pool: &DbPool,
    channel_id: i64,
    user_id: i64,
    input: ChannelRoomTypeMappingInput,
) -> Result<ChannelRoomTypeMapping, ApiError> {
    repository::find_by_id(pool, channel_id).await?;
    let mapping = repository::upsert_room_type_mapping(pool, channel_id, user_id, &input).await?;
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "channel_room_type_mapping_upsert",
            resource_type: "booking_channel",
            resource_id: Some(channel_id),
            details: Some(json!({
                "room_type_id": input.room_type_id,
                "external_room_id": input.external_room_id,
                "is_enabled": input.is_enabled.unwrap_or(true),
            })),
            ..Default::default()
        },
    )
    .await;
    Ok(mapping)
}

pub async fn upsert_rate_plan_mapping(
    pool: &DbPool,
    channel_id: i64,
    user_id: i64,
    input: ChannelRatePlanMappingInput,
) -> Result<ChannelRatePlanMapping, ApiError> {
    repository::find_by_id(pool, channel_id).await?;
    let mapping = repository::upsert_rate_plan_mapping(pool, channel_id, user_id, &input).await?;
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "channel_rate_plan_mapping_upsert",
            resource_type: "booking_channel",
            resource_id: Some(channel_id),
            details: Some(json!({
                "rate_plan_id": input.rate_plan_id,
                "external_rate_plan_id": input.external_rate_plan_id,
                "is_enabled": input.is_enabled.unwrap_or(true),
            })),
            ..Default::default()
        },
    )
    .await;
    Ok(mapping)
}

pub async fn delete_room_type_mapping(pool: &DbPool, mapping_id: i64) -> Result<(), ApiError> {
    repository::delete_room_type_mapping(pool, mapping_id).await
}

pub async fn delete_rate_plan_mapping(pool: &DbPool, mapping_id: i64) -> Result<(), ApiError> {
    repository::delete_rate_plan_mapping(pool, mapping_id).await
}

// ---------------------------------------------------------------------------
// Price resolution — shared by preview, matrix, portal, and booking writes.
// ---------------------------------------------------------------------------

/// The pre-channel per-night rate for a room type on a date: the named rate
/// plan's band price when given (falling back to the room-type rate), else
/// weekday/weekend then base — matching the portal pipeline.
pub async fn source_rate_for(
    pool: &DbPool,
    room_type_id: i64,
    date: NaiveDate,
    rate_plan_id: Option<i64>,
) -> Result<Decimal, ApiError> {
    let room_type = RateRepository::find_room_type(pool, room_type_id).await?;
    if let Some(plan_id) = rate_plan_id {
        let band = sqlx::query_scalar::<_, Decimal>(
            "SELECT price FROM room_rates
             WHERE rate_plan_id = $1 AND room_type_id = $2
               AND effective_from <= $3 AND (effective_to IS NULL OR effective_to >= $3)
             ORDER BY id DESC LIMIT 1",
        )
        .bind(plan_id)
        .bind(room_type_id)
        .bind(date)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
        if let Some(price) = band {
            return Ok(price);
        }
    }
    let is_weekend = matches!(date.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun);
    Ok(if is_weekend {
        room_type.weekend_rate.unwrap_or(room_type.base_price)
    } else {
        room_type.weekday_rate.unwrap_or(room_type.base_price)
    })
}

/// Commission configuration in force for a channel on `as_of`: the dated rule
/// wins, else the channel's own defaults.
pub async fn commission_config_for(
    pool: &DbPool,
    channel: &BookingChannel,
    as_of: NaiveDate,
) -> Result<CommissionConfig, ApiError> {
    let rules = repository::active_commission_rules(pool, channel.id).await?;
    if let Some(config) = pricing::select_commission_rule(&rules, as_of) {
        return Ok(config);
    }
    Ok(CommissionConfig {
        commission_type: channel.default_commission_type.clone(),
        value: channel.default_commission_value,
        scope: channel.default_commission_scope.clone(),
    })
}

/// Resolve nightly selling prices for one channel/room type over a stay.
/// `sources` pairs each night with its pre-channel rate.
pub async fn resolve_channel_nights(
    pool: &DbPool,
    channel_id: i64,
    room_type_id: i64,
    rate_plan_id: Option<i64>,
    sources: &[(NaiveDate, Decimal)],
) -> Result<Vec<PricedNight>, ApiError> {
    let Some((first, _)) = sources.first() else {
        return Ok(Vec::new());
    };
    let last_night = sources.last().map(|(d, _)| *d).unwrap_or(*first);
    let rules =
        repository::active_pricing_rules(pool, &[channel_id], *first, last_night).await?;
    Ok(sources
        .iter()
        .map(|(date, source)| {
            pricing::price_night(*date, *source, &rules, room_type_id, rate_plan_id)
        })
        .collect())
}

/// Full quote: nights + commission + estimated net revenue, as a booking write
/// or the preview endpoint consumes it.
pub async fn resolve_channel_quote(
    pool: &DbPool,
    channel: &BookingChannel,
    room_type_id: i64,
    rate_plan_id: Option<i64>,
    sources: &[(NaiveDate, Decimal)],
    discount_total: Decimal,
    actual_selling: Option<Decimal>,
    as_of: NaiveDate,
) -> Result<pricing::ChannelQuote, ApiError> {
    let nights =
        resolve_channel_nights(pool, channel.id, room_type_id, rate_plan_id, sources).await?;
    let commission = commission_config_for(pool, channel, as_of).await?;
    Ok(pricing::resolve_stay(
        nights,
        commission,
        discount_total,
        actual_selling,
    ))
}

/// `POST /channel-pricing/preview` — the nightly ladder a manager sees before
/// saving or pushing rates.
pub async fn preview(
    pool: &DbPool,
    input: ChannelPricePreviewRequest,
) -> Result<ChannelPricePreview, ApiError> {
    let channel = repository::find_by_id(pool, input.channel_id).await?;
    let room_type = RateRepository::find_room_type(pool, input.room_type_id).await?;
    let check_in = parse_date(&input.check_in, "check_in")?;
    let check_out = parse_date(&input.check_out, "check_out")?;
    if check_out <= check_in {
        return Err(ApiError::BadRequest(
            "check_out must be after check_in".to_string(),
        ));
    }
    if (check_out - check_in).num_days() > 62 {
        return Err(ApiError::BadRequest(
            "Preview range cannot exceed 62 nights".to_string(),
        ));
    }
    if let Some(plan_id) = input.rate_plan_id {
        RateRepository::find_rate_plan(pool, plan_id).await?;
    }

    let mut sources = Vec::new();
    let mut date = check_in;
    while date < check_out {
        sources.push((
            date,
            source_rate_for(pool, input.room_type_id, date, input.rate_plan_id).await?,
        ));
        date += chrono::Duration::days(1);
    }

    let quote = resolve_channel_quote(
        pool,
        &channel,
        input.room_type_id,
        input.rate_plan_id,
        &sources,
        Decimal::ZERO,
        None,
        check_in,
    )
    .await?;

    let currency = crate::modules::settings::service::get_setting_value(pool, "currency")
        .await
        .ok()
        .map(|v| v.trim().to_ascii_uppercase())
        .filter(|v| v.len() == 3)
        .unwrap_or_else(|| "MYR".to_string());

    let selling_subtotal = quote.selling_subtotal;
    Ok(ChannelPricePreview {
        channel_id: channel.id,
        channel_name: channel.name.clone(),
        room_type_id: room_type.id,
        room_type_name: room_type.name,
        rate_plan_id: input.rate_plan_id,
        check_in,
        check_out,
        currency,
        nights: quote
            .nights
            .iter()
            .map(|night| NightlyChannelPrice {
                date: night.date,
                source_rate: night.source_rate,
                selling_price: night.selling_price,
                net_rate: night.net_rate,
                rule_id: night.rule_id,
                rule_label: night.rule_label.clone(),
            })
            .collect(),
        selling_subtotal,
        // Preview has no promotion context: commission base is the sell subtotal.
        commission_base: selling_subtotal.or(quote.net_subtotal).unwrap_or(Decimal::ZERO),
        commission_type: quote.commission.commission_type.clone(),
        commission_value: quote.commission.value,
        commission_scope: quote.commission.scope.clone(),
        commission_amount: quote.commission_amount,
        net_revenue: quote.net_revenue,
    })
}

/// `GET /channel-pricing/matrix?date=&rate_plan_id=` — every channel × every
/// active room type on one date.
pub async fn matrix(
    pool: &DbPool,
    date: NaiveDate,
    rate_plan_id: Option<i64>,
) -> Result<ChannelMatrix, ApiError> {
    let channels = repository::list(pool).await?;
    let room_types = RateRepository::active_room_types(pool).await?;
    let channel_ids: Vec<i64> = channels
        .iter()
        .filter(|channel| channel.is_active)
        .map(|channel| channel.id)
        .collect();
    let rules = repository::active_pricing_rules(pool, &channel_ids, date, date).await?;

    let currency = crate::modules::settings::service::get_setting_value(pool, "currency")
        .await
        .ok()
        .map(|v| v.trim().to_ascii_uppercase())
        .filter(|v| v.len() == 3)
        .unwrap_or_else(|| "MYR".to_string());

    let mut cells = Vec::with_capacity(channels.len() * room_types.len());
    for channel in &channels {
        let commission = commission_config_for(pool, channel, date).await?;
        for room_type in &room_types {
            let source = if channel.is_active {
                source_rate_for(pool, room_type.id, date, rate_plan_id).await?
            } else {
                Decimal::ZERO
            };
            let night = pricing::price_night(
                date,
                source,
                &rules
                    .iter()
                    .filter(|rule| rule.channel_id == channel.id)
                    .cloned()
                    .collect::<Vec<_>>(),
                room_type.id,
                rate_plan_id,
            );
            let (commission_amount, net_revenue) = match night.selling_price {
                Some(selling) if channel.is_active => {
                    let amount = pricing::commission_amount(&commission, selling, 1);
                    (Some(amount), Some((selling - amount).round_dp(2)))
                }
                _ => (None, night.net_rate),
            };
            cells.push(ChannelMatrixCell {
                channel_id: channel.id,
                channel_name: channel.name.clone(),
                channel_type: channel.channel_type.clone(),
                room_type_id: room_type.id,
                source_rate: night.source_rate,
                selling_price: night.selling_price,
                net_rate: night.net_rate,
                rule_id: night.rule_id,
                rule_label: night.rule_label,
                commission_amount,
                net_revenue,
            });
        }
    }

    Ok(ChannelMatrix {
        date,
        rate_plan_id,
        currency,
        cells,
    })
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

async fn log_channel_event(pool: &DbPool, user_id: i64, action: &str, id: i64, name: &str) {
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action,
            resource_type: "booking_channel",
            resource_id: Some(id),
            details: Some(json!({ "name": name })),
            ..Default::default()
        },
    )
    .await;
}

async fn log_rule_event(pool: &DbPool, user_id: i64, action: &str, rule: &ChannelPricingRule) {
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action,
            resource_type: "channel_pricing_rule",
            resource_id: Some(rule.id),
            details: Some(json!({
                "channel_id": rule.channel_id,
                "room_type_id": rule.room_type_id,
                "rate_plan_id": rule.rate_plan_id,
                "rule_type": rule.rule_type,
                "value": rule.value.to_string(),
                "effective_from": rule.effective_from,
                "effective_to": rule.effective_to,
                "priority": rule.priority,
                "is_active": rule.is_active,
                "reason": rule.reason,
            })),
            ..Default::default()
        },
    )
    .await;
}

async fn log_commission_event(
    pool: &DbPool,
    user_id: i64,
    action: &str,
    rule: &ChannelCommissionRule,
) {
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action,
            resource_type: "channel_commission_rule",
            resource_id: Some(rule.id),
            details: Some(json!({
                "channel_id": rule.channel_id,
                "commission_type": rule.commission_type,
                "value": rule.value.to_string(),
                "scope": rule.scope,
                "effective_from": rule.effective_from,
                "effective_to": rule.effective_to,
                "priority": rule.priority,
                "is_active": rule.is_active,
                "reason": rule.reason,
            })),
            ..Default::default()
        },
    )
    .await;
}
