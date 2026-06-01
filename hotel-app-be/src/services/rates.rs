//! Rate plan business logic.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    ApplicableRateQuery, RatePlan, RatePlanCreateValues, RatePlanInput, RatePlanUpdateInput,
    RatePlanUpdateValues, RatePlanWithRates, RoomRate, RoomRateCreateValues, RoomRateInput,
    RoomRateUpdateInput, RoomRateUpdateValues, RoomRateWithDetails, RoomType,
};
use crate::repositories::rate::RateRepository;
use crate::services::audit::AuditLog;
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use serde_json::json;

pub async fn create_rate_plan(
    pool: &DbPool,
    user_id: i64,
    input: RatePlanInput,
) -> Result<RatePlan, ApiError> {
    let values = rate_plan_create_values(input);
    let rate_plan = RateRepository::create_rate_plan(pool, user_id, &values).await?;
    log_rate_plan_event(pool, user_id, "rate_plan_created", &rate_plan).await;
    Ok(rate_plan)
}

pub async fn list_rate_plans(pool: &DbPool) -> Result<Vec<RatePlan>, ApiError> {
    RateRepository::list_rate_plans(pool).await
}

pub async fn get_rate_plan(pool: &DbPool, rate_plan_id: i64) -> Result<RatePlan, ApiError> {
    RateRepository::find_rate_plan(pool, rate_plan_id).await
}

pub async fn get_rate_plan_with_rates(
    pool: &DbPool,
    rate_plan_id: i64,
) -> Result<RatePlanWithRates, ApiError> {
    let rate_plan = RateRepository::find_rate_plan(pool, rate_plan_id).await?;
    let rates = RateRepository::room_rates_by_plan(pool, rate_plan_id).await?;
    Ok(RatePlanWithRates { rate_plan, rates })
}

pub async fn update_rate_plan(
    pool: &DbPool,
    user_id: i64,
    rate_plan_id: i64,
    input: RatePlanUpdateInput,
) -> Result<RatePlan, ApiError> {
    let values = rate_plan_update_values(input);
    if !has_rate_plan_updates(&values) {
        return Err(ApiError::BadRequest(
            "No valid fields to update".to_string(),
        ));
    }

    let rate_plan = RateRepository::update_rate_plan(pool, rate_plan_id, &values).await?;
    log_rate_plan_event(pool, user_id, "rate_plan_updated", &rate_plan).await;
    Ok(rate_plan)
}

pub async fn delete_rate_plan(
    pool: &DbPool,
    user_id: i64,
    rate_plan_id: i64,
) -> Result<(), ApiError> {
    let deleted = RateRepository::delete_rate_plan(pool, rate_plan_id).await?;
    log_rate_plan_event(pool, user_id, "rate_plan_deleted", &deleted).await;
    Ok(())
}

pub async fn create_room_rate(
    pool: &DbPool,
    user_id: i64,
    input: RoomRateInput,
) -> Result<RoomRate, ApiError> {
    let values = room_rate_create_values(input)?;
    let room_rate = RateRepository::create_room_rate(pool, &values).await?;
    log_room_rate_event(pool, user_id, "room_rate_created", &room_rate).await;
    Ok(room_rate)
}

pub async fn list_room_rates(pool: &DbPool) -> Result<Vec<RoomRateWithDetails>, ApiError> {
    RateRepository::list_room_rates(pool).await
}

pub async fn room_rates_by_plan(
    pool: &DbPool,
    rate_plan_id: i64,
) -> Result<Vec<RoomRateWithDetails>, ApiError> {
    RateRepository::room_rates_by_plan(pool, rate_plan_id).await
}

pub async fn get_room_rate(pool: &DbPool, rate_id: i64) -> Result<RoomRateWithDetails, ApiError> {
    RateRepository::find_room_rate(pool, rate_id).await
}

