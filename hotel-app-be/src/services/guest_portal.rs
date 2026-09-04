//! Guest portal workflows

use axum::http::HeaderMap;
use chrono::{Duration, Utc};
use rand::RngExt;
use regex::Regex;
use sha2::{Digest, Sha256};

use crate::core::db::{DbPool, hotel_today};
use crate::core::error::ApiError;
use crate::core::rate_limiter::RateLimiters;
use crate::models::AuditEvent;
use crate::models::{
    Booking, GuestPortalBenefitsResponse, GuestPortalBookingResponse, GuestPortalBookingSummary,
    GuestPortalCreditsResponse, GuestPortalLoginResponse, GuestPortalMeResponse,
    GuestPortalMembershipResponse, GuestPortalPage, GuestPortalTransaction,
    GuestPortalVerifyRequest, GuestPortalVerifyResponse, PreCheckInUpdateRequest,
};
use crate::repositories::guest_portal::GuestPortalRepository;
use crate::repositories::guest_portal_session::GuestPortalSessionRepository;
use crate::services::audit::AuditLog;
use crate::services::auto_checkin;

/// Generate a 256-bit random token as a hex string.
pub(crate) fn generate_session_token() -> String {
    let mut rng = rand::rng();
    let token_bytes: [u8; 32] = rng.random();
    hex::encode(token_bytes)
}

/// SHA-256 hash of a token, hex-encoded (matches the refresh-token scheme).
fn hash_session_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

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
    let today = hotel_today(pool).await?;
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

    let token = generate_session_token();
    let expires_at = Utc::now() + Duration::hours(48);
    GuestPortalRepository::update_precheckin_token(pool, booking.id, &token, expires_at).await?;
    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: None,
            action: "guest_portal.precheckin_token_issued",
            resource_type: "booking",
            resource_id: Some(booking.id),
            details: Some(serde_json::json!({"guest_id": booking.guest_id})),
            ..Default::default()
        },
    )
    .await?;

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

    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: None,
            action: "guest_portal.precheckin_submitted",
            resource_type: "booking",
            resource_id: Some(booking.id),
            details: Some(serde_json::json!({"guest_id": booking.guest_id})),
            ..Default::default()
        },
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
    let response = auto_checkin::auto_checkin_for_guest_portal(pool, booking.id).await?;
    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: None,
            action: "guest_portal.auto_checkin",
            resource_type: "booking",
            resource_id: Some(booking.id),
            details: Some(serde_json::json!({"guest_id": booking.guest_id})),
            ..Default::default()
        },
    )
    .await?;
    Ok(response)
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
    let guest = GuestPortalRepository::find_guest(pool, booking.guest_id).await?;
    let ekyc_summary = auto_checkin::auto_checkin_eligibility(pool, booking.id).await?;

    Ok(GuestPortalBookingResponse {
        booking: booking.into(),
        guest: guest.into(),
        ekyc_summary,
    })
}

// ============================================================================
// Guest portal session login + guest-scoped reads
// ============================================================================

const SESSION_TTL_HOURS: i64 = 24;

/// Issue a guest-scoped portal session after regular account authentication.
pub async fn create_authenticated_guest_portal_session(
    pool: &DbPool,
    user_id: i64,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<GuestPortalLoginResponse, ApiError> {
    let guest_id =
        GuestPortalSessionRepository::find_guest_id_for_authenticated_user(pool, user_id)
            .await?
            .ok_or_else(|| ApiError::Forbidden("Guest account required".to_string()))?;

    let token = generate_session_token();
    let token_hash = hash_session_token(&token);
    let expires_at = Utc::now() + Duration::hours(SESSION_TTL_HOURS);
    GuestPortalSessionRepository::create_session(pool, guest_id, &token_hash, expires_at).await?;

    let guest = GuestPortalSessionRepository::find_guest_view(pool, guest_id).await?;

    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "guest_portal.login",
            resource_type: "guest",
            resource_id: Some(guest_id),
            details: None,
            ip_address,
            user_agent,
        },
    )
    .await?;

    Ok(GuestPortalLoginResponse {
        token,
        expires_at,
        guest,
    })
}

