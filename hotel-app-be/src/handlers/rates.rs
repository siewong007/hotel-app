//! Rate plan handlers
//!
//! Handles rate plans and pricing management.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use serde_json::json;
use sqlx::PgPool;

use crate::models::{
    RatePlan, RatePlanInput, RatePlanUpdateInput, RatePlanWithRates, RoomRate, RoomRateInput,
    RoomRateUpdateInput, RoomRateWithDetails, RoomType,
};

/// Rate-specific error type
pub enum RateError {
    Database(sqlx::Error),
    NotFound,
    BadRequest(String),
}

impl IntoResponse for RateError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            RateError::Database(e) => {
                eprintln!("Database error: {:?}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Database error")
            }
            RateError::NotFound => (StatusCode::NOT_FOUND, "Resource not found"),
            RateError::BadRequest(msg) => {
                return (StatusCode::BAD_REQUEST, Json(json!({"error": msg}))).into_response()
            }
        };
        (status, Json(json!({"error": message}))).into_response()
    }
}

impl From<sqlx::Error> for RateError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => RateError::NotFound,
            _ => RateError::Database(e),
        }
    }
}

/// Create a new rate plan
pub async fn create_rate_plan(
    State(pool): State<PgPool>,
    Json(input): Json<RatePlanInput>,
) -> Result<impl IntoResponse, RateError> {
    let valid_from = input
        .valid_from
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let valid_to = input
        .valid_to
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

    let adjustment_value = input.adjustment_value.and_then(Decimal::from_f64_retain);

    let rate_plan = sqlx::query_as::<_, RatePlan>(
        r#"
        INSERT INTO rate_plans (
            name, code, description, plan_type, adjustment_type, adjustment_value,
            valid_from, valid_to, applies_monday, applies_tuesday, applies_wednesday,
            applies_thursday, applies_friday, applies_saturday, applies_sunday,
            min_nights, max_nights, min_advance_booking, max_advance_booking,
            blackout_dates, is_active, priority, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        RETURNING *
        "#,
    )
    .bind(&input.name)
    .bind(&input.code)
    .bind(&input.description)
    .bind(&input.plan_type)
    .bind(&input.adjustment_type)
    .bind(adjustment_value)
    .bind(valid_from)
    .bind(valid_to)
    .bind(input.applies_monday.unwrap_or(true))
    .bind(input.applies_tuesday.unwrap_or(true))
    .bind(input.applies_wednesday.unwrap_or(true))
    .bind(input.applies_thursday.unwrap_or(true))
    .bind(input.applies_friday.unwrap_or(true))
    .bind(input.applies_saturday.unwrap_or(true))
    .bind(input.applies_sunday.unwrap_or(true))
    .bind(input.min_nights.unwrap_or(1))
    .bind(input.max_nights)
    .bind(input.min_advance_booking.unwrap_or(0))
    .bind(input.max_advance_booking)
    .bind(&input.blackout_dates)
    .bind(input.is_active.unwrap_or(true))
    .bind(input.priority.unwrap_or(0))
    .bind(1i64) // TODO: Get from auth token
    .fetch_one(&pool)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "message": "Rate plan created successfully",
            "rate_plan": rate_plan
        })),
    ))
}

/// Get all rate plans
pub async fn get_rate_plans(State(pool): State<PgPool>) -> Result<impl IntoResponse, RateError> {
    let rate_plans = sqlx::query_as::<_, RatePlan>(
        r#"
        SELECT * FROM rate_plans
        ORDER BY priority DESC, name ASC
        "#,
    )
    .fetch_all(&pool)
    .await?;

    Ok(Json(rate_plans))
}

/// Get a single rate plan by ID
pub async fn get_rate_plan(
    State(pool): State<PgPool>,
    Path(rate_plan_id): Path<i64>,
) -> Result<impl IntoResponse, RateError> {
    let rate_plan = sqlx::query_as::<_, RatePlan>(
        r#"
        SELECT * FROM rate_plans WHERE id = $1
        "#,
    )
    .bind(rate_plan_id)
    .fetch_one(&pool)
    .await?;

    Ok(Json(rate_plan))
}

