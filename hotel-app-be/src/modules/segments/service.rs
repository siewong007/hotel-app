//! Segment workflows: validation, slug derivation, audit, preview, and the
//! `audience_scope_for` contract consumed by communications targeting.

use serde_json::json;
use serde_json::Value as JsonValue;

use super::models::{
    GuestSegment, SegmentFieldOptions, SegmentInput, SegmentListQuery, SegmentListResponse,
    SegmentPreview, SegmentPreviewInput, SegmentScope, SegmentSummary,
};
use super::repository::SegmentRepository;
use super::rules::{self, CompiledClause};
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::AuditEvent;
use crate::services::audit::AuditLog;
use crate::utils::pagination::normalize_pagination;
use crate::utils::sanitization::Sanitizer;

pub struct SegmentDraft {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub rules: JsonValue,
    pub is_active: bool,
}

fn sanitize_name(value: &str) -> Result<String, ApiError> {
    let name = Sanitizer::sanitize_text(value).trim().to_string();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(ApiError::BadRequest(
            "Segment name must be 1-120 characters".to_string(),
        ));
    }
    Ok(name)
}

fn sanitize_description(value: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(value) = value else { return Ok(None) };
    let description = Sanitizer::sanitize_text(&value).trim().to_string();
    if description.chars().count() > 2000 {
        return Err(ApiError::BadRequest(
            "Segment description must be 2000 characters or fewer".to_string(),
        ));
    }
    Ok((!description.is_empty()).then_some(description))
}

/// Derives a URL-safe slug from the segment name: lowercase alnum runs joined
/// by hyphens, 3-160 chars. Falls back to `segment` when nothing usable
/// remains (e.g. an all-emoji name).
fn slugify(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    let mut last_dash = true;
    for character in name.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            slug.push(character);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_matches('-');
    let slug = if slug.len() > 160 { &slug[..160] } else { slug };
    let slug = slug.trim_end_matches('-');
    if slug.len() < 3 {
        "segment".to_string()
    } else {
        slug.to_string()
    }
}

/// First free slug for the name: base, then `base-2` … `base-20`.
async fn available_slug(
    pool: &DbPool,
    name: &str,
    exclude_id: Option<i64>,
) -> Result<String, ApiError> {
    let base = slugify(name);
    for suffix in 0..=20 {
        let candidate = if suffix == 0 {
            base.clone()
        } else {
            format!("{base}-{suffix}")
        };
        if !SegmentRepository::slug_exists(pool, &candidate, exclude_id).await? {
            return Ok(candidate);
        }
    }
    Err(ApiError::Conflict(
        "Could not derive a unique segment slug from the name".to_string(),
    ))
}

fn validate_input(input: SegmentInput) -> Result<SegmentDraft, ApiError> {
    rules::parse_rules(&input.rules)?;
    Ok(SegmentDraft {
        name: sanitize_name(&input.name)?,
        slug: String::new(),
        description: sanitize_description(input.description)?,
        rules: input.rules,
        is_active: input.is_active.unwrap_or(true),
    })
}