/// Resolve the guest id for a request bearing a valid, unexpired portal session
/// token in the `Authorization: Bearer <token>` header. Bumps last_used_at.
pub async fn require_guest_session(headers: &HeaderMap, pool: &DbPool) -> Result<i64, ApiError> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| ApiError::Unauthorized("Missing guest session token".to_string()))?;

    require_guest_session_token(token, pool).await
}

/// Resolve a guest session and apply the shared per-session read budget.
pub async fn require_guest_session_for_read(
    headers: &HeaderMap,
    pool: &DbPool,
    limiters: &RateLimiters,
) -> Result<i64, ApiError> {
    let guest_id = require_guest_session(headers, pool).await?;
    let (allowed, retry_after) = limiters
        .guest_portal_token_read
        .check_with_retry(format!("guest:{guest_id}"))
        .await;
    if allowed {
        Ok(guest_id)
    } else {
        Err(ApiError::TooManyRequestsRetryAfter(
            format!("Too many portal requests. Please try again in {retry_after} seconds."),
            retry_after,
        ))
    }
}

/// Revoke the current guest portal session.
pub async fn logout_guest_session(headers: &HeaderMap, pool: &DbPool) -> Result<(), ApiError> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| ApiError::Unauthorized("Missing guest session token".to_string()))?;
    let guest_id = require_guest_session_token(token, pool).await?;
    let token_hash = hash_session_token(token);
    GuestPortalSessionRepository::delete_session(pool, &token_hash).await?;
    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: None,
            action: "guest_portal.logout",
            resource_type: "guest",
            resource_id: Some(guest_id),
            details: None,
            ..Default::default()
        },
    )
    .await
}

/// Resolve a raw portal token for transports that cannot set an Authorization
/// header, such as the browser WebSocket API. The token is still supplied in a
/// header (`Sec-WebSocket-Protocol`), never in the URL.
pub async fn require_guest_session_token(token: &str, pool: &DbPool) -> Result<i64, ApiError> {
    let token_hash = hash_session_token(token);
    GuestPortalSessionRepository::touch_session_guest_id(pool, &token_hash)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("Invalid or expired guest session".to_string()))
}

/// GET /guest-portal/me
pub async fn get_me(pool: &DbPool, guest_id: i64) -> Result<GuestPortalMeResponse, ApiError> {
    let guest = GuestPortalSessionRepository::find_guest_view(pool, guest_id).await?;
    let completion = crate::services::profile::completion_for_guest(pool, guest_id).await?;
    Ok(GuestPortalMeResponse {
        guest,
        profile_complete: completion.complete,
        missing_profile_fields: completion
            .missing_fields
            .into_iter()
            .map(str::to_string)
            .collect(),
    })
}

/// GET /guest-portal/me/bookings
pub async fn get_my_bookings(
    pool: &DbPool,
    guest_id: i64,
    limit: i64,
    offset: i64,
    search: Option<&str>,
) -> Result<GuestPortalPage<GuestPortalBookingSummary>, ApiError> {
    let (mut items, total) =
        GuestPortalSessionRepository::list_bookings(pool, guest_id, limit, offset, search).await?;
    for booking in &mut items {
        if booking.cancellation_unavailable_reason.is_none() {
            booking.cancellation_unavailable_reason = if !matches!(
                booking.status.as_str(),
                "pending" | "pending_payment" | "pending_confirmation" | "confirmed"
            ) {
                Some("Only upcoming bookings can be cancelled online.".to_string())
            } else {
                None
            };
        }
        booking.can_cancel = booking.cancellation_unavailable_reason.is_none();
    }
    Ok(GuestPortalPage { items, total })
}

pub async fn cancel_my_booking(
    pool: &DbPool,
    guest_id: i64,
    booking_id: i64,
    reason: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let reason = reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if reason
        .as_ref()
        .is_some_and(|value| value.chars().count() > 1_000)
    {
        return Err(ApiError::BadRequest(
            "Cancellation reason must be 1,000 characters or fewer".to_string(),
        ));
    }
    let (items, _) = get_my_bookings(pool, guest_id, 10_000, 0, None)
        .await
        .map(|page| (page.items, page.total))?;
    let booking = items
        .into_iter()
        .find(|booking| booking.id == booking_id)
        .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;
    if !booking.can_cancel {
        return Err(ApiError::Conflict(
            booking
                .cancellation_unavailable_reason
                .unwrap_or_else(|| "This booking cannot be cancelled.".to_string()),
        ));
    }
    let user_id = GuestPortalSessionRepository::find_guest_user_id(pool, guest_id)
        .await?
        .ok_or_else(|| {
            ApiError::Forbidden("No active guest account is linked to this booking.".to_string())
        })?;
    crate::services::bookings::cancel_pending_booking_by_guest(pool, user_id, booking_id, reason)
        .await
}

