//! Guest Relations business workflows.
//!
//! Every endpoint is scoped under `/guests/{id}`: the guest must exist
//! (`GuestRepository::exists`, which already excludes soft-deleted rows)
//! before any sub-resource work runs. Mutations audit-log through
//! `services/audit.rs` under the `guest` resource type so they stay in the
//! guests activity stream.

use chrono::Utc;
use serde_json::json;

use super::models::{
    GuestCommunicationsSummary, GuestInteraction, GuestInteractionInput, GuestInteractionUpdate,
    GuestPreference, GuestPreferencesPut, GuestReviewResponseInput, GuestReviewRow,
    GuestVoucherRow, InteractionListQuery, InteractionListResponse,
};
use super::repository::{GuestRelationsRepository, InteractionUpdateValues, NewInteraction};
use super::validation;
use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::AuditEvent;
use crate::modules::support::models::SupportConversationSummary;
use crate::repositories::guest::GuestRepository;
use crate::services::audit::AuditLog;
use crate::utils::pagination::normalize_pagination;

/// How many recent `email_deliveries` rows the communications widget fetches.
const RECENT_DELIVERIES_LIMIT: i64 = 20;
/// How many support conversations the guest-360 widget fetches.
const SUPPORT_LIST_LIMIT: i64 = 20;

async fn require_guest(pool: &DbPool, guest_id: i64) -> Result<(), ApiError> {
    if GuestRepository::exists(pool, guest_id).await? {
        Ok(())
    } else {
        Err(ApiError::NotFound("Guest not found".to_string()))
    }
}

async fn can_manage_guests(pool: &DbPool, user_id: i64) -> bool {
    AuthService::check_permission(pool, user_id, "guests:manage")
        .await
        .unwrap_or(false)
}

/// Private-note rule for mutations: a private interaction may be edited or
/// deleted only by its author (`created_by`) or a `guests:manage` holder. The
/// repository enforces the same rule on reads; mutations re-check it against
/// the fetched row so a private note answers 403 rather than a misleading
/// 404 (or worse, a silent edit).
async fn ensure_interaction_mutable(
    pool: &DbPool,
    actor_id: i64,
    row: &GuestInteraction,
) -> Result<(), ApiError> {
    if !row.is_private || row.created_by == Some(actor_id) {
        return Ok(());
    }
    if can_manage_guests(pool, actor_id).await {
        return Ok(());
    }
    Err(ApiError::Forbidden(
        "This private interaction can only be changed by its author".to_string(),
    ))
}

// ---------------------------------------------------------------------
// Interactions (guest_notes)
// ---------------------------------------------------------------------

pub async fn list_interactions(
    pool: &DbPool,
    viewer_id: i64,
    guest_id: i64,
    query: InteractionListQuery,
) -> Result<InteractionListResponse, ApiError> {
    require_guest(pool, guest_id).await?;
    let pagination = normalize_pagination(query.page, query.page_size, 20, 100);
    // Open follow-ups are the first-class surface: rows whose follow-up is
    // already completed are hidden unless the caller opts in.
    let include_completed = query.include_completed_followups.unwrap_or(false);
    let can_manage = can_manage_guests(pool, viewer_id).await;
    let (items, total) = GuestRelationsRepository::list_interactions(
        pool,
        guest_id,
        viewer_id,
        can_manage,
        pagination.page,
        pagination.page_size,
        include_completed,
    )
    .await?;
    Ok(InteractionListResponse {
        data: items,
        total,
        page: pagination.page,
        page_size: pagination.page_size,
    })
}

pub async fn create_interaction(
    pool: &DbPool,
    actor_id: i64,
    guest_id: i64,
    input: GuestInteractionInput,
) -> Result<GuestInteraction, ApiError> {
    require_guest(pool, guest_id).await?;
    if let Some(booking_id) = input.booking_id
        && !GuestRelationsRepository::booking_belongs_to_guest(pool, booking_id, guest_id).await?
    {
        return Err(ApiError::BadRequest(
            "The linked booking does not belong to this guest".to_string(),
        ));
    }
    let values = NewInteraction {
        interaction_type: validation::validate_interaction_type(
            input.interaction_type.as_deref(),
        )?,
        subject: validation::sanitize_subject(input.subject)?,
        content: validation::validate_content(&input.content)?,
        booking_id: input.booking_id,
        is_alert: input.is_alert.unwrap_or(false),
        is_private: input.is_private.unwrap_or(false),
        follow_up_at: input.follow_up_at,
        assigned_to: input.assigned_to,
    };
    let note_id =
        GuestRelationsRepository::insert_interaction(pool, guest_id, &values, actor_id).await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(actor_id),
            action: "guest_interaction_created",
            resource_type: "guest",
            resource_id: Some(guest_id),
            details: Some(json!({
                "note_id": note_id,
                "interaction_type": values.interaction_type,
                "is_private": values.is_private,
                "is_alert": values.is_alert,
                "booking_id": values.booking_id,
            })),
            ..Default::default()
        },
    )
    .await;

    GuestRelationsRepository::find_interaction(pool, note_id, guest_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Interaction not found".to_string()))
}

