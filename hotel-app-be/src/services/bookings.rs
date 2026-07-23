//! Booking service compatibility layer.

pub use crate::repositories::bookings::*;

use chrono::{DateTime, Utc};

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{Booking, CheckInRequest};
use crate::repositories::bookings as booking_repo;
use crate::services::audit::AuditLog;
use crate::services::booking as booking_service;
use crate::services::payments;

#[derive(Debug, Clone)]
pub struct SelfCheckinEventInsert {
    pub guest_id: i64,
    pub ekyc_verification_id: i64,
    pub source: &'static str,
    pub device_type: Option<String>,
    pub checkin_location: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CheckinSourceContext {
    pub source: &'static str,
    pub history_reason: &'static str,
    pub self_checkin_event: Option<SelfCheckinEventInsert>,
}

/// Allow complimentary-credit bookings for either a user linked to the guest
/// or staff who can both create bookings and read guest records.
pub async fn can_book_with_credits_for_guest(
    pool: &DbPool,
    user_id: i64,
    guest_id: i64,
) -> Result<bool, ApiError> {
    if booking_repo::user_owns_booking(pool, user_id, guest_id).await? {
        return Ok(true);
    }

    let can_create_bookings = AuthService::check_permission(pool, user_id, "bookings:create")
        .await
        .map_err(ApiError::from)?;
    if !can_create_bookings {
        return Ok(false);
    }

    AuthService::check_permission(pool, user_id, "guests:read")
        .await
        .map_err(ApiError::from)
}

impl CheckinSourceContext {
    fn manual() -> Self {
        Self {
            source: "manual_checkin",
            history_reason: "Guest checked in",
            self_checkin_event: None,
        }
    }
}

/// Whether a booking originated from an online reservation channel.
///
/// `source` is the canonical channel marker (`walk_in`, `online`, `phone`,
/// `agent`); OTA imports set it to `online`. Matched case-insensitively and
/// trimmed to be robust to imported casing/whitespace.
fn is_online_source(source: Option<&str>) -> bool {
    source.is_some_and(|s| s.trim().eq_ignore_ascii_case("online"))
}

/// A guest may cancel an upcoming reservation. Payment completion must not
/// remove this self-service option; non-refundable voucher terms are enforced
/// by the guest-portal service before this workflow is reached.
fn is_guest_cancellable_booking(status: &str) -> bool {
    matches!(
        status,
        "pending" | "pending_payment" | "pending_confirmation" | "confirmed"
    )
}

/// Cancel an eligible booking belonging to the authenticated guest.
pub async fn cancel_pending_booking_by_guest(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
    reason: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let booking = booking_service::fetch_booking_by_id(pool, booking_id).await?;
    if !booking_repo::user_owns_booking(pool, user_id, booking.guest_id).await? {
        return Err(ApiError::Forbidden(
            "You don't have permission to cancel this booking".to_string(),
        ));
    }
    if !is_guest_cancellable_booking(&booking.status) {
        return Err(ApiError::BadRequest(
            "Only upcoming bookings can be cancelled online.".to_string(),
        ));
    }

    let affected_night_audit_dates =
        booking_repo::booking_night_audit_dates(pool, booking_id).await?;
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    booking_repo::void_booking_tx(&mut tx, booking_id, user_id).await?;
    booking_repo::release_room_tx(&mut tx, booking.room_id).await?;
    booking_repo::void_uncompleted_booking_payments_tx(&mut tx, booking_id).await?;
    payments::recompute_payment_status_tx(&mut tx, booking_id).await?;

    let change_reason = reason.as_deref().unwrap_or("Booking cancelled by guest");
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
    AuditLog::log_booking_voided_tx(&mut tx, user_id, booking_id).await?;
    tx.commit().await.map_err(ApiError::from)?;

    Ok(serde_json::json!({
        "message": "Booking cancelled successfully",
        "booking_id": booking_id,
        "affected_night_audit_dates": affected_night_audit_dates,
        "night_audit_rerun_required": !affected_night_audit_dates.is_empty()
    }))
}

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

