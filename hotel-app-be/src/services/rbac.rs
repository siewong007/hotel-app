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
    let route_policies = RbacRepository::find_all_route_access_policies(pool).await?;

    Ok(RbacSnapshot {
        roles,
        permissions,
        users,
        role_permissions,
        user_roles,
        route_policies,
    })
}

pub async fn route_policies(pool: &DbPool) -> Result<Vec<RouteAccessPolicy>, ApiError> {
    RbacRepository::find_all_route_access_policies(pool).await
}

pub async fn update_route_policy(
    pool: &DbPool,
    actor_user_id: i64,
    route_id: String,
    input: RouteAccessPolicyInput,
) -> Result<RouteAccessPolicy, ApiError> {
    validate_route_policy_input(&input)?;
    let policy = RbacRepository::update_route_access_policy(pool, &route_id, &input).await?;
    let _ = AuditLog::log_event(
        pool,
        Some(actor_user_id),
        "route_policy_updated",
        "route_access_policy",
        None,
        Some(serde_json::json!({ "route_id": policy.route_id })),
        None,
        None,
    )
    .await;
    Ok(policy)
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

pub async fn assign_role_to_user(
    pool: &DbPool,
    actor_user_id: i64,
    input: AssignRoleInput,
) -> Result<(), ApiError> {
    ensure_actor_can_manage_roles(pool, actor_user_id, &[input.role_id]).await?;
    RbacRepository::assign_role_to_user(pool, input.user_id, input.role_id).await?;
    let _ = AuditLog::log_role_assignment(pool, actor_user_id, input.user_id, input.role_id).await;
    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

pub async fn remove_role_from_user(
    pool: &DbPool,
    actor_user_id: i64,
    user_id: i64,
    role_id: i64,
) -> Result<(), ApiError> {
    ensure_actor_can_manage_roles(pool, actor_user_id, &[role_id]).await?;
    RbacRepository::remove_role_from_user(pool, user_id, role_id).await?;
    let _ = AuditLog::log_role_removal(pool, actor_user_id, user_id, role_id).await;
    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

pub async fn assign_permission_to_role(
    pool: &DbPool,
    actor_user_id: i64,
    input: AssignPermissionInput,
) -> Result<(), ApiError> {
    ensure_actor_can_manage_roles(pool, actor_user_id, &[input.role_id]).await?;
    RbacRepository::assign_permission_to_role(pool, input.role_id, input.permission_id).await?;
    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

pub async fn remove_permission_from_role(
    pool: &DbPool,
    actor_user_id: i64,
    role_id: i64,
    permission_id: i64,
) -> Result<(), ApiError> {
    ensure_actor_can_manage_roles(pool, actor_user_id, &[role_id]).await?;
    RbacRepository::remove_permission_from_role(pool, role_id, permission_id).await?;
    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

pub async fn replace_role_permissions(
    pool: &DbPool,
    actor_user_id: i64,
    role_id: i64,
    input: RolePermissionIdsInput,
) -> Result<usize, ApiError> {
    if !RbacRepository::role_exists(pool, role_id).await? {
        return Err(ApiError::NotFound("Role not found".to_string()));
    }
    ensure_actor_can_manage_roles(pool, actor_user_id, &[role_id]).await?;

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
    ensure_actor_can_manage_roles(pool, admin_user_id, &current_role_ids).await?;
    ensure_actor_can_manage_roles(pool, admin_user_id, &role_ids).await?;
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

    AuthService::validate_password(&input.password).map_err(ApiError::BadRequest)?;

    if AuthRepository::username_or_email_exists(pool, &input.username, Some(&input.email)).await? {
        return Err(ApiError::BadRequest(
            "Username or email already exists".to_string(),
        ));
    }

    let role_ids = input.role_ids.clone().unwrap_or_default();
    ensure_actor_can_manage_roles(pool, admin_user_id, &role_ids).await?;

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

pub async fn update_user(
    pool: &DbPool,
    admin_user_id: i64,
    user_id: i64,
    mut input: UserUpdateInput,
) -> Result<UserResponse, ApiError> {
    input.password = input
        .password
        .take()
        .filter(|password| !password.trim().is_empty());
    sanitize_user_update_input(&mut input);
    input
        .validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let existing = RbacRepository::find_user_by_id(pool, user_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;
    ensure_actor_can_manage_user(pool, admin_user_id, user_id).await?;

    if admin_user_id == user_id && input.is_active == Some(false) {
        return Err(ApiError::BadRequest(
            "Cannot deactivate your own user account".to_string(),
        ));
    }

    if RbacRepository::username_or_email_exists_for_other(
        pool,
        user_id,
        input.username.as_deref(),
        input.email.as_deref(),
    )
    .await?
    {
        return Err(ApiError::BadRequest(
            "Username or email already exists".to_string(),
        ));
    }

    let password_hash = match &input.password {
        Some(password) => {
            AuthService::validate_password(password).map_err(ApiError::BadRequest)?;
            Some(
                AuthService::hash_password(password)
                    .await
                    .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?,
            )
        }
        None => None,
    };

    // Password resets must invalidate existing credentials before the new
    // password can take effect. This is intentionally conservative: if the
    // subsequent profile update fails, the target user must sign in again.
    if password_hash.is_some() {
        AuthService::revoke_all_user_tokens(pool, user_id)
            .await
            .map_err(|error| {
                ApiError::Database(format!("Failed to revoke password-reset sessions: {error}"))
            })?;
    }

    let changed_fields = changed_user_fields(&existing, &input, password_hash.is_some());
    let user = RbacRepository::update_user(pool, user_id, &input, password_hash.as_deref()).await?;

    if input.is_active == Some(false) {
        AuthService::revoke_all_user_tokens(pool, user_id)
            .await
            .map_err(|error| {
                ApiError::Database(format!(
                    "Failed to revoke deactivated-user sessions: {error}"
                ))
            })?;
    }

    let _ = AuditLog::log_event(
        pool,
        Some(admin_user_id),
        "user_updated",
        "user",
        Some(user_id),
        Some(serde_json::json!({"changed_fields": changed_fields})),
        None,
        None,
    )
    .await;
    crate::core::rbac_cache::invalidate_all();

    Ok(user.into())
}

pub async fn delete_user(pool: &DbPool, admin_user_id: i64, user_id: i64) -> Result<(), ApiError> {
    if admin_user_id == user_id {
        return Err(ApiError::BadRequest(
            "Cannot delete your own user account".to_string(),
        ));
    }

    if !RbacRepository::user_exists(pool, user_id).await? {
        return Err(ApiError::NotFound("User not found".to_string()));
    }
    ensure_actor_can_manage_user(pool, admin_user_id, user_id).await?;

    // Revoke first so a failure to delete cannot leave a known-compromised
    // session usable while the administrator retries the operation.
    AuthService::revoke_all_user_tokens(pool, user_id)
        .await
        .map_err(|error| {
            ApiError::Database(format!("Failed to revoke deleted-user sessions: {error}"))
        })?;

    if !RbacRepository::soft_delete_user(pool, user_id).await? {
        return Err(ApiError::NotFound("User not found".to_string()));
    }

    let _ = AuditLog::log_event(
        pool,
        Some(admin_user_id),
        "user_deleted",
        "user",
        Some(user_id),
        None,
        None,
        None,
    )
    .await;
    crate::core::rbac_cache::invalidate_all();

    Ok(())
}

pub async fn user_roles_permissions(
    pool: &DbPool,
    user_id: i64,
) -> Result<UserWithRolesAndPermissions, ApiError> {
    RbacRepository::user_with_roles_permissions(pool, user_id).await
}

pub async fn update_role(
    pool: &DbPool,
    actor_user_id: i64,
    role_id: i64,
    input: RoleInput,
) -> Result<Role, ApiError> {
    match RbacRepository::role_system_status(pool, role_id).await? {
        None => Err(ApiError::NotFound("Role not found".to_string())),
        Some(true) => Err(ApiError::BadRequest(
            "Cannot modify system roles".to_string(),
        )),
        Some(false) => {
            ensure_actor_can_manage_roles(pool, actor_user_id, &[role_id]).await?;
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

pub async fn delete_role(pool: &DbPool, actor_user_id: i64, role_id: i64) -> Result<(), ApiError> {
    match RbacRepository::role_system_status(pool, role_id).await? {
        None => return Err(ApiError::NotFound("Role not found".to_string())),
        Some(true) => {
            return Err(ApiError::BadRequest(
                "Cannot delete system roles".to_string(),
            ));
        }
        Some(false) => {}
    }
    ensure_actor_can_manage_roles(pool, actor_user_id, &[role_id]).await?;

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

fn sanitize_optional_text(value: &mut Option<String>, sanitizer: fn(&str) -> String) {
    if let Some(raw) = value {
        *raw = sanitizer(raw);
    }
}

fn sanitize_user_update_input(input: &mut UserUpdateInput) {
    sanitize_optional_text(&mut input.username, |value| {
        Sanitizer::sanitize_text(value).trim().to_string()
    });
    sanitize_optional_text(&mut input.email, Sanitizer::sanitize_email);
    sanitize_optional_text(&mut input.full_name, Sanitizer::sanitize_guest_name);
    sanitize_optional_text(&mut input.phone, Sanitizer::sanitize_phone);
}

fn changed_user_fields(
    existing: &User,
    input: &UserUpdateInput,
    password_changed: bool,
) -> Vec<&'static str> {
    let mut fields = Vec::new();

    if input
        .username
        .as_ref()
        .is_some_and(|username| username != &existing.username)
    {
        fields.push("username");
    }
    if input
        .email
        .as_ref()
        .is_some_and(|email| email != &existing.email)
    {
        fields.push("email");
    }
    if input.full_name.is_some() && input.full_name.as_ref() != existing.full_name.as_ref() {
        fields.push("full_name");
    }
    if input.phone.is_some() && input.phone.as_ref() != existing.phone.as_ref() {
        fields.push("phone");
    }
    if input
        .is_active
        .is_some_and(|is_active| is_active != existing.is_active)
    {
        fields.push("is_active");
    }
    if password_changed {
        fields.push("password");
    }

    fields
}

fn validate_access_code(value: &str, kind: &str) -> Result<(), ApiError> {
    let valid = value
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-' || c == ':')
        && value.len() <= 100
        && !value.is_empty();

    if valid {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid {kind} value in route policy: {value}"
        )))
    }
}

fn validate_access_codes(values: &[String], kind: &str) -> Result<(), ApiError> {
    for value in values {
        validate_access_code(value, kind)?;
    }
    Ok(())
}

fn validate_route_policy_input(input: &RouteAccessPolicyInput) -> Result<(), ApiError> {
    validate_access_codes(&input.required_permissions, "permission")?;
    validate_access_codes(&input.nav_permissions, "permission")?;
    validate_access_codes(&input.required_roles, "role")?;
    validate_access_codes(&input.excluded_roles, "role")?;
    validate_access_codes(&input.nav_roles, "role")?;
    validate_access_codes(&input.nav_excluded_roles, "role")
}

async fn ensure_actor_can_manage_roles(
    pool: &DbPool,
    actor_user_id: i64,
    role_ids: &[i64],
) -> Result<(), ApiError> {
    if role_ids.is_empty() {
        return Ok(());
    }

    let actor_priority = RbacRepository::max_role_priority_for_user(pool, actor_user_id).await?;
    for role_id in role_ids {
        let role_priority = RbacRepository::role_priority(pool, *role_id)
            .await?
            .ok_or_else(|| {
                ApiError::BadRequest(format!("Role with id {} does not exist", role_id))
            })?;

        if role_priority >= actor_priority {
            return Err(ApiError::Forbidden(
                "Cannot manage a role at or above your access priority".to_string(),
            ));
        }
    }

    Ok(())
}

async fn ensure_actor_can_manage_user(
    pool: &DbPool,
    actor_user_id: i64,
    target_user_id: i64,
) -> Result<(), ApiError> {
    let target_role_ids = RbacRepository::user_role_ids(pool, target_user_id).await?;
    ensure_actor_can_manage_roles(pool, actor_user_id, &target_role_ids).await
}