/// Get rate plan with all associated rates
pub async fn get_rate_plan_with_rates(
    State(pool): State<PgPool>,
    Path(rate_plan_id): Path<i64>,
) -> Result<impl IntoResponse, RateError> {
    let rate_plan = sqlx::query_as::<_, RatePlan>(
        r#"
        SELECT * FROM rate_plans WHERE id = $1
        "#,
    )
    .bind(rate_plan_id)
    .fetch_one(&pool)
    .await?;

    let rates = sqlx::query_as::<_, RoomRateWithDetails>(
        r#"
        SELECT
            rr.id,
            rr.rate_plan_id,
            rp.name as rate_plan_name,
            rp.code as rate_plan_code,
            rp.description as rate_plan_description,
            rr.room_type_id,
            rt.name as room_type_name,
            rt.code as room_type_code,
            rr.price,
            rr.effective_from,
            rr.effective_to,
            rr.created_at
        FROM room_rates rr
        JOIN rate_plans rp ON rr.rate_plan_id = rp.id
        JOIN room_types rt ON rr.room_type_id = rt.id
        WHERE rr.rate_plan_id = $1
        ORDER BY rt.sort_order, rt.name
        "#,
    )
    .bind(rate_plan_id)
    .fetch_all(&pool)
    .await?;

    Ok(Json(RatePlanWithRates { rate_plan, rates }))
}

/// Update a rate plan
pub async fn update_rate_plan(
    State(pool): State<PgPool>,
    Path(rate_plan_id): Path<i64>,
    Json(input): Json<RatePlanUpdateInput>,
) -> Result<impl IntoResponse, RateError> {
    let mut query_builder =
        sqlx::QueryBuilder::new("UPDATE rate_plans SET updated_at = CURRENT_TIMESTAMP");
    let mut has_updates = false;

    if let Some(name) = &input.name {
        query_builder.push(", name = ");
        query_builder.push_bind(name);
        has_updates = true;
    }

    if let Some(description) = &input.description {
        query_builder.push(", description = ");
        query_builder.push_bind(description);
        has_updates = true;
    }

    if let Some(plan_type) = &input.plan_type {
        query_builder.push(", plan_type = ");
        query_builder.push_bind(plan_type);
        has_updates = true;
    }

    if let Some(adjustment_type) = &input.adjustment_type {
        query_builder.push(", adjustment_type = ");
        query_builder.push_bind(adjustment_type);
        has_updates = true;
    }

    if let Some(adjustment_value) = input.adjustment_value {
        if let Some(val) = Decimal::from_f64_retain(adjustment_value) {
            query_builder.push(", adjustment_value = ");
            query_builder.push_bind(val);
            has_updates = true;
        }
    }

    if let Some(valid_from) = &input.valid_from {
        if let Ok(date) = NaiveDate::parse_from_str(valid_from, "%Y-%m-%d") {
            query_builder.push(", valid_from = ");
            query_builder.push_bind(date);
            has_updates = true;
        }
    }

    if let Some(valid_to) = &input.valid_to {
        if let Ok(date) = NaiveDate::parse_from_str(valid_to, "%Y-%m-%d") {
            query_builder.push(", valid_to = ");
            query_builder.push_bind(date);
            has_updates = true;
        }
    }

    if let Some(v) = input.applies_monday {
        query_builder.push(", applies_monday = ");
        query_builder.push_bind(v);
        has_updates = true;
    }

    if let Some(v) = input.applies_tuesday {
        query_builder.push(", applies_tuesday = ");
        query_builder.push_bind(v);
        has_updates = true;
    }

    if let Some(v) = input.applies_wednesday {
        query_builder.push(", applies_wednesday = ");
        query_builder.push_bind(v);
        has_updates = true;
    }

    if let Some(v) = input.applies_thursday {
        query_builder.push(", applies_thursday = ");
        query_builder.push_bind(v);
        has_updates = true;
    }

    if let Some(v) = input.applies_friday {
        query_builder.push(", applies_friday = ");
        query_builder.push_bind(v);
        has_updates = true;
    }

    if let Some(v) = input.applies_saturday {
        query_builder.push(", applies_saturday = ");
        query_builder.push_bind(v);
        has_updates = true;
    }

    if let Some(v) = input.applies_sunday {
        query_builder.push(", applies_sunday = ");
        query_builder.push_bind(v);
        has_updates = true;
    }

    if let Some(min_nights) = input.min_nights {
        query_builder.push(", min_nights = ");
        query_builder.push_bind(min_nights);
        has_updates = true;
    }

    if let Some(max_nights) = input.max_nights {
        query_builder.push(", max_nights = ");
        query_builder.push_bind(max_nights);
        has_updates = true;
    }

    if let Some(min_advance_booking) = input.min_advance_booking {
        query_builder.push(", min_advance_booking = ");
        query_builder.push_bind(min_advance_booking);
        has_updates = true;
    }

    if let Some(max_advance_booking) = input.max_advance_booking {
        query_builder.push(", max_advance_booking = ");
        query_builder.push_bind(max_advance_booking);
        has_updates = true;
    }

    if let Some(is_active) = input.is_active {
        query_builder.push(", is_active = ");
        query_builder.push_bind(is_active);
        has_updates = true;
    }

    if let Some(priority) = input.priority {
        query_builder.push(", priority = ");
        query_builder.push_bind(priority);
        has_updates = true;
    }

    if !has_updates {
        return Err(RateError::BadRequest(
            "No valid fields to update".to_string(),
        ));
    }

    query_builder.push(" WHERE id = ");
    query_builder.push_bind(rate_plan_id);
    query_builder.push(" RETURNING *");

    let rate_plan = query_builder
        .build_query_as::<RatePlan>()
        .fetch_one(&pool)
        .await?;

    Ok(Json(json!({
        "message": "Rate plan updated successfully",
        "rate_plan": rate_plan
    })))
}

