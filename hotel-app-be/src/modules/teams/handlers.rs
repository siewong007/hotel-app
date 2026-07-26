//! Team handlers: one service call each, no SQL and no authorization logic.

use super::models::*;
use super::service;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use axum::{
    extract::{Path, Query, State},
    response::Json,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct ListTeamsQuery {
    #[serde(default)]
    pub include_inactive: bool,
}

pub async fn list_teams_handler(
    State(pool): State<DbPool>,
    Query(query): Query<ListTeamsQuery>,
) -> Result<Json<Vec<TeamSummary>>, ApiError> {
    Ok(Json(
        service::list_teams(&pool, query.include_inactive).await?,
    ))
}

pub async fn get_team_handler(
    State(pool): State<DbPool>,
    Path(team_id): Path<i64>,
) -> Result<Json<TeamDetail>, ApiError> {
    Ok(Json(service::get_team(&pool, team_id).await?))
}

pub async fn create_team_handler(
    State(pool): State<DbPool>,
    actor_user_id: i64,
    Json(input): Json<TeamCreateInput>,
) -> Result<Json<Team>, ApiError> {
    Ok(Json(
        service::create_team(&pool, actor_user_id, input).await?,
    ))
}

pub async fn update_team_handler(
    State(pool): State<DbPool>,
    Path(team_id): Path<i64>,
    actor_user_id: i64,
    Json(input): Json<TeamUpdateInput>,
) -> Result<Json<Team>, ApiError> {
    Ok(Json(
        service::update_team(&pool, actor_user_id, team_id, input).await?,
    ))
}

pub async fn delete_team_handler(
    State(pool): State<DbPool>,
    Path(team_id): Path<i64>,
    actor_user_id: i64,
) -> Result<Json<serde_json::Value>, ApiError> {
    service::delete_team(&pool, actor_user_id, team_id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn add_member_handler(
    State(pool): State<DbPool>,
    Path(team_id): Path<i64>,
    actor_user_id: i64,
    Json(input): Json<TeamMemberInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    service::add_member(&pool, actor_user_id, team_id, input).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn remove_member_handler(
    State(pool): State<DbPool>,
    Path((team_id, member_user_id)): Path<(i64, i64)>,
    actor_user_id: i64,
) -> Result<Json<serde_json::Value>, ApiError> {
    service::remove_member(&pool, actor_user_id, team_id, member_user_id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn replace_team_roles_handler(
    State(pool): State<DbPool>,
    Path(team_id): Path<i64>,
    actor_user_id: i64,
    Json(input): Json<TeamRoleIdsInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let count = service::replace_team_roles(&pool, actor_user_id, team_id, input).await?;
    Ok(Json(serde_json::json!({ "success": true, "role_count": count })))
}
