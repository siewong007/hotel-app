//! Customer ledger repository for database operations

use rust_decimal::Decimal;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{CustomerLedger, CustomerLedgerPayment};

pub struct LedgerRepository;

impl LedgerRepository {
    /// Find all ledgers with optional filters
    pub async fn find_all(
        pool: &DbPool,
        status: Option<&str>,
        company_name: Option<&str>,
        expense_type: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<CustomerLedger>, ApiError> {
        sqlx::query_as::<_, CustomerLedger>(
            r#"
            SELECT id, company_name, company_registration_number, contact_person,
                   contact_email, contact_phone, billing_address_line1, billing_city,
                   billing_state, billing_postal_code, billing_country, description,
                   expense_type, amount, currency, status, paid_amount, balance_due,
                   payment_method, payment_reference, payment_date, booking_id, guest_id,
                   invoice_number, invoice_date, due_date, notes, internal_notes,
                   created_by, updated_by, created_at, updated_at
            FROM customer_ledgers
            WHERE ($1::text IS NULL OR status = $1)
              AND ($2::text IS NULL OR company_name ILIKE '%' || $2 || '%')
              AND ($3::text IS NULL OR expense_type = $3)
            ORDER BY created_at DESC
            LIMIT $4 OFFSET $5
            "#
        )
        .bind(status)
        .bind(company_name)
        .bind(expense_type)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find ledger by ID
    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Option<CustomerLedger>, ApiError> {
        sqlx::query_as::<_, CustomerLedger>(
            r#"
            SELECT id, company_name, company_registration_number, contact_person,
                   contact_email, contact_phone, billing_address_line1, billing_city,
                   billing_state, billing_postal_code, billing_country, description,
                   expense_type, amount, currency, status, paid_amount, balance_due,
                   payment_method, payment_reference, payment_date, booking_id, guest_id,
                   invoice_number, invoice_date, due_date, notes, internal_notes,
                   created_by, updated_by, created_at, updated_at
            FROM customer_ledgers
            WHERE id = $1
            "#
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get payments for a ledger
    pub async fn get_payments(pool: &DbPool, ledger_id: i64) -> Result<Vec<CustomerLedgerPayment>, ApiError> {
        sqlx::query_as::<_, CustomerLedgerPayment>(
            r#"
            SELECT id, ledger_id, payment_amount, payment_method, payment_reference,
                   payment_date, receipt_number, receipt_file_url, notes, processed_by, created_at
            FROM customer_ledger_payments
            WHERE ledger_id = $1
            ORDER BY payment_date DESC
            "#
        )
        .bind(ledger_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Record a payment
    pub async fn record_payment(
        pool: &DbPool,
        ledger_id: i64,
        payment_amount: Decimal,
        payment_method: &str,
        payment_reference: Option<&str>,
        processed_by: i64,
    ) -> Result<CustomerLedgerPayment, ApiError> {
        sqlx::query_as::<_, CustomerLedgerPayment>(
            r#"
            INSERT INTO customer_ledger_payments (
                ledger_id, payment_amount, payment_method, payment_reference,
                payment_date, processed_by
            )
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
            RETURNING id, ledger_id, payment_amount, payment_method, payment_reference,
                      payment_date, receipt_number, receipt_file_url, notes, processed_by, created_at
            "#
        )
        .bind(ledger_id)
        .bind(payment_amount)
        .bind(payment_method)
        .bind(payment_reference)
        .bind(processed_by)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Update ledger paid amount and status
    pub async fn update_payment_status(
        pool: &DbPool,
        ledger_id: i64,
        paid_amount: Decimal,
        status: &str,
        updated_by: i64,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE customer_ledgers
            SET paid_amount = $1, status = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            "#
        )
        .bind(paid_amount)
        .bind(status)
        .bind(updated_by)
        .bind(ledger_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Check if ledger exists
    pub async fn exists(pool: &DbPool, id: i64) -> Result<bool, ApiError> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM customer_ledgers WHERE id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(count > 0)
    }

    /// Get ledger summary statistics
    pub async fn get_summary(pool: &DbPool) -> Result<(i64, Decimal, Decimal, Decimal, i64, i64, i64), ApiError> {
        sqlx::query_as(
            r#"
            SELECT
                COUNT(*) as total_entries,
                COALESCE(SUM(amount), 0) as total_amount,
                COALESCE(SUM(paid_amount), 0) as total_paid,
                COALESCE(SUM(balance_due), 0) as total_outstanding,
                COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
                COUNT(*) FILTER (WHERE status = 'partial') as partial_count,
                COUNT(*) FILTER (WHERE status = 'overdue') as overdue_count
            FROM customer_ledgers
            WHERE status NOT IN ('cancelled')
            "#
        )
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }
}