/// Patch semantics — every field of `GuestInteractionUpdate` is `Option` where
/// `None` means "leave the stored column unchanged" and `Some` carries the
/// replacement through the field validators. Two resolutions deserve a call
/// out:
///
/// - `subject: Some("")` — `sanitize_subject` maps blank input to `None`,
///   which is the resolved value written to the column; sending `""` is how
///   the frontend clears a subject (there is no explicit-null patch field).
/// - `follow_up_completed` — `Some(true)` stamps `follow_up_completed_at =
///   now()` but only once: a follow-up already completed keeps its original
///   timestamp. `Some(false)` clears it back to NULL (reopens).
pub async fn update_interaction(
    pool: &DbPool,
    actor_id: i64,
    guest_id: i64,
    note_id: i64,
    input: GuestInteractionUpdate,
) -> Result<GuestInteraction, ApiError> {
    require_guest(pool, guest_id).await?;
    let existing = GuestRelationsRepository::find_interaction(pool, note_id, guest_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Interaction not found".to_string()))?;
    ensure_interaction_mutable(pool, actor_id, &existing).await?;

    let subject = match input.subject {
        Some(value) => validation::sanitize_subject(Some(value))?,
        None => existing.subject.clone(),
    };
    let content = match input.content {
        Some(value) => validation::validate_content(&value)?,
        None => existing.content.clone(),
    };
    let interaction_type = match input.interaction_type {
        Some(value) => validation::validate_interaction_type(Some(value.as_str()))?,
        None => existing.interaction_type.clone(),
    };
    let follow_up_completed_at = match input.follow_up_completed {
        Some(true) => existing.follow_up_completed_at.or_else(|| Some(Utc::now())),
        Some(false) => None,
        None => existing.follow_up_completed_at,
    };

    let values = InteractionUpdateValues {
        subject,
        content,
        interaction_type,
        is_alert: input.is_alert.unwrap_or(existing.is_alert),
        is_private: input.is_private.unwrap_or(existing.is_private),
        follow_up_at: input.follow_up_at.or(existing.follow_up_at),
        follow_up_completed_at,
        assigned_to: input.assigned_to.or(existing.assigned_to),
    };
    if !GuestRelationsRepository::update_interaction(pool, note_id, guest_id, &values).await? {
        return Err(ApiError::NotFound("Interaction not found".to_string()));
    }

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(actor_id),
            action: "guest_interaction_updated",
            resource_type: "guest",
            resource_id: Some(guest_id),
            details: Some(json!({"note_id": note_id})),
            ..Default::default()
        },
    )
    .await;

    GuestRelationsRepository::find_interaction(pool, note_id, guest_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Interaction not found".to_string()))
}

pub async fn delete_interaction(
    pool: &DbPool,
    actor_id: i64,
    guest_id: i64,
    note_id: i64,
) -> Result<(), ApiError> {
    require_guest(pool, guest_id).await?;
    let existing = GuestRelationsRepository::find_interaction(pool, note_id, guest_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Interaction not found".to_string()))?;
    ensure_interaction_mutable(pool, actor_id, &existing).await?;

    if !GuestRelationsRepository::delete_interaction(pool, note_id, guest_id).await? {
        return Err(ApiError::NotFound("Interaction not found".to_string()));
    }

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(actor_id),
            action: "guest_interaction_deleted",
            resource_type: "guest",
            resource_id: Some(guest_id),
            details: Some(json!({"note_id": note_id})),
            ..Default::default()
        },
    )
    .await;
    Ok(())
}

// ---------------------------------------------------------------------
// Preferences (guest_preferences)
// ---------------------------------------------------------------------

pub async fn list_preferences(
    pool: &DbPool,
    guest_id: i64,
) -> Result<Vec<GuestPreference>, ApiError> {
    require_guest(pool, guest_id).await?;
    GuestRelationsRepository::list_preferences(pool, guest_id).await
}

