use super::models::*;
use super::repository::{LoyaltyRepository, NewTransaction};
use super::validation;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use validator::Validate;

pub async fn resolve_user_guest(
    pool: &DbPool,
    user_id: i64,
) -> Result<LoyaltyGuestProfile, ApiError> {
    LoyaltyRepository::find_guest_for_user(pool, user_id)
        .await?
        .ok_or_else(|| {
            ApiError::NotFound("No guest profile is linked to the current account.".to_string())
        })
}

pub async fn me(pool: &DbPool, user_id: i64) -> Result<LoyaltyMeResponse, ApiError> {
    let profile = resolve_user_guest(pool, user_id).await?;
    let member = LoyaltyRepository::member_by_guest(pool, profile.guest_id).await?;

    if let Some(member) = member {
        let tier_progress = tier_progress(pool, &member).await?;
        let recent_activity =
            LoyaltyRepository::transactions_for_member(pool, member.id, 20).await?;
        let redemptions = LoyaltyRepository::redemptions_for_member(pool, member.id).await?;
        Ok(LoyaltyMeResponse {
            enrolled: true,
            profile,
            member: Some(member),
            tier_progress: Some(tier_progress),
            recent_activity,
            redemptions,
        })
    } else {
        Ok(LoyaltyMeResponse {
            enrolled: false,
            profile,
            member: None,
            tier_progress: None,
            recent_activity: vec![],
            redemptions: vec![],
        })
    }
}

pub async fn enroll(pool: &DbPool, user_id: i64) -> Result<LoyaltyEnrollmentResponse, ApiError> {
    let profile = resolve_user_guest(pool, user_id).await?;
    if LoyaltyRepository::member_by_guest(pool, profile.guest_id)
        .await?
        .is_some()
    {
        return Err(ApiError::Conflict(
            "This guest is already enrolled in the loyalty program.".to_string(),
        ));
    }

    let default_tier_id = LoyaltyRepository::default_tier_id(pool).await?;
    let member_number = format!("LP{:08}", profile.guest_id);
    let member =
        LoyaltyRepository::create_member(pool, profile.guest_id, &member_number, default_tier_id)
            .await?;
    let tier_progress = tier_progress(pool, &member).await?;
    Ok(LoyaltyEnrollmentResponse {
        member,
        tier_progress,
    })
}

pub async fn ensure_member_for_guest(
    pool: &DbPool,
    guest_id: i64,
) -> Result<LoyaltyMemberSummary, ApiError> {
    if let Some(member) = LoyaltyRepository::member_by_guest(pool, guest_id).await? {
        return Ok(member);
    }

    let default_tier_id = LoyaltyRepository::default_tier_id(pool).await?;
    let member_number = format!("LP{:08}", guest_id);
    LoyaltyRepository::create_member(pool, guest_id, &member_number, default_tier_id).await
}

pub async fn activity(pool: &DbPool, user_id: i64) -> Result<Vec<LoyaltyTransaction>, ApiError> {
    let profile = resolve_user_guest(pool, user_id).await?;
    let member = active_member_for_guest(pool, profile.guest_id).await?;
    LoyaltyRepository::transactions_for_member(pool, member.id, 100).await
}

pub async fn rewards(
    pool: &DbPool,
    user_id: Option<i64>,
    query: LoyaltyRewardQuery,
) -> Result<Vec<LoyaltyReward>, ApiError> {
    let rewards = LoyaltyRepository::list_rewards(pool, &query).await?;
    let Some(user_id) = user_id else {
        return Ok(rewards);
    };
    let Ok(profile) = resolve_user_guest(pool, user_id).await else {
        return Ok(rewards);
    };
    let Some(member) = LoyaltyRepository::member_by_guest(pool, profile.guest_id).await? else {
        return Ok(rewards);
    };

    Ok(rewards
        .into_iter()
        .filter(|reward| {
            reward
                .minimum_tier_id
                .is_none_or(|tier_id| tier_id <= member.tier_id)
        })
        .collect())
}

