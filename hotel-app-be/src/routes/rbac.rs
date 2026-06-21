//! RBAC routes
//!
//! Routes for role-based access control management.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{require_any_permission_helper, require_auth};
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{Extension, Path, State},
    http::HeaderMap,
    response::Json,
    routing::{delete, get, patch, post, put},
};

const RBAC_SNAPSHOT_PERMISSIONS: &[&str] = &[
    "roles:read",
    "roles:manage",
    "permissions:read",
    "permissions:manage",
    "users:read",
    "users:manage",
];
const ROLE_READ_PERMISSIONS: &[&str] = &["roles:read", "roles:manage"];
const ROLE_CREATE_PERMISSIONS: &[&str] = &["roles:create", "roles:manage"];
const ROLE_UPDATE_PERMISSIONS: &[&str] = &["roles:update", "roles:manage"];
const ROLE_DELETE_PERMISSIONS: &[&str] = &["roles:delete", "roles:manage"];
const PERMISSION_READ_PERMISSIONS: &[&str] = &[
    "permissions:read",
    "permissions:manage",
    "roles:read",
    "roles:manage",
];
const PERMISSION_CREATE_PERMISSIONS: &[&str] = &["permissions:create", "permissions:manage"];
const PERMISSION_UPDATE_PERMISSIONS: &[&str] = &["permissions:update", "permissions:manage"];
const PERMISSION_DELETE_PERMISSIONS: &[&str] = &["permissions:delete", "permissions:manage"];
const PERMISSION_MANAGE_PERMISSIONS: &[&str] = &["permissions:manage"];
const USER_READ_PERMISSIONS: &[&str] = &["users:read", "users:manage"];
const USER_CREATE_PERMISSIONS: &[&str] = &["users:create", "users:manage"];
const USER_UPDATE_PERMISSIONS: &[&str] = &["users:update", "users:manage"];
const USER_DELETE_PERMISSIONS: &[&str] = &["users:delete", "users:manage"];
const USER_ROLE_MANAGE_PERMISSIONS: &[&str] = &["users:update", "users:manage"];

/// Create RBAC routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/rbac/snapshot", get(get_snapshot))
        .route("/rbac/route-policies", get(get_route_policies))
        .route("/rbac/route-policies/{route_id}", put(update_route_policy))
        // Role management
        .route("/rbac/roles", get(get_roles))
        .route("/rbac/roles", post(create_role))
        .route("/rbac/roles/{role_id}", put(update_role))
        .route("/rbac/roles/{role_id}", delete(delete_role))
        .route(
            "/rbac/roles/{role_id}/permissions",
            get(get_role_permissions).put(replace_role_permissions),
        )
        // Permission management
        .route("/rbac/permissions", get(get_permissions))
        .route("/rbac/permissions", post(create_permission))
        .route("/rbac/permissions/{permission_id}", put(update_permission))
        .route(
            "/rbac/permissions/{permission_id}",
            delete(delete_permission),
        )
        // User-role assignments
        .route("/rbac/users/roles", post(assign_role))
        .route("/rbac/users/{user_id}/roles", put(replace_user_roles))
        .route("/rbac/users/{user_id}/roles/{role_id}", delete(remove_role))
        // Role-permission assignments
        .route("/rbac/roles/permissions", post(assign_permission))
        .route(
            "/rbac/roles/{role_id}/permissions/{permission_id}",
            delete(remove_permission),
        )
        // User management
        .route("/rbac/users", get(get_users))
        .route("/rbac/users", post(create_user))
        .route("/rbac/users/{user_id}", get(get_user))
        .route("/rbac/users/{user_id}", patch(update_user))
        .route("/rbac/users/{user_id}", delete(delete_user))
}

async fn get_snapshot(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::RbacSnapshot>, ApiError> {
    require_any_permission_helper(&pool, &headers, RBAC_SNAPSHOT_PERMISSIONS).await?;
    handlers::rbac::get_rbac_snapshot_handler(State(pool)).await
}

async fn get_route_policies(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::RouteAccessPolicy>>, ApiError> {
    require_auth(&headers).await?;
    handlers::rbac::get_route_policies_handler(State(pool)).await
}

async fn update_route_policy(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<String>,
    Json(input): Json<models::RouteAccessPolicyInput>,
) -> Result<Json<models::RouteAccessPolicy>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, PERMISSION_MANAGE_PERMISSIONS).await?;
    handlers::rbac::update_route_policy_handler(
        State(pool),
        Extension(actor_user_id),
        path,
        Json(input),
    )
    .await
}

