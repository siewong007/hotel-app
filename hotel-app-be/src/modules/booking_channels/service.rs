//! Booking channel business logic.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{BookingChannel, BookingChannelInput, BookingChannelUpdate};
use super::repository;

pub async fn list(pool: &DbPool) -> Result<Vec<BookingChannel>, ApiError> {
    repository::list(pool).await
}

pub async fn create(pool: &DbPool, input: BookingChannelInput) -> Result<BookingChannel, ApiError> {
    repository::create(pool, input).await
}

pub async fn update(
    pool: &DbPool,
    id: i64,
    input: BookingChannelUpdate,
) -> Result<BookingChannel, ApiError> {
    repository::update(pool, id, input).await
}

pub async fn deactivate(pool: &DbPool, id: i64) -> Result<BookingChannel, ApiError> {
    repository::deactivate(pool, id).await
}
