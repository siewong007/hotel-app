//! Payment handlers
//!
//! Handles payments, invoices, and billing.

use axum::{
    Json,
    extract::{Extension, Path, State},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::payments;

/// Recompute and persist `bookings.payment_status` for a single booking.
///
/// Kept as a public compatibility wrapper because booking handlers call this
/// helper during their own refactor path.
pub async fn recompute_payment_status(pool: &DbPool, booking_id: i64) -> Result<(), ApiError> {
    payments::recompute_payment_status(pool, booking_id).await
}

/// Create a payment for a booking
pub async fn create_payment_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<PaymentRequest>,
) -> Result<Json<Payment>, ApiError> {
    Ok(Json(
        payments::create_payment(&pool, user_id, request).await?,
    ))
}

/// Record an explicit payment for a booking
pub async fn record_payment_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<RecordPaymentRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        payments::record_payment(&pool, user_id, request).await?,
    ))
}

/// Get all payments for a booking
pub async fn get_all_payments_handler(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    Ok(Json(payments::get_all_payments(&pool, booking_id).await?))
}

/// Get booking-level payment workflow totals and next action.
pub async fn get_payment_workflow_summary_handler(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
) -> Result<Json<PaymentWorkflowSummary>, ApiError> {
    Ok(Json(
        payments::get_payment_workflow_summary(&pool, booking_id).await?,
    ))
}

/// Refund keycard deposit for a booking
pub async fn refund_deposit_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        payments::refund_deposit(&pool, user_id, booking_id, body).await?,
    ))
}

/// Get payment for a booking
pub async fn get_payment_handler(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
) -> Result<Json<Option<Payment>>, ApiError> {
    Ok(Json(payments::get_payment(&pool, booking_id).await?))
}

/// Calculate payment summary for a booking (before actual payment)
pub async fn calculate_payment_summary_handler(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
) -> Result<Json<PaymentSummary>, ApiError> {
    Ok(Json(
        payments::calculate_payment_summary(&pool, booking_id).await?,
    ))
}

/// Generate an invoice for a booking
pub async fn generate_invoice_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<Invoice>, ApiError> {
    Ok(Json(
        payments::generate_invoice(&pool, user_id, booking_id).await?,
    ))
}

/// Get invoice preview with all details
pub async fn get_invoice_preview_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<InvoicePreview>, ApiError> {
    Ok(Json(
        payments::get_invoice_preview(&pool, user_id, booking_id).await?,
    ))
}

/// Get all invoices for a user
pub async fn get_user_invoices_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<Invoice>>, ApiError> {
    Ok(Json(payments::get_user_invoices(&pool, user_id).await?))
}

/// Update a payment record
pub async fn update_payment_handler(
    State(pool): State<DbPool>,
    Path(payment_id): Path<i64>,
    Json(request): Json<UpdatePaymentRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        payments::update_payment(&pool, payment_id, request).await?,
    ))
}

/// Delete a payment record
pub async fn delete_payment_handler(
    State(pool): State<DbPool>,
    Path(payment_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(payments::delete_payment(&pool, payment_id).await?))
}

/// Ensure an invoice row exists for the given booking. Idempotent.
///
/// Kept as a public compatibility wrapper because checkout currently calls
/// this handler helper directly.
pub async fn ensure_invoice_for_booking(
    pool: &DbPool,
    booking_id: i64,
    user_id: i64,
) -> Result<String, ApiError> {
    payments::ensure_invoice_for_booking(pool, booking_id, user_id).await
}
