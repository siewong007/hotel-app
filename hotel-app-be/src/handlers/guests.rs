//! Guest handlers.
//!
//! Handles guest CRUD and user-guest relationships.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::guests as svc;
use axum::{
    extract::{Extension, Path, Query, State},
    response::Json,
};

pub async fn get_guests_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<GuestPaginationParams>,
) -> Result<Json<GuestPaginatedResponse>, ApiError> {
    Ok(Json(svc::list_guests(&pool, user_id, params).await?))
}

pub async fn get_guest_handler(
    State(pool): State<DbPool>,
    Path(guest_id): Path<i64>,
) -> Result<Json<Guest>, ApiError> {
    Ok(Json(svc::get_guest(&pool, guest_id).await?))
}

pub async fn get_guest_profile_handler(
    State(pool): State<DbPool>,
    Path(guest_id): Path<i64>,
) -> Result<Json<GuestProfile>, ApiError> {
    Ok(Json(svc::guest_profile(&pool, guest_id).await?))
}

pub async fn create_guest_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<GuestInput>,
) -> Result<Json<Guest>, ApiError> {
    Ok(Json(svc::create_guest(&pool, user_id, input).await?))
}

pub async fn update_guest_handler(
    State(pool): State<DbPool>,
    Path(guest_id): Path<i64>,
    Json(input): Json<GuestUpdateInput>,
) -> Result<Json<Guest>, ApiError> {
    Ok(Json(svc::update_guest(&pool, guest_id, input).await?))
}

pub async fn apply_tourism_type_from_last_check_in_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(guest_id): Path<i64>,
) -> Result<Json<GuestTourismConversionResponse>, ApiError> {
    Ok(Json(
        svc::apply_tourism_type_from_last_check_in(&pool, user_id, guest_id).await?,
    ))
}

pub async fn delete_guest_handler(
    State(pool): State<DbPool>,
    Path(guest_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::delete_guest(&pool, guest_id).await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Guest deleted successfully"
    })))
}

pub async fn get_guest_bookings_handler(
    State(pool): State<DbPool>,
    Path(guest_id): Path<i64>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    Ok(Json(svc::guest_bookings(&pool, guest_id).await?))
}

pub async fn link_guest_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<LinkGuestInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let guest_id = svc::link_guest(&pool, user_id, input).await?;

    Ok(Json(serde_json::json!({
        "message": "Guest linked successfully",
        "guest_id": guest_id
    })))
}

pub async fn unlink_guest_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(guest_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::unlink_guest(&pool, user_id, guest_id).await?;

    Ok(Json(serde_json::json!({
        "message": "Guest unlinked successfully",
        "guest_id": guest_id
    })))
}

pub async fn get_my_guests_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<Guest>>, ApiError> {
    Ok(Json(svc::my_guests(&pool, user_id).await?))
}

pub async fn upgrade_guest_to_user_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<UpgradeGuestInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let guest_id = input.guest_id;
    let username = input.username.clone();
    let new_user_id = svc::upgrade_guest_to_user(&pool, user_id, input).await?;

    Ok(Json(serde_json::json!({
        "message": "Guest upgraded to user successfully",
        "guest_id": guest_id,
        "user_id": new_user_id,
        "username": username
    })))
}

pub async fn get_guest_credits_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(guest_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(svc::guest_credits(&pool, user_id, guest_id).await?))
}

pub async fn get_my_guests_with_credits_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    Ok(Json(svc::my_guests_with_credits(&pool, user_id).await?))
}
