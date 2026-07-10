use super::models::*;
use crate::core::db::{DbPool, DbRow, DbTransaction};
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::sql_query;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::prelude::ToPrimitive;
use sqlx::Row;

pub struct LoyaltyRepository;

#[derive(Debug, Clone)]
pub struct NewTransaction<'a> {
    pub member_id: i64,
    pub account_id: i64,
    pub transaction_type: &'a str,
    pub points_delta: i32,
    pub available_delta: i32,
    pub source_type: Option<&'a str>,
    pub source_id: Option<i64>,
    pub booking_id: Option<i64>,
    pub payment_id: Option<i64>,
    pub invoice_id: Option<i64>,
    pub related_transaction_id: Option<i64>,
    pub description: Option<&'a str>,
    pub metadata: Option<serde_json::Value>,
    pub actor_user_id: Option<i64>,
}

impl LoyaltyRepository {
    pub async fn find_guest_for_user(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<Option<LoyaltyGuestProfile>, ApiError> {
        let sql = sql_query!(
            postgres: r#"
                SELECT g.id AS guest_id, g.full_name, g.email, g.phone
                FROM users u
                LEFT JOIN guests g ON g.id = u.guest_id
                WHERE u.id = $1
                UNION
                SELECT g.id AS guest_id, g.full_name, g.email, g.phone
                FROM users u
                JOIN guests g ON lower(g.email) = lower(u.email)
                WHERE u.id = $1 AND u.guest_id IS NULL
                LIMIT 1
            "#,
            sqlite: r#"
                SELECT g.id AS guest_id, g.full_name, g.email, g.phone
                FROM users u
                LEFT JOIN guests g ON g.id = u.guest_id
                WHERE u.id = ?1
                UNION
                SELECT g.id AS guest_id, g.full_name, g.email, g.phone
                FROM users u
                JOIN guests g ON lower(g.email) = lower(u.email)
                WHERE u.id = ?1 AND u.guest_id IS NULL
                LIMIT 1
            "#
        );

        let row = sqlx::query(sql)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;

        Ok(row.as_ref().map(row_to_guest_profile))
    }

    pub async fn get_rules(pool: &DbPool) -> Result<LoyaltyProgramRules, ApiError> {
        let row = sqlx::query(sql_query!(
            postgres: "SELECT * FROM loyalty_program_rules WHERE id = 1",
            sqlite: "SELECT * FROM loyalty_program_rules WHERE id = 1"
        ))
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(row_to_rules(&row))
    }

    pub async fn update_rules(
        pool: &DbPool,
        input: &LoyaltyRulesInput,
    ) -> Result<LoyaltyProgramRules, ApiError> {
        let row = sqlx::query(sql_query!(
            postgres: r#"
                UPDATE loyalty_program_rules
                SET points_per_currency_unit = $1,
                    tier_qualification_metric = $2,
                    point_expiry_months = $3,
                    redemption_approval_required = $4,
                    earning_enabled = $5,
                    min_eligible_amount = $6,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
                RETURNING *
            "#,
            sqlite: r#"
                UPDATE loyalty_program_rules
                SET points_per_currency_unit = ?1,
                    tier_qualification_metric = ?2,
                    point_expiry_months = ?3,
                    redemption_approval_required = ?4,
                    earning_enabled = ?5,
                    min_eligible_amount = ?6,
                    updated_at = datetime('now')
                WHERE id = 1
                RETURNING *
            "#
        ))
        .bind(input.points_per_currency_unit)
        .bind(&input.tier_qualification_metric)
        .bind(input.point_expiry_months)
        .bind(input.redemption_approval_required)
        .bind(input.earning_enabled)
        .bind(input.min_eligible_amount)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(row_to_rules(&row))
    }

    #[allow(dead_code)] // part of the loyalty module API; not yet wired to a caller
    pub async fn list_tiers(pool: &DbPool) -> Result<Vec<LoyaltyTier>, ApiError> {
        let rows =
            sqlx::query("SELECT * FROM loyalty_tiers WHERE is_active = true ORDER BY sort_order")
                .fetch_all(pool)
                .await
                .map_err(ApiError::from)?;
        Ok(rows.iter().map(row_to_tier).collect())
    }

    pub async fn default_tier_id(pool: &DbPool) -> Result<i64, ApiError> {
        sqlx::query_scalar(
            "SELECT id FROM loyalty_tiers WHERE is_active = true ORDER BY sort_order LIMIT 1",
        )
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn tier_by_id(pool: &DbPool, tier_id: i64) -> Result<Option<LoyaltyTier>, ApiError> {
        let row = sqlx::query("SELECT * FROM loyalty_tiers WHERE id = $1")
            .bind(tier_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(row_to_tier))
    }

    pub async fn best_tier_for_metric(
        pool: &DbPool,
        metric: &str,
        value: f64,
    ) -> Result<LoyaltyTier, ApiError> {
        let order_column = match metric {
            "nights" => "min_nights",
            "spend" => "min_spend",
            _ => "min_points",
        };
        let sql = format!(
            "SELECT * FROM loyalty_tiers WHERE is_active = true AND {order_column} <= $1 ORDER BY {order_column} DESC, sort_order DESC LIMIT 1"
        );
        let row = sqlx::query(&sql)
            .bind(value)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row_to_tier(&row))
    }

    pub async fn next_tier_for_metric(
        pool: &DbPool,
        metric: &str,
        value: f64,
    ) -> Result<Option<LoyaltyTier>, ApiError> {
        let order_column = match metric {
            "nights" => "min_nights",
            "spend" => "min_spend",
            _ => "min_points",
        };
        let sql = format!(
            "SELECT * FROM loyalty_tiers WHERE is_active = true AND {order_column} > $1 ORDER BY {order_column}, sort_order LIMIT 1"
        );
        let row = sqlx::query(&sql)
            .bind(value)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(row_to_tier))
    }

