//! Guest portal workflows

use chrono::{Duration, Utc};
use regex::Regex;
use uuid::Uuid;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    Booking, GuestPortalBookingResponse, GuestPortalVerifyRequest, GuestPortalVerifyResponse,
    PreCheckInUpdateRequest,
};
use crate::repositories::guest_portal::GuestPortalRepository;

pub async fn verify_guest_booking(
    pool: &DbPool,
    request: GuestPortalVerifyRequest,
) -> Result<GuestPortalVerifyResponse, ApiError> {
    let booking =
        GuestPortalRepository::find_eligible_booking_by_number(pool, &request.booking_number)
            .await?
            .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let guest = GuestPortalRepository::find_guest(pool, booking.guest_id).await?;
    if guest.email.as_deref() != Some(request.email.as_str()) {
        return Err(ApiError::Unauthorized(
            "Email does not match booking".to_string(),
        ));
    }

    let check_in_date = booking.check_in_date;
    let today = chrono::Local::now().date_naive();
    let days_until_checkin = (check_in_date - today).num_days();

    if days_until_checkin < 0 {
        return Err(ApiError::BadRequest(
            "Check-in date has passed. Please check in at reception.".to_string(),
        ));
    }
    if days_until_checkin > 7 {
        return Err(ApiError::BadRequest(
            "Pre-check-in is only available 7 days before arrival.".to_string(),
        ));
    }

    let token = Uuid::new_v4().to_string();
    let expires_at = Utc::now() + Duration::hours(48);
    GuestPortalRepository::update_precheckin_token(pool, booking.id, &token, expires_at).await?;

    Ok(GuestPortalVerifyResponse {
        token,
        expires_at: expires_at.to_rfc3339(),
        booking_id: booking.id.to_string(),
    })
}

pub async fn get_booking_by_token(
    pool: &DbPool,
    token: &str,
) -> Result<GuestPortalBookingResponse, ApiError> {
    let booking = require_valid_token(pool, token).await?;
    let guest = GuestPortalRepository::find_guest(pool, booking.guest_id).await?;

    Ok(GuestPortalBookingResponse { booking, guest })
}

pub async fn submit_precheckin_update(
    pool: &DbPool,
    token: &str,
    mut request: PreCheckInUpdateRequest,
) -> Result<GuestPortalBookingResponse, ApiError> {
    let booking = require_valid_token(pool, token).await?;

    normalize_guest_email(&mut request);

    GuestPortalRepository::update_guest_precheckin(pool, booking.guest_id, &request.guest_update)
        .await?;
    GuestPortalRepository::update_booking_precheckin(
        pool,
        booking.id,
        request.market_code,
        request.special_requests,
        Utc::now().to_rfc3339(),
    )
    .await?;

    let updated_booking = GuestPortalRepository::find_booking_by_id(pool, booking.id).await?;
    let updated_guest = GuestPortalRepository::find_guest(pool, updated_booking.guest_id).await?;

    Ok(GuestPortalBookingResponse {
        booking: updated_booking,
        guest: updated_guest,
    })
}

async fn require_valid_token(pool: &DbPool, token: &str) -> Result<Booking, ApiError> {
    let booking = GuestPortalRepository::find_booking_by_token(pool, token)
        .await?
        .ok_or_else(|| ApiError::NotFound("Invalid or expired token".to_string()))?;

    match booking.pre_checkin_token_expires_at {
        Some(expires_at) if expires_at >= Utc::now() => Ok(booking),
        Some(_) => Err(ApiError::Unauthorized("Token has expired".to_string())),
        None => Err(ApiError::Unauthorized("Invalid token".to_string())),
    }
}

fn normalize_guest_email(request: &mut PreCheckInUpdateRequest) {
    let Some(email) = &request.guest_update.email else {
        return;
    };
    let trimmed = email.trim();

    if trimmed.is_empty() {
        request.guest_update.email = Some(String::new());
        return;
    }

    let email_regex = Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$").unwrap();
    if email_regex.is_match(trimmed) {
        request.guest_update.email = Some(trimmed.to_string());
    } else {
        request.guest_update.email = None;
    }
}