/// Delete a rate plan
pub async fn delete_rate_plan(
    State(pool): State<PgPool>,
    Path(rate_plan_id): Path<i64>,
) -> Result<impl IntoResponse, RateError> {
    let result = sqlx::query(
        r#"
        DELETE FROM rate_plans WHERE id = $1
        "#,
    )
    .bind(rate_plan_id)
    .execute(&pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(RateError::NotFound);
    }

    Ok(Json(json!({
        "message": "Rate plan deleted successfully"
    })))
}

/// Create a new room rate
pub async fn create_room_rate(
    State(pool): State<PgPool>,
    Json(input): Json<RoomRateInput>,
) -> Result<impl IntoResponse, RateError> {
    let effective_from = NaiveDate::parse_from_str(&input.effective_from, "%Y-%m-%d").map_err(
        |_| RateError::BadRequest("Invalid effective_from date format. Use YYYY-MM-DD".to_string()),
    )?;

    let effective_to = input
        .effective_to
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

    let price = Decimal::from_f64_retain(input.price)
        .ok_or_else(|| RateError::BadRequest("Invalid price value".to_string()))?;

    let room_rate = sqlx::query_as::<_, RoomRate>(
        r#"
        INSERT INTO room_rates (rate_plan_id, room_type_id, price, effective_from, effective_to)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(input.rate_plan_id)
    .bind(input.room_type_id)
    .bind(price)
    .bind(effective_from)
    .bind(effective_to)
    .fetch_one(&pool)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "message": "Room rate created successfully",
            "room_rate": room_rate
        })),
    ))
}

/// Get all room rates with details
pub async fn get_room_rates(State(pool): State<PgPool>) -> Result<impl IntoResponse, RateError> {
    let rates = sqlx::query_as::<_, RoomRateWithDetails>(
        r#"
        SELECT
            rr.id,
            rr.rate_plan_id,
            rp.name as rate_plan_name,
            rp.code as rate_plan_code,
            rp.description as rate_plan_description,
            rr.room_type_id,
            rt.name as room_type_name,
            rt.code as room_type_code,
            rr.price,
            rr.effective_from,
            rr.effective_to,
            rr.created_at
        FROM room_rates rr
        JOIN rate_plans rp ON rr.rate_plan_id = rp.id
        JOIN room_types rt ON rr.room_type_id = rt.id
        ORDER BY rp.name, rt.sort_order, rt.name, rr.effective_from DESC
        "#,
    )
    .fetch_all(&pool)
    .await?;

    Ok(Json(rates))
}

