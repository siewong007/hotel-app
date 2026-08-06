//! Customer ledger handlers
//!
//! Handles customer ledgers and accounts receivable.

use axum::{
    Json,
    extract::{Path, Query, State},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::ledgers as svc;

pub async fn list_customer_ledgers_handler(
    State(pool): State<DbPool>,
    Query(query): Query<LedgerListQuery>,
) -> Result<Json<LedgerPaginatedResponse>, ApiError> {
    Ok(Json(svc::list_customer_ledgers(&pool, query).await?))
}

pub async fn get_customer_ledger_handler(
    State(pool): State<DbPool>,
    Path(ledger_id): Path<i64>,
) -> Result<Json<CustomerLedger>, ApiError> {
    Ok(Json(svc::get_customer_ledger(&pool, ledger_id).await?))
}

pub async fn get_customer_ledger_with_payments_handler(
    State(pool): State<DbPool>,
    Path(ledger_id): Path<i64>,
) -> Result<Json<CustomerLedgerWithPayments>, ApiError> {
    Ok(Json(
        svc::get_customer_ledger_with_payments(&pool, ledger_id).await?,
    ))
}

pub async fn create_customer_ledger_handler(
    State(pool): State<DbPool>,
    Json(request): Json<CustomerLedgerCreateRequest>,
    user_id: i64,
) -> Result<Json<CustomerLedger>, ApiError> {
    Ok(Json(
        svc::create_customer_ledger(&pool, user_id, request).await?,
    ))
}

pub async fn update_customer_ledger_handler(
    State(pool): State<DbPool>,
    Path(ledger_id): Path<i64>,
    Json(request): Json<CustomerLedgerUpdateRequest>,
    user_id: i64,
) -> Result<Json<CustomerLedger>, ApiError> {
    Ok(Json(
        svc::update_customer_ledger(&pool, ledger_id, user_id, request).await?,
    ))
}

pub async fn delete_customer_ledger_handler(
    State(pool): State<DbPool>,
    Path(ledger_id): Path<i64>,
    user_id: i64,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        svc::delete_customer_ledger(&pool, ledger_id, user_id).await?,
    ))
}

pub async fn create_ledger_payment_handler(
    State(pool): State<DbPool>,
    Path(ledger_id): Path<i64>,
    Json(request): Json<CustomerLedgerPaymentRequest>,
    user_id: i64,
) -> Result<Json<CustomerLedgerPayment>, ApiError> {
    Ok(Json(
        svc::create_ledger_payment(&pool, ledger_id, user_id, request).await?,
    ))
}

pub async fn create_company_ledger_payment_handler(
    State(pool): State<DbPool>,
    Json(request): Json<CompanyLedgerPaymentRequest>,
    user_id: i64,
) -> Result<Json<CompanyLedgerPaymentResponse>, ApiError> {
    Ok(Json(
        svc::create_company_ledger_payment(&pool, user_id, request).await?,
    ))
}

pub async fn get_ledger_payments_handler(
    State(pool): State<DbPool>,
    Path(ledger_id): Path<i64>,
) -> Result<Json<Vec<CustomerLedgerPayment>>, ApiError> {
    Ok(Json(svc::get_ledger_payments(&pool, ledger_id).await?))
}

pub async fn get_ledger_summary_handler(
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(svc::get_ledger_summary(&pool).await?))
}

pub async fn void_ledger_handler(
    State(pool): State<DbPool>,
    Path(ledger_id): Path<i64>,
    Json(request): Json<LedgerVoidRequest>,
    user_id: i64,
) -> Result<Json<CustomerLedger>, ApiError> {
    Ok(Json(
        svc::void_ledger(&pool, ledger_id, user_id, request).await?,
    ))
}

pub async fn create_ledger_reversal_handler(
    State(pool): State<DbPool>,
    Path(ledger_id): Path<i64>,
    Json(request): Json<LedgerReversalRequest>,
    user_id: i64,
) -> Result<Json<CustomerLedger>, ApiError> {
    Ok(Json(
        svc::create_ledger_reversal(&pool, ledger_id, user_id, request).await?,
    ))
}

pub async fn update_ledger_payment_handler(
    State(pool): State<DbPool>,
    Path((ledger_id, payment_id)): Path<(i64, i64)>,
    Json(request): Json<UpdateLedgerPaymentRequest>,
    user_id: i64,
) -> Result<Json<CustomerLedgerPayment>, ApiError> {
    Ok(Json(
        svc::update_ledger_payment(&pool, ledger_id, payment_id, user_id, request).await?,
    ))
}

pub async fn delete_ledger_payment_handler(
    State(pool): State<DbPool>,
    Path((ledger_id, payment_id)): Path<(i64, i64)>,
    user_id: i64,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        svc::delete_ledger_payment(&pool, ledger_id, payment_id, user_id).await?,
    ))
}
