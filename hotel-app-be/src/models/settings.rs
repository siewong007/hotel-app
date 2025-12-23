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
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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