    let affected_night_audit_dates =
        booking_repo::booking_night_audit_dates(pool, booking_id).await?;

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    booking_repo::void_booking_tx(&mut tx, booking_id, user_id).await?;
    booking_repo::release_room_tx(&mut tx, booking.room_id).await?;
    booking_repo::void_booking_payments_tx(&mut tx, booking_id).await?;
    let nights_credited = booking_repo::restore_complimentary_credits_tx(&mut tx, &booking).await?;
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
    AuditLog::log_booking_voided_tx(&mut tx, user_id, booking_id).await?;

    tx.commit().await.map_err(ApiError::from)?;

    if let Err(err) = crate::modules::loyalty::service::reverse_booking_points(
        pool,
        booking_id,
        Some(user_id),
        "Booking voided",
    )
    .await
    {
        log::warn!(
            "Failed to reverse loyalty points for voided booking {}: {}",
            booking_id,
            err
        );
    }

    Ok(serde_json::json!({
        "message": "Booking voided successfully",
        "booking_id": booking_id,
        "complimentary_nights_credited": nights_credited,
        "affected_night_audit_dates": affected_night_audit_dates,
        "night_audit_rerun_required": !affected_night_audit_dates.is_empty()
    }))
}

/// Manually check a guest into their room.
///
/// The service owns the policy decisions — authorization, state validation,
/// room readiness, and which writes must happen — while the booking repository
/// executes the individual writes. Every mutation runs on a single transaction
/// so the booking transition, optional guest/booking edits, optional payment,
/// room status change, history, audit, and modification trail all commit
/// atomically (mirrors `void_booking`). The core transition is guarded by an
/// atomic `status IN ('confirmed','pending')` update requiring exactly one
/// affected row, so concurrent check-ins cannot both succeed.
pub async fn manual_checkin(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
    checkin_data: Option<CheckInRequest>,
) -> Result<Booking, ApiError> {
    let booking = booking_service::fetch_booking_by_id(pool, booking_id).await?;

    // Authorization: callers with booking update/manage rights, or the user who
    // created the booking, may check it in.
    let has_checkin_permission = AuthService::check_permission(pool, user_id, "bookings:update")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(pool, user_id, "bookings:manage")
            .await
            .unwrap_or(false);
    let created_booking = booking.created_by == Some(user_id);

    if !has_checkin_permission && !created_booking {
        // Authenticated but lacking the role/ownership to act → 403 (matches the
        // void workflow). 401 is reserved for unauthenticated/invalid-credential
        // cases, which the auth middleware rejects before reaching this service.
        return Err(ApiError::Forbidden(
            "You don't have permission to check in this booking".to_string(),
        ));
    }

    let (booking, _) = checkin_booking_flow_for_booking(
        pool,
        user_id,
        booking,
        checkin_data,
        CheckinSourceContext::manual(),
    )
    .await?;

    Ok(booking)
}

pub async fn checkin_booking_flow(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
    checkin_data: Option<CheckInRequest>,
    context: CheckinSourceContext,
) -> Result<(Booking, Option<DateTime<Utc>>), ApiError> {
    let booking = booking_service::fetch_booking_by_id(pool, booking_id).await?;
    checkin_booking_flow_for_booking(pool, user_id, booking, checkin_data, context).await
}

