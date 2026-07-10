//! Maintenance ticket workflows

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    CreateMaintenanceTicketRequest, ListMaintenanceTicketsQuery, MaintenanceTicket,
    MaintenanceTicketListResponse, MaintenanceTicketPatch, UpdateMaintenanceTicketRequest,
};
use crate::repositories::housekeeping as housekeeping_repo;
use crate::repositories::maintenance::{self, NewMaintenanceTicket};
use crate::services::audit::AuditLog;
use crate::utils::pagination::normalize_pagination;
use crate::utils::sanitization::Sanitizer;

const VALID_PRIORITIES: &[&str] = &["low", "medium", "high", "critical"];
const VALID_STATUSES: &[&str] = &["open", "in_progress", "on_hold", "resolved", "closed"];
const VALID_CATEGORIES: &[&str] = &[
    "electrical",
    "plumbing",
    "hvac",
    "furniture",
    "appliance",
    "structural",
    "other",
];

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

fn validate_status(status: &str) -> Result<(), ApiError> {
    if VALID_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid status. Must be one of: {:?}",
            VALID_STATUSES
        )))
    }
}

fn validate_category(category: &str) -> Result<(), ApiError> {
    if VALID_CATEGORIES.contains(&category) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid category. Must be one of: {:?}",
            VALID_CATEGORIES
        )))
    }
}

fn validate_status_transition(current: &str, next: &str) -> Result<(), ApiError> {
    if current == next {
        return Ok(());
    }

    let valid = matches!(
        (current, next),
        ("open", "in_progress")
            | ("open", "on_hold")
            | ("open", "closed")
            | ("in_progress", "on_hold")
            | ("in_progress", "resolved")
            | ("in_progress", "closed")
            | ("on_hold", "in_progress")
            | ("on_hold", "closed")
            | ("resolved", "closed")
            | ("resolved", "in_progress")
    );

    if valid {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid maintenance ticket status transition from {} to {}",
            current, next
        )))
    }
}

fn sanitize_optional_notes(value: Option<String>) -> Option<String> {
    value
        .map(|notes| Sanitizer::sanitize_notes(&notes).trim().to_string())
        .filter(|notes| !notes.is_empty())
}

pub async fn list_tickets(
    pool: &DbPool,
    params: ListMaintenanceTicketsQuery,
) -> Result<MaintenanceTicketListResponse, ApiError> {
    if let Some(status) = params.status.as_deref() {
        validate_status(status)?;
    }
    if let Some(category) = params.category.as_deref() {
        validate_category(category)?;
    }
    if let Some(priority) = params.priority.as_deref() {
        validate_priority(priority)?;
    }

    let pagination = normalize_pagination(params.page, params.page_size, 50, 200);
    let (total, items) = maintenance::list_tickets(
        pool,
        params.status.as_deref(),
        params.room_id,
        params.assigned_to,
        params.category.as_deref(),
        params.priority.as_deref(),
        pagination.page_size,
        pagination.offset,
    )
    .await?;

    Ok(MaintenanceTicketListResponse {
        items,
        total,
        page: pagination.page,
        page_size: pagination.page_size,
    })
}

pub async fn get_ticket(pool: &DbPool, ticket_id: i64) -> Result<MaintenanceTicket, ApiError> {
    maintenance::find_ticket(pool, ticket_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Maintenance ticket not found".to_string()))
}

pub async fn create_ticket(
    pool: &DbPool,
    user_id: i64,
    input: CreateMaintenanceTicketRequest,
) -> Result<MaintenanceTicket, ApiError> {
    if let Some(room_id) = input.room_id
        && !housekeeping_repo::room_exists(pool, room_id).await?
    {
        return Err(ApiError::BadRequest("Room does not exist".to_string()));
    }

    let category = input.category.unwrap_or_else(|| "other".to_string());
    validate_category(&category)?;
    let priority = input.priority.unwrap_or_else(|| "medium".to_string());
    validate_priority(&priority)?;

    let title = Sanitizer::sanitize_text(&input.title).trim().to_string();
    if title.is_empty() {
        return Err(ApiError::BadRequest("Title is required".to_string()));
    }
    let description = sanitize_optional_notes(input.description);

    let ticket_number = maintenance::next_ticket_number(pool).await?;

    let ticket = maintenance::insert_ticket(
        pool,
        NewMaintenanceTicket {
            room_id: input.room_id,
            ticket_number: &ticket_number,
            title: &title,
            description: description.as_deref(),
            category: &category,
            priority: &priority,
            assigned_to: input.assigned_to,
            reported_by: Some(user_id),
            estimated_cost: input.estimated_cost,
            estimated_hours: input.estimated_hours,
            scheduled_date: input.scheduled_date,
            images: input.images,
        },
    )
    .await?;

    let _ = AuditLog::log_event(
        pool,
        Some(user_id),
        "maintenance_ticket_created",
        "maintenance",
        Some(ticket.id),
        Some(serde_json::json!({
            "room_id": ticket.room_id,
            "category": ticket.category,
            "priority": ticket.priority,
            "ticket_number": ticket.ticket_number
        })),
        None,
        None,
    )
    .await;

    Ok(ticket)
}

pub async fn update_ticket(
    pool: &DbPool,
    user_id: i64,
    ticket_id: i64,
    input: UpdateMaintenanceTicketRequest,
) -> Result<MaintenanceTicket, ApiError> {
    let existing = maintenance::find_ticket(pool, ticket_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Maintenance ticket not found".to_string()))?;

    if let Some(category) = input.category.as_deref() {
        validate_category(category)?;
    }
    if let Some(priority) = input.priority.as_deref() {
        validate_priority(priority)?;
    }
    if let Some(status) = input.status.as_deref() {
        validate_status(status)?;
        validate_status_transition(&existing.status, status)?;
    }

    let title = match input.title {
        Some(title) => {
            let sanitized = Sanitizer::sanitize_text(&title).trim().to_string();
            if sanitized.is_empty() {
                return Err(ApiError::BadRequest("Title cannot be empty".to_string()));
            }
            Some(sanitized)
        }
        None => None,
    };
    let description = sanitize_optional_notes(input.description);
    let resolution_notes = sanitize_optional_notes(input.resolution_notes);

    let patch = MaintenanceTicketPatch {
        title,
        description,
        category: input.category,
        priority: input.priority,
        status: input.status,
        assigned_to: input.assigned_to,
        estimated_cost: input.estimated_cost,
        actual_cost: input.actual_cost,
        estimated_hours: input.estimated_hours,
        actual_hours: input.actual_hours,
        scheduled_date: input.scheduled_date,
        resolution_notes,
        images: input.images,
    };

    let ticket = maintenance::patch_ticket(pool, ticket_id, &patch).await?;

    let _ = AuditLog::log_event(
        pool,
        Some(user_id),
        "maintenance_ticket_updated",
        "maintenance",
        Some(ticket_id),
        Some(serde_json::json!({
            "previous_status": existing.status,
            "status": ticket.status
        })),
        None,
        None,
    )
    .await;

    Ok(ticket)
}
