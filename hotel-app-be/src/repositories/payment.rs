//! Payment repository for database operations

use rust_decimal::Decimal;
use sqlx::PgPool;
use crate::core::error::ApiError;
use crate::models::{Payment, Invoice};

pub struct PaymentRepository;

impl PaymentRepository {
    /// Find payment by booking ID
    pub async fn find_by_booking_id(pool: &PgPool, booking_id: i64) -> Result<Option<Payment>, ApiError> {
        sqlx::query_as::<_, Payment>(
            r#"
            SELECT id, booking_id, user_id, payment_method, payment_status,
                   subtotal, service_charge, tax_amount, keycard_deposit, total_amount,
                   transaction_reference, payment_gateway, card_last_four, card_brand,
                   bank_name, account_reference, notes, created_at
            FROM payments
            WHERE booking_id = $1
            ORDER BY created_at DESC
            LIMIT 1
            "#
        )
        .bind(booking_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find all payments for a booking
    pub async fn find_all_by_booking_id(pool: &PgPool, booking_id: i64) -> Result<Vec<Payment>, ApiError> {
        sqlx::query_as::<_, Payment>(
            r#"
            SELECT id, booking_id, user_id, payment_method, payment_status,
                   subtotal, service_charge, tax_amount, keycard_deposit, total_amount,
                   transaction_reference, payment_gateway, card_last_four, card_brand,
                   bank_name, account_reference, notes, created_at
            FROM payments
            WHERE booking_id = $1
            ORDER BY created_at DESC
            "#
        )
        .bind(booking_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Create a payment
    pub async fn create(
        pool: &PgPool,
        booking_id: i64,
        user_id: i64,
        payment_method: &str,
        subtotal: Decimal,
        service_charge: Decimal,
        tax_amount: Decimal,
        keycard_deposit: Decimal,
        total_amount: Decimal,
    ) -> Result<Payment, ApiError> {
        sqlx::query_as::<_, Payment>(
            r#"
            INSERT INTO payments (
                booking_id, user_id, payment_method, payment_status,
                subtotal, service_charge, tax_amount, keycard_deposit, total_amount
            )
            VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8)
            RETURNING id, booking_id, user_id, payment_method, payment_status,
                      subtotal, service_charge, tax_amount, keycard_deposit, total_amount,
                      transaction_reference, payment_gateway, card_last_four, card_brand,
                      bank_name, account_reference, notes, created_at
            "#
        )
        .bind(booking_id)
        .bind(user_id)
        .bind(payment_method)
        .bind(subtotal)
        .bind(service_charge)
        .bind(tax_amount)
        .bind(keycard_deposit)
        .bind(total_amount)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Update payment status
    pub async fn update_status(pool: &PgPool, id: i64, status: &str) -> Result<(), ApiError> {
        sqlx::query("UPDATE payments SET payment_status = $1 WHERE id = $2")
            .bind(status)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Find invoice by booking ID
    pub async fn find_invoice_by_booking_id(pool: &PgPool, booking_id: i64) -> Result<Option<Invoice>, ApiError> {
        sqlx::query_as::<_, Invoice>(
            r#"
            SELECT id, uuid, invoice_number, booking_id, user_id,
                   billing_name, billing_address, billing_email,
                   invoice_date, issue_date, due_date,
                   check_in_date, check_out_date, number_of_nights,
                   room_number, room_type, subtotal, tax_amount,
                   discount_amount, total_amount, paid_amount, balance_due,
                   currency, status, notes, created_at, updated_at
            FROM invoices
            WHERE booking_id = $1
            ORDER BY created_at DESC
            LIMIT 1
            "#
        )
        .bind(booking_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find invoice by invoice number
    pub async fn find_invoice_by_number(pool: &PgPool, invoice_number: &str) -> Result<Option<Invoice>, ApiError> {
        sqlx::query_as::<_, Invoice>(
            r#"
            SELECT id, uuid, invoice_number, booking_id, user_id,
                   billing_name, billing_address, billing_email,
                   invoice_date, issue_date, due_date,
                   check_in_date, check_out_date, number_of_nights,
                   room_number, room_type, subtotal, tax_amount,
                   discount_amount, total_amount, paid_amount, balance_due,
                   currency, status, notes, created_at, updated_at
            FROM invoices
            WHERE invoice_number = $1
            "#
        )
        .bind(invoice_number)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }
}
