//! eKYC-backed auto check-in workflows.

use chrono::{Local, NaiveDate, Utc};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    AutoCheckinResponse, Booking, BookingWithDetails, CheckInRequest, Guest, GuestEkycStatusSummary,
};
use crate::repositories::bookings as booking_repo;
use crate::repositories::ekyc::{EkycRepository, GuestEkycSummaryRecord};
use crate::services::booking as booking_service;
use crate::services::bookings::{
    CheckinSourceContext, SelfCheckinEventInsert, checkin_booking_flow,
};

pub const AUTO_CHECKIN_SOURCE: &str = "ekyc_auto_checkin";

pub fn normalize_ekyc_status(status: &str) -> &'static str {
    match status {
        "approved" | "verified" => "approved",
        "rejected" => "rejected",
        "expired" => "expired",
        "void" | "cancelled" | "canceled" => "void",
        "pending_manual_review"
        | "in_review"
        | "under_review"
        | "on_hold"
        | "additional_information_required"
        | "escalated" => "in_review",
        "draft" | "submitted" | "automated_review" | "pending" => "pending",
        _ => "pending",
    }
}

pub async fn guest_ekyc_summary(
    pool: &DbPool,
    guest_id: i64,
) -> Result<GuestEkycStatusSummary, ApiError> {
    let record = EkycRepository::latest_guest_summary_record(pool, guest_id).await?;
    Ok(record
        .as_ref()
        .map(summary_from_record)
        .unwrap_or_else(|| GuestEkycStatusSummary::not_submitted(guest_id)))
}

pub async fn attach_guest_ekyc_summary(pool: &DbPool, guest: &mut Guest) -> Result<(), ApiError> {
    guest.ekyc_summary = guest_ekyc_summary(pool, guest.id).await?;
    Ok(())
}

pub async fn attach_guest_ekyc_summaries(
    pool: &DbPool,
    guests: &mut [Guest],
) -> Result<(), ApiError> {
    for guest in guests {
        attach_guest_ekyc_summary(pool, guest).await?;
    }
    Ok(())
}

pub async fn auto_checkin_eligibility(
    pool: &DbPool,
    booking_id: i64,
) -> Result<GuestEkycStatusSummary, ApiError> {
    let booking = booking_service::fetch_booking_by_id(pool, booking_id).await?;
    let (summary, _) = eligibility_for_booking(pool, &booking).await?;
    Ok(summary)
}

pub async fn attach_booking_ekyc_summaries(
    pool: &DbPool,
    bookings: &mut [BookingWithDetails],
) -> Result<(), ApiError> {
    for booking in bookings {
        let mut summary = guest_ekyc_summary(pool, booking.guest_id).await?;
        apply_booking_constraints(
            pool,
            &mut summary,
            &booking.status,
            booking.check_in_date,
            booking.check_out_date,
            booking.room_id,
        )
        .await?;
        booking.ekyc_summary = summary;
    }
    Ok(())
}

pub async fn auto_checkin_for_staff(
    pool: &DbPool,
    actor_user_id: i64,
    booking_id: i64,
) -> Result<AutoCheckinResponse, ApiError> {
    let booking = booking_service::fetch_booking_by_id(pool, booking_id).await?;
    perform_auto_checkin(pool, actor_user_id, booking, None, None).await
}

pub async fn auto_checkin_for_user(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
    device_type: Option<String>,
    checkin_location: Option<String>,
) -> Result<AutoCheckinResponse, ApiError> {
    let guest_id = EkycRepository::guest_id_for_user(pool, user_id)
        .await?
        .ok_or_else(|| {
            ApiError::BadRequest("Your account is not linked to a guest profile".to_string())
        })?;
    let booking = booking_service::fetch_booking_by_id(pool, booking_id).await?;

    if booking.guest_id != guest_id {
        return Err(ApiError::Forbidden(
            "Booking does not belong to your guest profile".to_string(),
        ));
    }

    perform_auto_checkin(pool, user_id, booking, device_type, checkin_location).await
}

