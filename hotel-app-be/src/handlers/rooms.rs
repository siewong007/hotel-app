//! Room handlers
//!
//! Thin HTTP-facing wrappers for room workflows.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::rooms as room_service;
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Json,
};

pub async fn get_rooms_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<RoomWithRating>>, ApiError> {
    room_service::get_rooms_handler(State(pool)).await
}

pub async fn search_rooms_handler(
    State(pool): State<DbPool>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<RoomWithRating>>, ApiError> {
    room_service::search_rooms_handler(State(pool), Query(query)).await
}

pub async fn update_room_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    Json(input): Json<RoomUpdateInput>,
) -> Result<Json<Room>, ApiError> {
    room_service::update_room_handler(State(pool), Path(room_id), Json(input)).await
}

pub async fn create_room_handler(
    State(pool): State<DbPool>,
    Json(input): Json<RoomCreateInput>,
) -> Result<Json<Room>, ApiError> {
    room_service::create_room_handler(State(pool), Json(input)).await
}

pub async fn delete_room_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    room_service::delete_room_handler(State(pool), Path(room_id)).await
}

pub async fn get_room_types_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<RoomType>>, ApiError> {
    room_service::get_room_types_handler(State(pool)).await
}

pub async fn get_all_room_types_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<RoomType>>, ApiError> {
    room_service::get_all_room_types_handler(State(pool), headers).await
}

pub async fn get_room_type_handler(
    State(pool): State<DbPool>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<RoomType>, ApiError> {
    room_service::get_room_type_handler(State(pool), Path(id), headers).await
}

pub async fn create_room_type_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<RoomTypeCreateInput>,
) -> Result<Json<RoomType>, ApiError> {
    room_service::create_room_type_handler(State(pool), headers, Json(input)).await
}

pub async fn update_room_type_handler(
    State(pool): State<DbPool>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<RoomTypeUpdateInput>,
) -> Result<Json<RoomType>, ApiError> {
    room_service::update_room_type_handler(State(pool), Path(id), headers, Json(input)).await
}

pub async fn delete_room_type_handler(
    State(pool): State<DbPool>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    room_service::delete_room_type_handler(State(pool), Path(id), headers).await
}

pub async fn update_room_status_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<RoomStatusUpdateInput>,
) -> Result<Json<Room>, ApiError> {
    room_service::update_room_status_handler(State(pool), Path(room_id), headers, Json(input)).await
}

pub async fn end_maintenance_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Room>, ApiError> {
    room_service::end_maintenance_handler(State(pool), Path(room_id), headers).await
}

pub async fn end_cleaning_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    room_service::end_cleaning_handler(State(pool), Path(room_id), headers).await
}

pub async fn sync_room_statuses_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    room_service::sync_room_statuses_handler(State(pool), headers).await
}

pub async fn execute_room_change_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    room_service::execute_room_change_handler(State(pool), Path(room_id), headers, Json(input))
        .await
}

pub async fn get_room_change_history_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    room_service::get_room_change_history_handler(State(pool), headers, Query(params)).await
}

pub async fn create_room_event_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<RoomEventInput>,
) -> Result<Json<RoomEvent>, ApiError> {
    room_service::create_room_event_handler(State(pool), Path(room_id), headers, Json(input)).await
}

pub async fn get_room_detailed_status_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<RoomDetailedStatus>, ApiError> {
    room_service::get_room_detailed_status_handler(State(pool), Path(room_id), headers).await
}

pub async fn get_room_history_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    room_service::get_room_history_handler(State(pool), Path(room_id), headers).await
}

pub async fn get_room_reviews_handler(
    State(pool): State<DbPool>,
    Path(room_type): Path<String>,
) -> Result<Json<Vec<GuestReview>>, ApiError> {
    room_service::get_room_reviews_handler(State(pool), Path(room_type)).await
}

pub async fn get_all_room_occupancy_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<RoomCurrentOccupancy>>, ApiError> {
    room_service::get_all_room_occupancy_handler(State(pool), headers).await
}

pub async fn get_room_occupancy_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<RoomCurrentOccupancy>, ApiError> {
    room_service::get_room_occupancy_handler(State(pool), Path(room_id), headers).await
}

pub async fn get_hotel_occupancy_summary_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<HotelOccupancySummary>, ApiError> {
    room_service::get_hotel_occupancy_summary_handler(State(pool), headers).await
}

pub async fn get_occupancy_by_room_type_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<OccupancyByRoomType>>, ApiError> {
    room_service::get_occupancy_by_room_type_handler(State(pool), headers).await
}

pub async fn get_rooms_with_occupancy_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<RoomWithOccupancy>>, ApiError> {
    room_service::get_rooms_with_occupancy_handler(State(pool), headers).await
}
