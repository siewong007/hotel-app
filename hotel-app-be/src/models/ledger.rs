//! Customer ledger models

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Customer ledger entry with PAT-style fields
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
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
    pub payment_date: Option<DateTime<Utc>>,
    pub booking_id: Option<i64>,
    pub guest_id: Option<i64>,
    pub invoice_number: Option<String>,
    pub invoice_date: Option<NaiveDate>,
    pub due_date: Option<NaiveDate>,
    pub notes: Option<String>,
    pub internal_notes: Option<String>,
    pub created_by: Option<i64>,
    pub updated_by: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // PAT-style fields
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
    pub posted_at: Option<DateTime<Utc>>,
    pub void_at: Option<DateTime<Utc>>,
    pub void_by: Option<i64>,
    pub void_reason: Option<String>,
}

/// Input for creating a customer ledger entry with PAT-style fields
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
    // PAT-style fields
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

/// Input for updating a customer ledger entry with PAT-style fields
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
    // PAT-style fields
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
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CustomerLedgerPayment {
    pub id: i64,
    pub ledger_id: i64,
    pub payment_amount: Decimal,
    pub payment_method: String,
    pub payment_reference: Option<String>,
    pub payment_date: DateTime<Utc>,
    pub receipt_number: Option<String>,
    pub receipt_file_url: Option<String>,
    pub notes: Option<String>,
    pub processed_by: Option<i64>,
    pub created_at: DateTime<Utc>,
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
}

/// Ledger with payment history
#[derive(Debug, Serialize, Deserialize)]
pub struct CustomerLedgerWithPayments {
    pub ledger: CustomerLedger,
    pub payments: Vec<CustomerLedgerPayment>,
}

/// PAT Transaction Code
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PatTransactionCode {
    pub id: i32,
    pub code: String,
    pub name: String,
    pub post_type: String,
    pub department_code: Option<String>,
    pub default_amount: Option<Decimal>,
    pub is_taxable: bool,
    pub is_service_chargeable: bool,
    pub gl_account_code: Option<String>,
    pub is_active: bool,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
}

/// PAT Department Code
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PatDepartmentCode {
    pub id: i32,
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
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
