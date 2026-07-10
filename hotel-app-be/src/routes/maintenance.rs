//! Maintenance ticket routes

use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    routing::{get, patch, post},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::handlers::maintenance;
use crate::models::{
    CreateMaintenanceTicketRequest, ListMaintenanceTicketsQuery, MaintenanceTicket,
    MaintenanceTicketListResponse, UpdateMaintenanceTicketRequest,
};

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/maintenance", get(list_tickets))
        .route("/maintenance", post(create_ticket))
        .route("/maintenance/{id}", get(get_ticket))
        .route("/maintenance/{id}", patch(update_ticket))
}

async fn list_tickets(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<ListMaintenanceTicketsQuery>,
) -> Result<Json<MaintenanceTicketListResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "maintenance:read").await?;
    maintenance::list_tickets_handler(State(pool), query).await
}

async fn get_ticket(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ticket_id): Path<i64>,
) -> Result<Json<MaintenanceTicket>, ApiError> {
    require_permission_helper(&pool, &headers, "maintenance:read").await?;
    maintenance::get_ticket_handler(State(pool), Path(ticket_id)).await
}

async fn create_ticket(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<CreateMaintenanceTicketRequest>,
) -> Result<Json<MaintenanceTicket>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "maintenance:write").await?;
    maintenance::create_ticket_handler(State(pool), Extension(user_id), Json(input)).await
}

async fn update_ticket(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(ticket_id): Path<i64>,
    Json(input): Json<UpdateMaintenanceTicketRequest>,
) -> Result<Json<MaintenanceTicket>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "maintenance:write").await?;
    maintenance::update_ticket_handler(
        State(pool),
        Extension(user_id),
        Path(ticket_id),
        Json(input),
    )
    .await
}