/// GET /guest-portal/me/transactions
pub async fn get_my_transactions(
    pool: &DbPool,
    guest_id: i64,
    limit: i64,
    offset: i64,
) -> Result<GuestPortalPage<GuestPortalTransaction>, ApiError> {
    let (items, total) =
        GuestPortalSessionRepository::list_transactions(pool, guest_id, limit, offset).await?;
    Ok(GuestPortalPage { items, total })
}

/// GET /guest-portal/me/membership
pub async fn get_my_membership(
    pool: &DbPool,
    guest_id: i64,
) -> Result<GuestPortalMembershipResponse, ApiError> {
    let membership = GuestPortalSessionRepository::find_membership(pool, guest_id).await?;
    let recent_activity = if membership.is_some() {
        GuestPortalSessionRepository::recent_points_activity(pool, guest_id).await?
    } else {
        Vec::new()
    };
    Ok(GuestPortalMembershipResponse {
        membership,
        recent_activity,
    })
}

/// GET /guest-portal/me/benefits
pub async fn get_my_benefits(
    pool: &DbPool,
    guest_id: i64,
) -> Result<GuestPortalBenefitsResponse, ApiError> {
    let membership = GuestPortalSessionRepository::find_membership(pool, guest_id).await?;
    let (tier_benefits, points_balance) = match &membership {
        Some(m) => (
            GuestPortalSessionRepository::tier_benefits(pool, guest_id).await?,
            m.points_balance,
        ),
        None => (Vec::new(), 0),
    };
    let rewards = GuestPortalSessionRepository::rewards(pool, points_balance).await?;
    Ok(GuestPortalBenefitsResponse {
        tier_benefits,
        rewards,
    })
}

/// GET /guest-portal/me/credits
///
/// Complimentary-night credits the guest can redeem in the portal booking
/// funnel. `total_nights_available` is the sum across room types; credits are
/// not fungible between room types, so the per-room-type breakdown is what the
/// guest actually spends.
pub async fn get_my_credits(
    pool: &DbPool,
    guest_id: i64,
) -> Result<GuestPortalCreditsResponse, ApiError> {
    let credits_by_room_type =
        GuestPortalSessionRepository::complimentary_credits(pool, guest_id).await?;
    let total_nights_available = credits_by_room_type
        .iter()
        .map(|credit| credit.nights_available)
        .sum();
    Ok(GuestPortalCreditsResponse {
        total_nights_available,
        credits_by_room_type,
    })
}

// ---------------------------------------------------------------------------
// Guest-portal payment entry points (session- and token-authenticated)
// ---------------------------------------------------------------------------

/// Resolve a booking the authenticated guest owns, or a 404/403. Used by the
/// session (`/me/*`) payment routes where the booking id comes from the body.
async fn resolve_owned_booking(
    pool: &DbPool,
    guest_id: i64,
    booking_id: i64,
) -> Result<Booking, ApiError> {
    let booking = GuestPortalRepository::find_booking_by_id(pool, booking_id).await?;
    if booking.guest_id != guest_id {
        return Err(ApiError::Forbidden(
            "This booking does not belong to you.".to_string(),
        ));
    }
    Ok(booking)
}

pub async fn session_bank_transfer(
    pool: &DbPool,
    guest_id: i64,
    booking_id: i64,
) -> Result<crate::models::PaymentActionResponse, ApiError> {
    let booking = resolve_owned_booking(pool, guest_id, booking_id).await?;
    crate::services::payments::create_bank_transfer_claim(pool, &booking).await
}

pub async fn session_upload_payment_receipt(
    pool: &DbPool,
    guest_id: i64,
    payment_id: i64,
    bytes: &[u8],
) -> Result<(), ApiError> {
    let payment =
        crate::repositories::payment::PaymentRepository::get_payment_for_review(pool, payment_id)
            .await?
            .ok_or_else(|| ApiError::NotFound("Payment not found.".to_string()))?;
    if payment.guest_id != Some(guest_id) {
        return Err(ApiError::Forbidden(
            "This payment does not belong to you.".to_string(),
        ));
    }
    crate::services::payments::save_payment_receipt(pool, payment_id, bytes).await
}

