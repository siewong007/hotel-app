//! Settlement lock for online (OTA / direct-website) bookings.
//!
//! A booking taken through an online channel is settled by that channel: an
//! OTA collects the room charge itself, and the direct website collects it by
//! bank transfer or PayPal. The front desk must not record that room charge
//! under any other tender (cash, card, a different OTA), and the room money
//! can never be "refunded" into another method.
//!
//! The lock applies to `payment_type = 'booking'` rows only. The keycard
//! security deposit (`deposit`) and folio extras (`service`, `damage`) stay
//! open to any desk tender; a deposit refund on a locked booking must go back
//! through the tender the deposit was collected with.
//!
//! The allowed tenders per channel live on
//! `booking_channels.settlement_payment_methods` (patch 0023). Matching is
//! case- and punctuation-insensitive so legacy spellings (`Booking.Com`,
//! `bank_transfer`, `Paypal`) still match.

use crate::core::error::ApiError;

/// Tenders a direct-website booking settles with when it carries no channel
/// row (or its channel has no configured list).
pub const WEBSITE_DEFAULT_METHODS: [&str; 2] = ["Bank Transfer", "PayPal"];

/// Booking + channel facts the lock is decided from.
#[derive(Debug, Clone, Default, sqlx::FromRow)]
pub struct SettlementLockRow {
    pub source: Option<String>,
    pub channel_name: Option<String>,
    pub channel_type: Option<String>,
    pub settlement_payment_methods: Option<Vec<String>>,
}

/// Outcome of the lock decision for one booking.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettlementLock {
    /// Not an online booking: any tender is accepted.
    Unlocked,
    /// Room charge must use one of `allowed` (display spellings).
    Locked {
        platform: String,
        allowed: Vec<String>,
    },
    /// Online booking without a channel: no room-charge payment until staff
    /// set the booking channel.
    MissingChannel,
    /// Online channel with no settlement tender configured.
    Unconfigured { platform: String },
}

/// Lower-case, drop everything but letters/digits, and drop a trailing
/// `com` so a platform's domain spelling matches its plain name:
/// `Booking.Com` → `booking`, `Traveloka.Com` → `traveloka`,
/// `bank_transfer` → `banktransfer`.
pub fn normalize_method(method: &str) -> String {
    let compact: String = method
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    match compact.strip_suffix("com") {
        Some(stem) if !stem.is_empty() => stem.to_string(),
        _ => compact,
    }
}

pub fn methods_match(a: &str, b: &str) -> bool {
    let a = normalize_method(a);
    !a.is_empty() && a == normalize_method(b)
}

fn eq_token(value: Option<&str>, token: &str) -> bool {
    value.is_some_and(|v| v.trim().eq_ignore_ascii_case(token))
}

impl SettlementLockRow {
    pub fn decide(&self) -> SettlementLock {
        let source = self.source.as_deref();
        let channel_type = self.channel_type.as_deref();
        let source_online = eq_token(source, "online");
        let source_website = eq_token(source, "website");
        let channel_ota = eq_token(channel_type, "ota");
        let channel_website = eq_token(channel_type, "website");

        if !(source_online || source_website || channel_ota || channel_website) {
            return SettlementLock::Unlocked;
        }

        let configured: Vec<String> = self
            .settlement_payment_methods
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|m| m.trim().to_string())
            .filter(|m| !m.is_empty())
            .collect();

        match self.channel_name.as_deref() {
            Some(name) => {
                if !configured.is_empty() {
                    SettlementLock::Locked {
                        platform: name.to_string(),
                        allowed: configured,
                    }
                } else if channel_website {
                    SettlementLock::Locked {
                        platform: name.to_string(),
                        allowed: WEBSITE_DEFAULT_METHODS
                            .iter()
                            .map(|m| m.to_string())
                            .collect(),
                    }
                } else {
                    SettlementLock::Unconfigured {
                        platform: name.to_string(),
                    }
                }
            }
            None if source_website => SettlementLock::Locked {
                platform: "Direct Website".to_string(),
                allowed: WEBSITE_DEFAULT_METHODS
                    .iter()
                    .map(|m| m.to_string())
                    .collect(),
            },
            None => SettlementLock::MissingChannel,
        }
    }
}

impl SettlementLock {
    pub fn is_locked(&self) -> bool {
        !matches!(self, SettlementLock::Unlocked)
    }

    /// Whether `method` may settle this booking's room charge.
    pub fn allows(&self, method: &str) -> bool {
        match self {
            SettlementLock::Unlocked => true,
            SettlementLock::Locked { allowed, .. } => {
                allowed.iter().any(|m| methods_match(m, method))
            }
            _ => false,
        }
    }

    /// The configured tender to auto-post with: `preferred` when it is
    /// allowed, otherwise the channel's first allowed tender.
    pub fn settlement_method_for(&self, preferred: Option<&str>) -> Option<String> {
        match self {
            SettlementLock::Unlocked => preferred.map(str::to_string),
            SettlementLock::Locked { allowed, .. } => preferred
                .filter(|p| self.allows(p))
                .map(str::to_string)
                .or_else(|| allowed.first().cloned()),
            _ => None,
        }
    }

    /// Validate a room-charge (`booking`) tender against the lock.
    pub fn check_room_charge(&self, method: &str) -> Result<(), ApiError> {
        match self {
            SettlementLock::Unlocked => Ok(()),
            SettlementLock::MissingChannel => Err(ApiError::BadRequest(
                "This online booking has no booking channel. Set the booking channel (e.g. Booking.com, Agoda) before recording the room payment.".to_string(),
            )),
            SettlementLock::Unconfigured { platform } => Err(ApiError::BadRequest(format!(
                "Booking channel {platform} has no settlement payment method configured; the room charge of an online booking cannot be recorded."
            ))),
            SettlementLock::Locked { platform, allowed } => {
                if self.allows(method) {
                    Ok(())
                } else {
                    Err(ApiError::BadRequest(format!(
                        "This booking is settled via {platform}: the room charge can only be recorded as {}.",
                        allowed.join(" or ")
                    )))
                }
            }
        }
    }
}

