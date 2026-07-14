//! Guest support workflow rules.

use chrono::{Duration, Utc};
use serde_json::json;
use uuid::Uuid;

use super::models::{
    CreateGuestSupportConversationRequest, GuestSupportConversation, GuestSupportConversationDetail,
    GuestSupportConversationListResponse, GuestSupportMessageRequest, SupportActionInput,
    SupportConversationDetail, SupportConversationListResponse, SupportListQuery, SupportMessageRequest,
};
use super::repository::{ConversationMutation, NewConversation, SupportRepository};
use super::validation;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::check_permission;
use crate::core::settings_cache;
use crate::services::audit::AuditLog;
use crate::utils::pagination::normalize_pagination;

const DEFAULT_REOPEN_WINDOW_DAYS: i64 = 7;

fn request_id_is_valid(value: Option<&str>) -> Result<(), ApiError> {
    if value.is_some_and(|value| value.trim().is_empty() || value.chars().count() > 128) {
        return Err(ApiError::BadRequest("Invalid client request identifier".to_string()));
    }
    Ok(())
}

fn subject_for_category(category: &str) -> String {
    format!(
        "{} support request",
        category
            .split('_')
            .map(|word| {
                let mut characters = word.chars();
                match characters.next() {
                    Some(first) => format!("{}{}", first.to_ascii_uppercase(), characters.as_str()),
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    )
}

fn conversation_number() -> String {
    let suffix = Uuid::new_v4().simple().to_string();
    format!("SUP-{}-{}", Utc::now().format("%Y%m%d"), &suffix[..8].to_ascii_uppercase())
}

async fn support_enabled(pool: &DbPool) -> bool {
    matches!(
        settings_cache::get_string(pool, "support_enabled", "true")
            .await
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "true" | "1" | "yes" | "on"
    )
}

async fn reopen_window_days(pool: &DbPool) -> i64 {
    settings_cache::get_positive_i32(
        pool,
        "support_reopen_window_days",
        DEFAULT_REOPEN_WINDOW_DAYS as i32,
    )
    .await as i64
}

async fn priority_sla(pool: &DbPool, priority: &str) -> (Duration, Duration) {
    let (first_default, resolution_default) = match priority {
        "urgent" => (5, 30),
        "high" => (15, 120),
        "low" => (240, 1_440),
        _ => (60, 480),
    };
    let first = settings_cache::get_positive_i32(
        pool,
        &format!("support_first_response_{priority}_minutes"),
        first_default,
    )
    .await;
    let resolution = settings_cache::get_positive_i32(
        pool,
        &format!("support_resolution_{priority}_minutes"),
        resolution_default,
    )
    .await;
    (Duration::minutes(i64::from(first)), Duration::minutes(i64::from(resolution)))
}

async fn can_manage(pool: &DbPool, user_id: i64) -> Result<bool, ApiError> {
    match check_permission(pool, user_id, "support:manage").await {
        Ok(()) => Ok(true),
        Err(ApiError::Forbidden(_)) => Ok(false),
        Err(error) => Err(error),
    }
}

async fn require_action_permission(pool: &DbPool, user_id: i64, action: &str) -> Result<(), ApiError> {
    let permission = match action {
        "claim" | "assign" | "release" => "support:assign",
        "escalate" => "support:escalate",
        "set_priority" | "close" | "reopen" => "support:manage",
        "resolve" | "add_internal_note" => "support:write",
        _ => return Err(ApiError::BadRequest("Unsupported support action".to_string())),
    };
    check_permission(pool, user_id, permission).await
}

fn ensure_owner_or_manager(
    assigned_to_user_id: Option<i64>,
    actor_id: i64,
    is_manager: bool,
) -> Result<(), ApiError> {
    if is_manager || assigned_to_user_id == Some(actor_id) {
        return Ok(());
    }
    if assigned_to_user_id.is_none() {
        return Err(ApiError::Conflict(
            "Claim this conversation before taking that action".to_string(),
        ));
    }
    Err(ApiError::Forbidden(
        "This conversation is assigned to another staff member".to_string(),
    ))
}

fn reopen_allowed(resolved_at: Option<chrono::DateTime<Utc>>, window_days: i64) -> bool {
    resolved_at.is_some_and(|resolved_at| resolved_at >= Utc::now() - Duration::days(window_days))
}

fn guest_view(
    conversation: &super::models::SupportConversation,
    window_days: i64,
) -> GuestSupportConversation {
    let summary = &conversation.summary;
    GuestSupportConversation {
        id: summary.id,
        category: summary.category.clone(),
        status: summary.status.clone(),
        assigned_team: "Hotel support team".to_string(),
        booking_id: summary.booking_id,
        subject: conversation.subject.clone(),
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
        last_activity_at: summary.last_activity_at,
        first_response_at: summary.first_response_at,
        resolved_at: summary.resolved_at,
        closed_at: summary.closed_at,
        can_reopen: summary.status == "resolved" && reopen_allowed(summary.resolved_at, window_days),
        version: summary.version,
    }
}

async fn staff_detail(pool: &DbPool, conversation_id: i64) -> Result<SupportConversationDetail, ApiError> {
    let conversation = SupportRepository::find_conversation(pool, conversation_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Support conversation not found".to_string()))?;
    let messages = SupportRepository::list_messages(pool, conversation_id).await?;
    let events = SupportRepository::list_events(pool, conversation_id).await?;
    Ok(SupportConversationDetail {
        conversation,
        messages,
        events,
    })
}

/// List staff queue entries with server-side filters and SLA metrics.
pub async fn list_staff_conversations(
    pool: &DbPool,
    actor_id: i64,
    query: SupportListQuery,
) -> Result<SupportConversationListResponse, ApiError> {
    if let Some(status) = query.status.as_deref() {
        validation::validate_status(status)?;
    }
    if let Some(priority) = query.priority.as_deref() {
        validation::validate_priority(priority)?;
    }
    if let Some(queue) = query.queue.as_deref() {
        let queue = validation::normalized_choice(queue);
        if ![
            "unassigned",
            "mine",
            "waiting_for_staff",
            "waiting_for_guest",
            "at_risk",
            "resolved",
            "closed",
        ]
        .contains(&queue.as_str())
        {
            return Err(ApiError::BadRequest("Unsupported support queue".to_string()));
        }
    }

    let normalized_queue = query.queue.as_deref().map(validation::normalized_choice);
    let normalized_status = query.status.as_deref().map(validation::normalized_choice);
    let normalized_priority = query.priority.as_deref().map(validation::normalized_choice);
    let pagination = normalize_pagination(query.page, query.page_size, 20, 100);
    let (total, items) = SupportRepository::list_conversations(
        pool,
        actor_id,
        normalized_queue.as_deref(),
        normalized_status.as_deref(),
        normalized_priority.as_deref(),
        query.assigned_to_user_id,
        query.search.as_deref(),
        pagination.page_size,
        pagination.offset,
    )
    .await?;
    let metrics = SupportRepository::queue_metrics(pool).await?;
    Ok(SupportConversationListResponse {
        items,
        total,
        page: pagination.page,
        page_size: pagination.page_size,
        metrics,
    })
}

pub async fn get_staff_conversation(
    pool: &DbPool,
    conversation_id: i64,
) -> Result<SupportConversationDetail, ApiError> {
    staff_detail(pool, conversation_id).await
}

pub async fn list_support_agents(pool: &DbPool) -> Result<Vec<super::models::SupportAgent>, ApiError> {
    SupportRepository::list_agents(pool).await
}

pub async fn send_staff_message(
    pool: &DbPool,
    actor_id: i64,
    conversation_id: i64,
    request: SupportMessageRequest,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<SupportConversationDetail, ApiError> {
    check_permission(pool, actor_id, "support:write").await?;
    request_id_is_valid(request.client_message_id.as_deref())?;
    let body = validation::sanitize_required_message(&request.message)?;
    let current = SupportRepository::find_conversation(pool, conversation_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Support conversation not found".to_string()))?;
    if let Some(client_message_id) = request.client_message_id.as_deref()
        && SupportRepository::client_message_exists(pool, conversation_id, "staff", client_message_id).await?
    {
        return staff_detail(pool, conversation_id).await;
    }
    if current.summary.status == "closed" || current.summary.status == "resolved" {
        return Err(ApiError::Conflict(
            "Reopen this conversation before sending another reply".to_string(),
        ));
    }
    let is_manager = can_manage(pool, actor_id).await?;
    if let Some(assignee) = current.summary.assigned_to_user_id {
        ensure_owner_or_manager(Some(assignee), actor_id, is_manager)?;
    }
    if let Some(expected_version) = request.expected_version
        && expected_version != current.summary.version
    {
        return Err(ApiError::Conflict(
            "This conversation changed. Refresh it before replying".to_string(),
        ));
    }

    let mut mutation = ConversationMutation::from(&current);
    mutation.status = "waiting_for_guest".to_string();
    if mutation.assigned_to_user_id.is_none() {
        mutation.assigned_to_user_id = Some(actor_id);
    }
    if mutation.first_response_at.is_none() {
        mutation.first_response_at = Some(Utc::now());
    }
    mutation.expected_version = request.expected_version;

    let mut transaction = pool.begin().await.map_err(ApiError::from)?;
    if !SupportRepository::update_conversation(&mut *transaction, conversation_id, &mutation).await? {
        return Err(ApiError::Conflict(
            "This conversation changed. Refresh it before replying".to_string(),
        ));
    }
    SupportRepository::insert_message(
        &mut *transaction,
        conversation_id,
        "staff",
        None,
        Some(actor_id),
        &body,
        request.client_message_id.as_deref(),
    )
    .await?;
    SupportRepository::insert_event(
        &mut *transaction,
        conversation_id,
        None,
        Some(actor_id),
        "staff_replied",
        Some(&current.summary.status),
        Some("waiting_for_guest"),
        None,
    )
    .await?;
    transaction.commit().await.map_err(ApiError::from)?;

    let _ = AuditLog::log_event(
        pool,
        Some(actor_id),
        "support.message_sent",
        "support_conversation",
        Some(conversation_id),
        Some(json!({"author_type": "staff"})),
        ip_address,
        user_agent,
    )
    .await;
    staff_detail(pool, conversation_id).await
}

pub async fn apply_staff_action(
    pool: &DbPool,
    actor_id: i64,
    conversation_id: i64,
    input: SupportActionInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<SupportConversationDetail, ApiError> {
    let action = validation::validate_action(&input.action)?;
    require_action_permission(pool, actor_id, &action).await?;
    request_id_is_valid(input.client_action_id.as_deref())?;
    let current = SupportRepository::find_conversation(pool, conversation_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Support conversation not found".to_string()))?;
    if let Some(key) = input.client_action_id.as_deref()
        && SupportRepository::action_key_exists(pool, conversation_id, actor_id, key).await?
    {
        return staff_detail(pool, conversation_id).await;
    }
    let expected_version = input.expected_version.ok_or_else(|| {
        ApiError::BadRequest("A conversation version is required for support actions".to_string())
    })?;
    if expected_version != current.summary.version {
        return Err(ApiError::Conflict(
            "This conversation changed. Refresh it before taking another action".to_string(),
        ));
    }

    let is_manager = can_manage(pool, actor_id).await?;
    let reason = validation::sanitize_optional_reason(input.reason)?;
    let mut mutation = ConversationMutation::from(&current);
    mutation.expected_version = Some(expected_version);
    let event_type: String;
    let mut event_details = json!({});

    match action.as_str() {
        "claim" => {
            if current.summary.status == "closed" {
                return Err(ApiError::Conflict("Closed conversations cannot be claimed".to_string()));
            }
            if let Some(assignee) = current.summary.assigned_to_user_id {
                if assignee == actor_id {
                    return staff_detail(pool, conversation_id).await;
                }
                return Err(ApiError::Conflict(
                    "Another staff member already claimed this conversation".to_string(),
                ));
            }
            mutation.assigned_to_user_id = Some(actor_id);
            event_type = "claimed".to_string();
        }
        "assign" => {
            if let Some(assignee_id) = input.assignee_id
                && !SupportRepository::user_exists(pool, assignee_id).await?
            {
                return Err(ApiError::BadRequest("Selected support staff member is unavailable".to_string()));
            }
            mutation.assigned_to_user_id = input.assignee_id;
            event_type = if input.assignee_id.is_some() {
                "assigned".to_string()
            } else {
                "returned_to_queue".to_string()
            };
            event_details = json!({"assignee_id": input.assignee_id, "reason": reason});
        }
        "release" => {
            ensure_owner_or_manager(current.summary.assigned_to_user_id, actor_id, is_manager)?;
            mutation.assigned_to_user_id = None;
            event_type = "returned_to_queue".to_string();
            event_details = json!({"reason": reason});
        }
        "set_priority" => {
            let priority = input.priority.as_deref().ok_or_else(|| {
                ApiError::BadRequest("A support priority is required".to_string())
            })?;
            mutation.priority = validation::validate_priority(priority)?;
            event_type = "priority_changed".to_string();
            event_details = json!({"from": current.summary.priority, "to": mutation.priority, "reason": reason});
        }
        "escalate" => {
            let reason = reason.ok_or_else(|| {
                ApiError::BadRequest("An escalation reason is required".to_string())
            })?;
            if current.summary.status == "closed" {
                return Err(ApiError::Conflict("Closed conversations cannot be escalated".to_string()));
            }
            mutation.assigned_team = "duty_manager".to_string();
            mutation.assigned_to_user_id = None;
            mutation.escalation_level = (mutation.escalation_level + 1).min(3);
            mutation.escalated_at = Some(Utc::now());
            event_type = "escalated".to_string();
            event_details = json!({"reason": reason, "level": mutation.escalation_level});
        }
        "resolve" => {
            ensure_owner_or_manager(current.summary.assigned_to_user_id, actor_id, is_manager)?;
            if !["waiting_for_staff", "waiting_for_guest"].contains(&current.summary.status.as_str()) {
                return Err(ApiError::Conflict("Only active conversations can be resolved".to_string()));
            }
            let resolution_code = validation::sanitize_resolution_code(input.resolution_code)?
                .ok_or_else(|| ApiError::BadRequest("A resolution code is required".to_string()))?;
            let resolution_summary = validation::sanitize_optional_reason(input.resolution_summary)?
                .ok_or_else(|| ApiError::BadRequest("A public resolution summary is required".to_string()))?;
            mutation.status = "resolved".to_string();
            mutation.resolved_at = Some(Utc::now());
            mutation.closed_at = None;
            mutation.resolution_code = Some(resolution_code);
            mutation.resolution_summary = Some(resolution_summary);
            event_type = "resolved".to_string();
            event_details = json!({"resolution_code": mutation.resolution_code});
        }
        "close" => {
            if current.summary.status != "resolved" {
                return Err(ApiError::Conflict("Resolve this conversation before closing it".to_string()));
            }
            let reason = reason.ok_or_else(|| {
                ApiError::BadRequest("A closure reason is required".to_string())
            })?;
            mutation.status = "closed".to_string();
            mutation.closed_at = Some(Utc::now());
            event_type = "closed".to_string();
            event_details = json!({"reason": reason});
        }
        "reopen" => {
            if !["resolved", "closed"].contains(&current.summary.status.as_str()) {
                return Err(ApiError::Conflict("Only resolved or closed conversations can be reopened".to_string()));
            }
            let (_, resolution_sla) = priority_sla(pool, &current.summary.priority).await;
            mutation.status = "waiting_for_staff".to_string();
            mutation.resolved_at = None;
            mutation.closed_at = None;
            mutation.resolution_code = None;
            mutation.resolution_summary = None;
            mutation.resolution_due_at = Some(Utc::now() + resolution_sla);
            mutation.reopen_count += 1;
            event_type = "reopened".to_string();
            event_details = json!({"reason": reason});
        }
        "add_internal_note" => {
            ensure_owner_or_manager(current.summary.assigned_to_user_id, actor_id, is_manager)?;
            let note = reason.ok_or_else(|| {
                ApiError::BadRequest("An internal note is required".to_string())
            })?;
            event_type = "internal_note".to_string();
            event_details = json!({"body": note});
        }
        _ => return Err(ApiError::BadRequest("Unsupported support action".to_string())),
    }

    let mut transaction = pool.begin().await.map_err(ApiError::from)?;
    if !SupportRepository::update_conversation(&mut *transaction, conversation_id, &mutation).await? {
        return Err(ApiError::Conflict(
            "This conversation changed. Refresh it before taking another action".to_string(),
        ));
    }
    SupportRepository::insert_event(
        &mut *transaction,
        conversation_id,
        None,
        Some(actor_id),
        &event_type,
        Some(&current.summary.status),
        Some(&mutation.status),
        (!event_details.as_object().is_some_and(|object| object.is_empty())).then_some(event_details),
    )
    .await?;
    if let Some(key) = input.client_action_id.as_deref() {
        SupportRepository::insert_action_key(&mut *transaction, conversation_id, actor_id, key, &action)
            .await?;
    }
    transaction.commit().await.map_err(ApiError::from)?;

    let _ = AuditLog::log_event(
        pool,
        Some(actor_id),
        &format!("support.{event_type}"),
        "support_conversation",
        Some(conversation_id),
        Some(json!({"from_status": current.summary.status, "to_status": mutation.status, "action": action})),
        ip_address,
        user_agent,
    )
    .await;
    staff_detail(pool, conversation_id).await
}

pub async fn list_guest_conversations(
    pool: &DbPool,
    guest_id: i64,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<GuestSupportConversationListResponse, ApiError> {
    let pagination = normalize_pagination(page, page_size, 20, 100);
    let window_days = reopen_window_days(pool).await;
    let (total, items) = SupportRepository::list_guest_conversations(
        pool,
        guest_id,
        pagination.page_size,
        pagination.offset,
        window_days,
    )
    .await?;
    Ok(GuestSupportConversationListResponse {
        items,
        total,
        page: pagination.page,
        page_size: pagination.page_size,
    })
}

pub async fn get_guest_conversation(
    pool: &DbPool,
    guest_id: i64,
    conversation_id: i64,
) -> Result<GuestSupportConversationDetail, ApiError> {
    let conversation = SupportRepository::find_guest_conversation(pool, guest_id, conversation_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Support conversation not found".to_string()))?;
    let window_days = reopen_window_days(pool).await;
    let messages = SupportRepository::list_messages(pool, conversation_id).await?;
    Ok(GuestSupportConversationDetail {
        conversation: guest_view(&conversation, window_days),
        messages,
    })
}

pub async fn create_guest_conversation(
    pool: &DbPool,
    guest_id: i64,
    request: CreateGuestSupportConversationRequest,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<GuestSupportConversationDetail, ApiError> {
    if !support_enabled(pool).await {
        return Err(ApiError::Forbidden("Guest support is currently unavailable".to_string()));
    }
    let category = validation::validate_category(&request.category)?;
    let message = validation::sanitize_required_message(&request.message)?;
    if let Some(booking_id) = request.booking_id
        && !SupportRepository::booking_belongs_to_guest(pool, booking_id, guest_id).await?
    {
        return Err(ApiError::NotFound("Booking not found".to_string()));
    }
    let priority = "normal";
    let (first_sla, resolution_sla) = priority_sla(pool, priority).await;
    let now = Utc::now();
    let number = conversation_number();
    let subject = subject_for_category(&category);
    let new_conversation = NewConversation {
        conversation_number: &number,
        guest_id,
        booking_id: request.booking_id,
        subject: &subject,
        category: &category,
        priority,
        first_response_due_at: now + first_sla,
        resolution_due_at: now + resolution_sla,
    };
    let mut transaction = pool.begin().await.map_err(ApiError::from)?;
    let conversation_id = SupportRepository::insert_conversation(&mut *transaction, &new_conversation).await?;
    SupportRepository::insert_message(
        &mut *transaction,
        conversation_id,
        "guest",
        Some(guest_id),
        None,
        &message,
        None,
    )
    .await?;
    SupportRepository::insert_event(
        &mut *transaction,
        conversation_id,
        Some(guest_id),
        None,
        "created",
        None,
        Some("waiting_for_staff"),
        Some(json!({"category": category})),
    )
    .await?;
    transaction.commit().await.map_err(ApiError::from)?;

    let _ = AuditLog::log_event(
        pool,
        None,
        "guest_portal.support_conversation_created",
        "support_conversation",
        Some(conversation_id),
        Some(json!({"guest_id": guest_id, "category": category})),
        ip_address,
        user_agent,
    )
    .await;
    get_guest_conversation(pool, guest_id, conversation_id).await
}

pub async fn send_guest_message(
    pool: &DbPool,
    guest_id: i64,
    conversation_id: i64,
    request: GuestSupportMessageRequest,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<GuestSupportConversationDetail, ApiError> {
    request_id_is_valid(request.client_message_id.as_deref())?;
    let body = validation::sanitize_required_message(&request.message)?;
    let current = SupportRepository::find_guest_conversation(pool, guest_id, conversation_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Support conversation not found".to_string()))?;
    if let Some(client_message_id) = request.client_message_id.as_deref()
        && SupportRepository::client_message_exists(pool, conversation_id, "guest", client_message_id).await?
    {
        return get_guest_conversation(pool, guest_id, conversation_id).await;
    }
    if current.summary.status == "closed" {
        return Err(ApiError::Conflict(
            "This conversation is closed. Please start a new conversation".to_string(),
        ));
    }
    if let Some(expected_version) = request.expected_version
        && expected_version != current.summary.version
    {
        return Err(ApiError::Conflict(
            "This conversation changed. Refresh it before sending another message".to_string(),
        ));
    }

    let mut mutation = ConversationMutation::from(&current);
    mutation.expected_version = request.expected_version;
    let mut event_type = "guest_replied";
    let from_status = current.summary.status.clone();
    if current.summary.status == "resolved" {
        let window_days = reopen_window_days(pool).await;
        if !reopen_allowed(current.summary.resolved_at, window_days) {
            return Err(ApiError::Conflict(
                "This resolved conversation can no longer be reopened".to_string(),
            ));
        }
        let (_, resolution_sla) = priority_sla(pool, &current.summary.priority).await;
        mutation.status = "waiting_for_staff".to_string();
        mutation.resolved_at = None;
        mutation.closed_at = None;
        mutation.resolution_code = None;
        mutation.resolution_summary = None;
        mutation.resolution_due_at = Some(Utc::now() + resolution_sla);
        mutation.reopen_count += 1;
        event_type = "reopened_by_guest";
    } else {
        mutation.status = "waiting_for_staff".to_string();
        if current.summary.status == "waiting_for_guest" {
            if let Some(resolution_due_at) = current.summary.resolution_due_at {
                let paused_for = Utc::now() - current.summary.last_activity_at;
                mutation.resolution_due_at = Some(resolution_due_at + paused_for.max(Duration::zero()));
            }
        }
    }

    let mut transaction = pool.begin().await.map_err(ApiError::from)?;
    if !SupportRepository::update_conversation(&mut *transaction, conversation_id, &mutation).await? {
        return Err(ApiError::Conflict(
            "This conversation changed. Refresh it before sending another message".to_string(),
        ));
    }
    SupportRepository::insert_message(
        &mut *transaction,
        conversation_id,
        "guest",
        Some(guest_id),
        None,
        &body,
        request.client_message_id.as_deref(),
    )
    .await?;
    SupportRepository::insert_event(
        &mut *transaction,
        conversation_id,
        Some(guest_id),
        None,
        event_type,
        Some(&from_status),
        Some(&mutation.status),
        None,
    )
    .await?;
    transaction.commit().await.map_err(ApiError::from)?;

    let _ = AuditLog::log_event(
        pool,
        None,
        "guest_portal.support_message_sent",
        "support_conversation",
        Some(conversation_id),
        Some(json!({"guest_id": guest_id, "event": event_type})),
        ip_address,
        user_agent,
    )
    .await;
    get_guest_conversation(pool, guest_id, conversation_id).await
}

pub async fn reopen_guest_conversation(
    pool: &DbPool,
    guest_id: i64,
    conversation_id: i64,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<GuestSupportConversationDetail, ApiError> {
    let current = SupportRepository::find_guest_conversation(pool, guest_id, conversation_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Support conversation not found".to_string()))?;
    if current.summary.status == "waiting_for_staff" {
        return get_guest_conversation(pool, guest_id, conversation_id).await;
    }
    let window_days = reopen_window_days(pool).await;
    if current.summary.status != "resolved" || !reopen_allowed(current.summary.resolved_at, window_days) {
        return Err(ApiError::Conflict(
            "This conversation can no longer be reopened. Please start a new one".to_string(),
        ));
    }
    let (_, resolution_sla) = priority_sla(pool, &current.summary.priority).await;
    let mut mutation = ConversationMutation::from(&current);
    mutation.status = "waiting_for_staff".to_string();
    mutation.resolved_at = None;
    mutation.closed_at = None;
    mutation.resolution_code = None;
    mutation.resolution_summary = None;
    mutation.resolution_due_at = Some(Utc::now() + resolution_sla);
    mutation.reopen_count += 1;
    mutation.expected_version = Some(current.summary.version);

    let mut transaction = pool.begin().await.map_err(ApiError::from)?;
    if !SupportRepository::update_conversation(&mut *transaction, conversation_id, &mutation).await? {
        return Err(ApiError::Conflict(
            "This conversation changed. Refresh it before reopening it".to_string(),
        ));
    }
    SupportRepository::insert_event(
        &mut *transaction,
        conversation_id,
        Some(guest_id),
        None,
        "reopened_by_guest",
        Some("resolved"),
        Some("waiting_for_staff"),
        None,
    )
    .await?;
    transaction.commit().await.map_err(ApiError::from)?;

    let _ = AuditLog::log_event(
        pool,
        None,
        "guest_portal.support_reopened",
        "support_conversation",
        Some(conversation_id),
        Some(json!({"guest_id": guest_id})),
        ip_address,
        user_agent,
    )
    .await;
    get_guest_conversation(pool, guest_id, conversation_id).await
}
