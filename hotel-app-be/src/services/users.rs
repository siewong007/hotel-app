//! User administration workflows.
//!
//! Role *membership* stays in [`crate::services::rbac`]; this module owns the
//! user record itself (create / update / deactivate). Both share the
//! role-priority guard so an administrator can never act on a peer or superior.

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    User, UserCreateInput, UserResponse, UserUpdateInput, UserWithRolesAndPermissions,
};
use crate::repositories::auth::AuthRepository;
use crate::repositories::rbac::RbacRepository;
use crate::repositories::user::UserRepository;
use crate::services::audit::AuditLog;
use crate::services::rbac::{ensure_actor_can_manage_roles, ensure_actor_can_manage_user};
use crate::utils::sanitization::Sanitizer;
use validator::Validate;

pub async fn users(pool: &DbPool) -> Result<Vec<UserResponse>, ApiError> {
    Ok(UserRepository::list_all(pool)
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
    let user = UserRepository::create_with_roles(pool, &input, &password_hash, &role_ids).await?;

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

    let existing = UserRepository::find_by_id(pool, user_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;
    ensure_actor_can_manage_user(pool, admin_user_id, user_id).await?;

    if admin_user_id == user_id && input.is_active == Some(false) {
        return Err(ApiError::BadRequest(
            "Cannot deactivate your own user account".to_string(),
        ));
    }

    if UserRepository::username_or_email_exists_for_other(
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
    let user = UserRepository::admin_update(pool, user_id, &input, password_hash.as_deref()).await?;

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

    if !UserRepository::exists(pool, user_id).await? {
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

    if !UserRepository::soft_delete(pool, user_id).await? {
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
