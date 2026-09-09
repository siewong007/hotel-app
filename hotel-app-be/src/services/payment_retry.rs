//! Minting and resolving emailed payment-retry capabilities.
//!
//! Scope is deliberately narrow. This capability authorises exactly one thing --
//! replacing one rejected payment on one booking -- and it is kept separate from
//! the booking-access token so recovering a payment never widens into
//! pre-check-in or profile access.
//!
//! Token handling mirrors the booking-access scheme: a 256-bit random hex token
//! goes in the mail, and only its prefixed SHA-256 is persisted. The prefix
//! means a stolen database value cannot be replayed as a URL token, because the
//! shape check below rejects anything containing `:`.

use chrono::{DateTime, Duration, Utc};
use sha2::{Digest, Sha256};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::payment_retry::PaymentRetryCapability;
use crate::repositories::payment_retry::PaymentRetryRepository;

/// How long a freshly issued recovery link stays usable.
pub const RETRY_CAPABILITY_TTL_MINUTES: i64 = 60;

const CAPABILITY_TOKEN_HASH_PREFIX: &str = "sha256:";

/// Raw token length: 32 random bytes rendered as hex.
const CAPABILITY_TOKEN_HEX_LEN: usize = 64;

/// Generate the token that travels in the email. Never persisted as-is.
pub(crate) fn generate_capability_token() -> String {
    crate::services::guest_portal::generate_session_token()
}

/// Value stored in `payment_retry_capabilities.token_hash`.
pub(crate) fn persist_capability_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{CAPABILITY_TOKEN_HASH_PREFIX}{}", hex::encode(hasher.finalize()))
}

/// Reject anything that cannot be a freshly minted token before it reaches the
/// database. A persisted hash carries `:` and is therefore never accepted here.
pub(crate) fn is_well_formed_capability_token(presented: &str) -> bool {
    presented.len() == CAPABILITY_TOKEN_HEX_LEN
        && presented.bytes().all(|b| b.is_ascii_hexdigit())
}

/// When a capability issued now should expire.
///
/// The link is useless once the booking's unpaid hold has lapsed -- the room is
/// released and a replacement payment would be collecting for a reservation
/// that no longer exists -- so the hold deadline caps the TTL whenever it lands
/// first. A deadline already in the past yields an already-expired capability,
/// which the caller should treat as "do not send a recovery link at all".
pub fn capability_expiry_at(
    issued_at: DateTime<Utc>,
    hold_deadline: Option<DateTime<Utc>>,
) -> DateTime<Utc> {
    let ttl_expiry = issued_at + Duration::minutes(RETRY_CAPABILITY_TTL_MINUTES);
    match hold_deadline {
        Some(deadline) if deadline < ttl_expiry => deadline,
        _ => ttl_expiry,
    }
}

/// Mint a capability for one rejected payment and persist its hash.
///
/// Returns the stored row together with the raw token, which the caller must
/// use only to render the link and must never log or persist.
pub async fn issue_capability(
    pool: &DbPool,
    booking_id: i64,
    payment_id: Option<i64>,
    hold_deadline: Option<DateTime<Utc>>,
) -> Result<(PaymentRetryCapability, String), ApiError> {
    let issued_at = Utc::now();
    let expires_at = capability_expiry_at(issued_at, hold_deadline);
    if expires_at <= issued_at {
        return Err(ApiError::BadRequest(
            "The booking hold has already lapsed, so no recovery link can be issued.".to_string(),
        ));
    }

    let token = generate_capability_token();
    let token_hash = persist_capability_token(&token);
    let capability =
        PaymentRetryRepository::create(pool, booking_id, payment_id, &token_hash, expires_at)
            .await?;
    Ok((capability, token))
}

/// Resolve a presented token to its capability row.
///
/// Every failure -- malformed, unknown, expired -- returns the same generic
/// error, so the endpoint cannot be used to probe which tokens ever existed.
/// A consumed row is returned rather than rejected: the caller needs it to make
/// a duplicate submission resolve to the payment that already exists.
pub async fn resolve_capability(
    pool: &DbPool,
    presented: &str,
) -> Result<PaymentRetryCapability, ApiError> {
    if !is_well_formed_capability_token(presented) {
        return Err(unavailable());
    }
    let token_hash = persist_capability_token(presented);
    let capability = PaymentRetryRepository::find_by_token_hash(pool, &token_hash)
        .await?
        .ok_or_else(unavailable)?;

    if capability.is_expired_at(Utc::now()) && !capability.is_consumed() {
        return Err(unavailable());
    }
    Ok(capability)
}

/// The single message every unusable link gets. Deliberately says nothing about
/// which of the failure modes applied.
fn unavailable() -> ApiError {
    ApiError::NotFound(
        "This payment link is no longer available. Please contact the hotel to complete your booking."
            .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minted_tokens_are_hex_and_hash_to_a_prefixed_digest() {
        let token = generate_capability_token();
        assert!(is_well_formed_capability_token(&token));
        let hash = persist_capability_token(&token);
        assert!(hash.starts_with(CAPABILITY_TOKEN_HASH_PREFIX));
        assert_ne!(hash, token, "the raw token must never be the stored value");
        assert_eq!(hash, persist_capability_token(&token), "hashing is stable");
    }

    #[test]
    fn a_persisted_hash_is_not_accepted_as_a_presented_token() {
        // The stored value contains ':', so replaying a database dump as a URL
        // token fails the shape check before any lookup happens.
        let stored = persist_capability_token(&generate_capability_token());
        assert!(!is_well_formed_capability_token(&stored));
    }

    #[test]
    fn distinct_tokens_hash_distinctly() {
        let a = persist_capability_token("a");
        let b = persist_capability_token("b");
        assert_ne!(a, b);
    }

    #[test]
    fn the_hold_deadline_caps_the_ttl_but_never_extends_it() {
        let now = Utc::now();
        let full = now + Duration::minutes(RETRY_CAPABILITY_TTL_MINUTES);

        // No hold: the plain TTL applies.
        assert_eq!(capability_expiry_at(now, None), full);

        // Hold lands first: it wins.
        let early = now + Duration::minutes(10);
        assert_eq!(capability_expiry_at(now, Some(early)), early);

        // Hold lands later: the TTL still wins, so a distant hold cannot
        // stretch a recovery link beyond an hour.
        let late = now + Duration::hours(30);
        assert_eq!(capability_expiry_at(now, Some(late)), full);
    }

    #[test]
    fn a_lapsed_hold_yields_an_expiry_that_is_not_in_the_future() {
        let now = Utc::now();
        let lapsed = now - Duration::minutes(5);
        assert!(capability_expiry_at(now, Some(lapsed)) <= now);
    }
}
