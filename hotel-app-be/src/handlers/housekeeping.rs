//! Housekeeping HTTP handlers

use axum::{
    Json,
    extract::{Extension, Path, Query, State},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    CreateHousekeepingTaskRequest, HousekeepingBoardResponse, HousekeepingTask,
    HousekeepingTaskListResponse, ListHousekeepingTasksQuery, UpdateHousekeepingTaskRequest,
};
use crate::services::housekeeping;

pub async fn list_tasks_handler(
    State(pool): State<DbPool>,
    Query(params): Query<ListHousekeepingTasksQuery>,
) -> Result<Json<HousekeepingTaskListResponse>, ApiError> {
    Ok(Json(housekeeping::list_tasks(&pool, params).await?))
}

pub async fn create_task_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<CreateHousekeepingTaskRequest>,
) -> Result<Json<HousekeepingTask>, ApiError> {
    Ok(Json(
        housekeeping::create_task(&pool, user_id, input).await?,
    ))
}

pub async fn update_task_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(task_id): Path<i64>,
    Json(input): Json<UpdateHousekeepingTaskRequest>,
) -> Result<Json<HousekeepingTask>, ApiError> {
    Ok(Json(
        housekeeping::update_task(&pool, user_id, task_id, input).await?,
    ))
}

pub async fn board_handler(
    State(pool): State<DbPool>,
) -> Result<Json<HousekeepingBoardResponse>, ApiError> {
    Ok(Json(housekeeping::board(&pool).await?))
}
