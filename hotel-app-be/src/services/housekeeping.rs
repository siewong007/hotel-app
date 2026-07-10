//! Housekeeping workflows

use std::collections::HashMap;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    CreateHousekeepingTaskRequest, HousekeepingBoardResponse, HousekeepingTask,
    HousekeepingTaskListResponse, HousekeepingTaskPatch, ListHousekeepingTasksQuery,
    UpdateHousekeepingTaskRequest,
};
use crate::repositories::housekeeping::{self, NewHousekeepingTask};
use crate::services::{audit::AuditLog, rooms};
use crate::utils::pagination::normalize_pagination;
use crate::utils::sanitization::Sanitizer;

const VALID_PRIORITIES: &[&str] = &["low", "normal", "high", "urgent"];
const VALID_TASK_TYPES: &[&str] = &[
    "cleaning",
    "checkout_clean",
    "inspection",
    "maintenance_followup",
];

fn sanitize_optional_notes(value: Option<String>) -> Option<String> {
    value
        .map(|notes| Sanitizer::sanitize_notes(&notes).trim().to_string())
        .filter(|notes| !notes.is_empty())
}

fn validate_priority(priority: &str) -> Result<(), ApiError> {
    if VALID_PRIORITIES.contains(&priority) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid priority. Must be one of: {:?}",
            VALID_PRIORITIES
        )))
    }
}

fn validate_task_type(task_type: &str) -> Result<(), ApiError> {
    if VALID_TASK_TYPES.contains(&task_type) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid task_type. Must be one of: {:?}",
            VALID_TASK_TYPES
        )))
    }
}

fn validate_status_transition(current: &str, next: &str) -> Result<(), ApiError> {
    if current == next {
        return Ok(());
    }

    let valid = matches!(
        (current, next),
        ("pending", "in_progress")
            | ("pending", "void")
            | ("in_progress", "completed")
            | ("in_progress", "void")
    );

    if valid {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid housekeeping task status transition from {} to {}",
            current, next
        )))
    }
}

fn patch_from_update(
    input: UpdateHousekeepingTaskRequest,
) -> Result<HousekeepingTaskPatch, ApiError> {
    if let Some(priority) = input.priority.as_deref() {
        validate_priority(priority)?;
    }

    if let Some(status) = input.status.as_deref()
        && !matches!(status, "pending" | "in_progress" | "completed" | "void")
    {
        return Err(ApiError::BadRequest(
            "Invalid status. Must be one of: pending, in_progress, completed, void".to_string(),
        ));
    }

    Ok(HousekeepingTaskPatch {
        priority: input.priority,
        status: input.status,
        assigned_to: input.assigned_to,
        scheduled_date: input.scheduled_date,
        notes: sanitize_optional_notes(input.notes),
        inspection_notes: sanitize_optional_notes(input.inspection_notes),
        items_used: input.items_used,
    })
}

pub async fn list_tasks(
    pool: &DbPool,
    params: ListHousekeepingTasksQuery,
) -> Result<HousekeepingTaskListResponse, ApiError> {
    if let Some(status) = params.status.as_deref()
        && !matches!(status, "pending" | "in_progress" | "completed" | "void")
    {
        return Err(ApiError::BadRequest(
            "Invalid status filter. Must be one of: pending, in_progress, completed, void"
                .to_string(),
        ));
    }

    let pagination = normalize_pagination(params.page, params.page_size, 50, 200);
    let (total, items) = housekeeping::list_tasks(
        pool,
        params.status.as_deref(),
        params.room_id,
        params.assigned_to,
        params.scheduled_date,
        pagination.page_size,
        pagination.offset,
    )
    .await?;

    Ok(HousekeepingTaskListResponse {
        items,
        total,
        page: pagination.page,
        page_size: pagination.page_size,
    })
}

