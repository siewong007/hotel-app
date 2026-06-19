//! Booking channel business logic.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{BookingChannel, BookingChannelInput, BookingChannelUpdate};
use crate::repositories::booking_channels;

pub async fn list(pool: &DbPool) -> Result<Vec<BookingChannel>, ApiError> {
    booking_channels::list(pool).await
}

pub async fn create(pool: &DbPool, input: BookingChannelInput) -> Result<BookingChannel, ApiError> {
    booking_channels::create(pool, input).await
}

pub async fn update(
    pool: &DbPool,
    id: i64,
    input: BookingChannelUpdate,
) -> Result<BookingChannel, ApiError> {
    booking_channels::update(pool, id, input).await
}

pub async fn deactivate(pool: &DbPool, id: i64) -> Result<BookingChannel, ApiError> {
    booking_channels::deactivate(pool, id).await
}
