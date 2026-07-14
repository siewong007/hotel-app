//! Persistence for guest support conversations.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{Executor, Row};

use super::models::{
    GuestSupportConversation, SupportAgent, SupportConversation, SupportConversationSummary,
    SupportEvent, SupportMessage, SupportQueueMetrics,
};
use crate::core::db::{DbDatabase, DbPool, DbRow};
use crate::core::error::ApiError;
use crate::sql_query;

const CONVERSATION_SELECT: &str = r#"
SELECT
    c.id,
    c.conversation_number,
    c.guest_id,
    COALESCE(g.full_name, trim(g.first_name || ' ' || g.last_name), 'Guest') AS guest_name,
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
    c.subject,
    b.status AS stay_status,
    b.check_in_date,
    b.check_out_date,
    c.resolution_code,
    c.resolution_summary,
    c.reopen_count,
    c.version,
    c.last_activity_at,
    c.created_at,
    c.updated_at,
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
    ) AS last_message_at
FROM support_conversations c
JOIN guests g ON g.id = c.guest_id
LEFT JOIN bookings b ON b.id = c.booking_id
LEFT JOIN rooms r ON r.id = b.room_id
LEFT JOIN users u ON u.id = c.assigned_to_user_id
"#;

fn optional<T>(row: &DbRow, column: &str) -> Option<T>
where
    for<'r> T: sqlx::Decode<'r, DbDatabase> + sqlx::Type<DbDatabase> + Send + Unpin,
{
    row.try_get::<Option<T>, _>(column).ok().flatten()
}

fn summary_from_row(row: &DbRow) -> SupportConversationSummary {
    let first_response_due_at = optional(row, "first_response_due_at");
    let resolution_due_at = optional(row, "resolution_due_at");
    let first_response_at = optional(row, "first_response_at");
    let resolved_at = optional(row, "resolved_at");
    let status: String = row.get("status");
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
        id: row.get("id"),
        conversation_number: row.get("conversation_number"),
        guest_id: row.get("guest_id"),
        guest_name: row.get("guest_name"),
        guest_email: optional(row, "guest_email"),
        booking_id: optional(row, "booking_id"),
        booking_reference: optional(row, "booking_reference"),
        room_number: optional(row, "room_number"),
        category: row.get("category"),
        status,
        priority: row.get("priority"),
        queue: row.get("assigned_team"),
        assigned_to_user_id: optional(row, "assigned_to_user_id"),
        assigned_to_name: optional(row, "assigned_to_name"),
        escalation_level: row.get("escalation_level"),
        escalated_at: optional(row, "escalated_at"),
        first_response_due_at,
        resolution_due_at,
        first_response_at,
        resolved_at,
        closed_at: optional(row, "closed_at"),
        last_message_preview: optional(row, "last_message_preview"),
        last_message_at: optional(row, "last_message_at"),
        last_activity_at: row.get("last_activity_at"),
        unread_count: 0,
        is_sla_at_risk,
        is_sla_breached,
        version: row.get("version"),
    }
}

fn conversation_from_row(row: &DbRow) -> SupportConversation {
    SupportConversation {
        summary: summary_from_row(row),
        subject: optional(row, "subject"),
        stay_status: optional(row, "stay_status"),
        check_in_date: optional(row, "check_in_date"),
        check_out_date: optional(row, "check_out_date"),
        resolution_code: optional(row, "resolution_code"),
        resolution_summary: optional(row, "resolution_summary"),
        reopen_count: row.get("reopen_count"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn details_from_row(row: &DbRow) -> Option<Value> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        optional::<String>(row, "details").and_then(|value| serde_json::from_str(&value).ok())
    }

    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        optional::<Value>(row, "details")
    }
}

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
fn details_bind(details: Option<Value>) -> Option<String> {
    details.map(|value| value.to_string())
}

#[cfg(any(
    all(feature = "postgres", not(feature = "sqlite")),
    all(feature = "sqlite", feature = "postgres")
))]
fn details_bind(details: Option<Value>) -> Option<Value> {
    details
}