/// Load the lock facts for a booking. `None` when the booking does not exist.
pub async fn load_lock<'e, E>(
    executor: E,
    booking_id: i64,
) -> Result<Option<SettlementLock>, ApiError>
where
    E: sqlx::Executor<'e, Database = crate::core::db::DbDatabase>,
{
    let row = sqlx::query_as::<_, SettlementLockRow>(
        r#"
        SELECT b.source,
               bc.name AS channel_name,
               bc.channel_type,
               bc.settlement_payment_methods
        FROM bookings b
        LEFT JOIN booking_channels bc ON bc.id = b.booking_channel_id
        WHERE b.id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_optional(executor)
    .await
    .map_err(ApiError::from)?;
    Ok(row.map(|r| r.decide()))
}

/// Validate a payment about to be written on `booking_id`.
/// Only `booking` rows are locked.
pub async fn enforce_payment<'e, E>(
    executor: E,
    booking_id: i64,
    payment_type: &str,
    method: &str,
) -> Result<(), ApiError>
where
    E: sqlx::Executor<'e, Database = crate::core::db::DbDatabase>,
{
    if payment_type != "booking" {
        return Ok(());
    }
    match load_lock(executor, booking_id).await? {
        Some(lock) => lock.check_room_charge(method),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(
        source: &str,
        name: Option<&str>,
        ty: Option<&str>,
        methods: Option<&[&str]>,
    ) -> SettlementLockRow {
        SettlementLockRow {
            source: Some(source.to_string()),
            channel_name: name.map(str::to_string),
            channel_type: ty.map(str::to_string),
            settlement_payment_methods: methods.map(|m| m.iter().map(|s| s.to_string()).collect()),
        }
    }

    #[test]
    fn walk_in_is_unlocked() {
        assert_eq!(
            row("walk_in", None, None, None).decide(),
            SettlementLock::Unlocked
        );
        assert_eq!(
            row("walk_in", Some("Walk-in"), Some("walk_in"), None).decide(),
            SettlementLock::Unlocked
        );
    }

    #[test]
    fn ota_accepts_only_its_method_case_insensitively() {
        let lock = row(
            "online",
            Some("Booking.com"),
            Some("ota"),
            Some(&["Booking.com"]),
        )
        .decide();
        assert!(lock.allows("Booking.com"));
        assert!(lock.allows("Booking.Com"));
        assert!(lock.allows(" booking.com "));
        assert!(lock.allows("Booking"));
        assert!(!lock.allows("Cash"));
        assert!(!lock.allows("Agoda.com"));
        assert!(lock.check_room_charge("Cash").is_err());
        assert!(lock.check_room_charge("BOOKING.COM").is_ok());
    }

    #[test]
    fn domain_and_plain_spellings_match() {
        assert!(methods_match("Traveloka", "Traveloka.Com"));
        assert!(methods_match("Agoda.com", "agoda"));
        assert!(!methods_match("Cash", "Card"));
        assert_eq!(normalize_method("com"), "com");
    }

    #[test]
    fn walk_in_tagged_with_ota_channel_is_locked() {
        let lock = row("walk_in", Some("Agoda"), Some("ota"), Some(&["Agoda.com"])).decide();
        assert!(lock.is_locked());
        assert!(lock.allows("Agoda.Com"));
    }

    #[test]
    fn website_accepts_bank_transfer_and_paypal_variants() {
        let lock = row(
            "website",
            Some("Direct Website"),
            Some("website"),
            Some(&["Bank Transfer", "PayPal"]),
        )
        .decide();
        for ok in ["Bank Transfer", "bank_transfer", "Paypal", "paypal"] {
            assert!(lock.allows(ok), "{ok}");
        }
        assert!(!lock.allows("Cash"));
        let no_channel = row("website", None, None, None).decide();
        assert!(no_channel.allows("bank_transfer"));
        assert!(!no_channel.allows("Cash"));
    }

    #[test]
    fn online_without_channel_refuses_room_charge() {
        let lock = row("online", None, None, None).decide();
        assert_eq!(lock, SettlementLock::MissingChannel);
        let err = lock.check_room_charge("Booking.com").unwrap_err();
        assert!(format!("{err:?}").contains("booking channel"));
    }

    #[test]
    fn unconfigured_ota_refuses() {
        let lock = row("online", Some("Airbnb"), Some("ota"), None).decide();
        assert!(matches!(lock, SettlementLock::Unconfigured { .. }));
        assert!(lock.check_room_charge("Airbnb").is_err());
    }

    #[test]
    fn auto_post_method_prefers_allowed_booking_method() {
        let lock = row(
            "online",
            Some("Booking.com"),
            Some("ota"),
            Some(&["Booking.com"]),
        )
        .decide();
        assert_eq!(
            lock.settlement_method_for(Some("Cash")).as_deref(),
            Some("Booking.com")
        );
        assert_eq!(
            lock.settlement_method_for(Some("Booking.Com")).as_deref(),
            Some("Booking.Com")
        );
        assert_eq!(
            lock.settlement_method_for(None).as_deref(),
            Some("Booking.com")
        );
        assert_eq!(
            SettlementLock::Unlocked
                .settlement_method_for(Some("Cash"))
                .as_deref(),
            Some("Cash")
        );
    }
}