/// Bulk upsert in a single transaction: entries are validated first, upserted
/// one by one, then — for every `replace_categories` category — stored keys
/// absent from this PUT are deleted. Returns the refreshed preference list.
pub async fn put_preferences(
    pool: &DbPool,
    actor_id: i64,
    guest_id: i64,
    input: GuestPreferencesPut,
) -> Result<Vec<GuestPreference>, ApiError> {
    require_guest(pool, guest_id).await?;
    let input = validation::validate_preferences_put(input)?;

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    for entry in &input.entries {
        GuestRelationsRepository::upsert_preference_tx(
            &mut tx,
            guest_id,
            &entry.category,
            &entry.preference_key,
            &entry.preference_value,
        )
        .await?;
    }
    if let Some(categories) = &input.replace_categories {
        let keep_pairs: Vec<(String, String)> = input
            .entries
            .iter()
            .map(|entry| (entry.category.clone(), entry.preference_key.clone()))
            .collect();
        GuestRelationsRepository::delete_preferences_not_in_tx(
            &mut tx,
            guest_id,
            categories,
            &keep_pairs,
        )
        .await?;
    }
    tx.commit().await.map_err(ApiError::from)?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(actor_id),
            action: "guest_preferences_updated",
            resource_type: "guest",
            resource_id: Some(guest_id),
            details: Some(json!({
                "entries": input.entries.len(),
                "replace_categories": input.replace_categories,
            })),
            ..Default::default()
        },
    )
    .await;

    GuestRelationsRepository::list_preferences(pool, guest_id).await
}

// ---------------------------------------------------------------------
// Reviews (guest_reviews)
// ---------------------------------------------------------------------

pub async fn list_reviews(
    pool: &DbPool,
    guest_id: i64,
) -> Result<Vec<GuestReviewRow>, ApiError> {
    require_guest(pool, guest_id).await?;
    GuestRelationsRepository::list_reviews(pool, guest_id).await
}

pub async fn respond_to_review(
    pool: &DbPool,
    actor_id: i64,
    guest_id: i64,
    review_id: i64,
    input: GuestReviewResponseInput,
) -> Result<GuestReviewRow, ApiError> {
    require_guest(pool, guest_id).await?;
    let response = validation::validate_review_response(&input.response)?;
    let review =
        GuestRelationsRepository::respond_to_review(pool, review_id, guest_id, &response, actor_id)
            .await?
            .ok_or_else(|| ApiError::NotFound("Review not found".to_string()))?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(actor_id),
            action: "guest_review_responded",
            resource_type: "guest",
            resource_id: Some(guest_id),
            details: Some(json!({"review_id": review_id})),
            ..Default::default()
        },
    )
    .await;
    Ok(review)
}

// ---------------------------------------------------------------------
// Read-only cross-domain aggregates
// ---------------------------------------------------------------------

/// `None` serializes as `null` — a guest without a loyalty membership gets a
/// 200 with a null body, not a 404 (they exist; they are simply not enrolled).
pub async fn loyalty_summary(
    pool: &DbPool,
    guest_id: i64,
) -> Result<Option<super::models::GuestLoyaltySummary>, ApiError> {
    require_guest(pool, guest_id).await?;
    GuestRelationsRepository::loyalty_summary(pool, guest_id).await
}

pub async fn list_vouchers(
    pool: &DbPool,
    guest_id: i64,
) -> Result<Vec<GuestVoucherRow>, ApiError> {
    require_guest(pool, guest_id).await?;
    GuestRelationsRepository::list_vouchers(pool, guest_id).await
}

pub async fn communications_summary(
    pool: &DbPool,
    guest_id: i64,
) -> Result<GuestCommunicationsSummary, ApiError> {
    require_guest(pool, guest_id).await?;
    let consent = GuestRelationsRepository::guest_consent_state(pool, guest_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Guest not found".to_string()))?;
    let email_suppressed = match consent.email.as_deref() {
        Some(email) if !email.trim().is_empty() => {
            GuestRelationsRepository::is_email_suppressed(pool, email).await?
        }
        _ => false,
    };
    let subscriptions = GuestRelationsRepository::list_subscriptions(pool, guest_id).await?;
    let recent_deliveries =
        GuestRelationsRepository::list_recent_deliveries(pool, guest_id, RECENT_DELIVERIES_LIMIT)
            .await?;
    Ok(GuestCommunicationsSummary {
        marketing_opt_in: consent.marketing_opt_in,
        communication_preference: consent.communication_preference,
        language_preference: consent.language_preference,
        email_suppressed,
        subscriptions,
        recent_deliveries,
    })
}

pub async fn list_support_conversations(
    pool: &DbPool,
    guest_id: i64,
) -> Result<Vec<SupportConversationSummary>, ApiError> {
    require_guest(pool, guest_id).await?;
    GuestRelationsRepository::list_support_for_guest(pool, guest_id, SUPPORT_LIST_LIMIT).await
}
