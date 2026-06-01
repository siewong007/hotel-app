//! Customer ledger handlers
//!
//! Handles customer ledgers and accounts receivable.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::ledgers as svc;

pub async fn list_customer_ledgers_handler(
    state: State<DbPool>,
    headers: HeaderMap,
    query: Query<LedgerListQuery>,
) -> Result<Json<LedgerPaginatedResponse>, ApiError> {
    svc::list_customer_ledgers_handler(state, headers, query).await
}

pub async fn get_customer_ledger_handler(
    state: State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<CustomerLedger>, ApiError> {
    svc::get_customer_ledger_handler(state, headers, path).await
}

pub async fn get_customer_ledger_with_payments_handler(
    state: State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<CustomerLedgerWithPayments>, ApiError> {
    svc::get_customer_ledger_with_payments_handler(state, headers, path).await
}

pub async fn create_customer_ledger_handler(
    state: State<DbPool>,
    headers: HeaderMap,
    input: Json<CustomerLedgerCreateRequest>,
) -> Result<Json<CustomerLedger>, ApiError> {
    svc::create_customer_ledger_handler(state, headers, input).await
}

pub async fn update_customer_ledger_handler(
    state: State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    input: Json<CustomerLedgerUpdateRequest>,
) -> Result<Json<CustomerLedger>, ApiError> {
    svc::update_customer_ledger_handler(state, headers, path, input).await
}

pub async fn delete_customer_ledger_handler(
    state: State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::delete_customer_ledger_handler(state, headers, path).await
}

pub async fn create_ledger_payment_handler(
    state: State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    input: Json<CustomerLedgerPaymentRequest>,
) -> Result<Json<CustomerLedgerPayment>, ApiError> {
    svc::create_ledger_payment_handler(state, headers, path, input).await
}

pub async fn get_ledger_payments_handler(
    state: State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Vec<CustomerLedgerPayment>>, ApiError> {
    svc::get_ledger_payments_handler(state, headers, path).await
}

pub async fn get_ledger_summary_handler(
    state: State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::get_ledger_summary_handler(state, headers).await
}

pub async fn void_ledger_handler(
    state: State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    input: Json<LedgerVoidRequest>,
) -> Result<Json<CustomerLedger>, ApiError> {
    svc::void_ledger_handler(state, headers, path, input).await
}

pub async fn create_ledger_reversal_handler(
    state: State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    input: Json<LedgerReversalRequest>,
) -> Result<Json<CustomerLedger>, ApiError> {
    svc::create_ledger_reversal_handler(state, headers, path, input).await
}

pub async fn update_ledger_payment_handler(
    state: State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
    input: Json<UpdateLedgerPaymentRequest>,
) -> Result<Json<CustomerLedgerPayment>, ApiError> {
    svc::update_ledger_payment_handler(state, headers, path, input).await
}

pub async fn delete_ledger_payment_handler(
    state: State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::delete_ledger_payment_handler(state, headers, path).await
}
