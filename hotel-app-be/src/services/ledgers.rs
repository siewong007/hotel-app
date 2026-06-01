//! Customer ledger service layer.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::repositories::ledger as repo;

pub async fn list_customer_ledgers(
    pool: &DbPool,
    query: LedgerListQuery,
) -> Result<LedgerPaginatedResponse, ApiError> {
    repo::list_customer_ledgers(pool, query).await
}

pub async fn get_customer_ledger(
    pool: &DbPool,
    ledger_id: i64,
) -> Result<CustomerLedger, ApiError> {
    repo::get_customer_ledger(pool, ledger_id).await
}

pub async fn get_customer_ledger_with_payments(
    pool: &DbPool,
    ledger_id: i64,
) -> Result<CustomerLedgerWithPayments, ApiError> {
    repo::get_customer_ledger_with_payments(pool, ledger_id).await
}

pub async fn create_customer_ledger(
    pool: &DbPool,
    user_id: i64,
    request: CustomerLedgerCreateRequest,
) -> Result<CustomerLedger, ApiError> {
    repo::create_customer_ledger(pool, user_id, request).await
}

pub async fn update_customer_ledger(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    request: CustomerLedgerUpdateRequest,
) -> Result<CustomerLedger, ApiError> {
    repo::update_customer_ledger(pool, ledger_id, user_id, request).await
}

pub async fn delete_customer_ledger(
    pool: &DbPool,
    ledger_id: i64,
) -> Result<serde_json::Value, ApiError> {
    repo::delete_customer_ledger(pool, ledger_id).await
}

pub async fn create_ledger_payment(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    request: CustomerLedgerPaymentRequest,
) -> Result<CustomerLedgerPayment, ApiError> {
    repo::create_ledger_payment(pool, ledger_id, user_id, request).await
}

pub async fn get_ledger_payments(
    pool: &DbPool,
    ledger_id: i64,
) -> Result<Vec<CustomerLedgerPayment>, ApiError> {
    repo::get_ledger_payments(pool, ledger_id).await
}

pub async fn get_ledger_summary(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
    repo::get_ledger_summary(pool).await
}

pub async fn void_ledger(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    request: LedgerVoidRequest,
) -> Result<CustomerLedger, ApiError> {
    repo::void_ledger(pool, ledger_id, user_id, request).await
}

pub async fn create_ledger_reversal(
    pool: &DbPool,
    ledger_id: i64,
    user_id: i64,
    request: LedgerReversalRequest,
) -> Result<CustomerLedger, ApiError> {
    repo::create_ledger_reversal(pool, ledger_id, user_id, request).await
}

pub async fn update_ledger_payment(
    pool: &DbPool,
    ledger_id: i64,
    payment_id: i64,
    request: UpdateLedgerPaymentRequest,
) -> Result<CustomerLedgerPayment, ApiError> {
    repo::update_ledger_payment(pool, ledger_id, payment_id, request).await
}

pub async fn delete_ledger_payment(
    pool: &DbPool,
    ledger_id: i64,
    payment_id: i64,
) -> Result<serde_json::Value, ApiError> {
    repo::delete_ledger_payment(pool, ledger_id, payment_id).await
}
