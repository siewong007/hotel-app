//! Booking service compatibility layer.

pub use crate::repositories::bookings::*;

use chrono::{DateTime, Utc};

use crate::core::auth::AuthService;
use crate::core::db::{DbPool, hotel_today};
use crate::core::error::ApiError;
use crate::models::{Booking, CheckInRequest};
use crate::repositories::bookings as booking_repo;
use crate::services::audit::AuditLog;
use crate::services::booking as booking_service;
use crate::services::payments;
use crate::models::AuditEvent;
use crate::utils::sanitization::Sanitizer;
use rust_decimal::Decimal;

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
    booking_repo::void_booking_tx(&mut tx, booking_id, Some(user_id)).await?;
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

/// Shortest reason accepted when releasing a held room.
///
/// Not an arbitrary minimum: it is what stops "x" or "." from satisfying a
/// required field, which would leave the audit trail no better off than the
/// optional reason this action exists to replace.
const MIN_RELEASE_REASON_LEN: usize = 4;
const MAX_RELEASE_REASON_LEN: usize = 500;

/// Validate and normalise the reason a room was released.
fn validate_release_reason(reason: &str) -> Result<String, ApiError> {
    let reason = Sanitizer::sanitize_notes(reason);
    let reason = reason.trim();
    if reason.chars().count() < MIN_RELEASE_REASON_LEN {
        return Err(ApiError::BadRequest(
            "Please give a reason for releasing this booking.".to_string(),
        ));
    }
    if reason.chars().count() > MAX_RELEASE_REASON_LEN {
        return Err(ApiError::BadRequest(format!(
            "The reason must be {MAX_RELEASE_REASON_LEN} characters or fewer."
        )));
    }
    Ok(reason.to_string())
}

/// Release the room held by a booking that was never paid for, recording why.
///
/// Deliberately narrower than [`void_booking`], which is the general staff
/// override: that takes any booking and an optional reason. This one is the
/// safe, routine action for clearing a stale unpaid hold, so:
///
/// * only a `pending_payment` booking qualifies — anything else is refused and
///   pointed at void, so a paid or in-house stay cannot be cleared by reflex;
/// * money already collected is refused outright, because deciding a refund is
///   not this action's job and releasing the room would strand the payment;
/// * the reason is required and ends up in booking history and the audit log.
///
/// Complimentary-night credits are returned to the guest, matching `void_booking`
/// — a partly credit-funded stay still sits in `pending_payment`, and the guest
/// must not lose free nights because staff cleared the hold.
pub async fn release_pending_payment_booking(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
    reason: &str,
) -> Result<serde_json::Value, ApiError> {
    let reason = validate_release_reason(reason)?;
    let booking = booking_service::fetch_booking_by_id(pool, booking_id).await?;

    if booking.status != "pending_payment" {
        return Err(ApiError::BadRequest(format!(
            "Only bookings awaiting payment can be released; this one is '{}'. Void it instead if it has to be cancelled.",
            booking.status
        )));
    }

    let collected = booking_repo::completed_booking_payment_total(pool, booking_id).await?;
    if collected > Decimal::ZERO {
        return Err(ApiError::Conflict(
            "Payments have been recorded against this booking. Void it through the refund flow instead of releasing it.".to_string(),
        ));
    }

    let outcome = perform_release(pool, &booking, Some(user_id), &reason, false).await?;

    Ok(serde_json::json!({
        "message": "Room released. The booking is now voided.",
        "booking_id": booking_id,
        "reason": reason,
        "complimentary_nights_restored": outcome.nights_credited,
        "affected_night_audit_dates": outcome.affected_night_audit_dates,
        "night_audit_rerun_required": !outcome.affected_night_audit_dates.is_empty()
    }))
}

struct ReleaseOutcome {
    nights_credited: i32,
    affected_night_audit_dates: Vec<chrono::NaiveDate>,
}

