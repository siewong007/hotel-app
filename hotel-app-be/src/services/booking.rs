//! Booking business logic

use chrono::NaiveDate;
use uuid::Uuid;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::Booking;
use crate::repositories::booking::BookingRepository;

/// Generate a unique booking number using the provided hotel-local date.
pub fn generate_booking_number_for_date(date: NaiveDate) -> String {
    format!(
        "BK-{}-{}",
        date.format("%Y%m%d"),
        &Uuid::new_v4().to_string()[..8],
    )
}

/// Generate a unique booking number using the current UTC date.
#[allow(dead_code)] // used by tests/booking_service.rs
pub fn generate_booking_number() -> String {
    generate_booking_number_for_date(chrono::Utc::now().date_naive())
}

/// Fetch a single booking row by ID, returning a fully-mapped `Booking`.
pub async fn fetch_booking_by_id(pool: &DbPool, booking_id: i64) -> Result<Booking, ApiError> {
    BookingRepository::find_mapped_by_id(pool, booking_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))
}
