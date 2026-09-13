//! Housekeeping routes

use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    middleware,
    routing::{get, patch, post},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::{require_any_permission_helper, require_permission_helper};
use crate::handlers::housekeeping;
use crate::models::{
    AssignableStaffMember, AssignableStaffQuery, CreateHousekeepingTaskRequest,
    HousekeepingBoardResponse, HousekeepingTask, HousekeepingTaskListResponse,
    ListHousekeepingTasksQuery, UpdateHousekeepingTaskRequest,
};

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/housekeeping/tasks", get(list_tasks))
        .route("/housekeeping/tasks", post(create_task))
        .route("/housekeeping/tasks/{id}", patch(update_task))
        .route("/housekeeping/board", get(board))
        .route("/housekeeping/assignable-staff", get(assignable_staff))
        // Task completion can flip a room to available — let availability
        // subscribers see the inventory change like any /rooms mutation.
        .route_layer(middleware::from_fn(super::rooms::publish_inventory_changes))
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

/// Gated on the write permissions the assignment actions require, so read-only
/// viewers cannot enumerate staff accounts. `maintenance:write` is included
/// because the maintenance scope serves that domain's pickers too.
async fn assignable_staff(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<AssignableStaffQuery>,
) -> Result<Json<Vec<AssignableStaffMember>>, ApiError> {
    require_any_permission_helper(
        &pool,
        &headers,
        &[
            "housekeeping:update",
            "housekeeping:manage",
            "maintenance:write",
            "maintenance:manage",
        ],
    )
    .await?;
    housekeeping::assignable_staff_handler(State(pool), query).await
}