pub async fn session_create_paypal_order(
    pool: &DbPool,
    guest_id: i64,
    booking_id: i64,
) -> Result<crate::models::PaypalCreateOrderResponse, ApiError> {
    let booking = resolve_owned_booking(pool, guest_id, booking_id).await?;
    crate::services::payments::create_paypal_order(pool, &booking).await
}

pub async fn session_capture_paypal(
    pool: &DbPool,
    guest_id: i64,
    booking_id: i64,
    order_id: &str,
    payment_id: i64,
) -> Result<crate::models::PaymentActionResponse, ApiError> {
    let booking = resolve_owned_booking(pool, guest_id, booking_id).await?;
    crate::services::payments::capture_paypal_payment(pool, &booking, order_id, payment_id).await
}

pub async fn token_bank_transfer(
    pool: &DbPool,
    token: &str,
) -> Result<crate::models::PaymentActionResponse, ApiError> {
    let booking = require_valid_token(pool, token).await?;
    crate::services::payments::create_bank_transfer_claim(pool, &booking).await
}

pub async fn token_upload_payment_receipt(
    pool: &DbPool,
    token: &str,
    payment_id: i64,
    bytes: &[u8],
) -> Result<(), ApiError> {
    let booking = require_valid_token(pool, token).await?;
    let payment =
        crate::repositories::payment::PaymentRepository::get_payment_for_review(pool, payment_id)
            .await?
            .ok_or_else(|| ApiError::NotFound("Payment not found.".to_string()))?;
    if payment.booking_id != booking.id {
        return Err(ApiError::Forbidden(
            "This payment does not belong to this booking.".to_string(),
        ));
    }
    crate::services::payments::save_payment_receipt(pool, payment_id, bytes).await
}

pub async fn token_create_paypal_order(
    pool: &DbPool,
    token: &str,
) -> Result<crate::models::PaypalCreateOrderResponse, ApiError> {
    let booking = require_valid_token(pool, token).await?;
    crate::services::payments::create_paypal_order(pool, &booking).await
}

pub async fn token_capture_paypal(
    pool: &DbPool,
    token: &str,
    order_id: &str,
    payment_id: i64,
) -> Result<crate::models::PaymentActionResponse, ApiError> {
    let booking = require_valid_token(pool, token).await?;
    crate::services::payments::capture_paypal_payment(pool, &booking, order_id, payment_id).await
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

    #[test]
    fn session_token_hash_is_deterministic_and_hides_the_raw_token() {
        let token = generate_session_token();
        // 256-bit token -> 64 hex chars.
        assert_eq!(token.len(), 64);

        let hash_a = hash_session_token(&token);
        let hash_b = hash_session_token(&token);
        // Same input hashes identically (needed for lookup by hash)...
        assert_eq!(hash_a, hash_b);
        // ...but a different token yields a different hash...
        assert_ne!(hash_a, hash_session_token(&generate_session_token()));
        // ...and the hash never contains the raw token.
        assert_eq!(hash_a.len(), 64);
        assert_ne!(hash_a, token);
    }

    #[test]
    fn page_query_clamps_page_and_per_page() {
        use crate::models::GuestPortalPageQuery;

        // Defaults: per_page 20, page 1 -> offset 0.
        let (limit, offset) = GuestPortalPageQuery {
            page: None,
            per_page: None,
            search: None,
        }
        .limit_offset();
        assert_eq!((limit, offset), (20, 0));

        // per_page capped at 100, page floored at 1.
        let (limit, offset) = GuestPortalPageQuery {
            page: Some(0),
            per_page: Some(500),
            search: None,
        }
        .limit_offset();
        assert_eq!((limit, offset), (100, 0));

        // per_page floored at 1 when non-positive.
        let (limit, _) = GuestPortalPageQuery {
            page: Some(3),
            per_page: Some(0),
            search: None,
        }
        .limit_offset();
        assert_eq!(limit, 1);

        // Offset is (page-1)*per_page.
        let (_, offset) = GuestPortalPageQuery {
            page: Some(3),
            per_page: Some(20),
            search: None,
        }
        .limit_offset();
        assert_eq!(offset, 40);
    }
}
