//! Authentication repository for database operations.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::models::{Guest, RegisterRequest, User};
use chrono::{DateTime, Utc};

pub struct AuthRepository;

fn is_guest_name_unique_violation(error: &sqlx::Error) -> bool {
    let Some(database_error) = error.as_database_error() else {
        return false;
    };

    let is_unique_violation = database_error.code().as_deref() == Some("23505")
        || database_error
            .message()
            .contains("UNIQUE constraint failed");
    let is_guest_name_constraint = database_error.constraint()
        == Some("idx_guests_full_name_unique")
        || database_error
            .message()
            .contains("idx_guests_full_name_unique");

    is_unique_violation && is_guest_name_constraint
}

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
    ) -> Result<(Option<bool>, Option<DateTime<Utc>>, Option<i32>), ApiError> {
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
        settings_cache::get_positive_i32(pool, "max_login_attempts", 5).await
    }

    pub async fn lock_user_after_failure(
        pool: &DbPool,
        user_id: i64,
        attempts: i32,
        locked_until: DateTime<Utc>,
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
        email: Option<&str>,
    ) -> Result<bool, ApiError> {
        let existing = sqlx::query_scalar::<_, i64>(
            "SELECT id FROM users WHERE username = $1 OR ($2 IS NOT NULL AND email = $2) LIMIT 1",
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
        let guest_query = r#"
                INSERT INTO guests (
                    first_name, last_name, full_name, email, phone, address_line_1,
                    is_active, guest_type, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, true, 'non_member', CURRENT_TIMESTAMP)
                RETURNING id, full_name, email, phone, ic_number, nationality,
                          address_line_1 AS address_line1, city, state AS state_province,
                          postal_code, country, title, alt_phone, is_active, guest_type,
                          tourism_type, COALESCE(discount_percentage, 0) AS discount_percentage,
                          company_name,
                          COALESCE(complimentary_nights_credit, 0) AS complimentary_nights_credit,
                          created_at, updated_at,
                          NULL::BIGINT AS bookings_count,
                          NULL::DATE AS last_stay_date
            "#;

        let guest: Guest = sqlx::query_as(guest_query)
            .bind(&req.first_name)
            .bind(&req.last_name)
            .bind(&full_name)
            .bind(&req.email)
            .bind(&req.phone)
            .bind(&req.address_line1)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| {
                if is_guest_name_unique_violation(&error) {
                    ApiError::Conflict(
                        "A guest profile with this name already exists. Please sign in with your existing account or contact the hotel for help."
                            .to_string(),
                    )
                } else {
                    ApiError::from(error)
                }
            })?;

        // The users table historically requires an email. Keep that internal
        // contract without exposing a fake address or triggering verification
        // by using a reserved, non-deliverable domain when email is omitted.
        let account_email = req
            .email
            .clone()
            .unwrap_or_else(|| format!("{}@no-email.invalid", req.username));
        let is_verified = req.email.is_none();
        let user_uuid = crate::core::db::generate_uuid();
        let user_query = r#"
                INSERT INTO users (
                    uuid, username, email, password_hash, full_name, phone,
                    user_type, guest_id, is_active, is_verified, created_at
                )
                VALUES ($8::uuid, $1, $2, $3, $4, $5, 'guest', $6, true, $7, CURRENT_TIMESTAMP)
                RETURNING id, username, email, full_name, phone, is_active, is_verified,
                          user_type, two_factor_enabled, two_factor_secret,
                          two_factor_recovery_codes, created_at, updated_at
            "#;

        let user = sqlx::query_as::<_, User>(user_query)
            .bind(&req.username)
            .bind(account_email)
            .bind(password_hash)
            .bind(&full_name)
            .bind(&req.phone)
            .bind(guest.id)
            .bind(is_verified)
            .bind(user_uuid)
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

        tx.commit().await.map_err(ApiError::from)?;

        Ok((guest, user))
    }
}
