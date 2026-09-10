//! Guest portal workflows

use axum::http::HeaderMap;
use chrono::{Duration, Utc};
use rand::RngExt;
use regex::Regex;
use sha2::{Digest, Sha256};

use crate::core::auth::AuthService;
use crate::core::db::{DbPool, hotel_today};
use crate::core::error::ApiError;
use crate::core::rate_limiter::RateLimiters;
use crate::models::AuditEvent;
use crate::models::{
    Booking, GuestPortalBenefitsResponse, GuestPortalBookingResponse, GuestPortalBookingSummary,
    GuestPortalClaimAccountRequest, GuestPortalClaimAccountResponse, GuestPortalCreditsResponse,
    GuestPortalLoginResponse, GuestPortalMeResponse, GuestPortalMembershipResponse,
    GuestPortalPage, GuestPortalTransaction, GuestPortalVerifyRequest, GuestPortalVerifyResponse,
    PreCheckInUpdateRequest,
};
use crate::modules::communications::service as communications_service;
use crate::modules::consent::models::{ConsentDocument, ConsentSource};
use crate::modules::consent::service::{self as consent_service, ConsentContext, ConsentSubject};
use crate::modules::consent::validation as consent_validation;
use crate::repositories::auth::{AuthRepository, ClaimGuestAccountValues};
use crate::repositories::guest_portal::GuestPortalRepository;
use crate::repositories::guest_portal_session::GuestPortalSessionRepository;
use crate::services::audit::AuditLog;
use crate::services::auto_checkin;
use crate::utils::sanitization::Sanitizer;
use validator::Validate;

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

const BOOKING_ACCESS_TOKEN_HASH_PREFIX: &str = "sha256:";

/// Value stored in `bookings.pre_checkin_token` for a newly issued token.
///
/// Prefixed so a database dump of the column cannot be replayed as the URL
/// token: the HTTP shape-check rejects `:`, and lookup never treats a prefixed
/// row as legacy plaintext.
pub(crate) fn persist_booking_access_token(token: &str) -> String {
    format!(
        "{BOOKING_ACCESS_TOKEN_HASH_PREFIX}{}",
        hash_session_token(token)
    )
}

/// Whether `presented` (the URL/header token) authenticates against `stored`
/// (`bookings.pre_checkin_token`). Hashed rows match the prefixed SHA-256;
/// pre-cutover plaintext rows still match the raw token.
pub(crate) fn booking_access_token_matches(presented: &str, stored: &str) -> bool {
    if stored.starts_with(BOOKING_ACCESS_TOKEN_HASH_PREFIX) {
        stored == persist_booking_access_token(presented)
    } else {
        stored == presented
    }
}

const VERIFY_BOOKING_FAILURE: &str =
    "Unable to verify booking details. Please check the booking number and name.";

fn verify_booking_failure() -> ApiError {
    ApiError::Unauthorized(VERIFY_BOOKING_FAILURE.to_string())
}

