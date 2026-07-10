//! Maintenance ticket data access

use chrono::{DateTime, Utc};
use sqlx::Row;

use crate::core::db::{DbPool, DbRow};
use crate::core::error::ApiError;
use crate::models::{MaintenanceTicket, MaintenanceTicketPatch};

const TICKET_SELECT: &str = r#"
SELECT
    t.id,
    t.room_id,
    r.room_number,
    t.ticket_number,
    t.title,
    t.description,
    t.category,
    t.priority,
    t.status,
    t.assigned_to,
    u.full_name AS assigned_to_name,
    t.reported_by,
    t.estimated_cost,
    t.actual_cost,
    t.estimated_hours,
    t.actual_hours,
    t.scheduled_date,
    t.started_at,
    t.resolved_at,
    t.resolution_notes,
    t.images,
    t.created_at,
    t.updated_at
FROM maintenance_tickets t
LEFT JOIN rooms r ON r.id = t.room_id
LEFT JOIN users u ON u.id = t.assigned_to
"#;

pub struct NewMaintenanceTicket<'a> {
    pub room_id: Option<i64>,
    pub ticket_number: &'a str,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub category: &'a str,
    pub priority: &'a str,
    pub assigned_to: Option<i64>,
    pub reported_by: Option<i64>,
    pub estimated_cost: Option<rust_decimal::Decimal>,
    pub estimated_hours: Option<rust_decimal::Decimal>,
    pub scheduled_date: Option<DateTime<Utc>>,
    pub images: Option<serde_json::Value>,
}

fn images_from_row(row: &DbRow) -> Option<serde_json::Value> {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        row.try_get::<Option<String>, _>("images")
            .ok()
            .flatten()
            .and_then(|value| serde_json::from_str(&value).ok())
    }

    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        row.try_get::<Option<serde_json::Value>, _>("images")
            .ok()
            .flatten()
    }
}