pub async fn redeem_reward(
    pool: &DbPool,
    user_id: i64,
    reward_id: i64,
    input: RedeemRewardInput,
) -> Result<LoyaltyRedemption, ApiError> {
    input
        .validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let profile = resolve_user_guest(pool, user_id).await?;
    let member = active_member_for_guest(pool, profile.guest_id).await?;
    ensure_member_can_redeem(&member)?;

    let reward = LoyaltyRepository::find_reward(pool, reward_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Reward not found.".to_string()))?;
    validate_reward_redeemable(&reward)?;
    if reward
        .minimum_tier_id
        .is_some_and(|tier_id| tier_id > member.tier_id)
    {
        return Err(ApiError::BadRequest(
            "This reward requires a higher loyalty tier.".to_string(),
        ));
    }
    if member.available_points < reward.points_cost {
        return Err(ApiError::BadRequest(format!(
            "Insufficient points. Required: {}, available: {}.",
            reward.points_cost, member.available_points
        )));
    }

    let rules = LoyaltyRepository::get_rules(pool).await?;
    let requires_approval = reward.requires_approval || rules.redemption_approval_required;
    let status = if requires_approval {
        "pending"
    } else {
        "approved"
    };

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let transaction = LoyaltyRepository::insert_transaction(
        &mut tx,
        NewTransaction {
            member_id: member.id,
            account_id: member.account_id,
            transaction_type: "redeemed",
            points_delta: -reward.points_cost,
            available_delta: -reward.points_cost,
            source_type: Some("reward"),
            source_id: Some(reward.id),
            booking_id: input.booking_id,
            payment_id: None,
            invoice_id: None,
            related_transaction_id: None,
            description: Some(&format!("Redeemed reward: {}", reward.name)),
            metadata: Some(serde_json::json!({
                "reward_name": reward.name,
                "requires_approval": requires_approval,
            })),
            actor_user_id: Some(user_id),
        },
    )
    .await?;

    let redemption_id = LoyaltyRepository::insert_redemption(
        &mut tx,
        member.id,
        reward.id,
        transaction.id,
        reward.points_cost,
        status,
        input.notes.as_deref(),
    )
    .await?;
    if reward.inventory_count.is_some() {
        LoyaltyRepository::decrement_reward_inventory(&mut tx, reward.id).await?;
    }
    tx.commit().await.map_err(ApiError::from)?;

    LoyaltyRepository::find_redemption(pool, redemption_id)
        .await?
        .ok_or_else(|| ApiError::Internal("Created redemption was not found.".to_string()))
}

pub async fn admin_members(
    pool: &DbPool,
    query: LoyaltyMemberQuery,
) -> Result<Vec<LoyaltyMemberSummary>, ApiError> {
    if let Some(status) = query.status.as_deref()
        && !status.trim().is_empty()
    {
        validation::validate_membership_status(status)?;
    }
    LoyaltyRepository::list_members(pool, &query).await
}

pub async fn admin_member_detail(
    pool: &DbPool,
    member_id: i64,
) -> Result<LoyaltyMemberDetail, ApiError> {
    let member = LoyaltyRepository::member_by_id(pool, member_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Loyalty member not found.".to_string()))?;
    let tier_progress = tier_progress(pool, &member).await?;
    let recent_activity = LoyaltyRepository::transactions_for_member(pool, member.id, 100).await?;
    let redemptions = LoyaltyRepository::redemptions_for_member(pool, member.id).await?;
    Ok(LoyaltyMemberDetail {
        member,
        tier_progress,
        recent_activity,
        redemptions,
    })
}

pub async fn manual_adjustment(
    pool: &DbPool,
    actor_user_id: i64,
    member_id: i64,
    input: ManualAdjustmentInput,
) -> Result<LoyaltyTransaction, ApiError> {
    input
        .validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    validation::validate_transaction_type("adjusted")?;
    if input.points_delta == 0 {
        return Err(ApiError::BadRequest(
            "Adjustment points cannot be zero.".to_string(),
        ));
    }
    let member = LoyaltyRepository::member_by_id(pool, member_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Loyalty member not found.".to_string()))?;
    if input.points_delta < 0
        && !input.allow_negative_balance.unwrap_or(false)
        && member.available_points + input.points_delta < 0
    {
        return Err(ApiError::BadRequest(
            "Negative adjustment cannot exceed available balance.".to_string(),
        ));
    }

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let transaction = LoyaltyRepository::insert_transaction(
        &mut tx,
        NewTransaction {
            member_id: member.id,
            account_id: member.account_id,
            transaction_type: "adjusted",
            points_delta: input.points_delta,
            available_delta: input.points_delta,
            source_type: Some("manual_adjustment"),
            source_id: Some(actor_user_id),
            booking_id: None,
            payment_id: None,
            invoice_id: None,
            related_transaction_id: None,
            description: Some(&input.reason),
            metadata: Some(serde_json::json!({
                "reason": input.reason,
                "allow_negative_balance": input.allow_negative_balance.unwrap_or(false),
            })),
            actor_user_id: Some(actor_user_id),
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    Ok(transaction)
}

pub async fn get_rules(pool: &DbPool) -> Result<LoyaltyProgramRules, ApiError> {
    LoyaltyRepository::get_rules(pool).await
}

pub async fn update_rules(
    pool: &DbPool,
    input: LoyaltyRulesInput,
) -> Result<LoyaltyProgramRules, ApiError> {
    input
        .validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    validation::validate_rules(&input)?;
    LoyaltyRepository::update_rules(pool, &input).await
}

pub async fn create_reward(pool: &DbPool, input: RewardInput) -> Result<LoyaltyReward, ApiError> {
    input
        .validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    validation::validate_reward_input(&input)?;
    LoyaltyRepository::create_reward(pool, &input).await
}

pub async fn update_reward(
    pool: &DbPool,
    reward_id: i64,
    input: RewardUpdateInput,
) -> Result<LoyaltyReward, ApiError> {
    input
        .validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    validation::validate_reward_update(&input)?;
    let existing = LoyaltyRepository::find_reward(pool, reward_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Reward not found.".to_string()))?;
    LoyaltyRepository::update_reward(pool, reward_id, &input, &existing).await
}

pub async fn redemptions(
    pool: &DbPool,
    query: LoyaltyRedemptionQuery,
) -> Result<Vec<LoyaltyRedemption>, ApiError> {
    if let Some(status) = query.status.as_deref()
        && !status.trim().is_empty()
    {
        validation::validate_redemption_status(status)?;
    }
    LoyaltyRepository::list_redemptions(pool, &query).await
}

pub async fn approve_redemption(
    pool: &DbPool,
    actor_user_id: i64,
    redemption_id: i64,
) -> Result<LoyaltyRedemption, ApiError> {
    let existing = LoyaltyRepository::find_redemption(pool, redemption_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Redemption not found.".to_string()))?;
    if existing.status != "pending" {
        return Err(ApiError::BadRequest(
            "Only pending redemptions can be approved.".to_string(),
        ));
    }
    LoyaltyRepository::approve_redemption(pool, redemption_id, actor_user_id).await
}

pub async fn reject_redemption(
    pool: &DbPool,
    actor_user_id: i64,
    redemption_id: i64,
    input: RejectRedemptionInput,
) -> Result<LoyaltyRedemption, ApiError> {
    input
        .validate()
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let existing = LoyaltyRepository::find_redemption(pool, redemption_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Redemption not found.".to_string()))?;
    if existing.status != "pending" {
        return Err(ApiError::BadRequest(
            "Only pending redemptions can be rejected.".to_string(),
        ));
    }
    let transaction_id = existing
        .transaction_id
        .ok_or_else(|| ApiError::Internal("Redemption has no points transaction.".to_string()))?;
    let member = LoyaltyRepository::member_by_id(pool, existing.member_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Loyalty member not found.".to_string()))?;

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    LoyaltyRepository::reject_redemption_status(
        &mut tx,
        redemption_id,
        actor_user_id,
        &input.reason,
    )
    .await?;
    LoyaltyRepository::insert_transaction(
        &mut tx,
        NewTransaction {
            member_id: member.id,
            account_id: member.account_id,
            transaction_type: "reversed",
            points_delta: existing.points_spent,
            available_delta: existing.points_spent,
            source_type: Some("redemption_rejection"),
            source_id: Some(redemption_id),
            booking_id: None,
            payment_id: None,
            invoice_id: None,
            related_transaction_id: Some(transaction_id),
            description: Some(&format!("Rejected redemption: {}", input.reason)),
            metadata: Some(serde_json::json!({ "reason": input.reason })),
            actor_user_id: Some(actor_user_id),
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;

    LoyaltyRepository::find_redemption(pool, redemption_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Redemption not found.".to_string()))
}

pub async fn award_eligible_booking_points(
    pool: &DbPool,
    booking_id: i64,
    payment_id: Option<i64>,
    actor_user_id: Option<i64>,
) -> Result<Vec<LoyaltyAwardResult>, ApiError> {
    let rules = LoyaltyRepository::get_rules(pool).await?;
    if !rules.earning_enabled {
        return Ok(vec![]);
    }

    let candidates =
        LoyaltyRepository::payment_award_candidates(pool, Some(booking_id), payment_id).await?;
    let mut results = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        results.push(award_payment_candidate(pool, &rules, candidate, actor_user_id).await?);
    }
    Ok(results)
}

pub async fn reverse_booking_points(
    pool: &DbPool,
    booking_id: i64,
    actor_user_id: Option<i64>,
    reason: &str,
) -> Result<Vec<LoyaltyTransaction>, ApiError> {
    let transactions =
        LoyaltyRepository::reversible_earned_transactions_for_booking(pool, booking_id).await?;
    let mut reversed = Vec::with_capacity(transactions.len());
    for transaction in transactions {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;
        let reversal = LoyaltyRepository::insert_transaction(
            &mut tx,
            NewTransaction {
                member_id: transaction.member_id,
                account_id: transaction.account_id,
                transaction_type: "reversed",
                points_delta: -transaction.points_delta,
                available_delta: -transaction.available_delta,
                source_type: Some("booking_reversal"),
                source_id: Some(booking_id),
                booking_id: Some(booking_id),
                payment_id: transaction.payment_id,
                invoice_id: transaction.invoice_id,
                related_transaction_id: Some(transaction.id),
                description: Some(reason),
                metadata: Some(serde_json::json!({ "reason": reason })),
                actor_user_id,
            },
        )
        .await?;
        tx.commit().await.map_err(ApiError::from)?;
        reversed.push(reversal);
    }
    Ok(reversed)
}

async fn active_member_for_guest(
    pool: &DbPool,
    guest_id: i64,
) -> Result<LoyaltyMemberSummary, ApiError> {
    let member = LoyaltyRepository::member_by_guest(pool, guest_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("No loyalty membership found.".to_string()))?;
    if member.status != "active" {
        return Err(ApiError::BadRequest(format!(
            "Loyalty membership is {}.",
            member.status
        )));
    }
    Ok(member)
}

fn ensure_member_can_redeem(member: &LoyaltyMemberSummary) -> Result<(), ApiError> {
    if member.status != "active" {
        return Err(ApiError::BadRequest(
            "Suspended or closed members cannot redeem rewards.".to_string(),
        ));
    }
    Ok(())
}

fn validate_reward_redeemable(reward: &LoyaltyReward) -> Result<(), ApiError> {
    if !reward.is_active {
        return Err(ApiError::BadRequest("Reward is inactive.".to_string()));
    }
    if reward.inventory_count.is_some_and(|count| count <= 0) {
        return Err(ApiError::BadRequest("Reward is out of stock.".to_string()));
    }
    let today = chrono::Utc::now().date_naive();
    if reward.valid_from.is_some_and(|start| start > today) {
        return Err(ApiError::BadRequest(
            "Reward is not available yet.".to_string(),
        ));
    }
    if reward.valid_to.is_some_and(|end| end < today) {
        return Err(ApiError::BadRequest("Reward has expired.".to_string()));
    }
    Ok(())
}

async fn award_payment_candidate(
    pool: &DbPool,
    rules: &LoyaltyProgramRules,
    candidate: PaymentAwardCandidate,
    actor_user_id: Option<i64>,
) -> Result<LoyaltyAwardResult, ApiError> {
    if candidate.amount < rules.min_eligible_amount {
        return Ok(LoyaltyAwardResult {
            payment_id: candidate.payment_id,
            member_id: None,
            points_awarded: 0,
            skipped_reason: Some("Payment is below the minimum eligible amount.".to_string()),
        });
    }
    let Some(member) = LoyaltyRepository::member_by_guest(pool, candidate.guest_id).await? else {
        return Ok(LoyaltyAwardResult {
            payment_id: candidate.payment_id,
            member_id: None,
            points_awarded: 0,
            skipped_reason: Some("Guest is not enrolled in loyalty.".to_string()),
        });
    };
    if member.status != "active" {
        return Ok(LoyaltyAwardResult {
            payment_id: candidate.payment_id,
            member_id: Some(member.id),
            points_awarded: 0,
            skipped_reason: Some(format!("Member is {}.", member.status)),
        });
    }
    if LoyaltyRepository::has_source_transaction(
        pool,
        member.id,
        "payment",
        candidate.payment_id,
        "earned",
    )
    .await?
    {
        return Ok(LoyaltyAwardResult {
            payment_id: candidate.payment_id,
            member_id: Some(member.id),
            points_awarded: 0,
            skipped_reason: Some("Points already awarded for this payment.".to_string()),
        });
    }

    let points = (candidate.amount * rules.points_per_currency_unit).floor() as i32;
    if points <= 0 {
        return Ok(LoyaltyAwardResult {
            payment_id: candidate.payment_id,
            member_id: Some(member.id),
            points_awarded: 0,
            skipped_reason: Some("Eligible payment produced zero points.".to_string()),
        });
    }

    let prior_booking_awards =
        LoyaltyRepository::earned_booking_transaction_count(pool, member.id, candidate.booking_id)
            .await?;
    let nights_increment = if prior_booking_awards == 0 {
        candidate.nights
    } else {
        0
    };

    let metric_value_after = match rules.tier_qualification_metric.as_str() {
        "nights" => (member.qualifying_nights + nights_increment) as f64,
        "spend" => member.qualifying_spend + candidate.amount,
        _ => (member.qualifying_points + points) as f64,
    };
    let new_tier = LoyaltyRepository::best_tier_for_metric(
        pool,
        &rules.tier_qualification_metric,
        metric_value_after,
    )
    .await?;

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let transaction = LoyaltyRepository::insert_transaction(
        &mut tx,
        NewTransaction {
            member_id: member.id,
            account_id: member.account_id,
            transaction_type: "earned",
            points_delta: points,
            available_delta: points,
            source_type: Some("payment"),
            source_id: Some(candidate.payment_id),
            booking_id: Some(candidate.booking_id),
            payment_id: Some(candidate.payment_id),
            invoice_id: candidate.invoice_id,
            related_transaction_id: None,
            description: Some("Points earned from eligible stay payment"),
            metadata: Some(serde_json::json!({
                "amount": candidate.amount,
                "nights_increment": nights_increment,
                "tier_metric": rules.tier_qualification_metric,
            })),
            actor_user_id,
        },
    )
    .await?;
    LoyaltyRepository::update_account_earning(
        &mut tx,
        member.account_id,
        points,
        candidate.amount,
        nights_increment,
        new_tier.id,
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;

    Ok(LoyaltyAwardResult {
        payment_id: candidate.payment_id,
        member_id: Some(member.id),
        points_awarded: transaction.points_delta,
        skipped_reason: None,
    })
}

fn metric_value(member: &LoyaltyMemberSummary, metric: &str) -> f64 {
    match metric {
        "nights" => member.qualifying_nights as f64,
        "spend" => member.qualifying_spend,
        _ => member.qualifying_points as f64,
    }
}

fn tier_minimum(tier: &LoyaltyTier, metric: &str) -> f64 {
    match metric {
        "nights" => tier.min_nights as f64,
        "spend" => tier.min_spend,
        _ => tier.min_points as f64,
    }
}

async fn tier_progress(
    pool: &DbPool,
    member: &LoyaltyMemberSummary,
) -> Result<TierProgress, ApiError> {
    let rules = LoyaltyRepository::get_rules(pool).await?;
    let current_value = metric_value(member, &rules.tier_qualification_metric);
    let current_tier = LoyaltyRepository::tier_by_id(pool, member.tier_id)
        .await?
        .ok_or_else(|| ApiError::Internal("Current loyalty tier is missing.".to_string()))?;
    let next_tier = LoyaltyRepository::next_tier_for_metric(
        pool,
        &rules.tier_qualification_metric,
        current_value,
    )
    .await?;
    let current_minimum = tier_minimum(&current_tier, &rules.tier_qualification_metric);
    let next_minimum = next_tier
        .as_ref()
        .map(|tier| tier_minimum(tier, &rules.tier_qualification_metric));
    let remaining = next_minimum.map(|min| (min - current_value).max(0.0));
    let progress_percent = if let Some(next) = next_minimum {
        let span = (next - current_minimum).max(1.0);
        (((current_value - current_minimum).max(0.0) / span) * 100.0).clamp(0.0, 100.0)
    } else {
        100.0
    };

    Ok(TierProgress {
        metric: rules.tier_qualification_metric,
        current_value,
        current_tier_minimum: current_minimum,
        next_tier_id: next_tier.as_ref().map(|tier| tier.id),
        next_tier_name: next_tier.as_ref().map(|tier| tier.name.clone()),
        next_tier_minimum: next_minimum,
        remaining_to_next_tier: remaining,
        progress_percent,
    })
}
