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

/// A payment awaiting staff review (bank-transfer claim or pre-capture record),
/// enriched with booking + guest context for the staff approval queue.
/// `amount` and `created_at` are selected as text to decode uniformly across
/// PostgreSQL (numeric/timestamptz) and SQLite (REAL/TEXT).
#[derive(Debug, Serialize, FromRow)]
pub struct PendingPaymentEntry {
    pub id: i64,
    pub booking_id: i64,
    pub booking_number: Option<String>,
    pub guest_id: Option<i64>,
    pub guest_name: Option<String>,
    pub amount: String,
    pub payment_method: String,
    pub status: String,
    pub reference: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub receipt_requested: bool,
    pub receipt_uploaded: bool,
}

/// Paginated wrapper for the staff pending-payments queue.
#[derive(Debug, Serialize)]
pub struct PendingPaymentPage {
    pub items: Vec<PendingPaymentEntry>,
    pub total: i64,
}

/// Public-facing payment configuration for the guest portal payment panel.
/// `paypal_client_id` is public by design; it is only present when the PayPal
/// integration is fully configured.
#[derive(Debug, Serialize)]
pub struct GuestPaymentConfig {
    pub paypal_enabled: bool,
    pub paypal_client_id: Option<String>,
    pub bank_details: GuestBankDetails,
}

/// Hotel bank-transfer display details for the manual payment path.
#[derive(Debug, Serialize)]
pub struct GuestBankDetails {
    pub bank_name: Option<String>,
    pub account_name: Option<String>,
    pub account_number: Option<String>,
}

/// Result of creating a PayPal order (returned to the browser to launch the
/// PayPal approval popup).
#[derive(Debug, Serialize)]
pub struct PaypalCreateOrderResponse {
    pub order_id: String,
    pub payment_id: i64,
}

/// Request body for capturing a previously created PayPal order (token flow —
/// the booking is identified by the path token).
#[derive(Debug, Deserialize)]
pub struct PaypalCaptureRequest {
    pub order_id: String,
    pub payment_id: i64,
}

/// Request body identifying a booking for the session-authenticated guest
/// payment routes (the booking id comes from the body, ownership is verified
/// against the session's guest).
#[derive(Debug, Deserialize)]
pub struct GuestBookingPaymentRequest {
    pub booking_id: i64,
}

/// Request body for capturing a PayPal order on the session-authenticated flow.
#[derive(Debug, Deserialize)]
pub struct SessionPaypalCaptureRequest {
    pub booking_id: i64,
    pub order_id: String,
    pub payment_id: i64,
}

/// Request body for rejecting a payment claim (staff).
#[derive(Debug, Deserialize)]
pub struct RejectPaymentRequest {
    pub reason: String,
}

/// Staff message asking a guest to upload proof for a pending bank transfer.
#[derive(Debug, Deserialize)]
pub struct RequestPaymentReceiptRequest {
    pub message: Option<String>,
}

/// Pagination query for the staff pending-payments queue.
#[derive(Debug, Deserialize)]
pub struct PendingPaymentsQuery {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

impl PendingPaymentsQuery {
    /// Clamp page to >= 1 and per_page to 1..=100 (default 20), returning
    /// (limit, offset).
    pub fn limit_offset(&self) -> (i64, i64) {
        let per_page = self.per_page.unwrap_or(20).clamp(1, 100);
        let page = self.page.unwrap_or(1).max(1);
        (per_page, (page - 1) * per_page)
    }
}

/// Generic acknowledgement returned by the guest payment mutation endpoints.
#[derive(Debug, Serialize)]
pub struct PaymentActionResponse {
    pub payment_id: i64,
    pub status: String,
    pub booking_status: Option<String>,
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

#[derive(Debug, Clone, FromRow)]
pub struct PaidOnlineBookingRoomAssignment {
    pub booking_id: i64,
    pub booking_number: String,
    pub guest_id: i64,
    pub guest_name: String,
    pub guest_email: String,
    pub room_number: String,
    pub room_type_name: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
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

// This manual `FromRow` is currently unreachable (no `query_as::<_, Payment>`
// call sites exist), but is kept so any future adoption maps the SAME real
// columns as `row_mappers::row_to_payment`. Delegating keeps a single source of
// truth instead of two contradictory mappings.
impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for Payment {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        Ok(crate::models::row_mappers::row_to_payment(row))
    }
}

// Unreachable manual `FromRow` (no `query_as::<_, Invoice>` call sites); kept and
// delegated to `row_mappers::row_to_invoice` so a single mapping stays canonical.
impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for Invoice {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        Ok(crate::models::row_mappers::row_to_invoice(row))
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
