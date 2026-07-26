//! Data transfer routes for export/import/overwrite of booking data

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{DefaultBodyLimit, State},
    http::HeaderMap,
    response::Json,
    routing::{get, post},
};

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/data-transfer/export/preview", get(preview_export_counts))
        .route("/data-transfer/export", get(export_data))
        .route(
            "/data-transfer/import",
            post(import_data).layer(DefaultBodyLimit::max(100 * 1024 * 1024)), // 100MB limit
        )
}

async fn export_data(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::BookingDataExport>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "settings:manage").await?;
    let export = handlers::data_transfer::export_booking_data_handler(State(pool.clone())).await?;

    // This single GET returns every guest (name, email, phone, IC/passport),
    // every booking, payment and ledger row — the largest exfiltration channel
    // in the product, and until now the one with no record. Audited after a
    // successful export so the row counts describe what actually left.
    let payload = &export.0;
    let _ = crate::services::audit::AuditLog::log_event(
        &pool,
        crate::models::AuditEvent {
            user_id: Some(user_id),
            action: "data_export",
            resource_type: "data_transfer",
            details: Some(serde_json::json!({
                "guests": payload.guests.len(),
                "companies": payload.companies.len(),
                "bookings": payload.bookings.len(),
                "payments": payload.payments.len(),
                "invoices": payload.invoices.len(),
                "customer_ledgers": payload.customer_ledgers.len(),
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(export)
}

async fn preview_export_counts(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::ExportPreview>, ApiError> {
    require_permission_helper(&pool, &headers, "settings:manage").await?;
    handlers::data_transfer::preview_export_counts_handler(State(pool)).await
}

async fn import_data(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::ImportRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "settings:manage").await?;
    handlers::data_transfer::import_booking_data_handler(State(pool), user_id, Json(input)).await
}
