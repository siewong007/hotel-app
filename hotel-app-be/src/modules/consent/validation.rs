//! Server-side enforcement of consent.
//!
//! A checkbox in the browser is not consent evidence — anyone can call the API
//! directly, and a client bug that stops sending the flag would silently
//! produce a population of guests with no provable consent. So every entry
//! point that collects personal data validates the submitted consent here
//! before it does anything else, and rejects the request outright if a required
//! consent is missing, stale, or refused.

use super::models::{ConsentAcceptance, ConsentDocument};
use crate::core::error::ApiError;

/// Documents a guest must actively agree to before an account is created.
pub const REGISTRATION_REQUIRED: &[ConsentDocument] = &[
    ConsentDocument::TermsOfService,
    ConsentDocument::PrivacyNotice,
];

/// Documents a guest must actively agree to before an online booking is taken.
pub const BOOKING_REQUIRED: &[ConsentDocument] = &[
    ConsentDocument::TermsOfService,
    ConsentDocument::PrivacyNotice,
];

/// Explicit consent required before any biometric data is processed (PDPA s.40).
pub const EKYC_REQUIRED: &[ConsentDocument] = &[ConsentDocument::EkycBiometric];

/// Documents a guest must actively agree to before a payment action is taken.
///
/// The guest is committing money against the booking terms here, so the
/// payment terms consent is what later proves the charge was authorised under
/// the wording that governed refunds and settlement.
pub const PAYMENT_REQUIRED: &[ConsentDocument] = &[ConsentDocument::PaymentTerms];

/// Check that every required document appears in `submitted`, is granted, and
/// pins the version the server currently publishes.
///
/// Returns the error message a client should show, naming the document, so a
/// failure is actionable rather than a bare 400.
pub fn require_consents(
    submitted: &[ConsentAcceptance],
    required: &[ConsentDocument],
) -> Result<(), ApiError> {
    for document in required {
        let entry = submitted
            .iter()
            .find(|candidate| candidate.document == *document)
            .ok_or_else(|| {
                ApiError::BadRequest(format!(
                    "Consent to the {} is required before this request can be accepted",
                    human_name(*document)
                ))
            })?;

        if !entry.granted {
            return Err(ApiError::BadRequest(format!(
                "Consent to the {} is required before this request can be accepted",
                human_name(*document)
            )));
        }

        // A stale version means the guest was shown superseded wording. Ask them
        // to re-read rather than silently accepting consent to text we no longer
        // publish.
        if entry.version != document.current_version() {
            return Err(ApiError::BadRequest(format!(
                "The {} has been updated. Please review the current version and accept it again",
                human_name(*document)
            )));
        }
    }

    Ok(())
}

/// Reject a submission carrying a locale the schema will not store, before it
/// reaches the database and fails as an opaque constraint violation.
pub fn validate_locales(submitted: &[ConsentAcceptance]) -> Result<(), ApiError> {
    for entry in submitted {
        if entry.locale != "en" && entry.locale != "ms" {
            return Err(ApiError::BadRequest(
                "Consent locale must be 'en' or 'ms'".to_string(),
            ));
        }
    }
    Ok(())
}

/// The language the guest actually read the notices in.
///
/// Stored on `guests.language_preference` so later mail (booking confirmation,
/// payment receipts) matches the notice they accepted, rather than the column
/// default of `en`.
pub fn preferred_locale(submitted: &[ConsentAcceptance]) -> String {
    submitted
        .iter()
        .map(|entry| entry.locale.as_str())
        .find(|locale| *locale == "en" || *locale == "ms")
        .unwrap_or("en")
        .to_string()
}

fn human_name(document: ConsentDocument) -> &'static str {
    match document {
        ConsentDocument::TermsOfService => "Booking Terms and Conditions",
        ConsentDocument::PrivacyNotice => "Privacy Notice",
        ConsentDocument::PaymentTerms => "Payment Terms",
        ConsentDocument::EkycBiometric => "identity verification consent",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn accept(document: ConsentDocument, granted: bool) -> ConsentAcceptance {
        ConsentAcceptance {
            document,
            version: document.current_version().to_string(),
            granted,
            locale: "en".to_string(),
        }
    }

    #[test]
    fn accepts_all_required_consents() {
        let submitted = vec![
            accept(ConsentDocument::TermsOfService, true),
            accept(ConsentDocument::PrivacyNotice, true),
        ];
        assert!(require_consents(&submitted, REGISTRATION_REQUIRED).is_ok());
    }

    #[test]
    fn rejects_missing_consent() {
        let submitted = vec![accept(ConsentDocument::TermsOfService, true)];
        let error = require_consents(&submitted, REGISTRATION_REQUIRED).unwrap_err();
        assert!(matches!(error, ApiError::BadRequest(ref m) if m.contains("Privacy Notice")));
    }

    #[test]
    fn rejects_refused_consent() {
        let submitted = vec![
            accept(ConsentDocument::TermsOfService, true),
            accept(ConsentDocument::PrivacyNotice, false),
        ];
        let error = require_consents(&submitted, REGISTRATION_REQUIRED).unwrap_err();
        assert!(matches!(error, ApiError::BadRequest(ref m) if m.contains("Privacy Notice")));
    }

    #[test]
    fn rejects_stale_document_version() {
        let mut stale = accept(ConsentDocument::PrivacyNotice, true);
        stale.version = "1999-01-01".to_string();
        let submitted = vec![accept(ConsentDocument::TermsOfService, true), stale];
        let error = require_consents(&submitted, REGISTRATION_REQUIRED).unwrap_err();
        assert!(matches!(error, ApiError::BadRequest(ref m) if m.contains("has been updated")));
    }

    #[test]
    fn extra_unrequired_consent_does_not_block() {
        let submitted = vec![
            accept(ConsentDocument::TermsOfService, true),
            accept(ConsentDocument::PrivacyNotice, true),
            accept(ConsentDocument::PaymentTerms, false),
        ];
        assert!(require_consents(&submitted, REGISTRATION_REQUIRED).is_ok());
    }

    #[test]
    fn rejects_unknown_locale() {
        let mut entry = accept(ConsentDocument::TermsOfService, true);
        entry.locale = "fr".to_string();
        assert!(validate_locales(&[entry]).is_err());
    }

    #[test]
    fn preferred_locale_follows_the_notice_the_guest_read() {
        let mut malay = accept(ConsentDocument::TermsOfService, true);
        malay.locale = "ms".to_string();
        assert_eq!(preferred_locale(&[malay]), "ms");
        assert_eq!(preferred_locale(&[]), "en");
    }

    #[test]
    fn ekyc_requires_explicit_biometric_consent() {
        let submitted = vec![accept(ConsentDocument::TermsOfService, true)];
        assert!(require_consents(&submitted, EKYC_REQUIRED).is_err());
    }

    #[test]
    fn payment_requires_payment_terms_consent() {
        let submitted = vec![
            accept(ConsentDocument::TermsOfService, true),
            accept(ConsentDocument::PrivacyNotice, true),
        ];
        let error = require_consents(&submitted, PAYMENT_REQUIRED).unwrap_err();
        assert!(matches!(error, ApiError::BadRequest(ref m) if m.contains("Payment Terms")));

        let granted = vec![accept(ConsentDocument::PaymentTerms, true)];
        assert!(require_consents(&granted, PAYMENT_REQUIRED).is_ok());
    }
}
