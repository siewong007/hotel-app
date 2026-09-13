//! Persistence for the Guest Relations workspace.
//!
//! Owns `guest_notes` (interactions) and `guest_preferences`, and performs
//! read-only joins into the loyalty, promotions/vouchers, communications and
//! support domains. Mutations to those domains stay with their own modules —
//! the cross-domain methods below delegate to the owning repositories.

use chrono::{DateTime, Utc};
use sqlx::Row;

use super::models::*;
use crate::core::db::{DbDatabase, DbPool, DbRow, DbTransaction};
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::modules::communications::repository::CommunicationsRepository;
use crate::modules::loyalty::repository::LoyaltyRepository;
use crate::modules::support::models::SupportConversationSummary;

/// Resolved column values for a new `guest_notes` row. The service has
/// already validated and normalized everything (interaction type allowlist,
/// sanitized subject/content); `note_type` stays on its `'general'` column
/// default — the interaction vocabulary lives on `interaction_type`.
pub struct NewInteraction {
    pub interaction_type: String,
    pub subject: Option<String>,
    pub content: String,
    pub booking_id: Option<i64>,
    pub is_alert: bool,
    pub is_private: bool,
    pub follow_up_at: Option<DateTime<Utc>>,
    pub assigned_to: Option<i64>,
}

/// Resolved column values for a `guest_notes` update. Every field carries the
/// value to persist (the service merges the patch over the existing row), so
/// the update is a plain column assignment. `follow_up_completed_at` is the
/// resolved timestamp: `Some(now)` to complete, `None` to reopen, or the
/// existing value to leave unchanged.
pub struct InteractionUpdateValues {
    pub subject: Option<String>,
    pub content: String,
    pub interaction_type: String,
    pub is_alert: bool,
    pub follow_up_at: Option<DateTime<Utc>>,
    pub follow_up_completed_at: Option<DateTime<Utc>>,
    pub assigned_to: Option<i64>,
}

/// Consent/contact fields read off the `guests` row for the communications
/// summary. `email` is included so the caller can run the suppression check
/// without a second fetch.
pub struct GuestConsentState {
    pub email: Option<String>,
    pub marketing_opt_in: bool,
    pub communication_preference: Option<String>,
    pub language_preference: Option<String>,
}

fn opt<T>(row: &DbRow, column: &str) -> Option<T>
where
    for<'r> T: sqlx::Decode<'r, DbDatabase> + sqlx::Type<DbDatabase> + Send + Unpin,
{
    row.try_get::<Option<T>, _>(column).ok().flatten()
}

fn required_timestamp(row: &DbRow, column: &str) -> DateTime<Utc> {
    row.try_get(column).unwrap_or_else(|_| Utc::now())
}

fn interaction_from_row(row: &DbRow) -> GuestInteraction {
    GuestInteraction {
        id: row.try_get("id").unwrap_or_default(),
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        interaction_type: row
            .try_get("interaction_type")
            .unwrap_or_else(|_| "note".to_string()),
        note_type: row
            .try_get("note_type")
            .unwrap_or_else(|_| "general".to_string()),
        subject: opt(row, "subject"),
        content: row.try_get("content").unwrap_or_default(),
        booking_id: opt(row, "booking_id"),
        is_alert: row_mappers::get_bool(row, "is_alert"),
        is_private: row_mappers::get_bool(row, "is_private"),
        follow_up_at: opt(row, "follow_up_at"),
        follow_up_completed_at: opt(row, "follow_up_completed_at"),
        assigned_to: opt(row, "assigned_to"),
        assigned_to_name: opt(row, "assigned_to_name"),
        created_by: opt(row, "created_by"),
        created_by_name: opt(row, "created_by_name"),
        created_at: required_timestamp(row, "created_at"),
        updated_at: required_timestamp(row, "updated_at"),
    }
}

fn preference_from_row(row: &DbRow) -> GuestPreference {
    GuestPreference {
        id: row.try_get("id").unwrap_or_default(),
        category: row.try_get("category").unwrap_or_default(),
        preference_key: row.try_get("preference_key").unwrap_or_default(),
        preference_value: row.try_get("preference_value").unwrap_or_default(),
        updated_at: required_timestamp(row, "updated_at"),
    }
}

