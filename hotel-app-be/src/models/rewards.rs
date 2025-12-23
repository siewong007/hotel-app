//! Rewards catalog models

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Loyalty reward in the catalog
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LoyaltyReward {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub points_cost: i32,
    pub monetary_value: Option<Decimal>,
    pub minimum_tier_level: i32,
    pub is_active: bool,
    pub stock_quantity: Option<i32>,
    pub image_url: Option<String>,
    pub terms_conditions: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Input for redeeming a reward
#[derive(Debug, Serialize, Deserialize)]
pub struct RedeemRewardInput {
    pub reward_id: i64,
    pub booking_id: Option<i64>,
    pub notes: Option<String>,
}

/// Input for creating a reward
#[derive(Debug, Serialize, Deserialize)]
pub struct RewardInput {
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub points_cost: i32,
    pub monetary_value: Option<f64>,
    pub minimum_tier_level: i32,
    pub stock_quantity: Option<i32>,
    pub image_url: Option<String>,
    pub terms_conditions: Option<String>,
}

/// Input for updating a reward
#[derive(Debug, Serialize, Deserialize)]
pub struct RewardUpdateInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub points_cost: Option<i32>,
    pub monetary_value: Option<f64>,
    pub minimum_tier_level: Option<i32>,
    pub is_active: Option<bool>,
    pub stock_quantity: Option<i32>,
    pub image_url: Option<String>,
    pub terms_conditions: Option<String>,
}

/// Reward redemption record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RewardRedemption {
    pub id: i64,
    pub membership_id: i64,
    pub reward_id: i64,
    pub transaction_id: String,
    pub booking_id: Option<i64>,
    pub points_spent: i32,
    pub status: String,
    pub redeemed_at: Option<DateTime<Utc>>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Redemption with related details
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct RewardRedemptionWithDetails {
    pub id: i64,
    pub membership_id: i64,
    pub membership_number: String,
    pub guest_name: String,
    pub guest_email: String,
    pub reward_id: i64,
    pub reward_name: String,
    pub reward_category: String,
    pub points_spent: i32,
    pub status: String,
    pub redeemed_at: Option<DateTime<Utc>>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}
