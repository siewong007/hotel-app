//! Rewards catalog models

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Loyalty reward in the catalog
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Fully resolved values used when persisting a reward update.
#[derive(Debug, Clone)]
pub struct RewardUpdateValues {
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
}

/// Response returned after redeeming a reward.
#[derive(Debug, Clone, Serialize)]
pub struct RewardRedemptionResponse {
    pub message: String,
    pub points_spent: i32,
    pub new_balance: i32,
    pub reward_name: String,
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


impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for LoyaltyReward {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(LoyaltyReward {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            description: row.try_get("description")?,
            category: row.try_get("category")?,
            points_cost: row.try_get("points_cost")?,
            monetary_value: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(row.try_get::<Option<String>, _>("monetary_value")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("monetary_value")?;
                val
            },
            minimum_tier_level: row.try_get("minimum_tier_level")?,
            is_active: row.try_get("is_active")?,
            stock_quantity: row.try_get("stock_quantity")?,
            image_url: row.try_get("image_url")?,
            terms_conditions: row.try_get("terms_conditions")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}
