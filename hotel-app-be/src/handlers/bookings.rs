//! Booking handlers
//!
//! Thin HTTP-facing wrappers for booking workflows.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::bookings as booking_service;
use axum::{
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::Json,
};

pub async fn get_booking_timeline_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<Vec<BookingTimelineEntry>>, ApiError> {
    booking_service::get_booking_timeline_handler(State(pool), Extension(user_id), Path(booking_id))
        .await
}

pub async fn checkin_advisory_handler(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
) -> Result<Json<booking_service::CheckInAdvisory>, ApiError> {
    Ok(Json(
        booking_service::checkin_advisory(&pool, booking_id).await?,
    ))
}

pub async fn guest_checkin_advisory_handler(
    State(pool): State<DbPool>,
    guest_id: i64,
) -> Result<Json<booking_service::CheckInAdvisory>, ApiError> {
    Ok(Json(
        booking_service::checkin_advisory_for_guest(&pool, guest_id).await?,
    ))
}

pub async fn get_bookings_handler(
    State(pool): State<DbPool>,
    Query(params): Query<BookingPaginationParams>,
) -> Result<Json<PaginatedResponse<Vec<BookingWithDetails>>>, ApiError> {
    booking_service::get_bookings_handler(State(pool), Query(params)).await
}

pub async fn get_booking_stats_handler(
    State(pool): State<DbPool>,
) -> Result<Json<BookingStats>, ApiError> {
    booking_service::get_booking_stats_handler(State(pool)).await
}

pub async fn get_my_bookings_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<BookingWithDetails>>, ApiError> {
    booking_service::get_my_bookings_handler(State(pool), headers).await
}

pub async fn create_booking_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<BookingInput>,
) -> Result<Json<Booking>, ApiError> {
    booking_service::create_booking_handler(State(pool), Extension(user_id), Json(input)).await
}

pub async fn get_booking_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<BookingWithDetails>, ApiError> {
    booking_service::get_booking_handler(State(pool), Extension(user_id), Path(booking_id)).await
}

pub async fn update_booking_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(input): Json<BookingUpdateInput>,
) -> Result<Json<Booking>, ApiError> {
    booking_service::update_booking_handler(
        State(pool),
        Extension(user_id),
        Path(booking_id),
        Json(input),
    )
    .await
}

pub async fn delete_booking_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        booking_service::void_booking(&pool, user_id, booking_id, None).await?,
    ))
}

pub async fn void_booking_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<BookingCancellationRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        booking_service::void_booking(&pool, user_id, input.booking_id, input.reason).await?,
    ))
}

pub async fn manual_checkin_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(checkin_data): Json<Option<CheckInRequest>>,
) -> Result<Json<Booking>, ApiError> {
    let booking = booking_service::manual_checkin(&pool, user_id, booking_id, checkin_data).await?;
    Ok(Json(booking))
}

pub async fn auto_checkin_eligibility_handler(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
) -> Result<Json<GuestEkycStatusSummary>, ApiError> {
    Ok(Json(
        crate::services::auto_checkin::auto_checkin_eligibility(&pool, booking_id).await?,
    ))
}

pub async fn auto_checkin_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<AutoCheckinResponse>, ApiError> {
    Ok(Json(
        crate::services::auto_checkin::auto_checkin_for_staff(&pool, user_id, booking_id).await?,
    ))
}

pub async fn pre_checkin_update_handler(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
    Json(update_data): Json<PreCheckInUpdateRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    booking_service::pre_checkin_update_handler(State(pool), Path(booking_id), Json(update_data))
        .await
}

pub async fn mark_complimentary_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(input): Json<MarkComplimentaryRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    booking_service::mark_complimentary_handler(
        State(pool),
        Extension(user_id),
        Path(booking_id),
        Json(input),
    )
    .await
}

pub async fn convert_complimentary_to_credits_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    booking_service::convert_complimentary_to_credits_handler(
        State(pool),
        Extension(user_id),
        Path(booking_id),
    )
    .await
}

pub async fn book_with_credits_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<BookWithCreditsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    booking_service::book_with_credits_handler(State(pool), headers, Json(input)).await
}

pub async fn get_complimentary_bookings_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<BookingWithDetails>>, ApiError> {
    booking_service::get_complimentary_bookings_handler(State(pool)).await
}

pub async fn get_complimentary_summary_handler(
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    booking_service::get_complimentary_summary_handler(State(pool)).await
}

pub async fn update_complimentary_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(input): Json<UpdateComplimentaryRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    booking_service::update_complimentary_handler(
        State(pool),
        Extension(user_id),
        Path(booking_id),
        Json(input),
    )
    .await
}

pub async fn remove_complimentary_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    booking_service::remove_complimentary_handler(State(pool), Extension(user_id), Path(booking_id))
        .await
}

pub async fn get_guests_with_credits_handler(
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    booking_service::get_guests_with_credits_handler(State(pool)).await
}

pub async fn add_guest_credits_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<AddGuestCreditsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    booking_service::add_guest_credits_handler(State(pool), Extension(user_id), Json(input)).await
}

pub async fn update_guest_credits_handler(
    State(pool): State<DbPool>,
    Path((guest_id, room_type_id)): Path<(i64, i64)>,
    Json(input): Json<UpdateGuestCreditsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    booking_service::update_guest_credits_handler(
        State(pool),
        Path((guest_id, room_type_id)),
        Json(input),
    )
    .await
}

pub async fn delete_guest_credits_handler(
    State(pool): State<DbPool>,
    Path((guest_id, room_type_id)): Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    booking_service::delete_guest_credits_handler(State(pool), Path((guest_id, room_type_id))).await
}

pub async fn reactivate_booking_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<Booking>, ApiError> {
    Ok(Json(
        booking_service::reactivate_booking(&pool, user_id, booking_id).await?,
    ))
}
