//! Booking business logic

use chrono::NaiveDate;
use uuid::Uuid;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{Booking, row_mappers};

/// Generate a unique booking number using the provided hotel-local date.
pub fn generate_booking_number_for_date(date: NaiveDate) -> String {
    format!(
        "BK-{}-{}",
        date.format("%Y%m%d"),
        &Uuid::new_v4().to_string()[..8],
    )
}

/// Fetch a single booking row by ID, returning a fully-mapped `Booking`.
pub async fn fetch_booking_by_id(pool: &DbPool, booking_id: i64) -> Result<Booking, ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let query = "SELECT * FROM bookings WHERE id = ?1";

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let query = "SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, \
        room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, \
        payment_method, adults, children, special_requests, remarks, source, market_code, \
        discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, \
        pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, \
        is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, \
        original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, \
        company_id, company_name, payment_note, daily_rates, created_at, updated_at, post_type \
        FROM bookings WHERE id = $1";

    let row = sqlx::query(query)
        .bind(booking_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    Ok(row_mappers::row_to_booking(&row))
}
