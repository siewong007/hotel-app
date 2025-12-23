//! Authentication handlers
//!
//! Handles login, logout, registration, and token management.

use crate::core::auth::AuthService;
use crate::core::error::ApiError;
use crate::models::*;
use sqlx::PgPool;
use axum::{
    extract::State,
    response::Json,
};

pub async fn login_handler(
    State(pool): State<PgPool>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE (username = $1 OR email = $1) AND deleted_at IS NULL"
    )
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let user = match user {
        Some(u) if u.is_active => u,
        Some(_) => return Err(ApiError::Unauthorized("Account is inactive".to_string())),
        None => return Err(ApiError::Unauthorized("Invalid credentials".to_string())),
    };

    // Check email verification (can be disabled in development with SKIP_EMAIL_VERIFICATION env var)
    let skip_email_verification = std::env::var("SKIP_EMAIL_VERIFICATION")
        .unwrap_or_else(|_| "false".to_string())
        .to_lowercase() == "true";

    if !skip_email_verification && !user.is_verified {
        return Err(ApiError::Unauthorized(
            "Please verify your email address before logging in. Check your email for the verification link.".to_string()
        ));
    }

    // Get password hash
    let password_hash: String = sqlx::query_scalar(
        "SELECT password_hash FROM users WHERE id = $1"
    )
    .bind(user.id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Verify password
    let valid = AuthService::verify_password(&req.password, &password_hash).await
        .map_err(|_| ApiError::Internal("Password verification failed".to_string()))?;

    if !valid {
        return Err(ApiError::Unauthorized("Invalid credentials".to_string()));
    }

    // Get user 2FA status and check if 2FA code is required
    let (two_factor_enabled, two_factor_secret): (Option<bool>, Option<String>) = sqlx::query_as(
        "SELECT two_factor_enabled, two_factor_secret FROM users WHERE id = $1"
    )
    .bind(user.id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // If 2FA is enabled, verify the TOTP code
    if two_factor_enabled.unwrap_or(false) {
        if let Some(totp_code) = &req.totp_code {
            let valid_totp = AuthService::verify_totp_code(
                &two_factor_secret.ok_or_else(|| ApiError::Internal("2FA secret missing".to_string()))?,
                totp_code
            ).map_err(|_| ApiError::Unauthorized("Invalid 2FA code".to_string()))?;

            if !valid_totp {
                return Err(ApiError::Unauthorized("Invalid 2FA code".to_string()));
            }
        } else {
            return Err(ApiError::Unauthorized("2FA required. Please provide a TOTP code.".to_string()));
        }
    }

    // Get roles and permissions
    let roles = AuthService::get_user_roles(&pool, user.id).await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let permissions = AuthService::get_user_permissions(&pool, user.id).await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Generate tokens
    let access_token = AuthService::generate_jwt(user.id, user.username.clone(), roles.clone())
        .map_err(|e| ApiError::Internal(format!("Token generation failed: {}", e)))?;

    // Generate secure refresh token
    let refresh_token = AuthService::generate_refresh_token();

    // Check if this is the first login
    let is_first_login: bool = sqlx::query_scalar(
        "SELECT last_login_at IS NULL FROM users WHERE id = $1"
    )
    .bind(user.id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    // Store refresh token (expires in 30 days)
    AuthService::store_refresh_token(&pool, user.id, &refresh_token, 30)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to store refresh token: {}", e)))?;

    // Update last login
    sqlx::query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .ok();

    let response = AuthResponse {
        access_token,
        refresh_token,
        user,
        roles,
        permissions,
        is_first_login,
    };

    Ok(Json(response))
}

pub async fn refresh_token_handler(
    State(pool): State<PgPool>,
    Json(req): Json<RefreshTokenRequest>,
) -> Result<Json<RefreshTokenResponse>, ApiError> {
    // Validate refresh token
    let user_id = AuthService::validate_refresh_token(&pool, &req.refresh_token)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::Unauthorized("Invalid or expired refresh token".to_string()))?;

    // Get user info
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE id = $1 AND deleted_at IS NULL"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::Unauthorized("User not found".to_string()))?;

    if !user.is_active {
        return Err(ApiError::Unauthorized("Account is inactive".to_string()));
    }

    // Get roles
    let roles = AuthService::get_user_roles(&pool, user.id).await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Generate new access token
    let access_token = AuthService::generate_jwt(user.id, user.username.clone(), roles.clone())
        .map_err(|e| ApiError::Internal(format!("Token generation failed: {}", e)))?;

    // Generate new refresh token
    let new_refresh_token = AuthService::generate_refresh_token();

    // Revoke old refresh token
    AuthService::revoke_refresh_token(&pool, &req.refresh_token)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to revoke old token: {}", e)))?;

    // Store new refresh token (expires in 30 days)
    AuthService::store_refresh_token(&pool, user.id, &new_refresh_token, 30)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to store refresh token: {}", e)))?;

    let response = RefreshTokenResponse {
        access_token,
        refresh_token: new_refresh_token,
    };

    Ok(Json(response))
}

pub async fn logout_handler(
    State(pool): State<PgPool>,
    Json(req): Json<RefreshTokenRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Revoke the refresh token
    AuthService::revoke_refresh_token(&pool, &req.refresh_token)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to revoke token: {}", e)))?;

    Ok(Json(serde_json::json!({"message": "Logged out successfully"})))
}

pub async fn register_handler(
    State(pool): State<PgPool>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Validate password
    AuthService::validate_password(&req.password)
        .map_err(|e| ApiError::BadRequest(e))?;

    // Check if username or email already exists
    let existing_user: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM users WHERE username = $1 OR email = $2 LIMIT 1"
    )
    .bind(&req.username)
    .bind(&req.email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if existing_user.is_some() {
        return Err(ApiError::BadRequest("Username or email already exists".to_string()));
    }

    // Start transaction for atomic guest + user creation
    let mut tx = pool.begin().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // 1. Create guest profile FIRST
    let guest: Guest = sqlx::query_as(
        r#"
        INSERT INTO guests (
            first_name, last_name, full_name, email, phone, is_active, created_at
        )
        VALUES ($1, $2, $3, $4, $5, true, CURRENT_TIMESTAMP)
        RETURNING *
        "#
    )
    .bind(&req.first_name)
    .bind(&req.last_name)
    .bind(format!("{} {}", req.first_name, req.last_name))
    .bind(&req.email)
    .bind(&req.phone)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // 2. Hash password
    let password_hash = AuthService::hash_password(&req.password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    // 3. Create user account linked to guest
    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (
            username, email, password_hash, full_name, phone,
            user_type, guest_id, is_active, is_verified, created_at
        )
        VALUES ($1, $2, $3, $4, $5, 'guest', $6, true, false, CURRENT_TIMESTAMP)
        RETURNING id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at
        "#
    )
    .bind(&req.username)
    .bind(&req.email)
    .bind(&password_hash)
    .bind(format!("{} {}", req.first_name, req.last_name))
    .bind(&req.phone)
    .bind(guest.id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // 4. Generate and store email verification token
    let verification_token = AuthService::create_email_verification_token(&pool, user.id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // 5. Automatically assign "guest" role
    let guest_role_id: i64 = sqlx::query_scalar(
        "SELECT id FROM roles WHERE name = 'guest' LIMIT 1"
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(format!("Guest role not found: {}", e)))?;

    sqlx::query(
        "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)"
    )
    .bind(user.id)
    .bind(guest_role_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // 6. Create loyalty membership using guest.id directly
    let loyalty_program_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM loyalty_programs WHERE tier_level = 1 ORDER BY created_at LIMIT 1"
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if let Some(program_id) = loyalty_program_id {
        sqlx::query(
            r#"
            INSERT INTO loyalty_memberships (
                guest_id, program_id, membership_number,
                points_balance, lifetime_points, tier_level, status, enrolled_date
            )
            VALUES ($1, $2, $3, 0, 0, 1, 'active', CURRENT_DATE)
            "#
        )
        .bind(guest.id)
        .bind(program_id)
        .bind(format!("LM-{:08}", guest.id))
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    // 7. Commit transaction
    tx.commit().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "message": "Registration successful! Please check your email to verify your account.",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "user_type": user.user_type,
            "is_verified": user.is_verified,
        },
        "guest_id": guest.id,
        "verification_token": verification_token
    })))
}

pub async fn verify_email_handler(
    State(pool): State<PgPool>,
    Json(req): Json<EmailVerificationConfirm>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = AuthService::verify_email_token(&pool, &req.token)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    match user_id {
        Some(id) => Ok(Json(serde_json::json!({
            "message": "Email verified successfully",
            "user_id": id
        }))),
        None => Err(ApiError::BadRequest("Invalid or expired verification token".to_string())),
    }
}

pub async fn resend_verification_handler(
    State(pool): State<PgPool>,
    Json(req): Json<ResendVerificationRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user = AuthService::get_user_by_email(&pool, &req.email)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let user = match user {
        Some(u) => u,
        None => return Err(ApiError::NotFound("User not found".to_string())),
    };

    if user.is_verified {
        return Err(ApiError::BadRequest("Email is already verified".to_string()));
    }

    // Generate new verification token
    let verification_token = AuthService::create_email_verification_token(&pool, user.id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "message": "Verification email sent successfully",
        "verification_token": verification_token
    })))
}
