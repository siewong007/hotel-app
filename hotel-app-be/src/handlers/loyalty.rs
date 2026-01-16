//! Loyalty program handlers
//!
//! Handles loyalty programs, memberships, points, and rewards.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::models::row_mappers;
use axum::{
    extract::{Extension, Path, Query, State},
    response::Json,
};
use rust_decimal::Decimal;
use sqlx::Row;
use std::collections::HashMap;

// =============================================================================
// Row mappers for models with Decimal fields
// =============================================================================

fn row_to_loyalty_program(row: &crate::core::db::DbRow) -> LoyaltyProgram {
    LoyaltyProgram {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        description: row.try_get("description").ok(),
        tier_level: row.try_get("tier_level").unwrap_or_default(),
        points_multiplier: row_mappers::get_decimal(row, "points_multiplier"),
        minimum_points_required: row.try_get("minimum_points_required").unwrap_or_default(),
        is_active: row_mappers::get_bool(row, "is_active"),
        created_at: row.try_get("created_at").unwrap_or_else(|_| chrono::Utc::now()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| chrono::Utc::now()),
    }
}

fn row_to_loyalty_membership_with_details(row: &crate::core::db::DbRow) -> LoyaltyMembershipWithDetails {
    LoyaltyMembershipWithDetails {
        id: row.try_get("id").unwrap_or_default(),
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        guest_name: row.try_get("guest_name").unwrap_or_default(),
        guest_email: row.try_get("guest_email").unwrap_or_default(),
        program_id: row.try_get("program_id").unwrap_or_default(),
        program_name: row.try_get("program_name").unwrap_or_default(),
        program_description: row.try_get("program_description").ok(),
        membership_number: row.try_get("membership_number").unwrap_or_default(),
        points_balance: row.try_get("points_balance").unwrap_or_default(),
        lifetime_points: row.try_get("lifetime_points").unwrap_or_default(),
        tier_level: row.try_get("tier_level").unwrap_or_default(),
        points_multiplier: row_mappers::get_decimal(row, "points_multiplier"),
        status: row.try_get("status").unwrap_or_default(),
        enrolled_date: row.try_get("enrolled_date").unwrap_or_else(|_| chrono::NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
    }
}

fn row_to_points_transaction(row: &crate::core::db::DbRow) -> PointsTransaction {
    PointsTransaction {
        id: row.try_get("id").unwrap_or_default(),
        membership_id: row.try_get("membership_id").unwrap_or_default(),
        transaction_type: row.try_get("transaction_type").unwrap_or_default(),
        points_amount: row.try_get("points_amount").unwrap_or_default(),
        balance_after: row.try_get("balance_after").unwrap_or_default(),
        reference_type: row.try_get("reference_type").ok(),
        reference_id: row.try_get("reference_id").ok(),
        description: row.try_get("description").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| chrono::Utc::now()),
    }
}

pub async fn get_loyalty_programs_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<LoyaltyProgram>>, ApiError> {
    let programs = sqlx::query_as::<_, LoyaltyProgram>(
        "SELECT * FROM loyalty_programs WHERE is_active = true ORDER BY tier_level"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(programs))
}

pub async fn get_loyalty_memberships_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<LoyaltyMembershipWithDetails>>, ApiError> {
    let memberships = sqlx::query_as::<_, LoyaltyMembershipWithDetails>(
        r#"
        SELECT
            lm.id,
            lm.guest_id,
            g.full_name as guest_name,
            g.email as guest_email,
            lm.program_id,
            lp.name as program_name,
            lp.description as program_description,
            lm.membership_number,
            lm.points_balance,
            lm.lifetime_points,
            lm.tier_level,
            lp.points_multiplier,
            lm.status,
            lm.enrolled_date
        FROM loyalty_memberships lm
        JOIN guests g ON lm.guest_id = g.id
        JOIN loyalty_programs lp ON lm.program_id = lp.id
        WHERE lm.status = 'active'
        ORDER BY lm.lifetime_points DESC
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(memberships))
}

