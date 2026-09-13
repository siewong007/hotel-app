//! User administration workflows.
//!
//! Role *membership* stays in [`crate::services::rbac`]; this module owns the
//! user record itself (create / update / deactivate). Both share the
//! role-priority guard so an administrator can never act on a peer or superior.

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::AuditEvent;
use crate::models::auth::UserSessionInfo;
use crate::models::{
    InviteUserInput, InviteUserResponse, StaffDirectoryQuery, StaffDirectoryResponse, User,
    UserCreateInput, UserResponse, UserUpdateInput, UserWithRolesAndPermissions,
};
use crate::repositories::auth::AuthRepository;
use crate::repositories::rbac::RbacRepository;
use crate::repositories::user::UserRepository;
use crate::services::audit::AuditLog;
use crate::services::profile::{location_from_timezone, mask_ip_address};
use crate::services::rbac::{ensure_actor_can_manage_roles, ensure_actor_can_manage_user};
use crate::utils::pagination::normalize_pagination;
use crate::utils::sanitization::Sanitizer;
use chrono::{Duration, Utc};
use validator::Validate;

/// Invite links stay usable for 72 hours — long enough to survive a weekend
/// between "invite" and "first shift", short enough that a leaked link cannot
/// mint a credential weeks later.
const INVITE_TOKEN_TTL_HOURS: i64 = 72;

pub async fn users(pool: &DbPool) -> Result<Vec<UserResponse>, ApiError> {
    Ok(UserRepository::list_all(pool)
        .await?
        .into_iter()
        .map(UserResponse::from)
        .collect())
}

/// Server-side staff directory: search + status + role filters, pagination and
/// whitelisted sorting. Guest-portal accounts never appear — `list_all` and
/// this both filter `user_type = 'staff'`.
pub async fn staff_directory(
    pool: &DbPool,
    query: StaffDirectoryQuery,
) -> Result<StaffDirectoryResponse, ApiError> {
    if let Some(status) = query.status.as_deref()
        && !["active", "suspended", "locked"].contains(&status)
    {
        return Err(ApiError::BadRequest(format!(
            "Invalid status filter '{status}' — expected active, suspended or locked"
        )));
    }
    let pagination = normalize_pagination(query.page, query.page_size, 25, 100);
    let (total, data) =
        UserRepository::list_staff_directory(pool, &query, pagination.page_size, pagination.offset)
            .await?;
    let total_pages = (total as f64 / pagination.page_size as f64).ceil() as i64;
    Ok(StaffDirectoryResponse {
        data,
        total,
        page: pagination.page,
        page_size: pagination.page_size,
        total_pages,
    })
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
        AuditEvent {
            user_id: Some(admin_user_id),
            action: "user_created",
            resource_type: "user",
            resource_id: Some(user.id),
            details: Some(serde_json::json!({"username": &input.username, "email": &input.email})),
            ..Default::default()
        },
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
    // Passkeys are revoked too — they satisfy 2FA on their own and would
    // otherwise survive every password change.
    if password_hash.is_some() {
        AuthService::revoke_all_user_tokens(pool, user_id)
            .await
            .map_err(|error| {
                ApiError::Database(format!("Failed to revoke password-reset sessions: {error}"))
            })?;
        let revoked =
            crate::repositories::passkey::PasskeyRepository::revoke_all_for_user(pool, user_id)
                .await
                .map_err(|error| {
                    ApiError::Database(format!("Failed to revoke passkeys after reset: {error}"))
                })?;
        if revoked > 0 {
            let _ = crate::services::audit::AuditLog::log_event(
                pool,
                crate::models::AuditEvent {
                    user_id: Some(admin_user_id),
                    action: "passkeys_revoked_by_password_reset",
                    resource_type: "user",
                    resource_id: Some(user_id),
                    details: Some(serde_json::json!({ "revoked": revoked })),
                    ..Default::default()
                },
            )
            .await;
        }
    }

    let changed_fields = changed_user_fields(&existing, &input, password_hash.is_some());
    let user =
        UserRepository::admin_update(pool, user_id, &input, password_hash.as_deref()).await?;

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
        AuditEvent {
            user_id: Some(admin_user_id),
            action: "user_updated",
            resource_type: "user",
            resource_id: Some(user_id),
            details: Some(serde_json::json!({"changed_fields": changed_fields})),
            ..Default::default()
        },
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
        AuditEvent {
            user_id: Some(admin_user_id),
            action: "user_deleted",
            resource_type: "user",
            resource_id: Some(user_id),
            details: None,
            ..Default::default()
        },
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

/// Load the target staff account, then run the shared role-priority guard.
/// Guest accounts are rejected — administration actions never target them.
async fn staff_target(pool: &DbPool, admin_user_id: i64, user_id: i64) -> Result<User, ApiError> {
    let target = UserRepository::find_by_id(pool, user_id)
        .await?
        .filter(|user| {
            user.user_type
                .as_ref()
                .is_none_or(|kind| *kind == crate::constants::UserType::Staff)
        })
        .ok_or_else(|| ApiError::NotFound("Staff user not found".to_string()))?;
    ensure_actor_can_manage_user(pool, admin_user_id, user_id).await?;
    Ok(target)
}

/// Guard against removing the last active super-admin — that account is the
/// only thing that can still manage the permission catalogue.
async fn ensure_not_last_super_admin(pool: &DbPool, target: &User) -> Result<(), ApiError> {
    if target.is_super_admin && UserRepository::count_active_super_admins(pool).await? <= 1 {
        return Err(ApiError::BadRequest(
            "Cannot suspend or deactivate the last active super-admin".to_string(),
        ));
    }
    Ok(())
}

/// Suspend a staff account: `is_active = false` plus revocation of every
/// refresh token, so the account stops working within one access-token TTL.
pub async fn suspend_user(
    pool: &DbPool,
    admin_user_id: i64,
    user_id: i64,
) -> Result<UserResponse, ApiError> {
    if admin_user_id == user_id {
        return Err(ApiError::BadRequest(
            "Cannot suspend your own user account".to_string(),
        ));
    }
    let target = staff_target(pool, admin_user_id, user_id).await?;
    ensure_not_last_super_admin(pool, &target).await?;
    if !target.is_active {
        return Err(ApiError::BadRequest(
            "User is already suspended".to_string(),
        ));
    }

    // Revoke first — identical ordering to delete_user: a failed revoke must
    // not leave a session alive while the administrator retries.
    AuthService::revoke_all_user_tokens(pool, user_id)
        .await
        .map_err(|error| ApiError::Database(format!("Failed to revoke sessions: {error}")))?;
    let user = UserRepository::set_active(pool, user_id, false).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(admin_user_id),
            action: "user_suspended",
            resource_type: "user",
            resource_id: Some(user_id),
            details: Some(serde_json::json!({"username": &user.username})),
            ..Default::default()
        },
    )
    .await;
    crate::core::rbac_cache::invalidate_all();
    Ok(user.into())
}