pub async fn update_room_rate(
    pool: &DbPool,
    user_id: i64,
    rate_id: i64,
    input: RoomRateUpdateInput,
) -> Result<RoomRate, ApiError> {
    let values = room_rate_update_values(input);
    if !has_room_rate_updates(&values) {
        return Err(ApiError::BadRequest(
            "No valid fields to update".to_string(),
        ));
    }

    let room_rate = RateRepository::update_room_rate(pool, rate_id, &values).await?;
    log_room_rate_event(pool, user_id, "room_rate_updated", &room_rate).await;
    Ok(room_rate)
}

pub async fn delete_room_rate(pool: &DbPool, user_id: i64, rate_id: i64) -> Result<(), ApiError> {
    let deleted = RateRepository::delete_room_rate(pool, rate_id).await?;
    log_room_rate_event(pool, user_id, "room_rate_deleted", &deleted).await;
    Ok(())
}

pub async fn room_types_for_rates(pool: &DbPool) -> Result<Vec<RoomType>, ApiError> {
    RateRepository::active_room_types(pool).await
}

pub async fn applicable_rate(
    pool: &DbPool,
    query: ApplicableRateQuery,
) -> Result<serde_json::Value, ApiError> {
    let date = NaiveDate::parse_from_str(&query.date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid date format. Use YYYY-MM-DD".to_string()))?;
    let day_of_week = date.weekday().num_days_from_monday() as i32;

    if let Some(rate) =
        RateRepository::applicable_rate(pool, query.room_type_id, date, day_of_week).await?
    {
        return Ok(json!(rate));
    }

    let room_type = RateRepository::find_room_type(pool, query.room_type_id).await?;
    Ok(json!({
        "rate_plan_code": "BASE",
        "rate_plan_name": "Base Rate",
        "room_type_id": room_type.id,
        "room_type_name": room_type.name,
        "room_type_code": room_type.code,
        "price": room_type.base_price,
        "is_base_rate": true
    }))
}

fn rate_plan_create_values(input: RatePlanInput) -> RatePlanCreateValues {
    RatePlanCreateValues {
        name: input.name,
        code: input.code,
        description: input.description,
        plan_type: input.plan_type,
        adjustment_type: input.adjustment_type,
        adjustment_value: input.adjustment_value.and_then(Decimal::from_f64_retain),
        valid_from: input
            .valid_from
            .as_ref()
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()),
        valid_to: input
            .valid_to
            .as_ref()
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()),
        applies_monday: input.applies_monday.unwrap_or(true),
        applies_tuesday: input.applies_tuesday.unwrap_or(true),
        applies_wednesday: input.applies_wednesday.unwrap_or(true),
        applies_thursday: input.applies_thursday.unwrap_or(true),
        applies_friday: input.applies_friday.unwrap_or(true),
        applies_saturday: input.applies_saturday.unwrap_or(true),
        applies_sunday: input.applies_sunday.unwrap_or(true),
        min_nights: input.min_nights.unwrap_or(1),
        max_nights: input.max_nights,
        min_advance_booking: input.min_advance_booking.unwrap_or(0),
        max_advance_booking: input.max_advance_booking,
        blackout_dates: input.blackout_dates,
        is_active: input.is_active.unwrap_or(true),
        priority: input.priority.unwrap_or(0),
    }
}

fn rate_plan_update_values(input: RatePlanUpdateInput) -> RatePlanUpdateValues {
    RatePlanUpdateValues {
        name: input.name,
        code: input.code,
        description: input.description,
        plan_type: input.plan_type,
        adjustment_type: input.adjustment_type,
        adjustment_value: input.adjustment_value.and_then(Decimal::from_f64_retain),
        valid_from: input
            .valid_from
            .as_ref()
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()),
        valid_to: input
            .valid_to
            .as_ref()
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()),
        applies_monday: input.applies_monday,
        applies_tuesday: input.applies_tuesday,
        applies_wednesday: input.applies_wednesday,
        applies_thursday: input.applies_thursday,
        applies_friday: input.applies_friday,
        applies_saturday: input.applies_saturday,
        applies_sunday: input.applies_sunday,
        min_nights: input.min_nights,
        max_nights: input.max_nights,
        min_advance_booking: input.min_advance_booking,
        max_advance_booking: input.max_advance_booking,
        is_active: input.is_active,
        priority: input.priority,
    }
}

