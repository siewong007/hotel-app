use super::config;
use super::db::DbPool;
use bcrypt::{DEFAULT_COST, hash, verify};
use chrono::{Duration, Utc};
use hex;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use rand::Rng;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Row};
use std::sync::OnceLock;
use totp_rs::{Algorithm, Secret, TOTP};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user_id
    pub username: String,
    pub iss: String,
    pub aud: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exp: Option<usize>,
    pub iat: usize,
    pub roles: Vec<String>,
    /// Stable refresh-session identifier. Tokens minted before session management
    /// deliberately omit it and remain valid until their normal expiry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sid: Option<String>,
}

pub struct AuthService;

#[derive(Debug, FromRow)]
pub struct ActiveSessionRecord {
    pub id: String,
    pub user_agent: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: chrono::DateTime<Utc>,
    pub last_used_at: Option<chrono::DateTime<Utc>>,
    pub expires_at: chrono::DateTime<Utc>,
}

const ACCESS_TOKEN_TTL_MINUTES: i64 = 30;
static JWT_SECRET: OnceLock<String> = OnceLock::new();

fn jwt_secret() -> &'static str {
    JWT_SECRET
        .get_or_init(|| {
            let secret = config::get().jwt_secret.clone();
            config::validate_jwt_secret(&secret).expect("JWT_SECRET must meet minimum length");
            secret
        })
        .as_str()
}

fn is_desktop_mode() -> bool {
    config::try_get()
        .map(|config| config.desktop_mode)
        .unwrap_or_else(|| std::env::var_os("HOTEL_DESKTOP_MODE").is_some())
}

fn access_token_expiration(now: chrono::DateTime<Utc>, desktop_mode: bool) -> Option<usize> {
    if desktop_mode {
        None
    } else {
        Some((now + Duration::minutes(ACCESS_TOKEN_TTL_MINUTES)).timestamp() as usize)
    }
}

fn jwt_validation(desktop_mode: bool) -> Validation {
    let mut validation = Validation::default();
    let config = config::try_get();
    let issuer = config
        .map(|config| config.jwt_issuer.as_str())
        .unwrap_or("hotel-app-be");
    let audience = config
        .map(|config| config.jwt_audience.as_str())
        .unwrap_or("hotel-web");
    validation.set_issuer(&[issuer]);
    validation.set_audience(&[audience]);
    if desktop_mode {
        validation.validate_exp = false;
        validation.required_spec_claims.remove("exp");
    }
    validation
}

fn uppercase_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"[A-Z]").expect("uppercase regex must compile"))
}

fn lowercase_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"[a-z]").expect("lowercase regex must compile"))
}

fn digit_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\d").expect("digit regex must compile"))
}

fn special_character_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\';/~`]"#)
            .expect("special character regex must compile")
    })
}

const WEAK_PASSWORDS: &[&str] = &[
    "password",
    "password123",
    "12345678",
    "qwerty123",
    "abc123456",
    "password1",
    "welcome123",
    "admin123",
    "letmein123",
    "monkey123",
];

impl AuthService {
    pub fn init_jwt_secret(secret: &str) -> Result<(), String> {
        config::validate_jwt_secret(secret)?;

        let _ = JWT_SECRET.set(secret.to_string());
        Ok(())
    }

