//! Persistence for notification subscriptions, consent history, campaigns,
//! the email delivery outbox, suppressions, and email templates.

use chrono::{DateTime, Utc};
use sqlx::{Row, query, query_scalar};

use super::models::{
    AudienceCount, AudienceGuest, ConsentEvent, EmailCampaign, EmailDelivery, EmailSuppression,
    EmailTemplate, NotificationSubscription,
};
use super::validation::{CampaignDraft, SuppressionDraft, TemplateDraft};
use crate::core::db::{DbPool, DbRow, DbTransaction};
use crate::core::error::ApiError;
use crate::models::row_mappers::get_bool;

const SUBSCRIPTION_COLUMNS: &str = r#"
    id, guest_id, channel, topic, subscribed, source, policy_version, created_at, updated_at
"#;

const CONSENT_COLUMNS: &str = r#"
    id, guest_id, channel, topic, action, source, policy_version, actor_type,
    actor_user_id, created_at
"#;

const CAMPAIGN_COLUMNS: &str = r#"
    id, name, campaign_type, topic, status, subject, body_html, body_text,
    template_id, promotion_id, scheduled_at, started_at, completed_at,
    cancelled_at, total_recipients, sent_count, failed_count, error,
    created_by, cancelled_by, created_at, updated_at
"#;

const DELIVERY_COLUMNS: &str = r#"
    id, campaign_id, kind, guest_id, topic, recipient_email, subject, body_html,
    body_text, voucher_id, status, attempts, max_attempts, next_attempt_at,
    lease_owner, lease_expires_at, provider_message_id, idempotency_key,
    last_error, sent_at, created_at, updated_at
"#;

const SUPPRESSION_COLUMNS: &str = r#"
    id, email, reason, source, notes, created_at
"#;

const TEMPLATE_COLUMNS: &str = r#"
    id, code, name, subject, body_html, body_text, variables, is_active,
    created_at, updated_at
"#;

fn opt_timestamp(row: &DbRow, col: &str) -> Option<DateTime<Utc>> {
    row.try_get::<Option<DateTime<Utc>>, _>(col).ok().flatten()
}

fn required_timestamp(row: &DbRow, col: &str) -> DateTime<Utc> {
    row.try_get(col).unwrap_or_else(|_| Utc::now())
}

fn subscription_from_row(row: &DbRow) -> NotificationSubscription {
    NotificationSubscription {
        id: row.try_get("id").unwrap_or_default(),
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        channel: row.try_get("channel").unwrap_or_default(),
        topic: row.try_get("topic").unwrap_or_default(),
        subscribed: get_bool(row, "subscribed"),
        source: row.try_get("source").ok().flatten(),
        policy_version: row.try_get("policy_version").ok().flatten(),
        created_at: required_timestamp(row, "created_at"),
        updated_at: required_timestamp(row, "updated_at"),
    }
}

fn consent_event_from_row(row: &DbRow) -> ConsentEvent {
    ConsentEvent {
        id: row.try_get("id").unwrap_or_default(),
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        channel: row.try_get("channel").unwrap_or_default(),
        topic: row.try_get("topic").unwrap_or_default(),
        action: row.try_get("action").unwrap_or_default(),
        source: row.try_get("source").unwrap_or_default(),
        policy_version: row.try_get("policy_version").ok().flatten(),
        actor_type: row.try_get("actor_type").unwrap_or_default(),
        actor_user_id: row.try_get("actor_user_id").ok().flatten(),
        created_at: required_timestamp(row, "created_at"),
    }
}

fn campaign_from_row(row: &DbRow) -> EmailCampaign {
    EmailCampaign {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        campaign_type: row.try_get("campaign_type").unwrap_or_default(),
        topic: row.try_get("topic").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_default(),
        subject: row.try_get("subject").unwrap_or_default(),
        body_html: row.try_get("body_html").unwrap_or_default(),
        body_text: row.try_get("body_text").ok().flatten(),
        template_id: row.try_get("template_id").ok().flatten(),
        promotion_id: row.try_get("promotion_id").ok().flatten(),
        scheduled_at: opt_timestamp(row, "scheduled_at"),
        started_at: opt_timestamp(row, "started_at"),
        completed_at: opt_timestamp(row, "completed_at"),
        cancelled_at: opt_timestamp(row, "cancelled_at"),
        total_recipients: row.try_get("total_recipients").unwrap_or_default(),
        sent_count: row.try_get("sent_count").unwrap_or_default(),
        failed_count: row.try_get("failed_count").unwrap_or_default(),
        error: row.try_get("error").ok().flatten(),
        created_by: row.try_get("created_by").ok().flatten(),
        cancelled_by: row.try_get("cancelled_by").ok().flatten(),
        created_at: required_timestamp(row, "created_at"),
        updated_at: required_timestamp(row, "updated_at"),
    }
}

fn delivery_from_row(row: &DbRow) -> EmailDelivery {
    EmailDelivery {
        id: row.try_get("id").unwrap_or_default(),
        campaign_id: row.try_get("campaign_id").ok().flatten(),
        kind: row.try_get("kind").unwrap_or_default(),
        guest_id: row.try_get("guest_id").unwrap_or_default(),
        topic: row.try_get("topic").unwrap_or_default(),
        recipient_email: row.try_get("recipient_email").unwrap_or_default(),
        subject: row.try_get("subject").unwrap_or_default(),
        body_html: row.try_get("body_html").unwrap_or_default(),
        body_text: row.try_get("body_text").ok().flatten(),
        voucher_id: row.try_get("voucher_id").ok().flatten(),
        status: row.try_get("status").unwrap_or_default(),
        attempts: row.try_get("attempts").unwrap_or_default(),
        max_attempts: row.try_get("max_attempts").unwrap_or(5),
        next_attempt_at: required_timestamp(row, "next_attempt_at"),
        lease_owner: row.try_get("lease_owner").ok().flatten(),
        lease_expires_at: opt_timestamp(row, "lease_expires_at"),
        provider_message_id: row.try_get("provider_message_id").ok().flatten(),
        idempotency_key: row.try_get("idempotency_key").unwrap_or_default(),
        last_error: row.try_get("last_error").ok().flatten(),
        sent_at: opt_timestamp(row, "sent_at"),
        created_at: required_timestamp(row, "created_at"),
        updated_at: required_timestamp(row, "updated_at"),
    }
}