/// The release itself, shared by the staff action and the scheduled sweep so
/// the two can never drift in what they write.
///
/// `actor` is `None` for the automated sweep. Callers are responsible for the
/// eligibility guards first; this performs the release.
async fn perform_release(
    pool: &DbPool,
    booking: &Booking,
    actor: Option<i64>,
    reason: &str,
    automated: bool,
) -> Result<ReleaseOutcome, ApiError> {
    let booking_id = booking.id;
    let affected_night_audit_dates =
        booking_repo::booking_night_audit_dates(pool, booking_id).await?;

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    booking_repo::void_booking_tx(&mut tx, booking_id, actor).await?;
    booking_repo::release_room_tx(&mut tx, booking.room_id).await?;
    booking_repo::void_uncompleted_booking_payments_tx(&mut tx, booking_id).await?;
    let nights_credited = booking_repo::restore_complimentary_credits_tx(&mut tx, booking).await?;
    payments::recompute_payment_status_tx(&mut tx, booking_id).await?;

    booking_repo::record_booking_history_tx(
        &mut tx,
        booking_id,
        Some(&booking.status),
        "voided",
        actor,
        Some(reason),
        serde_json::json!({
            "action": if automated { "auto_released_unpaid" } else { "released_unpaid" },
            "room_id": booking.room_id,
            "guest_id": booking.guest_id,
            "check_in_date": booking.check_in_date.to_string(),
            "check_out_date": booking.check_out_date.to_string(),
            "complimentary_nights_restored": nights_credited,
        }),
    )
    .await?;
    // `booking_modifications.modified_by` is NOT NULL, so an automated release
    // cannot have a row here — there is no user to attribute it to. The booking
    // history entry and the audit event above both record it instead.
    if let Some(actor) = actor {
        booking_repo::record_booking_void_modification_tx(&mut tx, booking, actor).await?;
    }
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: actor,
            // Distinct from `booking.voided` so unpaid-hold releases stay
            // separable from general voids when the audit log is reviewed, and
            // the automated sweep stays separable from a staff decision.
            action: if automated {
                "booking.auto_released_unpaid"
            } else {
                "booking.released_unpaid"
            },
            resource_type: "booking",
            resource_id: Some(booking_id),
            details: Some(serde_json::json!({
                "booking_number": booking.booking_number,
                "reason": reason,
                "room_id": booking.room_id,
                "total_amount": booking.total_amount.to_string(),
                "complimentary_nights_restored": nights_credited,
            })),
            ..Default::default()
        },
    )
    .await?;
    tx.commit().await.map_err(ApiError::from)?;

    Ok(ReleaseOutcome {
        nights_credited,
        affected_night_audit_dates,
    })
}

/// Booking origins the automatic sweep is allowed to release.
///
/// `bookings.source` is the coarse origin token (see the channel notes in
/// `repositories::booking_list`): the guest web module writes `'website'`, OTA
/// imports write `'online'`, the staff booking form defaults to `'walk_in'`,
/// and the column itself defaults to `'direct'`. Only the first two are online
/// bookings.
///
/// Anything else — an unrecognised token, or no source at all — counts as a
/// front-desk hold and is left alone. Staff manage those by hand, and the
/// automatic sweep must never be the reason one disappears; the direction of
/// this default is the whole point.
///
/// Deliberately separate from `is_online_source`, which matches `'online'`
/// alone and gates unrelated payment-capture behaviour: widening that helper
/// would silently change check-in.
fn is_auto_releasable_source(source: Option<&str>) -> bool {
    source.is_some_and(|value| {
        let value = value.trim();
        value.eq_ignore_ascii_case("website") || value.eq_ignore_ascii_case("online")
    })
}

/// Setting holding how long an unpaid booking keeps its room, in hours.
///
/// Absent, unparseable or `<= 0` all mean the sweep is off. It ships at `24`
/// hours: an unpaid online booking keeps its room for a day. Front-desk holds
/// are exempt regardless — see [`is_auto_releasable_source`].
const UNPAID_HOLD_SETTING: &str = "unpaid_hold_release_hours";

/// Most holds one sweep will release.
///
/// Bounds the first sweep after the setting is switched on, when a hotel may
/// have months of stale holds: they clear over several ticks, each logged, and
/// a mistaken window is noticed before it has voided everything.
const MAX_RELEASES_PER_SWEEP: i64 = 200;

/// Interpret the configured hold window.
///
/// Anything that is not a positive whole number of hours disables the sweep.
/// That direction matters: a blank, malformed or negative value must never be
/// read as "zero hours, release everything now".
fn parse_hold_window_hours(raw: &str) -> Option<i32> {
    match raw.trim().parse::<i32>() {
        Ok(hours) if hours > 0 => Some(hours),
        _ => None,
    }
}

