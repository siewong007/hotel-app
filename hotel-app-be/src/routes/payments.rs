//! Payment routes
//!
//! Routes for payments and invoices.

use axum::{
    routing::{get, post},
    Router,
    extract::{State, Path},
    http::HeaderMap,
    response::Json,
};
use crate::core::db::DbPool;
use crate::handlers;
use crate::models;
use crate::core::error::ApiError;

/// Create payment routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        // Payment routes
        .route("/payments/calculate/:booking_id", get(calculate_payment))
        .route("/payments/record-payment", post(record_payment))
        .route("/payments/all-payments/:booking_id", get(get_all_payments))
        .route("/payments/refund-deposit/:booking_id", post(refund_deposit))
        .route("/payments/booking/:booking_id", get(get_payment))
        .route("/payments", post(create_payment))
        // Invoice routes
        .route("/invoices/preview/:booking_id", get(get_invoice_preview))
        .route("/invoices/generate/:booking_id", post(generate_invoice))
        .route("/invoices", get(get_user_invoices))
}

async fn calculate_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::PaymentSummary>, ApiError> {
    handlers::payments::calculate_payment_summary_handler(State(pool), headers, path).await
}

async fn create_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::PaymentRequest>,
) -> Result<Json<models::Payment>, ApiError> {
    handlers::payments::create_payment_handler(State(pool), headers, Json(input)).await
}

async fn get_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Option<models::Payment>>, ApiError> {
    handlers::payments::get_payment_handler(State(pool), headers, path).await
}

async fn record_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::RecordPaymentRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::payments::record_payment_handler(State(pool), headers, Json(input)).await
}

async fn get_all_payments(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    handlers::payments::get_all_payments_handler(State(pool), headers, path).await
}

async fn refund_deposit(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::payments::refund_deposit_handler(State(pool), headers, path, Json(body)).await
}

async fn get_invoice_preview(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::InvoicePreview>, ApiError> {
    handlers::payments::get_invoice_preview_handler(State(pool), headers, path).await
}

async fn generate_invoice(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::Invoice>, ApiError> {
    handlers::payments::generate_invoice_handler(State(pool), headers, path).await
}

async fn get_user_invoices(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::Invoice>>, ApiError> {
    handlers::payments::get_user_invoices_handler(State(pool), headers).await
}
