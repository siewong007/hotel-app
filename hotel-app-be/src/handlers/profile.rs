//! User profile handlers
//!
//! Handles user profile management.

use crate::core::auth::AuthService;
use crate::core::error::ApiError;
use crate::models::*;
use axum::{
    extract::{Extension, State},
    response::Json,
};
use sqlx::PgPool;

pub async fn get_user_profile_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<UserProfile>, ApiError> {
    let profile = sqlx::query_as::<_, UserProfile>(
        r#"
        SELECT
            id, username, email, full_name, phone,
            avatar_url, created_at, updated_at, last_login_at
        FROM users
        WHERE id = $1 AND is_active = true
        "#
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    Ok(Json(profile))
}

pub async fn update_user_profile_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<UserProfileUpdate>,
) -> Result<Json<UserProfile>, ApiError> {
    // Use separate UPDATE statements for each field - safer than dynamic SQL construction
    if let Some(full_name) = input.full_name {
        sqlx::query("UPDATE users SET full_name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(full_name)
            .bind(user_id)
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    if let Some(email) = input.email {
        sqlx::query("UPDATE users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(email)
            .bind(user_id)
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    if let Some(phone) = input.phone {
        sqlx::query("UPDATE users SET phone = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(phone)
            .bind(user_id)
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    if let Some(avatar_url) = input.avatar_url {
        sqlx::query("UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(avatar_url)
            .bind(user_id)
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    // Fetch updated profile
    get_user_profile_handler(State(pool), Extension(user_id)).await
}

pub async fn update_password_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<PasswordUpdateInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get current password hash
    let current_hash: String = sqlx::query_scalar(
        "SELECT password_hash FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Verify current password
    let valid = AuthService::verify_password(&input.current_password, &current_hash)
        .await
        .map_err(|_| ApiError::Internal("Password verification failed".to_string()))?;

    if !valid {
        return Err(ApiError::Unauthorized("Current password is incorrect".to_string()));
    }

    // Hash new password
    let new_hash = AuthService::hash_password(&input.new_password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    // Update password
    sqlx::query(
        r#"
        UPDATE users
        SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        "#
    )
    .bind(&new_hash)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({"message": "Password updated successfully"})))
}
