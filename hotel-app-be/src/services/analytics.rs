use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::ReportQuery;
use crate::repositories::analytics;
use crate::services::audit::AuditLog;
use std::collections::HashMap;

pub async fn occupancy_report(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
    analytics::occupancy_report(pool).await
}

pub async fn booking_analytics(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
    analytics::booking_analytics(pool).await
}

pub async fn benchmark_report(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
    analytics::benchmark_report(pool).await
}

pub async fn personalized_report(
    pool: &DbPool,
    user_id: i64,
    params: HashMap<String, String>,
) -> Result<serde_json::Value, ApiError> {
    let has_full_analytics = AuthService::check_permission(pool, user_id, "analytics:read")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(pool, user_id, "analytics:manage")
            .await
            .unwrap_or(false)
        || AuthService::check_permission(pool, user_id, "reports:execute")
            .await
            .unwrap_or(false);

    analytics::personalized_report(pool, user_id, has_full_analytics, params).await
}

pub async fn generate_report(
    pool: &DbPool,
    user_id: i64,
    params: ReportQuery,
) -> Result<serde_json::Value, ApiError> {
    let details = serde_json::json!({
        "report_type": &params.report_type,
        "start_date": &params.start_date,
        "end_date": &params.end_date,
        "shift": &params.shift,
        "drawer": &params.drawer,
        "company_name": &params.company_name,
        "booking_channel_id": &params.booking_channel_id,
        "booking_channel": &params.booking_channel,
        "platform_name": &params.platform_name,
        "booking_status": &params.booking_status,
        "posted_status": &params.posted_status,
        "room_type": &params.room_type,
    });
    let report = analytics::generate_report(pool, params).await?;

    let _ = AuditLog::log_event(
        pool,
        Some(user_id),
        "report_generated",
        "report",
        None,
        Some(details),
        None,
        None,
    )
    .await;

    Ok(report)
}
