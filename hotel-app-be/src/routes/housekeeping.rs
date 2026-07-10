//! Housekeeping routes

use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    routing::{get, patch, post},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::handlers::housekeeping;
use crate::models::{
    CreateHousekeepingTaskRequest, HousekeepingBoardResponse, HousekeepingTask,
    HousekeepingTaskListResponse, ListHousekeepingTasksQuery, UpdateHousekeepingTaskRequest,
};

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/housekeeping/tasks", get(list_tasks))
        .route("/housekeeping/tasks", post(create_task))
        .route("/housekeeping/tasks/{id}", patch(update_task))
        .route("/housekeeping/board", get(board))
}

async fn list_tasks(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<ListHousekeepingTasksQuery>,
) -> Result<Json<HousekeepingTaskListResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "housekeeping:read").await?;
    housekeeping::list_tasks_handler(State(pool), query).await
}

async fn create_task(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<CreateHousekeepingTaskRequest>,
) -> Result<Json<HousekeepingTask>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "housekeeping:create").await?;
    housekeeping::create_task_handler(State(pool), Extension(user_id), Json(input)).await
}

async fn update_task(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(task_id): Path<i64>,
    Json(input): Json<UpdateHousekeepingTaskRequest>,
) -> Result<Json<HousekeepingTask>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "housekeeping:update").await?;
    housekeeping::update_task_handler(State(pool), Extension(user_id), Path(task_id), Json(input))
        .await
}

async fn board(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<HousekeepingBoardResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "housekeeping:read").await?;
    housekeeping::board_handler(State(pool)).await
}