fn review_from_row(row: &DbRow) -> GuestReviewRow {
    GuestReviewRow {
        id: row.try_get("id").unwrap_or_default(),
        booking_id: opt(row, "booking_id"),
        overall_rating: row.try_get("overall_rating").unwrap_or_default(),
        title: opt(row, "title"),
        content: opt(row, "content"),
        response: opt(row, "response"),
        response_at: opt(row, "response_at"),
        is_published: row_mappers::get_bool(row, "is_published"),
        created_at: required_timestamp(row, "created_at"),
    }
}

fn voucher_from_row(row: &DbRow) -> GuestVoucherRow {
    GuestVoucherRow {
        id: row.try_get("id").unwrap_or_default(),
        code: row.try_get("code").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_default(),
        source: row.try_get("source").unwrap_or_default(),
        promotion_id: row.try_get("promotion_id").unwrap_or_default(),
        promotion_name: opt(row, "promotion_name"),
        promotion_slug: opt(row, "promotion_slug"),
        expires_at: opt(row, "expires_at"),
        redeemed_at: opt(row, "redeemed_at"),
    }
}

fn delivery_from_row(row: &DbRow) -> GuestDeliveryRow {
    GuestDeliveryRow {
        id: row.try_get("id").unwrap_or_default(),
        kind: row.try_get("kind").unwrap_or_default(),
        subject: opt(row, "subject"),
        status: row.try_get("status").unwrap_or_default(),
        created_at: required_timestamp(row, "created_at"),
    }
}

/// Compact local mapping for the staff support summary. The support module's
/// `summary_from_row` is private, so the same SLA flags are computed here from
/// the identical due-date rules (`modules::support::repository`).
fn support_summary_from_row(row: &DbRow) -> SupportConversationSummary {
    let first_response_due_at = opt(row, "first_response_due_at");
    let resolution_due_at = opt(row, "resolution_due_at");
    let first_response_at = opt(row, "first_response_at");
    let resolved_at = opt::<DateTime<Utc>>(row, "resolved_at");
    let status: String = row.try_get("status").unwrap_or_default();
    let now = Utc::now();
    let active_due = if first_response_at.is_none() && status == "waiting_for_staff" {
        first_response_due_at
    } else if resolved_at.is_none() && status != "waiting_for_guest" && status != "closed" {
        resolution_due_at
    } else {
        None
    };
    let is_sla_breached = active_due.is_some_and(|due| due <= now);
    let is_sla_at_risk = !is_sla_breached
        && active_due.is_some_and(|due| due <= now + chrono::Duration::minutes(30));

    SupportConversationSummary {
        id: row.try_get("id").unwrap_or_default(),
        conversation_number: row.try_get("conversation_number").unwrap_or_default(),
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        guest_name: row.try_get("guest_name").unwrap_or_default(),
        guest_email: opt(row, "guest_email"),
        booking_id: opt(row, "booking_id"),
        booking_reference: opt(row, "booking_reference"),
        room_number: opt(row, "room_number"),
        category: row.try_get("category").unwrap_or_default(),
        status,
        priority: row.try_get("priority").unwrap_or_default(),
        queue: row.try_get("assigned_team").unwrap_or_default(),
        assigned_to_user_id: opt(row, "assigned_to_user_id"),
        assigned_to_name: opt(row, "assigned_to_name"),
        escalation_level: i32::from(row.try_get::<i16, _>("escalation_level").unwrap_or_default()),
        escalated_at: opt(row, "escalated_at"),
        first_response_due_at,
        resolution_due_at,
        first_response_at,
        resolved_at,
        closed_at: opt(row, "closed_at"),
        last_message_preview: opt(row, "last_message_preview"),
        last_message_at: opt(row, "last_message_at"),
        last_activity_at: required_timestamp(row, "last_activity_at"),
        unread_count: 0,
        is_sla_at_risk,
        is_sla_breached,
        version: i64::from(row.try_get::<i32, _>("version").unwrap_or(1)),
    }
}

