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

pub async fn get_directory_handler(
    State(pool): State<DbPool>,
    axum::extract::Query(query): axum::extract::Query<StaffDirectoryQuery>,
) -> Result<Json<StaffDirectoryResponse>, ApiError> {
    Ok(Json(svc::staff_directory(&pool, query).await?))
}

pub async fn invite_user_handler(
    State(pool): State<DbPool>,
    Extension(admin_user_id): Extension<i64>,
    Json(input): Json<InviteUserInput>,
) -> Result<Json<InviteUserResponse>, ApiError> {
    Ok(Json(svc::invite_user(&pool, admin_user_id, input).await?))
}

pub async fn resend_invite_handler(
    State(pool): State<DbPool>,
    Extension(admin_user_id): Extension<i64>,
    Path(user_id): Path<i64>,
) -> Result<Json<InviteUserResponse>, ApiError> {
    Ok(Json(
        svc::resend_invite(&pool, admin_user_id, user_id).await?,
    ))
}

pub async fn suspend_user_handler(
    State(pool): State<DbPool>,
    Extension(admin_user_id): Extension<i64>,
    Path(user_id): Path<i64>,
) -> Result<Json<UserResponse>, ApiError> {
    Ok(Json(
        svc::suspend_user(&pool, admin_user_id, user_id).await?,
    ))
}

pub async fn reactivate_user_handler(
    State(pool): State<DbPool>,
    Extension(admin_user_id): Extension<i64>,
    Path(user_id): Path<i64>,
) -> Result<Json<UserResponse>, ApiError> {
    Ok(Json(
        svc::reactivate_user(&pool, admin_user_id, user_id).await?,
    ))
}

pub async fn unlock_user_handler(
    State(pool): State<DbPool>,
    Extension(admin_user_id): Extension<i64>,
    Path(user_id): Path<i64>,
) -> Result<Json<UserResponse>, ApiError> {
    Ok(Json(svc::unlock_user(&pool, admin_user_id, user_id).await?))
}

pub async fn user_sessions_handler(
    State(pool): State<DbPool>,
    Extension(admin_user_id): Extension<i64>,
    Path(user_id): Path<i64>,
) -> Result<Json<Vec<crate::models::auth::UserSessionInfo>>, ApiError> {
    Ok(Json(
        svc::user_sessions(&pool, admin_user_id, user_id).await?,
    ))
}

pub async fn revoke_user_sessions_handler(
    State(pool): State<DbPool>,
    Extension(admin_user_id): Extension<i64>,
    Path(user_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::revoke_user_sessions(&pool, admin_user_id, user_id).await?;
    Ok(Json(serde_json::json!({"message": "All sessions revoked"})))
}

pub async fn revoke_user_session_handler(
    State(pool): State<DbPool>,
    Extension(admin_user_id): Extension<i64>,
    Path((user_id, session_id)): Path<(i64, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::revoke_user_session(&pool, admin_user_id, user_id, &session_id).await?;
    Ok(Json(serde_json::json!({"message": "Session revoked"})))
}
