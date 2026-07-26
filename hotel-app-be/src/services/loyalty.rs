//! Loyalty program business logic.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    AddPointsInput, LoyaltyMembershipWithDetails, LoyaltyProgram, LoyaltyReward, LoyaltyStatistics,
    PointsTransaction, RedeemRewardInput, RewardInput, RewardRedemptionResponse,
    RewardRedemptionWithDetails, RewardUpdateInput, RewardUpdateValues, TierInfo,
    UserLoyaltyMembership,
};
use crate::repositories::loyalty::{LoyaltyRepository, RewardRedemptionParams};
use rust_decimal::Decimal;

const VALID_REWARD_CATEGORIES: [&str; 7] = [
    "room_upgrade",
    "service",
    "discount",
    "gift",
    "dining",
    "spa",
    "experience",
];

/// Resolve a user account to their linked guest ID via email matching.
///
/// The portal links a user account to a guest profile by matching email.
/// Returns `NotFound` if the user or the guest profile doesn't exist.
pub async fn resolve_user_to_guest(pool: &DbPool, user_id: i64) -> Result<i64, ApiError> {
    let email = LoyaltyRepository::find_user_email(pool, user_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    LoyaltyRepository::find_guest_id_by_email(pool, &email)
        .await?
        .ok_or_else(|| {
            ApiError::NotFound(
                "Guest profile not found. Please contact support to enroll in the loyalty programme."
                    .to_string(),
            )
        })
}

pub async fn list_programs(pool: &DbPool) -> Result<Vec<LoyaltyProgram>, ApiError> {
    LoyaltyRepository::list_active_programs(pool).await
}

pub async fn list_memberships(
    pool: &DbPool,
) -> Result<Vec<LoyaltyMembershipWithDetails>, ApiError> {
    LoyaltyRepository::list_active_memberships(pool).await
}

pub async fn statistics(pool: &DbPool) -> Result<LoyaltyStatistics, ApiError> {
    let (total_members, active_members) = LoyaltyRepository::member_counts(pool).await?;
    let members_by_tier = LoyaltyRepository::tier_statistics(pool).await?;
    let (total_points_issued, total_points_active, average_points_per_member) =
        LoyaltyRepository::points_totals(pool).await?;
    let top_members = LoyaltyRepository::top_members(pool).await?;
    let recent_transactions = LoyaltyRepository::recent_transactions(pool).await?;
    let membership_growth = LoyaltyRepository::membership_growth(pool).await?;
    let points_activity = LoyaltyRepository::points_activity(pool).await?;

    Ok(LoyaltyStatistics {
        total_members,
        active_members,
        members_by_tier,
        total_points_issued,
        total_points_redeemed: total_points_issued - total_points_active,
        total_points_active,
        average_points_per_member,
        top_members,
        recent_transactions,
        membership_growth,
        points_activity,
    })
}

/// Add or deduct points on a membership, recording a points transaction.
///
/// `points` must be positive. `is_earn` controls whether lifetime_points is
/// incremented (true) or not (false). The operation runs in its own transaction.
pub async fn adjust_membership_points(
    pool: &DbPool,
    membership_id: i64,
    points: i32,
    is_earn: bool,
    description: Option<String>,
) -> Result<PointsTransaction, ApiError> {
    if points <= 0 {
        return Err(ApiError::BadRequest("Points must be positive".to_string()));
    }

    let membership = LoyaltyRepository::find_membership_by_id(pool, membership_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Membership not found".to_string()))?;

    let new_balance = if is_earn {
        membership.points_balance + points
    } else {
        if membership.points_balance < points {
            return Err(ApiError::BadRequest(
                "Insufficient points balance".to_string(),
            ));
        }
        membership.points_balance - points
    };

    LoyaltyRepository::record_points_adjustment(
        pool,
        membership_id,
        points,
        new_balance,
        is_earn,
        description,
    )
    .await
}

pub async fn add_points(
    pool: &DbPool,
    membership_id: i64,
    input: AddPointsInput,
) -> Result<PointsTransaction, ApiError> {
    adjust_membership_points(pool, membership_id, input.points, true, input.description).await
}

pub async fn redeem_points(
    pool: &DbPool,
    membership_id: i64,
    input: AddPointsInput,
) -> Result<PointsTransaction, ApiError> {
    adjust_membership_points(pool, membership_id, input.points, false, input.description).await
}

pub async fn user_membership(
    pool: &DbPool,
    user_id: i64,
) -> Result<UserLoyaltyMembership, ApiError> {
    let guest_id = resolve_user_to_guest(pool, user_id).await?;

    let membership = LoyaltyRepository::find_active_membership_by_guest_id(pool, guest_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("No active loyalty membership found".to_string()))?;

    let current_program =
        LoyaltyRepository::find_program_by_id(pool, membership.program_id).await?;
    let next_tier =
        LoyaltyRepository::find_next_active_program_by_tier(pool, membership.tier_level + 1)
            .await?;
    let current_tier_benefits =
        LoyaltyRepository::program_benefits(pool, membership.program_id).await?;
    let recent_transactions =
        LoyaltyRepository::transactions_for_membership(pool, membership.id, 10).await?;

    let next_tier = next_tier.map(|tier| TierInfo {
        tier_level: tier.tier_level,
        tier_name: tier.name,
        minimum_points: tier.minimum_points_required,
        benefits: vec![],
        points_multiplier: tier.points_multiplier,
    });

    let points_to_next_tier = next_tier
        .as_ref()
        .map(|tier| (tier.minimum_points - membership.lifetime_points).max(0));

    Ok(UserLoyaltyMembership {
        id: membership.id,
        membership_number: membership.membership_number,
        points_balance: membership.points_balance,
        lifetime_points: membership.lifetime_points,
        tier_level: membership.tier_level,
        tier_name: current_program.name,
        status: membership.status,
        enrolled_date: membership.enrolled_date,
        expiry_date: membership.expiry_date,
        next_tier,
        current_tier_benefits,
        points_to_next_tier,
        recent_transactions,
    })
}

pub async fn rewards_for_user(pool: &DbPool, user_id: i64) -> Result<Vec<LoyaltyReward>, ApiError> {
    let tier_level = match resolve_user_to_guest(pool, user_id).await {
        Ok(guest_id) => LoyaltyRepository::active_tier_level_by_guest(pool, guest_id)
            .await?
            .unwrap_or(1),
        Err(_) => 1,
    };

    LoyaltyRepository::available_rewards_for_tier(pool, tier_level).await
}

pub async fn redeem_reward(
    pool: &DbPool,
    user_id: i64,
    input: RedeemRewardInput,
) -> Result<RewardRedemptionResponse, ApiError> {
    let guest_id = resolve_user_to_guest(pool, user_id).await?;

    LoyaltyRepository::redeem_reward_for_guest(
        pool,
        RewardRedemptionParams {
            guest_id,
            reward_id: input.reward_id,
            booking_id: input.booking_id,
            notes: input.notes,
            reward_not_found_message: "Reward not found",
            use_detailed_points_error: false,
            touch_reward_updated_at: false,
        },
    )
    .await
}

pub async fn list_rewards(
    pool: &DbPool,
    category: Option<&str>,
) -> Result<Vec<LoyaltyReward>, ApiError> {
    LoyaltyRepository::list_rewards(pool, category).await
}

pub async fn get_reward(pool: &DbPool, reward_id: i64) -> Result<LoyaltyReward, ApiError> {
    LoyaltyRepository::find_reward_by_id(pool, reward_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Reward not found".to_string()))
}

pub async fn create_reward(pool: &DbPool, input: RewardInput) -> Result<LoyaltyReward, ApiError> {
    validate_reward_input(&input)?;
    let monetary_value = input.monetary_value.map(decimal_from_f64);
    LoyaltyRepository::create_reward(pool, &input, monetary_value).await
}

pub async fn update_reward(
    pool: &DbPool,
    reward_id: i64,
    input: RewardUpdateInput,
) -> Result<LoyaltyReward, ApiError> {
    let existing = get_reward(pool, reward_id).await?;
    validate_reward_update(&input)?;

    let values = RewardUpdateValues {
        name: input.name.unwrap_or(existing.name),
        description: input.description.or(existing.description),
        category: input.category.unwrap_or(existing.category),
        points_cost: input.points_cost.unwrap_or(existing.points_cost),
        monetary_value: if let Some(value) = input.monetary_value {
            Some(decimal_from_f64(value))
        } else {
            existing.monetary_value
        },
        minimum_tier_level: input
            .minimum_tier_level
            .unwrap_or(existing.minimum_tier_level),
        is_active: input.is_active.unwrap_or(existing.is_active),
        stock_quantity: if input.stock_quantity.is_some() {
            input.stock_quantity
        } else {
            existing.stock_quantity
        },
        image_url: input.image_url.or(existing.image_url),
        terms_conditions: input.terms_conditions.or(existing.terms_conditions),
    };

    LoyaltyRepository::update_reward(pool, reward_id, &values).await
}

pub async fn delete_reward(pool: &DbPool, reward_id: i64) -> Result<(), ApiError> {
    if LoyaltyRepository::deactivate_reward(pool, reward_id).await? {
        Ok(())
    } else {
        Err(ApiError::NotFound("Reward not found".to_string()))
    }
}

pub async fn reward_redemptions(
    pool: &DbPool,
) -> Result<Vec<RewardRedemptionWithDetails>, ApiError> {
    LoyaltyRepository::reward_redemptions(pool).await
}

pub async fn redeem_reward_by_id(
    pool: &DbPool,
    user_id: i64,
    reward_id: i64,
    input: RedeemRewardInput,
) -> Result<RewardRedemptionResponse, ApiError> {
    let guest_id = resolve_user_to_guest(pool, user_id).await?;

    LoyaltyRepository::redeem_reward_for_guest(
        pool,
        RewardRedemptionParams {
            guest_id,
            reward_id,
            booking_id: input.booking_id,
            notes: input.notes,
            reward_not_found_message: "Reward not found or inactive",
            use_detailed_points_error: true,
            touch_reward_updated_at: true,
        },
    )
    .await
}

fn validate_reward_input(input: &RewardInput) -> Result<(), ApiError> {
    validate_category(&input.category)?;
    validate_tier_level(input.minimum_tier_level)?;
    validate_points_cost(input.points_cost)
}

fn validate_reward_update(input: &RewardUpdateInput) -> Result<(), ApiError> {
    if let Some(category) = &input.category {
        validate_category(category)?;
    }

    if let Some(tier_level) = input.minimum_tier_level {
        validate_tier_level(tier_level)?;
    }

    if let Some(points_cost) = input.points_cost {
        validate_points_cost(points_cost)?;
    }

    Ok(())
}

fn validate_category(category: &str) -> Result<(), ApiError> {
    if VALID_REWARD_CATEGORIES.contains(&category) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid category. Must be one of: {}",
            VALID_REWARD_CATEGORIES.join(", ")
        )))
    }
}

fn validate_tier_level(tier_level: i32) -> Result<(), ApiError> {
    if (1..=4).contains(&tier_level) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "Minimum tier level must be between 1 and 4".to_string(),
        ))
    }
}

fn validate_points_cost(points_cost: i32) -> Result<(), ApiError> {
    if points_cost > 0 {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "Points cost must be greater than 0".to_string(),
        ))
    }
}

fn decimal_from_f64(value: f64) -> Decimal {
    Decimal::from_f64_retain(value).unwrap_or_default()
}