pub struct GuestRelationsRepository;

impl GuestRelationsRepository {
    // ------------------------------------------------------------------
    // Interactions (guest_notes)
    // ------------------------------------------------------------------

    /// Paged interaction timeline. `is_private` rows are visible only to their
    /// author (`created_by = viewer_user_id`) or to a caller holding the
    /// manage permission (`can_manage`). When `include_completed_followups`
    /// is false, notes whose follow-up is already completed are hidden.
    /// Returns `(items, total)`; the service wraps them in
    /// [`InteractionListResponse`].
    pub async fn list_interactions(
        pool: &DbPool,
        guest_id: i64,
        viewer_user_id: i64,
        can_manage: bool,
        page: i64,
        page_size: i64,
        include_completed_followups: bool,
    ) -> Result<(Vec<GuestInteraction>, i64), ApiError> {
        // $1 guest_id, $2 viewer_user_id, $3 can_manage,
        // $4 include_completed_followups, $5 page_size, $6 offset
        let visibility = r#"
            WHERE n.guest_id = $1
              AND (NOT COALESCE(n.is_private, false) OR n.created_by = $2 OR $3::bool)
              AND ($4::bool OR n.follow_up_completed_at IS NULL)
        "#;
        let count_sql = format!("SELECT COUNT(*) FROM guest_notes n {visibility}");
        let list_sql = format!(
            r#"
            SELECT
                n.id,
                n.guest_id,
                n.interaction_type,
                COALESCE(n.note_type, 'general') AS note_type,
                n.subject,
                n.content,
                n.booking_id,
                COALESCE(n.is_alert, false) AS is_alert,
                COALESCE(n.is_private, false) AS is_private,
                n.follow_up_at,
                n.follow_up_completed_at,
                n.assigned_to,
                COALESCE(au.full_name, au.username) AS assigned_to_name,
                n.created_by,
                COALESCE(cu.full_name, cu.username) AS created_by_name,
                n.created_at,
                n.updated_at
            FROM guest_notes n
            LEFT JOIN users au ON au.id = n.assigned_to
            LEFT JOIN users cu ON cu.id = n.created_by
            {visibility}
            ORDER BY n.created_at DESC, n.id DESC
            LIMIT $5 OFFSET $6
            "#
        );

        let page_size = page_size.max(1);
        let offset = (page.max(1) - 1) * page_size;
        let total: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(&*count_sql))
            .bind(guest_id)
            .bind(viewer_user_id)
            .bind(can_manage)
            .bind(include_completed_followups)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        let rows = sqlx::query(sqlx::AssertSqlSafe(&*list_sql))
            .bind(guest_id)
            .bind(viewer_user_id)
            .bind(can_manage)
            .bind(include_completed_followups)
            .bind(page_size)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