fn normalize_person_name(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn guest_name_matches(stored_nick_name: &str, requested_name: &str) -> bool {
    let requested = normalize_person_name(requested_name);
    if requested.is_empty() {
        return false;
    }
    normalize_person_name(stored_nick_name) == requested
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
    if !guest_name_matches(&guest.nick_name, &request.name) {
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

/// Mint a fresh booking access token so an outbound email can deep-link into
/// the pre-check-in wizard, or `None` if it could not be issued.
///
/// **This rotates the booking's token**: `bookings.pre_checkin_token` holds one
/// hashed value, so a link in an older email stops working the moment a newer
/// one is sent. That is the only option available — the stored value is a hash
/// and cannot be turned back into a URL — so the rule is that the most recent
/// email is the live one. The expiry is the same `anonymous_access_token_expiry`
/// the booking flow uses, which always reaches past the stay, so rotating never
/// shortens the window a guest has to pay.
///
/// Returns `None` rather than an error on failure: an email must still go out
/// with a lookup-page link if token issuance fails.
pub async fn issue_booking_access_token(
    pool: &DbPool,
    booking_id: i64,
    check_in_date: chrono::NaiveDate,
) -> Option<String> {
    let token = generate_session_token();
    let expires_at = crate::modules::guest_booking::service::anonymous_access_token_expiry(
        Utc::now(),
        check_in_date,
    );
    match GuestPortalRepository::update_precheckin_token(pool, booking_id, &token, expires_at).await
    {
        Ok(()) => Some(token),
        Err(error) => {
            log::error!("Failed to issue booking access token for booking {booking_id}: {error}");
            None
        }
    }
}

/// Whether this guest can sign in to the portal.
///
/// Callers use it to decide between a portal link and a booking-token deep
/// link: a guest with no account cannot use `/portal` at all, so sending them
/// there is a dead end.
pub async fn guest_has_portal_account(pool: &DbPool, guest_id: i64) -> bool {
    match GuestPortalSessionRepository::find_guest_user_id(pool, guest_id).await {
        Ok(account) => account.is_some(),
        Err(error) => {
            log::error!("Failed to resolve portal account for guest {guest_id}: {error}");
            // Assume an account exists: the fallback is the portal link, which
            // is merely unhelpful, where a wrongly-minted token would rotate a
            // live one out from under the guest.
            true
        }
    }
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

/// Create a portal account for the guest of a token-authenticated booking.
///
/// This is the only path that can give a booked guest a login. `auth::register`
/// always inserts a new `guests` row and refuses when one already carries that
/// name, so the guest a booking created can never register as themselves. The
/// account minted here is bound to `bookings.guest_id`, which is what later
/// lets eKYC (keyed on `users.id`, resolved back through `guest_id`) and
/// `auto_checkin_for_guest_portal` see the same guest as the booking.
///
/// Claimable exactly once: an account that already has a password ends the
/// path with a conflict, so a forwarded link cannot take over an account that
/// is already in use. The booking token itself stays valid until it expires —
/// revoking it here would also kill the guest's own payment and receipt links,
/// which ride the same token.
pub async fn claim_booking_account(
    pool: &DbPool,
    token: &str,
    mut request: GuestPortalClaimAccountRequest,
    consent_context: &ConsentContext,
) -> Result<GuestPortalClaimAccountResponse, ApiError> {
    let booking = require_valid_token(pool, token).await?;
    let guest = GuestPortalRepository::find_guest(pool, booking.guest_id).await?;

    // The token proves possession of the booking link; these prove the holder
    // knows what is on the booking. Same generic failure as `verify_guest_booking`
    // so a probe cannot learn which half was wrong.
    let booking_number_matches = request
        .booking_number
        .trim()
        .eq_ignore_ascii_case(booking.booking_number.trim());
    if !booking_number_matches || !guest_name_matches(&guest.nick_name, &request.guest_name) {
        return Err(verify_booking_failure());
    }

    request.email = request
        .email
        .take()
        .map(|email| Sanitizer::sanitize_email(&email))
        .filter(|email| !email.is_empty());
    request.username = request.username.trim().to_string();
    request
        .validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    AuthService::validate_password(&request.password).map_err(ApiError::BadRequest)?;

    // Consent is checked before any row is written, matching `auth::register`:
    // there must be no path that creates an account without provable consent.
    consent_validation::validate_locales(&request.consents)?;
    consent_validation::require_consents(
        &request.consents,
        consent_validation::REGISTRATION_REQUIRED,
    )?;

    if AuthRepository::username_or_email_exists(pool, &request.username, request.email.as_deref())
        .await?
    {
        return Err(ApiError::BadRequest(
            "Username or email already exists".to_string(),
        ));
    }

    let password_hash = AuthService::hash_password(&request.password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    // Mirrors registration: `users.email` is NOT NULL, so an account without a
    // real address gets a reserved, non-deliverable one and skips verification
    // rather than being blocked from logging in forever.
    let account_email = request
        .email
        .clone()
        .unwrap_or_else(|| format!("{}@no-email.invalid", request.username));
    let email_verification_required = request.email.is_some();

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    AuthRepository::lock_guest_for_claim(&mut tx, booking.guest_id).await?;

    let existing = AuthRepository::find_guest_account(&mut tx, booking.guest_id).await?;
    let existing_user_id = match existing {
        Some(account) if account.is_deleted || (account.has_password && !account.is_active) => {
            return Err(ApiError::Conflict(
                "This guest profile has a disabled account. Please contact the front desk."
                    .to_string(),
            ));
        }
        // Deliberately does NOT echo the existing username: the caller proved
        // they hold the booking link and know the booking details, which is not
        // the same as being the account owner.
        Some(account) if account.has_password => {
            return Err(ApiError::Conflict(
                "An account already exists for this booking. Please sign in, or use \
                 'forgot password' if you cannot get in."
                    .to_string(),
            ));
        }
        // A login-disabled anchor from front-desk eKYC: upgrade it in place.
        Some(account) => Some(account.id),
        None => None,
    };

    let user = AuthRepository::claim_guest_account(
        &mut tx,
        ClaimGuestAccountValues {
            existing_user_id,
            guest_id: booking.guest_id,
            username: &request.username,
            email: &account_email,
            password_hash: &password_hash,
            full_name: Some(guest.nick_name.as_str()),
            phone: guest.phone.as_deref(),
            is_verified: !email_verification_required,
        },
    )
    .await?;

    consent_service::record_tx(
        &mut tx,
        ConsentSubject::user(user.id).with_guest(booking.guest_id),
        &request.consents,
        ConsentSource::Registration,
        consent_context,
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;

    // Post-commit and best-effort, exactly as registration does it: neither a
    // marketing-ledger write nor a verification mail may undo an account the
    // guest has already been told they have.
    communications_service::record_signup_marketing_consent(
        pool,
        booking.guest_id,
        request.marketing_opt_in,
        "guest_portal_claim",
        Some(ConsentDocument::PrivacyNotice.current_version()),
        consent_context.ip_address.clone(),
        consent_context.user_agent.clone(),
    )
    .await?;

    if email_verification_required {
        crate::services::account_emails::try_send_email_verification(pool, user.id).await;
    }

    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user.id),
            action: "guest_portal.account_claimed",
            resource_type: "booking",
            resource_id: Some(booking.id),
            details: Some(serde_json::json!({
                "guest_id": booking.guest_id,
                "user_id": user.id,
                "upgraded_anchor_account": existing_user_id.is_some(),
            })),
            ip_address: consent_context.ip_address.clone(),
            user_agent: consent_context.user_agent.clone(),
        },
    )
    .await?;

    let session = create_authenticated_guest_portal_session(
        pool,
        user.id,
        consent_context.ip_address.clone(),
        consent_context.user_agent.clone(),
    )
    .await?;

    Ok(GuestPortalClaimAccountResponse {
        session,
        username: user.username,
        email_verification_required,
    })
}

async fn require_valid_token(pool: &DbPool, token: &str) -> Result<Booking, ApiError> {
    let booking = GuestPortalRepository::find_booking_by_token(pool, token)
        .await?
        .ok_or_else(|| ApiError::NotFound("Invalid or expired token".to_string()))?;
    let stored = booking.pre_checkin_token.as_deref().unwrap_or("");
    if !booking_access_token_matches(token, stored) {
        return Err(ApiError::NotFound("Invalid or expired token".to_string()));
    }

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

    let (receipt_request_payment_id, receipt_request_message, receipt_uploaded) =
        GuestPortalRepository::find_booking_receipt_request(pool, booking.id).await?;

    Ok(GuestPortalBookingResponse {
        booking: booking.into(),
        guest: guest.into(),
        ekyc_summary,
        receipt_request_payment_id,
        receipt_request_message,
        receipt_uploaded,
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
    fn guest_name_match_allows_case_and_whitespace_differences() {
        assert!(guest_name_matches(" John   Wong ", "john wong"));
        assert!(guest_name_matches("Deeplink Retest", " deeplink  retest "));
    }

    #[test]
    fn guest_name_match_rejects_empty_or_different_name() {
        assert!(!guest_name_matches("John Wong", ""));
        assert!(!guest_name_matches("John Wong", "Jane Wong"));
        assert!(!guest_name_matches("John Wong", "John"));
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
    fn booking_access_token_is_persisted_as_prefixed_hash() {
        let token = generate_session_token();
        let stored = persist_booking_access_token(&token);
        assert!(
            stored.starts_with("sha256:"),
            "stored value must be distinguishable from a 64-hex token, got {stored}"
        );
        assert_eq!(stored.len(), "sha256:".len() + 64);
        assert_ne!(stored, token);
        assert!(
            !stored.contains(&token),
            "raw token must not appear in the stored hash"
        );
    }

    #[test]
    fn presented_booking_token_matches_its_persisted_hash() {
        let token = generate_session_token();
        let stored = persist_booking_access_token(&token);
        assert!(booking_access_token_matches(&token, &stored));
        assert!(!booking_access_token_matches(
            &generate_session_token(),
            &stored
        ));
    }

    #[test]
    fn presented_booking_token_still_matches_legacy_plaintext_rows() {
        let token = generate_session_token();
        assert!(booking_access_token_matches(&token, &token));
    }

    #[test]
    fn dumped_persisted_hash_cannot_be_replayed_as_the_token() {
        let token = generate_session_token();
        let stored = persist_booking_access_token(&token);
        // An attacker who copies pre_checkin_token out of the database and
        // submits that value as the URL token must not authenticate. Dual-read
        // of hash-then-plaintext would otherwise treat the stored hash as a
        // legacy plaintext row.
        assert!(!booking_access_token_matches(&stored, &stored));
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
