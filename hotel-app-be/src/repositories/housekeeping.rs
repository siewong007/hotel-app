//! Housekeeping data access

use chrono::NaiveDate;
use serde_json::Value;
use sqlx::Row;

use crate::core::db::{DbPool, DbRow, DbTransaction};
use crate::core::error::ApiError;
use crate::models::{HousekeepingBoardRoom, HousekeepingTask, HousekeepingTaskPatch};

const TASK_SELECT: &str = r#"
SELECT
    t.id,
    t.room_id,
    r.room_number,
    rt.name AS room_type,
    t.task_type,
    t.priority,
    t.status,
    t.assigned_to,
    u.full_name AS assigned_to_name,
    t.scheduled_date,
    t.task_date,
    t.started_at,
    t.completed_at,
    t.notes,
    t.inspection_notes,
    t.items_used,
    t.created_at,
    t.created_by,
    t.updated_at
FROM housekeeping_tasks t
INNER JOIN rooms r ON r.id = t.room_id
INNER JOIN room_types rt ON rt.id = r.room_type_id
LEFT JOIN users u ON u.id = t.assigned_to
"#;

pub struct NewHousekeepingTask<'a> {
    pub room_id: i64,
    pub task_type: &'a str,
    pub priority: &'a str,
    pub assigned_to: Option<i64>,
    pub scheduled_date: Option<NaiveDate>,
    pub notes: Option<&'a str>,
    pub inspection_notes: Option<&'a str>,
    pub items_used: Option<Value>,
    pub created_by: i64,
}

fn items_from_row(row: &DbRow) -> Option<Value> {
    row.try_get::<Option<Value>, _>("items_used").ok().flatten()
}

fn row_to_task(row: DbRow) -> HousekeepingTask {
    HousekeepingTask {
        id: row.get("id"),
        room_id: row.get("room_id"),
        room_number: row.get("room_number"),
        room_type: row.get("room_type"),
        task_type: row.get("task_type"),
        priority: row.get("priority"),
        status: row.get("status"),
        assigned_to: row.try_get("assigned_to").ok(),
        assigned_to_name: row.try_get("assigned_to_name").ok(),
        scheduled_date: row.try_get("scheduled_date").ok(),
        task_date: row.get("task_date"),
        started_at: row.try_get("started_at").ok(),
        completed_at: row.try_get("completed_at").ok(),
        notes: row.try_get("notes").ok(),
        inspection_notes: row.try_get("inspection_notes").ok(),
        items_used: items_from_row(&row),
        created_at: row.get("created_at"),
        created_by: row.try_get("created_by").ok(),
        updated_at: row.get("updated_at"),
    }
}

