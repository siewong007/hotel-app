//! Guest portal session + guest-scoped read data access.
//!
//! Backs the self-service guest portal (login, history, membership, benefits).
//! All reads are scoped to a single `guest_id` resolved from a bearer session;
//! no raw tokens are ever stored or returned here (only SHA-256 hashes).

use chrono::{DateTime, Utc};
use sqlx::Row;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::models::{
    GuestPortalBookingSummary, GuestPortalGuestView, GuestPortalMembership,
    GuestPortalPointsActivity, GuestPortalReward, GuestPortalTierBenefit, GuestPortalTransaction,
};
use crate::sql_query;
use crate::{core::sql_compat::current_timestamp, param};

pub struct GuestPortalSessionRepository;

impl GuestPortalSessionRepository {
    /// Find a guest whose email matches (case-insensitive) AND who either owns a
    /// booking with `booking_number` (any status) or holds a loyalty membership
    /// with `member_number`. Returns the guest id, or None if nothing matches.
    pub async fn find_login_guest_id(
        pool: &DbPool,
        email: &str,
        booking_number: Option<&str>,
        member_number: Option<&str>,
    ) -> Result<Option<i64>, ApiError> {
        let email_norm = email.trim().to_lowercase();

        if let Some(booking_number) = booking_number {
            let sql = format!(
                "SELECT g.id FROM guests g \
                 JOIN bookings b ON b.guest_id = g.id \
                 WHERE LOWER(g.email) = {} AND b.booking_number = {} LIMIT 1",
                param!(1),
                param!(2)
            );
            let row = sqlx::query(&sql)
                .bind(&email_norm)
                .bind(booking_number.trim())
                .fetch_optional(pool)
                .await
                .map_err(|e| ApiError::Database(format!("Login lookup failed: {}", e)))?;
            if let Some(row) = row {
                let id: i64 = row.try_get("id").unwrap_or_default();
                return Ok(Some(id));
            }
        }

        if let Some(member_number) = member_number {
            let sql = format!(
                "SELECT g.id FROM guests g \
                 JOIN loyalty_members m ON m.guest_id = g.id \
                 WHERE LOWER(g.email) = {} AND m.member_number = {} LIMIT 1",
                param!(1),
                param!(2)
            );
            let row = sqlx::query(&sql)
                .bind(&email_norm)
                .bind(member_number.trim())
                .fetch_optional(pool)
                .await
                .map_err(|e| ApiError::Database(format!("Login lookup failed: {}", e)))?;
            if let Some(row) = row {
                let id: i64 = row.try_get("id").unwrap_or_default();
                return Ok(Some(id));
            }
        }

        Ok(None)
    }

