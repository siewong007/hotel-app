//! Booking routes
//!
//! Routes for booking CRUD, check-in/out, and history.

use axum::{
    routing::{get, post, patch, put, delete},
    Router,
    extract::{State, Path, Extension},
    http::HeaderMap,
    response::Json,
};
use sqlx::PgPool;
use crate::handlers;
use crate::models;
use crate::core::middleware::require_permission_helper;
use crate::core::error::ApiError;

/// Create booking routes
pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/bookings", get(get_bookings))
        .route("/bookings", post(create_booking))
        .route("/bookings/my-bookings", get(get_my_bookings))
        .route("/bookings/:id", get(get_booking))
        .route("/bookings/:id", patch(update_booking))
        .route("/bookings/:id", put(update_booking))
        .route("/bookings/:id", delete(delete_booking))
        .route("/bookings/:id/checkin", post(manual_checkin))
        .route("/bookings/:id/pre-checkin", patch(pre_checkin_update))
        // Code lookup routes
        .route("/rate-codes", get(get_rate_codes))
        .route("/market-codes", get(get_market_codes))
}

async fn get_bookings(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::BookingWithDetails>>, ApiError> {
    require_permission_helper(&pool, &headers, "bookings:read").await?;
    handlers::bookings::get_bookings_handler(State(pool)).await
}

async fn create_booking(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::BookingInput>,
) -> Result<Json<models::Booking>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:create").await?;
    handlers::bookings::create_booking_handler(State(pool), Extension(user_id), Json(input)).await
}

async fn get_my_bookings(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::BookingWithDetails>>, ApiError> {
    // Only requires authentication, not specific permissions
    handlers::bookings::get_my_bookings_handler(State(pool), headers).await
}

async fn get_booking(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::BookingWithDetails>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:read").await?;
    handlers::bookings::get_booking_handler(State(pool), Extension(user_id), path).await
}

async fn update_booking(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::BookingUpdateInput>,
) -> Result<Json<models::Booking>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:update").await?;
    handlers::bookings::update_booking_handler(State(pool), Extension(user_id), path, Json(input)).await
}

async fn delete_booking(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:delete").await?;
    handlers::bookings::delete_booking_handler(State(pool), Extension(user_id), path).await
}

async fn manual_checkin(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(data): Json<Option<models::CheckInRequest>>,
) -> Result<Json<models::Booking>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:update").await?;
    handlers::bookings::manual_checkin_handler(State(pool), Extension(user_id), path, Json(data)).await
}

async fn pre_checkin_update(
    State(pool): State<PgPool>,
    path: Path<i64>,
    Json(input): Json<models::PreCheckInUpdateRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Public endpoint - no authentication required for pre-check-in
    handlers::bookings::pre_checkin_update_handler(State(pool), path, Json(input)).await
}

async fn get_rate_codes(
    State(pool): State<PgPool>,
) -> Result<Json<models::RateCodesResponse>, ApiError> {
    // Public endpoint - no authentication required
    handlers::settings::get_rate_codes_handler(State(pool)).await
}

async fn get_market_codes(
    State(pool): State<PgPool>,
) -> Result<Json<models::MarketCodesResponse>, ApiError> {
    // Public endpoint - no authentication required
    handlers::settings::get_market_codes_handler(State(pool)).await
}
