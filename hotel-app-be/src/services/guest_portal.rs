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
use crate::services::auto_checkin;

const VERIFY_BOOKING_FAILURE: &str =
    "Unable to verify booking details. Please check the booking number and email.";

fn verify_booking_failure() -> ApiError {
    ApiError::Unauthorized(VERIFY_BOOKING_FAILURE.to_string())
}

fn guest_email_matches(stored_email: Option<&str>, requested_email: &str) -> bool {
    stored_email
        .map(str::trim)
        .is_some_and(|email| email.eq_ignore_ascii_case(requested_email.trim()))
}

pub async fn verify_guest_booking(
    pool: &DbPool,
    request: GuestPortalVerifyRequest,
) -> Result<GuestPortalVerifyResponse, ApiError> {
    let booking =
        GuestPortalRepository::find_eligible_booking_by_number(pool, &request.booking_number)
            .await?
            .ok_or_else(verify_booking_failure)?;

    let guest = GuestPortalRepository::find_guest(pool, booking.guest_id).await?;
    if !guest_email_matches(guest.email.as_deref(), &request.email) {
        return Err(verify_booking_failure());
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
    portal_response(pool, booking).await
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

    portal_response(pool, updated_booking).await
}

pub async fn auto_checkin_by_token(
    pool: &DbPool,
    token: &str,
) -> Result<crate::models::AutoCheckinResponse, ApiError> {
    let booking = require_valid_token(pool, token).await?;
    auto_checkin::auto_checkin_for_guest_portal(pool, booking.id).await
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

async fn portal_response(
    pool: &DbPool,
    booking: Booking,
) -> Result<GuestPortalBookingResponse, ApiError> {
    let mut guest = GuestPortalRepository::find_guest(pool, booking.guest_id).await?;
    auto_checkin::attach_guest_ekyc_summary(pool, &mut guest).await?;
    let ekyc_summary = auto_checkin::auto_checkin_eligibility(pool, booking.id).await?;

    Ok(GuestPortalBookingResponse {
        booking,
        guest,
        ekyc_summary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guest_email_match_allows_case_and_whitespace_differences() {
        assert!(guest_email_matches(
            Some(" Guest.Example@Hotel.Local "),
            "guest.example@hotel.local"
        ));
    }

    #[test]
    fn guest_email_match_rejects_missing_or_different_email() {
        assert!(!guest_email_matches(None, "guest@example.com"));
        assert!(!guest_email_matches(
            Some("other@example.com"),
            "guest@example.com"
        ));
    }

    #[test]
    fn verification_failure_message_is_generic() {
        let err = verify_booking_failure();
        assert!(
            matches!(err, ApiError::Unauthorized(message) if message == VERIFY_BOOKING_FAILURE)
        );
    }
}
