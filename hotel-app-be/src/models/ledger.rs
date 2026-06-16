//! Customer ledger models

use chrono::{NaiveDate, NaiveDateTime};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// Customer ledger entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomerLedger {
    pub id: i64,
    pub company_name: String,
    pub company_registration_number: Option<String>,
    pub contact_person: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub billing_address_line1: Option<String>,
    pub billing_city: Option<String>,
    pub billing_state: Option<String>,
    pub billing_postal_code: Option<String>,
    pub billing_country: Option<String>,
    pub description: String,
    pub expense_type: String,
    pub amount: Decimal,
    pub currency: Option<String>,
    pub status: String,
    pub paid_amount: Decimal,
    pub balance_due: Decimal,
    pub payment_method: Option<String>,
    pub payment_reference: Option<String>,
    pub payment_date: Option<NaiveDateTime>,
    pub booking_id: Option<i64>,
    pub guest_id: Option<i64>,
    pub invoice_number: Option<String>,
    pub invoice_date: Option<NaiveDate>,
    pub due_date: Option<NaiveDate>,
    pub notes: Option<String>,
    pub internal_notes: Option<String>,
    pub created_by: Option<i64>,
    pub updated_by: Option<i64>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    // Ledger accounting fields
    pub folio_number: Option<String>,
    pub folio_type: Option<String>,
    pub transaction_type: Option<String>,
    pub post_type: Option<String>,
    pub department_code: Option<String>,
    pub transaction_code: Option<String>,
    pub room_number: Option<String>,
    pub posting_date: Option<NaiveDate>,
    pub transaction_date: Option<NaiveDate>,
    pub reference_number: Option<String>,
    pub cashier_id: Option<i64>,
    pub is_reversal: Option<bool>,
    pub original_transaction_id: Option<i64>,
    pub reversal_reason: Option<String>,
    pub tax_amount: Option<Decimal>,
    pub service_charge: Option<Decimal>,
    pub net_amount: Option<Decimal>,
    pub is_posted: Option<bool>,
    pub posted_at: Option<NaiveDateTime>,
    pub void_at: Option<NaiveDateTime>,
    pub void_by: Option<i64>,
    pub void_reason: Option<String>,
}

/// Input for creating a customer ledger entry.
#[derive(Debug, Serialize, Deserialize)]
pub struct CustomerLedgerCreateRequest {
    pub company_name: String,
    pub company_registration_number: Option<String>,
    pub contact_person: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub billing_address_line1: Option<String>,
    pub billing_city: Option<String>,
    pub billing_state: Option<String>,
    pub billing_postal_code: Option<String>,
    pub billing_country: Option<String>,
    pub description: String,
    pub expense_type: String,
    pub amount: f64,
    pub currency: Option<String>,
    pub booking_id: Option<i64>,
    pub guest_id: Option<i64>,
    pub invoice_date: Option<String>,
    pub due_date: Option<String>,
    pub notes: Option<String>,
    pub internal_notes: Option<String>,
    // Ledger accounting fields
    pub folio_type: Option<String>,
    pub transaction_type: Option<String>,
    pub post_type: Option<String>,
    pub department_code: Option<String>,
    pub transaction_code: Option<String>,
    pub room_number: Option<String>,
    pub posting_date: Option<String>,
    pub transaction_date: Option<String>,
    pub reference_number: Option<String>,
    pub tax_amount: Option<f64>,
    pub service_charge: Option<f64>,
}

/// Input for updating a customer ledger entry.
#[derive(Debug, Serialize, Deserialize)]
pub struct CustomerLedgerUpdateRequest {
    pub company_name: Option<String>,
    pub company_registration_number: Option<String>,
    pub contact_person: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub billing_address_line1: Option<String>,
    pub billing_city: Option<String>,
    pub billing_state: Option<String>,
    pub billing_postal_code: Option<String>,
    pub billing_country: Option<String>,
    pub description: Option<String>,
    pub expense_type: Option<String>,
    pub amount: Option<f64>,
    pub currency: Option<String>,
    pub status: Option<String>,
    pub booking_id: Option<i64>,
    pub guest_id: Option<i64>,
    pub invoice_date: Option<String>,
    pub due_date: Option<String>,
    pub notes: Option<String>,
    pub internal_notes: Option<String>,
    // Ledger accounting fields
    pub folio_type: Option<String>,
    pub transaction_type: Option<String>,
    pub post_type: Option<String>,
    pub department_code: Option<String>,
    pub transaction_code: Option<String>,
    pub room_number: Option<String>,
    pub posting_date: Option<String>,
    pub transaction_date: Option<String>,
    pub reference_number: Option<String>,
    pub tax_amount: Option<f64>,
    pub service_charge: Option<f64>,
}

/// Customer ledger payment record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomerLedgerPayment {
    pub id: i64,
    pub ledger_id: i64,
    pub payment_amount: Decimal,
    pub payment_method: String,
    pub payment_reference: Option<String>,
    pub payment_date: NaiveDateTime,
    pub receipt_number: Option<String>,
    pub receipt_file_url: Option<String>,
    pub notes: Option<String>,
    pub processed_by: Option<i64>,
    pub created_at: NaiveDateTime,
}

