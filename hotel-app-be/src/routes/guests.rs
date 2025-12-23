//! Guest routes
//!
//! Routes for guest CRUD and management.

use axum::{
    routing::{get, post, patch, delete},
    Router,
    extract::{State, Path, Extension},
    http::HeaderMap,
    response::Json,
};
use sqlx::PgPool;
use crate::handlers;
use crate::models;
use crate::core::middleware::{require_permission_helper, require_auth};
use crate::core::error::ApiError;

/// Create guest routes
pub fn routes() -> Router<PgPool> {
    Router::new()
        .route("/guests", get(get_guests))
        .route("/guests", post(create_guest))
        .route("/guests/my-guests", get(get_my_guests))
        .route("/guests/link", post(link_guest))
        .route("/guests/unlink/:guest_id", delete(unlink_guest))
        .route("/guests/upgrade", post(upgrade_guest))
        .route("/guests/:id", patch(update_guest))
        .route("/guests/:id", delete(delete_guest))
        .route("/guests/:id/bookings", get(get_guest_bookings))
}

async fn get_guests(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::Guest>>, ApiError> {
    // Allow all authenticated users to access guests (filtering happens in handler)
    handlers::guests::get_guests_handler(State(pool), headers).await
}

async fn create_guest(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::GuestInput>,
) -> Result<Json<models::Guest>, ApiError> {
    // Allow all authenticated users to create guests (they will be auto-linked)
    handlers::guests::create_guest_handler(State(pool), headers, Json(input)).await
}

async fn get_my_guests(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::Guest>>, ApiError> {
    handlers::guests::get_my_guests_handler(State(pool), headers).await
}

async fn link_guest(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::LinkGuestInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::guests::link_guest_handler(State(pool), headers, Json(input)).await
}

async fn unlink_guest(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::guests::unlink_guest_handler(State(pool), headers, path).await
}

async fn upgrade_guest(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::UpgradeGuestInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::guests::upgrade_guest_to_user_handler(State(pool), Extension(user_id), Json(input)).await
}

async fn update_guest(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::GuestUpdateInput>,
) -> Result<Json<models::Guest>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:write").await?;
    handlers::guests::update_guest_handler(State(pool), path, Json(input)).await
}

async fn delete_guest(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:write").await?;
    handlers::guests::delete_guest_handler(State(pool), path).await
}

async fn get_guest_bookings(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:read").await?;
    handlers::guests::get_guest_bookings_handler(State(pool), path).await
}
