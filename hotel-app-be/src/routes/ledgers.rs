//! Customer ledger routes
//!
//! Routes for customer ledgers and accounts receivable.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Json,
    routing::{delete, get, patch, post},
};

const LEDGERS_READ: &str = "ledgers:read";
const LEDGERS_CREATE: &str = "ledgers:create";
const LEDGERS_UPDATE: &str = "ledgers:update";
const LEDGERS_VOID: &str = "ledgers:void";
const LEDGERS_MANAGE: &str = "ledgers:manage";

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
    query: Query<models::LedgerListQuery>,
) -> Result<Json<models::LedgerPaginatedResponse>, ApiError> {
    require_permission_helper(&pool, &headers, LEDGERS_READ).await?;
    handlers::ledgers::list_customer_ledgers_handler(State(pool), query).await
}

async fn create_ledger(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::CustomerLedgerCreateRequest>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, LEDGERS_CREATE).await?;
    handlers::ledgers::create_customer_ledger_handler(State(pool), Json(input), user_id).await
}

async fn get_ledger_summary(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, LEDGERS_READ).await?;
    handlers::ledgers::get_ledger_summary_handler(State(pool)).await
}

async fn get_ledger(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    require_permission_helper(&pool, &headers, LEDGERS_READ).await?;
    handlers::ledgers::get_customer_ledger_handler(State(pool), path).await
}

async fn update_ledger(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::CustomerLedgerUpdateRequest>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, LEDGERS_UPDATE).await?;
    handlers::ledgers::update_customer_ledger_handler(State(pool), path, Json(input), user_id).await
}

async fn delete_ledger(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, LEDGERS_MANAGE).await?;
    handlers::ledgers::delete_customer_ledger_handler(State(pool), path, user_id).await
}

async fn get_ledger_with_payments(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::CustomerLedgerWithPayments>, ApiError> {
    require_permission_helper(&pool, &headers, LEDGERS_READ).await?;
    handlers::ledgers::get_customer_ledger_with_payments_handler(State(pool), path).await
}

async fn get_ledger_payments(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Vec<models::CustomerLedgerPayment>>, ApiError> {
    require_permission_helper(&pool, &headers, LEDGERS_READ).await?;
    handlers::ledgers::get_ledger_payments_handler(State(pool), path).await
}

async fn create_ledger_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::CustomerLedgerPaymentRequest>,
) -> Result<Json<models::CustomerLedgerPayment>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, LEDGERS_CREATE).await?;
    handlers::ledgers::create_ledger_payment_handler(State(pool), path, Json(input), user_id).await
}

async fn update_ledger_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
    Json(input): Json<models::UpdateLedgerPaymentRequest>,
) -> Result<Json<models::CustomerLedgerPayment>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, LEDGERS_UPDATE).await?;
    handlers::ledgers::update_ledger_payment_handler(State(pool), path, Json(input), user_id).await
}

async fn delete_ledger_payment(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, LEDGERS_MANAGE).await?;
    handlers::ledgers::delete_ledger_payment_handler(State(pool), path, user_id).await
}

async fn void_ledger(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::LedgerVoidRequest>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, LEDGERS_VOID).await?;
    handlers::ledgers::void_ledger_handler(State(pool), path, Json(input), user_id).await
}

async fn reverse_ledger(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::LedgerReversalRequest>,
) -> Result<Json<models::CustomerLedger>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, LEDGERS_VOID).await?;
    handlers::ledgers::create_ledger_reversal_handler(State(pool), path, Json(input), user_id).await
}