pub async fn reactivate_user(
    pool: &DbPool,
    admin_user_id: i64,
    user_id: i64,
) -> Result<UserResponse, ApiError> {
    let target = staff_target(pool, admin_user_id, user_id).await?;
    if target.is_active {
        return Err(ApiError::BadRequest("User is already active".to_string()));
    }
    let user = UserRepository::set_active(pool, user_id, true).await?;
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(admin_user_id),
            action: "user_reactivated",
            resource_type: "user",
            resource_id: Some(user_id),
            details: Some(serde_json::json!({"username": &user.username})),
            ..Default::default()
        },
    )
    .await;
    crate::core::rbac_cache::invalidate_all();
    Ok(user.into())
}

/// Clear the lockout triplet (`is_locked`, `locked_until`,
/// `failed_login_attempts`). Deliberately separate from reactivation: an
/// account can be active-but-locked by `max_login_attempts` and needs a
/// distinct, auditable unblock.
pub async fn unlock_user(
    pool: &DbPool,
    admin_user_id: i64,
    user_id: i64,
) -> Result<UserResponse, ApiError> {
    let target = staff_target(pool, admin_user_id, user_id).await?;
    if !target.is_locked && target.failed_login_attempts == 0 && target.locked_until.is_none() {
        return Err(ApiError::BadRequest("User is not locked".to_string()));
    }
    let user = UserRepository::clear_lockout(pool, user_id).await?;
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(admin_user_id),
            action: "user_unlocked",
            resource_type: "user",
            resource_id: Some(user_id),
            details: Some(serde_json::json!({"username": &user.username})),
            ..Default::default()
        },
    )
    .await;
    Ok(user.into())
}

/// Active sessions for a staff account (admin view — same projection the
/// profile page shows its owner, including the masked IP).
pub async fn user_sessions(
    pool: &DbPool,
    admin_user_id: i64,
    user_id: i64,
) -> Result<Vec<UserSessionInfo>, ApiError> {
    staff_target(pool, admin_user_id, user_id).await?;
    let sessions = AuthService::list_active_sessions(pool, user_id)
        .await
        .map_err(|error| ApiError::Database(error.to_string()))?;
    Ok(sessions
        .into_iter()
        .map(|session| UserSessionInfo {
            is_current: false,
            id: session.id,
            user_agent: session.user_agent,
            ip_address: session.ip_address.map(mask_ip_address),
            created_at: session.created_at,
            last_used_at: session.last_used_at,
            expires_at: session.expires_at,
            location: session
                .client_timezone
                .as_deref()
                .and_then(location_from_timezone),
            timezone: session.client_timezone,
        })
        .collect())
}

/// Revoke every active session for a staff account.
pub async fn revoke_user_sessions(
    pool: &DbPool,
    admin_user_id: i64,
    user_id: i64,
) -> Result<(), ApiError> {
    if admin_user_id == user_id {
        return Err(ApiError::BadRequest(
            "Use your own profile page to revoke your sessions".to_string(),
        ));
    }
    staff_target(pool, admin_user_id, user_id).await?;
    AuthService::revoke_all_user_tokens(pool, user_id)
        .await
        .map_err(|error| ApiError::Database(format!("Failed to revoke sessions: {error}")))?;
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(admin_user_id),
            action: "sessions_revoked",
            resource_type: "user",
            resource_id: Some(user_id),
            details: None,
            ..Default::default()
        },
    )
    .await;
    Ok(())
}

