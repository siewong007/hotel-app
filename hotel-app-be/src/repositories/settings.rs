//! System settings repository for database operations

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::SystemSetting;

pub struct SettingsRepository;

impl SettingsRepository {
    /// Find all settings
    pub async fn find_all(pool: &DbPool) -> Result<Vec<SystemSetting>, ApiError> {
        sqlx::query_as::<_, SystemSetting>(
            r#"
            SELECT id, key, value, description, category, created_at, updated_at
            FROM system_settings
            ORDER BY category, key
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find settings by category
    pub async fn find_by_category(
        pool: &DbPool,
        category: &str,
    ) -> Result<Vec<SystemSetting>, ApiError> {
        sqlx::query_as::<_, SystemSetting>(
            r#"
            SELECT id, key, value, description, category, created_at, updated_at
            FROM system_settings
            WHERE category = $1
            ORDER BY key
            "#,
        )
        .bind(category)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find setting by key
    pub async fn find_by_key(pool: &DbPool, key: &str) -> Result<Option<SystemSetting>, ApiError> {
        sqlx::query_as::<_, SystemSetting>(
            r#"
            SELECT id, key, value, description, category, created_at, updated_at
            FROM system_settings
            WHERE key = $1
            "#,
        )
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get setting value
    pub async fn get_value(pool: &DbPool, key: &str) -> Result<Option<String>, ApiError> {
        sqlx::query_scalar("SELECT value FROM system_settings WHERE key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Update setting value
    pub async fn update_value(
        pool: &DbPool,
        key: &str,
        value: &str,
    ) -> Result<SystemSetting, ApiError> {
        sqlx::query_as::<_, SystemSetting>(
            r#"
            UPDATE system_settings
            SET value = $1, updated_at = CURRENT_TIMESTAMP
            WHERE key = $2
            RETURNING id, key, value, description, category, created_at, updated_at
            "#,
        )
        .bind(value)
        .bind(key)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Update setting value and stamp the user that changed it.
    pub async fn update_value_by_user(
        pool: &DbPool,
        key: &str,
        value: &str,
        user_id: i64,
    ) -> Result<Option<SystemSetting>, ApiError> {
        sqlx::query_as::<_, SystemSetting>(
            r#"
            UPDATE system_settings
            SET value = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2
            WHERE key = $3
            RETURNING id, key, value, description, category, created_at, updated_at
            "#,
        )
        .bind(value)
        .bind(user_id)
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Auto check in today's confirmed bookings that reached the configured check-in time.
    pub async fn auto_check_in_bookings(
        pool: &DbPool,
        check_in_time: &str,
        check_out_time: &str,
    ) -> Result<u64, ApiError> {
        let query = crate::sql_query!(
            postgres: r#"
            UPDATE bookings
            SET status = 'auto_checked_in', updated_at = CURRENT_TIMESTAMP
            WHERE status = 'confirmed'
              AND check_in_date = CURRENT_DATE
              AND CURRENT_TIME >= $1::TIME
              AND CURRENT_TIME < $2::TIME
            "#,
            sqlite: r#"
            UPDATE bookings
            SET status = 'auto_checked_in', updated_at = datetime('now')
            WHERE status = 'confirmed'
              AND check_in_date = date('now')
              AND time('now') >= time(?1)
              AND time('now') < time(?2)
            "#
        );

        sqlx::query(query)
            .bind(check_in_time)
            .bind(check_out_time)
            .execute(pool)
            .await
            .map(|result| result.rows_affected())
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Mark rooms occupied for bookings auto-checked-in today.
    pub async fn mark_auto_checked_in_rooms_occupied(pool: &DbPool) -> Result<u64, ApiError> {
        let query = crate::sql_query!(
            postgres: r#"
            UPDATE rooms
            SET status = 'occupied'
            WHERE id IN (
                SELECT room_id FROM bookings
                WHERE status = 'auto_checked_in'
                  AND check_in_date = CURRENT_DATE
            )
            "#,
            sqlite: r#"
            UPDATE rooms
            SET status = 'occupied'
            WHERE id IN (
                SELECT room_id FROM bookings
                WHERE status = 'auto_checked_in'
                  AND check_in_date = date('now')
            )
            "#
        );

        sqlx::query(query)
            .execute(pool)
            .await
            .map(|result| result.rows_affected())
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Mark checked-in bookings late after the configured checkout time.
    pub async fn mark_late_checkouts(pool: &DbPool, check_out_time: &str) -> Result<u64, ApiError> {
        let query = crate::sql_query!(
            postgres: r#"
            UPDATE bookings
            SET status = 'late_checkout', updated_at = CURRENT_TIMESTAMP
            WHERE status IN ('checked_in', 'auto_checked_in')
              AND check_out_date = CURRENT_DATE
              AND CURRENT_TIME > $1::TIME
            "#,
            sqlite: r#"
            UPDATE bookings
            SET status = 'late_checkout', updated_at = datetime('now')
            WHERE status IN ('checked_in', 'auto_checked_in')
              AND check_out_date = date('now')
              AND time('now') > time(?1)
            "#
        );

        sqlx::query(query)
            .bind(check_out_time)
            .execute(pool)
            .await
            .map(|result| result.rows_affected())
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Create or update setting
    pub async fn upsert(
        pool: &DbPool,
        key: &str,
        value: &str,
        description: Option<&str>,
        category: Option<&str>,
    ) -> Result<SystemSetting, ApiError> {
        sqlx::query_as::<_, SystemSetting>(
            r#"
            INSERT INTO system_settings (key, value, description, category)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
            RETURNING id, key, value, description, category, created_at, updated_at
            "#,
        )
        .bind(key)
        .bind(value)
        .bind(description)
        .bind(category)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get rate codes from settings
    pub async fn get_rate_codes(pool: &DbPool) -> Result<Vec<String>, ApiError> {
        let codes: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT code FROM rate_plans WHERE is_active = true ORDER BY code",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(codes.into_iter().map(|(code,)| code).collect())
    }

    /// Get market codes from settings
    pub async fn get_market_codes(pool: &DbPool) -> Result<Vec<String>, ApiError> {
        let value = Self::get_value(pool, "market_codes").await?;

        Ok(value
            .map(|v| v.split(',').map(|s| s.trim().to_string()).collect())
            .unwrap_or_default())
    }
}
