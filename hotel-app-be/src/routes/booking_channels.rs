//! Booking channel routes.

use axum::{
    Router,
    extract::{Path, State},
    http::HeaderMap,
    response::Json,
    routing::{get, put},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::handlers;
use crate::models::{BookingChannel, BookingChannelInput, BookingChannelUpdate};

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/booking-channels", get(list_channels).post(create_channel))
        .route(
            "/booking-channels/{id}",
            put(update_channel).delete(deactivate_channel),
        )
}

async fn can_read_reports(pool: &DbPool, headers: &HeaderMap) -> Result<(), ApiError> {
    let has_analytics = require_permission_helper(pool, headers, "analytics:read")
        .await
        .is_ok();
    let has_reports = require_permission_helper(pool, headers, "reports:execute")
        .await
        .is_ok();

    if has_analytics || has_reports {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "reports:execute or analytics:read permission required".to_string(),
        ))
    }
}

async fn list_channels(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<BookingChannel>>, ApiError> {
    can_read_reports(&pool, &headers).await?;
    handlers::booking_channels::list_handler(State(pool)).await
}

async fn create_channel(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<BookingChannelInput>,
) -> Result<Json<BookingChannel>, ApiError> {
    require_permission_helper(&pool, &headers, "settings:update").await?;
    handlers::booking_channels::create_handler(State(pool), Json(input)).await
}

async fn update_channel(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<BookingChannelUpdate>,
) -> Result<Json<BookingChannel>, ApiError> {
    require_permission_helper(&pool, &headers, "settings:update").await?;
    handlers::booking_channels::update_handler(State(pool), path, Json(input)).await
}

async fn deactivate_channel(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<BookingChannel>, ApiError> {
    require_permission_helper(&pool, &headers, "settings:update").await?;
    handlers::booking_channels::deactivate_handler(State(pool), path).await
}
