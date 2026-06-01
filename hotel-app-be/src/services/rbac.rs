//! RBAC business workflows.

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::repositories::auth::AuthRepository;
use crate::repositories::rbac::RbacRepository;
use crate::services::audit::AuditLog;
use crate::utils::sanitization::Sanitizer;
use std::collections::HashSet;
use validator::Validate;

pub async fn roles(pool: &DbPool) -> Result<Vec<Role>, ApiError> {
    RbacRepository::find_all_roles(pool).await
}

pub async fn create_role(pool: &DbPool, input: RoleInput) -> Result<Role, ApiError> {
    RbacRepository::create_role(pool, &input.name, input.description.as_deref()).await
}

pub async fn permissions(pool: &DbPool) -> Result<Vec<Permission>, ApiError> {
    RbacRepository::find_all_permissions(pool).await
}

pub async fn snapshot(pool: &DbPool) -> Result<RbacSnapshot, ApiError> {
    let roles = RbacRepository::find_all_roles(pool).await?;
    let permissions = RbacRepository::find_all_permissions(pool).await?;
    let users = RbacRepository::list_users(pool)
        .await?
        .into_iter()
        .map(UserResponse::from)
        .collect();
    let role_permissions = RbacRepository::role_permission_assignments(pool).await?;
    let user_roles = RbacRepository::user_role_assignments(pool).await?;

    Ok(RbacSnapshot {
        roles,
        permissions,
        users,
        role_permissions,
        user_roles,
    })
}

pub async fn create_permission(
    pool: &DbPool,
    input: PermissionInput,
) -> Result<Permission, ApiError> {
    RbacRepository::create_permission(
        pool,
        &input.name,
        &input.resource,
        &input.action,
        input.description.as_deref(),
    )
    .await
}

