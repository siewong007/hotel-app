//! Guest routes
//!
//! Routes for guest CRUD and management.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{require_auth, require_permission_helper};
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::Json,
    routing::{delete, get, patch, post},
};

/// Create guest routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/guests", get(get_guests))
        .route("/guests", post(create_guest))
        .route("/guests/my-guests", get(get_my_guests))
        .route(
            "/guests/my-guests-with-credits",
            get(get_my_guests_with_credits),
        )
        .route("/guests/link", post(link_guest))
        .route("/guests/unlink/{guest_id}", delete(unlink_guest))
        .route("/guests/upgrade", post(upgrade_guest))
        .route(
            "/guests/{id}/portal-account",
            post(transfer_guest_portal_account),
        )
        .route("/guests/{id}", get(get_guest))
        .route("/guests/{id}", patch(update_guest))
        .route("/guests/{id}", delete(delete_guest))
        .route("/guests/{id}/profile", get(get_guest_profile))
        .route(
            "/guests/{id}/tourism-from-last-check-in",
            post(apply_tourism_type_from_last_check_in),
        )
        .route("/guests/{id}/bookings", get(get_guest_bookings))
        .route("/guests/{id}/credits", get(get_guest_credits))
}

async fn get_guests(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::GuestPaginationParams>,
) -> Result<Json<models::GuestPaginatedResponse>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::guests::get_guests_handler(State(pool), Extension(user_id), query).await
}

async fn create_guest(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::GuestInput>,
) -> Result<Json<models::Guest>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::guests::create_guest_handler(State(pool), Extension(user_id), Json(input)).await
}

async fn get_guest(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::Guest>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:read").await?;
    handlers::guests::get_guest_handler(State(pool), path).await
}

async fn get_guest_profile(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::GuestProfile>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:read").await?;
    handlers::guests::get_guest_profile_handler(State(pool), path).await
}

async fn get_my_guests(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::Guest>>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::guests::get_my_guests_handler(State(pool), Extension(user_id)).await
}

async fn link_guest(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::LinkGuestInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::guests::link_guest_handler(State(pool), Extension(user_id), Json(input)).await
}

async fn unlink_guest(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::guests::unlink_guest_handler(State(pool), Extension(user_id), path).await
}

async fn upgrade_guest(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::UpgradeGuestInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::guests::upgrade_guest_to_user_handler(State(pool), Extension(user_id), Json(input))
        .await
}

async fn transfer_guest_portal_account(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::TransferGuestPortalAccountInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "guests:update").await?;
    handlers::guests::transfer_guest_portal_account_handler(
        State(pool),
        Extension(user_id),
        path,
        Json(input),
    )
    .await
}

async fn update_guest(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::GuestUpdateInput>,
) -> Result<Json<models::Guest>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:update").await?;
    handlers::guests::update_guest_handler(State(pool), path, Json(input)).await
}

async fn apply_tourism_type_from_last_check_in(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::GuestTourismConversionResponse>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "guests:update").await?;
    handlers::guests::apply_tourism_type_from_last_check_in_handler(
        State(pool),
        Extension(user_id),
        path,
    )
    .await
}

async fn delete_guest(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:delete").await?;
    handlers::guests::delete_guest_handler(State(pool), path).await
}

async fn get_guest_bookings(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_permission_helper(&pool, &headers, "guests:read").await?;
    handlers::guests::get_guest_bookings_handler(State(pool), path).await
}

async fn get_guest_credits(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::guests::get_guest_credits_handler(State(pool), Extension(user_id), path).await
}

async fn get_my_guests_with_credits(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    let user_id = require_auth(&headers).await?;
    handlers::guests::get_my_guests_with_credits_handler(State(pool), Extension(user_id)).await
}
