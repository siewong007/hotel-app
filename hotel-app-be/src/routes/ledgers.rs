//! Customer ledger routes
//!
//! Routes for customer ledgers and accounts receivable.

use axum::{
    routing::{get, post, patch, delete},
    Router,
    extract::{State, Path, Query},
    http::HeaderMap,
    response::Json,
};
use sqlx::PgPool;
use crate::handlers;
use crate::models;
use crate::core::error::ApiError;

/// Create ledger routes
pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/ledgers", get(list_ledgers))
        .route("/ledgers", post(create_ledger))
        .route("/ledgers/summary", get(get_ledger_summary))
        .route("/ledgers/transaction-codes", get(get_transaction_codes))
        .route("/ledgers/department-codes", get(get_department_codes))
        .route("/ledgers/:id", get(get_ledger))
        .route("/ledgers/:id", patch(update_ledger))
        .route("/ledgers/:id", delete(delete_ledger))
        .route("/ledgers/:id/with-payments", get(get_ledger_with_payments))
        .route("/ledgers/:id/payments", get(get_ledger_payments))
        .route("/ledgers/:id/payments", post(create_ledger_payment))
        .route("/ledgers/:id/void", post(void_ledger))
        .route("/ledgers/:id/reverse", post(reverse_ledger))
}

async fn list_ledgers(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    query: Query<handlers::ledgers::LedgerListQuery>,
) -> Result<Json<Vec<models::CustomerLedger>>, ApiError> {
    handlers::ledgers::list_customer_ledgers_handler(State(pool), headers, query).await
}

async fn create_ledger(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::CustomerLedgerCreateRequest>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    handlers::ledgers::create_customer_ledger_handler(State(pool), headers, Json(input)).await
}

async fn get_ledger_summary(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::ledgers::get_ledger_summary_handler(State(pool), headers).await
}

async fn get_ledger(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    handlers::ledgers::get_customer_ledger_handler(State(pool), headers, path).await
}

async fn update_ledger(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::CustomerLedgerUpdateRequest>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    handlers::ledgers::update_customer_ledger_handler(State(pool), headers, path, Json(input)).await
}

async fn delete_ledger(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::ledgers::delete_customer_ledger_handler(State(pool), headers, path).await
}

async fn get_ledger_with_payments(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::CustomerLedgerWithPayments>, ApiError> {
    handlers::ledgers::get_customer_ledger_with_payments_handler(State(pool), headers, path).await
}

async fn get_ledger_payments(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Vec<models::CustomerLedgerPayment>>, ApiError> {
    handlers::ledgers::get_ledger_payments_handler(State(pool), headers, path).await
}

async fn create_ledger_payment(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::CustomerLedgerPaymentRequest>,
) -> Result<Json<models::CustomerLedgerPayment>, ApiError> {
    handlers::ledgers::create_ledger_payment_handler(State(pool), headers, path, Json(input)).await
}

async fn get_transaction_codes(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::PatTransactionCode>>, ApiError> {
    handlers::ledgers::get_pat_transaction_codes_handler(State(pool), headers).await
}

async fn get_department_codes(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::PatDepartmentCode>>, ApiError> {
    handlers::ledgers::get_pat_department_codes_handler(State(pool), headers).await
}

async fn void_ledger(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::LedgerVoidRequest>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    handlers::ledgers::void_ledger_handler(State(pool), headers, path, Json(input)).await
}

async fn reverse_ledger(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::LedgerReversalRequest>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    handlers::ledgers::create_ledger_reversal_handler(State(pool), headers, path, Json(input)).await
}