async fn get_roles(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::Role>>, ApiError> {
    require_any_permission_helper(&pool, &headers, ROLE_READ_PERMISSIONS).await?;
    handlers::rbac::get_roles_handler(State(pool)).await
}

async fn create_role(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::RoleInput>,
) -> Result<Json<models::Role>, ApiError> {
    require_any_permission_helper(&pool, &headers, ROLE_CREATE_PERMISSIONS).await?;
    handlers::rbac::create_role_handler(State(pool), Json(input)).await
}

async fn get_role_permissions(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::RoleWithPermissions>, ApiError> {
    require_any_permission_helper(&pool, &headers, ROLE_READ_PERMISSIONS).await?;
    handlers::rbac::get_role_permissions_handler(State(pool), path).await
}

async fn get_permissions(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::Permission>>, ApiError> {
    require_any_permission_helper(&pool, &headers, PERMISSION_READ_PERMISSIONS).await?;
    handlers::rbac::get_permissions_handler(State(pool)).await
}

async fn create_permission(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::PermissionInput>,
) -> Result<Json<models::Permission>, ApiError> {
    require_any_permission_helper(&pool, &headers, PERMISSION_CREATE_PERMISSIONS).await?;
    handlers::rbac::create_permission_handler(State(pool), Json(input)).await
}

async fn assign_role(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::AssignRoleInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_ROLE_MANAGE_PERMISSIONS).await?;
    handlers::rbac::assign_role_to_user_handler(State(pool), Extension(actor_user_id), Json(input))
        .await
}

async fn remove_role(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_ROLE_MANAGE_PERMISSIONS).await?;
    handlers::rbac::remove_role_from_user_handler(State(pool), Extension(actor_user_id), path).await
}

async fn replace_user_roles(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::UserRoleIdsInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_ROLE_MANAGE_PERMISSIONS).await?;
    handlers::rbac::replace_user_roles_handler(
        State(pool),
        Extension(actor_user_id),
        path,
        Json(input),
    )
    .await
}

async fn assign_permission(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::AssignPermissionInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, PERMISSION_MANAGE_PERMISSIONS).await?;
    handlers::rbac::assign_permission_to_role_handler(
        State(pool),
        Extension(actor_user_id),
        Json(input),
    )
    .await
}

async fn remove_permission(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, PERMISSION_MANAGE_PERMISSIONS).await?;
    handlers::rbac::remove_permission_from_role_handler(State(pool), Extension(actor_user_id), path)
        .await
}

async fn replace_role_permissions(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::RolePermissionIdsInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, PERMISSION_MANAGE_PERMISSIONS).await?;
    handlers::rbac::replace_role_permissions_handler(
        State(pool),
        Extension(actor_user_id),
        path,
        Json(input),
    )
    .await
}

async fn get_users(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::UserResponse>>, ApiError> {
    require_any_permission_helper(&pool, &headers, USER_READ_PERMISSIONS).await?;
    handlers::rbac::get_users_handler(State(pool)).await
}

async fn create_user(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::UserCreateInput>,
) -> Result<Json<models::UserResponse>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_CREATE_PERMISSIONS).await?;
    handlers::rbac::create_user_handler(State(pool), Extension(actor_user_id), Json(input)).await
}

async fn update_user(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::UserUpdateInput>,
) -> Result<Json<models::UserResponse>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_UPDATE_PERMISSIONS).await?;
    handlers::rbac::update_user_handler(State(pool), Extension(actor_user_id), path, Json(input))
        .await
}

async fn delete_user(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_DELETE_PERMISSIONS).await?;
    handlers::rbac::delete_user_handler(State(pool), Extension(actor_user_id), path).await
}

async fn get_user(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::UserWithRolesAndPermissions>, ApiError> {
    require_any_permission_helper(&pool, &headers, USER_READ_PERMISSIONS).await?;
    handlers::rbac::get_user_roles_permissions_handler(State(pool), path).await
}

async fn update_role(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::RoleInput>,
) -> Result<Json<models::Role>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, ROLE_UPDATE_PERMISSIONS).await?;
    handlers::rbac::update_role_handler(State(pool), Extension(actor_user_id), path, Json(input))
        .await
}

async fn delete_role(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, ROLE_DELETE_PERMISSIONS).await?;
    handlers::rbac::delete_role_handler(State(pool), Extension(actor_user_id), path).await
}

async fn update_permission(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::PermissionInput>,
) -> Result<Json<models::Permission>, ApiError> {
    require_any_permission_helper(&pool, &headers, PERMISSION_UPDATE_PERMISSIONS).await?;
    handlers::rbac::update_permission_handler(State(pool), path, Json(input)).await
}

async fn delete_permission(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_any_permission_helper(&pool, &headers, PERMISSION_DELETE_PERMISSIONS).await?;
    handlers::rbac::delete_permission_handler(State(pool), path).await
}
