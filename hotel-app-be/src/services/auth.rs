//! Authentication business workflows.

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    AccessSnapshot, AuthResponse, EmailVerificationConfirm, LoginRequest, RefreshTokenRequest,
    RefreshTokenResponse, RegisterRequest, ResendVerificationRequest, UserResponse,
};
use crate::repositories::auth::AuthRepository;
use crate::repositories::guest::GuestRepository;
use crate::repositories::rbac::RbacRepository;
use crate::services::audit::AuditLog;
use crate::utils::sanitization::Sanitizer;
use chrono::{Duration, Utc};
use serde_json::json;
use validator::Validate;

/// Authenticates a user. Returns the `AuthResponse` (access token + profile) plus
/// the freshly minted refresh token as a separate `String`; the route handler
/// sets that token on an `HttpOnly` cookie and never includes it in the JSON body.
pub async fn login(
    pool: &DbPool,
    req: LoginRequest,
    ip_address: Option<&str>,
    user_agent: Option<&str>,
) -> Result<(AuthResponse, String), ApiError> {
    req.validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let user = AuthRepository::find_user_by_login(pool, &req.username).await?;
    let user = match user {
        Some(user) if user.is_active => user,
        Some(_) => {
            let _ =
                AuditLog::log_login_failure(pool, &req.username, "Account is inactive", None, None)
                    .await;
            return Err(ApiError::Unauthorized("Account is inactive".to_string()));
        }
        None => {
            let _ = AuditLog::log_login_failure(pool, &req.username, "User not found", None, None)
                .await;
            return Err(ApiError::Unauthorized("Invalid credentials".to_string()));
        }
    };

    let (is_locked, locked_until, failed_attempts) =
        AuthRepository::login_lock_state(pool, user.id).await?;
    if is_locked.unwrap_or(false)
        && let Some(until) = locked_until
    {
        let now = Utc::now();
        if now < until {
            let remaining_mins = (until - now).num_minutes() + 1;
            let _ = AuditLog::log_login_failure(pool, &req.username, "Account locked", None, None)
                .await;
            return Err(ApiError::TooManyRequests(format!(
                "Account is locked due to too many failed attempts. Try again in {} minute(s).",
                remaining_mins
            )));
        }
        let _ = AuthRepository::unlock_user(pool, user.id).await;
    }

    let skip_email_verification = crate::core::config::get().skip_email_verification;

    if !skip_email_verification && !user.is_verified {
        return Err(ApiError::Unauthorized(
            "Please verify your email address before logging in. Check your email for the verification link.".to_string()
        ));
    }

    let password_hash = AuthRepository::password_hash(pool, user.id).await?;
    let max_attempts = AuthRepository::max_login_attempts(pool).await;

    let valid = AuthService::verify_password(&req.password, &password_hash)
        .await
        .map_err(|_| ApiError::Internal("Password verification failed".to_string()))?;

    if !valid {
        let new_attempts = failed_attempts.unwrap_or(0) + 1;
        let should_lock = new_attempts >= max_attempts;

        if should_lock {
            AuthRepository::lock_user_after_failure(
                pool,
                user.id,
                new_attempts,
                Utc::now() + Duration::minutes(30),
            )
            .await?;
            AuthService::revoke_all_user_tokens(pool, user.id)
                .await
                .map_err(|error| {
                    ApiError::Database(format!("Failed to revoke locked-user sessions: {error}"))
                })?;

            let _ = AuditLog::log_login_failure(
                pool,
                &req.username,
                "Account locked after max attempts",
                None,
                None,
            )
            .await;
            return Err(ApiError::TooManyRequests(
                "Account locked due to too many failed login attempts. Try again in 30 minutes."
                    .to_string(),
            ));
        }

        let _ = AuthRepository::update_failed_login_attempts(pool, user.id, new_attempts).await;
        let remaining = max_attempts - new_attempts;
        let _ =
            AuditLog::log_login_failure(pool, &req.username, "Invalid password", None, None).await;
        return Err(ApiError::Unauthorized(format!(
            "Invalid credentials. {} attempt(s) remaining before account lockout.",
            remaining
        )));
    }

    let (two_factor_enabled, two_factor_secret) =
        AuthRepository::two_factor_state(pool, user.id).await?;
    // Set only when this login consumed a recovery code (the lost-authenticator
    // path); carried through to the response so the client can warn the user.
    let mut recovery_codes_remaining: Option<usize> = None;
    if two_factor_enabled.unwrap_or(false) {
        let Some(submitted_code) = &req.totp_code else {
            let _ = AuditLog::log_login_failure(
                pool,
                &req.username,
                "2FA code not provided",
                None,
                None,
            )
            .await;
            return Err(ApiError::Unauthorized(
                "2FA required. Please provide a TOTP code or recovery code.".to_string(),
            ));
        };

        let secret = two_factor_secret
            .ok_or_else(|| ApiError::Internal("2FA secret missing".to_string()))?;
        // TOTP first, then recovery-code fallback — the same order the
        // 2FA-disable flow uses. Recovery codes must work here: this is the
        // only unauthenticated surface, so without it a user who lost their
        // authenticator is locked out despite holding valid codes.
        let valid_totp = match AuthService::verify_totp_code(&secret, submitted_code) {
            Ok(valid) => valid,
            Err(error) => {
                log::warn!("TOTP verification errored for user {}: {error}", user.id);
                false
            }
        };
        if !valid_totp {
            let recovery_codes = user.two_factor_recovery_codes.clone().unwrap_or_default();
            // check_recovery_code identifies the matching stored entry
            // (constant-time, hash or legacy plaintext); the guarded
            // consume_recovery_code then spends that exact entry atomically,
            // so a concurrent login replaying the same code loses the race
            // and falls through to the failure path below.
            let consumed = match AuthService::check_recovery_code(submitted_code, &recovery_codes)
            {
                Some(index) => {
                    AuthService::consume_recovery_code(pool, user.id, &recovery_codes[index])
                        .await
                        .map_err(|e| ApiError::Database(e.to_string()))?
                }
                None => None,
            };
            match consumed {
                Some(remaining) => {
                    recovery_codes_remaining = Some(remaining);
                    if remaining <= 3 {
                        log::warn!(
                            "User {} logged in with a 2FA recovery code; only {remaining} recovery code(s) remain",
                            user.id
                        );
                    }
                    let _ = AuditLog::log_event(
                        pool,
                        Some(user.id),
                        "two_factor_recovery_code_used",
                        "user",
                        Some(user.id),
                        Some(json!({
                            "context": "login",
                            "recovery_codes_remaining": remaining,
                        })),
                        None,
                        None,
                    )
                    .await;
                }
                None => {
                    let _ = AuditLog::log_login_failure(
                        pool,
                        &req.username,
                        "Invalid 2FA code",
                        None,
                        None,
                    )
                    .await;
                    return Err(ApiError::Unauthorized("Invalid 2FA code".to_string()));
                }
            }
        }
    }

    let _ = AuthRepository::reset_login_attempts(pool, user.id).await;

    let roles = AuthService::get_user_roles(pool, user.id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let permissions = AuthService::get_user_permissions(pool, user.id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let route_policies = RbacRepository::find_all_route_access_policies(pool).await?;

    let refresh_token = AuthService::generate_refresh_token();
    let is_first_login = AuthRepository::is_first_login(pool, user.id)
        .await
        .unwrap_or(false);

    let session_id =
        AuthService::store_refresh_token(pool, user.id, &refresh_token, 30, ip_address, user_agent)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to store refresh token: {}", e)))?;
    let access_token = AuthService::generate_session_jwt(
        user.id,
        user.username.clone(),
        roles.clone(),
        session_id,
    )
    .map_err(|e| ApiError::Internal(format!("Token generation failed: {}", e)))?;

    let _ = AuthRepository::update_last_login(pool, user.id).await;

    let login_method = if recovery_codes_remaining.is_some() {
        "password+2fa_recovery"
    } else if two_factor_enabled.unwrap_or(false) {
        "password+2fa"
    } else {
        "password"
    };
    let _ = AuditLog::log_login_success(pool, user.id, login_method, None, None).await;

    Ok((
        AuthResponse {
            access_token,
            user: UserResponse::from(user),
            roles,
            permissions,
            route_policies,
            is_first_login,
            recovery_codes_remaining,
        },
        refresh_token,
    ))
}

pub async fn access_snapshot(pool: &DbPool, user_id: i64) -> Result<AccessSnapshot, ApiError> {
    let user = AuthRepository::find_user_by_id(pool, user_id)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("User not found".to_string()))?;

    if !user.is_active {
        let _ = AuthService::revoke_all_user_tokens(pool, user.id).await;
        return Err(ApiError::Unauthorized("Account is inactive".to_string()));
    }

    let roles = AuthService::get_user_roles(pool, user.id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let permissions = AuthService::get_user_permissions(pool, user.id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let route_policies = RbacRepository::find_all_route_access_policies(pool).await?;

    Ok(AccessSnapshot {
        roles,
        permissions,
        route_policies,
    })
}

pub async fn refresh_token(
    pool: &DbPool,
    req: RefreshTokenRequest,
) -> Result<RefreshTokenResponse, ApiError> {
    req.validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let (user_id, session_id) = AuthService::validate_refresh_token(pool, &req.refresh_token)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::Unauthorized("Invalid or expired refresh token".to_string()))?;

    let user = AuthRepository::find_user_by_id(pool, user_id)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("User not found".to_string()))?;

    if !user.is_active {
        let _ = AuthService::revoke_all_user_tokens(pool, user.id).await;
        return Err(ApiError::Unauthorized("Account is inactive".to_string()));
    }

    let (is_locked, locked_until, _) = AuthRepository::login_lock_state(pool, user.id).await?;
    if is_locked.unwrap_or(false) {
        if let Some(until) = locked_until {
            let now = Utc::now();
            if now < until {
                let remaining_mins = (until - now).num_minutes() + 1;
                let _ = AuthService::revoke_refresh_token(pool, &req.refresh_token).await;
                return Err(ApiError::TooManyRequests(format!(
                    "Account is locked due to too many failed attempts. Try again in {} minute(s).",
                    remaining_mins
                )));
            }
        } else {
            let _ = AuthService::revoke_refresh_token(pool, &req.refresh_token).await;
            return Err(ApiError::Unauthorized("Account is locked".to_string()));
        }

        let _ = AuthRepository::unlock_user(pool, user.id).await;
    }

    let roles = AuthService::get_user_roles(pool, user.id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let new_refresh_token = AuthService::generate_refresh_token();

    let rotated = AuthService::rotate_refresh_token(
        pool,
        &session_id,
        &req.refresh_token,
        &new_refresh_token,
        30,
    )
    .await
    .map_err(|e| ApiError::Database(format!("Failed to rotate refresh token: {}", e)))?;
    if !rotated {
        return Err(ApiError::Unauthorized(
            "Refresh token was already used or revoked".to_string(),
        ));
    }
    let access_token = AuthService::generate_session_jwt(
        user.id,
        user.username.clone(),
        roles.clone(),
        session_id,
    )
    .map_err(|e| ApiError::Internal(format!("Token generation failed: {}", e)))?;

    Ok(RefreshTokenResponse {
        access_token,
        refresh_token: new_refresh_token,
    })
}

pub async fn logout(pool: &DbPool, req: RefreshTokenRequest) -> Result<(), ApiError> {
    req.validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    AuthService::revoke_refresh_token(pool, &req.refresh_token)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to revoke token: {}", e)))
}

pub async fn register(
    pool: &DbPool,
    mut req: RegisterRequest,
) -> Result<serde_json::Value, ApiError> {
    req.email = req
        .email
        .take()
        .map(|email| Sanitizer::sanitize_email(&email))
        .filter(|email| !email.is_empty());
    req.phone = Sanitizer::sanitize_phone(&req.phone);
    req.address_line1 = req
        .address_line1
        .take()
        .map(|address| Sanitizer::sanitize_text(address.trim()))
        .filter(|address| !address.is_empty());

    req.validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    req.first_name = Sanitizer::sanitize_guest_name(&req.first_name);
    req.last_name = Sanitizer::sanitize_guest_name(&req.last_name);
    AuthService::validate_password(&req.password).map_err(ApiError::BadRequest)?;

    if AuthRepository::username_or_email_exists(pool, &req.username, req.email.as_deref()).await? {
        return Err(ApiError::BadRequest(
            "Username or email already exists".to_string(),
        ));
    }

    let full_name = format!("{} {}", req.first_name, req.last_name);
    if GuestRepository::full_name_conflict_id(pool, &full_name, None)
        .await?
        .is_some()
    {
        return Err(ApiError::Conflict(
            "A guest profile with this name already exists. Please sign in with your existing account or contact the hotel for help."
                .to_string(),
        ));
    }

    let password_hash = AuthService::hash_password(&req.password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    let (guest, user) = AuthRepository::register_guest_user(pool, &req, &password_hash).await?;

    if req.email.is_some() {
        AuthService::create_email_verification_token(pool, user.id)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    let message = if req.email.is_some() {
        "Registration successful! Please check your email to verify your account."
    } else {
        "Registration successful! You can now log in with your username."
    };

    Ok(json!({
        "message": message,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": req.email,
            "full_name": user.full_name,
            "user_type": user.user_type,
            "is_verified": user.is_verified,
        },
        "guest_id": guest.id
    }))
}

pub async fn verify_email(
    pool: &DbPool,
    req: EmailVerificationConfirm,
) -> Result<serde_json::Value, ApiError> {
    req.validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let user_id = AuthService::verify_email_token(pool, &req.token)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    match user_id {
        Some(id) => Ok(json!({
            "message": "Email verified successfully",
            "user_id": id
        })),
        None => Err(ApiError::BadRequest(
            "Invalid or expired verification token".to_string(),
        )),
    }
}

pub async fn resend_verification(
    pool: &DbPool,
    req: ResendVerificationRequest,
) -> Result<serde_json::Value, ApiError> {
    req.validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let email = Sanitizer::sanitize_email(&req.email);

    let user = AuthRepository::find_user_by_email(pool, &email).await?;
    let Some(user) = user else {
        return Ok(generic_verification_response());
    };

    if user.is_verified {
        return Ok(generic_verification_response());
    }

    AuthService::create_email_verification_token(pool, user.id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(generic_verification_response())
}

fn generic_verification_response() -> serde_json::Value {
    json!({
        "message": "If that account needs verification, a new email has been sent."
    })
}
