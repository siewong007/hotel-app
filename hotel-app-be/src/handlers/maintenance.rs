//! Maintenance ticket HTTP handlers

use axum::{
    Json,
    extract::{Extension, Path, Query, State},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    CreateMaintenanceTicketRequest, ListMaintenanceTicketsQuery, MaintenanceTicket,
    MaintenanceTicketListResponse, UpdateMaintenanceTicketRequest,
};
use crate::services::maintenance;

pub async fn list_tickets_handler(
    State(pool): State<DbPool>,
    Query(params): Query<ListMaintenanceTicketsQuery>,
) -> Result<Json<MaintenanceTicketListResponse>, ApiError> {
    Ok(Json(maintenance::list_tickets(&pool, params).await?))
}

pub async fn get_ticket_handler(
    State(pool): State<DbPool>,
    Path(ticket_id): Path<i64>,
) -> Result<Json<MaintenanceTicket>, ApiError> {
    Ok(Json(maintenance::get_ticket(&pool, ticket_id).await?))
}

pub async fn create_ticket_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<CreateMaintenanceTicketRequest>,
) -> Result<Json<MaintenanceTicket>, ApiError> {
    Ok(Json(
        maintenance::create_ticket(&pool, user_id, input).await?,
    ))
}

pub async fn update_ticket_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(ticket_id): Path<i64>,
    Json(input): Json<UpdateMaintenanceTicketRequest>,
) -> Result<Json<MaintenanceTicket>, ApiError> {
    Ok(Json(
        maintenance::update_ticket(&pool, user_id, ticket_id, input).await?,
    ))
}
