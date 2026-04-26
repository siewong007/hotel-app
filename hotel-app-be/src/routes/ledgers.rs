//! Customer ledger routes
//!
//! Routes for customer ledgers and accounts receivable.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Json,
    routing::{delete, get, patch, post},
};

/// Create ledger routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/ledgers", get(list_ledgers))
        .route("/ledgers", post(create_ledger))
        .route("/ledgers/summary", get(get_ledger_summary))
        .route("/ledgers/{id}", get(get_ledger))
        .route("/ledgers/{id}", patch(update_ledger))
        .route("/ledgers/{id}", delete(delete_ledger))
        .route("/ledgers/{id}/with-payments", get(get_ledger_with_payments))
        .route("/ledgers/{id}/payments", get(get_ledger_payments))
        .route("/ledgers/{id}/payments", post(create_ledger_payment))
        .route(
            "/ledgers/{id}/payments/{payment_id}",
            patch(update_ledger_payment),
        )
        .route(
            "/ledgers/{id}/payments/{payment_id}",
            delete(delete_ledger_payment),
        )
        .route("/ledgers/{id}/void", post(void_ledger))
        .route("/ledgers/{id}/reverse", post(reverse_ledger))
}

async fn list_ledgers(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<handlers::ledgers::LedgerListQuery>,
) -> Result<Json<handlers::ledgers::LedgerPaginatedResponse>, ApiError> {
    handlers::ledgers::list_customer_ledgers_handler(State(pool), headers, query).await
}

async fn create_ledger(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::CustomerLedgerCreateRequest>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    handlers::ledgers::create_customer_ledger_handler(State(pool), headers, Json(input)).await
}

async fn get_ledger_summary(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::ledgers::get_ledger_summary_handler(State(pool), headers).await
}

async fn get_ledger(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    handlers::ledgers::get_customer_ledger_handler(State(pool), headers, path).await
}

async fn update_ledger(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::CustomerLedgerUpdateRequest>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    handlers::ledgers::update_customer_ledger_handler(State(pool), headers, path, Json(input)).await
}

async fn delete_ledger(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::ledgers::delete_customer_ledger_handler(State(pool), headers, path).await
}

async fn get_ledger_with_payments(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::CustomerLedgerWithPayments>, ApiError> {
    handlers::ledgers::get_customer_ledger_with_payments_handler(State(pool), headers, path).await
}

async fn get_ledger_payments(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Vec<models::CustomerLedgerPayment>>, ApiError> {
    handlers::ledgers::get_ledger_payments_handler(State(pool), headers, path).await
}

async fn create_ledger_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::CustomerLedgerPaymentRequest>,
) -> Result<Json<models::CustomerLedgerPayment>, ApiError> {
    handlers::ledgers::create_ledger_payment_handler(State(pool), headers, path, Json(input)).await
}

async fn update_ledger_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
    Json(input): Json<models::UpdateLedgerPaymentRequest>,
) -> Result<Json<models::CustomerLedgerPayment>, ApiError> {
    handlers::ledgers::update_ledger_payment_handler(State(pool), headers, path, Json(input)).await
}

async fn delete_ledger_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::ledgers::delete_ledger_payment_handler(State(pool), headers, path).await
}

async fn void_ledger(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::LedgerVoidRequest>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    handlers::ledgers::void_ledger_handler(State(pool), headers, path, Json(input)).await
}

async fn reverse_ledger(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::LedgerReversalRequest>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    handlers::ledgers::create_ledger_reversal_handler(State(pool), headers, path, Json(input)).await
}
