//! Loyalty program business logic

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::PointsTransaction;

/// Resolve a user account to their linked guest ID via email matching.
///
/// The portal links a user account to a guest profile by matching email.
/// Returns `NotFound` if the user or the guest profile doesn't exist.
pub async fn resolve_user_to_guest(pool: &DbPool, user_id: i64) -> Result<i64, ApiError> {
    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("User not found".to_string()))?;

    let guest_id: i64 =
        sqlx::query_scalar("SELECT id FROM guests WHERE email = $1 AND deleted_at IS NULL")
            .bind(&email)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
            .ok_or_else(|| {
                ApiError::NotFound(
            "Guest profile not found. Please contact support to enroll in the loyalty programme."
                .to_string(),
        )
            })?;

    Ok(guest_id)
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
    let membership = sqlx::query_as::<_, crate::models::LoyaltyMembership>(
        "SELECT * FROM loyalty_memberships WHERE id = $1",
    )
    .bind(membership_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
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
