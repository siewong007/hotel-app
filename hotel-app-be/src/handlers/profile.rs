//! User profile handlers
//!
//! Handles user profile management.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::profile as profile_service;
use axum::{
    extract::{Extension, State},
    response::Json,
};

pub async fn get_user_profile_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<UserProfile>, ApiError> {
    Ok(Json(
        profile_service::get_user_profile(&pool, user_id).await?,
    ))
}

pub async fn update_user_profile_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<UserProfileUpdate>,
) -> Result<Json<UserProfile>, ApiError> {
    Ok(Json(
        profile_service::update_user_profile(&pool, user_id, input).await?,
    ))
}

pub async fn update_password_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<PasswordUpdateInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    profile_service::update_password(&pool, user_id, input).await?;

    Ok(Json(
        serde_json::json!({"message": "Password updated successfully"}),
    ))
}

pub async fn list_sessions_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    current_session_id: Option<String>,
) -> Result<Json<Vec<UserSessionInfo>>, ApiError> {
    Ok(Json(
        profile_service::list_sessions(&pool, user_id, current_session_id.as_deref()).await?,
    ))
}

pub async fn revoke_session_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    session_id: String,
) -> Result<Json<serde_json::Value>, ApiError> {
    profile_service::revoke_session(&pool, user_id, &session_id).await?;
    Ok(Json(
        serde_json::json!({"message": "Session logged out successfully"}),
    ))
}
