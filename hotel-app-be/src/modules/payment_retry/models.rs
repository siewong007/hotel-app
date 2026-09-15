//! Payment retry capability: the persisted half of an emailed recovery link.
//!
//! A rejected payment on an anonymous booking leaves the guest with no account
//! to log back into, so recovery has to travel in the outcome email. This is
//! the row behind that link: it names one booking and one rejected payment,
//! expires, and can be spent at most once.
//!
//! The raw token never appears here. Only its hash is persisted, so nothing
//! reachable from this struct can reconstruct a working link.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentRetryCapability {
    pub id: i64,
    pub booking_id: i64,
    /// The rejected payment this capability offers to replace. Nullable because
    /// the payment row may later be removed while the booking survives.
    pub payment_id: Option<i64>,
    pub expires_at: DateTime<Utc>,
    /// Set only when a replacement payment is created -- never on a mere view,
    /// so a link-following email scanner cannot exhaust the guest's one attempt.
    pub consumed_at: Option<DateTime<Utc>>,
    /// The payment created when this capability was spent. A duplicate
    /// submission resolves to this instead of creating a second payment.
    pub replacement_payment_id: Option<i64>,
    pub created_at: DateTime<Utc>,
}

impl PaymentRetryCapability {
    /// Expiry is exclusive: a capability is dead at its own `expires_at`.
    pub fn is_expired_at(&self, now: DateTime<Utc>) -> bool {
        self.expires_at <= now
    }

    pub fn is_consumed(&self) -> bool {
        self.consumed_at.is_some()
    }

    /// Whether the capability may still be spent. Callers must still apply the
    /// booking-status and duplicate-payment guards, which stay authoritative.
    pub fn is_spendable_at(&self, now: DateTime<Utc>) -> bool {
        !self.is_consumed() && !self.is_expired_at(now)
    }
}