/// Get room rates by rate plan ID
pub async fn get_room_rates_by_plan(
    State(pool): State<PgPool>,
    Path(rate_plan_id): Path<i64>,
) -> Result<impl IntoResponse, RateError> {
    let rates = sqlx::query_as::<_, RoomRateWithDetails>(
        r#"
        SELECT
            rr.id,
            rr.rate_plan_id,
            rp.name as rate_plan_name,
            rp.code as rate_plan_code,
            rp.description as rate_plan_description,
            rr.room_type_id,
            rt.name as room_type_name,
            rt.code as room_type_code,
            rr.price,
            rr.effective_from,
            rr.effective_to,
            rr.created_at
        FROM room_rates rr
        JOIN rate_plans rp ON rr.rate_plan_id = rp.id
        JOIN room_types rt ON rr.room_type_id = rt.id
        WHERE rr.rate_plan_id = $1
        ORDER BY rt.sort_order, rt.name
        "#,
    )
    .bind(rate_plan_id)
    .fetch_all(&pool)
    .await?;

    Ok(Json(rates))
}

/// Get a single room rate by ID
pub async fn get_room_rate(
    State(pool): State<PgPool>,
    Path(rate_id): Path<i64>,
) -> Result<impl IntoResponse, RateError> {
    let rate = sqlx::query_as::<_, RoomRateWithDetails>(
        r#"
        SELECT
            rr.id,
            rr.rate_plan_id,
            rp.name as rate_plan_name,
            rp.code as rate_plan_code,
            rp.description as rate_plan_description,
            rr.room_type_id,
            rt.name as room_type_name,
            rt.code as room_type_code,
            rr.price,
            rr.effective_from,
            rr.effective_to,
            rr.created_at
        FROM room_rates rr
        JOIN rate_plans rp ON rr.rate_plan_id = rp.id
        JOIN room_types rt ON rr.room_type_id = rt.id
        WHERE rr.id = $1
        "#,
    )
    .bind(rate_id)
    .fetch_one(&pool)
    .await?;

    Ok(Json(rate))
}

/// Update a room rate
pub async fn update_room_rate(
    State(pool): State<PgPool>,
    Path(rate_id): Path<i64>,
    Json(input): Json<RoomRateUpdateInput>,
) -> Result<impl IntoResponse, RateError> {
    let mut query_builder = sqlx::QueryBuilder::new("UPDATE room_rates SET ");
    let mut has_updates = false;

    if let Some(price) = input.price {
        if let Some(price_decimal) = Decimal::from_f64_retain(price) {
            if has_updates {
                query_builder.push(", ");
            }
            query_builder.push("price = ");
            query_builder.push_bind(price_decimal);
            has_updates = true;
        }
    }

    if let Some(effective_from) = &input.effective_from {
        if let Ok(date) = NaiveDate::parse_from_str(effective_from, "%Y-%m-%d") {
            if has_updates {
                query_builder.push(", ");
            }
            query_builder.push("effective_from = ");
            query_builder.push_bind(date);
            has_updates = true;
        }
    }

    if let Some(effective_to) = &input.effective_to {
        if let Ok(date) = NaiveDate::parse_from_str(effective_to, "%Y-%m-%d") {
            if has_updates {
                query_builder.push(", ");
            }
            query_builder.push("effective_to = ");
            query_builder.push_bind(Some(date));
            has_updates = true;
        }
    }

    if !has_updates {
        return Err(RateError::BadRequest(
            "No valid fields to update".to_string(),
        ));
    }

    query_builder.push(" WHERE id = ");
    query_builder.push_bind(rate_id);
    query_builder.push(" RETURNING *");

    let rate = query_builder
        .build_query_as::<RoomRate>()
        .fetch_one(&pool)
        .await?;

    Ok(Json(json!({
        "message": "Room rate updated successfully",
        "room_rate": rate
    })))
}

