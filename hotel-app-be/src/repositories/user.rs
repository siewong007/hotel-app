//! User repository for database operations

use chrono::{DateTime, Utc};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{User, UserCreateInput, UserProfile, UserUpdateInput};
use crate::param;

const UNCONFIGURED_EMAIL_PATTERN: &str = "%@no-email.invalid";

/// Column list backing every query that decodes a [`User`]. Kept in one place so
/// the struct and its queries cannot drift apart.
const USER_COLUMNS: &str = "id, username, email, full_name, phone, is_active, is_verified, \
     user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, \
     created_at, updated_at";

pub struct UserRepository;

impl UserRepository {
    /// Find a user by ID
    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(&format!(
            "SELECT {USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL"
        ))
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find a user by username or email
    pub async fn find_by_username_or_email(
        pool: &DbPool,
        identifier: &str,
    ) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(&format!(
            "SELECT {USER_COLUMNS} FROM users \
             WHERE (username = $1 OR email = $1) AND deleted_at IS NULL"
        ))
        .bind(identifier)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// List every non-deleted user, for administration screens.
    pub async fn list_all(pool: &DbPool) -> Result<Vec<User>, ApiError> {
        sqlx::query_as::<_, User>(&format!(
            "SELECT {USER_COLUMNS} FROM users WHERE deleted_at IS NULL ORDER BY username"
        ))
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Whether a non-deleted user with this id exists.
    pub async fn exists(pool: &DbPool, user_id: i64) -> Result<bool, ApiError> {
        let id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL")
                .bind(user_id)
                .fetch_optional(pool)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(id.is_some())
    }

    /// Whether the username or email is already taken by a *different* user.
    pub async fn username_or_email_exists_for_other(
        pool: &DbPool,
        user_id: i64,
        username: Option<&str>,
        email: Option<&str>,
    ) -> Result<bool, ApiError> {
        let id: Option<i64> = sqlx::query_scalar(
            r#"
            SELECT id
            FROM users
            WHERE deleted_at IS NULL
              AND id != $1
              AND (
                ($2::text IS NOT NULL AND username = $2)
                OR ($3::text IS NOT NULL AND email = $3)
              )
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .bind(username)
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(id.is_some())
    }

    /// Create a user and assign its initial roles in one transaction.
    pub async fn create_with_roles(
        pool: &DbPool,
        input: &UserCreateInput,
        password_hash: &str,
        role_ids: &[i64],
    ) -> Result<User, ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        let user = sqlx::query_as::<_, User>(&format!(
            "INSERT INTO users (username, email, password_hash, full_name, phone, is_active, is_verified) \
             VALUES ($1, $2, $3, $4, $5, true, true) \
             RETURNING {USER_COLUMNS}"
        ))
        .bind(&input.username)
        .bind(&input.email)
        .bind(password_hash)
        .bind(&input.full_name)
        .bind(&input.phone)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        for role_id in role_ids {
            sqlx::query(
                "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            )
            .bind(user.id)
            .bind(role_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(user)
    }

    /// Apply an administrative partial update. `None` fields are left untouched.
    pub async fn admin_update(
        pool: &DbPool,
        user_id: i64,
        input: &UserUpdateInput,
        password_hash: Option<&str>,
    ) -> Result<User, ApiError> {
        sqlx::query_as::<_, User>(&format!(
            "UPDATE users \
             SET username = COALESCE($2, username), \
                 email = COALESCE($3, email), \
                 full_name = COALESCE($4, full_name), \
                 phone = COALESCE($5, phone), \
                 is_active = COALESCE($6, is_active), \
                 password_hash = COALESCE($7, password_hash), \
                 updated_at = CURRENT_TIMESTAMP \
             WHERE id = $1 AND deleted_at IS NULL \
             RETURNING {USER_COLUMNS}"
        ))
        .bind(user_id)
        .bind(input.username.as_deref())
        .bind(input.email.as_deref())
        .bind(input.full_name.as_deref())
        .bind(input.phone.as_deref())
        .bind(input.is_active)
        .bind(password_hash)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("User not found".to_string()))
    }

    /// Soft-delete a user and drop its role assignments in one transaction.
    pub async fn soft_delete(pool: &DbPool, user_id: i64) -> Result<bool, ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        let result = sqlx::query(
            r#"
            UPDATE users
            SET is_active = false,
                deleted_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND deleted_at IS NULL
            "#,
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(result.rows_affected() > 0)
    }

    /// Get user profile
    pub async fn get_profile(pool: &DbPool, user_id: i64) -> Result<Option<UserProfile>, ApiError> {
        let query = r#"
                SELECT id, username,
                       CASE WHEN email LIKE '%@no-email.invalid' THEN '' ELSE email END AS email,
                       CASE WHEN email LIKE '%@no-email.invalid' THEN false ELSE true END AS email_configured,
                       is_verified, user_type, full_name, phone, avatar_url,
                       created_at, updated_at, last_login_at
                FROM users
                WHERE id = $1 AND is_active = true AND deleted_at IS NULL
            "#;
        sqlx::query_as::<_, UserProfile>(query)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn email_exists_for_other_user(
        pool: &DbPool,
        user_id: i64,
        email: &str,
    ) -> Result<bool, ApiError> {
        let query = format!(
            "SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(email) = LOWER({}) AND id <> {})",
            param!(1),
            param!(2)
        );
        sqlx::query_scalar(&query)
            .bind(email)
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Configure a guest account's first real email and mirror it to the linked
    /// guest record. The placeholder guard makes this a one-time transition.
    pub async fn configure_guest_email(
        pool: &DbPool,
        user_id: i64,
        email: &str,
        verification_token: &str,
        token_expires_at: DateTime<Utc>,
    ) -> Result<bool, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;
        let update_user = format!(
            "UPDATE users SET email = {}, is_verified = false, email_verification_token = {}, \
             email_token_expires_at = {}, updated_at = CURRENT_TIMESTAMP \
             WHERE id = {} AND user_type = 'guest' AND email LIKE {}",
            param!(1),
            param!(2),
            param!(3),
            param!(4),
            param!(5)
        );
        let result = sqlx::query(&update_user)
            .bind(email)
            .bind(verification_token)
            .bind(token_expires_at)
            .bind(user_id)
            .bind(UNCONFIGURED_EMAIL_PATTERN)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Ok(false);
        }

        let update_guest = format!(
            "UPDATE guests SET email = {}, updated_at = CURRENT_TIMESTAMP \
             WHERE id = (SELECT guest_id FROM users WHERE id = {})",
            param!(1),
            param!(2)
        );
        sqlx::query(&update_guest)
            .bind(email)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        tx.commit().await.map_err(ApiError::from)?;
        Ok(true)
    }

    /// Get password hash for a user
    pub async fn get_password_hash(pool: &DbPool, user_id: i64) -> Result<String, ApiError> {
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn update_full_name(
        pool: &DbPool,
        user_id: i64,
        full_name: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(
            "UPDATE users SET full_name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        )
        .bind(full_name)
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    pub async fn update_email(pool: &DbPool, user_id: i64, email: &str) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(email)
            .bind(user_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    pub async fn update_phone(pool: &DbPool, user_id: i64, phone: &str) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET phone = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(phone)
            .bind(user_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    pub async fn update_avatar_url(
        pool: &DbPool,
        user_id: i64,
        avatar_url: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(
            "UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        )
        .bind(avatar_url)
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    pub async fn update_password_hash(
        pool: &DbPool,
        user_id: i64,
        password_hash: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE users
            SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            "#,
        )
        .bind(password_hash)
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    pub async fn update_two_factor_secret(
        pool: &DbPool,
        user_id: i64,
        secret: &str,
    ) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET two_factor_secret = $1 WHERE id = $2")
            .bind(secret)
            .bind(user_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
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
            "#,
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
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(permissions.into_iter().map(|(name,)| name).collect())
    }

    /// Check if user has a specific permission
    pub async fn has_permission(
        pool: &DbPool,
        user_id: i64,
        permission: &str,
    ) -> Result<bool, ApiError> {
        let count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            JOIN user_roles ur ON rp.role_id = ur.role_id
            WHERE ur.user_id = $1 AND p.name = $2
            "#,
        )
        .bind(user_id)
        .bind(permission)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(count > 0)
    }
}