fn row_to_ticket(row: DbRow) -> MaintenanceTicket {
    MaintenanceTicket {
        id: row.get("id"),
        room_id: row.try_get("room_id").ok(),
        room_number: row.try_get("room_number").ok(),
        ticket_number: row.get("ticket_number"),
        title: row.get("title"),
        description: row.try_get("description").ok(),
        category: row.get("category"),
        priority: row.get("priority"),
        status: row.get("status"),
        assigned_to: row.try_get("assigned_to").ok(),
        assigned_to_name: row.try_get("assigned_to_name").ok(),
        reported_by: row.try_get("reported_by").ok(),
        estimated_cost: crate::models::row_mappers::get_opt_decimal(&row, "estimated_cost"),
        actual_cost: crate::models::row_mappers::get_opt_decimal(&row, "actual_cost"),
        estimated_hours: crate::models::row_mappers::get_opt_decimal(&row, "estimated_hours"),
        actual_hours: crate::models::row_mappers::get_opt_decimal(&row, "actual_hours"),
        scheduled_date: row.try_get("scheduled_date").ok(),
        started_at: row.try_get("started_at").ok(),
        resolved_at: row.try_get("resolved_at").ok(),
        resolution_notes: row.try_get("resolution_notes").ok(),
        images: images_from_row(&row),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

/// Compute the next ticket number for the current month.
///
/// Format: `MT-YYYYMM-XXXX` (e.g. `MT-202607-0001`).
pub(crate) async fn next_ticket_number<'e, E>(executor: E) -> Result<String, ApiError>
where
    E: sqlx::Executor<'e, Database = crate::core::db::DbDatabase>,
{
    let now = chrono::Local::now();
    let yyyymm = now.format("%Y%m").to_string();
    let prefix = format!("MT-{}-", yyyymm);
    let pattern = format!("{}%", prefix);

    let query = crate::sql_query!(
        postgres: "SELECT MAX(CAST(SUBSTRING(ticket_number FROM 11) AS BIGINT)) FROM maintenance_tickets WHERE ticket_number LIKE $1",
        sqlite: "SELECT MAX(CAST(SUBSTR(ticket_number, 11) AS INTEGER)) FROM maintenance_tickets WHERE ticket_number LIKE ?1"
    );

    let max_seq: Option<i64> = sqlx::query_scalar(query)
        .bind(&pattern)
        .fetch_one(executor)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let next = max_seq.unwrap_or(0) + 1;
    Ok(format!("{}{:04}", prefix, next))
}

pub async fn find_ticket(pool: &DbPool, ticket_id: i64) -> Result<Option<MaintenanceTicket>, ApiError> {
    let query = format!("{} WHERE t.id = {}", TICKET_SELECT, crate::param!(1));

    let row = sqlx::query(&query)
        .bind(ticket_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(row.map(row_to_ticket))
}

#[allow(clippy::too_many_arguments)]
pub async fn list_tickets(
    pool: &DbPool,
    status: Option<&str>,
    room_id: Option<i64>,
    assigned_to: Option<i64>,
    category: Option<&str>,
    priority: Option<&str>,
    page_size: i64,
    offset: i64,
) -> Result<(i64, Vec<MaintenanceTicket>), ApiError> {
    let where_clause = crate::sql_query!(
        postgres: r#"
WHERE ($1::text IS NULL OR t.status = $1)
  AND ($2::bigint IS NULL OR t.room_id = $2)
  AND ($3::bigint IS NULL OR t.assigned_to = $3)
  AND ($4::text IS NULL OR t.category = $4)
  AND ($5::text IS NULL OR t.priority = $5)
"#,
        sqlite: r#"
WHERE (?1 IS NULL OR t.status = ?1)
  AND (?2 IS NULL OR t.room_id = ?2)
  AND (?3 IS NULL OR t.assigned_to = ?3)
  AND (?4 IS NULL OR t.category = ?4)
  AND (?5 IS NULL OR t.priority = ?5)
"#
    );
    let count_query = format!("SELECT COUNT(*) FROM maintenance_tickets t {}", where_clause);
    let list_query = format!(
        "{} {} ORDER BY t.created_at DESC LIMIT {} OFFSET {}",
        TICKET_SELECT,
        where_clause,
        crate::param!(6),
        crate::param!(7)
    );

    let total = sqlx::query_scalar::<_, i64>(&count_query)
        .bind(status)
        .bind(room_id)
        .bind(assigned_to)
        .bind(category)
        .bind(priority)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let rows = sqlx::query(&list_query)
        .bind(status)
        .bind(room_id)
        .bind(assigned_to)
        .bind(category)
        .bind(priority)
        .bind(page_size)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok((total, rows.into_iter().map(row_to_ticket).collect()))
}

pub async fn insert_ticket(
    pool: &DbPool,
    ticket: NewMaintenanceTicket<'_>,
) -> Result<MaintenanceTicket, ApiError> {
    let query = crate::sql_query!(
        postgres: r#"
INSERT INTO maintenance_tickets (
    room_id, ticket_number, title, description, category, priority,
    assigned_to, reported_by, estimated_cost, estimated_hours, scheduled_date, images
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING id
"#,
        sqlite: r#"
INSERT INTO maintenance_tickets (
    room_id, ticket_number, title, description, category, priority,
    assigned_to, reported_by, estimated_cost, estimated_hours, scheduled_date, images
)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
RETURNING id
"#
    );

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let images_bind = ticket.images.map(|value| value.to_string());
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    let images_bind = ticket.images;

    let estimated_cost = crate::core::db::opt_decimal_to_db(ticket.estimated_cost);
    let estimated_hours = crate::core::db::opt_decimal_to_db(ticket.estimated_hours);

    let ticket_id = sqlx::query_scalar::<_, i64>(query)
        .bind(ticket.room_id)
        .bind(ticket.ticket_number)
        .bind(ticket.title)
        .bind(ticket.description)
        .bind(ticket.category)
        .bind(ticket.priority)
        .bind(ticket.assigned_to)
        .bind(ticket.reported_by)
        .bind(estimated_cost)
        .bind(estimated_hours)
        .bind(ticket.scheduled_date)
        .bind(images_bind)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    find_ticket(pool, ticket_id)
        .await?
        .ok_or_else(|| ApiError::Database("Created maintenance ticket was not found".to_string()))
}

pub async fn patch_ticket(
    pool: &DbPool,
    ticket_id: i64,
    patch: &MaintenanceTicketPatch,
) -> Result<MaintenanceTicket, ApiError> {
    let query = crate::sql_query!(
        postgres: r#"
UPDATE maintenance_tickets
SET title = COALESCE($2, title),
    description = COALESCE($3, description),
    category = COALESCE($4, category),
    priority = COALESCE($5, priority),
    status = COALESCE($6, status),
    assigned_to = COALESCE($7, assigned_to),
    estimated_cost = COALESCE($8, estimated_cost),
    actual_cost = COALESCE($9, actual_cost),
    estimated_hours = COALESCE($10, estimated_hours),
    actual_hours = COALESCE($11, actual_hours),
    scheduled_date = COALESCE($12, scheduled_date),
    resolution_notes = COALESCE($13, resolution_notes),
    images = COALESCE($14, images),
    started_at = CASE WHEN $6 = 'in_progress' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
    resolved_at = CASE WHEN $6 IN ('resolved', 'closed') AND resolved_at IS NULL THEN CURRENT_TIMESTAMP ELSE resolved_at END,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1
"#,
        sqlite: r#"
UPDATE maintenance_tickets
SET title = COALESCE(?2, title),
    description = COALESCE(?3, description),
    category = COALESCE(?4, category),
    priority = COALESCE(?5, priority),
    status = COALESCE(?6, status),
    assigned_to = COALESCE(?7, assigned_to),
    estimated_cost = COALESCE(?8, estimated_cost),
    actual_cost = COALESCE(?9, actual_cost),
    estimated_hours = COALESCE(?10, estimated_hours),
    actual_hours = COALESCE(?11, actual_hours),
    scheduled_date = COALESCE(?12, scheduled_date),
    resolution_notes = COALESCE(?13, resolution_notes),
    images = COALESCE(?14, images),
    started_at = CASE WHEN ?6 = 'in_progress' AND started_at IS NULL THEN datetime('now') ELSE started_at END,
    resolved_at = CASE WHEN ?6 IN ('resolved', 'closed') AND resolved_at IS NULL THEN datetime('now') ELSE resolved_at END,
    updated_at = datetime('now')
WHERE id = ?1
"#
    );

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let images_bind = patch.images.clone().map(|value| value.to_string());
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    let images_bind = patch.images.clone();

    let estimated_cost = crate::core::db::opt_decimal_to_db(patch.estimated_cost);
    let actual_cost = crate::core::db::opt_decimal_to_db(patch.actual_cost);
    let estimated_hours = crate::core::db::opt_decimal_to_db(patch.estimated_hours);
    let actual_hours = crate::core::db::opt_decimal_to_db(patch.actual_hours);

    sqlx::query(query)
        .bind(ticket_id)
        .bind(patch.title.as_deref())
        .bind(patch.description.as_deref())
        .bind(patch.category.as_deref())
        .bind(patch.priority.as_deref())
        .bind(patch.status.as_deref())
        .bind(patch.assigned_to)
        .bind(estimated_cost)
        .bind(actual_cost)
        .bind(estimated_hours)
        .bind(actual_hours)
        .bind(patch.scheduled_date)
        .bind(patch.resolution_notes.as_deref())
        .bind(images_bind)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    find_ticket(pool, ticket_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Maintenance ticket not found".to_string()))
}