pub async fn room_exists(pool: &DbPool, room_id: i64) -> Result<bool, ApiError> {
    let query = "SELECT EXISTS(SELECT 1 FROM rooms WHERE id = $1 AND is_active = true)";

    let exists = sqlx::query_scalar::<_, bool>(query)
        .bind(room_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(exists)
}

pub async fn find_task(pool: &DbPool, task_id: i64) -> Result<Option<HousekeepingTask>, ApiError> {
    let query = format!("{} WHERE t.id = {}", TASK_SELECT, crate::param!(1));

    let row = sqlx::query(&query)
        .bind(task_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(row.map(row_to_task))
}

pub async fn list_tasks(
    pool: &DbPool,
    status: Option<&str>,
    room_id: Option<i64>,
    assigned_to: Option<i64>,
    scheduled_date: Option<NaiveDate>,
    page_size: i64,
    offset: i64,
) -> Result<(i64, Vec<HousekeepingTask>), ApiError> {
    let where_clause = r#"
WHERE ($1::text IS NULL OR t.status = $1)
  AND ($2::bigint IS NULL OR t.room_id = $2)
  AND ($3::bigint IS NULL OR t.assigned_to = $3)
  AND ($4::date IS NULL OR t.scheduled_date = $4)
"#;
    let count_query = format!("SELECT COUNT(*) FROM housekeeping_tasks t {}", where_clause);
    let list_query = format!(
        "{} {} ORDER BY t.created_at DESC LIMIT {} OFFSET {}",
        TASK_SELECT,
        where_clause,
        crate::param!(5),
        crate::param!(6)
    );

    let total = sqlx::query_scalar::<_, i64>(&count_query)
        .bind(status)
        .bind(room_id)
        .bind(assigned_to)
        .bind(scheduled_date)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let rows = sqlx::query(&list_query)
        .bind(status)
        .bind(room_id)
        .bind(assigned_to)
        .bind(scheduled_date)
        .bind(page_size)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok((total, rows.into_iter().map(row_to_task).collect()))
}

pub async fn insert_task(
    pool: &DbPool,
    task: NewHousekeepingTask<'_>,
) -> Result<HousekeepingTask, ApiError> {
    let query = r#"
INSERT INTO housekeeping_tasks (
    room_id, task_type, priority, assigned_to, scheduled_date,
    notes, inspection_notes, items_used, created_by
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id
"#;

    let items_bind = task.items_used;

    let task_id = sqlx::query_scalar::<_, i64>(query)
        .bind(task.room_id)
        .bind(task.task_type)
        .bind(task.priority)
        .bind(task.assigned_to)
        .bind(task.scheduled_date)
        .bind(task.notes)
        .bind(task.inspection_notes)
        .bind(items_bind)
        .bind(task.created_by)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    find_task(pool, task_id)
        .await?
        .ok_or_else(|| ApiError::Database("Created housekeeping task was not found".to_string()))
}

pub async fn patch_task(
    pool: &DbPool,
    task_id: i64,
    patch: &HousekeepingTaskPatch,
) -> Result<HousekeepingTask, ApiError> {
    let query = r#"
UPDATE housekeeping_tasks
SET priority = COALESCE($2, priority),
    status = COALESCE($3, status),
    assigned_to = COALESCE($4, assigned_to),
    scheduled_date = COALESCE($5, scheduled_date),
    notes = COALESCE($6, notes),
    inspection_notes = COALESCE($7, inspection_notes),
    items_used = COALESCE($8, items_used),
    started_at = CASE WHEN $3 = 'in_progress' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
    completed_at = CASE WHEN $3 = 'completed' AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1
"#;

    let items_bind = patch.items_used.clone();

    sqlx::query(query)
        .bind(task_id)
        .bind(patch.priority.as_deref())
        .bind(patch.status.as_deref())
        .bind(patch.assigned_to)
        .bind(patch.scheduled_date)
        .bind(patch.notes.as_deref())
        .bind(patch.inspection_notes.as_deref())
        .bind(items_bind)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    find_task(pool, task_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Housekeeping task not found".to_string()))
}

pub async fn patch_task_tx(
    tx: &mut DbTransaction<'_>,
    task_id: i64,
    patch: &HousekeepingTaskPatch,
) -> Result<(), ApiError> {
    let query = r#"
UPDATE housekeeping_tasks
SET priority = COALESCE($2, priority),
    status = COALESCE($3, status),
    assigned_to = COALESCE($4, assigned_to),
    scheduled_date = COALESCE($5, scheduled_date),
    notes = COALESCE($6, notes),
    inspection_notes = COALESCE($7, inspection_notes),
    items_used = COALESCE($8, items_used),
    started_at = CASE WHEN $3 = 'in_progress' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
    completed_at = CASE WHEN $3 = 'completed' AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1
"#;

    let items_bind = patch.items_used.clone();

    sqlx::query(query)
        .bind(task_id)
        .bind(patch.priority.as_deref())
        .bind(patch.status.as_deref())
        .bind(patch.assigned_to)
        .bind(patch.scheduled_date)
        .bind(patch.notes.as_deref())
        .bind(patch.inspection_notes.as_deref())
        .bind(items_bind)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

pub async fn list_board_rooms(pool: &DbPool) -> Result<Vec<HousekeepingBoardRoom>, ApiError> {
    let query = r#"
SELECT r.id, r.room_number, rt.name AS room_type, r.floor, r.status
FROM rooms r
INNER JOIN room_types rt ON rt.id = r.room_type_id
WHERE r.is_active = true
ORDER BY r.floor NULLS LAST, r.room_number
"#;

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| HousekeepingBoardRoom {
            id: row.get("id"),
            room_number: row.get("room_number"),
            room_type: row.get("room_type"),
            floor: row.try_get("floor").ok(),
            status: row.get("status"),
            open_task: None,
        })
        .collect())
}

pub async fn list_open_tasks(pool: &DbPool) -> Result<Vec<HousekeepingTask>, ApiError> {
    let query = format!(
        "{} WHERE t.status IN ('pending', 'in_progress') ORDER BY t.created_at DESC",
        TASK_SELECT
    );

    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(rows.into_iter().map(row_to_task).collect())
}

pub async fn has_open_task_tx(
    tx: &mut DbTransaction<'_>,
    room_id: i64,
    task_type: &str,
) -> Result<bool, ApiError> {
    let query = r#"
SELECT EXISTS(
    SELECT 1 FROM housekeeping_tasks
    WHERE room_id = $1
      AND task_type = $2
      AND status IN ('pending', 'in_progress')
)
"#;

    let exists = sqlx::query_scalar::<_, bool>(query)
        .bind(room_id)
        .bind(task_type)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(exists)
}

pub async fn insert_checkout_task_tx(
    tx: &mut DbTransaction<'_>,
    room_id: i64,
    created_by: i64,
) -> Result<(), ApiError> {
    let query = r#"
INSERT INTO housekeeping_tasks (room_id, task_type, priority, status, created_by, notes)
VALUES ($1, 'checkout_clean', 'normal', 'pending', $2, 'Auto-created on checkout')
"#;

    sqlx::query(query)
        .bind(room_id)
        .bind(created_by)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}
