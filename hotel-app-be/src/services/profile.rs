//! User profile workflows

use crate::constants::UserType;
use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{PasswordUpdateInput, UserProfile, UserProfileUpdate, UserSessionInfo};
use crate::repositories::user::UserRepository;
use crate::services::audit::AuditLog;
use crate::utils::sanitization::Sanitizer;
use chrono::{Duration, Utc};
use validator::Validate;
use crate::models::AuditEvent;

const UNCONFIGURED_EMAIL_SUFFIX: &str = "@no-email.invalid";

pub async fn get_user_profile(pool: &DbPool, user_id: i64) -> Result<UserProfile, ApiError> {
    UserRepository::get_profile(pool, user_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("User not found".to_string()))
}

pub async fn update_user_profile(
    pool: &DbPool,
    user_id: i64,
    mut input: UserProfileUpdate,
) -> Result<UserProfile, ApiError> {
    if let Some(full_name) = &input.full_name {
        input.full_name = Some(Sanitizer::sanitize_guest_name(full_name));
    }
    if let Some(email) = &input.email {
        input.email = Some(Sanitizer::sanitize_email(email));
    }
    if let Some(phone) = &input.phone {
        input.phone = Some(Sanitizer::sanitize_phone(phone));
    }
    if let Some(avatar_url) = &input.avatar_url {
        input.avatar_url = Sanitizer::sanitize_url(avatar_url);
    }

    input
        .validate()
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;

    if let Some(full_name) = input.full_name {
        UserRepository::update_full_name(pool, user_id, &full_name).await?;
    }
    if let Some(email) = input.email {
        let account = UserRepository::find_by_id(pool, user_id)
            .await?
            .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;
        let email_changed = !account.email.eq_ignore_ascii_case(&email);
        let is_guest = account.user_type == Some(UserType::Guest);
        let email_configured = !account
            .email
            .to_ascii_lowercase()
            .ends_with(UNCONFIGURED_EMAIL_SUFFIX);

        if is_guest && email_changed {
            if email_configured {
                return Err(ApiError::BadRequest(
                    "Your email is already configured and cannot be changed here".to_string(),
                ));
            }
            if UserRepository::email_exists_for_other_user(pool, user_id, &email).await? {
                return Err(ApiError::Conflict(
                    "An account with this email already exists".to_string(),
                ));
            }

            let verification_token = AuthService::generate_email_verification_token();
            let configured = UserRepository::configure_guest_email(
                pool,
                user_id,
                &email,
                &verification_token,
                Utc::now() + Duration::hours(24),
            )
            .await?;
            if !configured {
                return Err(ApiError::Conflict(
                    "Email has already been configured".to_string(),
                ));
            }
        } else if email_changed {
            UserRepository::update_email(pool, user_id, &email).await?;
        }
    }
    if let Some(phone) = input.phone {
        UserRepository::update_phone(pool, user_id, &phone).await?;
    }
    if let Some(avatar_url) = input.avatar_url {
        UserRepository::update_avatar_url(pool, user_id, &avatar_url).await?;
    }

    get_user_profile(pool, user_id).await
}

pub async fn update_password(
    pool: &DbPool,
    user_id: i64,
    input: PasswordUpdateInput,
) -> Result<(), ApiError> {
    input
        .validate()
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    AuthService::validate_password(&input.new_password).map_err(ApiError::BadRequest)?;

    let current_hash = UserRepository::get_password_hash(pool, user_id).await?;
    let valid = AuthService::verify_password(&input.current_password, &current_hash)
        .await
        .map_err(|_| ApiError::Internal("Password verification failed".to_string()))?;

    if !valid {
        return Err(ApiError::Unauthorized(
            "Current password is incorrect".to_string(),
        ));
    }

    let new_hash = AuthService::hash_password(&input.new_password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    UserRepository::update_password_hash(pool, user_id, &new_hash).await?;
    AuthService::revoke_all_user_tokens(pool, user_id)
        .await
        .map_err(|error| {
            ApiError::Database(format!(
                "Failed to revoke password-change sessions: {error}"
            ))
        })?;

    let _ = AuditLog::log_password_changed(pool, user_id).await;

    Ok(())
}

pub async fn list_sessions(
    pool: &DbPool,
    user_id: i64,
    current_session_id: Option<&str>,
) -> Result<Vec<UserSessionInfo>, ApiError> {
    let sessions = AuthService::list_active_sessions(pool, user_id)
        .await
        .map_err(|error| ApiError::Database(format!("Failed to list sessions: {error}")))?;

    Ok(sessions
        .into_iter()
        .map(|session| UserSessionInfo {
            is_current: current_session_id.is_some_and(|id| id == session.id),
            id: session.id,
            user_agent: session.user_agent,
            ip_address: session.ip_address.map(mask_ip_address),
            created_at: session.created_at,
            last_used_at: session.last_used_at,
            expires_at: session.expires_at,
        })
        .collect())
}

pub async fn revoke_session(pool: &DbPool, user_id: i64, session_id: &str) -> Result<(), ApiError> {
    let revoked = AuthService::revoke_user_session(pool, user_id, session_id)
        .await
        .map_err(|error| ApiError::Database(format!("Failed to revoke session: {error}")))?;
    if !revoked {
        return Err(ApiError::NotFound("Active session not found".to_string()));
    }

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "session_revoked",
            resource_type: "user",
            resource_id: Some(user_id),
            details: Some(serde_json::json!({ "session_id": session_id })),
            ..Default::default()
        },
    )
    .await;

    Ok(())
}

fn mask_ip_address(ip: String) -> String {
    if let Some((prefix, _)) = ip.rsplit_once('.') {
        return format!("{prefix}.•••");
    }
    if let Some((prefix, _)) = ip.rsplit_once(':') {
        return format!("{prefix}:••••");
    }
    "•••".to_string()
}
