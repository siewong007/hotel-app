use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::ReportQuery;
use crate::repositories::analytics;
use std::collections::HashMap;

pub async fn occupancy_report(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
    analytics::occupancy_report(pool).await
}

pub async fn booking_analytics(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
    analytics::booking_analytics(pool).await
}

pub async fn personalized_report(
    pool: &DbPool,
    user_id: i64,
    params: HashMap<String, String>,
) -> Result<serde_json::Value, ApiError> {
    let has_full_analytics = AuthService::check_permission(pool, user_id, "analytics:manage")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(pool, user_id, "reports:execute")
            .await
            .unwrap_or(false);

    analytics::personalized_report(pool, has_full_analytics, params).await
}

pub async fn generate_report(
    pool: &DbPool,
    params: ReportQuery,
) -> Result<serde_json::Value, ApiError> {
    analytics::generate_report(pool, params).await
}