pub async fn auto_checkin_for_guest_portal(
    pool: &DbPool,
    booking_id: i64,
) -> Result<AutoCheckinResponse, ApiError> {
    let booking = booking_service::fetch_booking_by_id(pool, booking_id).await?;
    let (summary, record) = eligibility_for_booking(pool, &booking).await?;
    let record = record.ok_or_else(|| {
        ApiError::BadRequest(
            summary
                .auto_checkin_block_reason
                .clone()
                .unwrap_or_else(|| "Approved eKYC is required for auto check-in".to_string()),
        )
    })?;

    perform_auto_checkin_with_summary(pool, record.user_id, booking, summary, record, None, None)
        .await
}

async fn perform_auto_checkin(
    pool: &DbPool,
    actor_user_id: i64,
    booking: Booking,
    device_type: Option<String>,
    checkin_location: Option<String>,
) -> Result<AutoCheckinResponse, ApiError> {
    let (summary, record) = eligibility_for_booking(pool, &booking).await?;
    let record = record.ok_or_else(|| {
        ApiError::BadRequest(
            summary
                .auto_checkin_block_reason
                .clone()
                .unwrap_or_else(|| "Approved eKYC is required for auto check-in".to_string()),
        )
    })?;

    perform_auto_checkin_with_summary(
        pool,
        actor_user_id,
        booking,
        summary,
        record,
        device_type,
        checkin_location,
    )
    .await
}

async fn perform_auto_checkin_with_summary(
    pool: &DbPool,
    actor_user_id: i64,
    booking: Booking,
    summary: GuestEkycStatusSummary,
    record: GuestEkycSummaryRecord,
    device_type: Option<String>,
    checkin_location: Option<String>,
) -> Result<AutoCheckinResponse, ApiError> {
    if !summary.can_auto_checkin {
        return Err(ApiError::BadRequest(
            summary
                .auto_checkin_block_reason
                .clone()
                .unwrap_or_else(|| "Booking is not eligible for auto check-in".to_string()),
        ));
    }

    let booking_id = booking.id;
    let room_id = booking.room_id;
    let checked_in_at = checkin_booking_flow(
        pool,
        actor_user_id,
        booking_id,
        Option::<CheckInRequest>::None,
        CheckinSourceContext {
            source: AUTO_CHECKIN_SOURCE,
            history_reason: "Guest checked in through approved eKYC auto check-in",
            self_checkin_event: Some(SelfCheckinEventInsert {
                guest_id: booking.guest_id,
                ekyc_verification_id: record.verification_id,
                source: AUTO_CHECKIN_SOURCE,
                device_type,
                checkin_location,
            }),
        },
    )
    .await?
    .1
    .unwrap_or_else(Utc::now);

    let room_number = booking_repo::room_number(pool, room_id).await?;

    Ok(AutoCheckinResponse {
        success: true,
        booking_id,
        room_number: room_number.clone(),
        digital_key_sent: true,
        checked_in_at,
        ekyc_summary: summary,
        message: format!(
            "Successfully checked in to room {}. Your digital key has been sent.",
            room_number
        ),
    })
}

async fn eligibility_for_booking(
    pool: &DbPool,
    booking: &Booking,
) -> Result<(GuestEkycStatusSummary, Option<GuestEkycSummaryRecord>), ApiError> {
    let record = EkycRepository::latest_guest_summary_record(pool, booking.guest_id).await?;
    let mut summary = record
        .as_ref()
        .map(summary_from_record)
        .unwrap_or_else(|| GuestEkycStatusSummary::not_submitted(booking.guest_id));

    apply_booking_constraints(
        pool,
        &mut summary,
        &booking.status,
        booking.check_in_date,
        booking.check_out_date,
        booking.room_id,
    )
    .await?;

    Ok((summary, record))
}

