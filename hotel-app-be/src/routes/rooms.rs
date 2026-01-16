//! Room routes
//!
//! Routes for room CRUD, status management, and events.

use axum::{
    routing::{get, post, patch, put, delete},
    Router,
    extract::{State, Path, Query},
    http::HeaderMap,
    response::Json,
};
use crate::core::db::DbPool;
use crate::handlers;
use crate::models;
use crate::core::middleware::require_permission_helper;
use crate::core::error::ApiError;

/// Create room routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        // Basic CRUD
        .route("/rooms", get(get_rooms))
        .route("/rooms", post(create_room))
        .route("/rooms/available", get(search_rooms))
        .route("/rooms/:id", patch(update_room))
        .route("/rooms/:id", delete(delete_room_handler))
        // Room types CRUD
        .route("/room-types", get(get_room_types))
        .route("/room-types/all", get(get_all_room_types))
        .route("/room-types", post(create_room_type))
        .route("/room-types/:id", get(get_room_type))
        .route("/room-types/:id", patch(update_room_type))
        .route("/room-types/:id", delete(delete_room_type))
        .route("/rooms/:room_type/reviews", get(get_room_reviews))
        // Status and events
        .route("/rooms/:id/status", put(update_room_status))
        .route("/rooms/:id/events", post(create_room_event))
        .route("/rooms/:id/detailed", get(get_room_detailed))
        .route("/rooms/:id/history", get(get_room_history))
        .route("/rooms/:id/end-maintenance", post(end_maintenance))
        .route("/rooms/:id/end-cleaning", post(end_cleaning))
        .route("/rooms/sync-statuses", post(sync_room_statuses))
        .route("/rooms/:id/execute-change", post(execute_room_change))
        .route("/rooms/change-history", get(get_room_change_history))
        // Occupancy endpoints (automatic - derived from bookings)
        .route("/rooms/occupancy", get(get_all_room_occupancy))
        .route("/rooms/occupancy/summary", get(get_hotel_occupancy_summary))
        .route("/rooms/occupancy/by-type", get(get_occupancy_by_room_type))
        .route("/rooms/with-occupancy", get(get_rooms_with_occupancy))
        .route("/rooms/:id/occupancy", get(get_room_occupancy))
}

async fn get_rooms(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::RoomWithRating>>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;
    handlers::rooms::get_rooms_handler(State(pool)).await
}

async fn search_rooms(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::SearchQuery>,
) -> Result<Json<Vec<models::RoomWithRating>>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;
    handlers::rooms::search_rooms_handler(State(pool), query).await
}

async fn create_room(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::RoomCreateInput>,
) -> Result<Json<models::Room>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:write").await?;
    handlers::rooms::create_room_handler(State(pool), Json(input)).await
}

async fn update_room(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::RoomUpdateInput>,
) -> Result<Json<models::Room>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:update").await?;
    handlers::rooms::update_room_handler(State(pool), path, Json(input)).await
}

async fn delete_room_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:write").await?;
    handlers::rooms::delete_room_handler(State(pool), path).await
}

async fn get_room_types(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::RoomType>>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;
    handlers::rooms::get_room_types_handler(State(pool)).await
}

async fn get_all_room_types(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::RoomType>>, ApiError> {
    handlers::rooms::get_all_room_types_handler(State(pool), headers).await
}

async fn get_room_type(
    State(pool): State<DbPool>,
    path: Path<i64>,
    headers: HeaderMap,
) -> Result<Json<models::RoomType>, ApiError> {
    handlers::rooms::get_room_type_handler(State(pool), path, headers).await
}

async fn create_room_type(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::RoomTypeCreateInput>,
) -> Result<Json<models::RoomType>, ApiError> {
    handlers::rooms::create_room_type_handler(State(pool), headers, Json(input)).await
}

async fn update_room_type(
    State(pool): State<DbPool>,
    path: Path<i64>,
    headers: HeaderMap,
    Json(input): Json<models::RoomTypeUpdateInput>,
) -> Result<Json<models::RoomType>, ApiError> {
    handlers::rooms::update_room_type_handler(State(pool), path, headers, Json(input)).await
}

async fn delete_room_type(
    State(pool): State<DbPool>,
    path: Path<i64>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::rooms::delete_room_type_handler(State(pool), path, headers).await
}

async fn get_room_reviews(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<String>,
) -> Result<Json<Vec<models::GuestReview>>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;
    handlers::rooms::get_room_reviews_handler(State(pool), path).await
}

async fn update_room_status(
    State(pool): State<DbPool>,
    path: Path<i64>,
    headers: HeaderMap,
    Json(input): Json<models::RoomStatusUpdateInput>,
) -> Result<Json<models::Room>, ApiError> {
    handlers::rooms::update_room_status_handler(State(pool), path, headers, Json(input)).await
}

async fn create_room_event(
    State(pool): State<DbPool>,
    path: Path<i64>,
    headers: HeaderMap,
    Json(input): Json<models::RoomEventInput>,
) -> Result<Json<models::RoomEvent>, ApiError> {
    handlers::rooms::create_room_event_handler(State(pool), path, headers, Json(input)).await
}

async fn get_room_detailed(
    State(pool): State<DbPool>,
    path: Path<i64>,
    headers: HeaderMap,
) -> Result<Json<models::RoomDetailedStatus>, ApiError> {
    handlers::rooms::get_room_detailed_status_handler(State(pool), path, headers).await
}

async fn get_room_history(
    State(pool): State<DbPool>,
    path: Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    handlers::rooms::get_room_history_handler(State(pool), path, headers).await
}

async fn end_maintenance(
    State(pool): State<DbPool>,
    path: Path<i64>,
    headers: HeaderMap,
) -> Result<Json<models::Room>, ApiError> {
    handlers::rooms::end_maintenance_handler(State(pool), path, headers).await
}

async fn end_cleaning(
    State(pool): State<DbPool>,
    path: Path<i64>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::rooms::end_cleaning_handler(State(pool), path, headers).await
}

async fn sync_room_statuses(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::rooms::sync_room_statuses_handler(State(pool), headers).await
}

async fn execute_room_change(
    State(pool): State<DbPool>,
    path: Path<i64>,
    headers: HeaderMap,
    Json(input): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    handlers::rooms::execute_room_change_handler(State(pool), path, headers, Json(input)).await
}

async fn get_room_change_history(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    handlers::rooms::get_room_change_history_handler(State(pool), headers, query).await
}

// ==================== OCCUPANCY ROUTES ====================
// Automatic occupancy derived from bookings - no manual input

async fn get_all_room_occupancy(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::RoomCurrentOccupancy>>, ApiError> {
    handlers::rooms::get_all_room_occupancy_handler(State(pool), headers).await
}

async fn get_room_occupancy(
    State(pool): State<DbPool>,
    path: Path<i64>,
    headers: HeaderMap,
) -> Result<Json<models::RoomCurrentOccupancy>, ApiError> {
    handlers::rooms::get_room_occupancy_handler(State(pool), path, headers).await
}

async fn get_hotel_occupancy_summary(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::HotelOccupancySummary>, ApiError> {
    handlers::rooms::get_hotel_occupancy_summary_handler(State(pool), headers).await
}

async fn get_occupancy_by_room_type(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::OccupancyByRoomType>>, ApiError> {
    handlers::rooms::get_occupancy_by_room_type_handler(State(pool), headers).await
}

async fn get_rooms_with_occupancy(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<models::RoomWithOccupancy>>, ApiError> {
    handlers::rooms::get_rooms_with_occupancy_handler(State(pool), headers).await
}