        Ok((rows.iter().map(interaction_from_row).collect(), total))
    }

    pub async fn insert_interaction(
        pool: &DbPool,
        guest_id: i64,
        input: &NewInteraction,
        created_by: i64,
    ) -> Result<i64, ApiError> {
        sqlx::query_scalar(
            r#"
                INSERT INTO guest_notes (
                    guest_id, interaction_type, subject, content, booking_id,
                    is_alert, is_private, follow_up_at, assigned_to, created_by
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING id
            "#,
        )
        .bind(guest_id)
        .bind(&input.interaction_type)
        .bind(&input.subject)
        .bind(&input.content)
        .bind(input.booking_id)
        .bind(input.is_alert)
        .bind(input.is_private)
        .bind(input.follow_up_at)
        .bind(input.assigned_to)
        .bind(created_by)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)
    }

    /// Scoped to `guest_id` so a note id can never be edited across guests.
    pub async fn update_interaction(
        pool: &DbPool,
        note_id: i64,
        guest_id: i64,
        values: &InteractionUpdateValues,
    ) -> Result<bool, ApiError> {
        let result = sqlx::query(
            r#"
                UPDATE guest_notes
                SET subject = $3,
                    content = $4,
                    interaction_type = $5,
                    is_alert = $6,
                    follow_up_at = $7,
                    follow_up_completed_at = $8,
                    assigned_to = $9,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND guest_id = $2
            "#,
        )
        .bind(note_id)
        .bind(guest_id)
        .bind(&values.subject)
        .bind(&values.content)
        .bind(&values.interaction_type)
        .bind(values.is_alert)
        .bind(values.follow_up_at)
        .bind(values.follow_up_completed_at)
        .bind(values.assigned_to)
        .execute(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    /// `guest_notes` has no soft-delete column — removal is a hard DELETE.
    pub async fn delete_interaction(
        pool: &DbPool,
        note_id: i64,
        guest_id: i64,
    ) -> Result<bool, ApiError> {
        let result = sqlx::query("DELETE FROM guest_notes WHERE id = $1 AND guest_id = $2")
            .bind(note_id)
            .bind(guest_id)
            .execute(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn interaction_exists_for_guest(
        pool: &DbPool,
        note_id: i64,
        guest_id: i64,
    ) -> Result<bool, ApiError> {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM guest_notes WHERE id = $1 AND guest_id = $2)")
            .bind(note_id)
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    /// Mirrors `SupportRepository::booking_belongs_to_guest` — the service
    /// soft-checks an optional `booking_id` link before persisting it.
    pub async fn booking_belongs_to_guest(
        pool: &DbPool,
        booking_id: i64,
        guest_id: i64,
    ) -> Result<bool, ApiError> {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bookings WHERE id = $1 AND guest_id = $2)")
            .bind(booking_id)
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    // ------------------------------------------------------------------
    // Preferences (guest_preferences)
    // ------------------------------------------------------------------

    pub async fn list_preferences(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Vec<GuestPreference>, ApiError> {
        let rows = sqlx::query(
            r#"
                SELECT id, category, preference_key, preference_value, updated_at
                FROM guest_preferences
                WHERE guest_id = $1
                ORDER BY category, preference_key
            "#,
        )
        .bind(guest_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows.iter().map(preference_from_row).collect())
    }

    /// Upserts one preference on `uq_guest_preferences_key`
    /// (`guest_id, category, preference_key`).
    pub async fn upsert_preference_tx(
        tx: &mut DbTransaction<'_>,
        guest_id: i64,
        category: &str,
        preference_key: &str,
        preference_value: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
                INSERT INTO guest_preferences (guest_id, category, preference_key, preference_value)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (guest_id, category, preference_key) DO UPDATE SET
                    preference_value = EXCLUDED.preference_value,
                    updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(guest_id)
        .bind(category)
        .bind(preference_key)
        .bind(preference_value)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    /// `replace_categories` semantics: for every listed category, delete the
    /// stored keys that are absent from this PUT's entries. `keep_pairs` is the
    /// batch's `(category, preference_key)` set — pairing category with key
    /// (rather than matching keys globally) stops an entry under one category
    /// from protecting a stale row under another.
    pub async fn delete_preferences_not_in_tx(
        tx: &mut DbTransaction<'_>,
        guest_id: i64,
        categories: &[String],
        keep_pairs: &[(String, String)],
    ) -> Result<u64, ApiError> {
        let keep_categories: Vec<&str> = keep_pairs.iter().map(|pair| pair.0.as_str()).collect();
        let keep_keys: Vec<&str> = keep_pairs.iter().map(|pair| pair.1.as_str()).collect();
        let result = sqlx::query(
            r#"
                DELETE FROM guest_preferences
                WHERE guest_id = $1
                  AND category = ANY($2)
                  AND (category, preference_key) NOT IN (
                      SELECT keep.category, keep.preference_key
                      FROM UNNEST($3::text[], $4::text[])
                          AS keep(category, preference_key)
                  )
            "#,
        )
        .bind(guest_id)
        .bind(categories)
        .bind(&keep_categories)
        .bind(&keep_keys)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected())
    }

    // ------------------------------------------------------------------
    // Reviews (guest_reviews)
    // ------------------------------------------------------------------

    pub async fn list_reviews(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Vec<GuestReviewRow>, ApiError> {
        // `overall_rating` is numeric(3,2); the ::float8 cast decodes straight
        // into the f64 model field.
        let rows = sqlx::query(
            r#"
                SELECT id,
                       booking_id,
                       overall_rating::float8 AS overall_rating,
                       title,
                       content,
                       response,
                       response_at,
                       COALESCE(is_published, false) AS is_published,
                       created_at
                FROM guest_reviews
                WHERE guest_id = $1
                ORDER BY created_at DESC, id DESC
            "#,
        )
        .bind(guest_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows.iter().map(review_from_row).collect())
    }

    /// Staff response write — `response`/`response_at`/`response_by` are the
    /// real column names on `guest_reviews`.
    pub async fn respond_to_review(
        pool: &DbPool,
        review_id: i64,
        guest_id: i64,
        response: &str,
        responder_id: i64,
    ) -> Result<bool, ApiError> {
        let result = sqlx::query(
            r#"
                UPDATE guest_reviews
                SET response = $3,
                    response_at = CURRENT_TIMESTAMP,
                    response_by = $4,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND guest_id = $2
            "#,
        )
        .bind(review_id)
        .bind(guest_id)
        .bind(response)
        .bind(responder_id)
        .execute(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    // ------------------------------------------------------------------
    // Loyalty — read-only delegation to the loyalty module
    // ------------------------------------------------------------------

    /// Guest-360 loyalty card. Delegates to the canonical member summary query
    /// (`loyalty_members` + `loyalty_accounts` + `loyalty_tiers`, with
    /// `available_points` = `SUM(available_delta)` over `loyalty_transactions`)
    /// so no balance logic is duplicated here.
    pub async fn loyalty_summary(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Option<GuestLoyaltySummary>, ApiError> {
        let Some(member) = LoyaltyRepository::member_by_guest(pool, guest_id).await? else {
            return Ok(None);
        };
        let mut redemptions = LoyaltyRepository::redemptions_for_member(pool, member.id).await?;
        redemptions.truncate(5);
        Ok(Some(GuestLoyaltySummary {
            member_number: member.member_number,
            status: member.status,
            tier_code: member.tier_code,
            tier_name: member.tier_name,
            available_points: member.available_points,
            lifetime_points: member.lifetime_points,
            qualifying_nights: member.qualifying_nights,
            recent_redemptions: redemptions
                .into_iter()
                .map(|r| GuestRedemptionRow {
                    id: r.id,
                    reward_name: Some(r.reward_name),
                    points: r.points_spent,
                    status: r.status,
                    created_at: r.requested_at,
                })
                .collect(),
        }))
    }

    // ------------------------------------------------------------------
    // Vouchers — read-only join on promotions for name/slug
    // ------------------------------------------------------------------

    pub async fn list_vouchers(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Vec<GuestVoucherRow>, ApiError> {
        let rows = sqlx::query(
            r#"
                SELECT v.id,
                       v.code,
                       v.status,
                       v.source,
                       v.promotion_id,
                       p.name AS promotion_name,
                       p.slug AS promotion_slug,
                       v.expires_at,
                       v.redeemed_at
                FROM vouchers v
                JOIN promotions p ON p.id = v.promotion_id
                WHERE v.guest_id = $1
                ORDER BY CASE v.status WHEN 'available' THEN 0 WHEN 'redeemed' THEN 1 ELSE 2 END,
                         v.expires_at NULLS LAST,
                         v.created_at DESC
            "#,
        )
        .bind(guest_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows.iter().map(voucher_from_row).collect())
    }

    // ------------------------------------------------------------------
    // Communications — subscriptions/suppression delegate to the
    // communications module; deliveries are a small local read.
    // ------------------------------------------------------------------

    /// `guests` consent/contact fields for the communications summary.
    /// `marketing_opt_in` is nullable in the baseline — COALESCE to false.
    pub async fn guest_consent_state(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Option<GuestConsentState>, ApiError> {
        let row = sqlx::query(
            r#"
                SELECT email,
                       COALESCE(marketing_opt_in, false) AS marketing_opt_in,
                       communication_preference,
                       language_preference
                FROM guests
                WHERE id = $1
            "#,
        )
        .bind(guest_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(row.as_ref().map(|row| GuestConsentState {
            email: opt(row, "email"),
            marketing_opt_in: row_mappers::get_bool(row, "marketing_opt_in"),
            communication_preference: opt(row, "communication_preference"),
            language_preference: opt(row, "language_preference"),
        }))
    }

    pub async fn list_subscriptions(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Vec<GuestSubscriptionRow>, ApiError> {
        let subscriptions = CommunicationsRepository::list_subscriptions_for_guest(pool, guest_id)
            .await?;
        Ok(subscriptions
            .into_iter()
            .map(|s| GuestSubscriptionRow {
                channel: s.channel,
                topic: s.topic,
                subscribed: s.subscribed,
                updated_at: s.updated_at,
            })
            .collect())
    }

    pub async fn list_recent_deliveries(
        pool: &DbPool,
        guest_id: i64,
        limit: i64,
    ) -> Result<Vec<GuestDeliveryRow>, ApiError> {
        let rows = sqlx::query(
            r#"
                SELECT id, kind, subject, status, created_at
                FROM email_deliveries
                WHERE guest_id = $1
                ORDER BY id DESC
                LIMIT $2
            "#,
        )
        .bind(guest_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows.iter().map(delivery_from_row).collect())
    }

    /// Delegates to the communications suppression list (keyed by lowercased
    /// email — pass the address from [`Self::guest_consent_state`]).
    pub async fn is_email_suppressed(pool: &DbPool, email: &str) -> Result<bool, ApiError> {
        CommunicationsRepository::is_email_suppressed(pool, email).await
    }

    // ------------------------------------------------------------------
    // Support — per-guest conversation summaries (read-only)
    // ------------------------------------------------------------------

    /// Staff-side conversation summaries for one guest, newest activity first.
    /// The support module's select/mapping are private, so this is a compact
    /// summary projection over the same joins (no inbox filters/queue logic).
    pub async fn list_support_for_guest(
        pool: &DbPool,
        guest_id: i64,
        limit: i64,
    ) -> Result<Vec<SupportConversationSummary>, ApiError> {
        let rows = sqlx::query(
            r#"
                SELECT
                    c.id,
                    c.conversation_number,
                    c.guest_id,
                    COALESCE(g.nick_name, trim(g.first_name || ' ' || g.last_name), 'Guest') AS guest_name,
                    g.email AS guest_email,
                    c.booking_id,
                    b.booking_number AS booking_reference,
                    r.room_number,
                    c.category,
                    c.status,
                    c.priority,
                    c.assigned_team,
                    c.assigned_to_user_id,
                    u.full_name AS assigned_to_name,
                    c.escalation_level,
                    c.escalated_at,
                    c.first_response_due_at,
                    c.resolution_due_at,
                    c.first_response_at,
                    c.resolved_at,
                    c.closed_at,
                    (
                        SELECT sm.body
                        FROM support_messages sm
                        WHERE sm.conversation_id = c.id
                        ORDER BY sm.created_at DESC, sm.id DESC
                        LIMIT 1
                    ) AS last_message_preview,
                    (
                        SELECT sm.created_at
                        FROM support_messages sm
                        WHERE sm.conversation_id = c.id
                        ORDER BY sm.created_at DESC, sm.id DESC
                        LIMIT 1
                    ) AS last_message_at,
                    c.last_activity_at,
                    c.version
                FROM support_conversations c
                JOIN guests g ON g.id = c.guest_id
                LEFT JOIN bookings b ON b.id = c.booking_id
                LEFT JOIN rooms r ON r.id = b.room_id
                LEFT JOIN users u ON u.id = c.assigned_to_user_id
                WHERE c.guest_id = $1
                ORDER BY c.last_activity_at DESC, c.id DESC
                LIMIT $2
            "#,
        )
        .bind(guest_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows.iter().map(support_summary_from_row).collect())
    }
}