fn event_from_row(row: &DbRow) -> SupportEvent {
    let metadata = details_from_row(row);
    let body = metadata
        .as_ref()
        .and_then(|details| details.get("body"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    SupportEvent {
        id: row.get("id"),
        conversation_id: row.get("conversation_id"),
        event_type: row.get("event_type"),
        actor_user_id: optional(row, "actor_user_id"),
        actor_name: optional(row, "actor_name"),
        body,
        metadata,
        created_at: row.get("created_at"),
    }
}

fn message_from_row(row: &DbRow) -> SupportMessage {
    SupportMessage {
        id: row.get("id"),
        conversation_id: row.get("conversation_id"),
        author_type: row.get("author_type"),
        author_user_id: optional(row, "author_user_id"),
        author_guest_id: optional(row, "author_guest_id"),
        author_name: optional(row, "author_name"),
        body: row.get("body"),
        created_at: row.get("created_at"),
    }
}

pub struct NewConversation<'a> {
    pub conversation_number: &'a str,
    pub guest_id: i64,
    pub booking_id: Option<i64>,
    pub subject: &'a str,
    pub category: &'a str,
    pub priority: &'a str,
    pub first_response_due_at: DateTime<Utc>,
    pub resolution_due_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct ConversationMutation {
    pub status: String,
    pub priority: String,
    pub assigned_team: String,
    pub assigned_to_user_id: Option<i64>,
    pub escalation_level: i32,
    pub escalated_at: Option<DateTime<Utc>>,
    pub first_response_due_at: Option<DateTime<Utc>>,
    pub resolution_due_at: Option<DateTime<Utc>>,
    pub first_response_at: Option<DateTime<Utc>>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    pub resolution_code: Option<String>,
    pub resolution_summary: Option<String>,
    pub reopen_count: i32,
    pub expected_version: Option<i64>,
}

pub struct SupportRepository;

impl SupportRepository {
    pub async fn find_conversation(
        pool: &DbPool,
        conversation_id: i64,
    ) -> Result<Option<SupportConversation>, ApiError> {
        let sql = format!("{CONVERSATION_SELECT} WHERE c.id = {}", crate::param!(1));
        let row = sqlx::query(&sql)
            .bind(conversation_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(conversation_from_row))
    }

    pub async fn find_guest_conversation(
        pool: &DbPool,
        guest_id: i64,
        conversation_id: i64,
    ) -> Result<Option<SupportConversation>, ApiError> {
        let sql = format!(
            "{CONVERSATION_SELECT} WHERE c.id = {} AND c.guest_id = {}",
            crate::param!(1),
            crate::param!(2)
        );
        let row = sqlx::query(&sql)
            .bind(conversation_id)
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(row.as_ref().map(conversation_from_row))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn list_conversations(
        pool: &DbPool,
        viewer_id: i64,
        queue: Option<&str>,
        status: Option<&str>,
        priority: Option<&str>,
        assigned_to_user_id: Option<i64>,
        search: Option<&str>,
        page_size: i64,
        offset: i64,
    ) -> Result<(i64, Vec<SupportConversationSummary>), ApiError> {
        let filter = sql_query!(
            postgres: r#"
WHERE (
        $1::text IS NULL
        OR ($1 = 'unassigned' AND c.assigned_to_user_id IS NULL AND c.status <> 'closed')
        OR ($1 = 'mine' AND c.assigned_to_user_id = $2 AND c.status <> 'closed')
        OR ($1 = 'at_risk' AND (
            (c.first_response_at IS NULL AND c.status = 'waiting_for_staff' AND c.first_response_due_at <= CURRENT_TIMESTAMP + INTERVAL '30 minutes')
            OR (c.resolved_at IS NULL AND c.status NOT IN ('waiting_for_guest', 'closed') AND c.resolution_due_at <= CURRENT_TIMESTAMP + INTERVAL '30 minutes')
        ))
        OR ($1 IN ('waiting_for_staff', 'waiting_for_guest', 'resolved', 'closed') AND c.status = $1)
    )
  AND ($3::text IS NULL OR c.status = $3)
  AND ($4::text IS NULL OR c.priority = $4)
  AND ($5::bigint IS NULL OR c.assigned_to_user_id = $5)
  AND ($6::text IS NULL OR (
        lower(c.conversation_number) LIKE lower($6)
        OR lower(COALESCE(g.full_name, g.first_name || ' ' || g.last_name, '')) LIKE lower($6)
        OR lower(COALESCE(b.booking_number, '')) LIKE lower($6)
  ))
"#,
            sqlite: r#"
WHERE (
        ?1 IS NULL
        OR (?1 = 'unassigned' AND c.assigned_to_user_id IS NULL AND c.status <> 'closed')
        OR (?1 = 'mine' AND c.assigned_to_user_id = ?2 AND c.status <> 'closed')
        OR (?1 = 'at_risk' AND (
            (c.first_response_at IS NULL AND c.status = 'waiting_for_staff' AND c.first_response_due_at <= datetime('now', '+30 minutes'))
            OR (c.resolved_at IS NULL AND c.status NOT IN ('waiting_for_guest', 'closed') AND c.resolution_due_at <= datetime('now', '+30 minutes'))
        ))
        OR (?1 IN ('waiting_for_staff', 'waiting_for_guest', 'resolved', 'closed') AND c.status = ?1)
    )
  AND (?3 IS NULL OR c.status = ?3)
  AND (?4 IS NULL OR c.priority = ?4)
  AND (?5 IS NULL OR c.assigned_to_user_id = ?5)
  AND (?6 IS NULL OR (
        lower(c.conversation_number) LIKE lower(?6)
        OR lower(COALESCE(g.full_name, g.first_name || ' ' || g.last_name, '')) LIKE lower(?6)
        OR lower(COALESCE(b.booking_number, '')) LIKE lower(?6)
  ))
"#
        );
        let count_sql = format!(
            "SELECT COUNT(*) FROM support_conversations c JOIN guests g ON g.id = c.guest_id LEFT JOIN bookings b ON b.id = c.booking_id {filter}"
        );
        let list_sql = format!(
            "{CONVERSATION_SELECT} {filter} ORDER BY CASE c.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC, c.first_response_due_at ASC NULLS LAST, c.last_activity_at DESC LIMIT {} OFFSET {}",
            crate::param!(7),
            crate::param!(8)
        );
        let search_pattern = search
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("%{value}%"));

        let total = sqlx::query_scalar::<_, i64>(&count_sql)
            .bind(queue)
            .bind(viewer_id)
            .bind(status)
            .bind(priority)
            .bind(assigned_to_user_id)
            .bind(&search_pattern)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        let rows = sqlx::query(&list_sql)
            .bind(queue)
            .bind(viewer_id)
            .bind(status)
            .bind(priority)
            .bind(assigned_to_user_id)
            .bind(&search_pattern)
            .bind(page_size)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

        Ok((total, rows.iter().map(summary_from_row).collect()))
    }

    pub async fn queue_metrics(pool: &DbPool) -> Result<SupportQueueMetrics, ApiError> {
        let row = sqlx::query(sql_query!(
            postgres: r#"
SELECT
    COUNT(*) FILTER (WHERE status <> 'closed') AS total_open,
    COUNT(*) FILTER (WHERE status <> 'closed' AND assigned_to_user_id IS NULL) AS unassigned,
    COUNT(*) FILTER (WHERE status = 'waiting_for_staff') AS waiting_for_staff,
    COUNT(*) FILTER (WHERE status = 'waiting_for_guest') AS waiting_for_guest,
    COUNT(*) FILTER (WHERE (
        (first_response_at IS NULL AND status = 'waiting_for_staff' AND first_response_due_at <= CURRENT_TIMESTAMP + INTERVAL '30 minutes')
        OR (resolved_at IS NULL AND status NOT IN ('waiting_for_guest', 'closed') AND resolution_due_at <= CURRENT_TIMESTAMP + INTERVAL '30 minutes')
    )) AS at_risk,
    COUNT(*) FILTER (WHERE (
        (first_response_at IS NULL AND status = 'waiting_for_staff' AND first_response_due_at <= CURRENT_TIMESTAMP)
        OR (resolved_at IS NULL AND status NOT IN ('waiting_for_guest', 'closed') AND resolution_due_at <= CURRENT_TIMESTAMP)
    )) AS breached
FROM support_conversations
"#,
            sqlite: r#"
SELECT
    SUM(CASE WHEN status <> 'closed' THEN 1 ELSE 0 END) AS total_open,
    SUM(CASE WHEN status <> 'closed' AND assigned_to_user_id IS NULL THEN 1 ELSE 0 END) AS unassigned,
    SUM(CASE WHEN status = 'waiting_for_staff' THEN 1 ELSE 0 END) AS waiting_for_staff,
    SUM(CASE WHEN status = 'waiting_for_guest' THEN 1 ELSE 0 END) AS waiting_for_guest,
    SUM(CASE WHEN (
        (first_response_at IS NULL AND status = 'waiting_for_staff' AND first_response_due_at <= datetime('now', '+30 minutes'))
        OR (resolved_at IS NULL AND status NOT IN ('waiting_for_guest', 'closed') AND resolution_due_at <= datetime('now', '+30 minutes'))
    ) THEN 1 ELSE 0 END) AS at_risk,
    SUM(CASE WHEN (
        (first_response_at IS NULL AND status = 'waiting_for_staff' AND first_response_due_at <= datetime('now'))
        OR (resolved_at IS NULL AND status NOT IN ('waiting_for_guest', 'closed') AND resolution_due_at <= datetime('now'))
    ) THEN 1 ELSE 0 END) AS breached
FROM support_conversations
"#
        ))
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;

        Ok(SupportQueueMetrics {
            total_open: row
                .try_get::<Option<i64>, _>("total_open")
                .ok()
                .flatten()
                .unwrap_or(0),
            unassigned: row
                .try_get::<Option<i64>, _>("unassigned")
                .ok()
                .flatten()
                .unwrap_or(0),
            waiting_for_staff: row
                .try_get::<Option<i64>, _>("waiting_for_staff")
                .ok()
                .flatten()
                .unwrap_or(0),
            waiting_for_guest: row
                .try_get::<Option<i64>, _>("waiting_for_guest")
                .ok()
                .flatten()
                .unwrap_or(0),
            at_risk: row
                .try_get::<Option<i64>, _>("at_risk")
                .ok()
                .flatten()
                .unwrap_or(0),
            breached: row
                .try_get::<Option<i64>, _>("breached")
                .ok()
                .flatten()
                .unwrap_or(0),
        })
    }

    pub async fn list_guest_conversations(
        pool: &DbPool,
        guest_id: i64,
        page_size: i64,
        offset: i64,
        reopen_window_days: i64,
    ) -> Result<(i64, Vec<GuestSupportConversation>), ApiError> {
        let count_sql = format!(
            "SELECT COUNT(*) FROM support_conversations WHERE guest_id = {}",
            crate::param!(1)
        );
        let list_sql = format!(
            "SELECT id, category, status, assigned_team, booking_id, subject, created_at, updated_at, last_activity_at, first_response_at, resolved_at, closed_at, resolution_summary, version, CASE WHEN status = 'resolved' AND resolved_at >= {} THEN {} ELSE {} END AS can_reopen FROM support_conversations WHERE guest_id = {} ORDER BY last_activity_at DESC, id DESC LIMIT {} OFFSET {}",
            crate::sql_query!(postgres: "CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')", sqlite: "datetime('now', '-' || ?1 || ' days')"),
            crate::sql_query!(postgres: "true", sqlite: "1"),
            crate::sql_query!(postgres: "false", sqlite: "0"),
            crate::param!(2),
            crate::param!(3),
            crate::param!(4)
        );
        let total = sqlx::query_scalar::<_, i64>(&count_sql)
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        let rows = sqlx::query(&list_sql)
            .bind(reopen_window_days)
            .bind(guest_id)
            .bind(page_size)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;

        Ok((
            total,
            rows.iter()
                .map(|row| GuestSupportConversation {
                    id: row.get("id"),
                    category: row.get("category"),
                    status: row.get("status"),
                    assigned_team: "Hotel support team".to_string(),
                    booking_id: optional(row, "booking_id"),
                    subject: optional(row, "subject"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                    last_activity_at: row.get("last_activity_at"),
                    first_response_at: optional(row, "first_response_at"),
                    resolved_at: optional(row, "resolved_at"),
                    closed_at: optional(row, "closed_at"),
                    resolution_summary: optional(row, "resolution_summary"),
                    can_reopen: row.get("can_reopen"),
                    version: row.get("version"),
                })
                .collect(),
        ))
    }

    pub async fn list_messages(
        pool: &DbPool,
        conversation_id: i64,
    ) -> Result<Vec<SupportMessage>, ApiError> {
        let sql = format!(
            r#"
SELECT sm.id, sm.conversation_id, sm.author_type, sm.author_user_id, sm.author_guest_id,
       COALESCE(u.full_name, g.full_name, trim(g.first_name || ' ' || g.last_name)) AS author_name,
       sm.body, sm.created_at
FROM support_messages sm
LEFT JOIN users u ON u.id = sm.author_user_id
LEFT JOIN guests g ON g.id = sm.author_guest_id
WHERE sm.conversation_id = {}
ORDER BY sm.created_at ASC, sm.id ASC
"#,
            crate::param!(1)
        );
        let rows = sqlx::query(&sql)
            .bind(conversation_id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(rows.iter().map(message_from_row).collect())
    }

    pub async fn list_events(
        pool: &DbPool,
        conversation_id: i64,
    ) -> Result<Vec<SupportEvent>, ApiError> {
        let sql = format!(
            r#"
SELECT se.id, se.conversation_id, se.event_type, se.actor_user_id,
       u.full_name AS actor_name, se.details, se.created_at
FROM support_events se
LEFT JOIN users u ON u.id = se.actor_user_id
WHERE se.conversation_id = {}
ORDER BY se.created_at ASC, se.id ASC
"#,
            crate::param!(1)
        );
        let rows = sqlx::query(&sql)
            .bind(conversation_id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(rows.iter().map(event_from_row).collect())
    }

    pub async fn list_agents(pool: &DbPool) -> Result<Vec<SupportAgent>, ApiError> {
        let rows = sqlx::query(sql_query!(
            postgres: r#"
SELECT DISTINCT u.id, COALESCE(u.full_name, u.username) AS name, u.email
FROM users u
WHERE COALESCE(u.is_active, true) = true
  AND EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = u.id AND p.name IN ('support:read', 'support:manage')
  )
  AND EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = u.id AND p.name IN ('support:write', 'support:manage')
  )
ORDER BY name ASC
"#,
            sqlite: r#"
SELECT DISTINCT u.id, COALESCE(u.full_name, u.username) AS name, u.email
FROM users u
WHERE COALESCE(u.is_active, 1) = 1
  AND EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = u.id AND p.name IN ('support:read', 'support:manage')
  )
  AND EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = u.id AND p.name IN ('support:write', 'support:manage')
  )
ORDER BY name ASC
"#
        ))
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows
            .iter()
            .map(|row| SupportAgent {
                id: row.get("id"),
                name: row.get("name"),
                email: optional(row, "email"),
                is_available: true,
            })
            .collect())
    }

    pub async fn booking_belongs_to_guest(
        pool: &DbPool,
        booking_id: i64,
        guest_id: i64,
    ) -> Result<bool, ApiError> {
        let sql = sql_query!(
            postgres: "SELECT EXISTS (SELECT 1 FROM bookings WHERE id = $1 AND guest_id = $2)",
            sqlite: "SELECT EXISTS (SELECT 1 FROM bookings WHERE id = ?1 AND guest_id = ?2)"
        );
        sqlx::query_scalar(sql)
            .bind(booking_id)
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn insert_conversation<'e, E>(
        executor: E,
        conversation: &NewConversation<'_>,
    ) -> Result<i64, ApiError>
    where
        E: Executor<'e, Database = DbDatabase>,
    {
        let sql = sql_query!(
            postgres: r#"
INSERT INTO support_conversations (
    conversation_number, guest_id, booking_id, subject, category, priority,
    first_response_due_at, resolution_due_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id
"#,
            sqlite: r#"
INSERT INTO support_conversations (
    conversation_number, guest_id, booking_id, subject, category, priority,
    first_response_due_at, resolution_due_at
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
RETURNING id
"#
        );
        sqlx::query_scalar::<_, i64>(sql)
            .bind(conversation.conversation_number)
            .bind(conversation.guest_id)
            .bind(conversation.booking_id)
            .bind(conversation.subject)
            .bind(conversation.category)
            .bind(conversation.priority)
            .bind(conversation.first_response_due_at)
            .bind(conversation.resolution_due_at)
            .fetch_one(executor)
            .await
            .map_err(ApiError::from)
    }

    pub async fn insert_message<'e, E>(
        executor: E,
        conversation_id: i64,
        author_type: &str,
        author_guest_id: Option<i64>,
        author_user_id: Option<i64>,
        body: &str,
        client_message_id: Option<&str>,
    ) -> Result<i64, ApiError>
    where
        E: Executor<'e, Database = DbDatabase>,
    {
        let sql = sql_query!(
            postgres: r#"
INSERT INTO support_messages (
    conversation_id, author_type, author_guest_id, author_user_id, body, client_message_id
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id
"#,
            sqlite: r#"
INSERT INTO support_messages (
    conversation_id, author_type, author_guest_id, author_user_id, body, client_message_id
) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
RETURNING id
"#
        );
        sqlx::query_scalar::<_, i64>(sql)
            .bind(conversation_id)
            .bind(author_type)
            .bind(author_guest_id)
            .bind(author_user_id)
            .bind(body)
            .bind(client_message_id)
            .fetch_one(executor)
            .await
            .map_err(ApiError::from)
    }

    pub async fn client_message_exists(
        pool: &DbPool,
        conversation_id: i64,
        author_type: &str,
        client_message_id: &str,
    ) -> Result<bool, ApiError> {
        let sql = sql_query!(
            postgres: "SELECT EXISTS (SELECT 1 FROM support_messages WHERE conversation_id = $1 AND author_type = $2 AND client_message_id = $3)",
            sqlite: "SELECT EXISTS (SELECT 1 FROM support_messages WHERE conversation_id = ?1 AND author_type = ?2 AND client_message_id = ?3)"
        );
        sqlx::query_scalar(sql)
            .bind(conversation_id)
            .bind(author_type)
            .bind(client_message_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn find_guest_request_conversation(
        pool: &DbPool,
        guest_id: i64,
        client_request_id: &str,
    ) -> Result<Option<i64>, ApiError> {
        let sql = sql_query!(
            postgres: r#"
SELECT conversation_id
FROM support_guest_request_idempotency_keys
WHERE guest_id = $1 AND idempotency_key = $2
"#,
            sqlite: r#"
SELECT conversation_id
FROM support_guest_request_idempotency_keys
WHERE guest_id = ?1 AND idempotency_key = ?2
"#
        );
        sqlx::query_scalar(sql)
            .bind(guest_id)
            .bind(client_request_id)
            .fetch_optional(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn insert_guest_request_key<'e, E>(
        executor: E,
        guest_id: i64,
        client_request_id: &str,
        conversation_id: i64,
    ) -> Result<bool, ApiError>
    where
        E: Executor<'e, Database = DbDatabase>,
    {
        let sql = sql_query!(
            postgres: r#"
INSERT INTO support_guest_request_idempotency_keys (guest_id, idempotency_key, conversation_id)
VALUES ($1, $2, $3)
ON CONFLICT (guest_id, idempotency_key) DO NOTHING
"#,
            sqlite: r#"
INSERT INTO support_guest_request_idempotency_keys (guest_id, idempotency_key, conversation_id)
VALUES (?1, ?2, ?3)
ON CONFLICT (guest_id, idempotency_key) DO NOTHING
"#
        );
        let result = sqlx::query(sql)
            .bind(guest_id)
            .bind(client_request_id)
            .bind(conversation_id)
            .execute(executor)
            .await
            .map_err(ApiError::from)?;
        Ok(result.rows_affected() == 1)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_event<'e, E>(
        executor: E,
        conversation_id: i64,
        actor_guest_id: Option<i64>,
        actor_user_id: Option<i64>,
        event_type: &str,
        from_status: Option<&str>,
        to_status: Option<&str>,
        details: Option<Value>,
    ) -> Result<(), ApiError>
    where
        E: Executor<'e, Database = DbDatabase>,
    {
        let sql = sql_query!(
            postgres: r#"
INSERT INTO support_events (
    conversation_id, actor_guest_id, actor_user_id, event_type, from_status, to_status, details
) VALUES ($1, $2, $3, $4, $5, $6, $7)
"#,
            sqlite: r#"
INSERT INTO support_events (
    conversation_id, actor_guest_id, actor_user_id, event_type, from_status, to_status, details
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
"#
        );
        sqlx::query(sql)
            .bind(conversation_id)
            .bind(actor_guest_id)
            .bind(actor_user_id)
            .bind(event_type)
            .bind(from_status)
            .bind(to_status)
            .bind(details_bind(details))
            .execute(executor)
            .await
            .map_err(ApiError::from)?;
        Ok(())
    }

    pub async fn update_conversation<'e, E>(
        executor: E,
        conversation_id: i64,
        mutation: &ConversationMutation,
    ) -> Result<bool, ApiError>
    where
        E: Executor<'e, Database = DbDatabase>,
    {
        let sql = sql_query!(
            postgres: r#"
UPDATE support_conversations
SET status = $2,
    priority = $3,
    assigned_team = $4,
    assigned_to_user_id = $5,
    escalation_level = $6,
    escalated_at = $7,
    first_response_due_at = $8,
    resolution_due_at = $9,
    first_response_at = $10,
    resolved_at = $11,
    closed_at = $12,
    resolution_code = $13,
    resolution_summary = $14,
    reopen_count = $15,
    version = version + 1,
    last_activity_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1 AND ($16::bigint IS NULL OR version = $16)
"#,
            sqlite: r#"
UPDATE support_conversations
SET status = ?2,
    priority = ?3,
    assigned_team = ?4,
    assigned_to_user_id = ?5,
    escalation_level = ?6,
    escalated_at = ?7,
    first_response_due_at = ?8,
    resolution_due_at = ?9,
    first_response_at = ?10,
    resolved_at = ?11,
    closed_at = ?12,
    resolution_code = ?13,
    resolution_summary = ?14,
    reopen_count = ?15,
    version = version + 1,
    last_activity_at = datetime('now'),
    updated_at = datetime('now')
WHERE id = ?1 AND (?16 IS NULL OR version = ?16)
"#
        );
        let result = sqlx::query(sql)
            .bind(conversation_id)
            .bind(&mutation.status)
            .bind(&mutation.priority)
            .bind(&mutation.assigned_team)
            .bind(mutation.assigned_to_user_id)
            .bind(mutation.escalation_level)
            .bind(mutation.escalated_at)
            .bind(mutation.first_response_due_at)
            .bind(mutation.resolution_due_at)
            .bind(mutation.first_response_at)
            .bind(mutation.resolved_at)
            .bind(mutation.closed_at)
            .bind(&mutation.resolution_code)
            .bind(&mutation.resolution_summary)
            .bind(mutation.reopen_count)
            .bind(mutation.expected_version)
            .execute(executor)
            .await
            .map_err(ApiError::from)?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn action_key_exists(
        pool: &DbPool,
        conversation_id: i64,
        actor_user_id: i64,
        key: &str,
    ) -> Result<bool, ApiError> {
        let sql = sql_query!(
            postgres: "SELECT EXISTS (SELECT 1 FROM support_action_idempotency_keys WHERE conversation_id = $1 AND actor_user_id = $2 AND idempotency_key = $3)",
            sqlite: "SELECT EXISTS (SELECT 1 FROM support_action_idempotency_keys WHERE conversation_id = ?1 AND actor_user_id = ?2 AND idempotency_key = ?3)"
        );
        sqlx::query_scalar(sql)
            .bind(conversation_id)
            .bind(actor_user_id)
            .bind(key)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }

    pub async fn insert_action_key<'e, E>(
        executor: E,
        conversation_id: i64,
        actor_user_id: i64,
        key: &str,
        action: &str,
    ) -> Result<(), ApiError>
    where
        E: Executor<'e, Database = DbDatabase>,
    {
        let sql = sql_query!(
            postgres: r#"
INSERT INTO support_action_idempotency_keys (conversation_id, actor_user_id, idempotency_key, action)
VALUES ($1, $2, $3, $4)
ON CONFLICT (conversation_id, actor_user_id, idempotency_key) DO NOTHING
"#,
            sqlite: r#"
INSERT INTO support_action_idempotency_keys (conversation_id, actor_user_id, idempotency_key, action)
VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (conversation_id, actor_user_id, idempotency_key) DO NOTHING
"#
        );
        sqlx::query(sql)
            .bind(conversation_id)
            .bind(actor_user_id)
            .bind(key)
            .bind(action)
            .execute(executor)
            .await
            .map_err(ApiError::from)?;
        Ok(())
    }

    pub async fn is_active_support_agent(pool: &DbPool, user_id: i64) -> Result<bool, ApiError> {
        let sql = sql_query!(
            postgres: r#"
SELECT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = $1
      AND COALESCE(u.is_active, true) = true
      AND EXISTS (
          SELECT 1
          FROM user_roles ur
          JOIN role_permissions rp ON rp.role_id = ur.role_id
          JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = u.id AND p.name IN ('support:read', 'support:manage')
      )
      AND EXISTS (
          SELECT 1
          FROM user_roles ur
          JOIN role_permissions rp ON rp.role_id = ur.role_id
          JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = u.id AND p.name IN ('support:write', 'support:manage')
      )
)
"#,
            sqlite: r#"
SELECT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = ?1
      AND COALESCE(u.is_active, 1) = 1
      AND EXISTS (
          SELECT 1
          FROM user_roles ur
          JOIN role_permissions rp ON rp.role_id = ur.role_id
          JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = u.id AND p.name IN ('support:read', 'support:manage')
      )
      AND EXISTS (
          SELECT 1
          FROM user_roles ur
          JOIN role_permissions rp ON rp.role_id = ur.role_id
          JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = u.id AND p.name IN ('support:write', 'support:manage')
      )
)
"#
        );
        sqlx::query_scalar(sql)
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)
    }
}

impl From<&SupportConversation> for ConversationMutation {
    fn from(conversation: &SupportConversation) -> Self {
        let summary = &conversation.summary;
        Self {
            status: summary.status.clone(),
            priority: summary.priority.clone(),
            assigned_team: summary.queue.clone(),
            assigned_to_user_id: summary.assigned_to_user_id,
            escalation_level: summary.escalation_level,
            escalated_at: summary.escalated_at,
            first_response_due_at: summary.first_response_due_at,
            resolution_due_at: summary.resolution_due_at,
            first_response_at: summary.first_response_at,
            resolved_at: summary.resolved_at,
            closed_at: summary.closed_at,
            resolution_code: conversation.resolution_code.clone(),
            resolution_summary: conversation.resolution_summary.clone(),
            reopen_count: conversation.reopen_count,
            expected_version: None,
        }
    }
}
