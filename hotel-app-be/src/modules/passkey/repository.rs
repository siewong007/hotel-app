//! Passkey/WebAuthn repository for database operations.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{Passkey, PasskeyInfoRow, User};
use chrono::{DateTime, Utc};

pub struct PasskeyRepository;

impl PasskeyRepository {
    pub async fn list_passkeys(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<Vec<PasskeyInfoRow>, ApiError> {
        sqlx::query_as::<_, PasskeyInfoRow>(
            r#"
            SELECT id, credential_id, device_name, created_at, last_used_at
            FROM passkeys
            WHERE user_id = $1
            ORDER BY created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn delete_passkey(
        pool: &DbPool,
        user_id: i64,
        passkey_id: uuid::Uuid,
    ) -> Result<bool, ApiError> {
        let result = sqlx::query("DELETE FROM passkeys WHERE id = $1 AND user_id = $2")
            .bind(passkey_id)
            .bind(user_id)
            .execute(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn update_device_name(
        pool: &DbPool,
        user_id: i64,
        passkey_id: uuid::Uuid,
        device_name: &str,
    ) -> Result<bool, ApiError> {
        let result =
            sqlx::query("UPDATE passkeys SET device_name = $1 WHERE id = $2 AND user_id = $3")
                .bind(device_name)
                .bind(passkey_id)
                .bind(user_id)
                .execute(pool)
                .await
                .map_err(ApiError::from)?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn find_active_user_by_id_and_username(
        pool: &DbPool,
        user_id: i64,
        username: &str,
    ) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE id = $1 AND username = $2 AND is_active = true AND deleted_at IS NULL"
        )
        .bind(user_id)
        .bind(username)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn find_active_user_by_username(
        pool: &DbPool,
        username: &str,
    ) -> Result<Option<User>, ApiError> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, email, full_name, phone, is_active, is_verified, user_type, two_factor_enabled, two_factor_secret, two_factor_recovery_codes, created_at, updated_at FROM users WHERE username = $1 AND is_active = true AND deleted_at IS NULL"
        )
        .bind(username)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn passkey_count(pool: &DbPool, user_id: i64) -> Result<i64, ApiError> {
        sqlx::query_scalar("SELECT COUNT(*) FROM passkeys WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn insert_challenge(
        pool: &DbPool,
        user_id: i64,
        challenge: &[u8],
        challenge_type: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            INSERT INTO passkey_challenges (user_id, challenge, challenge_type, expires_at)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(user_id)
        .bind(challenge)
        .bind(challenge_type)
        .bind(expires_at)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(ApiError::from)
    }

    pub async fn challenge_exists(
        pool: &DbPool,
        user_id: i64,
        challenge: &[u8],
        challenge_type: &str,
    ) -> Result<bool, ApiError> {
        sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM passkey_challenges WHERE user_id = $1 AND challenge = $2 AND challenge_type = $3 AND expires_at > CURRENT_TIMESTAMP AND used_at IS NULL)"
        )
        .bind(user_id)
        .bind(challenge)
        .bind(challenge_type)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn insert_passkey(
        pool: &DbPool,
        user_id: i64,
        credential_id: &[u8],
        public_key: &[u8],
        counter: i64,
        device_name: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            INSERT INTO passkeys (user_id, credential_id, public_key, counter, device_name)
            VALUES ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(user_id)
        .bind(credential_id)
        .bind(public_key)
        .bind(counter)
        .bind(device_name)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(ApiError::from)
    }

    pub async fn mark_challenge_used(
        pool: &DbPool,
        user_id: i64,
        challenge: &[u8],
    ) -> Result<(), ApiError> {
        sqlx::query(
            "UPDATE passkey_challenges SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND challenge = $2",
        )
        .bind(user_id)
        .bind(challenge)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(ApiError::from)
    }

    pub async fn active_passkeys(pool: &DbPool, user_id: i64) -> Result<Vec<Passkey>, ApiError> {
        sqlx::query_as::<_, Passkey>(
            "SELECT id, user_id, credential_id, public_key, counter, device_name, created_at, last_used_at \
             FROM passkeys WHERE user_id = $1 AND is_active = true",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn find_active_passkey_by_credential(
        pool: &DbPool,
        user_id: i64,
        credential_id: &[u8],
    ) -> Result<Option<Passkey>, ApiError> {
        sqlx::query_as::<_, Passkey>(
            "SELECT id, user_id, credential_id, public_key, counter, device_name, created_at, last_used_at \
             FROM passkeys WHERE user_id = $1 AND credential_id = $2 AND is_active = true",
        )
        .bind(user_id)
        .bind(credential_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn update_last_used(
        pool: &DbPool,
        passkey_id: uuid::Uuid,
        counter: i64,
    ) -> Result<(), ApiError> {
        sqlx::query(
            "UPDATE passkeys SET last_used_at = CURRENT_TIMESTAMP, counter = $1 WHERE id = $2",
        )
        .bind(counter)
        .bind(passkey_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(ApiError::from)
    }
    /// Deactivate every passkey for a user. Password resets call this: a
    /// passkey satisfies 2FA on its own and survives every password change,
    /// so a reset that left passkeys valid would let an attacker who enrolled
    /// during a session compromise keep logging in forever. Rows are
    /// deactivated, not deleted, so the credential inventory stays auditable.
    pub async fn revoke_all_for_user(pool: &DbPool, user_id: i64) -> Result<u64, ApiError> {
        sqlx::query("UPDATE passkeys SET is_active = false WHERE user_id = $1 AND is_active = true")
            .bind(user_id)
            .execute(pool)
            .await
            .map(|result| result.rows_affected())
            .map_err(ApiError::from)
    }
}
