use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use chrono::{Duration, Utc, DateTime};
use bcrypt::{hash, verify, DEFAULT_COST};
use std::env;
use regex::Regex;
use rand::{thread_rng, Rng};
use sha2::{Sha256, Digest};
use hex;

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
        pool: &PgPool,
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
        pool: &PgPool,
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
        pool: &PgPool,
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
        pool: &PgPool,
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

    pub async fn get_user_permissions(pool: &PgPool, user_id: i64) -> Result<Vec<String>, sqlx::Error> {
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

    pub async fn get_user_roles(pool: &PgPool, user_id: i64) -> Result<Vec<String>, sqlx::Error> {
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

    pub async fn check_permission(pool: &PgPool, user_id: i64, permission: &str) -> Result<bool, sqlx::Error> {
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

    pub async fn check_role(pool: &PgPool, user_id: i64, role_name: &str) -> Result<bool, sqlx::Error> {
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
}

