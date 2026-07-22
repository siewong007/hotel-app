//! Payment routes
//!
//! Routes for payments and invoices.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::Json,
    routing::{delete, get, patch, post, put},
};

const PAYMENTS_READ: &str = "payments:read";
const PAYMENTS_CREATE: &str = "payments:create";
const PAYMENTS_UPDATE: &str = "payments:update";
const PAYMENTS_DELETE: &str = "payments:delete";
// Deposit refunds/reverts are part of routine front-desk checkout, so they
// gate on a dedicated payments:refund (held by receptionist + manager) rather
// than payments:manage; payments:manage still implies it via rbac_cache.
const PAYMENTS_REFUND: &str = "payments:refund";
// Guest-payment claim review (approve/reject). Held by manager/admin; any role
// with payments:manage is auto-covered via rbac_cache.
const PAYMENTS_APPROVE: &str = "payments:approve";

/// Create payment routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        // Payment routes
        .route("/payments/calculate/{booking_id}", get(calculate_payment))
        .route("/payments/record-payment", post(record_payment))
        .route("/payments/all-payments/{booking_id}", get(get_all_payments))
        .route(
            "/payments/workflow-summary/{booking_id}",
            get(get_payment_workflow_summary),
        )
        .route(
            "/payments/refund-deposit/{booking_id}",
            post(refund_deposit),
        )
        .route(
            "/payments/revert-deposit-refund/{booking_id}",
            post(revert_deposit_refund),
        )
        .route("/payments/booking/{booking_id}", get(get_payment))
        .route("/payments/{payment_id}", patch(update_payment))
        .route("/payments/{payment_id}", delete(delete_payment))
        .route("/payments", post(create_payment))
        // Guest-payment claim review queue (staff)
        .route("/admin/payments/pending", get(list_pending_payments))
        .route("/admin/payments/{payment_id}/approve", put(approve_payment))
        .route("/admin/payments/{payment_id}/reject", put(reject_payment))
        // Invoice routes
        .route("/invoices/preview/{booking_id}", get(get_invoice_preview))
        .route("/invoices/generate/{booking_id}", post(generate_invoice))
        .route("/invoices", get(get_user_invoices))
}

async fn calculate_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::PaymentSummary>, ApiError> {
    require_permission_helper(&pool, &headers, PAYMENTS_READ).await?;
    handlers::payments::calculate_payment_summary_handler(State(pool), path).await
}

async fn create_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::PaymentRequest>,
) -> Result<Json<models::Payment>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, PAYMENTS_CREATE).await?;
    handlers::payments::create_payment_handler(State(pool), Extension(user_id), Json(input)).await
}

async fn get_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Option<models::Payment>>, ApiError> {
    require_permission_helper(&pool, &headers, PAYMENTS_READ).await?;
    handlers::payments::get_payment_handler(State(pool), path).await
}

async fn record_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::RecordPaymentRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, PAYMENTS_CREATE).await?;
    handlers::payments::record_payment_handler(State(pool), Extension(user_id), Json(input)).await
}

async fn get_all_payments(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_permission_helper(&pool, &headers, PAYMENTS_READ).await?;
    handlers::payments::get_all_payments_handler(State(pool), path).await
}

async fn get_payment_workflow_summary(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::PaymentWorkflowSummary>, ApiError> {
    require_permission_helper(&pool, &headers, PAYMENTS_READ).await?;
    handlers::payments::get_payment_workflow_summary_handler(State(pool), path).await
}

async fn refund_deposit(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, PAYMENTS_REFUND).await?;
    handlers::payments::refund_deposit_handler(State(pool), Extension(user_id), path, Json(body))
        .await
}

async fn revert_deposit_refund(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, PAYMENTS_REFUND).await?;
    handlers::payments::revert_deposit_refund_handler(State(pool), Extension(user_id), path).await
}

async fn get_invoice_preview(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::InvoicePreview>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, PAYMENTS_READ).await?;
    handlers::payments::get_invoice_preview_handler(State(pool), Extension(user_id), path).await
}

async fn generate_invoice(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::Invoice>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, PAYMENTS_CREATE).await?;
    handlers::payments::generate_invoice_handler(State(pool), Extension(user_id), path).await
}

async fn get_user_invoices(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::Invoice>>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, PAYMENTS_READ).await?;
    handlers::payments::get_user_invoices_handler(State(pool), Extension(user_id)).await
}

async fn update_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::UpdatePaymentRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, PAYMENTS_UPDATE).await?;
    handlers::payments::update_payment_handler(State(pool), Extension(user_id), path, Json(input))
        .await
}

async fn delete_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, PAYMENTS_DELETE).await?;
    handlers::payments::delete_payment_handler(State(pool), Extension(user_id), path).await
}

async fn list_pending_payments(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::PendingPaymentsQuery>,
) -> Result<Json<models::PendingPaymentPage>, ApiError> {
    require_permission_helper(&pool, &headers, PAYMENTS_READ).await?;
    handlers::payments::list_pending_payments_handler(State(pool), query).await
}

async fn approve_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::PaymentActionResponse>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, PAYMENTS_APPROVE).await?;
    handlers::payments::approve_payment_handler(State(pool), Extension(user_id), path).await
}

async fn reject_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(body): Json<models::RejectPaymentRequest>,
) -> Result<Json<models::PaymentActionResponse>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, PAYMENTS_APPROVE).await?;
    handlers::payments::reject_payment_handler(State(pool), Extension(user_id), path, Json(body))
        .await
}
