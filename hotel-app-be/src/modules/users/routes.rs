//! User administration routes.
//!
//! This module owns the whole `/users` URL surface. User records delegate to
//! [`super::handlers::users`]; the `/users/{id}/roles` sub-resource is role
//! *membership* and still delegates to [`super::handlers::rbac`], which owns
//! role assignment.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_any_permission_helper;
use super::handlers;
use crate::models;
use axum::{
    Router,
    extract::{Extension, Path, State},
    http::HeaderMap,
    response::Json,
    routing::{delete, get, patch, post, put},
};

const USER_READ_PERMISSIONS: &[&str] = &["users:read", "users:manage"];
const USER_CREATE_PERMISSIONS: &[&str] = &["users:create", "users:manage"];
const USER_UPDATE_PERMISSIONS: &[&str] = &["users:update", "users:manage"];
const USER_DELETE_PERMISSIONS: &[&str] = &["users:delete", "users:manage"];
const USER_ROLE_MANAGE_PERMISSIONS: &[&str] = &["users:update", "users:manage"];

/// Create user administration routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        // User records
        .route("/users", get(get_users))
        .route("/users", post(create_user))
        .route("/users/directory", get(get_directory))
        .route("/users/invite", post(invite_user))
        .route("/users/{user_id}", get(get_user))
        .route("/users/{user_id}", patch(update_user))
        .route("/users/{user_id}", delete(delete_user))
        // Lifecycle
        .route("/users/{user_id}/suspend", post(suspend_user))
        .route("/users/{user_id}/reactivate", post(reactivate_user))
        .route("/users/{user_id}/unlock", post(unlock_user))
        .route("/users/{user_id}/resend-invite", post(resend_invite))
        // Sessions
        .route("/users/{user_id}/sessions", get(get_user_sessions))
        .route("/users/{user_id}/sessions", delete(revoke_all_sessions))
        .route(
            "/users/{user_id}/sessions/{session_id}",
            delete(revoke_user_session),
        )
        // Role membership
        .route("/users/roles", post(assign_role))
        .route("/users/{user_id}/roles", put(replace_user_roles))
        .route("/users/{user_id}/roles/{role_id}", delete(remove_role))
}

async fn get_users(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::UserResponse>>, ApiError> {
    require_any_permission_helper(&pool, &headers, USER_READ_PERMISSIONS).await?;
    handlers::get_users_handler(State(pool)).await
}

async fn get_directory(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: axum::extract::Query<models::StaffDirectoryQuery>,
) -> Result<Json<models::StaffDirectoryResponse>, ApiError> {
    require_any_permission_helper(&pool, &headers, USER_READ_PERMISSIONS).await?;
    handlers::get_directory_handler(State(pool), query).await
}

async fn invite_user(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::InviteUserInput>,
) -> Result<Json<models::InviteUserResponse>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_CREATE_PERMISSIONS).await?;
    handlers::invite_user_handler(State(pool), Extension(actor_user_id), Json(input)).await
}

async fn suspend_user(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::UserResponse>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_UPDATE_PERMISSIONS).await?;
    handlers::suspend_user_handler(State(pool), Extension(actor_user_id), path).await
}

async fn reactivate_user(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::UserResponse>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_UPDATE_PERMISSIONS).await?;
    handlers::reactivate_user_handler(State(pool), Extension(actor_user_id), path).await
}

async fn unlock_user(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::UserResponse>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_UPDATE_PERMISSIONS).await?;
    handlers::unlock_user_handler(State(pool), Extension(actor_user_id), path).await
}

async fn resend_invite(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::InviteUserResponse>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_CREATE_PERMISSIONS).await?;
    handlers::resend_invite_handler(State(pool), Extension(actor_user_id), path).await
}

async fn get_user_sessions(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<Vec<crate::modules::auth::models::UserSessionInfo>>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_READ_PERMISSIONS).await?;
    handlers::user_sessions_handler(State(pool), Extension(actor_user_id), path).await
}

async fn revoke_all_sessions(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_UPDATE_PERMISSIONS).await?;
    handlers::revoke_user_sessions_handler(State(pool), Extension(actor_user_id), path).await
}

async fn revoke_user_session(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_UPDATE_PERMISSIONS).await?;
    handlers::revoke_user_session_handler(State(pool), Extension(actor_user_id), path).await
}

async fn create_user(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::UserCreateInput>,
) -> Result<Json<models::UserResponse>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_CREATE_PERMISSIONS).await?;
    handlers::create_user_handler(State(pool), Extension(actor_user_id), Json(input)).await
}

async fn update_user(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::UserUpdateInput>,
) -> Result<Json<models::UserResponse>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_UPDATE_PERMISSIONS).await?;
    handlers::update_user_handler(State(pool), Extension(actor_user_id), path, Json(input))
        .await
}

async fn delete_user(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_DELETE_PERMISSIONS).await?;
    handlers::delete_user_handler(State(pool), Extension(actor_user_id), path).await
}

async fn get_user(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::UserWithRolesAndPermissions>, ApiError> {
    require_any_permission_helper(&pool, &headers, USER_READ_PERMISSIONS).await?;
    handlers::get_user_roles_permissions_handler(State(pool), path).await
}

async fn assign_role(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::AssignRoleInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_ROLE_MANAGE_PERMISSIONS).await?;
    crate::modules::rbac::handlers::assign_role_to_user_handler(State(pool), Extension(actor_user_id), Json(input))
        .await
}

async fn remove_role(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_ROLE_MANAGE_PERMISSIONS).await?;
    crate::modules::rbac::handlers::remove_role_from_user_handler(State(pool), Extension(actor_user_id), path).await
}

async fn replace_user_roles(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::UserRoleIdsInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id =
        require_any_permission_helper(&pool, &headers, USER_ROLE_MANAGE_PERMISSIONS).await?;
    crate::modules::rbac::handlers::replace_user_roles_handler(
        State(pool),
        Extension(actor_user_id),
        path,
        Json(input),
    )
    .await
}