fn audience_guest_from_row(row: &DbRow) -> AudienceGuest {
    AudienceGuest {
        id: row.try_get("id").unwrap_or_default(),
        email: row.try_get("email").unwrap_or_default(),
        first_name: row.try_get("first_name").unwrap_or_default(),
        full_name: row.try_get("full_name").unwrap_or_default(),
    }
}

fn suppression_from_row(row: &DbRow) -> EmailSuppression {
    EmailSuppression {
        id: row.try_get("id").unwrap_or_default(),
        email: row.try_get("email").unwrap_or_default(),
        reason: row.try_get("reason").unwrap_or_default(),
        source: row.try_get("source").ok().flatten(),
        notes: row.try_get("notes").ok().flatten(),
        created_at: required_timestamp(row, "created_at"),
    }
}

fn template_variables(row: &DbRow) -> Vec<String> {
    if let Ok(Some(value)) = row.try_get::<Option<serde_json::Value>, _>("variables") {
        return serde_json::from_value(value).unwrap_or_default();
    }
    row.try_get::<Option<String>, _>("variables")
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn template_from_row(row: &DbRow) -> EmailTemplate {
    EmailTemplate {
        id: row.try_get("id").unwrap_or_default(),
        code: row.try_get("code").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        subject: row.try_get("subject").unwrap_or_default(),
        body_html: row.try_get("body_html").unwrap_or_default(),
        body_text: row.try_get("body_text").ok().flatten(),
        variables: template_variables(row),
        is_active: get_bool(row, "is_active"),
        created_at: required_timestamp(row, "created_at"),
        updated_at: required_timestamp(row, "updated_at"),
    }
}

pub struct CommunicationsRepository;

impl CommunicationsRepository {
    // ------------------------------------------------------------------
    // Subscriptions
    // ------------------------------------------------------------------

    pub async fn list_subscriptions_for_guest(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Vec<NotificationSubscription>, ApiError> {
        let sql = crate::sql_query!(
            postgres: "SELECT {COLS} FROM notification_subscriptions WHERE guest_id = $1 ORDER BY topic",
            sqlite: "SELECT {COLS} FROM notification_subscriptions WHERE guest_id = ?1 ORDER BY topic"
        )
        .replace("{COLS}", SUBSCRIPTION_COLUMNS);
        let rows = query(&sql)
            .bind(guest_id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(rows.iter().map(subscription_from_row).collect())
    }

    pub async fn upsert_subscription_tx(
        tx: &mut DbTransaction<'_>,
        guest_id: i64,
        channel: &str,
        topic: &str,
        subscribed: bool,
        source: Option<&str>,
        policy_version: Option<&str>,
    ) -> Result<(), ApiError> {
        query(crate::sql_query!(
            postgres: r#"
                INSERT INTO notification_subscriptions
                    (guest_id, channel, topic, subscribed, source, policy_version)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (guest_id, channel, topic) DO UPDATE SET
                    subscribed = EXCLUDED.subscribed,
                    source = EXCLUDED.source,
                    policy_version = EXCLUDED.policy_version,
                    updated_at = CURRENT_TIMESTAMP
            "#,
            sqlite: r#"
                INSERT INTO notification_subscriptions
                    (guest_id, channel, topic, subscribed, source, policy_version)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT (guest_id, channel, topic) DO UPDATE SET
                    subscribed = excluded.subscribed,
                    source = excluded.source,
                    policy_version = excluded.policy_version,
                    updated_at = datetime('now')
            "#
        ))
        .bind(guest_id)
        .bind(channel)
        .bind(topic)
        .bind(subscribed)
        .bind(source)
        .bind(policy_version)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Consent events
    // ------------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_consent_event_tx(
        tx: &mut DbTransaction<'_>,
        guest_id: i64,
        channel: &str,
        topic: &str,
        action: &str,
        source: &str,
        policy_version: Option<&str>,
        actor_type: &str,
        actor_user_id: Option<i64>,
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), ApiError> {
        query(crate::sql_query!(
            postgres: r#"
                INSERT INTO notification_consent_events
                    (guest_id, channel, topic, action, source, policy_version,
                     actor_type, actor_user_id, ip_address, user_agent)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            "#,
            sqlite: r#"
                INSERT INTO notification_consent_events
                    (guest_id, channel, topic, action, source, policy_version,
                     actor_type, actor_user_id, ip_address, user_agent)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#
        ))
        .bind(guest_id)
        .bind(channel)
        .bind(topic)
        .bind(action)
        .bind(source)
        .bind(policy_version)
        .bind(actor_type)
        .bind(actor_user_id)
        .bind(ip_address)
        .bind(user_agent)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    pub async fn list_consent_events_for_guest(
        pool: &DbPool,
        guest_id: i64,
        limit: i64,
    ) -> Result<Vec<ConsentEvent>, ApiError> {
        let sql = crate::sql_query!(
            postgres: "SELECT {COLS} FROM notification_consent_events WHERE guest_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2",
            sqlite: "SELECT {COLS} FROM notification_consent_events WHERE guest_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2"
        )
        .replace("{COLS}", CONSENT_COLUMNS);
        let rows = query(&sql)
            .bind(guest_id)
            .bind(limit)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(rows.iter().map(consent_event_from_row).collect())
    }

    // ------------------------------------------------------------------
    // Suppressions
    // ------------------------------------------------------------------

    pub async fn is_email_suppressed(pool: &DbPool, email: &str) -> Result<bool, ApiError> {
        let exists: i64 = query_scalar(crate::sql_query!(
            postgres: "SELECT COUNT(*) FROM email_suppressions WHERE email = LOWER($1)",
            sqlite: "SELECT COUNT(*) FROM email_suppressions WHERE email = LOWER(?1)"
        ))
        .bind(email)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(exists > 0)
    }

    pub async fn insert_suppression_tx(
        tx: &mut DbTransaction<'_>,
        draft: &SuppressionDraft,
        source: Option<&str>,
    ) -> Result<(), ApiError> {
        query(crate::sql_query!(
            postgres: r#"
                INSERT INTO email_suppressions (email, reason, source, notes)
                VALUES (LOWER($1), $2, $3, $4)
                ON CONFLICT (email) DO UPDATE SET
                    reason = EXCLUDED.reason,
                    source = EXCLUDED.source,
                    notes = EXCLUDED.notes
            "#,
            sqlite: r#"
                INSERT INTO email_suppressions (email, reason, source, notes)
                VALUES (LOWER(?1), ?2, ?3, ?4)
                ON CONFLICT (email) DO UPDATE SET
                    reason = excluded.reason,
                    source = excluded.source,
                    notes = excluded.notes
            "#
        ))
        .bind(&draft.email)
        .bind(&draft.reason)
        .bind(source)
        .bind(&draft.notes)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    pub async fn list_suppressions(
        pool: &DbPool,
        page: i64,
        page_size: i64,
    ) -> Result<(Vec<EmailSuppression>, i64), ApiError> {
        let total: i64 = query_scalar("SELECT COUNT(*) FROM email_suppressions")
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        let sql = crate::sql_query!(
            postgres: "SELECT {COLS} FROM email_suppressions ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2",
            sqlite: "SELECT {COLS} FROM email_suppressions ORDER BY created_at DESC, id DESC LIMIT ?1 OFFSET ?2"
        )
        .replace("{COLS}", SUPPRESSION_COLUMNS);
        let rows = query(&sql)
            .bind(page_size)
            .bind((page - 1) * page_size)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok((rows.iter().map(suppression_from_row).collect(), total))
    }

    pub async fn delete_suppression_tx(
        tx: &mut DbTransaction<'_>,
        email: &str,
    ) -> Result<bool, ApiError> {
        let result = query(crate::sql_query!(
            postgres: "DELETE FROM email_suppressions WHERE email = LOWER($1)",
            sqlite: "DELETE FROM email_suppressions WHERE email = LOWER(?1)"
        ))
        .bind(email)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    // ------------------------------------------------------------------
    // Templates
    // ------------------------------------------------------------------

    pub async fn list_templates(pool: &DbPool) -> Result<Vec<EmailTemplate>, ApiError> {
        let sql =
            "SELECT {COLS} FROM email_templates ORDER BY code".replace("{COLS}", TEMPLATE_COLUMNS);
        let rows = query(&sql).fetch_all(pool).await.map_err(ApiError::from)?;
        Ok(rows.iter().map(template_from_row).collect())
    }

    pub async fn get_template(pool: &DbPool, id: i64) -> Result<Option<EmailTemplate>, ApiError> {
        let sql = crate::sql_query!(
            postgres: "SELECT {COLS} FROM email_templates WHERE id = $1",
            sqlite: "SELECT {COLS} FROM email_templates WHERE id = ?1"
        )
        .replace("{COLS}", TEMPLATE_COLUMNS);
        let row = query(&sql)
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(template_from_row))
    }

    pub async fn get_template_by_code(
        pool: &DbPool,
        code: &str,
    ) -> Result<Option<EmailTemplate>, ApiError> {
        let sql = crate::sql_query!(
            postgres: "SELECT {COLS} FROM email_templates WHERE code = $1",
            sqlite: "SELECT {COLS} FROM email_templates WHERE code = ?1"
        )
        .replace("{COLS}", TEMPLATE_COLUMNS);
        let row = query(&sql)
            .bind(code)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(template_from_row))
    }

    pub async fn insert_template_tx(
        tx: &mut DbTransaction<'_>,
        draft: &TemplateDraft,
    ) -> Result<i64, ApiError> {
        let variables_json =
            serde_json::to_string(&draft.variables).unwrap_or_else(|_| "[]".to_string());
        query_scalar(crate::sql_query!(
            postgres: r#"
                INSERT INTO email_templates
                    (code, name, subject, body_html, body_text, variables, is_active)
                VALUES ($1, $2, $3, $4, $5, CAST($6 AS JSONB), $7)
                RETURNING id
            "#,
            sqlite: r#"
                INSERT INTO email_templates
                    (code, name, subject, body_html, body_text, variables, is_active)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                RETURNING id
            "#
        ))
        .bind(&draft.code)
        .bind(&draft.name)
        .bind(&draft.subject)
        .bind(&draft.body_html)
        .bind(&draft.body_text)
        .bind(variables_json)
        .bind(draft.is_active)
        .fetch_one(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    pub async fn update_template_tx(
        tx: &mut DbTransaction<'_>,
        id: i64,
        draft: &TemplateDraft,
    ) -> Result<bool, ApiError> {
        let variables_json =
            serde_json::to_string(&draft.variables).unwrap_or_else(|_| "[]".to_string());
        let result = query(crate::sql_query!(
            postgres: r#"
                UPDATE email_templates SET
                    code = $1, name = $2, subject = $3, body_html = $4,
                    body_text = $5, variables = CAST($6 AS JSONB), is_active = $7,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $8
            "#,
            sqlite: r#"
                UPDATE email_templates SET
                    code = ?1, name = ?2, subject = ?3, body_html = ?4,
                    body_text = ?5, variables = ?6, is_active = ?7,
                    updated_at = datetime('now')
                WHERE id = ?8
            "#
        ))
        .bind(&draft.code)
        .bind(&draft.name)
        .bind(&draft.subject)
        .bind(&draft.body_html)
        .bind(&draft.body_text)
        .bind(variables_json)
        .bind(draft.is_active)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn set_template_active_tx(
        tx: &mut DbTransaction<'_>,
        id: i64,
        active: bool,
    ) -> Result<bool, ApiError> {
        let result = query(crate::sql_query!(
            postgres: "UPDATE email_templates SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
            sqlite: "UPDATE email_templates SET is_active = ?1, updated_at = datetime('now') WHERE id = ?2"
        ))
        .bind(active)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    // ------------------------------------------------------------------
    // Campaigns
    // ------------------------------------------------------------------

    pub async fn insert_campaign_tx(
        tx: &mut DbTransaction<'_>,
        draft: &CampaignDraft,
        created_by: i64,
    ) -> Result<i64, ApiError> {
        query_scalar(crate::sql_query!(
            postgres: r#"
                INSERT INTO email_campaigns
                    (name, campaign_type, topic, status, subject, body_html,
                     body_text, template_id, promotion_id, created_by)
                VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9)
                RETURNING id
            "#,
            sqlite: r#"
                INSERT INTO email_campaigns
                    (name, campaign_type, topic, status, subject, body_html,
                     body_text, template_id, promotion_id, created_by)
                VALUES (?1, ?2, ?3, 'draft', ?4, ?5, ?6, ?7, ?8, ?9)
                RETURNING id
            "#
        ))
        .bind(&draft.name)
        .bind(&draft.campaign_type)
        .bind(&draft.topic)
        .bind(&draft.subject)
        .bind(&draft.body_html)
        .bind(&draft.body_text)
        .bind(draft.template_id)
        .bind(draft.promotion_id)
        .bind(created_by)
        .fetch_one(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    pub async fn get_campaign(pool: &DbPool, id: i64) -> Result<Option<EmailCampaign>, ApiError> {
        let sql = crate::sql_query!(
            postgres: "SELECT {COLS} FROM email_campaigns WHERE id = $1",
            sqlite: "SELECT {COLS} FROM email_campaigns WHERE id = ?1"
        )
        .replace("{COLS}", CAMPAIGN_COLUMNS);
        let row = query(&sql)
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(campaign_from_row))
    }

    pub async fn list_campaigns(
        pool: &DbPool,
        status: Option<String>,
        campaign_type: Option<String>,
        page: i64,
        page_size: i64,
    ) -> Result<(Vec<EmailCampaign>, i64), ApiError> {
        let total: i64 = query_scalar(crate::sql_query!(
            postgres: r#"
                SELECT COUNT(*) FROM email_campaigns
                WHERE ($1 IS NULL OR status = $1)
                  AND ($2 IS NULL OR campaign_type = $2)
            "#,
            sqlite: r#"
                SELECT COUNT(*) FROM email_campaigns
                WHERE (?1 IS NULL OR status = ?1)
                  AND (?2 IS NULL OR campaign_type = ?2)
            "#
        ))
        .bind(&status)
        .bind(&campaign_type)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;

        let sql = crate::sql_query!(
            postgres: r#"
                SELECT {COLS} FROM email_campaigns
                WHERE ($1 IS NULL OR status = $1)
                  AND ($2 IS NULL OR campaign_type = $2)
                ORDER BY created_at DESC, id DESC
                LIMIT $3 OFFSET $4
            "#,
            sqlite: r#"
                SELECT {COLS} FROM email_campaigns
                WHERE (?1 IS NULL OR status = ?1)
                  AND (?2 IS NULL OR campaign_type = ?2)
                ORDER BY created_at DESC, id DESC
                LIMIT ?3 OFFSET ?4
            "#
        )
        .replace("{COLS}", CAMPAIGN_COLUMNS);
        let rows = query(&sql)
            .bind(&status)
            .bind(&campaign_type)
            .bind(page_size)
            .bind((page - 1) * page_size)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok((rows.iter().map(campaign_from_row).collect(), total))
    }

    pub async fn update_campaign_draft_tx(
        tx: &mut DbTransaction<'_>,
        id: i64,
        draft: &CampaignDraft,
    ) -> Result<bool, ApiError> {
        let result = query(crate::sql_query!(
            postgres: r#"
                UPDATE email_campaigns SET
                    name = $1, campaign_type = $2, topic = $3, subject = $4,
                    body_html = $5, body_text = $6, template_id = $7,
                    promotion_id = $8, updated_at = CURRENT_TIMESTAMP
                WHERE id = $9 AND status = 'draft'
            "#,
            sqlite: r#"
                UPDATE email_campaigns SET
                    name = ?1, campaign_type = ?2, topic = ?3, subject = ?4,
                    body_html = ?5, body_text = ?6, template_id = ?7,
                    promotion_id = ?8, updated_at = datetime('now')
                WHERE id = ?9 AND status = 'draft'
            "#
        ))
        .bind(&draft.name)
        .bind(&draft.campaign_type)
        .bind(&draft.topic)
        .bind(&draft.subject)
        .bind(&draft.body_html)
        .bind(&draft.body_text)
        .bind(draft.template_id)
        .bind(draft.promotion_id)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn schedule_campaign_tx(
        tx: &mut DbTransaction<'_>,
        id: i64,
        scheduled_at: DateTime<Utc>,
    ) -> Result<bool, ApiError> {
        let result = query(crate::sql_query!(
            postgres: r#"
                UPDATE email_campaigns
                SET status = 'scheduled', scheduled_at = $1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $2 AND status = 'draft'
            "#,
            sqlite: r#"
                UPDATE email_campaigns
                SET status = 'scheduled', scheduled_at = ?1, updated_at = datetime('now')
                WHERE id = ?2 AND status = 'draft'
            "#
        ))
        .bind(scheduled_at)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn cancel_campaign_tx(
        tx: &mut DbTransaction<'_>,
        id: i64,
        cancelled_by: i64,
    ) -> Result<bool, ApiError> {
        let result = query(crate::sql_query!(
            postgres: r#"
                UPDATE email_campaigns
                SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
                    cancelled_by = $1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $2 AND status IN ('scheduled', 'running')
            "#,
            sqlite: r#"
                UPDATE email_campaigns
                SET status = 'cancelled', cancelled_at = datetime('now'),
                    cancelled_by = ?1, updated_at = datetime('now')
                WHERE id = ?2 AND status IN ('scheduled', 'running')
            "#
        ))
        .bind(cancelled_by)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn add_campaign_counts_tx(
        tx: &mut DbTransaction<'_>,
        id: i64,
        sent_delta: i32,
        failed_delta: i32,
    ) -> Result<(), ApiError> {
        query(crate::sql_query!(
            postgres: r#"
                UPDATE email_campaigns
                SET sent_count = sent_count + $1, failed_count = failed_count + $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            "#,
            sqlite: r#"
                UPDATE email_campaigns
                SET sent_count = sent_count + ?1, failed_count = failed_count + ?2,
                    updated_at = datetime('now')
                WHERE id = ?3
            "#
        ))
        .bind(sent_delta)
        .bind(failed_delta)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Deliveries (outbox)
    // ------------------------------------------------------------------

    /// Enqueues one delivery. Returns `None` when a row with the same
    /// idempotency key already exists (duplicate suppressed).
    #[allow(clippy::too_many_arguments)]
    pub async fn insert_delivery_tx(
        tx: &mut DbTransaction<'_>,
        campaign_id: Option<i64>,
        kind: &str,
        guest_id: i64,
        topic: &str,
        recipient_email: &str,
        subject: &str,
        body_html: &str,
        body_text: Option<&str>,
        voucher_id: Option<i64>,
        idempotency_key: &str,
    ) -> Result<Option<i64>, ApiError> {
        query_scalar(crate::sql_query!(
            postgres: r#"
                INSERT INTO email_deliveries
                    (campaign_id, kind, guest_id, topic, recipient_email, subject,
                     body_html, body_text, voucher_id, idempotency_key)
                VALUES ($1, $2, $3, $4, LOWER($5), $6, $7, $8, $9, $10)
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING id
            "#,
            sqlite: r#"
                INSERT INTO email_deliveries
                    (campaign_id, kind, guest_id, topic, recipient_email, subject,
                     body_html, body_text, voucher_id, idempotency_key)
                VALUES (?1, ?2, ?3, ?4, LOWER(?5), ?6, ?7, ?8, ?9, ?10)
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING id
            "#
        ))
        .bind(campaign_id)
        .bind(kind)
        .bind(guest_id)
        .bind(topic)
        .bind(recipient_email)
        .bind(subject)
        .bind(body_html)
        .bind(body_text)
        .bind(voucher_id)
        .bind(idempotency_key)
        .fetch_optional(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    pub async fn list_deliveries_for_campaign(
        pool: &DbPool,
        campaign_id: i64,
        page: i64,
        page_size: i64,
    ) -> Result<(Vec<EmailDelivery>, i64), ApiError> {
        let total: i64 = query_scalar(crate::sql_query!(
            postgres: "SELECT COUNT(*) FROM email_deliveries WHERE campaign_id = $1",
            sqlite: "SELECT COUNT(*) FROM email_deliveries WHERE campaign_id = ?1"
        ))
        .bind(campaign_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        let sql = crate::sql_query!(
            postgres: "SELECT {COLS} FROM email_deliveries WHERE campaign_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3",
            sqlite: "SELECT {COLS} FROM email_deliveries WHERE campaign_id = ?1 ORDER BY id DESC LIMIT ?2 OFFSET ?3"
        )
        .replace("{COLS}", DELIVERY_COLUMNS);
        let rows = query(&sql)
            .bind(campaign_id)
            .bind(page_size)
            .bind((page - 1) * page_size)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok((rows.iter().map(delivery_from_row).collect(), total))
    }

    // ------------------------------------------------------------------
    // Scheduler: campaign fan-out + birthday selection
    // ------------------------------------------------------------------

    pub async fn due_scheduled_campaigns(pool: &DbPool) -> Result<Vec<EmailCampaign>, ApiError> {
        let sql = crate::sql_query!(
            postgres: "SELECT {COLS} FROM email_campaigns WHERE status = 'scheduled' AND scheduled_at <= CURRENT_TIMESTAMP ORDER BY scheduled_at",
            sqlite: "SELECT {COLS} FROM email_campaigns WHERE status = 'scheduled' AND datetime(scheduled_at) <= datetime('now') ORDER BY scheduled_at"
        )
        .replace("{COLS}", CAMPAIGN_COLUMNS);
        let rows = query(&sql).fetch_all(pool).await.map_err(ApiError::from)?;
        Ok(rows.iter().map(campaign_from_row).collect())
    }

    pub async fn mark_campaign_running(pool: &DbPool, id: i64) -> Result<bool, ApiError> {
        let result = query(crate::sql_query!(
            postgres: "UPDATE email_campaigns SET status = 'running', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'scheduled'",
            sqlite: "UPDATE email_campaigns SET status = 'running', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1 AND status = 'scheduled'"
        ))
        .bind(id)
        .execute(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn refresh_campaign_total(pool: &DbPool, id: i64) -> Result<(), ApiError> {
        query(crate::sql_query!(
            postgres: "UPDATE email_campaigns SET total_recipients = (SELECT COUNT(*) FROM email_deliveries WHERE campaign_id = $1), updated_at = CURRENT_TIMESTAMP WHERE id = $1",
            sqlite: "UPDATE email_campaigns SET total_recipients = (SELECT COUNT(*) FROM email_deliveries WHERE campaign_id = ?1), updated_at = datetime('now') WHERE id = ?1"
        ))
        .bind(id)
        .execute(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    /// Next batch of eligible recipients for a campaign that have no delivery
    /// row yet. Eligibility mirrors `count_audience_for_topic`.
    pub async fn audience_batch(
        pool: &DbPool,
        topic: &str,
        campaign_id: i64,
        limit: i64,
    ) -> Result<Vec<AudienceGuest>, ApiError> {
        let rows = query(crate::sql_query!(
            postgres: r#"
                SELECT g.id, g.email, g.first_name, g.full_name FROM guests g
                WHERE g.is_active IS TRUE
                  AND g.email IS NOT NULL AND length(trim(g.email)) > 0
                  AND EXISTS (SELECT 1 FROM notification_subscriptions ns
                              WHERE ns.guest_id = g.id AND ns.channel = 'email'
                                AND ns.topic = $1 AND ns.subscribed IS TRUE)
                  AND NOT EXISTS (SELECT 1 FROM email_suppressions es
                                  WHERE es.email = LOWER(g.email))
                  AND NOT EXISTS (SELECT 1 FROM email_deliveries d
                                  WHERE d.campaign_id = $2 AND d.guest_id = g.id)
                ORDER BY g.id
                LIMIT $3
            "#,
            sqlite: r#"
                SELECT g.id, g.email, g.first_name, g.full_name FROM guests g
                WHERE g.is_active = 1
                  AND g.email IS NOT NULL AND length(trim(g.email)) > 0
                  AND EXISTS (SELECT 1 FROM notification_subscriptions ns
                              WHERE ns.guest_id = g.id AND ns.channel = 'email'
                                AND ns.topic = ?1 AND ns.subscribed = 1)
                  AND NOT EXISTS (SELECT 1 FROM email_suppressions es
                                  WHERE es.email = LOWER(g.email))
                  AND NOT EXISTS (SELECT 1 FROM email_deliveries d
                                  WHERE d.campaign_id = ?2 AND d.guest_id = g.id)
                ORDER BY g.id
                LIMIT ?3
            "#
        ))
        .bind(topic)
        .bind(campaign_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows.iter().map(audience_guest_from_row).collect())
    }

    /// Guests whose birthday (month, day) matches either provided pair, are
    /// eligible for the birthday topic, and have no voucher issued for
    /// `source_reference` yet. The second pair covers the Feb-29→Feb-28
    /// policy; pass the same pair twice when unused.
    #[allow(clippy::too_many_arguments)]
    pub async fn birthday_targets(
        pool: &DbPool,
        month1: i32,
        day1: i32,
        month2: i32,
        day2: i32,
        source_reference: &str,
        limit: i64,
    ) -> Result<Vec<AudienceGuest>, ApiError> {
        let rows = query(crate::sql_query!(
            postgres: r#"
                SELECT g.id, g.email, g.first_name, g.full_name FROM guests g
                WHERE g.is_active IS TRUE
                  AND g.email IS NOT NULL AND length(trim(g.email)) > 0
                  AND g.date_of_birth IS NOT NULL
                  AND (
                      (EXTRACT(MONTH FROM g.date_of_birth) = $1 AND EXTRACT(DAY FROM g.date_of_birth) = $2)
                      OR (EXTRACT(MONTH FROM g.date_of_birth) = $3 AND EXTRACT(DAY FROM g.date_of_birth) = $4)
                  )
                  AND EXISTS (SELECT 1 FROM notification_subscriptions ns
                              WHERE ns.guest_id = g.id AND ns.channel = 'email'
                                AND ns.topic = 'birthday_voucher' AND ns.subscribed IS TRUE)
                  AND NOT EXISTS (SELECT 1 FROM email_suppressions es
                                  WHERE es.email = LOWER(g.email))
                  AND NOT EXISTS (SELECT 1 FROM vouchers v
                                  WHERE v.guest_id = g.id AND v.source_reference = $5)
                ORDER BY g.id
                LIMIT $6
            "#,
            sqlite: r#"
                SELECT g.id, g.email, g.first_name, g.full_name FROM guests g
                WHERE g.is_active = 1
                  AND g.email IS NOT NULL AND length(trim(g.email)) > 0
                  AND g.date_of_birth IS NOT NULL
                  AND (
                      (CAST(strftime('%m', g.date_of_birth) AS INTEGER) = ?1 AND CAST(strftime('%d', g.date_of_birth) AS INTEGER) = ?2)
                      OR (CAST(strftime('%m', g.date_of_birth) AS INTEGER) = ?3 AND CAST(strftime('%d', g.date_of_birth) AS INTEGER) = ?4)
                  )
                  AND EXISTS (SELECT 1 FROM notification_subscriptions ns
                              WHERE ns.guest_id = g.id AND ns.channel = 'email'
                                AND ns.topic = 'birthday_voucher' AND ns.subscribed = 1)
                  AND NOT EXISTS (SELECT 1 FROM email_suppressions es
                                  WHERE es.email = LOWER(g.email))
                  AND NOT EXISTS (SELECT 1 FROM vouchers v
                                  WHERE v.guest_id = g.id AND v.source_reference = ?5)
                ORDER BY g.id
                LIMIT ?6
            "#
        ))
        .bind(month1)
        .bind(day1)
        .bind(month2)
        .bind(day2)
        .bind(source_reference)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows.iter().map(audience_guest_from_row).collect())
    }

    /// Issues a birthday voucher. Conflict-tolerant on BOTH unique guards
    /// (one per promotion+guest, one per guest+source_reference): any
    /// conflict returns None and nothing is inserted.
    pub async fn insert_birthday_voucher_tx(
        tx: &mut DbTransaction<'_>,
        promotion_id: i64,
        guest_id: i64,
        code: &str,
        expires_at: DateTime<Utc>,
        source_reference: &str,
    ) -> Result<Option<i64>, ApiError> {
        query_scalar(crate::sql_query!(
            postgres: r#"
                INSERT INTO vouchers
                    (promotion_id, guest_id, code, status, source, expires_at, source_reference)
                VALUES ($1, $2, $3, 'available', 'admin_issue', $4, $5)
                ON CONFLICT DO NOTHING
                RETURNING id
            "#,
            sqlite: r#"
                INSERT OR IGNORE INTO vouchers
                    (promotion_id, guest_id, code, status, source, expires_at, source_reference)
                VALUES (?1, ?2, ?3, 'available', 'admin_issue', ?4, ?5)
                RETURNING id
            "#
        ))
        .bind(promotion_id)
        .bind(guest_id)
        .bind(code)
        .bind(expires_at)
        .bind(source_reference)
        .fetch_optional(&mut **tx)
        .await
        .map_err(ApiError::from)
    }

    pub async fn promotion_name(pool: &DbPool, id: i64) -> Result<Option<String>, ApiError> {
        query_scalar(crate::sql_query!(
            postgres: "SELECT name FROM promotions WHERE id = $1",
            sqlite: "SELECT name FROM promotions WHERE id = ?1"
        ))
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    /// "Today" in the hotel's configured timezone (Postgres session timezone;
    /// host-local time on SQLite deployments).
    pub async fn hotel_local_date(pool: &DbPool) -> Result<chrono::NaiveDate, ApiError> {
        let raw: String = query_scalar(crate::sql_query!(
            postgres: "SELECT to_char(LOCALTIMESTAMP, 'YYYY-MM-DD')",
            sqlite: "SELECT strftime('%Y-%m-%d', 'now', 'localtime')"
        ))
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        raw.parse()
            .map_err(|_| ApiError::Internal("Unparseable hotel-local date".to_string()))
    }

    // ------------------------------------------------------------------
    // Outbox worker
    // ------------------------------------------------------------------

    /// Atomically leases up to `batch` due deliveries for this worker:
    /// queued rows whose retry time has arrived, plus rows whose previous
    /// lease expired (crash recovery). Claiming increments `attempts`.
    pub async fn claim_due_deliveries(
        pool: &DbPool,
        worker_id: &str,
        batch: i64,
    ) -> Result<Vec<EmailDelivery>, ApiError> {
        let sql = crate::sql_query!(
            postgres: r#"
                UPDATE email_deliveries SET
                    status = 'sending',
                    lease_owner = $1,
                    lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '5 minutes',
                    attempts = attempts + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id IN (
                    SELECT id FROM email_deliveries
                    WHERE (status = 'queued' AND next_attempt_at <= CURRENT_TIMESTAMP)
                       OR (status = 'sending' AND lease_expires_at < CURRENT_TIMESTAMP)
                    ORDER BY next_attempt_at
                    LIMIT $2
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING {COLS}
            "#,
            sqlite: r#"
                UPDATE email_deliveries SET
                    status = 'sending',
                    lease_owner = ?1,
                    lease_expires_at = datetime('now', '+5 minutes'),
                    attempts = attempts + 1,
                    updated_at = datetime('now')
                WHERE id IN (
                    SELECT id FROM email_deliveries
                    WHERE (status = 'queued' AND datetime(next_attempt_at) <= datetime('now'))
                       OR (status = 'sending' AND datetime(lease_expires_at) < datetime('now'))
                    ORDER BY next_attempt_at
                    LIMIT ?2
                )
                RETURNING {COLS}
            "#
        )
        .replace("{COLS}", DELIVERY_COLUMNS);
        let rows = query(&sql)
            .bind(worker_id)
            .bind(batch)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(rows.iter().map(delivery_from_row).collect())
    }

    /// Last-moment eligibility recheck: the guest must still exist, be
    /// active, and hold a live subscription for the topic.
    pub async fn is_guest_deliverable(
        pool: &DbPool,
        guest_id: i64,
        topic: &str,
    ) -> Result<bool, ApiError> {
        let count: i64 = query_scalar(crate::sql_query!(
            postgres: r#"
                SELECT COUNT(*) FROM guests g
                WHERE g.id = $1 AND g.is_active IS TRUE
                  AND EXISTS (SELECT 1 FROM notification_subscriptions ns
                              WHERE ns.guest_id = g.id AND ns.channel = 'email'
                                AND ns.topic = $2 AND ns.subscribed IS TRUE)
            "#,
            sqlite: r#"
                SELECT COUNT(*) FROM guests g
                WHERE g.id = ?1 AND g.is_active = 1
                  AND EXISTS (SELECT 1 FROM notification_subscriptions ns
                              WHERE ns.guest_id = g.id AND ns.channel = 'email'
                                AND ns.topic = ?2 AND ns.subscribed = 1)
            "#
        ))
        .bind(guest_id)
        .bind(topic)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(count > 0)
    }

    pub async fn mark_delivery_sent_tx(
        tx: &mut DbTransaction<'_>,
        id: i64,
        provider_message_id: Option<&str>,
    ) -> Result<(), ApiError> {
        query(crate::sql_query!(
            postgres: r#"
                UPDATE email_deliveries SET
                    status = 'sent', sent_at = CURRENT_TIMESTAMP,
                    provider_message_id = $1, last_error = NULL,
                    lease_owner = NULL, lease_expires_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            "#,
            sqlite: r#"
                UPDATE email_deliveries SET
                    status = 'sent', sent_at = datetime('now'),
                    provider_message_id = ?1, last_error = NULL,
                    lease_owner = NULL, lease_expires_at = NULL,
                    updated_at = datetime('now')
                WHERE id = ?2
            "#
        ))
        .bind(provider_message_id)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    /// `retry_at = Some(..)` requeues for retry; `None` marks terminally failed.
    pub async fn mark_delivery_failed_tx(
        tx: &mut DbTransaction<'_>,
        id: i64,
        error: &str,
        retry_at: Option<DateTime<Utc>>,
    ) -> Result<(), ApiError> {
        match retry_at {
            Some(retry_at) => query(crate::sql_query!(
                postgres: r#"
                    UPDATE email_deliveries SET
                        status = 'queued', next_attempt_at = $1, last_error = $2,
                        lease_owner = NULL, lease_expires_at = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $3
                "#,
                sqlite: r#"
                    UPDATE email_deliveries SET
                        status = 'queued', next_attempt_at = ?1, last_error = ?2,
                        lease_owner = NULL, lease_expires_at = NULL,
                        updated_at = datetime('now')
                    WHERE id = ?3
                "#
            ))
            .bind(retry_at)
            .bind(error)
            .bind(id)
            .execute(&mut **tx)
            .await
            .map(|_| ())
            .map_err(ApiError::from),
            None => query(crate::sql_query!(
                postgres: r#"
                    UPDATE email_deliveries SET
                        status = 'failed', last_error = $1,
                        lease_owner = NULL, lease_expires_at = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2
                "#,
                sqlite: r#"
                    UPDATE email_deliveries SET
                        status = 'failed', last_error = ?1,
                        lease_owner = NULL, lease_expires_at = NULL,
                        updated_at = datetime('now')
                    WHERE id = ?2
                "#
            ))
            .bind(error)
            .bind(id)
            .execute(&mut **tx)
            .await
            .map(|_| ())
            .map_err(ApiError::from),
        }
    }

    /// Terminal skip without sending: `status` is 'suppressed' (consent or
    /// suppression-list recheck failed) or 'cancelled' (campaign cancelled).
    pub async fn mark_delivery_skipped_tx(
        tx: &mut DbTransaction<'_>,
        id: i64,
        status: &str,
        reason: &str,
    ) -> Result<(), ApiError> {
        query(crate::sql_query!(
            postgres: r#"
                UPDATE email_deliveries SET
                    status = $1, last_error = $2,
                    lease_owner = NULL, lease_expires_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            "#,
            sqlite: r#"
                UPDATE email_deliveries SET
                    status = ?1, last_error = ?2,
                    lease_owner = NULL, lease_expires_at = NULL,
                    updated_at = datetime('now')
                WHERE id = ?3
            "#
        ))
        .bind(status)
        .bind(reason)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        Ok(())
    }

    /// Completes a running campaign once no deliveries remain in flight.
    pub async fn complete_campaign_if_done(
        pool: &DbPool,
        campaign_id: i64,
    ) -> Result<bool, ApiError> {
        let result = query(crate::sql_query!(
            postgres: r#"
                UPDATE email_campaigns SET
                    status = 'completed', completed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND status = 'running'
                  AND NOT EXISTS (SELECT 1 FROM email_deliveries
                                  WHERE campaign_id = $1 AND status IN ('queued', 'sending'))
            "#,
            sqlite: r#"
                UPDATE email_campaigns SET
                    status = 'completed', completed_at = datetime('now'),
                    updated_at = datetime('now')
                WHERE id = ?1 AND status = 'running'
                  AND NOT EXISTS (SELECT 1 FROM email_deliveries
                                  WHERE campaign_id = ?1 AND status IN ('queued', 'sending'))
            "#
        ))
        .bind(campaign_id)
        .execute(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(result.rows_affected() > 0)
    }

    // ------------------------------------------------------------------
    // Cross-domain lookups
    // ------------------------------------------------------------------

    pub async fn promotion_status(
        pool: &DbPool,
        promotion_id: i64,
    ) -> Result<Option<String>, ApiError> {
        query_scalar(crate::sql_query!(
            postgres: "SELECT status FROM promotions WHERE id = $1",
            sqlite: "SELECT status FROM promotions WHERE id = ?1"
        ))
        .bind(promotion_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
    }

    /// Returns Some(email) for an existing guest (None email allowed), or
    /// Err(NotFound) when the guest does not exist.
    pub async fn get_guest_email(pool: &DbPool, guest_id: i64) -> Result<Option<String>, ApiError> {
        let row = query(crate::sql_query!(
            postgres: "SELECT email FROM guests WHERE id = $1",
            sqlite: "SELECT email FROM guests WHERE id = ?1"
        ))
        .bind(guest_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::NotFound("Guest not found".to_string()))?;
        Ok(row.try_get::<Option<String>, _>("email").ok().flatten())
    }

    // ------------------------------------------------------------------
    // Audience
    // ------------------------------------------------------------------

    /// Server-side audience counts for a topic. Never returns recipients.
    pub async fn count_audience_for_topic(
        pool: &DbPool,
        topic: &str,
    ) -> Result<AudienceCount, ApiError> {
        let row = query(crate::sql_query!(
            postgres: r#"
                SELECT
                    (SELECT COUNT(*) FROM guests g
                     WHERE g.is_active IS TRUE
                       AND g.email IS NOT NULL AND length(trim(g.email)) > 0
                       AND EXISTS (SELECT 1 FROM notification_subscriptions ns
                                   WHERE ns.guest_id = g.id AND ns.channel = 'email'
                                     AND ns.topic = $1 AND ns.subscribed IS TRUE)
                       AND NOT EXISTS (SELECT 1 FROM email_suppressions es
                                       WHERE es.email = LOWER(g.email))) AS eligible,
                    (SELECT COUNT(*) FROM guests g
                     WHERE g.is_active IS TRUE
                       AND (g.email IS NULL OR length(trim(g.email)) = 0)) AS excluded_no_email,
                    (SELECT COUNT(*) FROM guests g
                     WHERE g.is_active IS NOT TRUE) AS excluded_inactive,
                    (SELECT COUNT(*) FROM guests g
                     WHERE g.is_active IS TRUE
                       AND g.email IS NOT NULL AND length(trim(g.email)) > 0
                       AND NOT EXISTS (SELECT 1 FROM notification_subscriptions ns
                                       WHERE ns.guest_id = g.id AND ns.channel = 'email'
                                         AND ns.topic = $1 AND ns.subscribed IS TRUE)) AS excluded_unsubscribed,
                    (SELECT COUNT(*) FROM guests g
                     WHERE g.is_active IS TRUE
                       AND g.email IS NOT NULL AND length(trim(g.email)) > 0
                       AND EXISTS (SELECT 1 FROM notification_subscriptions ns
                                   WHERE ns.guest_id = g.id AND ns.channel = 'email'
                                     AND ns.topic = $1 AND ns.subscribed IS TRUE)
                       AND EXISTS (SELECT 1 FROM email_suppressions es
                                   WHERE es.email = LOWER(g.email))) AS excluded_suppressed
            "#,
            sqlite: r#"
                SELECT
                    (SELECT COUNT(*) FROM guests g
                     WHERE g.is_active = 1
                       AND g.email IS NOT NULL AND length(trim(g.email)) > 0
                       AND EXISTS (SELECT 1 FROM notification_subscriptions ns
                                   WHERE ns.guest_id = g.id AND ns.channel = 'email'
                                     AND ns.topic = ?1 AND ns.subscribed = 1)
                       AND NOT EXISTS (SELECT 1 FROM email_suppressions es
                                       WHERE es.email = LOWER(g.email))) AS eligible,
                    (SELECT COUNT(*) FROM guests g
                     WHERE g.is_active = 1
                       AND (g.email IS NULL OR length(trim(g.email)) = 0)) AS excluded_no_email,
                    (SELECT COUNT(*) FROM guests g
                     WHERE g.is_active IS NULL OR g.is_active <> 1) AS excluded_inactive,
                    (SELECT COUNT(*) FROM guests g
                     WHERE g.is_active = 1
                       AND g.email IS NOT NULL AND length(trim(g.email)) > 0
                       AND NOT EXISTS (SELECT 1 FROM notification_subscriptions ns
                                       WHERE ns.guest_id = g.id AND ns.channel = 'email'
                                         AND ns.topic = ?1 AND ns.subscribed = 1)) AS excluded_unsubscribed,
                    (SELECT COUNT(*) FROM guests g
                     WHERE g.is_active = 1
                       AND g.email IS NOT NULL AND length(trim(g.email)) > 0
                       AND EXISTS (SELECT 1 FROM notification_subscriptions ns
                                   WHERE ns.guest_id = g.id AND ns.channel = 'email'
                                     AND ns.topic = ?1 AND ns.subscribed = 1)
                       AND EXISTS (SELECT 1 FROM email_suppressions es
                                   WHERE es.email = LOWER(g.email))) AS excluded_suppressed
            "#
        ))
        .bind(topic)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(AudienceCount {
            eligible: row.try_get("eligible").unwrap_or_default(),
            excluded_no_email: row.try_get("excluded_no_email").unwrap_or_default(),
            excluded_inactive: row.try_get("excluded_inactive").unwrap_or_default(),
            excluded_unsubscribed: row.try_get("excluded_unsubscribed").unwrap_or_default(),
            excluded_suppressed: row.try_get("excluded_suppressed").unwrap_or_default(),
        })
    }
}
