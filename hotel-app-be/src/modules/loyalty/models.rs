use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyGuestProfile {
    pub guest_id: i64,
    pub full_name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyTier {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub sort_order: i32,
    pub min_points: i32,
    pub min_nights: i32,
    pub min_spend: f64,
    pub benefits: Vec<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyProgramRules {
    pub id: i64,
    pub points_per_currency_unit: f64,
    pub tier_qualification_metric: String,
    pub point_expiry_months: Option<i32>,
    pub redemption_approval_required: bool,
    pub earning_enabled: bool,
    pub min_eligible_amount: f64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyMemberSummary {
    pub id: i64,
    pub guest_id: i64,
    pub member_number: String,
    pub status: String,
    pub enrolled_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
    pub guest_name: String,
    pub guest_email: Option<String>,
    pub guest_phone: Option<String>,
    pub account_id: i64,
    pub available_points: i32,
    pub lifetime_points: i32,
    pub qualifying_points: i32,
    pub qualifying_nights: i32,
    pub qualifying_spend: f64,
    pub tier_id: i64,
    pub tier_code: String,
    pub tier_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierProgress {
    pub metric: String,
    pub current_value: f64,
    pub current_tier_minimum: f64,
    pub next_tier_id: Option<i64>,
    pub next_tier_name: Option<String>,
    pub next_tier_minimum: Option<f64>,
    pub remaining_to_next_tier: Option<f64>,
    pub progress_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyTransaction {
    pub id: i64,
    pub member_id: i64,
    pub account_id: i64,
    pub transaction_type: String,
    pub points_delta: i32,
    pub available_delta: i32,
    pub balance_after: i32,
    pub source_type: Option<String>,
    pub source_id: Option<i64>,
    pub booking_id: Option<i64>,
    pub payment_id: Option<i64>,
    pub invoice_id: Option<i64>,
    pub related_transaction_id: Option<i64>,
    pub description: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub actor_user_id: Option<i64>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyReward {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub points_cost: i32,
    pub minimum_tier_id: Option<i64>,
    pub minimum_tier_name: Option<String>,
    pub requires_approval: bool,
    pub is_active: bool,
    pub inventory_count: Option<i32>,
    pub valid_from: Option<NaiveDate>,
    pub valid_to: Option<NaiveDate>,
    pub terms_conditions: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyRedemption {
    pub id: i64,
    pub member_id: i64,
    pub member_number: String,
    pub guest_name: String,
    pub guest_email: Option<String>,
    pub reward_id: i64,
    pub reward_name: String,
    pub points_spent: i32,
    pub status: String,
    pub transaction_id: Option<i64>,
    pub requested_at: DateTime<Utc>,
    pub reviewed_by: Option<i64>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub rejection_reason: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyMemberDetail {
    pub member: LoyaltyMemberSummary,
    pub tier_progress: TierProgress,
    pub recent_activity: Vec<LoyaltyTransaction>,
    pub redemptions: Vec<LoyaltyRedemption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyMeResponse {
    pub enrolled: bool,
    pub profile: LoyaltyGuestProfile,
    pub member: Option<LoyaltyMemberSummary>,
    pub tier_progress: Option<TierProgress>,
    pub recent_activity: Vec<LoyaltyTransaction>,
    pub redemptions: Vec<LoyaltyRedemption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyEnrollmentResponse {
    pub member: LoyaltyMemberSummary,
    pub tier_progress: TierProgress,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct ManualAdjustmentInput {
    pub points_delta: i32,
    #[validate(length(
        min = 5,
        max = 500,
        message = "Adjustment reason must be 5-500 characters"
    ))]
    pub reason: String,
    pub allow_negative_balance: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct LoyaltyRulesInput {
    #[validate(range(min = 0.0, max = 100.0))]
    pub points_per_currency_unit: f64,
    pub tier_qualification_metric: String,
    #[validate(range(min = 1, max = 120))]
    pub point_expiry_months: Option<i32>,
    pub redemption_approval_required: bool,
    pub earning_enabled: bool,
    #[validate(range(min = 0.0))]
    pub min_eligible_amount: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoyaltyMemberQuery {
    pub search: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoyaltyRewardQuery {
    pub include_inactive: Option<bool>,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoyaltyRedemptionQuery {
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct RewardInput {
    #[validate(length(min = 2, max = 120))]
    pub name: String,
    #[validate(length(max = 1000))]
    pub description: Option<String>,
    #[validate(length(min = 2, max = 50))]
    pub category: String,
    #[validate(range(min = 1))]
    pub points_cost: i32,
    pub minimum_tier_id: Option<i64>,
    pub requires_approval: Option<bool>,
    pub is_active: Option<bool>,
    #[validate(range(min = 0))]
    pub inventory_count: Option<i32>,
    pub valid_from: Option<NaiveDate>,
    pub valid_to: Option<NaiveDate>,
    #[validate(length(max = 2000))]
    pub terms_conditions: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct RewardUpdateInput {
    #[validate(length(min = 2, max = 120))]
    pub name: Option<String>,
    #[validate(length(max = 1000))]
    pub description: Option<String>,
    #[validate(length(min = 2, max = 50))]
    pub category: Option<String>,
    #[validate(range(min = 1))]
    pub points_cost: Option<i32>,
    pub minimum_tier_id: Option<i64>,
    pub requires_approval: Option<bool>,
    pub is_active: Option<bool>,
    #[validate(range(min = 0))]
    pub inventory_count: Option<i32>,
    pub valid_from: Option<NaiveDate>,
    pub valid_to: Option<NaiveDate>,
    #[validate(length(max = 2000))]
    pub terms_conditions: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct RedeemRewardInput {
    pub booking_id: Option<i64>,
    #[validate(length(max = 500))]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct RejectRedemptionInput {
    #[validate(length(
        min = 5,
        max = 500,
        message = "Rejection reason must be 5-500 characters"
    ))]
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct PaymentAwardCandidate {
    pub booking_id: i64,
    pub guest_id: i64,
    pub payment_id: i64,
    pub invoice_id: Option<i64>,
    pub amount: f64,
    pub nights: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoyaltyAwardResult {
    pub payment_id: i64,
    pub member_id: Option<i64>,
    pub points_awarded: i32,
    pub skipped_reason: Option<String>,
}
