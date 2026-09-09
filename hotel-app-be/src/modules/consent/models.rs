//! Consent models.
//!
//! The vocabulary here is the wire contract shared with the frontend
//! (`hotel-web-fe/src/features/legal/content/types.ts`) and with the
//! `document_type`, `source` and `subject_type` CHECK constraints on
//! `public.consent_records`. All three must agree; `consent_vocabulary_matches_schema`
//! in `tests/consent_records.rs` is what stops them drifting.

use serde::{Deserialize, Serialize};

/// A document a data subject can consent to.
///
/// Marketing is deliberately absent. Consent to marketing is already recorded
/// by `notification_consent_events` / `notification_subscriptions`, which carry
/// policy version, source, IP and user agent and own the unsubscribe link, so a
/// second marketing ledger here would only create a second source of truth to
/// disagree with the first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsentDocument {
    TermsOfService,
    PrivacyNotice,
    PaymentTerms,
    /// Explicit consent to process biometric data during identity
    /// verification. Sensitive personal data under PDPA s.40, which is why it
    /// is never bundled with `TermsOfService`.
    EkycBiometric,
}

impl ConsentDocument {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TermsOfService => "terms_of_service",
            Self::PrivacyNotice => "privacy_notice",
            Self::PaymentTerms => "payment_terms",
            Self::EkycBiometric => "ekyc_biometric",
        }
    }

    /// The version of this document the server currently publishes.
    ///
    /// Consent is only accepted for the current version: a client that submits
    /// a stale version was showing the guest superseded text, and treating that
    /// as valid consent would be exactly the failure the version column exists
    /// to prevent. These strings mirror `CONSENT_DOCUMENT_VERSIONS` in
    /// `hotel-web-fe/src/features/legal/content/index.ts`.
    pub fn current_version(self) -> &'static str {
        match self {
            Self::TermsOfService => "2026-09-09",
            Self::PrivacyNotice => "2026-09-09",
            Self::PaymentTerms => "2026-09-09",
            Self::EkycBiometric => "2026-09-09",
        }
    }
}

/// Where in the product the consent was collected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsentSource {
    Registration,
    OnlineBooking,
    Payment,
    Ekyc,
    GuestPortal,
    FrontDesk,
}

impl ConsentSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Registration => "registration",
            Self::OnlineBooking => "online_booking",
            Self::Payment => "payment",
            Self::Ekyc => "ekyc",
            Self::GuestPortal => "guest_portal",
            Self::FrontDesk => "front_desk",
        }
    }
}

/// Who the consent belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsentSubjectType {
    User,
    Guest,
    Anonymous,
}

impl ConsentSubjectType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Guest => "guest",
            Self::Anonymous => "anonymous",
        }
    }
}

/// One consent decision as submitted by a client.
///
/// `granted` is carried explicitly rather than inferred from the presence of
/// the entry: a guest shown an optional box who leaves it unticked has made a
/// decision worth recording, and a stored refusal is what later proves the box
/// was genuinely optional rather than pre-ticked.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsentAcceptance {
    pub document: ConsentDocument,
    pub version: String,
    pub granted: bool,
    /// Which language the text was displayed in. PDPA s.7(2) requires the
    /// notice in both Bahasa Malaysia and English, so which one the subject
    /// actually read is part of the evidence.
    #[serde(default = "default_locale")]
    pub locale: String,
}

fn default_locale() -> String {
    "en".to_string()
}

/// A consent record ready to be written, with the subject and request context
/// resolved by the server. Nothing here is taken from the client except the
/// acceptance itself.
#[derive(Debug, Clone)]
pub struct ConsentRecordInsert {
    pub subject_type: ConsentSubjectType,
    pub user_id: Option<i64>,
    pub guest_id: Option<i64>,
    pub booking_id: Option<i64>,
    pub document: ConsentDocument,
    pub version: String,
    pub locale: String,
    pub granted: bool,
    pub source: ConsentSource,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}