pub async fn get_loyalty_statistics_handler(
    State(pool): State<DbPool>,
) -> Result<Json<LoyaltyStatistics>, ApiError> {
    // Get total and active members
    let (total_members, active_members): (i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'active') as active
        FROM loyalty_memberships
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get members by tier
    let members_by_tier = sqlx::query_as::<_, TierStatistics>(
        r#"
        SELECT
            lp.tier_level,
            lp.name as tier_name,
            COUNT(*)::bigint as count,
            ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2)::double precision as percentage
        FROM loyalty_memberships lm
        JOIN loyalty_programs lp ON lm.program_id = lp.id
        WHERE lm.status = 'active'
        GROUP BY lp.tier_level, lp.name
        ORDER BY lp.tier_level
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get points statistics
    let (total_points_issued, total_points_active, average_points): (i64, i64, f64) = sqlx::query_as(
        r#"
        SELECT
            COALESCE(SUM(lifetime_points), 0)::bigint as total_issued,
            COALESCE(SUM(points_balance), 0)::bigint as total_active,
            COALESCE(AVG(points_balance), 0.0)::double precision as avg_points
        FROM loyalty_memberships
        WHERE status = 'active'
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let total_points_redeemed = total_points_issued - total_points_active;

    // Get top members
    let top_members = sqlx::query_as::<_, TopMember>(
        r#"
        SELECT
            g.full_name as guest_name,
            g.email as guest_email,
            lm.points_balance,
            lm.lifetime_points,
            lm.tier_level,
            lm.membership_number
        FROM loyalty_memberships lm
        JOIN guests g ON lm.guest_id = g.id
        WHERE lm.status = 'active'
        ORDER BY lm.lifetime_points DESC
        LIMIT 10
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get recent transactions
    let recent_transactions = sqlx::query_as::<_, RecentTransaction>(
        r#"
        SELECT
            pt.id::text,
            g.full_name as guest_name,
            pt.transaction_type,
            pt.points_amount,
            pt.description,
            pt.created_at
        FROM points_transactions pt
        JOIN loyalty_memberships lm ON pt.membership_id = lm.id
        JOIN guests g ON lm.guest_id = g.id
        ORDER BY pt.created_at DESC
        LIMIT 20
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get membership growth (last 30 days)
    let membership_growth = sqlx::query_as::<_, MembershipGrowth>(
        r#"
        SELECT
            TO_CHAR(date_series, 'YYYY-MM-DD') as date,
            COALESCE(COUNT(lm.enrolled_date), 0)::bigint as new_members,
            (SELECT COUNT(*)::bigint FROM loyalty_memberships
             WHERE enrolled_date <= date_series) as total_members
        FROM generate_series(
            CURRENT_DATE - INTERVAL '30 days',
            CURRENT_DATE,
            INTERVAL '1 day'
        ) AS date_series
        LEFT JOIN loyalty_memberships lm ON lm.enrolled_date = date_series::date
        GROUP BY date_series
        ORDER BY date_series
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get points activity (last 30 days)
    let points_activity = sqlx::query_as::<_, PointsActivity>(
        r#"
        SELECT
            TO_CHAR(date_series, 'YYYY-MM-DD') as date,
            COALESCE(SUM(CASE WHEN transaction_type = 'earn' THEN points_amount ELSE 0 END), 0)::bigint as points_earned,
            COALESCE(SUM(CASE WHEN transaction_type = 'redeem' THEN ABS(points_amount) ELSE 0 END), 0)::bigint as points_redeemed
        FROM generate_series(
            CURRENT_DATE - INTERVAL '30 days',
            CURRENT_DATE,
            INTERVAL '1 day'
        ) AS date_series
        LEFT JOIN points_transactions pt ON DATE(pt.created_at) = date_series::date
        GROUP BY date_series
        ORDER BY date_series
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let statistics = LoyaltyStatistics {
        total_members,
        active_members,
        members_by_tier,
        total_points_issued,
        total_points_redeemed,
        total_points_active,
        average_points_per_member: average_points,
        top_members,
        recent_transactions,
        membership_growth,
        points_activity,
    };

    Ok(Json(statistics))
}

pub async fn add_points_handler(
    State(pool): State<DbPool>,
    Path(membership_id): Path<i64>,
    Json(input): Json<AddPointsInput>,
) -> Result<Json<PointsTransaction>, ApiError> {
    if input.points <= 0 {
        return Err(ApiError::BadRequest("Points must be positive".to_string()));
    }

    // Get current membership
    let membership = sqlx::query_as::<_, LoyaltyMembership>(
        "SELECT * FROM loyalty_memberships WHERE id = $1"
    )
    .bind(membership_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Membership not found".to_string()))?;

    // Calculate new balance
    let new_balance = membership.points_balance + input.points;

    // Start transaction
    let mut tx = pool.begin().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Update membership
    sqlx::query(
        r#"
        UPDATE loyalty_memberships
        SET points_balance = $1,
            lifetime_points = lifetime_points + $2,
            last_points_activity = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        "#
    )
    .bind(new_balance)
    .bind(input.points)
    .bind(membership_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create transaction record
    let transaction = sqlx::query_as::<_, PointsTransaction>(
        r#"
        INSERT INTO points_transactions (
            membership_id, transaction_type, points_amount, balance_after, description
        )
        VALUES ($1, 'earn', $2, $3, $4)
        RETURNING id::text, membership_id, transaction_type, points_amount,
                  balance_after, reference_type, reference_id, description, created_at
        "#
    )
    .bind(membership_id)
    .bind(input.points)
    .bind(new_balance)
    .bind(&input.description)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    tx.commit().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(transaction))
}

pub async fn redeem_points_handler(
    State(pool): State<DbPool>,
    Path(membership_id): Path<i64>,
    Json(input): Json<AddPointsInput>,
) -> Result<Json<PointsTransaction>, ApiError> {
    if input.points <= 0 {
        return Err(ApiError::BadRequest("Points must be positive".to_string()));
    }

    // Get current membership
    let membership = sqlx::query_as::<_, LoyaltyMembership>(
        "SELECT * FROM loyalty_memberships WHERE id = $1"
    )
    .bind(membership_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Membership not found".to_string()))?;

    // Check sufficient balance
    if membership.points_balance < input.points {
        return Err(ApiError::BadRequest("Insufficient points balance".to_string()));
    }

    // Calculate new balance
    let new_balance = membership.points_balance - input.points;

    // Start transaction
    let mut tx = pool.begin().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Update membership
    sqlx::query(
        r#"
        UPDATE loyalty_memberships
        SET points_balance = $1,
            last_points_activity = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        "#
    )
    .bind(new_balance)
    .bind(membership_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create transaction record
    let transaction = sqlx::query_as::<_, PointsTransaction>(
        r#"
        INSERT INTO points_transactions (
            membership_id, transaction_type, points_amount, balance_after, description
        )
        VALUES ($1, 'redeem', $2, $3, $4)
        RETURNING id::text, membership_id, transaction_type, points_amount,
                  balance_after, reference_type, reference_id, description, created_at
        "#
    )
    .bind(membership_id)
    .bind(-input.points)
    .bind(new_balance)
    .bind(&input.description)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    tx.commit().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(transaction))
}

// Get user's own loyalty membership with full details
pub async fn get_user_loyalty_membership_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<UserLoyaltyMembership>, ApiError> {
    // First, get the user's email
    let user_email: Option<String> = sqlx::query_scalar(
        "SELECT email FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let user_email = user_email.ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Find guest by matching email
    let guest_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM guests WHERE email = $1 AND deleted_at IS NULL"
    )
    .bind(&user_email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let guest_id = guest_id.ok_or_else(|| ApiError::NotFound("Guest profile not found. Please contact support to enroll in the loyalty programme.".to_string()))?;

    // Get the membership
    let membership = sqlx::query_as::<_, LoyaltyMembership>(
        "SELECT * FROM loyalty_memberships WHERE guest_id = $1 AND status = 'active'"
    )
    .bind(guest_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("No active loyalty membership found".to_string()))?;

    // Get current program/tier info
    let current_program = sqlx::query_as::<_, LoyaltyProgram>(
        "SELECT * FROM loyalty_programs WHERE id = $1"
    )
    .bind(membership.program_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get next tier info
    let next_tier = sqlx::query_as::<_, LoyaltyProgram>(
        "SELECT * FROM loyalty_programs WHERE tier_level = $1 AND is_active = true ORDER BY tier_level LIMIT 1"
    )
    .bind(membership.tier_level + 1)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get benefits from current program (benefits is a JSONB array)
    let benefits: Vec<String> = sqlx::query_scalar(
        "SELECT jsonb_array_elements_text(benefits) FROM loyalty_programs WHERE id = $1"
    )
    .bind(membership.program_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get recent transactions
    let recent_transactions = sqlx::query_as::<_, PointsTransaction>(
        "SELECT * FROM points_transactions WHERE membership_id = $1 ORDER BY created_at DESC LIMIT 10"
    )
    .bind(membership.id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Build next tier info
    let next_tier_info = next_tier.map(|tier| {
        let tier_benefits: Vec<String> = vec![];
        TierInfo {
            tier_level: tier.tier_level,
            tier_name: tier.name,
            minimum_points: tier.minimum_points_required,
            benefits: tier_benefits,
            points_multiplier: tier.points_multiplier,
        }
    });

    let points_to_next_tier = next_tier_info.as_ref().map(|tier| {
        (tier.minimum_points - membership.lifetime_points).max(0)
    });

    Ok(Json(UserLoyaltyMembership {
        id: membership.id,
        membership_number: membership.membership_number,
        points_balance: membership.points_balance,
        lifetime_points: membership.lifetime_points,
        tier_level: membership.tier_level,
        tier_name: current_program.name,
        status: membership.status,
        enrolled_date: membership.enrolled_date,
        expiry_date: membership.expiry_date,
        next_tier: next_tier_info,
        current_tier_benefits: benefits,
        points_to_next_tier,
        recent_transactions,
    }))
}

// Get available loyalty rewards filtered by user's tier
pub async fn get_loyalty_rewards_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<LoyaltyReward>>, ApiError> {
    // Get user's email
    let user_email: Option<String> = sqlx::query_scalar(
        "SELECT email FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let user_email = user_email.unwrap_or_default();

    // Get guest_id by matching email
    let guest_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM guests WHERE email = $1 AND deleted_at IS NULL"
    )
    .bind(&user_email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let tier_level: i32 = if let Some(gid) = guest_id {
        sqlx::query_scalar(
            "SELECT tier_level FROM loyalty_memberships WHERE guest_id = $1 AND status = 'active'"
        )
        .bind(gid)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .unwrap_or(1)
    } else {
        1
    };

    // Get rewards available for user's tier
    let rewards = sqlx::query_as::<_, LoyaltyReward>(
        r#"
        SELECT * FROM loyalty_rewards
        WHERE is_active = true
        AND minimum_tier_level <= $1
        AND (stock_quantity IS NULL OR stock_quantity > 0)
        ORDER BY category, points_cost
        "#
    )
    .bind(tier_level)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(rewards))
}

// Redeem a loyalty reward
pub async fn redeem_reward_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<RedeemRewardInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get user's email
    let user_email: Option<String> = sqlx::query_scalar(
        "SELECT email FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let user_email = user_email.ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Get guest_id by matching email
    let guest_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM guests WHERE email = $1 AND deleted_at IS NULL"
    )
    .bind(&user_email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let guest_id = guest_id.ok_or_else(|| ApiError::NotFound("Guest profile not found".to_string()))?;

    // Start transaction
    let mut tx = pool.begin().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get membership
    let membership = sqlx::query_as::<_, LoyaltyMembership>(
        "SELECT * FROM loyalty_memberships WHERE guest_id = $1 AND status = 'active' FOR UPDATE"
    )
    .bind(guest_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("No active loyalty membership found".to_string()))?;

    // Get reward
    let reward = sqlx::query_as::<_, LoyaltyReward>(
        "SELECT * FROM loyalty_rewards WHERE id = $1 AND is_active = true FOR UPDATE"
    )
    .bind(input.reward_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Reward not found".to_string()))?;

    // Check tier eligibility
    if membership.tier_level < reward.minimum_tier_level {
        return Err(ApiError::BadRequest("Your tier level is not high enough for this reward".to_string()));
    }

    // Check points balance
    if membership.points_balance < reward.points_cost {
        return Err(ApiError::BadRequest("Insufficient points balance".to_string()));
    }

    // Check stock
    if let Some(stock) = reward.stock_quantity {
        if stock <= 0 {
            return Err(ApiError::BadRequest("Reward is out of stock".to_string()));
        }
    }

    // Deduct points
    let new_balance = membership.points_balance - reward.points_cost;
    sqlx::query(
        r#"
        UPDATE loyalty_memberships
        SET points_balance = $1,
            last_points_activity = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        "#
    )
    .bind(new_balance)
    .bind(membership.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create points transaction
    let transaction: PointsTransaction = sqlx::query_as(
        r#"
        INSERT INTO points_transactions
        (membership_id, transaction_type, points_amount, balance_after, reference_type, reference_id, description)
        VALUES ($1, 'redeem', $2, $3, 'reward', $4, $5)
        RETURNING *
        "#
    )
    .bind(membership.id)
    .bind(-reward.points_cost)
    .bind(new_balance)
    .bind(reward.id)
    .bind(format!("Redeemed: {}", reward.name))
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create redemption record
    sqlx::query(
        r#"
        INSERT INTO reward_redemptions
        (membership_id, reward_id, transaction_id, booking_id, points_spent, notes, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        "#
    )
    .bind(membership.id)
    .bind(reward.id)
    .bind(&transaction.id)
    .bind(input.booking_id)
    .bind(reward.points_cost)
    .bind(input.notes)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Update stock if applicable
    if reward.stock_quantity.is_some() {
        sqlx::query(
            "UPDATE loyalty_rewards SET stock_quantity = stock_quantity - 1 WHERE id = $1"
        )
        .bind(reward.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    tx.commit().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "message": "Reward redeemed successfully",
        "points_spent": reward.points_cost,
        "new_balance": new_balance,
        "reward_name": reward.name
    })))
}

// ============================================================================
// ADMIN REWARD MANAGEMENT HANDLERS
// ============================================================================

// Get all rewards (with optional category filter)
pub async fn get_rewards_handler(
    State(pool): State<DbPool>,
    query: Query<HashMap<String, String>>,
) -> Result<Json<Vec<LoyaltyReward>>, ApiError> {
    let category = query.get("category");

    let rewards = if let Some(cat) = category {
        sqlx::query_as::<_, LoyaltyReward>(
            "SELECT * FROM loyalty_rewards WHERE category = $1 AND is_active = true ORDER BY category, points_cost"
        )
        .bind(cat)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
    } else {
        sqlx::query_as::<_, LoyaltyReward>(
            "SELECT * FROM loyalty_rewards WHERE is_active = true ORDER BY category, points_cost"
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
    };

    Ok(Json(rewards))
}

// Get single reward by ID
pub async fn get_reward_handler(
    State(pool): State<DbPool>,
    Path(reward_id): Path<i64>,
) -> Result<Json<LoyaltyReward>, ApiError> {
    let reward = sqlx::query_as::<_, LoyaltyReward>(
        "SELECT * FROM loyalty_rewards WHERE id = $1"
    )
    .bind(reward_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Reward not found".to_string()))?;

    Ok(Json(reward))
}

// Create new reward (admin only)
pub async fn create_reward_handler(
    State(pool): State<DbPool>,
    Json(input): Json<RewardInput>,
) -> Result<Json<LoyaltyReward>, ApiError> {
    // Validate category
    let valid_categories = vec!["room_upgrade", "service", "discount", "gift", "dining", "spa", "experience"];
    if !valid_categories.contains(&input.category.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid category. Must be one of: {}",
            valid_categories.join(", ")
        )));
    }

    // Validate tier level (1-4)
    if input.minimum_tier_level < 1 || input.minimum_tier_level > 4 {
        return Err(ApiError::BadRequest("Minimum tier level must be between 1 and 4".to_string()));
    }

    // Validate points cost
    if input.points_cost <= 0 {
        return Err(ApiError::BadRequest("Points cost must be greater than 0".to_string()));
    }

    let monetary_value = input.monetary_value.map(|v|
        rust_decimal::Decimal::from_f64_retain(v).unwrap_or_default()
    );

    let reward = sqlx::query_as::<_, LoyaltyReward>(
        r#"
        INSERT INTO loyalty_rewards
        (name, description, category, points_cost, monetary_value, minimum_tier_level,
         stock_quantity, image_url, terms_conditions)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        "#
    )
    .bind(&input.name)
    .bind(&input.description)
    .bind(&input.category)
    .bind(input.points_cost)
    .bind(monetary_value)
    .bind(input.minimum_tier_level)
    .bind(input.stock_quantity)
    .bind(&input.image_url)
    .bind(&input.terms_conditions)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(reward))
}

// Update reward (admin only)
pub async fn update_reward_handler(
    State(pool): State<DbPool>,
    Path(reward_id): Path<i64>,
    Json(input): Json<RewardUpdateInput>,
) -> Result<Json<LoyaltyReward>, ApiError> {
    // Check if reward exists
    let existing = sqlx::query_as::<_, LoyaltyReward>(
        "SELECT * FROM loyalty_rewards WHERE id = $1"
    )
    .bind(reward_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Reward not found".to_string()))?;

    // Validate category if provided
    if let Some(ref category) = input.category {
        let valid_categories = vec!["room_upgrade", "service", "discount", "gift", "dining", "spa", "experience"];
        if !valid_categories.contains(&category.as_str()) {
            return Err(ApiError::BadRequest(format!(
                "Invalid category. Must be one of: {}",
                valid_categories.join(", ")
            )));
        }
    }

    // Validate tier level if provided
    if let Some(tier_level) = input.minimum_tier_level {
        if tier_level < 1 || tier_level > 4 {
            return Err(ApiError::BadRequest("Minimum tier level must be between 1 and 4".to_string()));
        }
    }

    // Validate points cost if provided
    if let Some(points_cost) = input.points_cost {
        if points_cost <= 0 {
            return Err(ApiError::BadRequest("Points cost must be greater than 0".to_string()));
        }
    }

    // Use provided values or keep existing ones
    let name = input.name.as_ref().unwrap_or(&existing.name);
    let description = input.description.as_ref().or(existing.description.as_ref());
    let category = input.category.as_ref().unwrap_or(&existing.category);
    let points_cost = input.points_cost.unwrap_or(existing.points_cost);
    let monetary_value = if input.monetary_value.is_some() {
        input.monetary_value.map(|v| rust_decimal::Decimal::from_f64_retain(v).unwrap_or_default())
    } else {
        existing.monetary_value
    };
    let minimum_tier_level = input.minimum_tier_level.unwrap_or(existing.minimum_tier_level);
    let is_active = input.is_active.unwrap_or(existing.is_active);
    let stock_quantity = if input.stock_quantity.is_some() {
        input.stock_quantity
    } else {
        existing.stock_quantity
    };
    let image_url = input.image_url.as_ref().or(existing.image_url.as_ref());
    let terms_conditions = input.terms_conditions.as_ref().or(existing.terms_conditions.as_ref());

    let reward = sqlx::query_as::<_, LoyaltyReward>(
        r#"
        UPDATE loyalty_rewards
        SET name = $1,
            description = $2,
            category = $3,
            points_cost = $4,
            monetary_value = $5,
            minimum_tier_level = $6,
            is_active = $7,
            stock_quantity = $8,
            image_url = $9,
            terms_conditions = $10,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $11
        RETURNING *
        "#
    )
    .bind(name)
    .bind(description)
    .bind(category)
    .bind(points_cost)
    .bind(monetary_value)
    .bind(minimum_tier_level)
    .bind(is_active)
    .bind(stock_quantity)
    .bind(image_url)
    .bind(terms_conditions)
    .bind(reward_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(reward))
}

// Delete/deactivate reward (admin only)
pub async fn delete_reward_handler(
    State(pool): State<DbPool>,
    Path(reward_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Soft delete by setting is_active to false
    let result = sqlx::query(
        "UPDATE loyalty_rewards SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1"
    )
    .bind(reward_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Reward not found".to_string()));
    }

    Ok(Json(serde_json::json!({
        "message": "Reward deactivated successfully"
    })))
}

// Get reward redemption history (admin only)
pub async fn get_reward_redemptions_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<RewardRedemptionWithDetails>>, ApiError> {
    let redemptions = sqlx::query_as::<_, RewardRedemptionWithDetails>(
        r#"
        SELECT
            rr.id,
            rr.membership_id,
            lm.membership_number,
            g.full_name as guest_name,
            g.email as guest_email,
            rr.reward_id,
            lr.name as reward_name,
            lr.category as reward_category,
            rr.points_spent,
            rr.status,
            rr.redeemed_at,
            rr.notes,
            rr.created_at
        FROM reward_redemptions rr
        INNER JOIN loyalty_memberships lm ON rr.membership_id = lm.id
        INNER JOIN guests g ON lm.guest_id = g.id
        INNER JOIN loyalty_rewards lr ON rr.reward_id = lr.id
        ORDER BY rr.created_at DESC
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(redemptions))
}

// Redeem reward for user (user-facing endpoint with path parameter)
pub async fn redeem_reward_for_user_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(reward_id): Path<i64>,
    Json(input): Json<RedeemRewardInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get user's email
    let user_email: Option<String> = sqlx::query_scalar(
        "SELECT email FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let user_email = user_email.ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    // Get guest_id by matching email
    let guest_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM guests WHERE email = $1 AND deleted_at IS NULL"
    )
    .bind(&user_email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let guest_id = guest_id.ok_or_else(|| ApiError::NotFound("Guest profile not found".to_string()))?;

    // Start transaction
    let mut tx = pool.begin().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get membership
    let membership = sqlx::query_as::<_, LoyaltyMembership>(
        "SELECT * FROM loyalty_memberships WHERE guest_id = $1 AND status = 'active' FOR UPDATE"
    )
    .bind(guest_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("No active loyalty membership found".to_string()))?;

    // Get reward
    let reward = sqlx::query_as::<_, LoyaltyReward>(
        "SELECT * FROM loyalty_rewards WHERE id = $1 AND is_active = true FOR UPDATE"
    )
    .bind(reward_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Reward not found or inactive".to_string()))?;

    // Check tier eligibility
    if membership.tier_level < reward.minimum_tier_level {
        return Err(ApiError::BadRequest("Your tier level is not high enough for this reward".to_string()));
    }

    // Check points balance
    if membership.points_balance < reward.points_cost {
        return Err(ApiError::BadRequest(format!(
            "Insufficient points. Required: {}, Available: {}",
            reward.points_cost, membership.points_balance
        )));
    }

    // Check stock
    if let Some(stock) = reward.stock_quantity {
        if stock <= 0 {
            return Err(ApiError::BadRequest("Reward is out of stock".to_string()));
        }
    }

    // Deduct points
    let new_balance = membership.points_balance - reward.points_cost;
    sqlx::query(
        r#"
        UPDATE loyalty_memberships
        SET points_balance = $1,
            last_points_activity = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        "#
    )
    .bind(new_balance)
    .bind(membership.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create points transaction
    let transaction: PointsTransaction = sqlx::query_as(
        r#"
        INSERT INTO points_transactions
        (membership_id, transaction_type, points_amount, balance_after, reference_type, reference_id, description)
        VALUES ($1, 'redeem', $2, $3, 'reward', $4, $5)
        RETURNING *
        "#
    )
    .bind(membership.id)
    .bind(-reward.points_cost)
    .bind(new_balance)
    .bind(reward.id)
    .bind(format!("Redeemed: {}", reward.name))
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Create redemption record
    sqlx::query(
        r#"
        INSERT INTO reward_redemptions
        (membership_id, reward_id, transaction_id, booking_id, points_spent, notes, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending')
        "#
    )
    .bind(membership.id)
    .bind(reward.id)
    .bind(&transaction.id)
    .bind(input.booking_id)
    .bind(reward.points_cost)
    .bind(&input.notes)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Update stock if applicable
    if reward.stock_quantity.is_some() {
        sqlx::query(
            "UPDATE loyalty_rewards SET stock_quantity = stock_quantity - 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1"
        )
        .bind(reward.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    tx.commit().await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "message": "Reward redeemed successfully",
        "points_spent": reward.points_cost,
        "new_balance": new_balance,
        "reward_name": reward.name
    })))
}