pub async fn assign_role_to_user(pool: &DbPool, input: AssignRoleInput) -> Result<(), ApiError> {
    RbacRepository::assign_role_to_user(pool, input.user_id, input.role_id).await?;
    let _ = AuditLog::log_role_assignment(pool, 0, input.user_id, input.role_id).await;
    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

pub async fn remove_role_from_user(
    pool: &DbPool,
    user_id: i64,
    role_id: i64,
) -> Result<(), ApiError> {
    RbacRepository::remove_role_from_user(pool, user_id, role_id).await?;
    let _ = AuditLog::log_role_removal(pool, 0, user_id, role_id).await;
    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

pub async fn assign_permission_to_role(
    pool: &DbPool,
    input: AssignPermissionInput,
) -> Result<(), ApiError> {
    RbacRepository::assign_permission_to_role(pool, input.role_id, input.permission_id).await?;
    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

pub async fn remove_permission_from_role(
    pool: &DbPool,
    role_id: i64,
    permission_id: i64,
) -> Result<(), ApiError> {
    RbacRepository::remove_permission_from_role(pool, role_id, permission_id).await?;
    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

pub async fn replace_role_permissions(
    pool: &DbPool,
    role_id: i64,
    input: RolePermissionIdsInput,
) -> Result<usize, ApiError> {
    if !RbacRepository::role_exists(pool, role_id).await? {
        return Err(ApiError::NotFound("Role not found".to_string()));
    }

    let permission_ids = unique_ids(input.permission_ids);
    RbacRepository::replace_role_permissions(pool, role_id, &permission_ids).await?;
    crate::core::rbac_cache::invalidate_all();
    Ok(permission_ids.len())
}

pub async fn replace_user_roles(
    pool: &DbPool,
    admin_user_id: i64,
    user_id: i64,
    input: UserRoleIdsInput,
) -> Result<usize, ApiError> {
    if !RbacRepository::user_exists(pool, user_id).await? {
        return Err(ApiError::NotFound("User not found".to_string()));
    }

    let current_role_ids = RbacRepository::user_role_ids(pool, user_id).await?;
    let role_ids = unique_ids(input.role_ids);
    RbacRepository::replace_user_roles(pool, user_id, &role_ids).await?;

    let current: HashSet<i64> = current_role_ids.into_iter().collect();
    let next: HashSet<i64> = role_ids.iter().copied().collect();

    for role_id in next.difference(&current) {
        let _ = AuditLog::log_role_assignment(pool, admin_user_id, user_id, *role_id).await;
    }
    for role_id in current.difference(&next) {
        let _ = AuditLog::log_role_removal(pool, admin_user_id, user_id, *role_id).await;
    }

    crate::core::rbac_cache::invalidate_all();
    Ok(role_ids.len())
}

pub async fn role_permissions(
    pool: &DbPool,
    role_id: i64,
) -> Result<RoleWithPermissions, ApiError> {
    let role = RbacRepository::find_role_by_id(pool, role_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Role not found".to_string()))?;
    let permissions = RbacRepository::get_role_permissions(pool, role_id).await?;
    Ok(RoleWithPermissions { role, permissions })
}

pub async fn users(pool: &DbPool) -> Result<Vec<UserResponse>, ApiError> {
    Ok(RbacRepository::list_users(pool)
        .await?
        .into_iter()
        .map(UserResponse::from)
        .collect())
}

pub async fn create_user(
    pool: &DbPool,
    admin_user_id: i64,
    mut input: UserCreateInput,
) -> Result<UserResponse, ApiError> {
    input
        .validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    input.username = Sanitizer::sanitize_text(&input.username).trim().to_string();
    input.email = Sanitizer::sanitize_email(&input.email);
    if let Some(full_name) = &input.full_name {
        input.full_name = Some(Sanitizer::sanitize_guest_name(full_name));
    }
    if let Some(phone) = &input.phone {
        input.phone = Some(Sanitizer::sanitize_phone(phone));
    }

    let is_super_admin = AuthService::check_role(pool, admin_user_id, "super_admin")
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    if !is_super_admin {
        return Err(ApiError::Unauthorized(
            "Only super admins can create users".to_string(),
        ));
    }

    AuthService::validate_password(&input.password).map_err(ApiError::BadRequest)?;

    if AuthRepository::username_or_email_exists(pool, &input.username, &input.email).await? {
        return Err(ApiError::BadRequest(
            "Username or email already exists".to_string(),
        ));
    }

    let role_ids = input.role_ids.clone().unwrap_or_default();
    for role_id in &role_ids {
        let role_name = RbacRepository::role_name_by_id(pool, *role_id)
            .await?
            .ok_or_else(|| {
                ApiError::BadRequest(format!("Role with id {} does not exist", role_id))
            })?;

        if (role_name == "super_admin" || role_name == "admin") && !is_super_admin {
            return Err(ApiError::Unauthorized(
                "Only super admins can assign admin or super_admin roles".to_string(),
            ));
        }
    }

    let password_hash = AuthService::hash_password(&input.password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;
    let user =
        RbacRepository::create_user_with_roles(pool, &input, &password_hash, &role_ids).await?;

    let _ = AuditLog::log_event(
        pool,
        Some(admin_user_id),
        "user_created",
        "user",
        Some(user.id),
        Some(serde_json::json!({"username": &input.username, "email": &input.email})),
        None,
        None,
    )
    .await;

    Ok(user.into())
}

pub async fn user_roles_permissions(
    pool: &DbPool,
    user_id: i64,
) -> Result<UserWithRolesAndPermissions, ApiError> {
    RbacRepository::user_with_roles_permissions(pool, user_id).await
}

pub async fn update_role(pool: &DbPool, role_id: i64, input: RoleInput) -> Result<Role, ApiError> {
    match RbacRepository::role_system_status(pool, role_id).await? {
        None => Err(ApiError::NotFound("Role not found".to_string())),
        Some(true) => Err(ApiError::BadRequest(
            "Cannot modify system roles".to_string(),
        )),
        Some(false) => {
            let role = RbacRepository::update_role(
                pool,
                role_id,
                &input.name,
                input.description.as_deref(),
            )
            .await?;
            crate::core::rbac_cache::invalidate_all();
            Ok(role)
        }
    }
}

pub async fn delete_role(pool: &DbPool, role_id: i64) -> Result<(), ApiError> {
    match RbacRepository::role_system_status(pool, role_id).await? {
        None => return Err(ApiError::NotFound("Role not found".to_string())),
        Some(true) => {
            return Err(ApiError::BadRequest(
                "Cannot delete system roles".to_string(),
            ));
        }
        Some(false) => {}
    }

    let user_count = RbacRepository::user_count_for_role(pool, role_id).await?;
    if user_count > 0 {
        return Err(ApiError::BadRequest(format!(
            "Cannot delete role: {} user(s) still have this role assigned",
            user_count
        )));
    }

    RbacRepository::delete_role(pool, role_id).await?;
    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

pub async fn update_permission(
    pool: &DbPool,
    permission_id: i64,
    input: PermissionInput,
) -> Result<Permission, ApiError> {
    match RbacRepository::permission_system_status(pool, permission_id).await? {
        None => Err(ApiError::NotFound("Permission not found".to_string())),
        Some(true) => Err(ApiError::BadRequest(
            "Cannot modify system permissions".to_string(),
        )),
        Some(false) => {
            let permission = RbacRepository::update_permission(
                pool,
                permission_id,
                &input.name,
                &input.resource,
                &input.action,
                input.description.as_deref(),
            )
            .await?;
            crate::core::rbac_cache::invalidate_all();
            Ok(permission)
        }
    }
}

pub async fn delete_permission(pool: &DbPool, permission_id: i64) -> Result<(), ApiError> {
    match RbacRepository::permission_system_status(pool, permission_id).await? {
        None => return Err(ApiError::NotFound("Permission not found".to_string())),
        Some(true) => {
            return Err(ApiError::BadRequest(
                "Cannot delete system permissions".to_string(),
            ));
        }
        Some(false) => {}
    }

    let role_count = RbacRepository::role_count_for_permission(pool, permission_id).await?;
    if role_count > 0 {
        return Err(ApiError::BadRequest(format!(
            "Cannot delete permission: {} role(s) still have this permission assigned",
            role_count
        )));
    }

    RbacRepository::delete_permission(pool, permission_id).await?;
    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

fn unique_ids(ids: Vec<i64>) -> Vec<i64> {
    let mut seen = HashSet::new();
    ids.into_iter().filter(|id| seen.insert(*id)).collect()
}