/// Delete a room rate
pub async fn delete_room_rate(
    State(pool): State<PgPool>,
    Path(rate_id): Path<i64>,
) -> Result<impl IntoResponse, RateError> {
    let result = sqlx::query(
        r#"
        DELETE FROM room_rates WHERE id = $1
        "#,
    )
    .bind(rate_id)
    .execute(&pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(RateError::NotFound);
    }

    Ok(Json(json!({
        "message": "Room rate deleted successfully"
    })))
}

/// Get all room types (for associating with rates)
pub async fn get_room_types_for_rates(
    State(pool): State<PgPool>,
) -> Result<impl IntoResponse, RateError> {
    let room_types = sqlx::query_as::<_, RoomType>(
        r#"
        SELECT * FROM room_types
        WHERE is_active = true
        ORDER BY sort_order, name
        "#,
    )
    .fetch_all(&pool)
    .await?;

    Ok(Json(room_types))
}

/// Query for applicable rate lookup
#[derive(serde::Deserialize)]
pub struct ApplicableRateQuery {
    pub room_type_id: i64,
    pub date: String,
}

/// Get applicable rate for a room type on a specific date
pub async fn get_applicable_rate(
    State(pool): State<PgPool>,
    Query(query): Query<ApplicableRateQuery>,
) -> Result<impl IntoResponse, RateError> {
    let date = NaiveDate::parse_from_str(&query.date, "%Y-%m-%d")
        .map_err(|_| RateError::BadRequest("Invalid date format. Use YYYY-MM-DD".to_string()))?;

    let day_of_week = date.weekday().num_days_from_monday();

    let rate = sqlx::query_as::<_, RoomRateWithDetails>(
        r#"
        SELECT
            rr.id,
            rr.rate_plan_id,
            rp.name as rate_plan_name,
            rp.code as rate_plan_code,
            rp.description as rate_plan_description,
            rr.room_type_id,
            rt.name as room_type_name,
            rt.code as room_type_code,
            rr.price,
            rr.effective_from,
            rr.effective_to,
            rr.created_at
        FROM room_rates rr
        JOIN rate_plans rp ON rr.rate_plan_id = rp.id
        JOIN room_types rt ON rr.room_type_id = rt.id
        WHERE rr.room_type_id = $1
          AND rp.is_active = true
          AND rr.effective_from <= $2
          AND (rr.effective_to IS NULL OR rr.effective_to >= $2)
          AND (rp.valid_from IS NULL OR rp.valid_from <= $2)
          AND (rp.valid_to IS NULL OR rp.valid_to >= $2)
          AND (
              ($3 = 0 AND rp.applies_monday = true) OR
              ($3 = 1 AND rp.applies_tuesday = true) OR
              ($3 = 2 AND rp.applies_wednesday = true) OR
              ($3 = 3 AND rp.applies_thursday = true) OR
              ($3 = 4 AND rp.applies_friday = true) OR
              ($3 = 5 AND rp.applies_saturday = true) OR
              ($3 = 6 AND rp.applies_sunday = true)
          )
        ORDER BY rp.priority DESC
        LIMIT 1
        "#,
    )
    .bind(query.room_type_id)
    .bind(date)
    .bind(day_of_week as i32)
    .fetch_optional(&pool)
    .await?;

    if let Some(rate) = rate {
        return Ok(Json(json!(rate)));
    }

    // Fall back to base price
    let room_type = sqlx::query_as::<_, RoomType>(
        r#"
        SELECT * FROM room_types WHERE id = $1
        "#,
    )
    .bind(query.room_type_id)
    .fetch_one(&pool)
    .await?;

    Ok(Json(json!({
        "rate_plan_code": "BASE",
        "rate_plan_name": "Base Rate",
        "room_type_id": room_type.id,
        "room_type_name": room_type.name,
        "room_type_code": room_type.code,
        "price": room_type.base_price,
        "is_base_rate": true
    })))
}