    /// Insert a new portal session storing only the token hash.
    pub async fn create_session(
        pool: &DbPool,
        guest_id: i64,
        token_hash: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<(), ApiError> {
        let sql = format!(
            "INSERT INTO guest_portal_sessions (guest_id, token_hash, expires_at) \
             VALUES ({}, {}, {})",
            param!(1),
            param!(2),
            param!(3)
        );
        sqlx::query(&sql)
            .bind(guest_id)
            .bind(token_hash)
            .bind(expires_at)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to create session: {}", e)))?;
        Ok(())
    }

    /// Resolve an unexpired session by token hash, returning its guest id and
    /// bumping `last_used_at`. Returns None if no matching unexpired session.
    pub async fn touch_session_guest_id(
        pool: &DbPool,
        token_hash: &str,
    ) -> Result<Option<i64>, ApiError> {
        let select_sql = format!(
            "SELECT guest_id FROM guest_portal_sessions \
             WHERE token_hash = {} AND expires_at > {} LIMIT 1",
            param!(1),
            current_timestamp()
        );
        let row = sqlx::query(&select_sql)
            .bind(token_hash)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Session lookup failed: {}", e)))?;

        let Some(row) = row else {
            return Ok(None);
        };
        let guest_id: i64 = row.try_get("guest_id").unwrap_or_default();

        let update_sql = format!(
            "UPDATE guest_portal_sessions SET last_used_at = {} WHERE token_hash = {}",
            current_timestamp(),
            param!(1)
        );
        // Best-effort last_used bookkeeping; a failure here must not block reads.
        let _ = sqlx::query(&update_sql)
            .bind(token_hash)
            .execute(pool)
            .await;

        Ok(Some(guest_id))
    }

    /// Bookings owned by the guest, newest first, paginated. Returns (items, total).
    pub async fn list_bookings(
        pool: &DbPool,
        guest_id: i64,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<GuestPortalBookingSummary>, i64), ApiError> {
        let count_sql = format!(
            "SELECT COUNT(*) AS c FROM bookings WHERE guest_id = {}",
            param!(1)
        );
        let total: i64 = sqlx::query(&count_sql)
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Booking count failed: {}", e)))?
            .try_get("c")
            .unwrap_or_default();

        let sql = format!(
            "SELECT booking_number, check_in_date, check_out_date, status, total_amount \
             FROM bookings WHERE guest_id = {} \
             ORDER BY check_in_date DESC, id DESC LIMIT {} OFFSET {}",
            param!(1),
            param!(2),
            param!(3)
        );
        let rows = sqlx::query(&sql)
            .bind(guest_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Booking list failed: {}", e)))?;

        let items = rows
            .iter()
            .map(|row| GuestPortalBookingSummary {
                booking_number: row.try_get("booking_number").unwrap_or_default(),
                check_in_date: row
                    .try_get("check_in_date")
                    .unwrap_or_else(|_| chrono::NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
                check_out_date: row
                    .try_get("check_out_date")
                    .unwrap_or_else(|_| chrono::NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
                status: row.try_get("status").unwrap_or_default(),
                total_amount: row_mappers::get_decimal(row, "total_amount"),
            })
            .collect();

        Ok((items, total))
    }

    /// Payments (via the guest's bookings) UNION invoices billed to the guest,
    /// newest first, paginated. Returns (items, total).
    /// Guest-safe profile view by id. Selects only the columns the portal
    /// exposes — deliberately NOT `SELECT *` into `Guest`, whose decode depends
    /// on columns (e.g. `is_active`) that are absent from the checked-in
    /// schema files.
    pub async fn find_guest_view(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<GuestPortalGuestView, ApiError> {
        let sql = format!(
            "SELECT full_name, title, email, phone, alt_phone, ic_number, nationality, \
                    address_line1, city, state_province, postal_code, country \
             FROM guests WHERE id = {}",
            param!(1)
        );
        let row = sqlx::query(&sql)
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to fetch guest profile: {}", e)))?;

        Ok(GuestPortalGuestView {
            full_name: row.try_get("full_name").unwrap_or_default(),
            title: row.try_get("title").ok().flatten(),
            email: row.try_get("email").ok().flatten(),
            phone: row.try_get("phone").ok().flatten(),
            alt_phone: row.try_get("alt_phone").ok().flatten(),
            ic_number: row.try_get("ic_number").ok().flatten(),
            nationality: row.try_get("nationality").ok().flatten(),
            address_line1: row.try_get("address_line1").ok().flatten(),
            city: row.try_get("city").ok().flatten(),
            state_province: row.try_get("state_province").ok().flatten(),
            postal_code: row.try_get("postal_code").ok().flatten(),
            country: row.try_get("country").ok().flatten(),
        })
    }

    pub async fn list_transactions(
        pool: &DbPool,
        guest_id: i64,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<GuestPortalTransaction>, i64), ApiError> {
        // Each half selects a uniform column set so the halves union cleanly.
        // kind/date/amount/method/reference/invoice_number/booking_number/status
        let union_body = format!(
            "SELECT 'payment' AS kind, p.created_at AS occurred_at, p.amount AS amount, \
                    p.payment_method AS method, p.{payment_ref_col} AS reference, \
                    NULL AS invoice_number, b.booking_number AS booking_number, \
                    p.status AS status \
             FROM payments p JOIN bookings b ON b.id = p.booking_id \
             WHERE b.guest_id = {g} \
             UNION ALL \
             SELECT 'invoice' AS kind, i.created_at AS occurred_at, i.total_amount AS amount, \
                    NULL AS method, NULL AS reference, \
                    i.invoice_number AS invoice_number, b2.booking_number AS booking_number, \
                    i.status AS status \
             FROM invoices i JOIN bookings b2 ON b2.id = i.booking_id \
             WHERE i.{invoice_guest_col} = {g}",
            // Postgres and SQLite name these columns differently.
            payment_ref_col = sql_query!(postgres: "transaction_id", sqlite: "reference_number"),
            invoice_guest_col = sql_query!(postgres: "bill_to_guest_id", sqlite: "guest_id"),
            g = param!(1)
        );

        let count_sql = format!("SELECT COUNT(*) AS c FROM ({}) t", union_body);
        let total: i64 = sqlx::query(&count_sql)
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Transaction count failed: {}", e)))?
            .try_get("c")
            .unwrap_or_default();

        let sql = format!(
            "SELECT * FROM ({}) t ORDER BY occurred_at DESC LIMIT {} OFFSET {}",
            union_body,
            param!(2),
            param!(3)
        );
        let rows = sqlx::query(&sql)
            .bind(guest_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Transaction list failed: {}", e)))?;

        let items = rows
            .iter()
            .map(|row| GuestPortalTransaction {
                kind: row.try_get("kind").unwrap_or_default(),
                date: row.try_get("occurred_at").unwrap_or_else(|_| Utc::now()),
                amount: row_mappers::get_decimal(row, "amount"),
                method: row.try_get("method").ok(),
                reference: row.try_get("reference").ok(),
                invoice_number: row.try_get("invoice_number").ok(),
                booking_number: row.try_get("booking_number").ok(),
                status: row.try_get("status").ok(),
            })
            .collect();

        Ok((items, total))
    }

    /// Membership summary for the guest, or None if not enrolled. Points balance
    /// is the running SUM of available_delta over the member's transactions,
    /// matching the loyalty module's own computation.
    pub async fn find_membership(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Option<GuestPortalMembership>, ApiError> {
        let sql = format!(
            "SELECT m.member_number AS member_number, m.status AS status, \
                    t.name AS tier_name, t.sort_order AS tier_level, \
                    a.lifetime_points AS lifetime_points, \
                    COALESCE((SELECT SUM(lt.available_delta) FROM loyalty_transactions lt \
                              WHERE lt.member_id = m.id), 0) AS points_balance \
             FROM loyalty_members m \
             JOIN loyalty_accounts a ON a.member_id = m.id \
             JOIN loyalty_tiers t ON t.id = a.current_tier_id \
             WHERE m.guest_id = {} LIMIT 1",
            param!(1)
        );
        let row = sqlx::query(&sql)
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Membership lookup failed: {}", e)))?;

        Ok(row.map(|row| GuestPortalMembership {
            member_number: row.try_get("member_number").unwrap_or_default(),
            tier_name: row.try_get("tier_name").unwrap_or_default(),
            tier_level: row.try_get("tier_level").unwrap_or_default(),
            points_balance: row.try_get("points_balance").unwrap_or_default(),
            lifetime_points: row.try_get("lifetime_points").unwrap_or_default(),
            status: row.try_get("status").unwrap_or_default(),
        }))
    }

    /// Last 20 points-activity rows for the guest's membership, newest first.
    pub async fn recent_points_activity(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Vec<GuestPortalPointsActivity>, ApiError> {
        let sql = format!(
            "SELECT lt.created_at AS occurred_at, lt.transaction_type AS transaction_type, \
                    lt.points_delta AS points, lt.balance_after AS balance_after \
             FROM loyalty_transactions lt \
             JOIN loyalty_members m ON m.id = lt.member_id \
             WHERE m.guest_id = {} \
             ORDER BY lt.created_at DESC, lt.id DESC LIMIT 20",
            param!(1)
        );
        let rows = sqlx::query(&sql)
            .bind(guest_id)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Points activity failed: {}", e)))?;

        Ok(rows
            .iter()
            .map(|row| GuestPortalPointsActivity {
                date: row.try_get("occurred_at").unwrap_or_else(|_| Utc::now()),
                transaction_type: row.try_get("transaction_type").unwrap_or_default(),
                points: row.try_get("points").unwrap_or_default(),
                balance_after: row.try_get("balance_after").unwrap_or_default(),
            })
            .collect())
    }

    /// Tier benefits for the guest's current tier. The live loyalty schema does
    /// not carry a per-tier discount percentage, so `discount_percentage` is
    /// reported as 0 (see open risks in the module docs / PR notes).
    pub async fn tier_benefits(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Vec<GuestPortalTierBenefit>, ApiError> {
        let sql = format!(
            "SELECT t.name AS tier_name \
             FROM loyalty_members m \
             JOIN loyalty_accounts a ON a.member_id = m.id \
             JOIN loyalty_tiers t ON t.id = a.current_tier_id \
             WHERE m.guest_id = {} LIMIT 1",
            param!(1)
        );
        let rows = sqlx::query(&sql)
            .bind(guest_id)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Tier benefits lookup failed: {}", e)))?;

        Ok(rows
            .iter()
            .map(|row| GuestPortalTierBenefit {
                tier_name: row.try_get("tier_name").unwrap_or_default(),
                discount_percentage: rust_decimal::Decimal::ZERO,
            })
            .collect())
    }

    /// Active reward-catalog rows valid today, with an affordability flag against
    /// the guest's current available points balance (0 if not enrolled).
    pub async fn rewards(
        pool: &DbPool,
        points_balance: i32,
    ) -> Result<Vec<GuestPortalReward>, ApiError> {
        // valid_from/valid_to are dates; open-ended when null.
        let is_active = crate::core::sql_compat::bool_true();
        let today = crate::core::sql_compat::current_date();
        let sql = sql_query!(
            postgres: format!(
                "SELECT id, name, description, category, points_cost \
                 FROM loyalty_rewards \
                 WHERE is_active = {active} \
                   AND (valid_from IS NULL OR valid_from <= {today}) \
                   AND (valid_to IS NULL OR valid_to >= {today}) \
                 ORDER BY points_cost ASC, id ASC",
                active = is_active,
                today = today
            ),
            sqlite: format!(
                "SELECT id, name, description, category, points_cost \
                 FROM loyalty_rewards \
                 WHERE is_active = {active} \
                   AND (valid_from IS NULL OR valid_from <= {today}) \
                   AND (valid_to IS NULL OR valid_to >= {today}) \
                 ORDER BY points_cost ASC, id ASC",
                active = is_active,
                today = today
            )
        );
        let rows = sqlx::query(&sql)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Reward lookup failed: {}", e)))?;

        Ok(rows
            .iter()
            .map(|row| {
                let points_required: i32 = row.try_get("points_cost").unwrap_or_default();
                GuestPortalReward {
                    id: row.try_get("id").unwrap_or_default(),
                    name: row.try_get("name").unwrap_or_default(),
                    description: row.try_get("description").ok(),
                    category: row.try_get("category").unwrap_or_default(),
                    points_required,
                    affordable: points_balance >= points_required,
                }
            })
            .collect())
    }
}
