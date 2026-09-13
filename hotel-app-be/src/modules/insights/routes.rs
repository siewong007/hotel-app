//! Typed Insights routes — the single KPI surface and the governed report
//! catalog. Same permission surface as the legacy `/analytics` + `/reports`
//! endpoints (`analytics:read`; `analytics:read` OR `reports:execute` for
//! running a report) so the dashboard keeps working for every role that
//! could see it before.

use axum::{
    Router,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Json,
    routing::get,
};

use super::handlers;
use super::models;
use super::service::InsightsReportQuery;
use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{require_auth, require_permission_helper};

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/insights/overview", get(get_overview))
        .route("/insights/reports", get(get_catalog))
        .route("/insights/reports/{id}", get(get_report))
}

async fn get_overview(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::InsightsOverview>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;
    handlers::overview_handler(State(pool)).await
}

async fn get_catalog(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<&'static [models::ReportCatalogEntry]>, ApiError> {
    require_permission_helper(&pool, &headers, "analytics:read").await?;
    handlers::catalog_handler(State(pool)).await
}

async fn get_report(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(report_id): Path<String>,
    Query(query): Query<InsightsReportQuery>,
) -> Result<Json<models::ReportEnvelope>, ApiError> {
    let user_id = require_auth(&headers).await?;
    let allowed = AuthService::check_permission(&pool, user_id, "analytics:read")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "reports:execute")
            .await
            .unwrap_or(false);
    if !allowed {
        return Err(ApiError::Forbidden(
            "analytics:read or reports:execute required".to_string(),
        ));
    }
    handlers::report_handler(State(pool), user_id, Path(report_id), Query(query)).await
}
