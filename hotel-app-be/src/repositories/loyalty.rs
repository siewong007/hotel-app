//! Loyalty program repository for database operations.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    LoyaltyMembership, LoyaltyMembershipWithDetails, LoyaltyProgram, LoyaltyReward,
    MembershipGrowth, PointsActivity, PointsTransaction, RecentTransaction,
    RewardRedemptionResponse, RewardRedemptionWithDetails, RewardUpdateValues, TierStatistics,
    TopMember,
};

pub struct LoyaltyRepository;

impl LoyaltyRepository {
    pub async fn find_user_email(pool: &DbPool, user_id: i64) -> Result<Option<String>, ApiError> {
        sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn find_guest_id_by_email(
        pool: &DbPool,
        email: &str,
    ) -> Result<Option<i64>, ApiError> {
        sqlx::query_scalar("SELECT id FROM guests WHERE email = $1 AND deleted_at IS NULL")
            .bind(email)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn list_active_programs(pool: &DbPool) -> Result<Vec<LoyaltyProgram>, ApiError> {
        sqlx::query_as::<_, LoyaltyProgram>(
            "SELECT * FROM loyalty_programs WHERE is_active = true ORDER BY tier_level",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn list_active_memberships(
        pool: &DbPool,
    ) -> Result<Vec<LoyaltyMembershipWithDetails>, ApiError> {
        sqlx::query_as::<_, LoyaltyMembershipWithDetails>(
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
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn member_counts(pool: &DbPool) -> Result<(i64, i64), ApiError> {
        sqlx::query_as(
            r#"
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'active') as active
            FROM loyalty_memberships
            "#,
        )
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn tier_statistics(pool: &DbPool) -> Result<Vec<TierStatistics>, ApiError> {
        sqlx::query_as::<_, TierStatistics>(
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
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn points_totals(pool: &DbPool) -> Result<(i64, i64, f64), ApiError> {
        sqlx::query_as(
            r#"
            SELECT
                COALESCE(SUM(lifetime_points), 0)::bigint as total_issued,
                COALESCE(SUM(points_balance), 0)::bigint as total_active,
                COALESCE(AVG(points_balance), 0.0)::double precision as avg_points
            FROM loyalty_memberships
            WHERE status = 'active'
            "#,
        )
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn top_members(pool: &DbPool) -> Result<Vec<TopMember>, ApiError> {
        sqlx::query_as::<_, TopMember>(
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
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn recent_transactions(pool: &DbPool) -> Result<Vec<RecentTransaction>, ApiError> {
        sqlx::query_as::<_, RecentTransaction>(
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
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn membership_growth(pool: &DbPool) -> Result<Vec<MembershipGrowth>, ApiError> {
        sqlx::query_as::<_, MembershipGrowth>(
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
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn points_activity(pool: &DbPool) -> Result<Vec<PointsActivity>, ApiError> {
        sqlx::query_as::<_, PointsActivity>(
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
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn find_membership_by_id(
        pool: &DbPool,
        id: i64,
    ) -> Result<Option<LoyaltyMembership>, ApiError> {
        sqlx::query_as::<_, LoyaltyMembership>(
            r#"
            SELECT id, guest_id, program_id, membership_number, points_balance,
                   lifetime_points, tier_level, status, enrolled_date, expiry_date,
                   created_at, updated_at
            FROM loyalty_memberships
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn find_active_membership_by_guest_id(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Option<LoyaltyMembership>, ApiError> {
        sqlx::query_as::<_, LoyaltyMembership>(
            "SELECT * FROM loyalty_memberships WHERE guest_id = $1 AND status = 'active'",
        )
        .bind(guest_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn find_program_by_id(
        pool: &DbPool,
        program_id: i64,
    ) -> Result<LoyaltyProgram, ApiError> {
        sqlx::query_as::<_, LoyaltyProgram>("SELECT * FROM loyalty_programs WHERE id = $1")
            .bind(program_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn find_next_active_program_by_tier(
        pool: &DbPool,
        tier_level: i32,
    ) -> Result<Option<LoyaltyProgram>, ApiError> {
        sqlx::query_as::<_, LoyaltyProgram>(
            "SELECT * FROM loyalty_programs WHERE tier_level = $1 AND is_active = true ORDER BY tier_level LIMIT 1",
        )
        .bind(tier_level)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn program_benefits(pool: &DbPool, program_id: i64) -> Result<Vec<String>, ApiError> {
        sqlx::query_scalar(
            "SELECT jsonb_array_elements_text(benefits) FROM loyalty_programs WHERE id = $1",
        )
        .bind(program_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn transactions_for_membership(
        pool: &DbPool,
        membership_id: i64,
        limit: i64,
    ) -> Result<Vec<PointsTransaction>, ApiError> {
        sqlx::query_as::<_, PointsTransaction>(
            r#"
            SELECT id::text, membership_id, transaction_type, points_amount, balance_after,
                   reference_type, reference_id, description, created_at
            FROM points_transactions
            WHERE membership_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            "#,
        )
        .bind(membership_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn active_tier_level_by_guest(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Option<i32>, ApiError> {
        sqlx::query_scalar(
            "SELECT tier_level FROM loyalty_memberships WHERE guest_id = $1 AND status = 'active'",
        )
        .bind(guest_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn available_rewards_for_tier(
        pool: &DbPool,
        tier_level: i32,
    ) -> Result<Vec<LoyaltyReward>, ApiError> {
        sqlx::query_as::<_, LoyaltyReward>(
            r#"
            SELECT * FROM loyalty_rewards
            WHERE is_active = true
            AND minimum_tier_level <= $1
            AND (stock_quantity IS NULL OR stock_quantity > 0)
            ORDER BY category, points_cost
            "#,
        )
        .bind(tier_level)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn list_rewards(
        pool: &DbPool,
        category: Option<&str>,
    ) -> Result<Vec<LoyaltyReward>, ApiError> {
        if let Some(category) = category {
            sqlx::query_as::<_, LoyaltyReward>(
                "SELECT * FROM loyalty_rewards WHERE category = $1 AND is_active = true ORDER BY category, points_cost",
            )
            .bind(category)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
        } else {
            sqlx::query_as::<_, LoyaltyReward>(
                "SELECT * FROM loyalty_rewards WHERE is_active = true ORDER BY category, points_cost",
            )
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
        }
    }

    pub async fn find_reward_by_id(
        pool: &DbPool,
        reward_id: i64,
    ) -> Result<Option<LoyaltyReward>, ApiError> {
        sqlx::query_as::<_, LoyaltyReward>("SELECT * FROM loyalty_rewards WHERE id = $1")
            .bind(reward_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn create_reward(
        pool: &DbPool,
        input: &crate::models::RewardInput,
        monetary_value: Option<rust_decimal::Decimal>,
    ) -> Result<LoyaltyReward, ApiError> {
        sqlx::query_as::<_, LoyaltyReward>(
            r#"
            INSERT INTO loyalty_rewards
            (name, description, category, points_cost, monetary_value, minimum_tier_level,
             stock_quantity, image_url, terms_conditions)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
            "#,
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
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn update_reward(
        pool: &DbPool,
        reward_id: i64,
        values: &RewardUpdateValues,
    ) -> Result<LoyaltyReward, ApiError> {
        sqlx::query_as::<_, LoyaltyReward>(
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
            "#,
        )
        .bind(&values.name)
        .bind(&values.description)
        .bind(&values.category)
        .bind(values.points_cost)
        .bind(values.monetary_value)
        .bind(values.minimum_tier_level)
        .bind(values.is_active)
        .bind(values.stock_quantity)
        .bind(&values.image_url)
        .bind(&values.terms_conditions)
        .bind(reward_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn deactivate_reward(pool: &DbPool, reward_id: i64) -> Result<bool, ApiError> {
        let result = sqlx::query(
            "UPDATE loyalty_rewards SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        )
        .bind(reward_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn reward_redemptions(
        pool: &DbPool,
    ) -> Result<Vec<RewardRedemptionWithDetails>, ApiError> {
        sqlx::query_as::<_, RewardRedemptionWithDetails>(
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
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn record_points_adjustment(
        pool: &DbPool,
        membership_id: i64,
        points: i32,
        new_balance: i32,
        is_earn: bool,
        description: Option<String>,
    ) -> Result<PointsTransaction, ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        if is_earn {
            sqlx::query(
                r#"
                UPDATE loyalty_memberships
                SET points_balance = $1,
                    lifetime_points = lifetime_points + $2,
                    last_points_activity = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
                "#,
            )
            .bind(new_balance)
            .bind(points)
            .bind(membership_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        } else {
            sqlx::query(
                r#"
                UPDATE loyalty_memberships
                SET points_balance = $1,
                    last_points_activity = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
                "#,
            )
            .bind(new_balance)
            .bind(membership_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        let tx_type = if is_earn { "earn" } else { "redeem" };
        let points_amount = if is_earn { points } else { -points };

        let transaction = sqlx::query_as::<_, PointsTransaction>(
            r#"
            INSERT INTO points_transactions (
                membership_id, transaction_type, points_amount, balance_after, description
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id::text, membership_id, transaction_type, points_amount,
                      balance_after, reference_type, reference_id, description, created_at
            "#,
        )
        .bind(membership_id)
        .bind(tx_type)
        .bind(points_amount)
        .bind(new_balance)
        .bind(&description)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(transaction)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn redeem_reward_for_guest(
        pool: &DbPool,
        guest_id: i64,
        reward_id: i64,
        booking_id: Option<i64>,
        notes: Option<String>,
        reward_not_found_message: &str,
        use_detailed_points_error: bool,
        touch_reward_updated_at: bool,
    ) -> Result<RewardRedemptionResponse, ApiError> {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        let membership = sqlx::query_as::<_, LoyaltyMembership>(
            "SELECT * FROM loyalty_memberships WHERE guest_id = $1 AND status = 'active' FOR UPDATE",
        )
        .bind(guest_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("No active loyalty membership found".to_string()))?;

        let reward = sqlx::query_as::<_, LoyaltyReward>(
            "SELECT * FROM loyalty_rewards WHERE id = $1 AND is_active = true FOR UPDATE",
        )
        .bind(reward_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound(reward_not_found_message.to_string()))?;

        if membership.tier_level < reward.minimum_tier_level {
            return Err(ApiError::BadRequest(
                "Your tier level is not high enough for this reward".to_string(),
            ));
        }

        if membership.points_balance < reward.points_cost {
            let message = if use_detailed_points_error {
                format!(
                    "Insufficient points. Required: {}, Available: {}",
                    reward.points_cost, membership.points_balance
                )
            } else {
                "Insufficient points balance".to_string()
            };
            return Err(ApiError::BadRequest(message));
        }

        if let Some(stock) = reward.stock_quantity
            && stock <= 0
        {
            return Err(ApiError::BadRequest("Reward is out of stock".to_string()));
        }

        let new_balance = membership.points_balance - reward.points_cost;
        sqlx::query(
            r#"
            UPDATE loyalty_memberships
            SET points_balance = $1,
                last_points_activity = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            "#,
        )
        .bind(new_balance)
        .bind(membership.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        let transaction: PointsTransaction = sqlx::query_as(
            r#"
            INSERT INTO points_transactions
            (membership_id, transaction_type, points_amount, balance_after, reference_type, reference_id, description)
            VALUES ($1, 'redeem', $2, $3, 'reward', $4, $5)
            RETURNING id::text, membership_id, transaction_type, points_amount,
                      balance_after, reference_type, reference_id, description, created_at
            "#,
        )
        .bind(membership.id)
        .bind(-reward.points_cost)
        .bind(new_balance)
        .bind(reward.id)
        .bind(format!("Redeemed: {}", reward.name))
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        sqlx::query(
            r#"
            INSERT INTO reward_redemptions
            (membership_id, reward_id, transaction_id, booking_id, points_spent, notes, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'pending')
            "#,
        )
        .bind(membership.id)
        .bind(reward.id)
        .bind(&transaction.id)
        .bind(booking_id)
        .bind(reward.points_cost)
        .bind(&notes)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        if reward.stock_quantity.is_some() {
            let query = if touch_reward_updated_at {
                "UPDATE loyalty_rewards SET stock_quantity = stock_quantity - 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1"
            } else {
                "UPDATE loyalty_rewards SET stock_quantity = stock_quantity - 1 WHERE id = $1"
            };
            sqlx::query(query)
                .bind(reward.id)
                .execute(&mut *tx)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(RewardRedemptionResponse {
            message: "Reward redeemed successfully".to_string(),
            points_spent: reward.points_cost,
            new_balance,
            reward_name: reward.name,
        })
    }
}
