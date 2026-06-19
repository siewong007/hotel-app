//! Booking channel handlers.

use axum::{
    Json,
    extract::{Path, State},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{BookingChannel, BookingChannelInput, BookingChannelUpdate};
use crate::services::booking_channels;

pub async fn list_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<BookingChannel>>, ApiError> {
    Ok(Json(booking_channels::list(&pool).await?))
}

pub async fn create_handler(
    State(pool): State<DbPool>,
    Json(input): Json<BookingChannelInput>,
) -> Result<Json<BookingChannel>, ApiError> {
    Ok(Json(booking_channels::create(&pool, input).await?))
}

pub async fn update_handler(
    State(pool): State<DbPool>,
    Path(id): Path<i64>,
    Json(input): Json<BookingChannelUpdate>,
) -> Result<Json<BookingChannel>, ApiError> {
    Ok(Json(booking_channels::update(&pool, id, input).await?))
}

pub async fn deactivate_handler(
    State(pool): State<DbPool>,
    Path(id): Path<i64>,
) -> Result<Json<BookingChannel>, ApiError> {
    Ok(Json(booking_channels::deactivate(&pool, id).await?))
}
