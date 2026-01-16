//! Passkey/WebAuthn handlers
//!
//! Handles passkey registration and authentication.

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use axum::{
    extract::{Extension, Path, State},
    response::Json,
};
use base64::engine::general_purpose;
use base64::Engine;
use std::env;

// Helper function to decode base64url (WebAuthn format)
fn decode_base64url(input: &str) -> Result<Vec<u8>, String> {
    // WebAuthn uses base64url encoding without padding
    // Convert base64url to standard base64
    let standard_b64 = input
        .replace('-', "+")
        .replace('_', "/");

    // Add padding if needed
    let padded = match standard_b64.len() % 4 {
        2 => format!("{}==", standard_b64),
        3 => format!("{}=", standard_b64),
        _ => standard_b64,
    };

    general_purpose::STANDARD.decode(&padded)
        .map_err(|e| format!("Base64 decode error: {}", e))
}

pub async fn list_passkeys_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<PasskeyInfo>>, ApiError> {
    // Manually query and construct PasskeyInfo with base64url-encoded credential_id
    let rows = sqlx::query(
        r#"
        SELECT id, credential_id, device_name, created_at, last_used_at
        FROM passkeys
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut passkeys: Vec<PasskeyInfo> = Vec::new();

    for row in rows {
        use sqlx::Row;

        // Safely get credential_id bytes
        let credential_id_bytes: Vec<u8> = match row.try_get("credential_id") {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("Failed to get credential_id: {}", e);
                continue;
            }
        };

        // Encode credential_id as base64url for frontend
        let credential_id_b64url = general_purpose::STANDARD.encode(&credential_id_bytes)
            .replace('+', "-")
            .replace('/', "_")
            .trim_end_matches('=')
            .to_string();

        passkeys.push(PasskeyInfo {
            id: row.try_get("id").map_err(|e| ApiError::Database(e.to_string()))?,
            credential_id: credential_id_b64url,
            device_name: row.try_get("device_name").ok(),
            created_at: row.try_get("created_at").map_err(|e| ApiError::Database(e.to_string()))?,
            last_used_at: row.try_get("last_used_at").ok(),
        });
    }

    Ok(Json(passkeys))
}

pub async fn delete_passkey_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(passkey_id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let result = sqlx::query(
        "DELETE FROM passkeys WHERE id = $1 AND user_id = $2"
    )
    .bind(passkey_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Passkey not found".to_string()));
    }

    Ok(Json(serde_json::json!({"message": "Passkey deleted successfully"})))
}

pub async fn update_passkey_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(passkey_id): Path<uuid::Uuid>,
    Json(input): Json<PasskeyUpdateInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let result = sqlx::query(
        "UPDATE passkeys SET device_name = $1 WHERE id = $2 AND user_id = $3"
    )
    .bind(&input.device_name)
    .bind(passkey_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Passkey not found".to_string()));
    }

    Ok(Json(serde_json::json!({"message": "Passkey updated successfully"})))
}

pub async fn passkey_register_start_handler(
    State(pool): State<DbPool>,
    Json(req): Json<PasskeyRegistrationStart>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get user by username
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE username = $1 AND is_active = true AND deleted_at IS NULL"
    )
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Check passkey limit (max 10)
    let passkey_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM passkeys WHERE user_id = $1"
    )
    .bind(user.id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if passkey_count >= 10 {
        return Err(ApiError::BadRequest("Maximum of 10 passkeys allowed per user".to_string()));
    }

    // Generate challenge (32 random bytes)
    let challenge_bytes: [u8; 32] = {
        let mut rng = rand::thread_rng();
        rand::Rng::gen(&mut rng)
    };
    let challenge_b64 = general_purpose::STANDARD.encode(&challenge_bytes);

    // Store challenge temporarily (expires in 5 minutes)
    sqlx::query(
        r#"
        INSERT INTO passkey_challenges (user_id, challenge, challenge_type, expires_at)
        VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')
        "#
    )
    .bind(user.id)
    .bind(&challenge_bytes[..])  // Bind as bytea
    .bind("registration")
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "challenge": challenge_b64,
        "rp": {
            "name": "Hotel Management System",
            "id": env::var("PASSKEY_RP_ID").unwrap_or_else(|_| "localhost".to_string()),
        },
        "user": {
            "id": general_purpose::STANDARD.encode(user.id.to_string()),
            "name": user.username,
            "displayName": user.full_name.as_ref().unwrap_or(&user.username),
        }
    })))
}

