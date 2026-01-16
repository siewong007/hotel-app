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
use crate::core::db::DbPool;
use crate::handlers;
use crate::models;
use crate::core::middleware::require_permission_helper;
use crate::core::error::ApiError;

/// Create booking routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        // Static routes MUST come before parameterized routes
        .route("/bookings", get(get_bookings))
        .route("/bookings", post(create_booking))
        .route("/bookings/my-bookings", get(get_my_bookings))
        .route("/bookings/complimentary", get(get_complimentary_bookings))
        .route("/bookings/book-with-credits", post(book_with_credits))
        .route("/bookings/cancel", post(cancel_booking))
        // Complimentary management routes (static paths)
        .route("/complimentary/summary", get(get_complimentary_summary))
        .route("/guests/credits", get(get_guests_with_credits).post(add_guest_credits))
        .route("/guests/:guest_id/credits/:room_type_id", patch(update_guest_credits).delete(delete_guest_credits))
        // Code lookup routes
        .route("/rate-codes", get(get_rate_codes))
        .route("/market-codes", get(get_market_codes))
        // Parameterized routes come AFTER static routes
        .route("/bookings/:id", get(get_booking))
        .route("/bookings/:id", patch(update_booking))
        .route("/bookings/:id", put(update_booking))
        .route("/bookings/:id", delete(delete_booking))
        .route("/bookings/:id/checkin", post(manual_checkin))
        .route("/bookings/:id/pre-checkin", patch(pre_checkin_update))
        .route("/bookings/:id/complimentary", post(mark_complimentary))
        .route("/bookings/:id/complimentary", patch(update_complimentary))
        .route("/bookings/:id/complimentary", delete(remove_complimentary))
        .route("/bookings/:id/convert-credits", post(convert_complimentary_to_credits))
}

async fn get_bookings(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::BookingWithDetails>>, ApiError> {
    require_permission_helper(&pool, &headers, "bookings:read").await?;
    handlers::bookings::get_bookings_handler(State(pool)).await
}

async fn create_booking(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::BookingInput>,
) -> Result<Json<models::Booking>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:create").await?;
    handlers::bookings::create_booking_handler(State(pool), Extension(user_id), Json(input)).await
}

async fn get_my_bookings(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::BookingWithDetails>>, ApiError> {
    // Only requires authentication, not specific permissions
    handlers::bookings::get_my_bookings_handler(State(pool), headers).await
}

async fn get_booking(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::BookingWithDetails>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:read").await?;
    handlers::bookings::get_booking_handler(State(pool), Extension(user_id), path).await
}

async fn update_booking(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::BookingUpdateInput>,
) -> Result<Json<models::Booking>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:update").await?;
    handlers::bookings::update_booking_handler(State(pool), Extension(user_id), path, Json(input)).await
}

async fn delete_booking(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:delete").await?;
    handlers::bookings::delete_booking_handler(State(pool), Extension(user_id), path).await
}

async fn cancel_booking(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::BookingCancellationRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:update").await?;
    handlers::bookings::delete_booking_handler(State(pool), Extension(user_id), Path(input.booking_id)).await
}

async fn manual_checkin(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(data): Json<Option<models::CheckInRequest>>,
) -> Result<Json<models::Booking>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:update").await?;
    handlers::bookings::manual_checkin_handler(State(pool), Extension(user_id), path, Json(data)).await
}

async fn pre_checkin_update(
    State(pool): State<DbPool>,
    path: Path<i64>,
    Json(input): Json<models::PreCheckInUpdateRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Public endpoint - no authentication required for pre-check-in
    handlers::bookings::pre_checkin_update_handler(State(pool), path, Json(input)).await
}

async fn get_rate_codes(
    State(pool): State<DbPool>,
) -> Result<Json<models::RateCodesResponse>, ApiError> {
    // Public endpoint - no authentication required
    handlers::settings::get_rate_codes_handler(State(pool)).await
}

async fn get_market_codes(
    State(pool): State<DbPool>,
) -> Result<Json<models::MarketCodesResponse>, ApiError> {
    // Public endpoint - no authentication required
    handlers::settings::get_market_codes_handler(State(pool)).await
}

async fn mark_complimentary(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::MarkComplimentaryRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:update").await?;
    handlers::bookings::mark_complimentary_handler(State(pool), Extension(user_id), path, Json(input)).await
}

async fn convert_complimentary_to_credits(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:update").await?;
    handlers::bookings::convert_complimentary_to_credits_handler(State(pool), Extension(user_id), path).await
}

async fn book_with_credits(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<handlers::bookings::BookWithCreditsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Only requires authentication - user can book for their linked guests
    handlers::bookings::book_with_credits_handler(State(pool), headers, Json(input)).await
}

async fn get_complimentary_bookings(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::BookingWithDetails>>, ApiError> {
    require_permission_helper(&pool, &headers, "bookings:read").await?;
    handlers::bookings::get_complimentary_bookings_handler(State(pool)).await
}

async fn get_complimentary_summary(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "bookings:read").await?;
    handlers::bookings::get_complimentary_summary_handler(State(pool)).await
}

async fn update_complimentary(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<handlers::bookings::UpdateComplimentaryRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:update").await?;
    handlers::bookings::update_complimentary_handler(State(pool), Extension(user_id), path, Json(input)).await
}

async fn remove_complimentary(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:update").await?;
    handlers::bookings::remove_complimentary_handler(State(pool), Extension(user_id), path).await
}

async fn get_guests_with_credits(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:read").await?;
    handlers::bookings::get_guests_with_credits_handler(State(pool)).await
}

async fn add_guest_credits(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<handlers::bookings::AddGuestCreditsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:manage").await?;
    handlers::bookings::add_guest_credits_handler(State(pool), Json(input)).await
}

async fn update_guest_credits(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
    Json(input): Json<handlers::bookings::UpdateGuestCreditsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:manage").await?;
    handlers::bookings::update_guest_credits_handler(State(pool), path, Json(input)).await
}

async fn delete_guest_credits(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:manage").await?;
    handlers::bookings::delete_guest_credits_handler(State(pool), path).await
}
