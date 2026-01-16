//! User repository for database operations

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{User, UserProfile};

pub struct UserRepository;

impl UserRepository {
    /// Find a user by ID
    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(
            r#"
            SELECT id, username, email, full_name, phone, is_active, is_verified, user_type,
                   two_factor_enabled, two_factor_secret, two_factor_recovery_codes,
                   created_at, updated_at
            FROM users
            WHERE id = $1 AND deleted_at IS NULL
            "#
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find a user by username or email
    pub async fn find_by_username_or_email(pool: &DbPool, identifier: &str) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(
            r#"
            SELECT id, username, email, full_name, phone, is_active, is_verified, user_type,
                   two_factor_enabled, two_factor_secret, two_factor_recovery_codes,
                   created_at, updated_at
            FROM users
            WHERE (username = $1 OR email = $1) AND deleted_at IS NULL
            "#
        )
        .bind(identifier)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get user profile
    pub async fn get_profile(pool: &DbPool, user_id: i64) -> Result<Option<UserProfile>, ApiError> {
        sqlx::query_as::<_, UserProfile>(
            r#"
            SELECT id, username, email, full_name, phone, avatar_url,
                   created_at, updated_at, last_login_at
            FROM users
            WHERE id = $1 AND deleted_at IS NULL
            "#
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get password hash for a user
    pub async fn get_password_hash(pool: &DbPool, user_id: i64) -> Result<String, ApiError> {
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Update last login timestamp
    pub async fn update_last_login(pool: &DbPool, user_id: i64) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        Ok(())
    }

    /// Check if user is super admin
    pub async fn is_super_admin(pool: &DbPool, user_id: i64) -> Result<bool, ApiError> {
        sqlx::query_scalar("SELECT COALESCE(is_super_admin, false) FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get user roles
    pub async fn get_roles(pool: &DbPool, user_id: i64) -> Result<Vec<String>, ApiError> {
        let roles: Vec<(String,)> = sqlx::query_as(
            r#"
            SELECT r.name
            FROM roles r
            JOIN user_roles ur ON r.id = ur.role_id
            WHERE ur.user_id = $1
            "#
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(roles.into_iter().map(|(name,)| name).collect())
    }

    /// Get user permissions
    pub async fn get_permissions(pool: &DbPool, user_id: i64) -> Result<Vec<String>, ApiError> {
        let permissions: Vec<(String,)> = sqlx::query_as(
            r#"
            SELECT DISTINCT p.name
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            JOIN user_roles ur ON rp.role_id = ur.role_id
            WHERE ur.user_id = $1
            "#
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(permissions.into_iter().map(|(name,)| name).collect())
    }

    /// Check if user has a specific permission
    pub async fn has_permission(pool: &DbPool, user_id: i64, permission: &str) -> Result<bool, ApiError> {
        let count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            JOIN user_roles ur ON rp.role_id = ur.role_id
            WHERE ur.user_id = $1 AND p.name = $2
            "#
        )
        .bind(user_id)
        .bind(permission)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(count > 0)
    }
}
