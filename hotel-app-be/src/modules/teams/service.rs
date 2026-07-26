//! Team business workflows: authorization decisions, audit, cache invalidation.

use super::models::*;
use super::repository::TeamRepository;
use super::validation;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::AuditEvent;
use crate::repositories::audit::AuditRepository;

/// Fail-closed audit write.
///
/// Teams change who can do what, so an untraceable membership or role change
/// is exactly the event the trail exists to record. `AuditLog::log_event`
/// deliberately swallows its error to keep unrelated operations alive; this
/// domain opts out of that.
async fn audit(pool: &DbPool, event: AuditEvent<'_>) -> Result<(), ApiError> {
    AuditRepository::insert_event(pool, event, chrono::Utc::now())
        .await
        .map_err(|e| ApiError::Database(format!("Audit write failed, change rejected: {e}")))
}

pub async fn list_teams(
    pool: &DbPool,
    include_inactive: bool,
) -> Result<Vec<TeamSummary>, ApiError> {
    TeamRepository::list(pool, include_inactive).await
}

pub async fn get_team(pool: &DbPool, team_id: i64) -> Result<TeamDetail, ApiError> {
    let team = TeamRepository::find(pool, team_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Team not found".to_string()))?;
    let members = TeamRepository::members(pool, team_id).await?;
    let roles = TeamRepository::roles(pool, team_id).await?;
    Ok(TeamDetail {
        team,
        members,
        roles,
    })
}

pub async fn create_team(
    pool: &DbPool,
    actor_user_id: i64,
    mut input: TeamCreateInput,
) -> Result<Team, ApiError> {
    validation::validate_create(&mut input)?;
    let team = TeamRepository::create(pool, &input, actor_user_id).await?;

    audit(
        pool,
        AuditEvent {
            user_id: Some(actor_user_id),
            action: "team_created",
            resource_type: "team",
            resource_id: Some(team.id),
            details: Some(serde_json::json!({
                "code": team.code,
                "name": team.name,
            })),
            ..Default::default()
        },
    )
    .await?;

    Ok(team)
}

pub async fn update_team(
    pool: &DbPool,
    actor_user_id: i64,
    team_id: i64,
    mut input: TeamUpdateInput,
) -> Result<Team, ApiError> {
    validation::validate_update(&mut input)?;

    // Read before writing so the audit row can carry both sides. "What did it
    // used to be" is the question an audit trail is asked most often.
    let before = TeamRepository::find(pool, team_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Team not found".to_string()))?;
    let team = TeamRepository::update(pool, team_id, &input, actor_user_id).await?;

    audit(
        pool,
        AuditEvent {
            user_id: Some(actor_user_id),
            action: "team_updated",
            resource_type: "team",
            resource_id: Some(team.id),
            details: Some(serde_json::json!({
                "before": { "name": before.name, "description": before.description, "is_active": before.is_active },
                "after":  { "name": team.name,   "description": team.description,   "is_active": team.is_active },
            })),
            ..Default::default()
        },
    )
    .await?;

    // Deactivating a team withdraws every role it conferred.
    crate::core::rbac_cache::invalidate_all();
    Ok(team)
}

pub async fn delete_team(
    pool: &DbPool,
    actor_user_id: i64,
    team_id: i64,
) -> Result<(), ApiError> {
    let before = TeamRepository::find(pool, team_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Team not found".to_string()))?;

    if !TeamRepository::soft_delete(pool, team_id, actor_user_id).await? {
        return Err(ApiError::NotFound("Team not found".to_string()));
    }

    audit(
        pool,
        AuditEvent {
            user_id: Some(actor_user_id),
            action: "team_deleted",
            resource_type: "team",
            resource_id: Some(team_id),
            details: Some(serde_json::json!({ "code": before.code, "name": before.name })),
            ..Default::default()
        },
    )
    .await?;

    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

/// The one team-scoped authorization rule in the system.
///
/// Membership may be changed by anyone holding the global `teams:assign`
/// (or `teams:manage`, implied one layer down), **or** by a current lead of
/// that specific team. This is deliberately the only scoped check: it cannot
/// grant permissions, only move people between teams whose roles are already
/// fixed, so it needs no interaction with the escalation guard.
pub async fn ensure_can_manage_membership(
    pool: &DbPool,
    actor_user_id: i64,
    team_id: i64,
) -> Result<(), ApiError> {
    if crate::core::middleware::check_permission(pool, actor_user_id, "teams:assign")
        .await
        .is_ok()
    {
        return Ok(());
    }

    if TeamRepository::is_lead(pool, team_id, actor_user_id).await? {
        return Ok(());
    }

    Err(ApiError::Forbidden(
        "You must hold teams:assign or lead this team to change its membership".to_string(),
    ))
}

pub async fn add_member(
    pool: &DbPool,
    actor_user_id: i64,
    team_id: i64,
    input: TeamMemberInput,
) -> Result<(), ApiError> {
    ensure_can_manage_membership(pool, actor_user_id, team_id).await?;

    if TeamRepository::find(pool, team_id).await?.is_none() {
        return Err(ApiError::NotFound("Team not found".to_string()));
    }

    // Joining a team confers its roles, so adding a member must clear the same
    // bar as granting those roles directly -- otherwise teams become a
    // laundering path around the escalation guard.
    let role_ids = TeamRepository::role_ids(pool, team_id).await?;
    crate::services::rbac::ensure_actor_can_manage_roles(pool, actor_user_id, &role_ids).await?;

    TeamRepository::upsert_member(pool, team_id, &input, actor_user_id).await?;

    audit(
        pool,
        AuditEvent {
            user_id: Some(actor_user_id),
            action: "team_member_added",
            resource_type: "team",
            resource_id: Some(team_id),
            details: Some(serde_json::json!({
                "member_user_id": input.user_id,
                "is_lead": input.is_lead,
                "expires_at": input.expires_at,
            })),
            ..Default::default()
        },
    )
    .await?;

    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

pub async fn remove_member(
    pool: &DbPool,
    actor_user_id: i64,
    team_id: i64,
    member_user_id: i64,
) -> Result<(), ApiError> {
    ensure_can_manage_membership(pool, actor_user_id, team_id).await?;

    if !TeamRepository::remove_member(pool, team_id, member_user_id).await? {
        return Err(ApiError::NotFound(
            "That user is not a member of this team".to_string(),
        ));
    }

    audit(
        pool,
        AuditEvent {
            user_id: Some(actor_user_id),
            action: "team_member_removed",
            resource_type: "team",
            resource_id: Some(team_id),
            details: Some(serde_json::json!({ "member_user_id": member_user_id })),
            ..Default::default()
        },
    )
    .await?;

    crate::core::rbac_cache::invalidate_all();
    Ok(())
}

/// Replace the roles a team confers.
///
/// Guarded by the same permission-superset rule as a direct user-role grant,
/// applied to both the outgoing and incoming role sets: an actor may not
/// withdraw a role they could not have granted, and may not grant one whose
/// permissions they do not hold.
pub async fn replace_team_roles(
    pool: &DbPool,
    actor_user_id: i64,
    team_id: i64,
    input: TeamRoleIdsInput,
) -> Result<usize, ApiError> {
    if TeamRepository::find(pool, team_id).await?.is_none() {
        return Err(ApiError::NotFound("Team not found".to_string()));
    }

    let current = TeamRepository::role_ids(pool, team_id).await?;
    let mut next = input.role_ids;
    next.sort_unstable();
    next.dedup();

    crate::services::rbac::ensure_actor_can_manage_roles(pool, actor_user_id, &current).await?;
    crate::services::rbac::ensure_actor_can_manage_roles(pool, actor_user_id, &next).await?;

    TeamRepository::replace_roles(pool, team_id, &next, actor_user_id).await?;

    audit(
        pool,
        AuditEvent {
            user_id: Some(actor_user_id),
            action: "team_roles_replaced",
            resource_type: "team",
            resource_id: Some(team_id),
            details: Some(serde_json::json!({ "before": current, "after": next })),
            ..Default::default()
        },
    )
    .await?;

    crate::core::rbac_cache::invalidate_all();
    Ok(next.len())
}