    pub async fn member_by_guest(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Option<LoyaltyMemberSummary>, ApiError> {
        let row = sqlx::query(&member_summary_sql("WHERE lm.guest_id = $1"))
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(row_to_member_summary))
    }

    pub async fn member_by_id(
        pool: &DbPool,
        member_id: i64,
    ) -> Result<Option<LoyaltyMemberSummary>, ApiError> {
        let row = sqlx::query(&member_summary_sql("WHERE lm.id = $1"))
            .bind(member_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(row_to_member_summary))
    }

    pub async fn list_members(
        pool: &DbPool,
        query: &LoyaltyMemberQuery,
    ) -> Result<Vec<LoyaltyMemberSummary>, ApiError> {
        let mut conditions = Vec::new();
        let mut bind_search = false;
        let mut bind_status = false;

        if query
            .search
            .as_deref()
            .is_some_and(|v| !v.trim().is_empty())
        {
            conditions.push(
                "(lower(g.full_name) LIKE lower($1) OR lower(COALESCE(g.email, '')) LIKE lower($1) OR lower(lm.member_number) LIKE lower($1))",
            );
            bind_search = true;
        }

        if query
            .status
            .as_deref()
            .is_some_and(|v| !v.trim().is_empty())
        {
            conditions.push(if bind_search {
                "lm.status = $2"
            } else {
                "lm.status = $1"
            });
            bind_status = true;
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        let sql = format!(
            "{} ORDER BY lm.enrolled_at DESC, lm.id DESC",
            member_summary_sql(&where_clause)
        );
        let mut q = sqlx::query(&sql);
        if bind_search {
            q = q.bind(format!(
                "%{}%",
                query.search.as_deref().unwrap_or_default().trim()
            ));
        }
        if bind_status {
            q = q.bind(query.status.as_deref().unwrap_or_default().trim());
        }

        let rows = q.fetch_all(pool).await.map_err(ApiError::from)?;
        Ok(rows.iter().map(row_to_member_summary).collect())
    }

    pub async fn create_member(
        pool: &DbPool,
        guest_id: i64,
        member_number: &str,
        tier_id: i64,
    ) -> Result<LoyaltyMemberSummary, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;
        let member_id: i64 = sqlx::query_scalar(sql_query!(
            postgres: r#"
                INSERT INTO loyalty_members (guest_id, member_number, status)
                VALUES ($1, $2, 'active')
                RETURNING id
            "#,
            sqlite: r#"
                INSERT INTO loyalty_members (guest_id, member_number, status)
                VALUES (?1, ?2, 'active')
                RETURNING id
            "#
        ))
        .bind(guest_id)
        .bind(member_number)
        .fetch_one(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        sqlx::query(sql_query!(
            postgres: r#"
                INSERT INTO loyalty_accounts (member_id, current_tier_id)
                VALUES ($1, $2)
            "#,
            sqlite: r#"
                INSERT INTO loyalty_accounts (member_id, current_tier_id)
                VALUES (?1, ?2)
            "#
        ))
        .bind(member_id)
        .bind(tier_id)
        .execute(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        tx.commit().await.map_err(ApiError::from)?;

        Self::member_by_id(pool, member_id)
            .await?
            .ok_or_else(|| ApiError::Internal("Created loyalty member was not found".to_string()))
    }

    #[allow(dead_code)] // part of the loyalty module API; not yet wired to a caller
    pub async fn available_balance(pool: &DbPool, member_id: i64) -> Result<i32, ApiError> {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(available_delta), 0) FROM loyalty_transactions WHERE member_id = $1",
        )
        .bind(member_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn has_source_transaction(
        pool: &DbPool,
        member_id: i64,
        source_type: &str,
        source_id: i64,
        transaction_type: &str,
    ) -> Result<bool, ApiError> {
        let count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM loyalty_transactions
            WHERE member_id = $1 AND source_type = $2 AND source_id = $3 AND transaction_type = $4
            "#,
        )
        .bind(member_id)
        .bind(source_type)
        .bind(source_id)
        .bind(transaction_type)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(count > 0)
    }

    pub async fn earned_booking_transaction_count(
        pool: &DbPool,
        member_id: i64,
        booking_id: i64,
    ) -> Result<i64, ApiError> {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM loyalty_transactions WHERE member_id = $1 AND booking_id = $2 AND transaction_type = 'earned'",
        )
        .bind(member_id)
        .bind(booking_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    pub async fn transactions_for_member(
        pool: &DbPool,
        member_id: i64,
        limit: i64,
    ) -> Result<Vec<LoyaltyTransaction>, ApiError> {
        let rows = sqlx::query(
            r#"
            SELECT *
            FROM loyalty_transactions
            WHERE member_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2
            "#,
        )
        .bind(member_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows.iter().map(row_to_transaction).collect())
    }

    pub async fn insert_transaction(
        tx: &mut DbTransaction<'_>,
        input: NewTransaction<'_>,
    ) -> Result<LoyaltyTransaction, ApiError> {
        let balance_before: i32 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(available_delta), 0) FROM loyalty_transactions WHERE member_id = $1",
        )
        .bind(input.member_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        let balance_after = balance_before + input.available_delta;
        let metadata = input.metadata.map(|v| v.to_string());

        let row = sqlx::query(sql_query!(
            postgres: r#"
                INSERT INTO loyalty_transactions (
                    member_id, account_id, transaction_type, points_delta, available_delta,
                    balance_after, source_type, source_id, booking_id, payment_id, invoice_id,
                    related_transaction_id, description, metadata, actor_user_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                RETURNING *
            "#,
            sqlite: r#"
                INSERT INTO loyalty_transactions (
                    member_id, account_id, transaction_type, points_delta, available_delta,
                    balance_after, source_type, source_id, booking_id, payment_id, invoice_id,
                    related_transaction_id, description, metadata, actor_user_id
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                RETURNING *
            "#
        ))
        .bind(input.member_id)
        .bind(input.account_id)
        .bind(input.transaction_type)
        .bind(input.points_delta)
        .bind(input.available_delta)
        .bind(balance_after)
        .bind(input.source_type)
        .bind(input.source_id)
        .bind(input.booking_id)
        .bind(input.payment_id)
        .bind(input.invoice_id)
        .bind(input.related_transaction_id)
        .bind(input.description)
        .bind(metadata)
        .bind(input.actor_user_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(ApiError::from)?;

        Ok(row_to_transaction(&row))
    }

    pub async fn update_account_earning(
        tx: &mut DbTransaction<'_>,
        account_id: i64,
        points: i32,
        amount: f64,
        nights: i32,
        new_tier_id: i64,
    ) -> Result<(), ApiError> {
        sqlx::query(sql_query!(
            postgres: r#"
                UPDATE loyalty_accounts
                SET lifetime_points = lifetime_points + $1,
                    qualifying_points = qualifying_points + $1,
                    qualifying_spend = qualifying_spend + $2,
                    qualifying_nights = qualifying_nights + $3,
                    current_tier_id = $4,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $5
            "#,
            sqlite: r#"
                UPDATE loyalty_accounts
                SET lifetime_points = lifetime_points + ?1,
                    qualifying_points = qualifying_points + ?1,
                    qualifying_spend = qualifying_spend + ?2,
                    qualifying_nights = qualifying_nights + ?3,
                    current_tier_id = ?4,
                    updated_at = datetime('now')
                WHERE id = ?5
            "#
        ))
        .bind(points)
        .bind(amount)
        .bind(nights)
        .bind(new_tier_id)
        .bind(account_id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    #[allow(dead_code)] // part of the loyalty module API; not yet wired to a caller
    pub async fn update_account_tier(
        pool: &DbPool,
        account_id: i64,
        tier_id: i64,
    ) -> Result<(), ApiError> {
        sqlx::query(sql_query!(
            postgres: "UPDATE loyalty_accounts SET current_tier_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
            sqlite: "UPDATE loyalty_accounts SET current_tier_id = ?1, updated_at = datetime('now') WHERE id = ?2"
        ))
        .bind(tier_id)
        .bind(account_id)
        .execute(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    pub async fn payment_award_candidates(
        pool: &DbPool,
        booking_id: Option<i64>,
        payment_id: Option<i64>,
    ) -> Result<Vec<PaymentAwardCandidate>, ApiError> {
        let mut clauses = vec![
            "p.status = 'completed'",
            "COALESCE(p.payment_type, 'booking') IN ('booking', 'room_charge')",
            "b.status IN ('checked_out', 'completed')",
            "COALESCE(b.is_complimentary, false) = false",
        ];
        if booking_id.is_some() {
            clauses.push("b.id = $1");
        }
        if payment_id.is_some() {
            clauses.push(if booking_id.is_some() {
                "p.id = $2"
            } else {
                "p.id = $1"
            });
        }

        let where_clause = clauses.join(" AND ");
        let sql = sql_query!(
            postgres: format!(
                r#"
                SELECT
                    b.id AS booking_id,
                    b.guest_id,
                    p.id AS payment_id,
                    (SELECT i.id FROM invoices i WHERE i.booking_id = b.id ORDER BY i.id DESC LIMIT 1) AS invoice_id,
                    p.amount::text AS amount,
                    GREATEST((b.check_out_date - b.check_in_date), 1) AS nights
                FROM payments p
                JOIN bookings b ON b.id = p.booking_id
                WHERE {where_clause}
                ORDER BY p.created_at ASC, p.id ASC
                "#
            ),
            sqlite: format!(
                r#"
                SELECT
                    b.id AS booking_id,
                    b.guest_id,
                    p.id AS payment_id,
                    (SELECT i.id FROM invoices i WHERE i.booking_id = b.id ORDER BY i.id DESC LIMIT 1) AS invoice_id,
                    CAST(p.amount AS TEXT) AS amount,
                    CASE
                        WHEN julianday(b.check_out_date) - julianday(b.check_in_date) < 1 THEN 1
                        ELSE CAST(julianday(b.check_out_date) - julianday(b.check_in_date) AS INTEGER)
                    END AS nights
                FROM payments p
                JOIN bookings b ON b.id = p.booking_id
                WHERE {where_clause}
                ORDER BY p.created_at ASC, p.id ASC
                "#
            )
        );

        let mut query = sqlx::query(&sql);
        if let Some(id) = booking_id {
            query = query.bind(id);
        }
        if let Some(id) = payment_id {
            query = query.bind(id);
        }
        let rows = query.fetch_all(pool).await.map_err(ApiError::from)?;
        Ok(rows.iter().map(row_to_award_candidate).collect())
    }

    pub async fn reversible_earned_transactions_for_booking(
        pool: &DbPool,
        booking_id: i64,
    ) -> Result<Vec<LoyaltyTransaction>, ApiError> {
        let rows = sqlx::query(
            r#"
            SELECT t.*
            FROM loyalty_transactions t
            WHERE t.booking_id = $1
              AND t.transaction_type = 'earned'
              AND NOT EXISTS (
                  SELECT 1
                  FROM loyalty_transactions r
                  WHERE r.related_transaction_id = t.id
                    AND r.transaction_type = 'reversed'
              )
            ORDER BY t.created_at ASC, t.id ASC
            "#,
        )
        .bind(booking_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows.iter().map(row_to_transaction).collect())
    }

    pub async fn list_rewards(
        pool: &DbPool,
        query: &LoyaltyRewardQuery,
    ) -> Result<Vec<LoyaltyReward>, ApiError> {
        let mut conditions = Vec::new();
        let include_inactive = query.include_inactive.unwrap_or(false);
        if !include_inactive {
            conditions.push("lr.is_active = true");
        }
        let bind_category = query
            .category
            .as_deref()
            .is_some_and(|v| !v.trim().is_empty());
        if bind_category {
            conditions.push("lr.category = $1");
        }
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
        let sql = format!(
            "{} {} ORDER BY lr.is_active DESC, lr.category, lr.points_cost, lr.name",
            reward_select_sql(),
            where_clause
        );
        let mut q = sqlx::query(&sql);
        if bind_category {
            q = q.bind(query.category.as_deref().unwrap_or_default().trim());
        }
        let rows = q.fetch_all(pool).await.map_err(ApiError::from)?;
        Ok(rows.iter().map(row_to_reward).collect())
    }

    pub async fn find_reward(
        pool: &DbPool,
        reward_id: i64,
    ) -> Result<Option<LoyaltyReward>, ApiError> {
        let sql = format!("{} WHERE lr.id = $1", reward_select_sql());
        let row = sqlx::query(&sql)
            .bind(reward_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(row_to_reward))
    }

    pub async fn create_reward(
        pool: &DbPool,
        input: &RewardInput,
    ) -> Result<LoyaltyReward, ApiError> {
        let row = sqlx::query(sql_query!(
            postgres: r#"
                INSERT INTO loyalty_rewards (
                    name, description, category, points_cost, minimum_tier_id,
                    requires_approval, is_active, inventory_count, valid_from, valid_to, terms_conditions
                )
                VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true), $8, $9, $10, $11)
                RETURNING id
            "#,
            sqlite: r#"
                INSERT INTO loyalty_rewards (
                    name, description, category, points_cost, minimum_tier_id,
                    requires_approval, is_active, inventory_count, valid_from, valid_to, terms_conditions
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, 1), ?8, ?9, ?10, ?11)
                RETURNING id
            "#
        ))
        .bind(&input.name)
        .bind(&input.description)
        .bind(&input.category)
        .bind(input.points_cost)
        .bind(input.minimum_tier_id)
        .bind(input.requires_approval.unwrap_or(false))
        .bind(input.is_active)
        .bind(input.inventory_count)
        .bind(input.valid_from)
        .bind(input.valid_to)
        .bind(&input.terms_conditions)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        let reward_id: i64 = row.try_get("id").unwrap_or_default();
        Self::find_reward(pool, reward_id)
            .await?
            .ok_or_else(|| ApiError::Internal("Created loyalty reward was not found".to_string()))
    }

    pub async fn update_reward(
        pool: &DbPool,
        reward_id: i64,
        input: &RewardUpdateInput,
        existing: &LoyaltyReward,
    ) -> Result<LoyaltyReward, ApiError> {
        let row = sqlx::query(sql_query!(
            postgres: r#"
                UPDATE loyalty_rewards
                SET name = $1,
                    description = $2,
                    category = $3,
                    points_cost = $4,
                    minimum_tier_id = $5,
                    requires_approval = $6,
                    is_active = $7,
                    inventory_count = $8,
                    valid_from = $9,
                    valid_to = $10,
                    terms_conditions = $11,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $12
                RETURNING id
            "#,
            sqlite: r#"
                UPDATE loyalty_rewards
                SET name = ?1,
                    description = ?2,
                    category = ?3,
                    points_cost = ?4,
                    minimum_tier_id = ?5,
                    requires_approval = ?6,
                    is_active = ?7,
                    inventory_count = ?8,
                    valid_from = ?9,
                    valid_to = ?10,
                    terms_conditions = ?11,
                    updated_at = datetime('now')
                WHERE id = ?12
                RETURNING id
            "#
        ))
        .bind(input.name.as_ref().unwrap_or(&existing.name))
        .bind(input.description.clone().or(existing.description.clone()))
        .bind(input.category.as_ref().unwrap_or(&existing.category))
        .bind(input.points_cost.unwrap_or(existing.points_cost))
        .bind(input.minimum_tier_id.or(existing.minimum_tier_id))
        .bind(
            input
                .requires_approval
                .unwrap_or(existing.requires_approval),
        )
        .bind(input.is_active.unwrap_or(existing.is_active))
        .bind(input.inventory_count.or(existing.inventory_count))
        .bind(input.valid_from.or(existing.valid_from))
        .bind(input.valid_to.or(existing.valid_to))
        .bind(
            input
                .terms_conditions
                .clone()
                .or(existing.terms_conditions.clone()),
        )
        .bind(reward_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        let id: i64 = row.try_get("id").unwrap_or(reward_id);
        Self::find_reward(pool, id)
            .await?
            .ok_or_else(|| ApiError::NotFound("Reward not found".to_string()))
    }

    pub async fn list_redemptions(
        pool: &DbPool,
        query: &LoyaltyRedemptionQuery,
    ) -> Result<Vec<LoyaltyRedemption>, ApiError> {
        let bind_status = query
            .status
            .as_deref()
            .is_some_and(|v| !v.trim().is_empty());
        let sql = if bind_status {
            format!(
                "{} WHERE lr.status = $1 ORDER BY lr.requested_at DESC, lr.id DESC",
                redemption_select_sql()
            )
        } else {
            format!(
                "{} ORDER BY lr.requested_at DESC, lr.id DESC",
                redemption_select_sql()
            )
        };
        let mut q = sqlx::query(&sql);
        if bind_status {
            q = q.bind(query.status.as_deref().unwrap_or_default().trim());
        }
        let rows = q.fetch_all(pool).await.map_err(ApiError::from)?;
        Ok(rows.iter().map(row_to_redemption).collect())
    }

    pub async fn redemptions_for_member(
        pool: &DbPool,
        member_id: i64,
    ) -> Result<Vec<LoyaltyRedemption>, ApiError> {
        let sql = format!(
            "{} WHERE lr.member_id = $1 ORDER BY lr.requested_at DESC, lr.id DESC",
            redemption_select_sql()
        );
        let rows = sqlx::query(&sql)
            .bind(member_id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(rows.iter().map(row_to_redemption).collect())
    }

    pub async fn find_redemption(
        pool: &DbPool,
        redemption_id: i64,
    ) -> Result<Option<LoyaltyRedemption>, ApiError> {
        let sql = format!("{} WHERE lr.id = $1", redemption_select_sql());
        let row = sqlx::query(&sql)
            .bind(redemption_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(row_to_redemption))
    }

    pub async fn insert_redemption(
        tx: &mut DbTransaction<'_>,
        member_id: i64,
        reward_id: i64,
        transaction_id: i64,
        points_spent: i32,
        status: &str,
        notes: Option<&str>,
    ) -> Result<i64, ApiError> {
        sqlx::query_scalar(sql_query!(
            postgres: r#"
                INSERT INTO loyalty_redemptions (
                    member_id, reward_id, transaction_id, points_spent, status, notes,
                    reviewed_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END)
                RETURNING id
            "#,
            sqlite: r#"
                INSERT INTO loyalty_redemptions (
                    member_id, reward_id, transaction_id, points_spent, status, notes,
                    reviewed_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, CASE WHEN ?5 = 'approved' THEN datetime('now') ELSE NULL END)
                RETURNING id
            "#
        ))
        .bind(member_id)
        .bind(reward_id)
        .bind(transaction_id)
        .bind(points_spent)
        .bind(status)
        .bind(notes)
        .fetch_one(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    pub async fn approve_redemption(
        pool: &DbPool,
        redemption_id: i64,
        actor_user_id: i64,
    ) -> Result<LoyaltyRedemption, ApiError> {
        sqlx::query(sql_query!(
            postgres: r#"
                UPDATE loyalty_redemptions
                SET status = 'approved',
                    reviewed_by = $1,
                    reviewed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2 AND status = 'pending'
            "#,
            sqlite: r#"
                UPDATE loyalty_redemptions
                SET status = 'approved',
                    reviewed_by = ?1,
                    reviewed_at = datetime('now'),
                    updated_at = datetime('now')
                WHERE id = ?2 AND status = 'pending'
            "#
        ))
        .bind(actor_user_id)
        .bind(redemption_id)
        .execute(pool)
        .await
        .map_err(ApiError::from)?;

        Self::find_redemption(pool, redemption_id)
            .await?
            .ok_or_else(|| ApiError::NotFound("Redemption not found".to_string()))
    }

    pub async fn reject_redemption_status(
        tx: &mut DbTransaction<'_>,
        redemption_id: i64,
        actor_user_id: i64,
        reason: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(sql_query!(
            postgres: r#"
                UPDATE loyalty_redemptions
                SET status = 'rejected',
                    reviewed_by = $1,
                    reviewed_at = CURRENT_TIMESTAMP,
                    rejection_reason = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3 AND status = 'pending'
            "#,
            sqlite: r#"
                UPDATE loyalty_redemptions
                SET status = 'rejected',
                    reviewed_by = ?1,
                    reviewed_at = datetime('now'),
                    rejection_reason = ?2,
                    updated_at = datetime('now')
                WHERE id = ?3 AND status = 'pending'
            "#
        ))
        .bind(actor_user_id)
        .bind(reason)
        .bind(redemption_id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    pub async fn decrement_reward_inventory(
        tx: &mut DbTransaction<'_>,
        reward_id: i64,
    ) -> Result<(), ApiError> {
        sqlx::query(sql_query!(
            postgres: r#"
                UPDATE loyalty_rewards
                SET inventory_count = inventory_count - 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND inventory_count IS NOT NULL
            "#,
            sqlite: r#"
                UPDATE loyalty_rewards
                SET inventory_count = inventory_count - 1,
                    updated_at = datetime('now')
                WHERE id = ?1 AND inventory_count IS NOT NULL
            "#
        ))
        .bind(reward_id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }
}

fn member_summary_sql(where_clause: &str) -> String {
    format!(
        r#"
        SELECT
            lm.id,
            lm.guest_id,
            lm.member_number,
            lm.status,
            lm.enrolled_at,
            lm.closed_at,
            g.full_name AS guest_name,
            g.email AS guest_email,
            g.phone AS guest_phone,
            la.id AS account_id,
            COALESCE((SELECT SUM(available_delta) FROM loyalty_transactions lt WHERE lt.member_id = lm.id), 0) AS available_points,
            la.lifetime_points,
            la.qualifying_points,
            la.qualifying_nights,
            la.qualifying_spend,
            ltier.id AS tier_id,
            ltier.code AS tier_code,
            ltier.name AS tier_name
        FROM loyalty_members lm
        JOIN guests g ON g.id = lm.guest_id
        JOIN loyalty_accounts la ON la.member_id = lm.id
        JOIN loyalty_tiers ltier ON ltier.id = la.current_tier_id
        {where_clause}
        "#
    )
}

fn row_to_guest_profile(row: &DbRow) -> LoyaltyGuestProfile {
    LoyaltyGuestProfile {
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        full_name: row.try_get("full_name").unwrap_or_default(),
        email: row.try_get("email").ok(),
        phone: row.try_get("phone").ok(),
    }
}

fn row_to_rules(row: &DbRow) -> LoyaltyProgramRules {
    LoyaltyProgramRules {
        id: row.try_get("id").unwrap_or(1),
        points_per_currency_unit: decimal_or_f64(row, "points_per_currency_unit"),
        tier_qualification_metric: row
            .try_get("tier_qualification_metric")
            .unwrap_or_else(|_| "points".to_string()),
        point_expiry_months: row.try_get("point_expiry_months").ok(),
        redemption_approval_required: row_mappers::get_bool(row, "redemption_approval_required"),
        earning_enabled: row_mappers::get_bool(row, "earning_enabled"),
        min_eligible_amount: decimal_or_f64(row, "min_eligible_amount"),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
    }
}

fn row_to_tier(row: &DbRow) -> LoyaltyTier {
    LoyaltyTier {
        id: row.try_get("id").unwrap_or_default(),
        code: row.try_get("code").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        sort_order: row.try_get("sort_order").unwrap_or_default(),
        min_points: row.try_get("min_points").unwrap_or_default(),
        min_nights: row.try_get("min_nights").unwrap_or_default(),
        min_spend: decimal_or_f64(row, "min_spend"),
        benefits: json_array_from_row(row, "benefits"),
        is_active: row_mappers::get_bool(row, "is_active"),
    }
}

fn row_to_member_summary(row: &DbRow) -> LoyaltyMemberSummary {
    LoyaltyMemberSummary {
        id: row.try_get("id").unwrap_or_default(),
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        member_number: row.try_get("member_number").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_default(),
        enrolled_at: row.try_get("enrolled_at").unwrap_or_else(|_| Utc::now()),
        closed_at: row.try_get("closed_at").ok(),
        guest_name: row.try_get("guest_name").unwrap_or_default(),
        guest_email: row.try_get("guest_email").ok(),
        guest_phone: row.try_get("guest_phone").ok(),
        account_id: row.try_get("account_id").unwrap_or_default(),
        available_points: row.try_get("available_points").unwrap_or_default(),
        lifetime_points: row.try_get("lifetime_points").unwrap_or_default(),
        qualifying_points: row.try_get("qualifying_points").unwrap_or_default(),
        qualifying_nights: row.try_get("qualifying_nights").unwrap_or_default(),
        qualifying_spend: decimal_or_f64(row, "qualifying_spend"),
        tier_id: row.try_get("tier_id").unwrap_or_default(),
        tier_code: row.try_get("tier_code").unwrap_or_default(),
        tier_name: row.try_get("tier_name").unwrap_or_default(),
    }
}

fn row_to_transaction(row: &DbRow) -> LoyaltyTransaction {
    LoyaltyTransaction {
        id: row.try_get("id").unwrap_or_default(),
        member_id: row.try_get("member_id").unwrap_or_default(),
        account_id: row.try_get("account_id").unwrap_or_default(),
        transaction_type: row.try_get("transaction_type").unwrap_or_default(),
        points_delta: row.try_get("points_delta").unwrap_or_default(),
        available_delta: row.try_get("available_delta").unwrap_or_default(),
        balance_after: row.try_get("balance_after").unwrap_or_default(),
        source_type: row
            .try_get::<Option<String>, _>("source_type")
            .ok()
            .flatten(),
        source_id: row.try_get::<Option<i64>, _>("source_id").ok().flatten(),
        booking_id: row.try_get::<Option<i64>, _>("booking_id").ok().flatten(),
        payment_id: row.try_get::<Option<i64>, _>("payment_id").ok().flatten(),
        invoice_id: row.try_get::<Option<i64>, _>("invoice_id").ok().flatten(),
        related_transaction_id: row
            .try_get::<Option<i64>, _>("related_transaction_id")
            .ok()
            .flatten(),
        description: row
            .try_get::<Option<String>, _>("description")
            .ok()
            .flatten(),
        metadata: row
            .try_get::<Option<String>, _>("metadata")
            .ok()
            .flatten()
            .and_then(|raw| serde_json::from_str(&raw).ok()),
        actor_user_id: row
            .try_get::<Option<i64>, _>("actor_user_id")
            .ok()
            .flatten(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
    }
}

fn row_to_award_candidate(row: &DbRow) -> PaymentAwardCandidate {
    PaymentAwardCandidate {
        booking_id: row.try_get("booking_id").unwrap_or_default(),
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        payment_id: row.try_get("payment_id").unwrap_or_default(),
        invoice_id: row.try_get::<Option<i64>, _>("invoice_id").ok().flatten(),
        amount: row
            .try_get::<String, _>("amount")
            .ok()
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or_default(),
        nights: row.try_get("nights").unwrap_or(1),
    }
}

fn reward_select_sql() -> &'static str {
    r#"
        SELECT
            lr.id,
            lr.name,
            lr.description,
            lr.category,
            lr.points_cost,
            lr.minimum_tier_id,
            lt.name AS minimum_tier_name,
            lr.requires_approval,
            lr.is_active,
            lr.inventory_count,
            lr.valid_from,
            lr.valid_to,
            lr.terms_conditions,
            lr.created_at,
            lr.updated_at
        FROM loyalty_rewards lr
        LEFT JOIN loyalty_tiers lt ON lt.id = lr.minimum_tier_id
    "#
}

fn row_to_reward(row: &DbRow) -> LoyaltyReward {
    LoyaltyReward {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        description: row.try_get("description").ok(),
        category: row.try_get("category").unwrap_or_default(),
        points_cost: row.try_get("points_cost").unwrap_or_default(),
        minimum_tier_id: row
            .try_get::<Option<i64>, _>("minimum_tier_id")
            .ok()
            .flatten(),
        minimum_tier_name: row.try_get("minimum_tier_name").ok(),
        requires_approval: row_mappers::get_bool(row, "requires_approval"),
        is_active: row_mappers::get_bool(row, "is_active"),
        inventory_count: row
            .try_get::<Option<i32>, _>("inventory_count")
            .ok()
            .flatten(),
        valid_from: row.try_get("valid_from").ok(),
        valid_to: row.try_get("valid_to").ok(),
        terms_conditions: row.try_get("terms_conditions").ok(),
        created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
        updated_at: row.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
    }
}

fn redemption_select_sql() -> &'static str {
    r#"
        SELECT
            lr.id,
            lr.member_id,
            lm.member_number,
            g.full_name AS guest_name,
            g.email AS guest_email,
            lr.reward_id,
            rw.name AS reward_name,
            lr.points_spent,
            lr.status,
            lr.transaction_id,
            lr.requested_at,
            lr.reviewed_by,
            lr.reviewed_at,
            lr.rejection_reason,
            lr.notes
        FROM loyalty_redemptions lr
        JOIN loyalty_members lm ON lm.id = lr.member_id
        JOIN guests g ON g.id = lm.guest_id
        JOIN loyalty_rewards rw ON rw.id = lr.reward_id
    "#
}

fn row_to_redemption(row: &DbRow) -> LoyaltyRedemption {
    LoyaltyRedemption {
        id: row.try_get("id").unwrap_or_default(),
        member_id: row.try_get("member_id").unwrap_or_default(),
        member_number: row.try_get("member_number").unwrap_or_default(),
        guest_name: row.try_get("guest_name").unwrap_or_default(),
        guest_email: row.try_get("guest_email").ok(),
        reward_id: row.try_get("reward_id").unwrap_or_default(),
        reward_name: row.try_get("reward_name").unwrap_or_default(),
        points_spent: row.try_get("points_spent").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_default(),
        transaction_id: row.try_get("transaction_id").ok(),
        requested_at: row.try_get("requested_at").unwrap_or_else(|_| Utc::now()),
        reviewed_by: row.try_get("reviewed_by").ok(),
        reviewed_at: row.try_get("reviewed_at").ok(),
        rejection_reason: row.try_get("rejection_reason").ok(),
        notes: row.try_get("notes").ok(),
    }
}

fn json_array(raw: Option<String>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

fn json_array_from_row(row: &DbRow, column: &str) -> Vec<String> {
    if let Ok(raw) = row.try_get::<String, _>(column) {
        return json_array(Some(raw));
    }
    row.try_get::<serde_json::Value, _>(column)
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

fn decimal_or_f64(row: &DbRow, column: &str) -> f64 {
    row_mappers::get_decimal(row, column)
        .to_f64()
        .unwrap_or(0.0)
}

fn _date(row: &DbRow, column: &str) -> Option<NaiveDate> {
    row.try_get(column).ok()
}

fn _datetime(row: &DbRow, column: &str) -> Option<DateTime<Utc>> {
    row.try_get(column).ok()
}