/// The configured hold window, or `None` when auto-release is off.
async fn unpaid_hold_window_hours(pool: &DbPool) -> Option<i32> {
    let raw = crate::modules::settings::service::get_setting_value(pool, UNPAID_HOLD_SETTING)
        .await
        .ok()?;
    parse_hold_window_hours(&raw)
}

/// Release stale unpaid holds, returning how many were released.
///
/// Off unless [`UNPAID_HOLD_SETTING`] is set to a positive number of hours.
/// A booking qualifies only if it is `pending_payment`, came from an online
/// channel (see [`is_auto_releasable_source`] — front-desk holds are exempt),
/// and has no money collected against it; each one is then re-checked
/// individually before it is touched, because a guest can pay between the
/// sweep's query and its write.
///
/// One failure does not abandon the sweep — a booking that cannot be released
/// (a concurrent payment, a room state change) is logged and skipped so the
/// rest still clear.
pub async fn release_stale_unpaid_holds(pool: &DbPool) -> Result<u64, ApiError> {
    let Some(hold_hours) = unpaid_hold_window_hours(pool).await else {
        return Ok(0);
    };

    let candidates =
        booking_repo::stale_unpaid_hold_ids(pool, hold_hours, MAX_RELEASES_PER_SWEEP).await?;
    let reason =
        format!("Automatically released: unpaid for more than {hold_hours} hour(s)");

    let mut released = 0_u64;
    for booking_id in candidates {
        let booking = match booking_service::fetch_booking_by_id(pool, booking_id).await {
            Ok(booking) => booking,
            Err(error) => {
                log::warn!("Auto-release skipped booking {booking_id}: {error}");
                continue;
            }
        };

        // Re-check under current state: the candidate query ran earlier, and a
        // guest paying in between must keep their room.
        if booking.status != "pending_payment" {
            continue;
        }
        // Front-desk holds are exempt. The SQL already filters on this; the
        // Rust helper stays authoritative so the rule has one definition and
        // a hand-run of the query can never widen it.
        if !is_auto_releasable_source(booking.source.as_deref()) {
            continue;
        }
        match booking_repo::completed_booking_payment_total(pool, booking_id).await {
            Ok(collected) if collected > Decimal::ZERO => continue,
            Ok(_) => {}
            Err(error) => {
                log::warn!("Auto-release could not verify payments on booking {booking_id}: {error}");
                continue;
            }
        }

        match perform_release(pool, &booking, None, &reason, true).await {
            Ok(_) => released += 1,
            Err(error) => {
                log::warn!("Auto-release failed for booking {booking_id}: {error}");
            }
        }
    }

    Ok(released)
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
    booking_repo::void_booking_tx(&mut tx, booking_id, Some(user_id)).await?;
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
    let today = hotel_today(&mut *tx).await?;
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
        AuditEvent {
            user_id: Some(user_id),
            action: if context.self_checkin_event.is_some() {
                "booking_ekyc_auto_checkin"
            } else {
                "booking_checkin"
            },
            resource_type: "booking",
            resource_id: Some(booking_id),
            details: Some(serde_json::json!({
                "guest_id": booking.guest_id,
                "room_id": booking.room_id,
                "source": context.source,
                "ekyc_verification_id": context.self_checkin_event.as_ref().map(|event| event.ekyc_verification_id),
            })),
            ..Default::default()
        },
    )
    .await?;

    booking_repo::record_checkin_modification_tx(&mut tx, &booking, user_id).await?;

    let self_checkin_at = if let Some(event) = context.self_checkin_event {
        Some(
            booking_repo::record_self_checkin_event_tx(
                &mut tx,
                booking_repo::SelfCheckinEventValues {
                    booking_id,
                    guest_id: event.guest_id,
                    ekyc_verification_id: event.ekyc_verification_id,
                    user_id,
                    source: event.source,
                    device_type: event.device_type.as_ref(),
                    checkin_location: event.checkin_location.as_ref(),
                },
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
        AuditEvent {
            user_id: Some(user_id),
            action: "booking_reactivated",
            resource_type: "booking",
            resource_id: Some(booking_id),
            details: Some(serde_json::json!({
                "guest_id": existing.guest_id,
                "room_id": existing.room_id,
                "previous_status": "voided"
            })),
            ..Default::default()
        },
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
    use super::{
        MAX_RELEASE_REASON_LEN, is_auto_releasable_source, is_guest_cancellable_booking,
        is_online_source, parse_hold_window_hours, validate_release_reason,
    };

    #[test]
    fn auto_release_covers_web_and_ota_bookings() {
        assert!(is_auto_releasable_source(Some("website")));
        assert!(is_auto_releasable_source(Some("online")));
        // Imported rows carry inconsistent casing and padding.
        assert!(is_auto_releasable_source(Some("  Website ")));
        assert!(is_auto_releasable_source(Some("ONLINE")));
    }

    #[test]
    fn auto_release_never_touches_a_front_desk_hold() {
        // 'walk_in' is the staff form's default and 'direct' the column's, so
        // these two carry most front-desk bookings.
        assert!(!is_auto_releasable_source(Some("walk_in")));
        assert!(!is_auto_releasable_source(Some("direct")));
        assert!(!is_auto_releasable_source(Some("phone")));
        assert!(!is_auto_releasable_source(Some("agent")));
        // Unknown or absent origin is treated as front desk, never released.
        assert!(!is_auto_releasable_source(Some("kiosk")));
        assert!(!is_auto_releasable_source(Some("")));
        assert!(!is_auto_releasable_source(None));
    }

    #[test]
    fn auto_release_source_rule_is_wider_than_the_payment_capture_rule() {
        // `is_online_source` gates check-in payment capture and matches
        // 'online' only. The two must not be collapsed: a guest-portal booking
        // is releasable but is not an `is_online_source` booking.
        assert!(is_auto_releasable_source(Some("website")));
        assert!(!is_online_source(Some("website")));
    }

    #[test]
    fn auto_release_is_off_unless_a_positive_window_is_configured() {
        // The shipped default, and the value a hotel sets to turn it back off.
        assert_eq!(parse_hold_window_hours("0"), None);
        assert_eq!(parse_hold_window_hours(""), None);
        assert_eq!(parse_hold_window_hours("   "), None);
    }

    #[test]
    fn a_malformed_window_never_means_release_everything_now() {
        // The dangerous direction: these must disable the sweep, not run it
        // with a zero-hour window that would void every unpaid booking.
        for raw in ["abc", "-24", "12.5", "24h", "1e3", "99999999999999999999"] {
            assert_eq!(parse_hold_window_hours(raw), None, "raw: {raw}");
        }
    }

    #[test]
    fn a_positive_window_is_accepted_and_trimmed() {
        assert_eq!(parse_hold_window_hours("24"), Some(24));
        assert_eq!(parse_hold_window_hours("  48  "), Some(48));
        assert_eq!(parse_hold_window_hours("1"), Some(1));
    }

    #[test]
    fn release_reason_is_required() {
        // The whole point of the action: no blank reason silently defaulted.
        assert!(validate_release_reason("").is_err());
        assert!(validate_release_reason("   ").is_err());
        assert!(validate_release_reason("\t\n").is_err());
    }

    #[test]
    fn release_reason_rejects_token_input() {
        assert!(validate_release_reason("x").is_err());
        assert!(validate_release_reason("..").is_err());
    }

    #[test]
    fn release_reason_is_trimmed_and_kept() {
        assert_eq!(
            validate_release_reason("  No payment after 7 days  ").unwrap(),
            "No payment after 7 days"
        );
    }

    #[test]
    fn release_reason_is_length_bounded() {
        let long = "a".repeat(MAX_RELEASE_REASON_LEN);
        assert!(validate_release_reason(&long).is_ok());
        let too_long = "a".repeat(MAX_RELEASE_REASON_LEN + 1);
        assert!(validate_release_reason(&too_long).is_err());
    }

    #[test]
    fn release_reason_is_sanitised() {
        // Free text reaches booking history and the audit log, so it goes
        // through the same sanitiser as other staff-entered notes.
        let cleaned = validate_release_reason("<script>alert(1)</script> unpaid hold").unwrap();
        assert!(!cleaned.contains("<script>"), "got: {cleaned}");
    }

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