async fn apply_booking_constraints(
    pool: &DbPool,
    summary: &mut GuestEkycStatusSummary,
    booking_status: &str,
    check_in_date: NaiveDate,
    check_out_date: NaiveDate,
    room_id: i64,
) -> Result<(), ApiError> {
    if !summary.can_auto_checkin {
        return Ok(());
    }

    if let Some(reason) = booking_status_block_reason(booking_status) {
        block(summary, reason);
        return Ok(());
    }

    let today = Local::now().date_naive();
    if check_in_date > today {
        block(
            summary,
            format!("Auto check-in opens on {}.", check_in_date),
        );
        return Ok(());
    }
    if check_out_date < today {
        block(summary, "Booking stay dates have passed.".to_string());
        return Ok(());
    }

    if let Some(room_status) = booking_repo::fetch_room_status(pool, room_id).await?
        && let Some(reason) = room_status_block_reason(&room_status)
    {
        block(summary, reason);
    }

    Ok(())
}

fn summary_from_record(record: &GuestEkycSummaryRecord) -> GuestEkycStatusSummary {
    let status = normalize_ekyc_status(&record.status).to_string();
    let approved = status == "approved";
    let can_auto_checkin = approved && record.self_checkin_enabled;
    let auto_checkin_block_reason = if can_auto_checkin {
        None
    } else if !approved {
        Some(ekyc_status_block_reason(&status))
    } else {
        Some("Self check-in is not enabled for this eKYC verification.".to_string())
    };

    GuestEkycStatusSummary {
        guest_id: record.guest_id,
        ekyc_verification_id: Some(record.verification_id),
        status,
        self_checkin_enabled: record.self_checkin_enabled,
        verified_at: record.verified_at,
        can_auto_checkin,
        auto_checkin_block_reason,
    }
}

fn block(summary: &mut GuestEkycStatusSummary, reason: String) {
    summary.can_auto_checkin = false;
    summary.auto_checkin_block_reason = Some(reason);
}

fn ekyc_status_block_reason(status: &str) -> String {
    match status {
        "pending" => "eKYC is pending approval.".to_string(),
        "in_review" => "eKYC is still in review.".to_string(),
        "rejected" => "eKYC was rejected.".to_string(),
        "expired" => "eKYC has expired.".to_string(),
        "void" => "eKYC has been voided.".to_string(),
        _ => "Approved eKYC is required for auto check-in.".to_string(),
    }
}

fn booking_status_block_reason(status: &str) -> Option<String> {
    match status {
        "confirmed" => None,
        // A `pending` booking has no approved/captured payment yet. It must be
        // confirmed (which happens when a payment is approved/captured) before
        // check-in is allowed.
        "pending" | "pending_payment" => Some("Payment required before check-in.".to_string()),
        "pending_confirmation" => {
            Some("Payment confirmation is required before check-in.".to_string())
        }
        "checked_in" | "auto_checked_in" => Some("Booking is already checked in.".to_string()),
        "checked_out" | "completed" => Some("Booking has already checked out.".to_string()),
        "voided" | "cancelled" | "canceled" => Some("Booking is not active.".to_string()),
        other => Some(format!("Booking status is {}.", other.replace('_', " "))),
    }
}

fn room_status_block_reason(status: &str) -> Option<String> {
    match status {
        "dirty" | "cleaning" | "reserved_dirty" => {
            Some("Cannot auto check-in - the room must be cleaned before check-in.".to_string())
        }
        "maintenance" | "out_of_order" => Some(format!(
            "Cannot auto check-in - room is currently under {}.",
            status.replace('_', " ")
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_ekyc_status;

    #[test]
    fn normalizes_ekyc_status_for_guest_summary() {
        assert_eq!(normalize_ekyc_status("approved"), "approved");
        assert_eq!(normalize_ekyc_status("verified"), "approved");
        assert_eq!(normalize_ekyc_status("pending_manual_review"), "in_review");
        assert_eq!(normalize_ekyc_status("submitted"), "pending");
        assert_eq!(normalize_ekyc_status("void"), "void");
    }
}
