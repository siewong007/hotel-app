//! Guest portal session + guest-scoped read data access.
//!
//! Backs the self-service guest portal (login, history, membership, benefits).
//! All reads are scoped to a single `guest_id` resolved from a bearer session;
//! no raw tokens are ever stored or returned here (only SHA-256 hashes).

use chrono::{DateTime, Utc};
use sqlx::Row;
use std::collections::HashSet;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::models::{
    GuestPortalBookingSummary, GuestPortalGuestView, GuestPortalMembership,
    GuestPortalPointsActivity, GuestPortalReward, GuestPortalRoomTypeCredit, GuestPortalTierBenefit,
    GuestPortalTransaction,
};
use crate::{core::sql_compat::current_timestamp, param};

/// Free-text booking filter, shared by the count and page queries so the total
/// always describes the same rows the guest is being shown. `$2` is the
/// already-wrapped `%term%`, or NULL to match everything.
const BOOKING_SEARCH_PREDICATE: &str = concat!(
    "(", param!(2), " IS NULL",
    " OR b.booking_number ILIKE ", param!(2),
    " OR b.status ILIKE ", param!(2),
    " OR b.check_in_date::text ILIKE ", param!(2),
    " OR b.check_out_date::text ILIKE ", param!(2),
    ")"
);

pub struct GuestPortalSessionRepository;

impl GuestPortalSessionRepository {
    /// Revoke a portal session by its hashed bearer token.
    pub async fn delete_session(pool: &DbPool, token_hash: &str) -> Result<(), ApiError> {
        let sql = format!(
            "DELETE FROM guest_portal_sessions WHERE token_hash = {}",
            param!(1)
        );
        sqlx::query(&sql)
            .bind(token_hash)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to revoke guest session: {}", e)))?;
        Ok(())
    }

