//! Invoice number generation
//!
//! Generates monotonically-increasing invoice numbers in the format
//! `INV-YYYYMM-XXXX` (4-digit zero-padded sequence, scoped to the current
//! month). The sequence is shared across the `invoices` and `customer_ledgers`
//! tables so a number issued for a checkout invoice never collides with one
//! issued for a city-ledger entry in the same month.

use crate::core::db::DbPool;
use crate::core::error::ApiError;

/// Compute the next invoice number for the current month.
///
/// Format: `INV-YYYYMM-XXXX` (e.g. `INV-202604-0001`).
pub async fn next_invoice_number(pool: &DbPool) -> Result<String, ApiError> {
    let now = chrono::Local::now();
    let yyyymm = now.format("%Y%m").to_string();
    let prefix = format!("INV-{}-", yyyymm);
    let pattern = format!("{}%", prefix);

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let max_seq: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT MAX(seq) FROM (
            SELECT CAST(SUBSTR(invoice_number, 12) AS INTEGER) AS seq
            FROM invoices WHERE invoice_number LIKE ?1
            UNION ALL
            SELECT CAST(SUBSTR(invoice_number, 12) AS INTEGER) AS seq
            FROM customer_ledgers WHERE invoice_number LIKE ?1
        )
        "#,
    )
    .bind(&pattern)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let max_seq: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT MAX(seq) FROM (
            SELECT CAST(SUBSTRING(invoice_number FROM 12) AS BIGINT) AS seq
            FROM invoices WHERE invoice_number LIKE $1
            UNION ALL
            SELECT CAST(SUBSTRING(invoice_number FROM 12) AS BIGINT) AS seq
            FROM customer_ledgers WHERE invoice_number LIKE $1
        ) combined
        "#,
    )
    .bind(&pattern)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

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
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let rows: Vec<(i64, String)> = sqlx::query_as(
        r#"
        SELECT b.id, strftime('%Y%m', b.created_at)
        FROM bookings b
        WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.booking_id = b.id)
        ORDER BY b.created_at
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let rows: Vec<(i64, String)> = sqlx::query_as(
        r#"
        SELECT b.id, TO_CHAR(b.created_at, 'YYYYMM')
        FROM bookings b
        WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.booking_id = b.id)
        ORDER BY b.created_at
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

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
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            let max_seq: Option<i64> = sqlx::query_scalar(
                r#"
                SELECT MAX(seq) FROM (
                    SELECT CAST(SUBSTR(invoice_number, 12) AS INTEGER) AS seq
                    FROM invoices WHERE invoice_number LIKE ?1
                    UNION ALL
                    SELECT CAST(SUBSTR(invoice_number, 12) AS INTEGER) AS seq
                    FROM customer_ledgers WHERE invoice_number LIKE ?1
                )
                "#,
            )
            .bind(&pattern)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

            #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
            let max_seq: Option<i64> = sqlx::query_scalar(
                r#"
                SELECT MAX(seq) FROM (
                    SELECT CAST(SUBSTRING(invoice_number FROM 12) AS BIGINT) AS seq
                    FROM invoices WHERE invoice_number LIKE $1
                    UNION ALL
                    SELECT CAST(SUBSTRING(invoice_number FROM 12) AS BIGINT) AS seq
                    FROM customer_ledgers WHERE invoice_number LIKE $1
                ) combined
                "#,
            )
            .bind(&pattern)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

            let n = max_seq.unwrap_or(0) + 1;
            next_by_month.insert(yyyymm.clone(), n);
            n
        };

        let invoice_number = format!("{}{:04}", prefix, next);

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let result = sqlx::query(
            r#"
            INSERT INTO invoices (
                invoice_number, booking_id, invoice_type,
                subtotal, total_amount, status
            )
            SELECT ?1, b.id, 'checkout', b.total_amount, b.total_amount, 'issued'
            FROM bookings b
            WHERE b.id = ?2
            "#,
        )
        .bind(&invoice_number)
        .bind(booking_id)
        .execute(pool)
        .await;

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let result = sqlx::query(
            r#"
            INSERT INTO invoices (
                invoice_number, booking_id, billing_name, billing_email,
                subtotal, total_amount, line_items, status, invoice_type
            )
            SELECT $1, b.id,
                   COALESCE(g.full_name, ''),
                   g.email,
                   b.total_amount,
                   b.total_amount,
                   '[]'::jsonb,
                   'issued',
                   'booking'
            FROM bookings b
            INNER JOIN guests g ON b.guest_id = g.id
            WHERE b.id = $2
            "#,
        )
        .bind(&invoice_number)
        .bind(booking_id)
        .execute(pool)
        .await;

        match result {
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
/// Uses the linked company's `payment_terms_days` (default 30) and adds it to
/// the row's `posting_date`/`invoice_date`/`created_at` (in that order of
/// preference). Idempotent — only touches rows where `due_date IS NULL`.
#[allow(dead_code)]
pub async fn backfill_missing_ledger_due_dates(pool: &DbPool) -> Result<usize, ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let result = sqlx::query(
        r#"
        UPDATE customer_ledgers
           SET due_date = date(
               COALESCE(posting_date, invoice_date, date(created_at)),
               '+' || COALESCE(
                   (SELECT payment_terms_days FROM companies WHERE companies.company_name = customer_ledgers.company_name LIMIT 1),
                   30
               ) || ' days'
           )
         WHERE due_date IS NULL
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let result = sqlx::query(
        r#"
        UPDATE customer_ledgers
           SET due_date = (
               COALESCE(posting_date, invoice_date, created_at::date)
               + COALESCE(
                   (SELECT payment_terms_days FROM companies
                     WHERE company_name = customer_ledgers.company_name
                     LIMIT 1),
                   30
               ) * INTERVAL '1 day'
           )::date
         WHERE due_date IS NULL
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(result.rows_affected() as usize)
}
