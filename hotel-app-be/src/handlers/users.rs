//! User administration handlers.
//!
//! HTTP translation only — the workflows live in [`crate::services::users`].

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::users as svc;
use axum::{
    extract::{Extension, Path, State},
    response::Json,
};

pub async fn get_users_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<UserResponse>>, ApiError> {
    Ok(Json(svc::users(&pool).await?))
}

pub async fn create_user_handler(
    State(pool): State<DbPool>,
    Extension(admin_user_id): Extension<i64>,
    Json(input): Json<UserCreateInput>,
) -> Result<Json<UserResponse>, ApiError> {
    Ok(Json(svc::create_user(&pool, admin_user_id, input).await?))
}

pub async fn update_user_handler(
    State(pool): State<DbPool>,
    Extension(admin_user_id): Extension<i64>,
    Path(user_id): Path<i64>,
    Json(input): Json<UserUpdateInput>,
) -> Result<Json<UserResponse>, ApiError> {
    Ok(Json(
        svc::update_user(&pool, admin_user_id, user_id, input).await?,
    ))
}

pub async fn delete_user_handler(
    State(pool): State<DbPool>,
    Extension(admin_user_id): Extension<i64>,
    Path(user_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::delete_user(&pool, admin_user_id, user_id).await?;

    Ok(Json(
        serde_json::json!({"message": "User deleted successfully"}),
    ))
}

pub async fn get_user_roles_permissions_handler(
    State(pool): State<DbPool>,
    Path(user_id): Path<i64>,
) -> Result<Json<UserWithRolesAndPermissions>, ApiError> {
    Ok(Json(svc::user_roles_permissions(&pool, user_id).await?))
}