    /// Resolve the guest profile linked to an active guest user account.
    pub async fn find_guest_id_for_authenticated_user(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<Option<i64>, ApiError> {
        let sql = "SELECT guest_id FROM users WHERE id = $1 AND user_type::text = 'guest' AND guest_id IS NOT NULL AND is_active = true";
        sqlx::query_scalar(sql)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Guest account lookup failed: {}", e)))
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
    ///
    /// `search` matches booking number, status, or stay dates. The pages are
    /// server-side, so filtering has to happen here — a client-side filter would
    /// only ever search the page the guest is looking at.
    pub async fn list_bookings(
        pool: &DbPool,
        guest_id: i64,
        limit: i64,
        offset: i64,
        search: Option<&str>,
    ) -> Result<(Vec<GuestPortalBookingSummary>, i64), ApiError> {
        // Bound as NULL when absent rather than branching the SQL, so the
        // placeholder positions never shift between the two shapes. `%` and `_`
        // are escaped so a guest typing them searches for the character instead
        // of matching every booking.
        let search_term = search.map(str::trim).filter(|v| !v.is_empty()).map(|v| {
            let escaped = v
                .replace('\\', r"\\")
                .replace('%', r"\%")
                .replace('_', r"\_");
            format!("%{escaped}%")
        });
        let count_sql = format!(
            "SELECT COUNT(*) AS c FROM bookings b WHERE b.guest_id = {} AND {}",
            param!(1),
            BOOKING_SEARCH_PREDICATE
        );
        let total: i64 = sqlx::query(&count_sql)
            .bind(guest_id)
            .bind(search_term.as_deref())
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Booking count failed: {}", e)))?
            .try_get("c")
            .unwrap_or_default();

        // Postgres records a rejected claim's reason in `failure_reason`
        // (`void_reason`/`voided_at`) — see mark_payment_rejected_tx.
        let rejection_reason_col = "failure_reason";
        let rejected_at_col = "processed_at";
        let sql = format!(
            "SELECT b.id, b.booking_number, b.check_in_date, b.check_out_date, b.status, b.total_amount, \
                    (SELECT cp.id FROM payments cp WHERE cp.booking_id = b.id AND cp.status = 'completed' \
                        ORDER BY cp.id DESC LIMIT 1) AS completed_payment_id, \
                    (SELECT cp.payment_method FROM payments cp WHERE cp.booking_id = b.id AND cp.status = 'completed' \
                        ORDER BY cp.id DESC LIMIT 1) AS completed_payment_method, \
                    (SELECT cp.amount FROM payments cp WHERE cp.booking_id = b.id AND cp.status = 'completed' \
                        ORDER BY cp.id DESC LIMIT 1) AS completed_payment_amount, \
                    EXISTS(SELECT 1 FROM voucher_redemptions vr JOIN promotions p ON p.id = vr.promotion_id \
                           WHERE vr.booking_id = b.id AND vr.status = 'applied' AND p.is_cancellable = {}) AS has_non_cancellable_voucher, \
                    (SELECT rp.{rejection_reason_col} FROM payments rp WHERE rp.booking_id = b.id \
                            AND rp.status = 'void' ORDER BY rp.{rejected_at_col} DESC, rp.id DESC LIMIT 1) \
                            AS payment_rejection_reason, \
                    (SELECT p.id FROM payments p JOIN payment_receipt_requests pr ON pr.payment_id = p.id \
                        WHERE p.booking_id = b.id AND p.status = 'pending' AND p.payment_method = 'bank_transfer' \
                            AND pr.uploaded_at IS NULL \
                        ORDER BY pr.requested_at DESC, p.id DESC LIMIT 1) AS receipt_request_payment_id, \
                    (SELECT pr.request_message FROM payments p JOIN payment_receipt_requests pr ON pr.payment_id = p.id \
                        WHERE p.booking_id = b.id AND p.status = 'pending' AND pr.uploaded_at IS NULL \
                        ORDER BY pr.requested_at DESC LIMIT 1) AS receipt_request_message, \
                    EXISTS(SELECT 1 FROM payments p JOIN payment_receipt_requests pr ON pr.payment_id = p.id \
                        WHERE p.booking_id = b.id AND p.status = 'pending' AND pr.uploaded_at IS NOT NULL) \
                        AS receipt_uploaded \
             FROM bookings b WHERE b.guest_id = {} AND {} \
             ORDER BY b.check_in_date DESC, b.id DESC LIMIT {} OFFSET {}",
            false,
            param!(1),
            BOOKING_SEARCH_PREDICATE,
            param!(3),
            param!(4)
        );
        let rows = sqlx::query(&sql)
            .bind(guest_id)
            .bind(search_term.as_deref())
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Booking list failed: {}", e)))?;

        let items = rows
            .iter()
            .map(|row| GuestPortalBookingSummary {
                id: row.try_get("id").unwrap_or_default(),
                booking_number: row.try_get("booking_number").unwrap_or_default(),
                check_in_date: row
                    .try_get("check_in_date")
                    .unwrap_or_else(|_| chrono::NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
                check_out_date: row
                    .try_get("check_out_date")
                    .unwrap_or_else(|_| chrono::NaiveDate::from_ymd_opt(2000, 1, 1).unwrap()),
                status: row.try_get("status").unwrap_or_default(),
                total_amount: row_mappers::get_decimal(row, "total_amount"),
                completed_payment_id: row
                    .try_get::<Option<i64>, _>("completed_payment_id")
                    .ok()
                    .flatten(),
                completed_payment_method: row
                    .try_get::<Option<String>, _>("completed_payment_method")
                    .ok()
                    .flatten(),
                completed_payment_amount: row_mappers::get_opt_decimal(
                    row,
                    "completed_payment_amount",
                ),
                can_cancel: false,
                cancellation_unavailable_reason: if row
                    .try_get::<bool, _>("has_non_cancellable_voucher")
                    .unwrap_or(false)
                {
                    Some("This booking uses a non-cancellable voucher.".to_string())
                } else {
                    None
                },
                payment_rejection_reason: row
                    .try_get::<Option<String>, _>("payment_rejection_reason")
                    .ok()
                    .flatten(),
                receipt_request_payment_id: row
                    .try_get::<Option<i64>, _>("receipt_request_payment_id")
                    .ok()
                    .flatten(),
                receipt_request_message: row
                    .try_get::<Option<String>, _>("receipt_request_message")
                    .ok()
                    .flatten(),
                receipt_uploaded: row.try_get::<bool, _>("receipt_uploaded").unwrap_or(false),
            })
            .collect();

        Ok((items, total))
    }

    pub async fn find_guest_user_id(pool: &DbPool, guest_id: i64) -> Result<Option<i64>, ApiError> {
        sqlx::query_scalar("SELECT id FROM users WHERE guest_id = $1 AND user_type::text = 'guest' AND is_active = true ORDER BY id LIMIT 1")
        .bind(guest_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
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
                        address_line_1 AS address_line1, city, state AS state_province, postal_code, country \
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
            payment_ref_col = "transaction_id",
            invoice_guest_col = "bill_to_guest_id",
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

        row.map(|row| {
            // PostgreSQL promotes SUM(INTEGER) to BIGINT. Decode the ledger
            // balance as i64, then fail explicitly if a
            // corrupt/out-of-range balance cannot fit the public i32 contract.
            let points_balance: i64 = row.try_get("points_balance").map_err(ApiError::from)?;
            let points_balance = i32::try_from(points_balance).map_err(|_| {
                ApiError::Internal("Loyalty points balance is out of range.".to_string())
            })?;

            Ok(GuestPortalMembership {
                member_number: row.try_get("member_number").unwrap_or_default(),
                tier_name: row.try_get("tier_name").unwrap_or_default(),
                tier_level: row.try_get("tier_level").unwrap_or_default(),
                points_balance,
                lifetime_points: row.try_get("lifetime_points").unwrap_or_default(),
                status: row.try_get("status").unwrap_or_default(),
            })
        })
        .transpose()
    }

    /// Last 20 points-activity rows for the guest's membership, newest first.
    pub async fn recent_points_activity(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Vec<GuestPortalPointsActivity>, ApiError> {
        let sql = format!(
            "SELECT lt.created_at AS occurred_at, lt.transaction_type AS transaction_type, \
                    lt.points_delta AS points, lt.balance_after AS balance_after, \
                    lt.description AS reason, b.booking_number AS booking_number, \
                    CASE WHEN lt.transaction_type = 'adjusted' \
                         THEN COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) \
                         ELSE NULL END AS adjusted_by \
             FROM loyalty_transactions lt \
             JOIN loyalty_members m ON m.id = lt.member_id \
             LEFT JOIN bookings b ON b.id = lt.booking_id \
             LEFT JOIN users u ON u.id = lt.actor_user_id \
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
                reason: row.try_get("reason").ok(),
                booking_number: row.try_get("booking_number").ok(),
                adjusted_by: row.try_get("adjusted_by").ok(),
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

    /// Complimentary-night credits held by one guest, per room type.
    ///
    /// Scoped by the caller's session `guest_id` — the portal never resolves
    /// credit ownership through the guest's email address. Exhausted rows are
    /// filtered out, and `notes` is deliberately not selected: it is a
    /// staff-facing remark on the grant, not guest-facing copy.
    pub async fn complimentary_credits(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Vec<GuestPortalRoomTypeCredit>, ApiError> {
        let sql = format!(
            "SELECT rt.id AS room_type_id, rt.code AS room_type_code, rt.name AS room_type_name, \
                    gc.nights_available \
             FROM guest_complimentary_credits gc \
             JOIN room_types rt ON rt.id = gc.room_type_id \
             WHERE gc.guest_id = {} AND gc.nights_available > 0 \
             ORDER BY rt.name ASC, rt.id ASC",
            param!(1)
        );
        let rows = sqlx::query(&sql)
            .bind(guest_id)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Complimentary credit lookup failed: {}", e)))?;

        Ok(rows
            .iter()
            .map(|row| GuestPortalRoomTypeCredit {
                room_type_id: row.try_get("room_type_id").unwrap_or_default(),
                room_type_code: row.try_get("room_type_code").unwrap_or_default(),
                room_type_name: row.try_get("room_type_name").unwrap_or_default(),
                nights_available: row.try_get("nights_available").unwrap_or_default(),
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
        let sql = format!(
            "SELECT id, name, description, category, points_cost \
                 FROM loyalty_rewards \
                 WHERE is_active = {active} \
                   AND (valid_from IS NULL OR valid_from <= {today}) \
                   AND (valid_to IS NULL OR valid_to >= {today}) \
                 ORDER BY points_cost ASC, id ASC",
            active = is_active,
            today = today
        );
        let rows = sqlx::query(&sql)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Reward lookup failed: {}", e)))?;

        let mut displayed_rewards = HashSet::new();
        Ok(rows
            .iter()
            .filter_map(|row| {
                let points_required: i32 = row.try_get("points_cost").unwrap_or_default();
                let name: String = row.try_get("name").unwrap_or_default();
                let description: Option<String> = row.try_get("description").ok();
                let category: String = row.try_get("category").unwrap_or_default();
                let reward_key = (
                    name.clone(),
                    description.clone(),
                    category.clone(),
                    points_required,
                );

                displayed_rewards
                    .insert(reward_key)
                    .then_some(GuestPortalReward {
                        id: row.try_get("id").unwrap_or_default(),
                        name,
                        description,
                        category,
                        points_required,
                        affordable: points_balance >= points_required,
                    })
            })
            .collect())
    }
}
