//! Invoice number generation
//!
//! Generates monotonically-increasing invoice numbers in the format
//! `INV-YYYYMM-XXXX` (4-digit zero-padded sequence, scoped to the current
//! month). The sequence is shared across the `invoices` and `customer_ledgers`
//! tables so a number issued for a checkout invoice never collides with one
//! issued for a city-ledger entry in the same month.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::repositories::invoice_numbers as repo;

/// Compute the next invoice number for the current month.
///
/// Format: `INV-YYYYMM-XXXX` (e.g. `INV-202604-0001`).
pub async fn next_invoice_number<'e, E>(executor: E) -> Result<String, ApiError>
where
    E: sqlx::Executor<'e, Database = crate::core::db::DbDatabase>,
{
    let now = chrono::Local::now();
    let yyyymm = now.format("%Y%m").to_string();
    let prefix = format!("INV-{}-", yyyymm);
    let pattern = format!("{}%", prefix);

    let max_seq = repo::max_invoice_sequence(executor, &pattern).await?;
    let next = max_seq.unwrap_or(0) + 1;
    Ok(format!("{}{:04}", prefix, next))
}

/// Backfill invoice rows for any booking that doesn't yet have one.
///
/// Each backfilled invoice gets a number in the new `INV-YYYYMM-XXXX` format,
/// where `YYYYMM` is derived from the booking's `created_at`. Sequence numbers
/// continue from whatever already exists for that month, so this is safe to
/// run repeatedly — it only inserts where no invoice row exists.
///
/// Returns the number of invoices created.
#[allow(dead_code)]
pub async fn backfill_missing_booking_invoices(pool: &DbPool) -> Result<usize, ApiError> {
    let rows = repo::bookings_missing_invoices(pool).await?;
    if rows.is_empty() {
        return Ok(0);
    }

    // Track per-month next-sequence in memory so we don't re-query for every row.
    use std::collections::HashMap;
    let mut next_by_month: HashMap<String, i64> = HashMap::new();

    let mut inserted = 0usize;
    for (booking_id, yyyymm) in rows {
        let prefix = format!("INV-{}-", yyyymm);
        let pattern = format!("{}%", prefix);

        let next = if let Some(n) = next_by_month.get_mut(&yyyymm) {
            *n += 1;
            *n
        } else {
            let max_seq = repo::max_invoice_sequence(pool, &pattern).await?;
            let n = max_seq.unwrap_or(0) + 1;
            next_by_month.insert(yyyymm.clone(), n);
            n
        };

        let invoice_number = format!("{}{:04}", prefix, next);

        match repo::insert_booking_invoice(pool, booking_id, &invoice_number).await {
            Ok(_) => inserted += 1,
            Err(e) => {
                log::warn!(
                    "Failed to backfill invoice for booking {}: {}",
                    booking_id,
                    e
                );
                // Roll back the in-memory counter so we don't skip a number
                // for the next booking in this month.
                if let Some(n) = next_by_month.get_mut(&yyyymm) {
                    *n -= 1;
                }
            }
        }
    }

    Ok(inserted)
}

/// Backfill `customer_ledgers.due_date` for any rows where it's NULL.
///
/// Uses the linked company's `payment_terms_days` (falling back to
/// `default_payment_terms_days`) and adds it to the row's
/// `posting_date`/`invoice_date`/`created_at` (in that order of preference).
/// Idempotent — only touches rows where `due_date IS NULL`.
#[allow(dead_code)]
pub async fn backfill_missing_ledger_due_dates(pool: &DbPool) -> Result<usize, ApiError> {
    repo::backfill_ledger_due_dates(pool).await
}
