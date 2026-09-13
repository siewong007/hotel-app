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
    format!(
        "{CAPABILITY_TOKEN_HASH_PREFIX}{}",
        hex::encode(hasher.finalize())
    )
}

/// Reject anything that cannot be a freshly minted token before it reaches the
/// database. A persisted hash carries `:` and is therefore never accepted here.
pub(crate) fn is_well_formed_capability_token(presented: &str) -> bool {
    presented.len() == CAPABILITY_TOKEN_HEX_LEN && presented.bytes().all(|b| b.is_ascii_hexdigit())
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

    // A consumed row is deliberately still returned: a duplicate submission has
    // to resolve to the payment it already produced. An unconsumed one must
    // still be live.
    if !capability.is_consumed() && !capability.is_spendable_at(Utc::now()) {
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

/// Booking states that may still accept a replacement payment by email.
///
/// This is deliberately not its own list. `create_bank_transfer_claim` refuses
/// anything outside `BOOKING_STATUSES_AWAITING_PAYMENT`, so inviting a payment
/// for a wider set would show the guest a button that always fails -- which is
/// exactly what an earlier version of this did for `confirmed` bookings.
use crate::services::payments::BOOKING_STATUSES_AWAITING_PAYMENT as RECOVERABLE_BOOKING_STATUSES;

/// Payment states that mean the booking is already settled.
///
/// `paid_rate` counts as settled: the room rate is covered, so prompting for
/// it again would take money twice. The spec is explicit that an already-paid
/// booking is never prompted to repay.
const SETTLED_PAYMENT_STATUSES: [&str; 4] = ["paid", "paid_rate", "refunded", "void"];

/// Whether a booking in this state should be offered a recovery link at all.
pub fn is_recoverable(booking_status: &str, payment_status: &str) -> bool {
    RECOVERABLE_BOOKING_STATUSES.contains(&booking_status)
        && !SETTLED_PAYMENT_STATUSES.contains(&payment_status)
}

/// A live recovery link and when it dies.
pub struct RecoveryLink {
    pub url: String,
    pub expires_at: DateTime<Utc>,
}

/// Booking facts the recovery decision needs.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RecoveryContext {
    pub status: String,
    pub payment_status: String,
    pub created_at: DateTime<Utc>,
}

/// Issue (or reuse) a recovery link for a booking whose payment was rejected.
///
/// Returns `None` -- meaning "send the mail, but do not offer self-service
/// repayment" -- whenever the booking is settled or past the point where an
/// emailed payment makes sense. That is the safe direction: the guest still
/// hears that the payment failed, they just get the hotel's contact details
/// instead of a pay button.
///
/// An unconsumed, unexpired capability is reused rather than replaced, so a
/// second rejection on the same booking cannot leave two live links for the
/// same reservation.
pub async fn issue_recovery_link(
    pool: &DbPool,
    booking_id: i64,
    payment_id: i64,
) -> Result<Option<RecoveryLink>, ApiError> {
    let sql = format!(
        "SELECT status, payment_status, created_at FROM bookings WHERE id = {}",
        crate::param!(1)
    );
    let context: Option<RecoveryContext> = sqlx::query_as(sqlx::AssertSqlSafe(&*sql))
        .bind(booking_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Recovery context lookup failed: {}", e)))?;

    let Some(context) = context else {
        return Ok(None);
    };
    if !is_recoverable(&context.status, &context.payment_status) {
        return Ok(None);
    }

    // Reuse a link that is still good rather than minting a rival one.
    if let Some(existing) = PaymentRetryRepository::find_live_for_booking(pool, booking_id)
        .await?
        .into_iter()
        .next()
    {
        // The raw token is unrecoverable by design, so a live capability can be
        // detected but not re-linked. Retire it and mint a fresh one, keeping
        // exactly one live capability per booking.
        PaymentRetryRepository::expire(pool, existing.id).await?;
    }

    let hold_deadline = hold_deadline_for(pool, context.created_at).await;
    let (capability, token) =
        issue_capability(pool, booking_id, Some(payment_id), hold_deadline).await?;
    Ok(Some(RecoveryLink {
        url: crate::modules::communications::email_layout::absolute_url(&format!(
            "/booking/recover-payment/{token}"
        )),
        expires_at: capability.expires_at,
    }))
}

/// When this booking's unpaid hold lapses, if auto-release is switched on.
async fn hold_deadline_for(pool: &DbPool, created_at: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let raw =
        crate::modules::settings::service::get_setting_value(pool, "unpaid_hold_release_hours")
            .await
            .ok()?;
    let hours: i64 = raw.trim().parse().ok().filter(|hours| *hours > 0)?;
    Some(created_at + Duration::hours(hours))
}

/// Describe what the recovery page may show for this token.
///
/// Read-only on purpose: this must never consume the capability, or a security
/// appliance that pre-fetches links in scanned mail would spend the guest's one
/// attempt before they saw the page.
pub async fn describe_recovery(
    pool: &DbPool,
    presented: &str,
) -> Result<crate::handlers::payment_retry::PaymentRecoveryView, ApiError> {
    let capability = resolve_capability(pool, presented).await?;
    let booking = crate::services::booking::fetch_booking_by_id(pool, capability.booking_id)
        .await
        .map_err(|_| unavailable())?;

    // The booking may have moved on since the mail was sent -- paid at the
    // desk, cancelled, released. The link is not an entitlement to pay.
    if !capability.is_consumed()
        && !is_recoverable(
            &booking.status,
            booking.payment_status.as_deref().unwrap_or("unpaid"),
        )
    {
        return Err(unavailable());
    }

    // Ask the payment itself whether it still wants evidence. A page that
    // guessed from its own state would offer an upload after a PayPal capture,
    // which the server then refuses -- a control that exists only to fail.
    let receipt_uploadable = match capability.replacement_payment_id {
        Some(payment_id) => {
            crate::repositories::payment::PaymentRepository::get_payment_for_review(
                pool, payment_id,
            )
            .await?
            .is_some_and(|payment| {
                payment.payment_method == "bank_transfer" && payment.status == "pending"
            })
        }
        None => false,
    };

    // Only advertise what the deployment can actually take. Offering PayPal on
    // a hotel with no PayPal credentials would give the guest a button that
    // fails at the gateway.
    let mut methods = vec!["bank_transfer".to_string()];
    if crate::services::paypal_client::is_enabled() {
        methods.push("paypal".to_string());
    }

    Ok(crate::handlers::payment_retry::PaymentRecoveryView {
        booking_number: booking.booking_number.clone(),
        amount_due: booking.total_amount.to_string(),
        currency: booking
            .currency
            .clone()
            .unwrap_or_else(|| "MYR".to_string()),
        expires_at: capability.expires_at,
        payment_methods: methods,
        payment_id: capability.replacement_payment_id,
        receipt_uploadable,
        paypal_client_id: crate::core::config::get().paypal.public_client_id(),
        already_submitted: capability.is_consumed(),
    })
}

/// Raise a bank-transfer claim against the booking named by this capability.
///
/// A second submission does not create a second payment: a spent capability
/// resolves to the payment it already produced. The authoritative guards live
/// in `create_bank_transfer_claim_for_capability`, which consumes the
/// capability inside the same transaction as the insert.
pub async fn recover_with_bank_transfer(
    pool: &DbPool,
    presented: &str,
) -> Result<crate::models::PaymentActionResponse, ApiError> {
    let capability = resolve_capability(pool, presented).await?;

    if let Some(existing) = capability.replacement_payment_id {
        return Ok(crate::models::PaymentActionResponse {
            payment_id: existing,
            status: "pending".to_string(),
            booking_status: Some("pending_confirmation".to_string()),
        });
    }

    let booking = crate::services::booking::fetch_booking_by_id(pool, capability.booking_id)
        .await
        .map_err(|_| unavailable())?;
    crate::services::payments::create_bank_transfer_claim_for_capability(
        pool,
        &booking,
        capability.id,
    )
    .await
}

/// Create a PayPal order against the booking named by this capability.
///
/// A duplicate submission does not authorise a second order: a spent capability
/// resolves to the payment it already produced, and that payment's existing
/// order id is returned so the guest finishes the order they already have.
pub async fn recover_with_paypal(
    pool: &DbPool,
    presented: &str,
) -> Result<crate::models::PaypalCreateOrderResponse, ApiError> {
    let capability = resolve_capability(pool, presented).await?;

    if let Some(existing) = capability.replacement_payment_id {
        // Resume rather than authorise again: the guest may simply have
        // reloaded between approving in PayPal's window and coming back.
        let order_id =
            crate::repositories::payment::PaymentRepository::find_gateway_order_id(pool, existing)
                .await?
                .ok_or_else(|| {
                    ApiError::Conflict(
                        "A payment is already in progress for this booking.".to_string(),
                    )
                })?;
        return Ok(crate::models::PaypalCreateOrderResponse {
            order_id,
            payment_id: existing,
        });
    }

    let booking = crate::services::booking::fetch_booking_by_id(pool, capability.booking_id)
        .await
        .map_err(|_| unavailable())?;
    crate::services::payments::create_paypal_order_for_capability(pool, &booking, capability.id)
        .await
}

/// Capture the PayPal order this capability authorised.
///
/// Deliberately works on a *spent* capability. Creating the order consumes the
/// link, but the guest still has to approve it in PayPal's window and come
/// back; refusing a consumed capability here would strand every PayPal payment
/// between authorisation and capture. Scope is kept by requiring the payment to
/// be the one this capability actually produced, so a spent link cannot be
/// pointed at any other payment.
pub async fn capture_recovered_paypal(
    pool: &DbPool,
    presented: &str,
    order_id: &str,
    payment_id: i64,
) -> Result<crate::models::PaymentActionResponse, ApiError> {
    let capability = resolve_capability(pool, presented).await?;
    if capability.replacement_payment_id != Some(payment_id) {
        return Err(ApiError::Forbidden(
            "This payment link does not authorise that payment.".to_string(),
        ));
    }

    let booking = crate::services::booking::fetch_booking_by_id(pool, capability.booking_id)
        .await
        .map_err(|_| unavailable())?;
    crate::services::payments::capture_paypal_payment(pool, &booking, order_id, payment_id).await
}

/// Attach payment evidence to the claim this capability raised.
///
/// Scoped to the payment the capability produced, so the link cannot be used to
/// attach a file to anybody else's payment. It grants nothing beyond that: no
/// pre-check-in, no profile, no other booking. The size, file-type and
/// payment-state checks are `save_payment_receipt`'s and are unchanged --
/// evidence is still only accepted for a pending bank-transfer claim.
pub async fn upload_recovered_receipt(
    pool: &DbPool,
    presented: &str,
    payment_id: i64,
    bytes: &[u8],
) -> Result<(), ApiError> {
    let capability = resolve_capability(pool, presented).await?;
    if capability.replacement_payment_id != Some(payment_id) {
        return Err(ApiError::Forbidden(
            "This payment link does not authorise that payment.".to_string(),
        ));
    }
    crate::services::payments::save_payment_receipt(pool, payment_id, bytes).await
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
    fn a_settled_booking_is_never_offered_a_repayment_link() {
        // Taking money twice is the failure that matters here, so every settled
        // shape is checked rather than just "paid".
        for settled in ["paid", "paid_rate", "refunded", "void"] {
            assert!(
                !is_recoverable("pending_payment", settled),
                "{settled} must not be offered repayment"
            );
        }
        assert!(is_recoverable("pending_payment", "unpaid"));
        assert!(is_recoverable("pending_payment", "partial"));
        assert!(is_recoverable("pending", "unpaid_deposit"));
    }

    #[test]
    fn an_in_house_or_departed_booking_is_not_offered_a_link() {
        for status in [
            "checked_in",
            "auto_checked_in",
            "checked_out",
            "completed",
            "no_show",
            "voided",
            "comp_void",
            // Not awaiting payment either: the payment layer refuses these, so
            // offering a button for them would always fail.
            "confirmed",
            "pending_confirmation",
        ] {
            assert!(
                !is_recoverable(status, "unpaid"),
                "{status} is settled at the desk, not by email"
            );
        }
    }

    #[test]
    fn a_lapsed_hold_yields_an_expiry_that_is_not_in_the_future() {
        let now = Utc::now();
        let lapsed = now - Duration::minutes(5);
        assert!(capability_expiry_at(now, Some(lapsed)) <= now);
    }
}
