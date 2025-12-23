//! RBAC routes
//!
//! Routes for role-based access control management.

use axum::{
    routing::{get, post, delete, put},
    Router,
    extract::{State, Path, Extension},
    http::HeaderMap,
    response::Json,
};
use sqlx::PgPool;
use crate::handlers;
use crate::models;
use crate::core::middleware::{require_admin_helper, require_auth};
use crate::core::error::ApiError;

/// Create RBAC routes
pub fn routes() -> Router<PgPool> {
    Router::new()
        // Role management
        .route("/rbac/roles", get(get_roles))
        .route("/rbac/roles", post(create_role))
        .route("/rbac/roles/:role_id", put(update_role))
        .route("/rbac/roles/:role_id", delete(delete_role))
        .route("/rbac/roles/:role_id/permissions", get(get_role_permissions))
        // Permission management
        .route("/rbac/permissions", get(get_permissions))
        .route("/rbac/permissions", post(create_permission))
        .route("/rbac/permissions/:permission_id", put(update_permission))
        .route("/rbac/permissions/:permission_id", delete(delete_permission))
        // User-role assignments
        .route("/rbac/users/roles", post(assign_role))
        .route("/rbac/users/:user_id/roles/:role_id", delete(remove_role))
        // Role-permission assignments
        .route("/rbac/roles/permissions", post(assign_permission))
        .route("/rbac/roles/:role_id/permissions/:permission_id", delete(remove_permission))
        // User management
        .route("/rbac/users", get(get_users))
        .route("/rbac/users", post(create_user))
        .route("/rbac/users/:user_id", get(get_user))
}

async fn get_roles(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::Role>>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::get_roles_handler(State(pool)).await
}

async fn create_role(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::RoleInput>,
) -> Result<Json<models::Role>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::create_role_handler(State(pool), Json(input)).await
}

async fn get_role_permissions(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::RoleWithPermissions>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::get_role_permissions_handler(State(pool), path).await
}

async fn get_permissions(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::Permission>>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::get_permissions_handler(State(pool)).await
}

async fn create_permission(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::PermissionInput>,
) -> Result<Json<models::Permission>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::create_permission_handler(State(pool), Json(input)).await
}

async fn assign_role(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::AssignRoleInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::assign_role_to_user_handler(State(pool), Json(input)).await
}

async fn remove_role(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::remove_role_from_user_handler(State(pool), path).await
}

async fn assign_permission(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::AssignPermissionInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::assign_permission_to_role_handler(State(pool), Json(input)).await
}

async fn remove_permission(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::remove_permission_from_role_handler(State(pool), path).await
}

async fn get_users(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::UserResponse>>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::get_users_handler(State(pool)).await
}

async fn create_user(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<models::UserCreateInput>,
) -> Result<Json<models::UserResponse>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    let user_id = require_auth(&headers).await?;
    handlers::rbac::create_user_handler(State(pool), Extension(user_id), Json(input)).await
}

async fn get_user(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::UserWithRolesAndPermissions>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::get_user_roles_permissions_handler(State(pool), path).await
}

async fn update_role(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::RoleInput>,
) -> Result<Json<models::Role>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::update_role_handler(State(pool), path, Json(input)).await
}

async fn delete_role(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::delete_role_handler(State(pool), path).await
}

async fn update_permission(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::PermissionInput>,
) -> Result<Json<models::Permission>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::update_permission_handler(State(pool), path, Json(input)).await
}

async fn delete_permission(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin_helper(&pool, &headers).await?;
    handlers::rbac::delete_permission_handler(State(pool), path).await
}
