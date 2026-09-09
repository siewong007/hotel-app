//! Consent record persistence.
//!
//! `consent_records` is append-only. There is deliberately no update path: a
//! withdrawal would be a new row with `granted = false`, so the history of what
//! a subject agreed to stays intact and provable rather than being overwritten.
//!
//! Withdrawal is currently a manual process handled by the hotel on request,
//! which is exactly what the privacy notice and the eKYC consent document tell
//! the guest ("contact us"). There is no self-serve withdrawal endpoint yet, so
//! there is no withdrawal writer here either — the notice and the code say the
//! same thing.

use super::models::ConsentRecordInsert;
use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;

pub struct ConsentRepository;

impl ConsentRepository {
    /// Write a batch of consent records inside one transaction, so a request
    /// either records every decision the guest made or none of them. A partial
    /// write is worse than no write: it would show consent to the terms but not
    /// to the privacy notice, which is a story neither side can defend.
    ///
    /// `ip_address` is bound as text and cast in SQL so a malformed forwarded
    /// header fails as a clear error rather than a driver-level surprise.
    pub async fn insert_many(
        pool: &DbPool,
        records: &[ConsentRecordInsert],
    ) -> Result<(), ApiError> {
        if records.is_empty() {
            return Ok(());
        }

        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Self::insert_many_tx(&mut tx, records).await?;

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Same write, joined to a caller's transaction.
    ///
    /// The booking path needs this: the guest row, the booking row and the
    /// consent that authorised them must land together, or a crash between the
    /// commits leaves a booking whose consent evidence does not exist.
    pub async fn insert_many_tx(
        tx: &mut DbTransaction<'_>,
        records: &[ConsentRecordInsert],
    ) -> Result<(), ApiError> {
        for record in records {
            sqlx::query(
                r#"
                INSERT INTO consent_records (
                    subject_type, user_id, guest_id, booking_id,
                    document_type, document_version, locale, granted,
                    source, ip_address, user_agent
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::inet, $11)
                "#,
            )
            .bind(record.subject_type.as_str())
            .bind(record.user_id)
            .bind(record.guest_id)
            .bind(record.booking_id)
            .bind(record.document.as_str())
            .bind(&record.version)
            .bind(&record.locale)
            .bind(record.granted)
            .bind(record.source.as_str())
            .bind(record.ip_address.as_deref())
            .bind(record.user_agent.as_deref())
            .execute(&mut **tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        }
        Ok(())
    }
}
