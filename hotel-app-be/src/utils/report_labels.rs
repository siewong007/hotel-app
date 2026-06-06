//! Display labels used by accounting-style reports.

fn normalized_token(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn title_case_label(value: &str) -> String {
    let cleaned = value.trim().replace(['_', '-'], " ");
    if cleaned.is_empty() {
        return "Cash".to_string();
    }

    cleaned
        .split_whitespace()
        .map(|word| {
            if word.contains('.') {
                let mut chars = word.chars();
                match chars.next() {
                    Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                    None => String::new(),
                }
            } else {
                let lower = word.to_ascii_lowercase();
                let mut chars = lower.chars();
                match chars.next() {
                    Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn known_label(value: &str) -> Option<&'static str> {
    match normalized_token(value).as_str() {
        "bookingcom" => Some("Booking.com"),
        "traveloka" | "travelokacom" => Some("Traveloka.com"),
        "agoda" | "agodacom" => Some("Agoda"),
        "expedia" | "expediacom" => Some("Expedia"),
        "hotelscom" => Some("Hotels.com"),
        "tripcom" => Some("Trip.com"),
        "airbnb" => Some("Airbnb"),
        "cash" | "cast" => Some("Cash"),
        "visacard" | "visa" => Some("Visa Card"),
        "debitcard" | "debit" => Some("Debit Card"),
        "creditcard" | "card" => Some("Credit Card"),
        "mastercard" | "master" => Some("Master Card"),
        "americanexpress" | "amex" => Some("American Express"),
        "sarawakpay" => Some("Sarawak Pay"),
        "banktransfer" => Some("Bank Transfer"),
        "onlinebanking" => Some("Online Banking"),
        "onlinepayment" => Some("Online Payment"),
        "ewallet" | "ewallets" => Some("E-Wallet"),
        "duitnow" => Some("DuitNow"),
        _ => None,
    }
}

fn clean_channel_name(value: &str) -> String {
    let first_part = value.split('|').next().unwrap_or(value).trim();
    let without_ref = first_part
        .split(" - Ref:")
        .next()
        .unwrap_or(first_part)
        .split(" Reference:")
        .next()
        .unwrap_or(first_part)
        .trim();

    without_ref
        .strip_suffix(" Booking")
        .or_else(|| without_ref.strip_suffix(" booking"))
        .unwrap_or(without_ref)
        .trim()
        .to_string()
}

/// Return an OTA/channel label when the booking source or remarks identify one.
pub fn booking_channel_label(
    source: Option<&str>,
    booking_remarks: Option<&str>,
) -> Option<String> {
    let source = source.unwrap_or_default().trim();
    let remarks = booking_remarks.unwrap_or_default().trim();
    if let Some(label) = known_label(source).or_else(|| known_label(remarks)) {
        return Some(label.to_string());
    }

    let source_key = normalized_token(source);
    let looks_online = [
        "online",
        "ota",
        "website",
        "web",
        "mobile",
        "channelmanager",
    ]
    .iter()
    .any(|key| source_key.contains(key));

    if !looks_online {
        return None;
    }

    let parsed = clean_channel_name(remarks);
    if !parsed.is_empty() {
        if let Some(label) = known_label(&parsed) {
            return Some(label.to_string());
        }

        if normalized_token(&parsed) != source_key {
            return Some(title_case_label(&parsed));
        }
    }

    if source_key.contains("website") || source_key.contains("web") {
        return Some("Website".to_string());
    }
    if source_key.contains("mobile") {
        return Some("Mobile".to_string());
    }

    Some("Online Booking".to_string())
}

/// Return the account label for the debit side of guest-ledger payments.
pub fn payment_account_label(
    payment_method: Option<&str>,
    source: Option<&str>,
    booking_remarks: Option<&str>,
) -> String {
    booking_channel_label(source, booking_remarks).unwrap_or_else(|| {
        let method = payment_method.unwrap_or("cash").trim();
        known_label(method)
            .map(str::to_string)
            .unwrap_or_else(|| title_case_label(method))
    })
}

#[cfg(test)]
mod tests {
    use super::{booking_channel_label, payment_account_label};

    #[test]
    fn extracts_configured_online_booking_channel_from_remarks() {
        assert_eq!(
            booking_channel_label(Some("online"), Some("Booking.com - Ref: ABC123")),
            Some("Booking.com".to_string())
        );
        assert_eq!(
            booking_channel_label(Some("online"), Some("Traveloka Booking")),
            Some("Traveloka.com".to_string())
        );
    }

    #[test]
    fn formats_supported_payment_methods_for_guest_ledger_debits() {
        assert_eq!(
            payment_account_label(Some("sarawak_pay"), Some("walk_in"), None),
            "Sarawak Pay"
        );
        assert_eq!(
            payment_account_label(Some("visa_card"), Some("walk_in"), None),
            "Visa Card"
        );
        assert_eq!(
            payment_account_label(Some("cash"), Some("walk_in"), None),
            "Cash"
        );
    }
}