async fn require_segment(pool: &DbPool, id: i64) -> Result<GuestSegment, ApiError> {
    SegmentRepository::find_by_id(pool, id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Segment not found".to_string()))
}

/// Communications contract: the segment must exist and be active before it can
/// be attached to a campaign draft.
pub async fn require_active_segment(pool: &DbPool, segment_id: i64) -> Result<(), ApiError> {
    match SegmentRepository::find_by_id(pool, segment_id).await? {
        Some(segment) if segment.is_active => Ok(()),
        _ => Err(ApiError::BadRequest(
            "Unknown or inactive segment".to_string(),
        )),
    }
}

/// Resolves a campaign's `segment_id` into the scope the audience queries
/// apply. A missing or inactive segment fails closed — the campaign expands to
/// nobody rather than everyone.
pub async fn audience_scope_for(
    pool: &DbPool,
    segment_id: Option<i64>,
) -> Result<SegmentScope, ApiError> {
    match segment_id {
        None => Ok(SegmentScope::Unrestricted),
        Some(id) => match SegmentRepository::find_by_id(pool, id).await? {
            Some(segment) if segment.is_active => Ok(SegmentScope::Rules(segment.rules)),
            _ => Ok(SegmentScope::Empty),
        },
    }
}

fn compile(segment: &GuestSegment, first_param: usize) -> Result<CompiledClause, ApiError> {
    rules::compile_rules(&segment.rules, first_param)
}

pub async fn list_segments(
    pool: &DbPool,
    query: &SegmentListQuery,
) -> Result<SegmentListResponse, ApiError> {
    let pagination = normalize_pagination(query.page, query.page_size, 20, 50);
    let (items, total) = SegmentRepository::list(
        pool,
        query.search.clone(),
        query.is_active,
        pagination.page_size,
        pagination.offset,
    )
    .await?;
    let mut summaries = Vec::with_capacity(items.len());
    for segment in items {
        // Segments are stored validated, so compile failure means corruption —
        // surface it as a 500 rather than silently reporting 0 members.
        let member_count =
            SegmentRepository::count_matching(pool, &compile(&segment, 1)?).await?;
        summaries.push(SegmentSummary {
            id: segment.id,
            name: segment.name,
            slug: segment.slug,
            description: segment.description,
            rules: segment.rules,
            is_active: segment.is_active,
            member_count,
            updated_at: segment.updated_at,
        });
    }
    Ok(SegmentListResponse {
        items: summaries,
        total,
        page: pagination.page,
        page_size: pagination.page_size,
    })
}

pub async fn get_segment(pool: &DbPool, id: i64) -> Result<GuestSegment, ApiError> {
    require_segment(pool, id).await
}

pub async fn create_segment(
    pool: &DbPool,
    actor_id: i64,
    input: SegmentInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<GuestSegment, ApiError> {
    let mut draft = validate_input(input)?;
    draft.slug = available_slug(pool, &draft.name, None).await?;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let id = SegmentRepository::insert_tx(&mut tx, &draft, actor_id).await?;
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "segment.created",
            resource_type: "guest_segment",
            resource_id: Some(id),
            details: Some(json!({
                "name": draft.name,
                "slug": draft.slug,
                "is_active": draft.is_active,
            })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    require_segment(pool, id).await
}

pub async fn update_segment(
    pool: &DbPool,
    actor_id: i64,
    id: i64,
    input: SegmentInput,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<GuestSegment, ApiError> {
    let existing = require_segment(pool, id).await?;
    let mut draft = validate_input(input)?;
    draft.slug = if draft.name == existing.name {
        existing.slug.clone()
    } else {
        available_slug(pool, &draft.name, Some(id)).await?
    };
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    if !SegmentRepository::update_tx(&mut tx, id, &draft, actor_id).await? {
        return Err(ApiError::NotFound("Segment not found".to_string()));
    }
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "segment.updated",
            resource_type: "guest_segment",
            resource_id: Some(id),
            details: Some(json!({
                "name": draft.name,
                "slug": draft.slug,
                "is_active": draft.is_active,
            })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;
    require_segment(pool, id).await
}

pub async fn delete_segment(
    pool: &DbPool,
    actor_id: i64,
    id: i64,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<(), ApiError> {
    let segment = require_segment(pool, id).await?;
    if SegmentRepository::campaign_count(pool, id).await? > 0 {
        return Err(ApiError::Conflict(
            "Segment is used by email campaigns; deactivate it instead".to_string(),
        ));
    }
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    if !SegmentRepository::delete(&mut tx, id).await? {
        return Err(ApiError::NotFound("Segment not found".to_string()));
    }
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: Some(actor_id),
            action: "segment.deleted",
            resource_type: "guest_segment",
            resource_id: Some(id),
            details: Some(json!({ "name": segment.name, "slug": segment.slug })),
            ip_address,
            user_agent,
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)
}

pub async fn preview_saved(pool: &DbPool, id: i64) -> Result<SegmentPreview, ApiError> {
    let segment = require_segment(pool, id).await?;
    let clause = compile(&segment, 1)?;
    Ok(SegmentPreview {
        count: SegmentRepository::count_matching(pool, &clause).await?,
        sample: SegmentRepository::sample_matching(pool, &clause, 10).await?,
    })
}

/// Preview of unsaved rules — count only, no sample.
pub async fn preview_rules(
    pool: &DbPool,
    input: SegmentPreviewInput,
) -> Result<SegmentPreview, ApiError> {
    let clause = rules::compile_rules(&input.rules, 1)?;
    Ok(SegmentPreview {
        count: SegmentRepository::count_matching(pool, &clause).await?,
        sample: Vec::new(),
    })
}

pub async fn field_options(pool: &DbPool) -> Result<SegmentFieldOptions, ApiError> {
    Ok(SegmentFieldOptions {
        loyalty_tiers: SegmentRepository::loyalty_tier_options(pool).await?,
        guest_types: vec!["member".to_string(), "non_member".to_string()],
        distinct_values: SegmentRepository::distinct_values(pool).await?,
    })
}
