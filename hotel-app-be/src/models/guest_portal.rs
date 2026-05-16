//! Guest portal API models.

use serde::{Deserialize, Serialize};

use super::{Booking, Guest};

/// Request for verifying a guest booking.
#[derive(Debug, Deserialize)]
pub struct GuestPortalVerifyRequest {
    pub booking_number: String,
    pub email: String,
}

/// Response for guest portal verification.
#[derive(Debug, Serialize)]
pub struct GuestPortalVerifyResponse {
    pub token: String,
    pub expires_at: String,
    pub booking_id: String,
}

/// Response for guest portal booking details.
#[derive(Debug, Serialize)]
pub struct GuestPortalBookingResponse {
    pub booking: Booking,
    pub guest: Guest,
}
