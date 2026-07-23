//! Loyalty program models

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Loyalty program configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyProgram {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub tier_level: i32,
    pub points_multiplier: Decimal,
    pub minimum_points_required: i32,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Guest's loyalty membership
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LoyaltyMembership {
    pub id: i64,
    pub guest_id: i64,
    pub program_id: i64,
    pub membership_number: String,
    pub points_balance: i32,
    pub lifetime_points: i32,
    pub tier_level: i32,
    pub status: String,
    pub enrolled_date: NaiveDate,
    pub expiry_date: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Membership with related details
#[derive(Debug, Serialize, Deserialize)]
pub struct LoyaltyMembershipWithDetails {
    pub id: i64,
    pub guest_id: i64,
    pub guest_name: String,
    pub guest_email: String,
    pub program_id: i64,
    pub program_name: String,
    pub program_description: Option<String>,
    pub membership_number: String,
    pub points_balance: i32,
    pub lifetime_points: i32,
    pub tier_level: i32,
    pub points_multiplier: Decimal,
    pub status: String,
    pub enrolled_date: NaiveDate,
}

/// Points transaction record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PointsTransaction {
    pub id: String,
    pub membership_id: i64,
    pub transaction_type: String,
    pub points_amount: i32,
    pub balance_after: i32,
    pub reference_type: Option<String>,
    pub reference_id: Option<i64>,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Statistics by tier
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct TierStatistics {
    pub tier_level: i32,
    pub tier_name: String,
    pub count: i64,
    pub percentage: f64,
}

/// Top member information
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct TopMember {
    pub guest_name: String,
    pub guest_email: String,
    pub points_balance: i32,
    pub lifetime_points: i32,
    pub tier_level: i32,
    pub membership_number: String,
}

/// Recent transaction for display
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct RecentTransaction {
    pub id: String,
    pub guest_name: String,
    pub transaction_type: String,
    pub points_amount: i32,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Membership growth data
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct MembershipGrowth {
    pub date: String,
    pub new_members: i64,
    pub total_members: i64,
}

/// Points activity data
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct PointsActivity {
    pub date: String,
    pub points_earned: i64,
    pub points_redeemed: i64,
}

/// Comprehensive loyalty statistics
#[derive(Debug, Serialize, Deserialize)]
pub struct LoyaltyStatistics {
    pub total_members: i64,
    pub active_members: i64,
    pub members_by_tier: Vec<TierStatistics>,
    pub total_points_issued: i64,
    pub total_points_redeemed: i64,
    pub total_points_active: i64,
    pub average_points_per_member: f64,
    pub top_members: Vec<TopMember>,
    pub recent_transactions: Vec<RecentTransaction>,
    pub membership_growth: Vec<MembershipGrowth>,
    pub points_activity: Vec<PointsActivity>,
}

/// Input for adding points
#[derive(Debug, Serialize, Deserialize)]
pub struct AddPointsInput {
    pub points: i32,
    pub description: Option<String>,
}

/// Input for redeeming points
#[derive(Debug, Serialize, Deserialize)]
pub struct RedeemPointsInput {
    pub points: i32,
    pub description: Option<String>,
}

/// User's view of their loyalty membership
#[derive(Debug, Serialize, Deserialize)]
pub struct UserLoyaltyMembership {
    pub id: i64,
    pub membership_number: String,
    pub points_balance: i32,
    pub lifetime_points: i32,
    pub tier_level: i32,
    pub tier_name: String,
    pub status: String,
    pub enrolled_date: NaiveDate,
    pub expiry_date: Option<NaiveDate>,
    pub next_tier: Option<TierInfo>,
    pub current_tier_benefits: Vec<String>,
    pub points_to_next_tier: Option<i32>,
    pub recent_transactions: Vec<PointsTransaction>,
}

/// Tier information
#[derive(Debug, Serialize, Deserialize)]
pub struct TierInfo {
    pub tier_level: i32,
    pub tier_name: String,
    pub minimum_points: i32,
    pub benefits: Vec<String>,
    pub points_multiplier: Decimal,
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for LoyaltyProgram {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(LoyaltyProgram {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            description: row.try_get("description")?,
            tier_level: row.try_get("tier_level")?,
            points_multiplier: { row.try_get("points_multiplier")? },
            minimum_points_required: row.try_get("minimum_points_required")?,
            is_active: row.try_get("is_active")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for LoyaltyMembershipWithDetails {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(LoyaltyMembershipWithDetails {
            id: row.try_get("id")?,
            guest_id: row.try_get("guest_id")?,
            guest_name: row.try_get("guest_name")?,
            guest_email: row.try_get("guest_email")?,
            program_id: row.try_get("program_id")?,
            program_name: row.try_get("program_name")?,
            program_description: row.try_get("program_description")?,
            membership_number: row.try_get("membership_number")?,
            points_balance: row.try_get("points_balance")?,
            lifetime_points: row.try_get("lifetime_points")?,
            tier_level: row.try_get("tier_level")?,
            points_multiplier: { row.try_get("points_multiplier")? },
            status: row.try_get("status")?,
            enrolled_date: row.try_get("enrolled_date")?,
        })
    }
}