pub async fn create_task(
    pool: &DbPool,
    user_id: i64,
    input: CreateHousekeepingTaskRequest,
) -> Result<HousekeepingTask, ApiError> {
    if !housekeeping::room_exists(pool, input.room_id).await? {
        return Err(ApiError::BadRequest("Room does not exist".to_string()));
    }

    let task_type = input.task_type.unwrap_or_else(|| "cleaning".to_string());
    validate_task_type(&task_type)?;
    let priority = input.priority.unwrap_or_else(|| "normal".to_string());
    validate_priority(&priority)?;
    let notes = sanitize_optional_notes(input.notes);
    let inspection_notes = sanitize_optional_notes(input.inspection_notes);

    let task = housekeeping::insert_task(
        pool,
        NewHousekeepingTask {
            room_id: input.room_id,
            task_type: &task_type,
            priority: &priority,
            assigned_to: input.assigned_to,
            scheduled_date: input.scheduled_date,
            notes: notes.as_deref(),
            inspection_notes: inspection_notes.as_deref(),
            items_used: input.items_used,
            created_by: user_id,
        },
    )
    .await?;

    let _ = AuditLog::log_event(
        pool,
        Some(user_id),
        "housekeeping_task_created",
        "housekeeping",
        Some(task.id),
        Some(serde_json::json!({
            "room_id": task.room_id,
            "task_type": task.task_type,
            "priority": task.priority
        })),
        None,
        None,
    )
    .await;

    Ok(task)
}

pub async fn update_task(
    pool: &DbPool,
    user_id: i64,
    task_id: i64,
    input: UpdateHousekeepingTaskRequest,
) -> Result<HousekeepingTask, ApiError> {
    let existing = housekeeping::find_task(pool, task_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Housekeeping task not found".to_string()))?;
    let patch = patch_from_update(input)?;

    if let Some(status) = patch.status.as_deref() {
        validate_status_transition(&existing.status, status)?;
    }

    let completed_cleaning = patch.status.as_deref() == Some("completed")
        && matches!(existing.task_type.as_str(), "cleaning" | "checkout_clean");

    if completed_cleaning {
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        housekeeping::patch_task_tx(&mut tx, task_id, &patch).await?;
        let room_status = rooms::complete_housekeeping_cleaning_tx(
            &mut tx,
            existing.room_id,
            user_id,
            patch.notes.as_deref().or(existing.notes.as_deref()),
        )
        .await?;

        AuditLog::log_event_tx(
            &mut tx,
            Some(user_id),
            "housekeeping_task_completed",
            "housekeeping",
            Some(task_id),
            Some(serde_json::json!({
                "room_id": existing.room_id,
                "room_status": room_status
            })),
            None,
            None,
        )
        .await?;

        tx.commit()
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        return housekeeping::find_task(pool, task_id)
            .await?
            .ok_or_else(|| ApiError::NotFound("Housekeeping task not found".to_string()));
    }

    let task = housekeeping::patch_task(pool, task_id, &patch).await?;
    let _ = AuditLog::log_event(
        pool,
        Some(user_id),
        "housekeeping_task_updated",
        "housekeeping",
        Some(task_id),
        Some(serde_json::json!({
            "previous_status": existing.status,
            "status": task.status,
            "room_id": task.room_id
        })),
        None,
        None,
    )
    .await;

    Ok(task)
}

pub async fn board(pool: &DbPool) -> Result<HousekeepingBoardResponse, ApiError> {
    let mut rooms = housekeeping::list_board_rooms(pool).await?;
    let open_tasks = housekeeping::list_open_tasks(pool).await?;
    let mut open_by_room: HashMap<i64, HousekeepingTask> = HashMap::new();

    for task in open_tasks {
        open_by_room.entry(task.room_id).or_insert(task);
    }

    for room in &mut rooms {
        room.open_task = open_by_room.remove(&room.id);
    }

    Ok(HousekeepingBoardResponse { rooms })
}

pub async fn ensure_checkout_cleaning_task(
    tx: &mut crate::core::db::DbTransaction<'_>,
    room_id: i64,
    created_by: i64,
) -> Result<(), ApiError> {
    if housekeeping::has_open_task_tx(tx, room_id, "checkout_clean").await? {
        return Ok(());
    }

    housekeeping::insert_checkout_task_tx(tx, room_id, created_by).await
}

pub async fn ensure_checkout_cleaning_task_for_room(
    pool: &DbPool,
    room_id: i64,
    created_by: i64,
) -> Result<(), ApiError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    ensure_checkout_cleaning_task(&mut tx, room_id, created_by).await?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}
