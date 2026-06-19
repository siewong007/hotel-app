//! Booking channel and commission models.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookingChannel {
    pub id: i64,
    pub name: String,
    pub channel_type: String,
    pub default_commission_type: String,
    pub default_commission_value: Decimal,
    pub default_commission_scope: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BookingChannelInput {
    pub name: String,
    pub channel_type: Option<String>,
    pub default_commission_type: Option<String>,
    pub default_commission_value: Option<Decimal>,
    pub default_commission_scope: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BookingChannelUpdate {
    pub name: Option<String>,
    pub channel_type: Option<String>,
    pub default_commission_type: Option<String>,
    pub default_commission_value: Option<Decimal>,
    pub default_commission_scope: Option<String>,
    pub is_active: Option<bool>,
}
