//! Authentication repository for database operations.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{Guest, RegisterRequest, User};
use chrono::NaiveDateTime;

pub struct AuthRepository;

impl AuthRepository {
    pub async fn find_user_by_login(
        pool: &DbPool,
        username_or_email: &str,
    ) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE (username = $1 OR email = $1) AND deleted_at IS NULL"
        )
        .bind(username_or_email)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn find_user_by_id(pool: &DbPool, user_id: i64) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE id = $1 AND deleted_at IS NULL"
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn find_user_by_email(pool: &DbPool, email: &str) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE email = $1 AND deleted_at IS NULL"
        )
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn login_lock_state(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<(Option<bool>, Option<NaiveDateTime>, Option<i32>), ApiError> {
        sqlx::query_as(
            "SELECT is_locked, locked_until, failed_login_attempts FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn unlock_user(pool: &DbPool, user_id: i64) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET is_locked = false, locked_until = NULL, failed_login_attempts = 0 WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(ApiError::from)
    }

    pub async fn password_hash(pool: &DbPool, user_id: i64) -> Result<String, ApiError> {
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn max_login_attempts(pool: &DbPool) -> i32 {
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT value FROM system_settings WHERE key = 'max_login_attempts'",
        )
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .flatten()
        .and_then(|value| value.parse().ok())
        .unwrap_or(5)
    }

    pub async fn lock_user_after_failure(
        pool: &DbPool,
        user_id: i64,
        attempts: i32,
        locked_until: NaiveDateTime,
    ) -> Result<(), ApiError> {
        sqlx::query(
            "UPDATE users SET failed_login_attempts = $1, is_locked = true, locked_until = $2 WHERE id = $3",
        )
        .bind(attempts)
        .bind(locked_until)
        .bind(user_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(ApiError::from)
    }

    pub async fn update_failed_login_attempts(
        pool: &DbPool,
        user_id: i64,
        attempts: i32,
    ) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET failed_login_attempts = $1 WHERE id = $2")
            .bind(attempts)
            .bind(user_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(ApiError::from)
    }

    pub async fn two_factor_state(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<(Option<bool>, Option<String>), ApiError> {
        sqlx::query_as("SELECT two_factor_enabled, two_factor_secret FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn reset_login_attempts(pool: &DbPool, user_id: i64) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET failed_login_attempts = 0, is_locked = false, locked_until = NULL WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(ApiError::from)
    }

    pub async fn is_first_login(pool: &DbPool, user_id: i64) -> Result<bool, ApiError> {
        sqlx::query_scalar("SELECT last_login_at IS NULL FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn update_last_login(pool: &DbPool, user_id: i64) -> Result<(), ApiError> {
        sqlx::query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(ApiError::from)
    }

    pub async fn username_or_email_exists(
        pool: &DbPool,
        username: &str,
        email: &str,
    ) -> Result<bool, ApiError> {
        let existing = sqlx::query_scalar::<_, i64>(
            "SELECT id FROM users WHERE username = $1 OR email = $2 LIMIT 1"
        )
        .bind(username)
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)?;

        Ok(existing.is_some())
    }

    pub async fn register_guest_user(
        pool: &DbPool,
        req: &RegisterRequest,
        password_hash: &str,
    ) -> Result<(Guest, User), ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;
        let full_name = format!("{} {}", req.first_name, req.last_name);

        let guest: Guest = sqlx::query_as(
            r#"
            INSERT INTO guests (
                first_name, last_name, full_name, email, phone, is_active, created_at
            )
            VALUES ($1, $2, $3, $4, $5, true, CURRENT_TIMESTAMP)
            RETURNING *
            "#,
        )
        .bind(&req.first_name)
        .bind(&req.last_name)
        .bind(&full_name)
        .bind(&req.email)
        .bind(&req.phone)
        .fetch_one(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (
                username, email, password_hash, full_name, phone,
                user_type, guest_id, is_active, is_verified, created_at
            )
            VALUES ($1, $2, $3, $4, $5, 'guest', $6, true, false, CURRENT_TIMESTAMP)
            RETURNING id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at
            "#,
        )
        .bind(&req.username)
        .bind(&req.email)
        .bind(password_hash)
        .bind(&full_name)
        .bind(&req.phone)
        .bind(guest.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        let guest_role_id: i64 =
            sqlx::query_scalar("SELECT id FROM roles WHERE name = 'guest' LIMIT 1")
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| ApiError::Database(format!("Guest role not found: {}", e)))?;

        sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)")
            .bind(user.id)
            .bind(guest_role_id)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;

        let loyalty_program_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM loyalty_programs WHERE tier_level = 1 ORDER BY created_at LIMIT 1",
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        if let Some(program_id) = loyalty_program_id {
            sqlx::query(
                r#"
                INSERT INTO loyalty_memberships (
                    guest_id, program_id, membership_number,
                    points_balance, lifetime_points, tier_level, status, enrolled_date
                )
                VALUES ($1, $2, $3, 0, 0, 1, 'active', CURRENT_DATE)
                "#,
            )
            .bind(guest.id)
            .bind(program_id)
            .bind(format!("LM-{:08}", guest.id))
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;
        }

        tx.commit().await.map_err(ApiError::from)?;

        Ok((guest, user))
    }
}
