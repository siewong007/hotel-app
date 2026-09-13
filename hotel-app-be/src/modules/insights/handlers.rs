//! Handlers for the typed Insights surface.

use axum::{
    extract::{Path, Query, State},
    response::Json,
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::modules::insights::models::{InsightsOverview, ReportCatalogEntry, ReportEnvelope};
use crate::modules::insights::service::{self, InsightsReportQuery};

pub async fn overview_handler(
    State(pool): State<DbPool>,
) -> Result<Json<InsightsOverview>, ApiError> {
    Ok(Json(service::overview(&pool).await?))
}

pub async fn catalog_handler(
    State(_pool): State<DbPool>,
) -> Result<Json<&'static [ReportCatalogEntry]>, ApiError> {
    Ok(Json(service::catalog()))
}

pub async fn report_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(report_id): Path<String>,
    Query(query): Query<InsightsReportQuery>,
) -> Result<Json<ReportEnvelope>, ApiError> {
    Ok(Json(
        service::report_envelope(&pool, user_id, &report_id, query).await?,
    ))
}