fn has_rate_plan_updates(values: &RatePlanUpdateValues) -> bool {
    values.name.is_some()
        || values.code.is_some()
        || values.description.is_some()
        || values.plan_type.is_some()
        || values.adjustment_type.is_some()
        || values.adjustment_value.is_some()
        || values.valid_from.is_some()
        || values.valid_to.is_some()
        || values.applies_monday.is_some()
        || values.applies_tuesday.is_some()
        || values.applies_wednesday.is_some()
        || values.applies_thursday.is_some()
        || values.applies_friday.is_some()
        || values.applies_saturday.is_some()
        || values.applies_sunday.is_some()
        || values.min_nights.is_some()
        || values.max_nights.is_some()
        || values.min_advance_booking.is_some()
        || values.max_advance_booking.is_some()
        || values.is_active.is_some()
        || values.priority.is_some()
}

fn room_rate_create_values(input: RoomRateInput) -> Result<RoomRateCreateValues, ApiError> {
    let effective_from =
        NaiveDate::parse_from_str(&input.effective_from, "%Y-%m-%d").map_err(|_| {
            ApiError::BadRequest("Invalid effective_from date format. Use YYYY-MM-DD".to_string())
        })?;

    let effective_to = input
        .effective_to
        .as_ref()
        .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok());

    let price = Decimal::from_f64_retain(input.price)
        .ok_or_else(|| ApiError::BadRequest("Invalid price value".to_string()))?;

    Ok(RoomRateCreateValues {
        rate_plan_id: input.rate_plan_id,
        room_type_id: input.room_type_id,
        price,
        effective_from,
        effective_to,
    })
}

fn room_rate_update_values(input: RoomRateUpdateInput) -> RoomRateUpdateValues {
    RoomRateUpdateValues {
        price: input.price.and_then(Decimal::from_f64_retain),
        effective_from: input
            .effective_from
            .as_ref()
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()),
        effective_to: input
            .effective_to
            .as_ref()
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()),
    }
}

fn has_room_rate_updates(values: &RoomRateUpdateValues) -> bool {
    values.price.is_some() || values.effective_from.is_some() || values.effective_to.is_some()
}

fn rate_plan_audit_details(rate_plan: &RatePlan) -> serde_json::Value {
    json!({
        "code": rate_plan.code,
        "name": rate_plan.name,
        "plan_type": rate_plan.plan_type,
        "adjustment_type": rate_plan.adjustment_type,
        "adjustment_value": rate_plan.adjustment_value.map(|value| value.to_string()),
        "valid_from": rate_plan.valid_from,
        "valid_to": rate_plan.valid_to,
        "is_active": rate_plan.is_active,
        "priority": rate_plan.priority,
    })
}

fn room_rate_audit_details(room_rate: &RoomRate) -> serde_json::Value {
    json!({
        "rate_plan_id": room_rate.rate_plan_id,
        "room_type_id": room_rate.room_type_id,
        "price": room_rate.price.to_string(),
        "effective_from": room_rate.effective_from,
        "effective_to": room_rate.effective_to,
    })
}

async fn log_rate_plan_event(pool: &DbPool, user_id: i64, action: &str, rate_plan: &RatePlan) {
    let _ = AuditLog::log_event(
        pool,
        Some(user_id),
        action,
        "rate_plan",
        Some(rate_plan.id),
        Some(rate_plan_audit_details(rate_plan)),
        None,
        None,
    )
    .await;
}

async fn log_room_rate_event(pool: &DbPool, user_id: i64, action: &str, room_rate: &RoomRate) {
    let _ = AuditLog::log_event(
        pool,
        Some(user_id),
        action,
        "room_rate",
        Some(room_rate.id),
        Some(room_rate_audit_details(room_rate)),
        None,
        None,
    )
    .await;
}
