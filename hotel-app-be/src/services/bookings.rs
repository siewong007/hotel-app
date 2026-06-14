//! Booking service compatibility layer.

pub use crate::repositories::bookings::*;

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::Booking;
use crate::repositories::bookings as booking_repo;
use crate::services::audit::AuditLog;
use crate::services::booking as booking_service;
use crate::services::payments;

pub async fn void_booking(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
    reason: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let booking = booking_service::fetch_booking_by_id(pool, booking_id).await?;

    let has_booking_void_permission =
        AuthService::check_permission(pool, user_id, "bookings:update")
            .await
            .unwrap_or(false)
            || AuthService::check_permission(pool, user_id, "bookings:delete")
                .await
                .unwrap_or(false)
            || AuthService::check_permission(pool, user_id, "bookings:manage")
                .await
                .unwrap_or(false);
    let owns_booking = if has_booking_void_permission {
        true
    } else {
        booking_repo::user_owns_booking(pool, user_id, booking.guest_id).await?
    };

    if !owns_booking {
        return Err(ApiError::Forbidden(
            "You don't have permission to void this booking".to_string(),
        ));
    }

    if booking.status == "voided" {
        return Err(ApiError::BadRequest(
            "Booking is already voided".to_string(),
        ));
    }

    if matches!(booking.status.as_str(), "checked_out" | "completed") {
        return Err(ApiError::BadRequest(format!(
            "Cannot void booking with status: {}",
            booking.status
        )));
    }

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let nights_credited =
        booking_repo::void_booking_and_release_room_tx(&mut tx, &booking, user_id).await?;
    payments::recompute_payment_status_tx(&mut tx, booking_id).await?;

    let change_reason = reason.as_deref().unwrap_or("Booking voided");
    booking_repo::record_booking_history_tx(
        &mut tx,
        booking_id,
        Some(&booking.status),
        "voided",
        Some(user_id),
        Some(change_reason),
        serde_json::json!({
            "room_id": booking.room_id,
            "guest_id": booking.guest_id,
            "check_in_date": booking.check_in_date.to_string(),
            "check_out_date": booking.check_out_date.to_string(),
        }),
    )
    .await?;

    booking_repo::record_booking_void_modification_tx(&mut tx, &booking, user_id).await?;
    AuditLog::log_booking_cancelled_tx(&mut tx, user_id, booking_id).await?;

    tx.commit().await.map_err(ApiError::from)?;

    Ok(serde_json::json!({
        "message": "Booking voided successfully",
        "booking_id": booking_id,
        "complimentary_nights_credited": nights_credited
    }))
}

/// Reactivate a voided booking, preserving the booking state-transition rules
/// while keeping SQL details in the booking repository.
pub async fn reactivate_booking(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
) -> Result<Booking, ApiError> {
    let existing = booking_repo::find_reactivation_candidate(pool, booking_id).await?;

    if existing.status != "voided" {
        return Err(ApiError::BadRequest(format!(
            "Cannot reactivate booking with status: {}. Only voided bookings can be reactivated.",
            existing.status
        )));
    }

    let has_booking_update = AuthService::check_permission(pool, user_id, "bookings:update")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(pool, user_id, "bookings:manage")
            .await
            .unwrap_or(false);

    if !has_booking_update {
        return Err(ApiError::Forbidden(
            "You don't have permission to reactivate this booking".to_string(),
        ));
    }

    let conflict = booking_repo::has_reactivation_conflict(
        pool,
        booking_id,
        existing.room_id,
        existing.check_in,
        existing.check_out,
    )
    .await?;

    if conflict {
        return Err(ApiError::BadRequest(
            "Cannot reactivate booking - room is already booked for these dates".to_string(),
        ));
    }

    let booking = booking_repo::confirm_reactivated_booking_and_reserve_room(
        pool,
        booking_id,
        existing.room_id,
    )
    .await?;

    let _ = AuditLog::log_event(
        pool,
        Some(user_id),
        "booking_reactivated",
        "booking",
        Some(booking_id),
        Some(serde_json::json!({
            "guest_id": existing.guest_id,
            "room_id": existing.room_id,
            "previous_status": "voided"
        })),
        None,
        None,
    )
    .await;

    booking_repo::record_booking_history(
        pool,
        booking_id,
        Some("voided"),
        "confirmed",
        Some(user_id),
        Some("Booking reactivated"),
        serde_json::json!({
            "guest_id": existing.guest_id,
            "room_id": existing.room_id,
            "check_in_date": existing.check_in.to_string(),
            "check_out_date": existing.check_out.to_string(),
        }),
    )
    .await;

    let _ = booking_repo::record_booking_reactivation_modification(pool, booking_id, user_id).await;

    Ok(booking)
}