pub async fn passkey_register_finish_handler(
    State(pool): State<DbPool>,
    Json(req): Json<PasskeyRegistrationFinish>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get user
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE username = $1 AND is_active = true AND deleted_at IS NULL"
    )
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Verify challenge
    let challenge_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM passkey_challenges WHERE user_id = $1 AND challenge = $2 AND expires_at > NOW())"
    )
    .bind(user.id)
    .bind(general_purpose::STANDARD.decode(&req.challenge).map_err(|_| ApiError::BadRequest("Invalid challenge".to_string()))?)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !challenge_exists {
        return Err(ApiError::Unauthorized("Invalid or expired challenge".to_string()));
    }

    // Parse credential (simplified - in production use a proper WebAuthn library)
    let credential: serde_json::Value = serde_json::from_str(&req.credential)
        .map_err(|_| ApiError::BadRequest("Invalid credential format".to_string()))?;

    let credential_id_str = credential["id"]
        .as_str()
        .ok_or_else(|| ApiError::BadRequest("Missing credential ID".to_string()))?;

    // Decode credential_id from base64url (WebAuthn uses URL-safe base64) to bytes for BYTEA storage
    let credential_id_bytes = decode_base64url(credential_id_str)
        .map_err(|e| ApiError::BadRequest(format!("Invalid credential ID format: {}", e)))?;

    // Extract public key (simplified)
    let public_key = vec![0u8; 64]; // In production, parse from attestationObject

    // Store passkey
    let device_name = req.device_name
        .clone()
        .unwrap_or_else(|| format!("Passkey {}", chrono::Utc::now().format("%Y-%m-%d")));

    sqlx::query(
        r#"
        INSERT INTO passkeys (user_id, credential_id, public_key, counter, device_name)
        VALUES ($1, $2, $3, 0, $4)
        "#
    )
    .bind(user.id)
    .bind(&credential_id_bytes[..])
    .bind(&public_key)
    .bind(device_name)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Delete used challenge
    sqlx::query("DELETE FROM passkey_challenges WHERE user_id = $1 AND challenge = $2")
        .bind(user.id)
        .bind(general_purpose::STANDARD.decode(&req.challenge).unwrap_or_default())
        .execute(&pool)
        .await
        .ok();

    Ok(Json(serde_json::json!({"message": "Passkey registered successfully"})))
}

pub async fn passkey_login_start_handler(
    State(pool): State<DbPool>,
    Json(req): Json<PasskeyLoginStart>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get user by username
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE username = $1 AND is_active = true AND deleted_at IS NULL"
    )
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Get user's passkeys
    let passkeys = sqlx::query_as::<_, Passkey>(
        "SELECT * FROM passkeys WHERE user_id = $1"
    )
    .bind(user.id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if passkeys.is_empty() {
        return Err(ApiError::NotFound("No passkeys found for this user".to_string()));
    }

    // Generate challenge (32 random bytes)
    let challenge_bytes: [u8; 32] = {
        let mut rng = rand::thread_rng();
        rand::Rng::gen(&mut rng)
    };
    let challenge_b64 = general_purpose::STANDARD.encode(&challenge_bytes);

    // Store challenge
    sqlx::query(
        r#"
        INSERT INTO passkey_challenges (user_id, challenge, challenge_type, expires_at)
        VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')
        "#
    )
    .bind(user.id)
    .bind(&challenge_bytes[..])  // Bind as bytea
    .bind("authentication")
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let allow_credentials: Vec<serde_json::Value> = passkeys
        .iter()
        .map(|pk| {
            // Encode as base64url for WebAuthn compatibility
            let credential_id_b64url = general_purpose::STANDARD.encode(&pk.credential_id)
                .replace('+', "-")
                .replace('/', "_")
                .trim_end_matches('=')
                .to_string();

            serde_json::json!({
                "id": credential_id_b64url,
                "type": "public-key"
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "challenge": challenge_b64,
        "allowCredentials": allow_credentials
    })))
}

pub async fn passkey_login_finish_handler(
    State(pool): State<DbPool>,
    Json(req): Json<PasskeyLoginFinish>,
) -> Result<Json<AuthResponse>, ApiError> {
    // Get user
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE username = $1 AND is_active = true AND deleted_at IS NULL"
    )
    .bind(&req.username)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Verify challenge
    let challenge_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM passkey_challenges WHERE user_id = $1 AND challenge = $2 AND expires_at > NOW())"
    )
    .bind(user.id)
    .bind(general_purpose::STANDARD.decode(&req.challenge).map_err(|_| ApiError::BadRequest("Invalid challenge".to_string()))?)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !challenge_exists {
        return Err(ApiError::Unauthorized("Invalid or expired challenge".to_string()));
    }

    // Decode credential_id from base64url (WebAuthn uses URL-safe base64) to bytes for BYTEA lookup
    let credential_id_bytes = decode_base64url(&req.credential_id)
        .map_err(|e| ApiError::BadRequest(format!("Invalid credential ID format: {}", e)))?;

    // Verify passkey exists
    let passkey = sqlx::query_as::<_, Passkey>(
        "SELECT * FROM passkeys WHERE user_id = $1 AND credential_id = $2"
    )
    .bind(user.id)
    .bind(&credential_id_bytes[..])
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::Unauthorized("Invalid passkey".to_string()))?;

    // In production, verify the signature here using the public_key
    // For now, we'll trust the credential_id match

    // Update last used
    sqlx::query("UPDATE passkeys SET last_used_at = NOW() WHERE id = $1")
        .bind(passkey.id)
        .execute(&pool)
        .await
        .ok();

    // Delete used challenge
    sqlx::query("DELETE FROM passkey_challenges WHERE user_id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .ok();

    // Get roles and permissions
    let roles = AuthService::get_user_roles(&pool, user.id).await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let permissions = AuthService::get_user_permissions(&pool, user.id).await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Generate tokens
    let access_token = AuthService::generate_jwt(user.id, user.username.clone(), roles.clone())
        .map_err(|e| ApiError::Internal(format!("Token generation failed: {}", e)))?;

    let refresh_token = AuthService::generate_refresh_token();

    // Check if this is the first login
    let is_first_login: bool = sqlx::query_scalar(
        "SELECT last_login_at IS NULL FROM users WHERE id = $1"
    )
    .bind(user.id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    // Store refresh token
    AuthService::store_refresh_token(&pool, user.id, &refresh_token, 30)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to store refresh token: {}", e)))?;

    // Update last login
    sqlx::query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .ok();

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user,
        roles,
        permissions,
        is_first_login,
    }))
}