async fn checkin_booking_flow_for_booking(
    pool: &DbPool,
    user_id: i64,
    booking: Booking,
    checkin_data: Option<CheckInRequest>,
    context: CheckinSourceContext,
) -> Result<(Booking, Option<DateTime<Utc>>), ApiError> {
    let booking_id = booking.id;

    // State validation: only `confirmed` bookings can be checked in. A guest
    // self-service booking starts `pending` and only becomes `confirmed` once
    // its payment is approved/captured, so a `pending` booking is blocked with
    // an explicit "payment required" reason (covers both the staff and
    // auto-checkin paths, which both funnel through here).
    if booking.status == "pending" {
        return Err(ApiError::BadRequest(
            "Payment required before check-in.".to_string(),
        ));
    }
    if booking.status != "confirmed" {
        return Err(ApiError::BadRequest(format!(
            "Cannot check in booking with status: {}",
            booking.status
        )));
    }

    let mut tx = pool.begin().await.map_err(ApiError::from)?;

    // Room readiness: a reservation can be made on a dirty room, but the room
    // must be cleaned before anyone can check in.
    if let Some(room_status) = booking_repo::fetch_room_status_tx(&mut tx, booking.room_id).await?
        && matches!(
            room_status.as_str(),
            "maintenance" | "out_of_order" | "dirty" | "cleaning" | "reserved_dirty"
        )
    {
        let reason = if matches!(
            room_status.as_str(),
            "dirty" | "cleaning" | "reserved_dirty"
        ) {
            "the room must be cleaned before check-in".to_string()
        } else {
            format!("room is currently under {}", room_status.replace('_', " "))
        };
        return Err(ApiError::BadRequest(format!(
            "Cannot check in - {}.",
            reason
        )));
    }

    // Identity document is optional at booking creation but required at arrival:
    // refuse to complete check-in unless an IC / passport ends up on file. An
    // explicit value in the check-in patch wins (including an empty one, which
    // clears the field); otherwise the guest's stored value must be non-empty.
    let ic_in_patch = checkin_data
        .as_ref()
        .and_then(|checkin| checkin.guest_update.as_ref())
        .and_then(|guest_update| guest_update.ic_number.as_ref());
    let has_identity_document = match ic_in_patch {
        Some(value) => !value.trim().is_empty(),
        None => booking_repo::fetch_guest_ic_number_tx(&mut tx, booking.guest_id)
            .await?
            .is_some_and(|value| !value.trim().is_empty()),
    };
    if !has_identity_document {
        return Err(ApiError::BadRequest(
            "IC / passport number is required to complete check-in".to_string(),
        ));
    }

    // Optional guest/booking edits supplied with the check-in payload.
    if let Some(ref checkin) = checkin_data {
        if let Some(ref guest_update) = checkin.guest_update {
            booking_repo::apply_guest_update_tx(&mut tx, booking.guest_id, guest_update).await?;
        }
        if let Some(ref booking_update) = checkin.booking_update {
            booking_repo::apply_booking_field_update_tx(&mut tx, booking_id, booking_update)
                .await?;
        }
    }

    // Core transition (atomic guard requiring exactly one affected row).
    let updated_booking = booking_repo::checkin_booking_tx(&mut tx, booking_id).await?;

    // Optional payment captured at check-in; recompute the stored status after.
    let explicit_payment_captured = checkin_data
        .as_ref()
        .and_then(|data| data.payment_record.as_ref())
        .map(|payment| payment.amount > 0.0)
        .unwrap_or(false);
    if let Some(ref checkin) = checkin_data
        && let Some(ref payment) = checkin.payment_record
        && payment.amount > 0.0
    {
        booking_repo::record_checkin_payment_tx(&mut tx, booking_id, payment, user_id).await?;
        payments::recompute_payment_status_tx(&mut tx, booking_id).await?;
    }

    // Online reservations are prepaid: when staff didn't capture a payment at
    // check-in, auto-post the outstanding balance so the folio reflects the
    // online payment. The repo call no-ops when nothing is owed, so it never
    // double-charges a booking that already has a payment.
    let auto_online_payment_recorded =
        if !explicit_payment_captured && is_online_source(booking.source.as_deref()) {
            let recorded =
                booking_repo::record_online_checkin_payment_tx(&mut tx, &booking, user_id).await?;
            if recorded {
                payments::recompute_payment_status_tx(&mut tx, booking_id).await?;
            }
            recorded
        } else {
            false
        };

    // Only occupy the room for current/future stays (skip back-dated check-ins).
    let today = chrono::Local::now().date_naive();
    if booking.check_out_date >= today {
        booking_repo::set_room_occupied_tx(&mut tx, booking.room_id).await?;
    }

    let payment_recorded = checkin_data
        .as_ref()
        .and_then(|data| data.payment_record.as_ref())
        .map(|p| p.amount)
        .unwrap_or(0.0);

    booking_repo::record_booking_history_tx(
        &mut tx,
        booking_id,
        Some(&booking.status),
        "checked_in",
        Some(user_id),
        Some(context.history_reason),
        serde_json::json!({
            "guest_id": booking.guest_id,
            "room_id": booking.room_id,
            "payment_recorded": payment_recorded,
            "auto_online_payment_recorded": auto_online_payment_recorded,
            "source": context.source,
            "ekyc_verification_id": context.self_checkin_event.as_ref().map(|event| event.ekyc_verification_id),
        }),
    )
    .await?;

    AuditLog::log_event_tx(
        &mut tx,
        Some(user_id),
        if context.self_checkin_event.is_some() {
            "booking_ekyc_auto_checkin"
        } else {
            "booking_checkin"
        },
        "booking",
        Some(booking_id),
        Some(serde_json::json!({
            "guest_id": booking.guest_id,
            "room_id": booking.room_id,
            "source": context.source,
            "ekyc_verification_id": context.self_checkin_event.as_ref().map(|event| event.ekyc_verification_id),
        })),
        None,
        None,
    )
    .await?;

    booking_repo::record_checkin_modification_tx(&mut tx, &booking, user_id).await?;

    let self_checkin_at = if let Some(event) = context.self_checkin_event {
        Some(
            booking_repo::record_self_checkin_event_tx(
                &mut tx,
                booking_id,
                event.guest_id,
                event.ekyc_verification_id,
                user_id,
                event.source,
                event.device_type.as_ref(),
                event.checkin_location.as_ref(),
            )
            .await?,
        )
    } else {
        None
    };

    tx.commit().await.map_err(ApiError::from)?;

    // Night-audit back-fill is AUXILIARY, not transaction-critical: it tops up
    // postings for past nights whose audit already closed (same-day walk-ins
    // created after their own 00:00 audit ran). It is idempotent and the nightly
    // audit re-derives the same postings, so financial correctness does not
    // depend on this call succeeding here — hence it runs post-commit and a
    // failure is surfaced through structured logging (booking id + error) rather
    // than rolling back a completed check-in. If a stronger guarantee is ever
    // required, move it behind a transactional outbox instead of an inline call.
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    if let Err(e) =
        crate::services::night_audit::backfill_booking_posted_nights(pool, booking_id, user_id)
            .await
    {
        log::warn!(
            "Failed to backfill posted nights for booking {}: {}",
            booking_id,
            e
        );
    }

    Ok((updated_booking, self_checkin_at))
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

#[cfg(test)]
mod tests {
    use super::{is_guest_cancellable_booking, is_online_source};

    #[test]
    fn online_source_is_detected_case_and_whitespace_insensitive() {
        assert!(is_online_source(Some("online")));
        assert!(is_online_source(Some("Online")));
        assert!(is_online_source(Some("  ONLINE  ")));
    }

    #[test]
    fn non_online_sources_are_rejected() {
        assert!(!is_online_source(Some("walk_in")));
        assert!(!is_online_source(Some("phone")));
        assert!(!is_online_source(Some("agent")));
        assert!(!is_online_source(Some("")));
        assert!(!is_online_source(None));
    }

    #[test]
    fn upcoming_booking_states_are_guest_cancellable() {
        assert!(is_guest_cancellable_booking("pending"));
        assert!(is_guest_cancellable_booking("pending_payment"));
        assert!(is_guest_cancellable_booking("pending_confirmation"));
        assert!(is_guest_cancellable_booking("confirmed"));
        assert!(!is_guest_cancellable_booking("checked_in"));
        assert!(!is_guest_cancellable_booking("checked_out"));
        assert!(!is_guest_cancellable_booking("voided"));
    }
}
