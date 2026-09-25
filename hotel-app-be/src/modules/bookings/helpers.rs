//! Booking business logic

use chrono::NaiveDate;
use uuid::Uuid;

use super::repository::BookingRepository;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::Booking;

/// Reservation statuses that hold a room for an arriving or future stay, as a
/// SQL `IN (...)` list.
///
/// `pending_payment` (an unpaid website booking) and `pending_confirmation`
/// (payment submitted, e.g. a bank transfer awaiting staff confirmation) hold
/// the room exactly like `pending`/`confirmed`: the guest web flow allocates the
/// room and marks it reserved, and booking creation already treats them as
/// conflicts. Anything that asks "is this room held?" must use this list, or a
/// held room reads as free (the room 210 case). Voided bookings never hold a
/// room, and there is no `cancelled`/`expired` booking status — an unpaid hold
/// that expires is voided by the unpaid-hold sweep.
///
/// Deliberately NOT for check-in eligibility: check-in accepts only
/// `confirmed`/`pending`, so an awaiting-payment hold holds the room without
/// being check-in-ready. Mirrors `ROOM_HOLDING_RESERVATION_STATUSES` in
/// `hotel-web-fe/src/constants/booking.constants.ts`.
pub const ROOM_HOLDING_RESERVATION_STATUSES_SQL: &str =
    "'pending', 'pending_payment', 'pending_confirmation', 'confirmed'";

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
