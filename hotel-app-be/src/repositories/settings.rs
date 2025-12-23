//! System settings repository for database operations

use sqlx::PgPool;
use crate::core::error::ApiError;
use crate::models::SystemSetting;

pub struct SettingsRepository;

impl SettingsRepository {
    /// Find all settings
    pub async fn find_all(pool: &PgPool) -> Result<Vec<SystemSetting>, ApiError> {
        sqlx::query_as::<_, SystemSetting>(
            r#"
            SELECT id, key, value, description, category, created_at, updated_at
            FROM system_settings
            ORDER BY category, key
            "#
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find settings by category
    pub async fn find_by_category(pool: &PgPool, category: &str) -> Result<Vec<SystemSetting>, ApiError> {
        sqlx::query_as::<_, SystemSetting>(
            r#"
            SELECT id, key, value, description, category, created_at, updated_at
            FROM system_settings
            WHERE category = $1
            ORDER BY key
            "#
        )
        .bind(category)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find setting by key
    pub async fn find_by_key(pool: &PgPool, key: &str) -> Result<Option<SystemSetting>, ApiError> {
        sqlx::query_as::<_, SystemSetting>(
            r#"
            SELECT id, key, value, description, category, created_at, updated_at
            FROM system_settings
            WHERE key = $1
            "#
        )
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get setting value
    pub async fn get_value(pool: &PgPool, key: &str) -> Result<Option<String>, ApiError> {
        sqlx::query_scalar("SELECT value FROM system_settings WHERE key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Update setting value
    pub async fn update_value(pool: &PgPool, key: &str, value: &str) -> Result<SystemSetting, ApiError> {
        sqlx::query_as::<_, SystemSetting>(
            r#"
            UPDATE system_settings
            SET value = $1, updated_at = CURRENT_TIMESTAMP
            WHERE key = $2
            RETURNING id, key, value, description, category, created_at, updated_at
            "#
        )
        .bind(value)
        .bind(key)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Create or update setting
    pub async fn upsert(
        pool: &PgPool,
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
            "#
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
    pub async fn get_rate_codes(pool: &PgPool) -> Result<Vec<String>, ApiError> {
        let codes: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT code FROM rate_plans WHERE is_active = true ORDER BY code"
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(codes.into_iter().map(|(code,)| code).collect())
    }

    /// Get market codes from settings
    pub async fn get_market_codes(pool: &PgPool) -> Result<Vec<String>, ApiError> {
        let value = Self::get_value(pool, "market_codes").await?;

        Ok(value
            .map(|v| v.split(',').map(|s| s.trim().to_string()).collect())
            .unwrap_or_default())
    }
}
