//! Team routes.
//!
//! Gates live here, one line per route, so the route → permission map stays
//! readable and machine-diffable next to the route table itself.
//!
//! The two membership routes are the exception and say so: their gate is
//! team-scoped (`teams:assign` **or** lead of this specific team), which a
//! static route-level check cannot express, so they require authentication
//! here and the service makes the decision.

use super::handlers;
use super::models;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{require_auth, require_permission_helper};
use axum::{
    Router,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Json,
    routing::{delete, get, patch, post, put},
};

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/teams", get(list_teams))
        .route("/teams", post(create_team))
        .route("/teams/{team_id}", get(get_team))
        .route("/teams/{team_id}", patch(update_team))
        .route("/teams/{team_id}", delete(delete_team))
        .route("/teams/{team_id}/members", post(add_member))
        .route(
            "/teams/{team_id}/members/{member_user_id}",
            delete(remove_member),
        )
        .route("/teams/{team_id}/roles", put(replace_team_roles))
}

async fn list_teams(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<handlers::ListTeamsQuery>,
) -> Result<Json<Vec<models::TeamSummary>>, ApiError> {
    require_permission_helper(&pool, &headers, "teams:read").await?;
    handlers::list_teams_handler(State(pool), query).await
}

async fn get_team(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::TeamDetail>, ApiError> {
    require_permission_helper(&pool, &headers, "teams:read").await?;
    handlers::get_team_handler(State(pool), path).await
}

async fn create_team(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::TeamCreateInput>,
) -> Result<Json<models::Team>, ApiError> {
    let actor_user_id = require_permission_helper(&pool, &headers, "teams:create").await?;
    handlers::create_team_handler(State(pool), actor_user_id, Json(input)).await
}

async fn update_team(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::TeamUpdateInput>,
) -> Result<Json<models::Team>, ApiError> {
    let actor_user_id = require_permission_helper(&pool, &headers, "teams:update").await?;
    handlers::update_team_handler(State(pool), path, actor_user_id, Json(input)).await
}

async fn delete_team(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id = require_permission_helper(&pool, &headers, "teams:delete").await?;
    handlers::delete_team_handler(State(pool), path, actor_user_id).await
}

/// Team-scoped gate — see the module docs. `require_auth` only; the service
/// applies `teams:assign`-or-lead and the role-escalation guard.
async fn add_member(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::TeamMemberInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id = require_auth(&headers).await?;
    handlers::add_member_handler(State(pool), path, actor_user_id, Json(input)).await
}

/// Team-scoped gate — see `add_member`.
async fn remove_member(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id = require_auth(&headers).await?;
    handlers::remove_member_handler(State(pool), path, actor_user_id).await
}

async fn replace_team_roles(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::TeamRoleIdsInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let actor_user_id = require_permission_helper(&pool, &headers, "teams:manage").await?;
    handlers::replace_team_roles_handler(State(pool), path, actor_user_id, Json(input)).await
}
