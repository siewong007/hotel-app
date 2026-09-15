//! Payment handlers
//!
//! Handles payments, invoices, and billing.

use axum::{
    body::Body,
    extract::{Extension, Path, Query, State},
    http::{HeaderValue, header},
    response::{Json, Response},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use super::service;

/// Recompute and persist `bookings.payment_status` for a single booking.
///
/// Kept as a public compatibility wrapper because booking handlers call this
/// helper during their own refactor path.
pub async fn recompute_payment_status(pool: &DbPool, booking_id: i64) -> Result<(), ApiError> {
    service::recompute_payment_status(pool, booking_id).await
}

/// Create a payment for a booking
pub async fn create_payment_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<PaymentRequest>,
) -> Result<Json<Payment>, ApiError> {
    Ok(Json(
        service::create_payment(&pool, user_id, request).await?,
    ))
}

/// Record an explicit payment for a booking
pub async fn record_payment_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<RecordPaymentRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        service::record_payment(&pool, user_id, request).await?,
    ))
}

/// Get all payments for a booking
pub async fn get_all_payments_handler(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    Ok(Json(service::get_all_payments(&pool, booking_id).await?))
}

/// Get booking-level payment workflow totals and next action.
pub async fn get_payment_workflow_summary_handler(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
) -> Result<Json<PaymentWorkflowSummary>, ApiError> {
    Ok(Json(
        service::get_payment_workflow_summary(&pool, booking_id).await?,
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
        service::refund_deposit(&pool, user_id, booking_id, body).await?,
    ))
}

/// Revert a keycard deposit refund recorded by mistake
pub async fn revert_deposit_refund_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        service::revert_deposit_refund(&pool, user_id, booking_id).await?,
    ))
}

/// Revert a voided (cancelled) deposit for a booking
pub async fn revert_deposit_void_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        service::revert_deposit_void(&pool, user_id, booking_id).await?,
    ))
}

/// Forfeit part or all of a booking's held keycard deposit
pub async fn forfeit_deposit_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        service::forfeit_deposit(&pool, user_id, booking_id, body).await?,
    ))
}

/// Get payment for a booking
pub async fn get_payment_handler(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
) -> Result<Json<Option<Payment>>, ApiError> {
    Ok(Json(service::get_payment(&pool, booking_id).await?))
}

/// Calculate payment summary for a booking (before actual payment)
pub async fn calculate_payment_summary_handler(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
) -> Result<Json<PaymentSummary>, ApiError> {
    Ok(Json(
        service::calculate_payment_summary(&pool, booking_id).await?,
    ))
}

/// Generate an invoice for a booking
pub async fn generate_invoice_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<Invoice>, ApiError> {
    Ok(Json(
        service::generate_invoice(&pool, user_id, booking_id).await?,
    ))
}

/// Get invoice preview with all details
pub async fn get_invoice_preview_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<InvoicePreview>, ApiError> {
    Ok(Json(
        service::get_invoice_preview(&pool, user_id, booking_id).await?,
    ))
}

/// Get all invoices for a user
pub async fn get_user_invoices_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<Invoice>>, ApiError> {
    Ok(Json(service::get_user_invoices(&pool, user_id).await?))
}

/// Update a payment record
pub async fn update_payment_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(payment_id): Path<i64>,
    Json(request): Json<UpdatePaymentRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        service::update_payment(&pool, user_id, payment_id, request).await?,
    ))
}

/// Delete a payment record
pub async fn delete_payment_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(payment_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        service::delete_payment(&pool, user_id, payment_id).await?,
    ))
}

/// Staff: list pending payment claims awaiting review (paginated).
pub async fn list_pending_payments_handler(
    State(pool): State<DbPool>,
    Query(query): Query<PendingPaymentsQuery>,
) -> Result<Json<PendingPaymentPage>, ApiError> {
    let (limit, offset) = query.limit_offset();
    Ok(Json(
        service::list_pending_payments(&pool, limit, offset).await?,
    ))
}

pub async fn list_payment_approval_history_handler(
    State(pool): State<DbPool>,
    Query(query): Query<PendingPaymentsQuery>,
) -> Result<Json<PendingPaymentPage>, ApiError> {
    let (limit, offset) = query.limit_offset();
    Ok(Json(
        service::list_payment_approval_history(&pool, limit, offset).await?,
    ))
}

/// Audit actions the payment-approvals conflict banner surfaces. Mirrors the
/// list the frontend previously fanned out over the generic audit-logs
/// endpoint — pinned here so the route stays a narrow read.
const PAYPAL_CONFLICT_ACTIONS: [&str; 2] =
    ["paypal_webhook_conflict", "paypal_capture_conflict"];
const PAYPAL_CONFLICT_LOOKBACK_DAYS: i64 = 30;
const PAYPAL_CONFLICT_LIMIT: i64 = 50;

/// Staff: recent PayPal payment/webhook conflicts for the approvals banner.
/// Deliberately separate from `/audit-logs`: approvers hold `payments:read`
/// but not `audit:read`, and the banner must not widen that grant.
pub async fn list_paypal_conflict_events_handler(
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let (events, total) = crate::services::audit::get_recent_events_by_actions(
        &pool,
        &PAYPAL_CONFLICT_ACTIONS,
        PAYPAL_CONFLICT_LOOKBACK_DAYS,
        PAYPAL_CONFLICT_LIMIT,
    )
    .await?;
    Ok(Json(serde_json::json!({
        "events": events,
        "total": total,
    })))
}

pub async fn download_payment_receipt_handler(
    State(pool): State<DbPool>,
    Path(payment_id): Path<i64>,
) -> Result<Response, ApiError> {
    let (bytes, content_type) = service::load_payment_receipt(&pool, payment_id).await?;
    let content_type = HeaderValue::from_str(&content_type).map_err(|_| {
        ApiError::Internal("Stored receipt has an invalid content type.".to_string())
    })?;
    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=payment-receipt-{payment_id}"),
        )
        .body(Body::from(bytes))
        .map_err(|_| ApiError::Internal("Unable to return the receipt.".to_string()))
}

/// Staff: approve a pending payment (completes payment + confirms booking).
pub async fn approve_payment_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(payment_id): Path<i64>,
) -> Result<Json<PaymentActionResponse>, ApiError> {
    Ok(Json(
        service::approve_payment(&pool, user_id, payment_id).await?,
    ))
}

/// Staff: ask a guest to provide a receipt for a pending bank transfer.
pub async fn request_payment_receipt_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(payment_id): Path<i64>,
    Json(request): Json<RequestPaymentReceiptRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    service::request_payment_receipt(&pool, user_id, payment_id, request.message.as_deref())
        .await?;
    Ok(Json(serde_json::json!({ "requested": true })))
}

/// Staff: reject a pending payment (booking stays pending).
pub async fn reject_payment_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(payment_id): Path<i64>,
    Json(request): Json<RejectPaymentRequest>,
) -> Result<Json<PaymentActionResponse>, ApiError> {
    Ok(Json(
        service::reject_payment(&pool, user_id, payment_id, &request.reason).await?,
    ))
}
