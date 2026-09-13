use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::Json,
};

use super::models::{RateCalendar, RateCalendarQuery, RevenueOverview, RevenueOverviewQuery};
use super::service::RevenueService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;

pub async fn overview(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<RevenueOverviewQuery>,
) -> Result<Json<RevenueOverview>, ApiError> {
    require_permission_helper(&pool, &headers, "revenue:read").await?;
    Ok(Json(RevenueService::overview(&pool, query).await?))
}

pub async fn rate_calendar(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<RateCalendarQuery>,
) -> Result<Json<RateCalendar>, ApiError> {
    require_permission_helper(&pool, &headers, "revenue:read").await?;
    Ok(Json(RevenueService::rate_calendar(&pool, query).await?))
}
