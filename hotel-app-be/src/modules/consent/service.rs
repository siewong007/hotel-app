//! Consent recording.
//!
//! One entry point (`record`) so that every surface which collects consent
//! writes the same shape of evidence. The request context — IP address and user
//! agent — is read from the request headers here rather than accepted from the
//! client, because evidence a client can forge is not evidence.

use super::models::{ConsentAcceptance, ConsentRecordInsert, ConsentSource, ConsentSubjectType};
use super::repository::ConsentRepository;
use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;
use crate::models::audit::AuditEvent;
use crate::services::audit::AuditLog;
use axum::http::HeaderMap;
use std::net::SocketAddr;

/// Who a batch of consent belongs to, resolved server-side.
#[derive(Debug, Clone, Copy)]
pub struct ConsentSubject {
    pub subject_type: ConsentSubjectType,
    pub user_id: Option<i64>,
    pub guest_id: Option<i64>,
    pub booking_id: Option<i64>,
}

impl ConsentSubject {
    pub fn user(user_id: i64) -> Self {
        Self {
            subject_type: ConsentSubjectType::User,
            user_id: Some(user_id),
            guest_id: None,
            booking_id: None,
        }
    }

    pub fn guest(guest_id: i64) -> Self {
        Self {
            subject_type: ConsentSubjectType::Guest,
            user_id: None,
            guest_id: Some(guest_id),
            booking_id: None,
        }
    }

    /// An anonymous booker has no account. The guest row created for the
    /// booking and the booking itself are the only durable handles on them, so
    /// both are recorded.
    pub fn anonymous_booking(guest_id: i64, booking_id: i64) -> Self {
        Self {
            subject_type: ConsentSubjectType::Anonymous,
            user_id: None,
            guest_id: Some(guest_id),
            booking_id: Some(booking_id),
        }
    }

    /// Attach the account the guest was signed in as. A guest submitting
    /// identity documents through their own login is both a `guests` row and a
    /// `users` row, and the consent should be findable from either.
    pub fn with_user(mut self, user_id: i64) -> Self {
        self.user_id = Some(user_id);
        self
    }

    /// Attach the guest profile created alongside a new account.
    pub fn with_guest(mut self, guest_id: i64) -> Self {
        self.guest_id = Some(guest_id);
        self
    }

    /// Attach the booking this consent authorised, so the row is findable from
    /// the stay as well as from the guest.
    pub fn with_booking(mut self, booking_id: i64) -> Self {
        self.booking_id = Some(booking_id);
        self
    }
}

/// Request context captured alongside a consent decision.
#[derive(Debug, Clone, Default)]
pub struct ConsentContext {
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}

impl ConsentContext {
    pub fn from_request(headers: &HeaderMap, peer_addr: SocketAddr) -> Self {
        Self {
            ip_address: Some(crate::routes::extract_client_ip(headers, peer_addr).to_string()),
            user_agent: headers
                .get(axum::http::header::USER_AGENT)
                .and_then(|value| value.to_str().ok())
                .map(ToOwned::to_owned),
        }
    }
}

/// Persist a batch of consent decisions and note them in the audit trail.
///
/// Both grants AND refusals are stored. An unrecorded refusal is
/// indistinguishable from never having asked, and it is the refusals that prove
/// a guest was given a real choice rather than a pre-ticked box.
pub async fn record(
    pool: &DbPool,
    subject: ConsentSubject,
    acceptances: &[ConsentAcceptance],
    source: ConsentSource,
    context: &ConsentContext,
) -> Result<(), ApiError> {
    if acceptances.is_empty() {
        return Ok(());
    }

    let records = build_records(subject, acceptances, source, context);
    ConsentRepository::insert_many(pool, &records).await?;

    let granted: Vec<&str> = acceptances
        .iter()
        .filter(|a| a.granted)
        .map(|a| a.document.as_str())
        .collect();
    let refused: Vec<&str> = acceptances
        .iter()
        .filter(|a| !a.granted)
        .map(|a| a.document.as_str())
        .collect();

    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: subject.user_id,
            action: "consent.recorded",
            resource_type: "consent",
            resource_id: subject.guest_id.or(subject.user_id),
            details: Some(serde_json::json!({
                "source": source.as_str(),
                "subject_type": subject.subject_type.as_str(),
                "booking_id": subject.booking_id,
                "granted": granted,
                "refused": refused,
            })),
            ip_address: context.ip_address.clone(),
            user_agent: context.user_agent.clone(),
        },
    )
    .await?;

    Ok(())
}

/// Same as [`record`], joined to a caller's transaction, so consent lands in
/// the same commit as the rows it authorised.
pub async fn record_tx(
    tx: &mut DbTransaction<'_>,
    subject: ConsentSubject,
    acceptances: &[ConsentAcceptance],
    source: ConsentSource,
    context: &ConsentContext,
) -> Result<(), ApiError> {
    if acceptances.is_empty() {
        return Ok(());
    }

    let records = build_records(subject, acceptances, source, context);
    ConsentRepository::insert_many_tx(tx, &records).await?;

    let granted: Vec<&str> = acceptances
        .iter()
        .filter(|a| a.granted)
        .map(|a| a.document.as_str())
        .collect();
    let refused: Vec<&str> = acceptances
        .iter()
        .filter(|a| !a.granted)
        .map(|a| a.document.as_str())
        .collect();

    AuditLog::log_event_tx(
        tx,
        AuditEvent {
            user_id: subject.user_id,
            action: "consent.recorded",
            resource_type: "consent",
            resource_id: subject.booking_id.or(subject.guest_id).or(subject.user_id),
            details: Some(serde_json::json!({
                "source": source.as_str(),
                "subject_type": subject.subject_type.as_str(),
                "booking_id": subject.booking_id,
                "granted": granted,
                "refused": refused,
            })),
            ip_address: context.ip_address.clone(),
            user_agent: context.user_agent.clone(),
        },
    )
    .await
}

fn build_records(
    subject: ConsentSubject,
    acceptances: &[ConsentAcceptance],
    source: ConsentSource,
    context: &ConsentContext,
) -> Vec<ConsentRecordInsert> {
    acceptances
        .iter()
        .map(|acceptance| ConsentRecordInsert {
            subject_type: subject.subject_type,
            user_id: subject.user_id,
            guest_id: subject.guest_id,
            booking_id: subject.booking_id,
            document: acceptance.document,
            version: acceptance.version.clone(),
            locale: acceptance.locale.clone(),
            granted: acceptance.granted,
            source,
            ip_address: context.ip_address.clone(),
            user_agent: context.user_agent.clone(),
        })
        .collect()
}