/// Input for creating a ledger payment
#[derive(Debug, Serialize, Deserialize)]
pub struct CustomerLedgerPaymentRequest {
    pub payment_amount: f64,
    pub payment_method: String,
    pub payment_reference: Option<String>,
    pub receipt_number: Option<String>,
    pub receipt_file_url: Option<String>,
    pub notes: Option<String>,
    pub payment_date: Option<String>,
}

/// Input for updating a ledger payment
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateLedgerPaymentRequest {
    pub payment_date: String,
}

/// Ledger with payment history
#[derive(Debug, Serialize, Deserialize)]
pub struct CustomerLedgerWithPayments {
    pub ledger: CustomerLedger,
    pub payments: Vec<CustomerLedgerPayment>,
}

/// Input for creating a ledger reversal
#[derive(Debug, Serialize, Deserialize)]
pub struct LedgerReversalRequest {
    pub reason: String,
    pub notes: Option<String>,
}

/// Input for voiding a ledger entry
#[derive(Debug, Serialize, Deserialize)]
pub struct LedgerVoidRequest {
    pub reason: String,
}

/// Query parameters for listing ledgers.
#[derive(Debug, Deserialize)]
pub struct LedgerListQuery {
    pub status: Option<String>,
    pub company_name: Option<String>,
    pub expense_type: Option<String>,
    pub folio_type: Option<String>,
    pub post_type: Option<String>,
    pub department_code: Option<String>,
    pub room_number: Option<String>,
    pub invoice_state: Option<String>,
    pub balance_state: Option<String>,
    pub ui_status: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    /// Full-text search across company_name, description, invoice_number, contact_person.
    pub search: Option<String>,
    /// Column to sort by (whitelisted).
    pub sort_by: Option<String>,
    /// Sort direction: "asc" or "desc".
    pub sort_order: Option<String>,
}

/// Paginated ledger list response.
#[derive(Debug, Serialize)]
pub struct LedgerPaginatedResponse {
    pub data: Vec<CustomerLedger>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}


impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for CustomerLedger {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(CustomerLedger {
            id: row.try_get("id")?,
            company_name: row.try_get("company_name")?,
            company_registration_number: row.try_get("company_registration_number")?,
            contact_person: row.try_get("contact_person")?,
            contact_email: row.try_get("contact_email")?,
            contact_phone: row.try_get("contact_phone")?,
            billing_address_line1: row.try_get("billing_address_line1")?,
            billing_city: row.try_get("billing_city")?,
            billing_state: row.try_get("billing_state")?,
            billing_postal_code: row.try_get("billing_postal_code")?,
            billing_country: row.try_get("billing_country")?,
            description: row.try_get("description")?,
            expense_type: row.try_get("expense_type")?,
            amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("amount")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("amount")?;
                val
            },
            currency: row.try_get("currency")?,
            status: row.try_get("status")?,
            paid_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("paid_amount")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("paid_amount")?;
                val
            },
            balance_due: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("balance_due")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("balance_due")?;
                val
            },
            payment_method: row.try_get("payment_method")?,
            payment_reference: row.try_get("payment_reference")?,
            payment_date: row.try_get("payment_date")?,
            booking_id: row.try_get("booking_id")?,
            guest_id: row.try_get("guest_id")?,
            invoice_number: row.try_get("invoice_number")?,
            invoice_date: row.try_get("invoice_date")?,
            due_date: row.try_get("due_date")?,
            notes: row.try_get("notes")?,
            internal_notes: row.try_get("internal_notes")?,
            created_by: row.try_get("created_by")?,
            updated_by: row.try_get("updated_by")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            folio_number: row.try_get("folio_number")?,
            folio_type: row.try_get("folio_type")?,
            transaction_type: row.try_get("transaction_type")?,
            post_type: row.try_get("post_type")?,
            department_code: row.try_get("department_code")?,
            transaction_code: row.try_get("transaction_code")?,
            room_number: row.try_get("room_number")?,
            posting_date: row.try_get("posting_date")?,
            transaction_date: row.try_get("transaction_date")?,
            reference_number: row.try_get("reference_number")?,
            cashier_id: row.try_get("cashier_id")?,
            is_reversal: row.try_get("is_reversal")?,
            original_transaction_id: row.try_get("original_transaction_id")?,
            reversal_reason: row.try_get("reversal_reason")?,
            tax_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(row.try_get::<Option<String>, _>("tax_amount")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("tax_amount")?;
                val
            },
            service_charge: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(row.try_get::<Option<String>, _>("service_charge")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("service_charge")?;
                val
            },
            net_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(row.try_get::<Option<String>, _>("net_amount")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("net_amount")?;
                val
            },
            is_posted: row.try_get("is_posted")?,
            posted_at: row.try_get("posted_at")?,
            void_at: row.try_get("void_at")?,
            void_by: row.try_get("void_by")?,
            void_reason: row.try_get("void_reason")?,
        })
    }
}


impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for CustomerLedgerPayment {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(CustomerLedgerPayment {
            id: row.try_get("id")?,
            ledger_id: row.try_get("ledger_id")?,
            payment_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("payment_amount")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("payment_amount")?;
                val
            },
            payment_method: row.try_get("payment_method")?,
            payment_reference: row.try_get("payment_reference")?,
            payment_date: row.try_get("payment_date")?,
            receipt_number: row.try_get("receipt_number")?,
            receipt_file_url: row.try_get("receipt_file_url")?,
            notes: row.try_get("notes")?,
            processed_by: row.try_get("processed_by")?,
            created_at: row.try_get("created_at")?,
        })
    }
}