/// Revoke one named session of a staff account.
pub async fn revoke_user_session(
    pool: &DbPool,
    admin_user_id: i64,
    user_id: i64,
    session_id: &str,
) -> Result<(), ApiError> {
    staff_target(pool, admin_user_id, user_id).await?;
    let revoked = AuthService::revoke_user_session(pool, user_id, session_id)
        .await
        .map_err(|error| ApiError::Database(error.to_string()))?;
    if !revoked {
        return Err(ApiError::NotFound("Session not found".to_string()));
    }
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(admin_user_id),
            action: "session_revoked",
            resource_type: "user",
            resource_id: Some(user_id),
            details: Some(serde_json::json!({"session_id": session_id})),
            ..Default::default()
        },
    )
    .await;
    Ok(())
}

/// Invite a staff member: creates the account with no password and returns a
/// one-time acceptance link. The link is handed to the administrator —
/// `email_deliveries` is guest-scoped (`guest_id NOT NULL`), so staff invites
/// cannot ride the mail pipeline without schema changes; delivery is
/// deliberately out of band.
pub async fn invite_user(
    pool: &DbPool,
    admin_user_id: i64,
    mut input: InviteUserInput,
) -> Result<InviteUserResponse, ApiError> {
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

    if AuthRepository::username_or_email_exists(pool, &input.username, Some(&input.email)).await? {
        return Err(ApiError::BadRequest(
            "Username or email already exists".to_string(),
        ));
    }

    let role_ids = input.role_ids.clone().unwrap_or_default();
    ensure_actor_can_manage_roles(pool, admin_user_id, &role_ids).await?;

    let token = AuthService::generate_email_verification_token();
    let token_hash = AuthService::hash_email_verification_token(&token);
    let expires_at = Utc::now() + Duration::hours(INVITE_TOKEN_TTL_HOURS);

    let user = UserRepository::create_invited_with_roles(
        pool,
        &crate::repositories::user::NewInvite {
            username: &input.username,
            email: &input.email,
            full_name: input.full_name.as_deref(),
            phone: input.phone.as_deref(),
            role_ids: &role_ids,
            token_hash: &token_hash,
            token_expires_at: expires_at,
        },
    )
    .await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(admin_user_id),
            action: "user_invited",
            resource_type: "user",
            resource_id: Some(user.id),
            details: Some(serde_json::json!({"username": &user.username, "email": &user.email})),
            ..Default::default()
        },
    )
    .await;

    Ok(InviteUserResponse {
        user: user.into(),
        invite_url: crate::modules::communications::email_layout::absolute_url(&format!(
            "/accept-invite?token={token}"
        )),
        expires_at,
    })
}

/// Mint a fresh invite link for an account whose invitation is still pending.
/// Errors for accounts that already set a password.
pub async fn resend_invite(
    pool: &DbPool,
    admin_user_id: i64,
    user_id: i64,
) -> Result<InviteUserResponse, ApiError> {
    let target = staff_target(pool, admin_user_id, user_id).await?;
    if !UserRepository::invitation_pending(pool, user_id).await? {
        return Err(ApiError::BadRequest(
            "This account has already accepted its invitation".to_string(),
        ));
    }

    let token = AuthService::generate_email_verification_token();
    let token_hash = AuthService::hash_email_verification_token(&token);
    let expires_at = Utc::now() + Duration::hours(INVITE_TOKEN_TTL_HOURS);
    UserRepository::refresh_invite_token(pool, user_id, &token_hash, expires_at).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(admin_user_id),
            action: "invite_resent",
            resource_type: "user",
            resource_id: Some(user_id),
            details: Some(serde_json::json!({"username": &target.username})),
            ..Default::default()
        },
    )
    .await;

    Ok(InviteUserResponse {
        user: target.into(),
        invite_url: crate::modules::communications::email_layout::absolute_url(&format!(
            "/accept-invite?token={token}"
        )),
        expires_at,
    })
}

/// Public invite acceptance: valid token + still-passwordless staff account +
/// fresh password, all applied in one UPDATE so a half-accepted invite is
/// impossible.
pub async fn accept_invite(
    pool: &DbPool,
    input: crate::models::AcceptInviteInput,
) -> Result<(), ApiError> {
    input
        .validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    AuthService::validate_password(&input.password).map_err(ApiError::BadRequest)?;

    let token_hash = AuthService::hash_email_verification_token(input.token.trim());
    let password_hash = AuthService::hash_password(&input.password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    let user_id = UserRepository::accept_invitation(pool, &token_hash, &password_hash)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Invalid or expired invite link".to_string()))?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "invite_accepted",
            resource_type: "user",
            resource_id: Some(user_id),
            details: None,
            ..Default::default()
        },
    )
    .await;
    Ok(())
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
