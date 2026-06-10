//! Invoice number repository for database operations.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::settings_cache;

pub async fn max_invoice_sequence(pool: &DbPool, pattern: &str) -> Result<Option<i64>, ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        sqlx::query_scalar(
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
        .bind(pattern)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    {
        sqlx::query_scalar(
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
        .bind(pattern)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }
}

pub async fn bookings_missing_invoices(pool: &DbPool) -> Result<Vec<(i64, String)>, ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        sqlx::query_as(
            r#"
            SELECT b.id, strftime('%Y%m', b.created_at)
            FROM bookings b
            WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.booking_id = b.id)
            ORDER BY b.created_at
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)
    }

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    {
        sqlx::query_as(
            r#"
            SELECT b.id, TO_CHAR(b.created_at, 'YYYYMM')
            FROM bookings b
            WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.booking_id = b.id)
            ORDER BY b.created_at
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)
    }
}

pub async fn insert_booking_invoice(
    pool: &DbPool,
    booking_id: i64,
    invoice_number: &str,
) -> Result<(), ApiError> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        sqlx::query(
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
        .bind(invoice_number)
        .bind(booking_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(ApiError::from)
    }

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    {
        sqlx::query(
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
        .bind(invoice_number)
        .bind(booking_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(ApiError::from)
    }
}

pub async fn backfill_ledger_due_dates(pool: &DbPool) -> Result<usize, ApiError> {
    let default_terms_days =
        settings_cache::get_positive_i32(pool, "default_payment_terms_days", 30).await;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let result = sqlx::query(
        r#"
        UPDATE customer_ledgers
           SET due_date = date(
               COALESCE(posting_date, invoice_date, date(created_at)),
               '+' || COALESCE(
                   (SELECT payment_terms_days FROM companies WHERE companies.company_name = customer_ledgers.company_name LIMIT 1),
                   ?1
               ) || ' days'
           )
         WHERE due_date IS NULL
        "#,
    )
    .bind(default_terms_days)
    .execute(pool)
    .await
    .map_err(ApiError::from)?;

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
                   $1
               ) * INTERVAL '1 day'
           )::date
         WHERE due_date IS NULL
        "#,
    )
    .bind(default_terms_days)
    .execute(pool)
    .await
    .map_err(ApiError::from)?;

    Ok(result.rows_affected() as usize)
}
