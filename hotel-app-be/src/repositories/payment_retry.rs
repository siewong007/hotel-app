//! Persistence for emailed payment-retry capabilities.
//!
//! Rows are addressed only by the hash of the emailed token; the raw token is
//! never stored, logged, or returned. Lookup deliberately does not mutate the
//! row -- consumption is a separate, atomic step taken with the replacement
//! payment, so following the link cannot spend it.

use chrono::{DateTime, Utc};
use sqlx::Row;

use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;
use crate::core::sql_compat::current_timestamp;
use crate::models::payment_retry::PaymentRetryCapability;
use crate::param;

const CAPABILITY_COLUMNS: &str =
    "id, booking_id, payment_id, expires_at, consumed_at, replacement_payment_id, created_at";

fn map_capability(row: &sqlx::postgres::PgRow) -> PaymentRetryCapability {
    PaymentRetryCapability {
        id: row.try_get("id").unwrap_or_default(),
        booking_id: row.try_get("booking_id").unwrap_or_default(),
        payment_id: row.try_get::<Option<i64>, _>("payment_id").ok().flatten(),
        expires_at: row.try_get("expires_at").unwrap_or_else(|_| Utc::now()),
        consumed_at: row
            .try_get::<Option<DateTime<Utc>>, _>("consumed_at")
            .ok()
            .flatten(),
        replacement_payment_id: row
            .try_get::<Option<i64>, _>("replacement_payment_id")
            .ok()
            .flatten(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
    }
}

pub struct PaymentRetryRepository;

impl PaymentRetryRepository {
    /// Store a freshly minted capability. `token_hash` is the prefixed SHA-256
    /// of the token that goes in the email; the caller keeps the raw token only
    /// long enough to render the link.
    pub async fn create(
        pool: &DbPool,
        booking_id: i64,
        payment_id: Option<i64>,
        token_hash: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<PaymentRetryCapability, ApiError> {
        let sql = format!(
            "INSERT INTO payment_retry_capabilities (booking_id, payment_id, token_hash, expires_at) \
             VALUES ({}, {}, {}, {}) RETURNING {CAPABILITY_COLUMNS}",
            param!(1),
            param!(2),
            param!(3),
            param!(4)
        );
        let row = sqlx::query(&sql)
            .bind(booking_id)
            .bind(payment_id)
            .bind(token_hash)
            .bind(expires_at)
            .fetch_one(pool)
            .await
            .map_err(|e| {
                ApiError::Database(format!("Failed to create payment retry capability: {}", e))
            })?;
        Ok(map_capability(&row))
    }

    /// Resolve a capability by token hash without touching it.
    ///
    /// Expired and already-consumed rows are returned too: the caller decides
    /// what to tell the guest, and a consumed row still carries the replacement
    /// payment a duplicate submission must resolve to.
    pub async fn find_by_token_hash(
        pool: &DbPool,
        token_hash: &str,
    ) -> Result<Option<PaymentRetryCapability>, ApiError> {
        let sql = format!(
            "SELECT {CAPABILITY_COLUMNS} FROM payment_retry_capabilities WHERE token_hash = {}",
            param!(1)
        );
        let row = sqlx::query(&sql)
            .bind(token_hash)
            .fetch_optional(pool)
            .await
            .map_err(|e| {
                ApiError::Database(format!("Payment retry capability lookup failed: {}", e))
            })?;
        Ok(row.as_ref().map(map_capability))
    }

    /// Spend the capability, recording the payment it produced.
    ///
    /// The guard lives in the UPDATE's WHERE clause rather than in a prior
    /// SELECT, so two concurrent submissions cannot both pass it: the second
    /// matches no row and gets `Ok(false)`. Callers run this inside the same
    /// transaction that inserts the payment, so a capability is never marked
    /// spent against a payment that rolled back.
    pub async fn consume_tx(
        tx: &mut DbTransaction<'_>,
        capability_id: i64,
        replacement_payment_id: i64,
    ) -> Result<bool, ApiError> {
        let sql = format!(
            "UPDATE payment_retry_capabilities \
             SET consumed_at = {now}, replacement_payment_id = {} \
             WHERE id = {} AND consumed_at IS NULL AND expires_at > {now} \
             RETURNING id",
            param!(1),
            param!(2),
            now = current_timestamp()
        );
        let row = sqlx::query(&sql)
            .bind(replacement_payment_id)
            .bind(capability_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| {
                ApiError::Database(format!("Failed to consume payment retry capability: {}", e))
            })?;
        Ok(row.is_some())
    }

    /// Outstanding capabilities already issued for a booking, newest first.
    ///
    /// Used to avoid emailing a second live link for the same booking while one
    /// is still spendable.
    pub async fn find_live_for_booking(
        pool: &DbPool,
        booking_id: i64,
    ) -> Result<Vec<PaymentRetryCapability>, ApiError> {
        let sql = format!(
            "SELECT {CAPABILITY_COLUMNS} FROM payment_retry_capabilities \
             WHERE booking_id = {} AND consumed_at IS NULL AND expires_at > {} \
             ORDER BY id DESC",
            param!(1),
            current_timestamp()
        );
        let rows = sqlx::query(&sql)
            .bind(booking_id)
            .fetch_all(pool)
            .await
            .map_err(|e| {
                ApiError::Database(format!("Payment retry capability scan failed: {}", e))
            })?;
        Ok(rows.iter().map(map_capability).collect())
    }
}
