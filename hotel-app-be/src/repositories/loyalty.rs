//! Loyalty program repository for database operations

use sqlx::PgPool;
use crate::core::error::ApiError;
use crate::models::{LoyaltyMembership, LoyaltyMembershipWithDetails, PointsTransaction, LoyaltyReward};

pub struct LoyaltyRepository;

impl LoyaltyRepository {
    /// Find membership by guest ID
    pub async fn find_membership_by_guest_id(
        pool: &PgPool,
        guest_id: i64,
    ) -> Result<Option<LoyaltyMembershipWithDetails>, ApiError> {
        sqlx::query_as::<_, LoyaltyMembershipWithDetails>(
            r#"
            SELECT m.id, m.guest_id, g.full_name as guest_name, g.email as guest_email,
                   m.program_id, p.name as program_name, p.description as program_description,
                   m.membership_number, m.points_balance, m.lifetime_points,
                   m.tier_level, p.points_multiplier, m.status, m.enrolled_date
            FROM loyalty_memberships m
            JOIN guests g ON m.guest_id = g.id
            JOIN loyalty_programs p ON m.program_id = p.id
            WHERE m.guest_id = $1
            "#
        )
        .bind(guest_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find membership by ID
    pub async fn find_membership_by_id(
        pool: &PgPool,
        id: i64,
    ) -> Result<Option<LoyaltyMembership>, ApiError> {
        sqlx::query_as::<_, LoyaltyMembership>(
            r#"
            SELECT id, guest_id, program_id, membership_number, points_balance,
                   lifetime_points, tier_level, status, enrolled_date, expiry_date,
                   created_at, updated_at
            FROM loyalty_memberships
            WHERE id = $1
            "#
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get points transactions for a membership
    pub async fn get_transactions(
        pool: &PgPool,
        membership_id: i64,
        limit: i64,
    ) -> Result<Vec<PointsTransaction>, ApiError> {
        sqlx::query_as::<_, PointsTransaction>(
            r#"
            SELECT id, membership_id, transaction_type, points_amount, balance_after,
                   reference_type, reference_id, description, created_at
            FROM points_transactions
            WHERE membership_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            "#
        )
        .bind(membership_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Add points to a membership
    pub async fn add_points(
        pool: &PgPool,
        membership_id: i64,
        points: i32,
        description: Option<&str>,
    ) -> Result<PointsTransaction, ApiError> {
        // Get current balance
        let current_balance: i32 = sqlx::query_scalar(
            "SELECT points_balance FROM loyalty_memberships WHERE id = $1"
        )
        .bind(membership_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        let new_balance = current_balance + points;

        // Create transaction
        let transaction: PointsTransaction = sqlx::query_as(
            r#"
            INSERT INTO points_transactions (membership_id, transaction_type, points_amount, balance_after, description)
            VALUES ($1, 'earn', $2, $3, $4)
            RETURNING id, membership_id, transaction_type, points_amount, balance_after,
                      reference_type, reference_id, description, created_at
            "#
        )
        .bind(membership_id)
        .bind(points)
        .bind(new_balance)
        .bind(description)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        // Update membership balance
        sqlx::query(
            r#"
            UPDATE loyalty_memberships
            SET points_balance = $1, lifetime_points = lifetime_points + $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            "#
        )
        .bind(new_balance)
        .bind(points)
        .bind(membership_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(transaction)
    }

    /// Redeem points from a membership
    pub async fn redeem_points(
        pool: &PgPool,
        membership_id: i64,
        points: i32,
        description: Option<&str>,
    ) -> Result<PointsTransaction, ApiError> {
        // Get current balance
        let current_balance: i32 = sqlx::query_scalar(
            "SELECT points_balance FROM loyalty_memberships WHERE id = $1"
        )
        .bind(membership_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        if current_balance < points {
            return Err(ApiError::BadRequest("Insufficient points balance".to_string()));
        }

        let new_balance = current_balance - points;

        // Create transaction
        let transaction: PointsTransaction = sqlx::query_as(
            r#"
            INSERT INTO points_transactions (membership_id, transaction_type, points_amount, balance_after, description)
            VALUES ($1, 'redeem', $2, $3, $4)
            RETURNING id, membership_id, transaction_type, points_amount, balance_after,
                      reference_type, reference_id, description, created_at
            "#
        )
        .bind(membership_id)
        .bind(-points)
        .bind(new_balance)
        .bind(description)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        // Update membership balance
        sqlx::query("UPDATE loyalty_memberships SET points_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(new_balance)
            .bind(membership_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(transaction)
    }

    /// Get available rewards
    pub async fn get_rewards(pool: &PgPool, tier_level: i32) -> Result<Vec<LoyaltyReward>, ApiError> {
        sqlx::query_as::<_, LoyaltyReward>(
            r#"
            SELECT id, name, description, category, points_cost, monetary_value,
                   minimum_tier_level, is_active, stock_quantity, image_url,
                   terms_conditions, created_at, updated_at
            FROM loyalty_rewards
            WHERE is_active = true AND minimum_tier_level <= $1
            ORDER BY points_cost
            "#
        )
        .bind(tier_level)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }
}