    /// Generates an access token bound to one persisted refresh session.
    pub fn generate_session_jwt(
        user_id: i64,
        username: String,
        roles: Vec<String>,
        session_id: String,
    ) -> Result<String, jsonwebtoken::errors::Error> {
        let now = Utc::now();
        let exp = access_token_expiration(now, is_desktop_mode());
        let claims = Claims {
            sub: user_id.to_string(),
            username,
            iss: config::try_get()
                .map(|config| config.jwt_issuer.clone())
                .unwrap_or_else(|| "hotel-app-be".to_string()),
            aud: config::try_get()
                .map(|config| config.jwt_audience.clone())
                .unwrap_or_else(|| "hotel-web".to_string()),
            exp,
            iat: now.timestamp() as usize,
            roles,
            sid: Some(session_id),
        };

        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(jwt_secret().as_ref()),
        )
    }

    pub fn verify_jwt(token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
        decode::<Claims>(
            token,
            &DecodingKey::from_secret(jwt_secret().as_ref()),
            &jwt_validation(is_desktop_mode()),
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
        let has_uppercase = uppercase_regex().is_match(password);
        if !has_uppercase {
            return Err("Password must contain at least one uppercase letter".to_string());
        }

        // Check for at least one lowercase letter
        let has_lowercase = lowercase_regex().is_match(password);
        if !has_lowercase {
            return Err("Password must contain at least one lowercase letter".to_string());
        }

        // Check for at least one digit
        let has_digit = digit_regex().is_match(password);
        if !has_digit {
            return Err("Password must contain at least one number".to_string());
        }

        // Check for at least one special character
        let has_special = special_character_regex().is_match(password);
        if !has_special {
            return Err("Password must contain at least one special character".to_string());
        }

        // Check for common weak passwords
        let lowercase_pwd = password.to_lowercase();
        for weak in WEAK_PASSWORDS {
            if lowercase_pwd.contains(weak) {
                return Err("Password is too common or weak".to_string());
            }
        }

        Ok(())
    }

    /// Generates a cryptographically secure refresh token
    pub fn generate_refresh_token() -> String {
        let mut rng = rand::rng();
        let token_bytes: [u8; 32] = rng.random();
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
        ip_address: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<String, sqlx::Error> {
        let session_id = crate::core::db::generate_uuid();
        let token_hash = Self::hash_refresh_token(token);
        let expires_at = Utc::now() + Duration::days(expires_in_days);

        let query = r#"
                INSERT INTO refresh_tokens (id, user_id, token_hash, ip_address, user_agent, expires_at)
                VALUES ($1::uuid, $2, $3, $4::inet, $5, $6)
            "#;
        sqlx::query(query)
            .bind(&session_id)
            .bind(user_id)
            .bind(token_hash)
            .bind(ip_address)
            .bind(user_agent)
            .bind(expires_at)
            .execute(pool)
            .await?;

        Ok(session_id)
    }

    /// Validates a refresh token and returns the user_id if valid
    pub async fn validate_refresh_token(
        pool: &DbPool,
        token: &str,
    ) -> Result<Option<(i64, String)>, sqlx::Error> {
        let token_hash = Self::hash_refresh_token(token);

        let query = r#"
                SELECT user_id, id::text AS session_id
                FROM refresh_tokens
                WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP
                  AND revoked_at IS NULL AND is_revoked = false
            "#;
        let result = sqlx::query(query)
            .bind(token_hash)
            .fetch_optional(pool)
            .await?;

        Ok(result.map(|row| {
            (
                sqlx::Row::try_get::<i64, _>(&row, "user_id").unwrap_or_default(),
                sqlx::Row::try_get::<String, _>(&row, "session_id").unwrap_or_default(),
            )
        }))
    }

    /// Atomically replaces a refresh token while preserving the session row and
    /// its stable identifier. A replayed token cannot win this update twice.
    pub async fn rotate_refresh_token(
        pool: &DbPool,
        session_id: &str,
        previous_token: &str,
        next_token: &str,
        expires_in_days: i64,
    ) -> Result<bool, sqlx::Error> {
        let previous_hash = Self::hash_refresh_token(previous_token);
        let next_hash = Self::hash_refresh_token(next_token);
        let expires_at = Utc::now() + Duration::days(expires_in_days);
        let query = r#"
                UPDATE refresh_tokens
                SET token_hash = $1, expires_at = $2, last_used_at = CURRENT_TIMESTAMP
                WHERE id = $3::uuid AND token_hash = $4 AND revoked_at IS NULL AND is_revoked = false
            "#;
        Ok(sqlx::query(query)
            .bind(next_hash)
            .bind(expires_at)
            .bind(session_id)
            .bind(previous_hash)
            .execute(pool)
            .await?
            .rows_affected()
            == 1)
    }

    /// Revokes a refresh token
    pub async fn revoke_refresh_token(pool: &DbPool, token: &str) -> Result<(), sqlx::Error> {
        let token_hash = Self::hash_refresh_token(token);

        sqlx::query(
            r#"
            UPDATE refresh_tokens
            SET is_revoked = true, revoked_at = CURRENT_TIMESTAMP
            WHERE token_hash = $1
            "#,
        )
        .bind(token_hash)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Revokes all refresh tokens for a user
    pub async fn revoke_all_user_tokens(pool: &DbPool, user_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE refresh_tokens
            SET is_revoked = true, revoked_at = CURRENT_TIMESTAMP
            WHERE user_id = $1 AND revoked_at IS NULL
            "#,
        )
        .bind(user_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn list_active_sessions(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<Vec<ActiveSessionRecord>, sqlx::Error> {
        let query = r#"
                SELECT id::text AS id, user_agent, host(ip_address) AS ip_address,
                       created_at, last_used_at, expires_at
                FROM refresh_tokens
                WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP
                  AND revoked_at IS NULL AND is_revoked = false
                ORDER BY last_used_at DESC NULLS LAST, created_at DESC
            "#;
        sqlx::query_as(query).bind(user_id).fetch_all(pool).await
    }

    pub async fn revoke_user_session(
        pool: &DbPool,
        user_id: i64,
        session_id: &str,
    ) -> Result<bool, sqlx::Error> {
        let query = r#"
                UPDATE refresh_tokens
                SET is_revoked = true, revoked_at = CURRENT_TIMESTAMP, revoked_by = $1
                WHERE id = $2::uuid AND user_id = $1 AND revoked_at IS NULL AND is_revoked = false
            "#;
        Ok(sqlx::query(query)
            .bind(user_id)
            .bind(session_id)
            .execute(pool)
            .await?
            .rows_affected()
            == 1)
    }

    pub async fn is_session_active(
        pool: &DbPool,
        user_id: i64,
        session_id: &str,
    ) -> Result<bool, sqlx::Error> {
        let query = r#"
                SELECT EXISTS(
                    SELECT 1
                    FROM refresh_tokens AS session
                    INNER JOIN users AS account ON account.id = session.user_id
                    WHERE session.id = $1::uuid AND session.user_id = $2
                      AND session.expires_at > CURRENT_TIMESTAMP
                      AND session.revoked_at IS NULL AND session.is_revoked = false
                      AND account.is_active = true
                      AND account.is_locked = false
                      AND account.deleted_at IS NULL
                )
            "#;
        sqlx::query_scalar(query)
            .bind(session_id)
            .bind(user_id)
            .fetch_one(pool)
            .await
    }

    pub async fn get_user_permissions(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<Vec<String>, sqlx::Error> {
        // Same definition of "effective" as the RBAC cache — direct roles
        // UNION team-conferred roles, both filtered on expiry. Sharing the
        // constants keeps the two from drifting apart, which would show up as
        // a permission check that answers differently depending on which
        // resolver ran.
        let permissions = sqlx::query_scalar::<_, String>(&format!(
            "{}{}",
            crate::core::rbac_cache::EFFECTIVE_ROLES_CTE,
            crate::core::rbac_cache::EFFECTIVE_PERMISSIONS_SQL
        ))
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Ok(permissions)
    }

    pub async fn get_user_roles(pool: &DbPool, user_id: i64) -> Result<Vec<String>, sqlx::Error> {
        let roles = sqlx::query_scalar::<_, String>(&format!(
            "{}{}",
            crate::core::rbac_cache::EFFECTIVE_ROLES_CTE,
            crate::core::rbac_cache::EFFECTIVE_ROLE_NAMES_SQL
        ))
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Ok(roles)
    }

    /// Check whether a user holds a permission (or the implied
    /// `<resource>:manage`). Backed by [`crate::core::rbac_cache`] so the common
    /// case answers from an in-process cache instead of a per-request join.
    pub async fn check_permission(
        pool: &DbPool,
        user_id: i64,
        permission: &str,
    ) -> Result<bool, sqlx::Error> {
        super::rbac_cache::has_permission(pool, user_id, permission).await
    }

    /// Check whether a user holds a role. Backed by the same RBAC cache.
    pub async fn check_role(
        pool: &DbPool,
        user_id: i64,
        role_name: &str,
    ) -> Result<bool, sqlx::Error> {
        super::rbac_cache::has_role(pool, user_id, role_name).await
    }

    /// Generate a secure email verification token
    pub fn generate_email_verification_token() -> String {
        let mut rng = rand::rng();
        let token_bytes: [u8; 32] = rng.random();
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
            "#,
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
            "#,
        )
        .bind(token)
        .fetch_optional(pool)
        .await?;

        Ok(result)
    }

    // ============================================================================
    // TWO-FACTOR AUTHENTICATION METHODS
    // ============================================================================

    /// Generate a new TOTP secret and QR code URL for Google Authenticator setup
    pub fn generate_totp_secret(
        username: &str,
        issuer_name: &str,
    ) -> Result<(String, String), Box<dyn std::error::Error>> {
        // Generate random secret bytes (20 bytes = 160 bits for SHA1)
        let mut rng = rand::rng();
        let secret_bytes: Vec<u8> = (0..20).map(|_| rng.random::<u8>()).collect();

        let secret = Secret::Raw(secret_bytes.clone());
        let secret_base32 = secret.to_encoded().to_string();

        let totp = TOTP::new(
            Algorithm::SHA1,
            6,  // 6 digits
            1,  // 1 step (30 second window)
            30, // 30 second period
            secret_bytes,
            Some(issuer_name.to_string()),
            username.to_string(),
        )?;

        let qr_code_url = totp.get_url();

        Ok((secret_base32, qr_code_url))
    }

    /// Generate backup recovery codes (10 codes, each 10 random bytes)
    pub fn generate_backup_codes() -> Vec<String> {
        let mut codes = Vec::new();
        let mut rng = rand::rng();

        for _ in 0..10 {
            let code_bytes: [u8; 10] = rng.random();
            let code = hex::encode(code_bytes).to_uppercase();
            let formatted = code
                .as_bytes()
                .chunks(5)
                .map(|chunk| std::str::from_utf8(chunk).expect("hex code must be valid UTF-8"))
                .collect::<Vec<_>>()
                .join("-");
            codes.push(formatted);
        }

        codes
    }

    pub fn hash_recovery_code(code: &str) -> String {
        Self::hash_refresh_token(&code.trim().to_uppercase())
    }

    #[cfg(test)]
    fn hash_recovery_codes(codes: &[String]) -> Vec<String> {
        codes
            .iter()
            .map(|code| Self::hash_recovery_code(code))
            .collect()
    }

    fn is_recovery_code_hash(code: &str) -> bool {
        code.len() == 64 && code.chars().all(|c| c.is_ascii_hexdigit())
    }

    fn recovery_codes_for_storage(codes: &[String]) -> Vec<String> {
        codes
            .iter()
            .map(|code| {
                let trimmed = code.trim();
                if Self::is_recovery_code_hash(trimmed) {
                    trimmed.to_ascii_lowercase()
                } else {
                    Self::hash_recovery_code(trimmed)
                }
            })
            .collect()
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
        let provided_hash = Self::hash_recovery_code(provided_code);
        let provided_normalized = provided_code.trim().to_uppercase();
        for (index, stored_code) in stored_codes.iter().enumerate() {
            let stored_trimmed = stored_code.trim();
            let matches = if Self::is_recovery_code_hash(stored_trimmed) {
                constant_time_eq::constant_time_eq(
                    provided_hash.as_bytes(),
                    stored_trimmed.to_ascii_lowercase().as_bytes(),
                )
            } else {
                constant_time_eq::constant_time_eq(
                    provided_normalized.as_bytes(),
                    stored_trimmed.to_uppercase().as_bytes(),
                )
            };

            if matches {
                return Some(index);
            }
        }
        None
    }

    /// Create a temporary 2FA challenge for user operations.
    /// The plaintext code is returned to the caller (and ultimately the client);
    /// only its SHA-256 hash is stored, like refresh tokens.
    pub async fn create_2fa_challenge(
        pool: &DbPool,
        user_id: i64,
        purpose: &str,
    ) -> Result<String, sqlx::Error> {
        let challenge_code = Self::generate_refresh_token(); // Reuse for 2FA challenge
        let challenge_hash = Self::hash_refresh_token(&challenge_code);
        let expires_at = Utc::now() + Duration::minutes(10);

        sqlx::query(
            r#"
            INSERT INTO two_factor_challenges (user_id, challenge_code, purpose, expires_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, purpose) DO UPDATE SET
                challenge_code = EXCLUDED.challenge_code,
                expires_at = EXCLUDED.expires_at,
                created_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(user_id)
        .bind(&challenge_hash)
        .bind(purpose)
        .bind(expires_at)
        .execute(pool)
        .await?;

        Ok(challenge_code)
    }

    /// Atomically consume a pending 2FA challenge: the row is deleted only when
    /// the hashed code matches and it has not expired, so a successful challenge
    /// is single-use. Returns whether a matching, unexpired challenge existed.
    /// A mismatch or an expired row leaves the table untouched — a typo must not
    /// burn the challenge, and callers treat `false` as "restart setup".
    pub async fn consume_2fa_challenge(
        pool: &DbPool,
        user_id: i64,
        purpose: &str,
        challenge_code: &str,
    ) -> Result<bool, sqlx::Error> {
        let challenge_hash = Self::hash_refresh_token(challenge_code);

        let result = sqlx::query(
            r#"
            DELETE FROM two_factor_challenges
            WHERE user_id = $1
              AND purpose = $2
              AND challenge_code = $3
              AND expires_at > CURRENT_TIMESTAMP
            "#,
        )
        .bind(user_id)
        .bind(purpose)
        .bind(&challenge_hash)
        .execute(pool)
        .await?;

        Ok(result.rows_affected() == 1)
    }

    /// Enable 2FA for a user
    pub async fn enable_2fa(
        pool: &DbPool,
        user_id: i64,
        secret: &str,
        recovery_codes: &[String],
    ) -> Result<(), sqlx::Error> {
        let recovery_code_hashes = Self::recovery_codes_for_storage(recovery_codes);

        sqlx::query(
            r#"
            UPDATE users
            SET two_factor_enabled = true,
                two_factor_secret = $2,
                two_factor_recovery_codes = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            "#,
        )
        .bind(user_id)
        .bind(secret)
        .bind(&recovery_code_hashes)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Disable 2FA for a user
    pub async fn disable_2fa(pool: &DbPool, user_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE users
            SET two_factor_enabled = false,
                two_factor_secret = NULL,
                two_factor_recovery_codes = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            "#,
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
        let recovery_code_hashes = Self::recovery_codes_for_storage(recovery_codes);

        sqlx::query(
            r#"
            UPDATE users
            SET two_factor_recovery_codes = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            "#,
        )
        .bind(user_id)
        .bind(&recovery_code_hashes)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Atomically consume one stored recovery-code entry (pass the entry
    /// exactly as stored -- hash or legacy plaintext). The guarded
    /// `array_remove` spends the code only if it is still present, so two
    /// concurrent logins can never both accept the same code, and a
    /// concurrent regeneration (full-array rewrite) is never clobbered.
    /// Returns the remaining count, or `None` if the entry was already gone.
    pub async fn consume_recovery_code(
        pool: &DbPool,
        user_id: i64,
        stored_entry: &str,
    ) -> Result<Option<usize>, sqlx::Error> {
        let row: Option<(Option<i32>,)> = sqlx::query_as(
            r#"
            UPDATE users
            SET two_factor_recovery_codes = array_remove(two_factor_recovery_codes, $2),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND $2 = ANY(two_factor_recovery_codes)
            RETURNING array_length(two_factor_recovery_codes, 1)
            "#,
        )
        .bind(user_id)
        .bind(stored_entry)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|(remaining,)| remaining.unwrap_or(0).max(0) as usize))
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
            "#,
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

#[cfg(test)]
mod tests {
    use super::{ACCESS_TOKEN_TTL_MINUTES, AuthService, access_token_expiration, jwt_validation};
    use crate::core::config::validate_jwt_secret;

    #[test]
    fn validate_password_accepts_strong_password() {
        assert!(AuthService::validate_password("S3cure_Rooms!").is_ok());
    }

    #[test]
    fn validate_password_rejects_each_complexity_gap() {
        let cases = [
            ("Short1!", "at least 8 characters"),
            ("lowercase1!", "uppercase"),
            ("UPPERCASE1!", "lowercase"),
            ("NoDigits!", "number"),
            ("NoSpecial1", "special character"),
            ("Password123!", "too common"),
        ];

        for (password, expected_message) in cases {
            let error = AuthService::validate_password(password)
                .expect_err("weak password should be rejected");

            assert!(
                error.contains(expected_message),
                "expected '{error}' to contain '{expected_message}'"
            );
        }
    }

    #[test]
    fn validate_password_rejects_excessively_long_passwords() {
        let password = format!("A1!{}", "a".repeat(126));
        let error = AuthService::validate_password(&password)
            .expect_err("password longer than 128 chars should be rejected");

        assert!(error.contains("must not exceed 128 characters"));
    }

    #[test]
    fn jwt_secret_validation_enforces_minimum_length() {
        let short_secret = "too-short";
        let valid_secret = "x".repeat(32);

        assert!(validate_jwt_secret(short_secret).is_err());
        assert!(validate_jwt_secret(&valid_secret).is_ok());
    }

    #[test]
    fn access_tokens_expire_only_outside_desktop_mode() {
        let now = chrono::DateTime::from_timestamp(1_700_000_000, 0).unwrap();

        assert_eq!(access_token_expiration(now, true), None);
        assert_eq!(
            access_token_expiration(now, false),
            Some((now + chrono::Duration::minutes(ACCESS_TOKEN_TTL_MINUTES)).timestamp() as usize)
        );
    }

    #[test]
    fn jwt_validation_does_not_require_exp_in_desktop_mode() {
        let desktop_validation = jwt_validation(true);
        assert!(!desktop_validation.validate_exp);
        assert!(!desktop_validation.required_spec_claims.contains("exp"));

        let server_validation = jwt_validation(false);
        assert!(server_validation.validate_exp);
        assert!(server_validation.required_spec_claims.contains("exp"));
    }

    #[test]
    fn refresh_tokens_are_hex_encoded_and_hashed_deterministically() {
        let token = AuthService::generate_refresh_token();

        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            AuthService::hash_refresh_token(&token),
            AuthService::hash_refresh_token(&token)
        );
        assert_ne!(AuthService::hash_refresh_token(&token), token);
    }

    #[test]
    fn email_verification_tokens_are_hex_encoded() {
        let token = AuthService::generate_email_verification_token();

        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn backup_codes_have_expected_count_format_and_uniqueness() {
        let codes = AuthService::generate_backup_codes();
        let unique: std::collections::HashSet<_> = codes.iter().collect();

        assert_eq!(codes.len(), 10);
        assert_eq!(unique.len(), codes.len());
        assert!(codes.iter().all(|code| {
            code.len() == 23
                && code.as_bytes()[5] == b'-'
                && code.as_bytes()[11] == b'-'
                && code.as_bytes()[17] == b'-'
                && code
                    .chars()
                    .filter(|c| *c != '-')
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_lowercase())
        }));
    }

    #[test]
    fn recovery_code_lookup_returns_matching_index_only() {
        let codes = vec![
            "AAAAA-11111-BBBBB-22222".to_string(),
            "CCCCC-33333-DDDDD-44444".to_string(),
            "EEEEE-55555-FFFFF-66666".to_string(),
        ];
        let stored_codes = AuthService::hash_recovery_codes(&codes);

        assert!(
            stored_codes.iter().all(|stored| {
                stored.len() == 64 && stored.chars().all(|c| c.is_ascii_hexdigit())
            })
        );
        assert_ne!(stored_codes[1], codes[1]);

        assert_eq!(
            AuthService::check_recovery_code("CCCCC-33333-DDDDD-44444", &stored_codes),
            Some(1)
        );
        assert_eq!(
            AuthService::check_recovery_code("ccccc-33333-ddddd-44444", &stored_codes),
            Some(1)
        );
        assert_eq!(
            AuthService::check_recovery_code("GGGGG-77777-HHHHH-88888", &stored_codes),
            None
        );
        assert_eq!(
            AuthService::check_recovery_code("aaaaa-11111-bbbbb-22222", &codes),
            Some(0)
        );
    }
}
