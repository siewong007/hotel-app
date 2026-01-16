use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use super::db::{DbPool, array_to_json};
use sqlx::Row;
use chrono::{Duration, Utc};
use bcrypt::{hash, verify, DEFAULT_COST};
use std::env;
use regex::Regex;
use rand::{thread_rng, Rng};
use sha2::{Sha256, Digest};
use hex;
use totp_rs::{TOTP, Algorithm, Secret};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user_id
    pub username: String,
    pub exp: usize,
    pub iat: usize,
    pub roles: Vec<String>,
}

pub struct AuthService;

impl AuthService {
    pub fn generate_jwt(user_id: i64, username: String, roles: Vec<String>) -> Result<String, jsonwebtoken::errors::Error> {
        let secret = env::var("JWT_SECRET").expect("JWT_SECRET must be set");
        let now = Utc::now();
        let exp = (now + Duration::hours(24)).timestamp() as usize;
        let iat = now.timestamp() as usize;

        let claims = Claims {
            sub: user_id.to_string(),
            username,
            exp,
            iat,
            roles,
        };

        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(secret.as_ref()),
        )
    }

    pub fn verify_jwt(token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
        let secret = env::var("JWT_SECRET").expect("JWT_SECRET must be set");
        decode::<Claims>(
            token,
            &DecodingKey::from_secret(secret.as_ref()),
            &Validation::default(),
        )
        .map(|data| data.claims)
    }

    pub async fn hash_password(password: &str) -> Result<String, bcrypt::BcryptError> {
        hash(password, DEFAULT_COST)
    }

    pub async fn verify_password(password: &str, hash: &str) -> Result<bool, bcrypt::BcryptError> {
        verify(password, hash)
    }

    /// Validates password complexity and returns an error message if invalid
    pub fn validate_password(password: &str) -> Result<(), String> {
        // Minimum length check
        if password.len() < 8 {
            return Err("Password must be at least 8 characters long".to_string());
        }

        // Maximum length check (prevent DOS attacks with extremely long passwords)
        if password.len() > 128 {
            return Err("Password must not exceed 128 characters".to_string());
        }

        // Check for at least one uppercase letter
        let has_uppercase = Regex::new(r"[A-Z]").unwrap().is_match(password);
        if !has_uppercase {
            return Err("Password must contain at least one uppercase letter".to_string());
        }

        // Check for at least one lowercase letter
        let has_lowercase = Regex::new(r"[a-z]").unwrap().is_match(password);
        if !has_lowercase {
            return Err("Password must contain at least one lowercase letter".to_string());
        }

        // Check for at least one digit
        let has_digit = Regex::new(r"\d").unwrap().is_match(password);
        if !has_digit {
            return Err("Password must contain at least one number".to_string());
        }

        // Check for at least one special character
        let has_special = Regex::new(r#"[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\';/~`]"#).unwrap().is_match(password);
        if !has_special {
            return Err("Password must contain at least one special character".to_string());
        }

        // Check for common weak passwords
        let weak_passwords = vec![
            "password", "password123", "12345678", "qwerty123", "abc123456",
            "password1", "welcome123", "admin123", "letmein123", "monkey123"
        ];

        let lowercase_pwd = password.to_lowercase();
        for weak in weak_passwords {
            if lowercase_pwd.contains(weak) {
                return Err("Password is too common or weak".to_string());
            }
        }

        Ok(())
    }

    /// Generates a cryptographically secure refresh token
    pub fn generate_refresh_token() -> String {
        let mut rng = thread_rng();
        let token_bytes: [u8; 32] = rng.gen();
        hex::encode(token_bytes)
    }

    /// Hashes a refresh token for secure storage
    pub fn hash_refresh_token(token: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(token.as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Stores a refresh token in the database
    pub async fn store_refresh_token(
        pool: &DbPool,
        user_id: i64,
        token: &str,
        expires_in_days: i64,
    ) -> Result<(), sqlx::Error> {
        let token_hash = Self::hash_refresh_token(token);
        let expires_at = Utc::now() + Duration::days(expires_in_days);

        sqlx::query(
            r#"
            INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
            VALUES ($1, $2, $3)
            "#
        )
        .bind(user_id)
        .bind(token_hash)
        .bind(expires_at)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Validates a refresh token and returns the user_id if valid
    pub async fn validate_refresh_token(
        pool: &DbPool,
        token: &str,
    ) -> Result<Option<i64>, sqlx::Error> {
        let token_hash = Self::hash_refresh_token(token);

        let result = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT user_id
            FROM refresh_tokens
            WHERE token_hash = $1
              AND expires_at > NOW()
              AND revoked_at IS NULL
            "#
        )
        .bind(token_hash)
        .fetch_optional(pool)
        .await?;

        Ok(result)
    }

    /// Revokes a refresh token
    pub async fn revoke_refresh_token(
        pool: &DbPool,
        token: &str,
    ) -> Result<(), sqlx::Error> {
        let token_hash = Self::hash_refresh_token(token);

        sqlx::query(
            r#"
            UPDATE refresh_tokens
            SET revoked_at = NOW()
            WHERE token_hash = $1
            "#
        )
        .bind(token_hash)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Revokes all refresh tokens for a user
    pub async fn revoke_all_user_tokens(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE refresh_tokens
            SET revoked_at = NOW()
            WHERE user_id = $1 AND revoked_at IS NULL
            "#
        )
        .bind(user_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn get_user_permissions(pool: &DbPool, user_id: i64) -> Result<Vec<String>, sqlx::Error> {
        let permissions = sqlx::query_scalar::<_, String>(
            r#"
            SELECT DISTINCT p.name
            FROM permissions p
            INNER JOIN role_permissions rp ON p.id = rp.permission_id
            INNER JOIN user_roles ur ON rp.role_id = ur.role_id
            WHERE ur.user_id = $1
            "#
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Ok(permissions)
    }

    pub async fn get_user_roles(pool: &DbPool, user_id: i64) -> Result<Vec<String>, sqlx::Error> {
        let roles = sqlx::query_scalar::<_, String>(
            r#"
            SELECT r.name
            FROM roles r
            INNER JOIN user_roles ur ON r.id = ur.role_id
            WHERE ur.user_id = $1
            "#
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Ok(roles)
    }

    pub async fn check_permission(pool: &DbPool, user_id: i64, permission: &str) -> Result<bool, sqlx::Error> {
        let has_permission = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM permissions p
                INNER JOIN role_permissions rp ON p.id = rp.permission_id
                INNER JOIN user_roles ur ON rp.role_id = ur.role_id
                WHERE ur.user_id = $1 AND p.name = $2
            )
            "#
        )
        .bind(user_id)
        .bind(permission)
        .fetch_one(pool)
        .await?;

        Ok(has_permission)
    }

    pub async fn check_role(pool: &DbPool, user_id: i64, role_name: &str) -> Result<bool, sqlx::Error> {
        let has_role = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM roles r
                INNER JOIN user_roles ur ON r.id = ur.role_id
                WHERE ur.user_id = $1 AND r.name = $2
            )
            "#
        )
        .bind(user_id)
        .bind(role_name)
        .fetch_one(pool)
        .await?;

        Ok(has_role)
    }

    /// Generate a secure email verification token
    pub fn generate_email_verification_token() -> String {
        let mut rng = thread_rng();
        let token_bytes: [u8; 32] = rng.gen();
        hex::encode(token_bytes)
    }

    /// Update user with email verification token
    pub async fn create_email_verification_token(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<String, sqlx::Error> {
        let token = Self::generate_email_verification_token();
        let expires_at = Utc::now() + Duration::hours(24); // 24 hour expiry

        sqlx::query(
            r#"
            UPDATE users
            SET email_verification_token = $1,
                email_token_expires_at = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            "#
        )
        .bind(&token)
        .bind(expires_at)
        .bind(user_id)
        .execute(pool)
        .await?;

        Ok(token)
    }

    /// Verify email token and mark user as verified
    pub async fn verify_email_token(
        pool: &DbPool,
        token: &str,
    ) -> Result<Option<i64>, sqlx::Error> {
        let result = sqlx::query_scalar::<_, i64>(
            r#"
            UPDATE users
            SET is_verified = true,
                email_verification_token = NULL,
                email_token_expires_at = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE email_verification_token = $1
              AND email_token_expires_at > CURRENT_TIMESTAMP
              AND is_verified = false
            RETURNING id
            "#
        )
        .bind(token)
        .fetch_optional(pool)
        .await?;

        Ok(result)
    }

    /// Get user by email for verification
    pub async fn get_user_by_email(
        pool: &DbPool,
        email: &str,
    ) -> Result<Option<crate::models::User>, sqlx::Error> {
        let user = sqlx::query_as::<_, crate::models::User>(
            r#"
            SELECT id, username, email, full_name, is_active, is_verified,
                   email_verification_token, email_token_expires_at,
                   two_factor_enabled, two_factor_secret, two_factor_recovery_codes,
                   created_at, updated_at
            FROM users
            WHERE email = $1 AND deleted_at IS NULL
            "#
        )
        .bind(email)
        .fetch_optional(pool)
        .await?;

        Ok(user)
    }

    // ============================================================================
    // TWO-FACTOR AUTHENTICATION METHODS
    // ============================================================================

    /// Generate a new TOTP secret and QR code URL for Google Authenticator setup
    pub fn generate_totp_secret(username: &str) -> Result<(String, String), Box<dyn std::error::Error>> {
        // Generate random secret bytes (20 bytes = 160 bits for SHA1)
        let mut rng = thread_rng();
        let secret_bytes: Vec<u8> = (0..20).map(|_| rng.gen::<u8>()).collect();

        let secret = Secret::Raw(secret_bytes.clone());
        let secret_base32 = secret.to_encoded().to_string();

        let totp = TOTP::new(
            Algorithm::SHA1,
            6, // 6 digits
            1, // 1 step (30 second window)
            30, // 30 second period
            secret_bytes,
            Some("Hotel Management System".to_string()),
            username.to_string(),
        )?;

        let qr_code_url = totp.get_url();

        Ok((secret_base32, qr_code_url))
    }

    /// Generate backup recovery codes (10 codes, each 8 characters)
    pub fn generate_backup_codes() -> Vec<String> {
        let mut codes = Vec::new();
        let mut rng = thread_rng();

        for _ in 0..10 {
            let code_bytes: [u8; 4] = rng.gen();
            let code = hex::encode(&code_bytes[..4]).to_uppercase();
            // Format as XXXX-XXXX
            let formatted = format!("{}-{}", &code[..4], &code[4..]);
            codes.push(formatted);
        }

        codes
    }

    /// Verify a TOTP code against the secret
    pub fn verify_totp_code(secret: &str, code: &str) -> Result<bool, Box<dyn std::error::Error>> {
        let secret_bytes = Secret::Encoded(secret.to_string()).to_bytes()?;
        let totp = TOTP::new(
            Algorithm::SHA1,
            6,
            1,
            30,
            secret_bytes,
            None,
            "".to_string(),
        )?;

        // Allow for clock skew - check previous, current, and next time windows
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();

        // Check current window
        if totp.check_current(code)? {
            return Ok(true);
        }

        // Check previous window (30 seconds ago)
        if totp.check(code, current_time - 30) {
            return Ok(true);
        }

        // Check next window (30 seconds ahead)
        if totp.check(code, current_time + 30) {
            return Ok(true);
        }

        Ok(false)
    }

    /// Check if a recovery code matches any of the user's backup codes
    pub fn check_recovery_code(provided_code: &str, stored_codes: &[String]) -> Option<usize> {
        for (index, stored_code) in stored_codes.iter().enumerate() {
            if provided_code == stored_code {
                return Some(index);
            }
        }
        None
    }

    /// Create a temporary 2FA challenge for user operations
    pub async fn create_2fa_challenge(
        pool: &DbPool,
        user_id: i64,
        purpose: &str,
    ) -> Result<String, sqlx::Error> {
        let challenge_code = Self::generate_refresh_token(); // Reuse for 2FA challenge
        let expires_at = Utc::now() + Duration::minutes(10);

        sqlx::query(
            r#"
            INSERT INTO two_factor_challenges (user_id, challenge_code, purpose, expires_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, purpose) DO UPDATE SET
                challenge_code = EXCLUDED.challenge_code,
                expires_at = EXCLUDED.expires_at,
                created_at = CURRENT_TIMESTAMP
            "#
        )
        .bind(user_id)
        .bind(&challenge_code)
        .bind(purpose)
        .bind(expires_at)
        .execute(pool)
        .await?;

        Ok(challenge_code)
    }

    /// Enable 2FA for a user
    pub async fn enable_2fa(
        pool: &DbPool,
        user_id: i64,
        secret: &str,
        recovery_codes: &[String],
    ) -> Result<(), sqlx::Error> {
        // Convert recovery codes to JSON string for SQLite compatibility
        let codes_json = array_to_json(recovery_codes);

        sqlx::query(
            r#"
            UPDATE users
            SET two_factor_enabled = true,
                two_factor_secret = $2,
                two_factor_recovery_codes = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            "#
        )
        .bind(user_id)
        .bind(secret)
        .bind(&codes_json)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Disable 2FA for a user
    pub async fn disable_2fa(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE users
            SET two_factor_enabled = false,
                two_factor_secret = NULL,
                two_factor_recovery_codes = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            "#
        )
        .bind(user_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Update recovery codes for a user (e.g., after using one)
    pub async fn update_recovery_codes(
        pool: &DbPool,
        user_id: i64,
        recovery_codes: &[String],
    ) -> Result<(), sqlx::Error> {
        // Convert recovery codes to JSON string for SQLite compatibility
        let codes_json = array_to_json(recovery_codes);

        sqlx::query(
            r#"
            UPDATE users
            SET two_factor_recovery_codes = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            "#
        )
        .bind(user_id)
        .bind(&codes_json)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Get user 2FA status
    pub async fn get_user_2fa_status(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<(bool, i32), sqlx::Error> {
        let result = sqlx::query(
            r#"
            SELECT two_factor_enabled, array_length(two_factor_recovery_codes, 1) as recovery_count
            FROM users
            WHERE id = $1
            "#
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        match result {
            Some(row) => {
                let enabled: bool = row.try_get("two_factor_enabled")?;
                let count: Option<i32> = row.try_get("recovery_count").unwrap_or(None);
                Ok((enabled, count.unwrap_or(0)))
            }
            None => Ok((false, 0)),
        }
    }
}
