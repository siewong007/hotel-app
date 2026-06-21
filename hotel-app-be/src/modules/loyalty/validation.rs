use super::models::{LoyaltyRulesInput, RewardInput, RewardUpdateInput};
use crate::core::error::ApiError;

const MEMBERSHIP_STATUSES: &[&str] = &["active", "suspended", "closed"];
const REDEMPTION_STATUSES: &[&str] = &["pending", "approved", "rejected", "fulfilled", "cancelled"];
const TRANSACTION_TYPES: &[&str] = &[
    "pending", "earned", "redeemed", "expired", "adjusted", "reversed",
];
const TIER_METRICS: &[&str] = &["points", "nights", "spend"];

pub fn validate_membership_status(status: &str) -> Result<(), ApiError> {
    if MEMBERSHIP_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "Invalid loyalty member status".to_string(),
        ))
    }
}

pub fn validate_redemption_status(status: &str) -> Result<(), ApiError> {
    if REDEMPTION_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "Invalid redemption status".to_string(),
        ))
    }
}

pub fn validate_transaction_type(transaction_type: &str) -> Result<(), ApiError> {
    if TRANSACTION_TYPES.contains(&transaction_type) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "Invalid loyalty transaction type".to_string(),
        ))
    }
}

pub fn validate_rules(input: &LoyaltyRulesInput) -> Result<(), ApiError> {
    if !TIER_METRICS.contains(&input.tier_qualification_metric.as_str()) {
        return Err(ApiError::BadRequest(
            "Tier qualification metric must be points, nights, or spend".to_string(),
        ));
    }
    Ok(())
}

pub fn validate_reward_input(input: &RewardInput) -> Result<(), ApiError> {
    if input.points_cost <= 0 {
        return Err(ApiError::BadRequest(
            "Reward points cost must be positive".to_string(),
        ));
    }
    validate_reward_dates(input.valid_from, input.valid_to)
}

pub fn validate_reward_update(input: &RewardUpdateInput) -> Result<(), ApiError> {
    if let Some(points_cost) = input.points_cost
        && points_cost <= 0
    {
        return Err(ApiError::BadRequest(
            "Reward points cost must be positive".to_string(),
        ));
    }
    validate_reward_dates(input.valid_from, input.valid_to)
}

fn validate_reward_dates(
    valid_from: Option<chrono::NaiveDate>,
    valid_to: Option<chrono::NaiveDate>,
) -> Result<(), ApiError> {
    if let (Some(start), Some(end)) = (valid_from, valid_to)
        && end < start
    {
        return Err(ApiError::BadRequest(
            "Reward valid-to date cannot be before valid-from date".to_string(),
        ));
    }
    Ok(())
}
