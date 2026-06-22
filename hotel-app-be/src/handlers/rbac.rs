//! RBAC (Role-Based Access Control) handlers.
//!
//! Handlers translate HTTP inputs and outputs for roles, permissions, and
//! user access management.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::rbac as svc;
use axum::{
    extract::{Extension, Path, State},
    response::Json,
};

pub async fn get_roles_handler(State(pool): State<DbPool>) -> Result<Json<Vec<Role>>, ApiError> {
    Ok(Json(svc::roles(&pool).await?))
}

pub async fn create_role_handler(
    State(pool): State<DbPool>,
    Json(input): Json<RoleInput>,
) -> Result<Json<Role>, ApiError> {
    Ok(Json(svc::create_role(&pool, input).await?))
}

pub async fn get_permissions_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<Permission>>, ApiError> {
    Ok(Json(svc::permissions(&pool).await?))
}

pub async fn get_rbac_snapshot_handler(
    State(pool): State<DbPool>,
) -> Result<Json<RbacSnapshot>, ApiError> {
    Ok(Json(svc::snapshot(&pool).await?))
}

pub async fn get_route_policies_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<RouteAccessPolicy>>, ApiError> {
    Ok(Json(svc::route_policies(&pool).await?))
}

pub async fn update_route_policy_handler(
    State(pool): State<DbPool>,
    Extension(actor_user_id): Extension<i64>,
    Path(route_id): Path<String>,
    Json(input): Json<RouteAccessPolicyInput>,
) -> Result<Json<RouteAccessPolicy>, ApiError> {
    Ok(Json(
        svc::update_route_policy(&pool, actor_user_id, route_id, input).await?,
    ))
}

pub async fn create_permission_handler(
    State(pool): State<DbPool>,
    Json(input): Json<PermissionInput>,
) -> Result<Json<Permission>, ApiError> {
    Ok(Json(svc::create_permission(&pool, input).await?))
}

pub async fn assign_role_to_user_handler(
    State(pool): State<DbPool>,
    Extension(actor_user_id): Extension<i64>,
    Json(input): Json<AssignRoleInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::assign_role_to_user(&pool, actor_user_id, input).await?;

    Ok(Json(
        serde_json::json!({"message": "Role assigned successfully"}),
    ))
}

pub async fn remove_role_from_user_handler(
    State(pool): State<DbPool>,
    Extension(actor_user_id): Extension<i64>,
    Path((user_id, role_id)): Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::remove_role_from_user(&pool, actor_user_id, user_id, role_id).await?;

    Ok(Json(
        serde_json::json!({"message": "Role removed successfully"}),
    ))
}

pub async fn assign_permission_to_role_handler(
    State(pool): State<DbPool>,
    Extension(actor_user_id): Extension<i64>,
    Json(input): Json<AssignPermissionInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::assign_permission_to_role(&pool, actor_user_id, input).await?;

    Ok(Json(
        serde_json::json!({"message": "Permission assigned successfully"}),
    ))
}

pub async fn remove_permission_from_role_handler(
    State(pool): State<DbPool>,
    Extension(actor_user_id): Extension<i64>,
    Path((role_id, permission_id)): Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::remove_permission_from_role(&pool, actor_user_id, role_id, permission_id).await?;

    Ok(Json(
        serde_json::json!({"message": "Permission removed successfully"}),
    ))
}

pub async fn replace_role_permissions_handler(
    State(pool): State<DbPool>,
    Extension(actor_user_id): Extension<i64>,
    Path(role_id): Path<i64>,
    Json(input): Json<RolePermissionIdsInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let permission_count =
        svc::replace_role_permissions(&pool, actor_user_id, role_id, input).await?;

    Ok(Json(serde_json::json!({
        "message": "Role permissions replaced successfully",
        "permission_count": permission_count
    })))
}

pub async fn replace_user_roles_handler(
    State(pool): State<DbPool>,
    Extension(admin_user_id): Extension<i64>,
    Path(user_id): Path<i64>,
    Json(input): Json<UserRoleIdsInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let role_count = svc::replace_user_roles(&pool, admin_user_id, user_id, input).await?;

    Ok(Json(serde_json::json!({
        "message": "User roles replaced successfully",
        "role_count": role_count
    })))
}

pub async fn get_role_permissions_handler(
    State(pool): State<DbPool>,
    Path(role_id): Path<i64>,
) -> Result<Json<RoleWithPermissions>, ApiError> {
    Ok(Json(svc::role_permissions(&pool, role_id).await?))
}

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

pub async fn update_role_handler(
    State(pool): State<DbPool>,
    Extension(actor_user_id): Extension<i64>,
    Path(role_id): Path<i64>,
    Json(input): Json<RoleInput>,
) -> Result<Json<Role>, ApiError> {
    Ok(Json(
        svc::update_role(&pool, actor_user_id, role_id, input).await?,
    ))
}

pub async fn delete_role_handler(
    State(pool): State<DbPool>,
    Extension(actor_user_id): Extension<i64>,
    Path(role_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::delete_role(&pool, actor_user_id, role_id).await?;

    Ok(Json(
        serde_json::json!({"message": "Role deleted successfully"}),
    ))
}

pub async fn update_permission_handler(
    State(pool): State<DbPool>,
    Path(permission_id): Path<i64>,
    Json(input): Json<PermissionInput>,
) -> Result<Json<Permission>, ApiError> {
    Ok(Json(
        svc::update_permission(&pool, permission_id, input).await?,
    ))
}

pub async fn delete_permission_handler(
    State(pool): State<DbPool>,
    Path(permission_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    svc::delete_permission(&pool, permission_id).await?;

    Ok(Json(
        serde_json::json!({"message": "Permission deleted successfully"}),
    ))
}
