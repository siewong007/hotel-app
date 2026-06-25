//! Payment and invoice models

use crate::constants::PaymentMethod;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Booking-level payment workflow summary.
#[derive(Debug, Serialize, Deserialize)]
pub struct PaymentWorkflowSummary {
    pub booking_id: i64,
    pub booking_status: String,
    pub payment_status: String,
    pub total_amount: Decimal,
    pub total_paid: Decimal,
    pub total_refunded: Decimal,
    pub balance_due: Decimal,
    pub deposit_collected: Decimal,
    pub deposit_refunded: Decimal,
    pub has_failed_payment: bool,
    pub next_action: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct PaymentBookingStay {
    pub room_id: i64,
    pub check_in: chrono::NaiveDateTime,
    pub check_out: chrono::NaiveDateTime,
}

#[derive(Debug, Clone)]
pub struct PaymentRoomPricing {
    pub base_price: Decimal,
    pub keycard_deposit: Decimal,
    pub service_charge_percentage: Decimal,
}

#[derive(Debug, Clone, FromRow)]
pub struct PaymentEntryRow {
    pub id: i64,
    pub booking_id: i64,
    pub total_amount: String,
    pub payment_method: String,
    pub payment_type: Option<String>,
    pub payment_status: Option<String>,
    pub transaction_reference: Option<String>,
    pub notes: Option<String>,
    pub payment_date: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl PaymentEntryRow {
    pub fn into_response(self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "booking_id": self.booking_id,
            "total_amount": self.total_amount,
            "payment_method": self.payment_method,
            "payment_type": self.payment_type,
            "payment_status": self.payment_status,
            "transaction_reference": self.transaction_reference,
            "notes": self.notes,
            "payment_date": self.payment_date,
            "created_at": self.created_at,
        })
    }
}

#[derive(Debug, Clone)]
pub struct PaymentWorkflowSummaryRow {
    pub booking_status: String,
    pub payment_status: String,
    pub total_amount: Decimal,
    /// Tourism tax billed to the guest. Stored separately from `total_amount`
    /// (which is room-only), but it is part of what the checkout invoice asks
    /// the guest to settle.
    pub tourism_tax_amount: Decimal,
    /// Extra-bed charge billed to the guest. Like tourism tax, this is invoiced
    /// on top of the room-only `total_amount`.
    pub extra_bed_charge: Decimal,
    pub total_paid: Decimal,
    pub total_refunded: Decimal,
    pub deposit_collected: Decimal,
    pub deposit_refunded: Decimal,
    pub has_failed_payment: bool,
}

impl PaymentWorkflowSummaryRow {
    /// The full amount invoiced to the guest: the room-only `total_amount` plus
    /// ancillary charges (tourism tax, extra bed) that the checkout invoice adds
    /// on top of it. Payment balances are computed against this so a fully
    /// room-paid booking still shows the tourism tax / extra bed as collectable.
    pub fn billable_total(&self) -> Decimal {
        self.total_amount + self.tourism_tax_amount + self.extra_bed_charge
    }
}

#[derive(Debug, Clone)]
pub struct InvoiceBookingDetails {
    pub customer_name: String,
    pub customer_email: String,
    pub customer_phone: Option<String>,
    pub check_in: chrono::NaiveDateTime,
    pub check_out: chrono::NaiveDateTime,
    pub room_id: i64,
    pub room_number: String,
    pub room_type: String,
}

/// Invoice record
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    /// Payment date override (YYYY-MM-DD). Sets created_at to this date.
    pub payment_date: Option<String>,
}

/// Update payment request
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdatePaymentRequest {
    pub amount: Option<f64>,
    pub payment_method: Option<String>,
    pub transaction_reference: Option<String>,
    pub notes: Option<String>,
    /// Payment date override (YYYY-MM-DD). Updates created_at to this date.
    pub payment_date: Option<String>,
}

/// Keycard deposit record
#[derive(Debug, Clone, Serialize, Deserialize)]
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

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for Payment {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Payment {
            id: row.try_get("id")?,
            booking_id: row.try_get("booking_id")?,
            user_id: row.try_get("user_id")?,
            payment_method: row.try_get("payment_method")?,
            payment_status: row.try_get("payment_status")?,
            subtotal: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("subtotal")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("subtotal")?;
                val
            },
            service_charge: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val =
                    crate::core::db::parse_decimal(&row.try_get::<String, _>("service_charge")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("service_charge")?;
                val
            },
            tax_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("tax_amount")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("tax_amount")?;
                val
            },
            keycard_deposit: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val =
                    crate::core::db::parse_decimal(&row.try_get::<String, _>("keycard_deposit")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("keycard_deposit")?;
                val
            },
            total_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val =
                    crate::core::db::parse_decimal(&row.try_get::<String, _>("total_amount")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("total_amount")?;
                val
            },
            transaction_reference: row.try_get("transaction_reference")?,
            payment_gateway: row.try_get("payment_gateway")?,
            card_last_four: row.try_get("card_last_four")?,
            card_brand: row.try_get("card_brand")?,
            bank_name: row.try_get("bank_name")?,
            account_reference: row.try_get("account_reference")?,
            notes: row.try_get("notes")?,
            created_at: row.try_get("created_at")?,
        })
    }
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for Invoice {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Invoice {
            id: row.try_get("id")?,
            uuid: row.try_get("uuid")?,
            invoice_number: row.try_get("invoice_number")?,
            booking_id: row.try_get("booking_id")?,
            user_id: row.try_get("user_id")?,
            billing_name: row.try_get("billing_name")?,
            billing_address: row.try_get("billing_address")?,
            billing_email: row.try_get("billing_email")?,
            invoice_date: row.try_get("invoice_date")?,
            issue_date: row.try_get("issue_date")?,
            due_date: row.try_get("due_date")?,
            check_in_date: row.try_get("check_in_date")?,
            check_out_date: row.try_get("check_out_date")?,
            number_of_nights: row.try_get("number_of_nights")?,
            room_number: row.try_get("room_number")?,
            room_type: row.try_get("room_type")?,
            subtotal: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("subtotal")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("subtotal")?;
                val
            },
            tax_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("tax_amount")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("tax_amount")?;
                val
            },
            discount_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val =
                    crate::core::db::parse_decimal(&row.try_get::<String, _>("discount_amount")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("discount_amount")?;
                val
            },
            total_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val =
                    crate::core::db::parse_decimal(&row.try_get::<String, _>("total_amount")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("total_amount")?;
                val
            },
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
            currency: row.try_get("currency")?,
            status: row.try_get("status")?,
            notes: row.try_get("notes")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for KeycardDeposit {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(KeycardDeposit {
            id: row.try_get("id")?,
            booking_id: row.try_get("booking_id")?,
            payment_id: row.try_get("payment_id")?,
            deposit_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val =
                    crate::core::db::parse_decimal(&row.try_get::<String, _>("deposit_amount")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("deposit_amount")?;
                val
            },
            deposit_status: row.try_get("deposit_status")?,
            returned_at: row.try_get("returned_at")?,
            returned_by: row.try_get("returned_by")?,
            created_at: row.try_get("created_at")?,
        })
    }
}
