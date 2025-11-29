use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use chrono::{Duration, Utc};
use bcrypt::{hash, verify, DEFAULT_COST};
use std::env;

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

