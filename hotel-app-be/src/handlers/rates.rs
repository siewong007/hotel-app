//! Rate plan handlers.
//!
//! Handlers translate HTTP inputs and outputs for rate plans and room rates.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde_json::json;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    ApplicableRateQuery, RatePlanInput, RatePlanUpdateInput, RoomRateInput, RoomRateUpdateInput,
};
use crate::services::rates as svc;

/// Rate-specific error type.
pub enum RateError {
    NotFound,
    BadRequest(String),
    Api(ApiError),
}

impl IntoResponse for RateError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            RateError::NotFound => (StatusCode::NOT_FOUND, "Resource not found"),
            RateError::BadRequest(msg) => {
                return (StatusCode::BAD_REQUEST, Json(json!({"error": msg}))).into_response();
            }
            RateError::Api(err) => return err.into_response(),
        };
        (status, Json(json!({"error": message}))).into_response()
    }
}

impl From<ApiError> for RateError {
    fn from(error: ApiError) -> Self {
        match error {
            ApiError::BadRequest(message) => RateError::BadRequest(message),
            ApiError::NotFound(_) => RateError::NotFound,
            other => RateError::Api(other),
        }
    }
}

/// Create a new rate plan.
pub async fn create_rate_plan(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(input): Json<RatePlanInput>,
) -> Result<impl IntoResponse, RateError> {
    let rate_plan = svc::create_rate_plan(&pool, user_id, input).await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "message": "Rate plan created successfully",
            "rate_plan": rate_plan
        })),
    ))
}

/// Get all rate plans.
pub async fn get_rate_plans(State(pool): State<DbPool>) -> Result<impl IntoResponse, RateError> {
    Ok(Json(svc::list_rate_plans(&pool).await?))
}

/// Get a single rate plan by ID.
pub async fn get_rate_plan(
    State(pool): State<DbPool>,
    Path(rate_plan_id): Path<i64>,
) -> Result<impl IntoResponse, RateError> {
    Ok(Json(svc::get_rate_plan(&pool, rate_plan_id).await?))
}

/// Get rate plan with all associated rates.
pub async fn get_rate_plan_with_rates(
    State(pool): State<DbPool>,
    Path(rate_plan_id): Path<i64>,
) -> Result<impl IntoResponse, RateError> {
    Ok(Json(
        svc::get_rate_plan_with_rates(&pool, rate_plan_id).await?,
    ))
}

/// Update a rate plan.
pub async fn update_rate_plan(
    State(pool): State<DbPool>,
    Path(rate_plan_id): Path<i64>,
    user_id: i64,
    Json(input): Json<RatePlanUpdateInput>,
) -> Result<impl IntoResponse, RateError> {
    let rate_plan = svc::update_rate_plan(&pool, user_id, rate_plan_id, input).await?;

    Ok(Json(json!({
        "message": "Rate plan updated successfully",
        "rate_plan": rate_plan
    })))
}

/// Delete a rate plan.
pub async fn delete_rate_plan(
    State(pool): State<DbPool>,
    Path(rate_plan_id): Path<i64>,
    user_id: i64,
) -> Result<impl IntoResponse, RateError> {
    svc::delete_rate_plan(&pool, user_id, rate_plan_id).await?;

    Ok(Json(json!({
        "message": "Rate plan deleted successfully"
    })))
}

/// Create a new room rate.
pub async fn create_room_rate(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(input): Json<RoomRateInput>,
) -> Result<impl IntoResponse, RateError> {
    let room_rate = svc::create_room_rate(&pool, user_id, input).await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "message": "Room rate created successfully",
            "room_rate": room_rate
        })),
    ))
}

/// Get all room rates with details.
pub async fn get_room_rates(State(pool): State<DbPool>) -> Result<impl IntoResponse, RateError> {
    Ok(Json(svc::list_room_rates(&pool).await?))
}

/// Get room rates by rate plan ID.
pub async fn get_room_rates_by_plan(
    State(pool): State<DbPool>,
    Path(rate_plan_id): Path<i64>,
) -> Result<impl IntoResponse, RateError> {
    Ok(Json(svc::room_rates_by_plan(&pool, rate_plan_id).await?))
}

/// Get a single room rate by ID.
pub async fn get_room_rate(
    State(pool): State<DbPool>,
    Path(rate_id): Path<i64>,
) -> Result<impl IntoResponse, RateError> {
    Ok(Json(svc::get_room_rate(&pool, rate_id).await?))
}

/// Update a room rate.
pub async fn update_room_rate(
    State(pool): State<DbPool>,
    Path(rate_id): Path<i64>,
    user_id: i64,
    Json(input): Json<RoomRateUpdateInput>,
) -> Result<impl IntoResponse, RateError> {
    let room_rate = svc::update_room_rate(&pool, user_id, rate_id, input).await?;

    Ok(Json(json!({
        "message": "Room rate updated successfully",
        "room_rate": room_rate
    })))
}

/// Delete a room rate.
pub async fn delete_room_rate(
    State(pool): State<DbPool>,
    Path(rate_id): Path<i64>,
    user_id: i64,
) -> Result<impl IntoResponse, RateError> {
    svc::delete_room_rate(&pool, user_id, rate_id).await?;

    Ok(Json(json!({
        "message": "Room rate deleted successfully"
    })))
}

/// Get all room types for associating with rates.
pub async fn get_room_types_for_rates(
    State(pool): State<DbPool>,
) -> Result<impl IntoResponse, RateError> {
    Ok(Json(svc::room_types_for_rates(&pool).await?))
}

/// Get applicable rate for a room type on a specific date.
pub async fn get_applicable_rate(
    State(pool): State<DbPool>,
    Query(query): Query<ApplicableRateQuery>,
) -> Result<impl IntoResponse, RateError> {
    Ok(Json(svc::applicable_rate(&pool, query).await?))
}
