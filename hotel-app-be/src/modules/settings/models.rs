//! System settings models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// System setting entry
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SystemSetting {
    pub id: i64,
    pub key: String,
    pub value: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub value_type: Option<String>,
    pub is_public: bool,
    /// The seeded default this key can be reset to. `None` when the key has no
    /// recorded default — including every row on a database created before the
    /// `default_value` column existed.
    #[serde(default)]
    pub default_value: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Optional filter for `GET /settings`.
#[derive(Debug, Deserialize)]
pub struct SettingsListQuery {
    pub category: Option<String>,
}

/// A single setting flagged `is_public` — safe to expose without authentication.
/// Only the key/value pair is returned; metadata stays behind `settings:read`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PublicSetting {
    pub key: String,
    pub value: String,
}

/// Input for updating a system setting
#[derive(Debug, Serialize, Deserialize)]
pub struct SystemSettingUpdate {
    pub value: String,
}

/// Response containing available rate codes
#[derive(Debug, Serialize, Deserialize)]
pub struct RateCodesResponse {
    pub rate_codes: Vec<String>,
}

/// Response containing available market codes
#[derive(Debug, Serialize, Deserialize)]
pub struct MarketCodesResponse {
    pub market_codes: Vec<String>,
}
