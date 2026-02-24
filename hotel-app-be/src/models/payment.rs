//! Payment and invoice models

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Payment status enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, sqlx::Type)]
#[sqlx(type_name = "varchar", rename_all = "snake_case")]
pub enum PaymentStatus {
    Pending,
    Processing,
    Completed,
    Failed,
    Refunded,
    Cancelled,
}

impl std::fmt::Display for PaymentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PaymentStatus::Pending => write!(f, "pending"),
            PaymentStatus::Processing => write!(f, "processing"),
            PaymentStatus::Completed => write!(f, "completed"),
            PaymentStatus::Failed => write!(f, "failed"),
            PaymentStatus::Refunded => write!(f, "refunded"),
            PaymentStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

/// Payment method enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PaymentMethod {
    Cash,
    Card,
    BankTransfer,
    Duitnow,
    OnlineBanking,
    Cheque,
    Other,
}

impl std::fmt::Display for PaymentMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PaymentMethod::Cash => write!(f, "cash"),
            PaymentMethod::Card => write!(f, "card"),
            PaymentMethod::BankTransfer => write!(f, "bank_transfer"),
            PaymentMethod::Duitnow => write!(f, "duitnow"),
            PaymentMethod::OnlineBanking => write!(f, "online_banking"),
            PaymentMethod::Cheque => write!(f, "cheque"),
            PaymentMethod::Other => write!(f, "other"),
        }
    }
}

/// Payment request input
#[derive(Debug, Serialize, Deserialize)]
pub struct PaymentRequest {
    pub booking_id: i64,
    pub payment_method: PaymentMethod,
    pub amount: Option<f64>,
    pub transaction_reference: Option<String>,
    pub card_last_four: Option<String>,
    pub card_brand: Option<String>,
    pub bank_name: Option<String>,
    pub account_reference: Option<String>,
    pub notes: Option<String>,
}

/// Payment record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Payment {
    pub id: i64,
    pub booking_id: i64,
    pub user_id: Option<i64>,
    pub payment_method: String,
    pub payment_status: String,
    pub subtotal: Decimal,
    pub service_charge: Decimal,
    pub tax_amount: Decimal,
    pub keycard_deposit: Decimal,
    pub total_amount: Decimal,
    pub transaction_reference: Option<String>,
    pub payment_gateway: Option<String>,
    pub card_last_four: Option<String>,
    pub card_brand: Option<String>,
    pub bank_name: Option<String>,
    pub account_reference: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Payment summary for display
#[derive(Debug, Serialize, Deserialize)]
pub struct PaymentSummary {
    pub subtotal: Decimal,
    pub service_charge: Decimal,
    pub service_charge_percentage: Decimal,
    pub tax_amount: Decimal,
    pub tax_percentage: Decimal,
    pub keycard_deposit: Decimal,
    pub total_amount: Decimal,
    pub payment_method: Option<String>,
}

/// Invoice record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Invoice {
    pub id: i64,
    pub uuid: Uuid,
    pub invoice_number: String,
    pub booking_id: i64,
    pub user_id: Option<i64>,
    pub billing_name: String,
    pub billing_address: Option<String>,
    pub billing_email: Option<String>,
    pub invoice_date: Option<NaiveDate>,
    pub issue_date: NaiveDate,
    pub due_date: Option<NaiveDate>,
    pub check_in_date: Option<NaiveDate>,
    pub check_out_date: Option<NaiveDate>,
    pub number_of_nights: Option<i32>,
    pub room_number: Option<String>,
    pub room_type: Option<String>,
    pub subtotal: Decimal,
    pub tax_amount: Decimal,
    pub discount_amount: Decimal,
    pub total_amount: Decimal,
    pub paid_amount: Decimal,
    pub balance_due: Decimal,
    pub currency: String,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Invoice preview with related data
#[derive(Debug, Serialize, Deserialize)]
pub struct InvoicePreview {
    pub invoice: Invoice,
    pub payment: Option<Payment>,
    pub booking_details: serde_json::Value,
}

/// Invoice line item
#[derive(Debug, Serialize, Deserialize)]
pub struct InvoiceLineItem {
    pub description: String,
    pub quantity: i32,
    pub unit_price: Decimal,
    pub total: Decimal,
}

/// Record payment request (explicit payment recording)
#[derive(Debug, Serialize, Deserialize)]
pub struct RecordPaymentRequest {
    pub booking_id: i64,
    pub amount: f64,
    pub payment_method: String,
    pub payment_type: Option<String>,
    pub transaction_reference: Option<String>,
    pub notes: Option<String>,
}

/// Keycard deposit record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct KeycardDeposit {
    pub id: i64,
    pub booking_id: i64,
    pub payment_id: i64,
    pub deposit_amount: Decimal,
    pub deposit_status: String,
    pub returned_at: Option<DateTime<Utc>>,
    pub returned_by: Option<i64>,
    pub created_at: DateTime<Utc>,
}
