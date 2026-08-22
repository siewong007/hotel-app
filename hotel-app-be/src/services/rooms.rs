//! Room service workflows
//!
//! Business logic (branching, permission checks, audit calls) for the room
//! domain. SQL text and row mapping live in `repositories::rooms_queries`.

use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;
use crate::core::middleware::{check_permission, require_permission_helper};
use crate::models::*;
use crate::repositories::rooms_queries as rq;
use crate::services::audit::AuditLog;
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;

fn normalize_transition_permission(permission: &str) -> &str {
    match permission {
        "housekeeping" => "housekeeping:update",
        value => value,
    }
}

async fn enforce_transition_permission(
    pool: &DbPool,
    user_id: i64,
    from_status: Option<&str>,
    to_status: &str,
) -> Result<(), ApiError> {
    let Some(from_status) = from_status else {
        return Ok(());
    };

    if from_status == to_status {
        return Ok(());
    }

    if let Some(permission) =
        rq::required_transition_permission(pool, from_status, to_status).await?
    {
        check_permission(pool, user_id, normalize_transition_permission(&permission)).await?;
    }

    Ok(())
}

fn date_to_utc(d: NaiveDate) -> Option<DateTime<Utc>> {
    d.and_hms_opt(0, 0, 0)
        .map(|ndt| DateTime::<Utc>::from_naive_utc_and_offset(ndt, Utc))
}

pub async fn complete_housekeeping_cleaning_tx(
    tx: &mut DbTransaction<'_>,
    room_id: i64,
    user_id: i64,
    notes: Option<&str>,
) -> Result<String, ApiError> {
    let current_status = rq::room_status(&mut **tx, room_id).await?;
    let current_status =
        current_status.ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    if !matches!(
        current_status.as_str(),
        "dirty" | "cleaning" | "reserved_dirty"
    ) {
        return Err(ApiError::BadRequest(format!(
            "Cannot complete cleaning while room is {}",
            current_status
        )));
    }

    let mut target_status = if current_status == "reserved_dirty" {
        "reserved".to_string()
    } else {
        "available".to_string()
    };
    let mut auto_reserved_dates: Option<(NaiveDate, NaiveDate)> = None;

    if target_status == "available" {
        let active_booking = rq::has_active_booking(&mut **tx, room_id).await?;

        if active_booking {
            return Err(ApiError::BadRequest(
                "Cannot mark room available while there is an active booking.".to_string(),
            ));
        }

        let check_in_time = rq::check_in_time_setting_tx(tx).await?;

        let reservation =
            rq::reservation_arriving_today(&mut **tx, room_id, &check_in_time).await?;

        if let Some((_booking_id, check_in, check_out)) = reservation {
            target_status = "reserved".to_string();
            auto_reserved_dates = Some((check_in, check_out));
        }
    } else {
        let reservation = rq::next_reservation(&mut **tx, room_id).await?;

        if let Some((_booking_id, check_in, check_out)) = reservation {
            auto_reserved_dates = Some((check_in, check_out));
        }
    }

    let (reserved_start, reserved_end) = match auto_reserved_dates {
        Some((check_in, check_out)) => (date_to_utc(check_in), date_to_utc(check_out)),
        None => (None, None),
    };

    let status_notes = if target_status == "available" {
        Some(format!(
            "{} [via update_room_status]",
            notes.unwrap_or("Housekeeping completed")
        ))
    } else {
        notes
            .map(str::to_string)
            .or_else(|| Some("Housekeeping completed".to_string()))
    };

    rq::update_room_status_with_dates(
        &mut **tx,
        rq::RoomStatusUpdateValues {
            target_status: &target_status,
            notes,
            status_notes: &status_notes,
            reserved_start,
            reserved_end,
            maintenance_start: None,
            maintenance_end: None,
            cleaning_start: None,
            cleaning_end: Some(Utc::now()),
            room_id,
        },
    )
    .await?;

    rq::touch_last_cleaned_at_tx(tx, room_id).await?;

    // Record the status-change event. This is best-effort audit bookkeeping and
    // must not fail the cleaning-completion transaction; the repository call
    // wraps it in a SAVEPOINT so a failure can't poison the parent tx (see
    // lessons.md 2026-07-10b).
    let event_note = format!("Status changed to: {}", target_status);
    rq::insert_room_status_event_best_effort_tx(tx, room_id, event_note, user_id).await?;

    Ok(target_status)
}

pub async fn get_rooms_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<RoomWithRating>>, ApiError> {
    let rooms = rq::fetch_rooms(&pool).await?;
    Ok(Json(rooms))
}

pub async fn search_rooms_handler(
    State(pool): State<DbPool>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<RoomWithRating>>, ApiError> {
    // Parse date range if provided for availability check
    let check_in: Option<NaiveDate> = query
        .check_in_date
        .as_ref()
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
    let check_out: Option<NaiveDate> = query
        .check_out_date
        .as_ref()
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
    let room_type = query.room_type.as_deref().filter(|s| !s.trim().is_empty());
    let max_price = query.max_price;

    let rooms = if let (Some(ci), Some(co)) = (check_in, check_out) {
        rq::search_rooms_with_dates(
            &pool,
            ci,
            co,
            query.exclude_booking_id,
            room_type.map(str::trim),
            max_price,
        )
        .await?
    } else {
        rq::search_rooms_no_dates(&pool, room_type.map(str::trim), max_price).await?
    };

    Ok(Json(rooms))
}

pub async fn update_room_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(room_id): Path<i64>,
    Json(input): Json<RoomUpdateInput>,
) -> Result<Json<Room>, ApiError> {
    // Check if room exists and get current values with JOIN to room_types
    let existing = rq::fetch_existing_room_for_update(&pool, room_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    // Check if anything actually changed
    if input.room_number.is_none()
        && input.price_per_night.is_none()
        && input.available.is_none()
        && input.notes.is_none()
        && input.is_smoking.is_none()
    {
        return Ok(Json(Room {
            id: existing.id,
            room_number: existing.room_number,
            room_type: existing.room_type,
            price_per_night: existing.price_per_night,
            available: existing.available,
            description: existing.description,
            max_occupancy: existing.max_occupancy,
            status: existing.status,
            created_at: existing.created_at,
            updated_at: existing.updated_at,
            notes: existing.notes,
            is_smoking: existing.is_smoking,
        }));
    }

    let room_number = input.room_number.as_ref().unwrap_or(&existing.room_number);
    let custom_price = input
        .price_per_night
        .map(|p| rust_decimal::Decimal::from_f64_retain(p).unwrap_or_default());
    let notes = if input.notes.is_some() {
        input.notes.clone()
    } else {
        existing.notes
    };

    let new_status = if let Some(avail) = input.available {
        if avail {
            Some("available")
        } else {
            Some("out_of_order")
        }
    } else {
        None
    };

    let is_smoking_for_db = input.is_smoking;

    // Check if trying to set room as available while there's an active booking
    if new_status == Some("available") {
        let active_booking = rq::has_active_booking(&pool, room_id).await?;

        if active_booking {
            return Err(ApiError::BadRequest(
                "Cannot set room as available for booking while there is an active booking. Please check out the guest first.".to_string()
            ));
        }
    }

    if let Some(status) = new_status {
        rq::update_room_with_status(
            &pool,
            room_number,
            custom_price,
            status,
            &notes,
            is_smoking_for_db,
            room_id,
        )
        .await?;
    } else {
        rq::update_room_no_status(
            &pool,
            room_number,
            custom_price,
            &notes,
            is_smoking_for_db,
            room_id,
        )
        .await?;
    }

    let updated_room = rq::fetch_room_by_id(&pool, room_id).await?;

    let _ = AuditLog::log_event(
        &pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "room_updated",
            resource_type: "room",
            resource_id: Some(updated_room.id),
            details: Some(serde_json::json!({"room_number": &updated_room.room_number})),
            ..Default::default()
        },
    )
    .await;

    Ok(Json(updated_room))
}

pub async fn create_room_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(input): Json<RoomCreateInput>,
) -> Result<Json<Room>, ApiError> {
    if rq::room_number_exists(&pool, &input.room_number).await? {
        return Err(ApiError::BadRequest(format!(
            "Room number '{}' already exists",
            input.room_number
        )));
    }

    if !rq::room_type_exists(&pool, input.room_type_id).await? {
        return Err(ApiError::BadRequest("Invalid room type".to_string()));
    }

    let custom_price_decimal = input
        .custom_price
        .map(|p| Decimal::from_f64_retain(p).unwrap_or_default());

    let room_id = rq::insert_room(
        &pool,
        rq::RoomInsertValues {
            room_number: &input.room_number,
            room_type_id: input.room_type_id,
            floor: input.floor,
            building: &input.building,
            custom_price: custom_price_decimal,
            is_accessible: input.is_accessible.unwrap_or(false),
            is_smoking: input.is_smoking.unwrap_or(false),
        },
    )
    .await?;

    let created_room = rq::fetch_room_by_id(&pool, room_id).await?;

    let _ = AuditLog::log_event(
        &pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "room_created",
            resource_type: "room",
            resource_id: Some(created_room.id),
            details: Some(serde_json::json!({"room_number": &created_room.room_number})),
            ..Default::default()
        },
    )
    .await;

    Ok(Json(created_room))
}

pub async fn delete_room_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Path(room_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !rq::room_exists_by_id(&pool, room_id).await? {
        return Err(ApiError::NotFound("Room not found".to_string()));
    }

    // Only block deletion if there are currently checked-in guests
    if rq::room_has_active_checked_in_booking(&pool, room_id).await? {
        return Err(ApiError::BadRequest(
            "Cannot delete room with a guest currently checked in. Please complete the checkout first.".to_string()
        ));
    }

    // Delete all bookings associated with this room (past, pending, confirmed, voided),
    // then status change logs, then the room itself.
    rq::delete_room_cascade(&pool, room_id).await?;

    let _ = AuditLog::log_event(
        &pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "room_deleted",
            resource_type: "room",
            resource_id: Some(room_id),
            details: None,
            ..Default::default()
        },
    )
    .await;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Room and associated bookings deleted successfully"
    })))
}

pub async fn get_room_types_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<RoomType>>, ApiError> {
    let room_types = rq::fetch_active_room_types(&pool).await?;
    Ok(Json(room_types))
}

pub async fn get_all_room_types_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<RoomType>>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;

    let room_types = rq::fetch_all_room_types(&pool).await?;
    Ok(Json(room_types))
}

pub async fn get_room_type_handler(
    State(pool): State<DbPool>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<RoomType>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;

    let room_type = rq::fetch_room_type_by_id(&pool, id).await?;
    Ok(Json(room_type))
}

pub async fn create_room_type_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<RoomTypeCreateInput>,
) -> Result<Json<RoomType>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:write").await?;

    // Convert f64 prices to Decimal for proper binding to DECIMAL columns
    let base_price_decimal = Decimal::from_f64_retain(input.base_price).unwrap_or(Decimal::ZERO);
    let weekday_rate_decimal = input
        .weekday_rate
        .map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO));
    let weekend_rate_decimal = input
        .weekend_rate
        .map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO));
    let extra_bed_charge_decimal =
        Decimal::from_f64_retain(input.extra_bed_charge.unwrap_or(0.0)).unwrap_or(Decimal::ZERO);

    let room_type_id = rq::insert_room_type(
        &pool,
        rq::NewRoomType {
            name: &input.name,
            code: &input.code,
            description: &input.description,
            base_price: base_price_decimal,
            weekday_rate: weekday_rate_decimal,
            weekend_rate: weekend_rate_decimal,
            max_occupancy: input.max_occupancy.unwrap_or(2),
            bed_type: &input.bed_type,
            bed_count: input.bed_count.unwrap_or(1),
            allows_extra_bed: input.allows_extra_bed.unwrap_or(false),
            max_extra_beds: input.max_extra_beds.unwrap_or(0),
            extra_bed_charge: extra_bed_charge_decimal,
            sort_order: input.sort_order.unwrap_or(0),
        },
    )
    .await?;

    // Fetch the created room type
    let room_type = rq::fetch_room_type_by_id(&pool, room_type_id).await?;

    // Audit log: room type created
    let _ = AuditLog::log_event(
        &pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "room_type_created",
            resource_type: "room_type",
            resource_id: Some(room_type.id),
            details: Some(serde_json::json!({
                "name": room_type.name,
                "code": room_type.code,
                "base_price": input.base_price
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(Json(room_type))
}

pub async fn update_room_type_handler(
    State(pool): State<DbPool>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<RoomTypeUpdateInput>,
) -> Result<Json<RoomType>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    // Convert f64 prices to Decimal for proper binding to DECIMAL columns
    let base_price_decimal = input
        .base_price
        .map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO));
    let weekday_rate_decimal = input
        .weekday_rate
        .map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO));
    let weekend_rate_decimal = input
        .weekend_rate
        .map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO));
    let extra_bed_charge_decimal = input
        .extra_bed_charge
        .map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO));

    rq::update_room_type(
        &pool,
        id,
        rq::RoomTypeUpdate {
            name: &input.name,
            code: &input.code,
            description: &input.description,
            base_price: base_price_decimal,
            weekday_rate: weekday_rate_decimal,
            weekend_rate: weekend_rate_decimal,
            max_occupancy: input.max_occupancy,
            bed_type: &input.bed_type,
            bed_count: input.bed_count,
            allows_extra_bed: input.allows_extra_bed,
            max_extra_beds: input.max_extra_beds,
            extra_bed_charge: extra_bed_charge_decimal,
            is_active: input.is_active,
            sort_order: input.sort_order,
        },
    )
    .await?;

    // Fetch the updated room type
    let room_type = rq::fetch_room_type_by_id(&pool, id).await?;

    // Audit log: room type updated
    let _ = AuditLog::log_event(
        &pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "room_type_updated",
            resource_type: "room_type",
            resource_id: Some(id),
            details: Some(serde_json::json!({
                "name": room_type.name,
                "code": room_type.code,
                "is_active": room_type.is_active,
                "changes": input
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(Json(room_type))
}

pub async fn delete_room_type_handler(
    State(pool): State<DbPool>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:write").await?;

    // Get room type info before deletion for audit log
    let room_type_info = rq::room_type_name_and_code(&pool, id).await?;

    // Check if any rooms use this room type
    let room_count = rq::count_rooms_by_type(&pool, id).await?;

    if room_count > 0 {
        return Err(ApiError::BadRequest(format!(
            "Cannot delete room type: {} rooms are using this type. Deactivate it instead.",
            room_count
        )));
    }

    rq::delete_room_type(&pool, id).await?;

    // Audit log: room type deleted
    if let Some((name, code)) = room_type_info {
        let _ = AuditLog::log_event(
            &pool,
            AuditEvent {
                user_id: Some(user_id),
                action: "room_type_deleted",
                resource_type: "room_type",
                resource_id: Some(id),
                details: Some(serde_json::json!({
                    "name": name,
                    "code": code
                })),
                ..Default::default()
            },
        )
        .await;
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Room type deleted successfully"
    })))
}

pub async fn update_room_status_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<RoomStatusUpdateInput>,
) -> Result<Json<Room>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    let valid_statuses = vec![
        "available",
        "occupied",
        "maintenance",
        "reserved",
        "reserved_dirty",
        "dirty",
        "clean",
    ];
    if !valid_statuses.contains(&input.status.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid status. Must be one of: {:?}",
            valid_statuses
        )));
    }

    // Map "clean" to "available" for consistency
    let mut target_status = if input.status == "clean" {
        "available".to_string()
    } else {
        input.status.clone()
    };

    // Get current status to check if we're transitioning from a protected status
    let current_status_check = rq::room_status(&pool, room_id).await?;

    // If transitioning from dirty/cleaning/maintenance to available, we need to include
    // the magic marker in status_notes to bypass the database trigger protection
    let needs_bypass_marker = current_status_check
        .as_ref()
        .map(|s| {
            [
                "dirty",
                "cleaning",
                "reserved_dirty",
                "maintenance",
                "out_of_order",
            ]
            .contains(&s.as_str())
        })
        .unwrap_or(false)
        && target_status == "available";

    let status_notes = if needs_bypass_marker {
        Some(format!(
            "{} [via update_room_status]",
            input.notes.as_deref().unwrap_or("Status updated")
        ))
    } else {
        input.notes.clone()
    };

    let current_status = rq::room_status(&pool, room_id).await?;

    // When auto-flipping "available" -> "reserved" below, remember the
    // reservation so we can stamp the room's reservation window.
    let mut auto_reserved_dates: Option<(NaiveDate, NaiveDate)> = None;

    if target_status == "dirty" {
        let reservation = rq::next_reservation(&pool, room_id).await?;

        if let Some((_booking_id, check_in, check_out)) = reservation {
            target_status = "reserved_dirty".to_string();
            auto_reserved_dates = Some((check_in, check_out));
        }
    }

    if target_status == "available" {
        let active_booking = rq::has_active_booking(&pool, room_id).await?;

        if active_booking {
            return Err(ApiError::BadRequest(
                "Cannot change room to available status while there is an active booking. Please check out the guest first.".to_string()
            ));
        }

        // A reserved_dirty room is clean only after housekeeping clears it, but
        // any active reservation must remain visible instead of releasing the
        // room to available.
        if current_status.as_deref() == Some("reserved_dirty") {
            let reservation = rq::next_reservation(&pool, room_id).await?;

            if let Some((_booking_id, check_in, check_out)) = reservation {
                target_status = "reserved".to_string();
                auto_reserved_dates = Some((check_in, check_out));
            }
        }

        // If a reservation arrives today and the configured check-in time has
        // passed, the room isn't truly free — flip it to "reserved" so its
        // stored status matches the imminent arrival instead of "available".
        if target_status == "available" {
            let check_in_time =
                crate::modules::settings::service::get_setting_value(&pool, "check_in_time")
                    .await
                    .unwrap_or_else(|_| "15:00:00".to_string());

            let reservation =
                rq::reservation_arriving_today(&pool, room_id, &check_in_time).await?;

            if let Some((_booking_id, check_in, check_out)) = reservation {
                target_status = "reserved".to_string();
                auto_reserved_dates = Some((check_in, check_out));
            }
        }
    }

    // Require booking_id when a caller sets "reserved" directly. The auto-flip
    // above is exempt because it already verified the reservation exists.
    if target_status == "reserved" && auto_reserved_dates.is_none() {
        if input.booking_id.is_none() {
            return Err(ApiError::BadRequest(
                "Cannot reserve a room directly. Please create a booking with guest details first. Use the 'Book Room' or 'Walk-in Check-in' option instead.".to_string()
            ));
        }

        // Verify the booking exists and is valid
        let booking_valid =
            rq::booking_valid_for_reservation(&pool, input.booking_id, room_id).await?;

        if !booking_valid {
            return Err(ApiError::BadRequest(
                "Invalid booking_id or booking is not for this room.".to_string(),
            ));
        }
    }

    // Enforce the room-status state machine on the final target — the same
    // `validate_room_status_transition()` SQL function the booking-trigger
    // path runs inside `update_room_status()`.
    rq::validate_room_status_transition(&pool, room_id, target_status.as_str(), user_id).await?;

    enforce_transition_permission(
        &pool,
        user_id,
        current_status.as_deref(),
        target_status.as_str(),
    )
    .await?;

    // Parse date strings to DateTime<Utc> for proper database binding
    let parse_datetime = |s: &Option<String>| -> Option<DateTime<Utc>> {
        s.as_ref().and_then(|date_str| {
            if date_str.is_empty() {
                return None;
            }
            // Try parsing ISO format with timezone
            if let Ok(dt) = DateTime::parse_from_rfc3339(date_str) {
                return Some(dt.with_timezone(&Utc));
            }
            // Try parsing as date only and convert to midnight UTC
            if let Ok(nd) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                return nd
                    .and_hms_opt(0, 0, 0)
                    .map(|ndt| DateTime::<Utc>::from_naive_utc_and_offset(ndt, Utc));
            }
            None
        })
    };

    // Prefer the auto-detected reservation window when we flipped to "reserved";
    // otherwise fall back to whatever the caller supplied.
    let (reserved_start, reserved_end) = match auto_reserved_dates {
        Some((check_in, check_out)) => (date_to_utc(check_in), date_to_utc(check_out)),
        None => (
            parse_datetime(&input.reserved_start_date),
            parse_datetime(&input.reserved_end_date),
        ),
    };
    let maintenance_start = parse_datetime(&input.maintenance_start_date);
    let maintenance_end = parse_datetime(&input.maintenance_end_date);
    let cleaning_start = parse_datetime(&input.cleaning_start_date);
    let cleaning_end = parse_datetime(&input.cleaning_end_date);

    rq::update_room_status_with_dates(
        &pool,
        rq::RoomStatusUpdateValues {
            target_status: &target_status,
            notes: input.notes.as_deref(),
            status_notes: &status_notes,
            reserved_start,
            reserved_end,
            maintenance_start,
            maintenance_end,
            cleaning_start,
            cleaning_end,
            room_id,
        },
    )
    .await?;

    // Mirror the SQL `update_room_status()` behavior the booking-trigger path
    // gets: a room flipped dirty must surface an open cleaning task.
    if matches!(target_status.as_str(), "dirty" | "reserved_dirty") {
        rq::ensure_pending_cleaning_task(&pool, room_id, user_id, input.notes.as_deref()).await?;
    }

    // Only record room history for guest actions (check-in / check-out)
    let is_checkin = target_status == "occupied";
    let is_checkout = current_status.as_deref() == Some("occupied") && target_status != "occupied";

    if is_checkin || is_checkout {
        let history_start = reserved_start.or(maintenance_start).or(cleaning_start);
        let history_end = reserved_end.or(maintenance_end).or(cleaning_end);

        let _ = rq::insert_room_history(
            &pool,
            rq::RoomHistoryValues {
                room_id,
                from_status: &current_status,
                to_status: &target_status,
                start: history_start,
                end: history_end,
                user_id,
                notes: &input.notes,
            },
        )
        .await;
    }

    // Create event log
    let _ = rq::insert_room_status_event(
        &pool,
        room_id,
        format!("Status changed to: {}", target_status),
        user_id,
    )
    .await;

    let room = rq::fetch_room_by_id(&pool, room_id).await?;

    // Audit log: room status change
    let _ = AuditLog::log_event(
        &pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "room_status_changed",
            resource_type: "room",
            resource_id: Some(room_id),
            details: Some(serde_json::json!({
                "room_number": room.room_number,
                "from_status": current_status,
                "to_status": target_status,
                "notes": input.notes
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(Json(room))
}

pub async fn end_maintenance_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Room>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    let current_status = rq::room_status(&pool, room_id).await?;

    let current_status =
        current_status.ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;
    let status = &current_status;
    if status == "available" {
        rq::clear_maintenance_dates(&pool, room_id).await?;

        let room = rq::fetch_room_by_id(&pool, room_id).await?;
        return Ok(Json(room));
    }

    if status == "occupied" {
        return Err(ApiError::BadRequest(
            "Cannot clear status for occupied room. Please check out the guest first.".to_string(),
        ));
    }

    rq::end_maintenance_set_available(&pool, room_id).await?;

    let status_label = current_status.clone();

    let _ = rq::insert_room_status_event(
        &pool,
        room_id,
        format!("Ended {} - Room available", status_label),
        user_id,
    )
    .await;

    let room = rq::fetch_room_by_id(&pool, room_id).await?;

    // Audit log: maintenance ended
    let _ = AuditLog::log_event(
        &pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "maintenance_ended",
            resource_type: "room",
            resource_id: Some(room_id),
            details: Some(serde_json::json!({
                "room_number": room.room_number,
                "from_status": status_label,
                "to_status": "available"
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(Json(room))
}

pub async fn end_cleaning_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    let current_status = rq::room_status(&pool, room_id).await?;

    if let Some(status) = &current_status {
        if status != "cleaning" {
            return Err(ApiError::BadRequest(format!(
                "Room is not in cleaning status. Current status: {}. Only rooms in 'cleaning' status can be marked as cleaned.",
                status
            )));
        }
    } else {
        return Err(ApiError::NotFound("Room not found".to_string()));
    }

    let next_status = rq::next_room_status(&pool, room_id).await?;

    rq::end_cleaning_update(&pool, &next_status, room_id).await?;

    let _ = rq::insert_room_status_event(
        &pool,
        room_id,
        format!("Cleaning completed - Room now {}", next_status),
        user_id,
    )
    .await;

    // Get room number for audit log
    let room_number = rq::room_number(&pool, room_id)
        .await
        .unwrap_or_else(|_| format!("{}", room_id));

    // Audit log: cleaning completed
    let _ = AuditLog::log_event(
        &pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "cleaning_completed",
            resource_type: "room",
            resource_id: Some(room_id),
            details: Some(serde_json::json!({
                "room_number": room_number,
                "from_status": "cleaning",
                "to_status": next_status
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(Json(serde_json::json!({
        "success": true,
        "room_id": room_id,
        "previous_status": "cleaning",
        "new_status": next_status,
        "message": format!("Room cleaning completed. Status changed to '{}'.", next_status)
    })))
}

pub async fn sync_room_statuses_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    let synced = rq::sync_all_room_statuses(&pool, user_id).await?;

    let changes: Vec<serde_json::Value> = synced
        .iter()
        .map(|c| {
            serde_json::json!({
                "room_id": c.room_id,
                "room_number": c.room_number,
                "old_status": c.old_status,
                "new_status": c.new_status,
            })
        })
        .collect();

    // Audit log: bulk room-status sync
    let _ = AuditLog::log_event(
        &pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "room_statuses_synced",
            resource_type: "room",
            resource_id: None,
            details: Some(serde_json::json!({
                "synced_count": changes.len(),
                "changes": changes.clone(),
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(Json(serde_json::json!({
        "success": true,
        "synced_count": changes.len(),
        "changes": changes.clone(),
        "message": if !changes.is_empty() {
            format!("Successfully synchronized {} room(s)", changes.len())
        } else {
            "All room statuses are already consistent".to_string()
        }
    })))
}

pub async fn execute_room_change_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:update").await?;

    let target_id: i64 = input
        .get("target_room_id")
        .and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
        .ok_or_else(|| ApiError::BadRequest("Invalid target room".to_string()))?;

    let reason = input
        .get("reason")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Room change requested".to_string());

    // Prevent changing to the same room
    if room_id == target_id {
        return Err(ApiError::BadRequest(
            "Cannot change to the same room".to_string(),
        ));
    }

    // Find the currently active booking for this room
    // Priority: checked_in first, then confirmed bookings that are currently active
    let booking = rq::active_booking_for_room(&pool, room_id).await?;

    let (booking_id, guest_id) = booking.ok_or_else(||
        ApiError::BadRequest("No active booking found for this room. The room must have a guest currently checked in or a confirmed booking for today.".to_string())
    )?;

    // Check target room exists and is available using dynamic status computation
    // This matches the logic used in get_rooms_handler for consistency
    let target_room = rq::target_room_status(&pool, target_id).await?;

    let (target_status, target_active, _) =
        target_room.ok_or_else(|| ApiError::BadRequest("Target room not found".to_string()))?;

    if !target_active {
        return Err(ApiError::BadRequest(
            "Target room is not active".to_string(),
        ));
    }

    if target_status != "available" {
        return Err(ApiError::BadRequest(format!(
            "Target room is not available (current status: {})",
            target_status
        )));
    }

    // Get room numbers for the history notes
    let from_room_number = rq::room_number(&pool, room_id).await?;
    let to_room_number = rq::room_number(&pool, target_id).await?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    rq::execute_room_change_tx(
        &mut tx,
        rq::RoomChangeValues {
            booking_id,
            room_id,
            target_id,
            guest_id,
            reason: &reason,
            user_id,
            from_room_number: &from_room_number,
            to_room_number: &to_room_number,
        },
    )
    .await?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Audit log: room change
    let _ = AuditLog::log_event(
        &pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "room_changed",
            resource_type: "room",
            resource_id: Some(room_id),
            details: Some(serde_json::json!({
                "from_room_id": room_id,
                "from_room_number": from_room_number,
                "to_room_id": target_id,
                "to_room_number": to_room_number,
                "booking_id": booking_id,
                "guest_id": guest_id,
                "reason": reason
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Room change completed successfully",
        "from_room_id": room_id,
        "from_room_number": from_room_number,
        "to_room_id": target_id,
        "to_room_number": to_room_number,
        "booking_id": booking_id,
        "reason": reason
    })))
}

pub async fn get_room_change_history_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_permission_helper(&pool, &headers, "bookings:read").await?;

    let booking_id = params.get("booking_id").and_then(|v| v.parse::<i64>().ok());
    let guest_id = params.get("guest_id").and_then(|v| v.parse::<i64>().ok());
    let room_id = params.get("room_id").and_then(|v| v.parse::<i64>().ok());
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(50);

    let rows = rq::fetch_room_change_history(&pool, booking_id, guest_id, room_id, limit).await?;

    let changes: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.id,
                "booking_id": row.booking_id,
                "booking_number": row.booking_number,
                "from_room": {
                    "id": row.from_room_id,
                    "room_number": row.from_room_number,
                    "room_type": row.from_room_type
                },
                "to_room": {
                    "id": row.to_room_id,
                    "room_number": row.to_room_number,
                    "room_type": row.to_room_type
                },
                "guest": {
                    "id": row.guest_id,
                    "name": row.guest_name
                },
                "reason": row.reason,
                "changed_by": {
                    "id": row.changed_by,
                    "name": row.changed_by_name
                },
                "changed_at": row.changed_at
            })
        })
        .collect();

    Ok(Json(changes))
}

pub async fn create_room_event_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<RoomEventInput>,
) -> Result<Json<RoomEvent>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    let valid_types = vec!["reserved", "maintenance"];
    if !valid_types.contains(&input.event_type.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid event type. Must be one of: {:?}",
            valid_types
        )));
    }

    let valid_statuses = vec!["pending", "in_progress", "completed", "void"];
    if !valid_statuses.contains(&input.status.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid status. Must be one of: {:?}",
            valid_statuses
        )));
    }

    let scheduled_date = if let Some(date_str) = &input.scheduled_date {
        Some(
            NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                .map_err(|_| ApiError::BadRequest("Invalid date. Use YYYY-MM-DD".to_string()))?,
        )
    } else {
        None
    };

    let priority = input.priority.as_deref().unwrap_or("normal");

    let valid_priorities = vec!["low", "normal", "high", "urgent"];
    if !valid_priorities.contains(&priority) {
        return Err(ApiError::BadRequest(format!(
            "Invalid priority. Must be one of: {:?}",
            valid_priorities
        )));
    }

    let event = rq::insert_room_event_full(
        &pool,
        rq::RoomEventValues {
            room_id,
            event_type: &input.event_type,
            status: &input.status,
            priority,
            notes: &input.notes,
            scheduled_date,
            user_id,
        },
    )
    .await?;

    if input.event_type == "cleaning" || input.event_type == "maintenance" {
        let _ = rq::set_room_status_simple(&pool, &input.event_type, room_id).await;
    }

    Ok(Json(event))
}

pub async fn get_room_detailed_status_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<RoomDetailedStatus>, ApiError> {
    // `current_booking`/`next_booking` carry guest name, email and the full
    // financial state — the same data `bookings:read` guards everywhere else.
    // Login-only here let housekeeping/staff read every room's guests.
    require_permission_helper(&pool, &headers, "bookings:read").await?;

    let room_row = rq::fetch_room_detailed_status(&pool, room_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    let current_booking = rq::fetch_current_booking_for_room(&pool, room_id).await?;

    let next_booking = rq::fetch_next_booking_for_room(&pool, room_id).await?;

    // Query room_events if table exists, otherwise return empty list
    let recent_events = rq::fetch_room_events(&pool, room_id).await;

    let detailed_status = RoomDetailedStatus {
        id: room_row.id,
        room_number: room_row.room_number,
        room_type: room_row.room_type,
        status: room_row.status.unwrap_or_else(|| "available".to_string()),
        available: room_row.available,
        current_booking,
        next_booking,
        recent_events,
        maintenance_notes: room_row.notes,
        last_maintenance_date: room_row.last_cleaned_at,
        next_maintenance_date: room_row.last_inspected_at,
        reserved_start_date: room_row.reserved_start_date,
        reserved_end_date: room_row.reserved_end_date,
        maintenance_start_date: room_row.maintenance_start_date,
        maintenance_end_date: room_row.maintenance_end_date,
        cleaning_start_date: room_row.cleaning_start_date,
        cleaning_end_date: room_row.cleaning_end_date,
        target_room_id: room_row.connecting_room_id,
        status_notes: room_row.status_notes,
    };

    Ok(Json(detailed_status))
}

pub async fn get_room_history_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    // Room history is booking history: guest names, emails and stay financials.
    require_permission_helper(&pool, &headers, "bookings:read").await?;

    let history = match rq::fetch_room_history(&pool, room_id).await {
        Ok(rows) => rows,
        Err(ApiError::Database(msg))
            if msg.contains("relation") && msg.contains("does not exist") =>
        {
            return Ok(Json(vec![]));
        }
        Err(e) => return Err(e),
    };

    let history_json: Vec<serde_json::Value> = history
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.id.to_string(),
                "room_id": row.room_id.to_string(),
                "from_status": row.from_status,
                "to_status": row.to_status,
                "start_date": row.start_date.map(|d| d.to_rfc3339()),
                "end_date": row.end_date.map(|d| d.to_rfc3339()),
                "changed_by": row.changed_by.map(|id| id.to_string()),
                "changed_by_name": row.changed_by_name,
                "created_at": row.created_at.to_rfc3339(),
                "notes": row.notes,
                "is_auto_generated": row.is_auto_generated,
            })
        })
        .collect();

    Ok(Json(history_json))
}

pub async fn get_room_reviews_handler(
    State(pool): State<DbPool>,
    Path(room_type): Path<String>,
) -> Result<Json<Vec<GuestReview>>, ApiError> {
    let reviews = rq::fetch_room_reviews(&pool, &room_type).await?;
    Ok(Json(reviews))
}

// ==================== OCCUPANCY HANDLERS ====================
// These handlers provide automatic occupancy data derived from active bookings
// No manual input required - all computed from booking status

/// Get all rooms with their current occupancy status
pub async fn get_all_room_occupancy_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<RoomCurrentOccupancy>>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;

    let occupancy = rq::fetch_all_room_occupancy(&pool).await?;
    Ok(Json(occupancy))
}

/// Get occupancy for a specific room
pub async fn get_room_occupancy_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<RoomCurrentOccupancy>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;

    let occupancy = rq::fetch_room_occupancy(&pool, room_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    Ok(Json(occupancy))
}

/// Get hotel-wide occupancy summary
pub async fn get_hotel_occupancy_summary_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<HotelOccupancySummary>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;

    let summary = rq::fetch_hotel_occupancy_summary(&pool).await?;
    Ok(Json(summary))
}

/// Get occupancy breakdown by room type
pub async fn get_occupancy_by_room_type_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<OccupancyByRoomType>>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;

    let occupancy = rq::fetch_occupancy_by_room_type(&pool).await?;
    Ok(Json(occupancy))
}

/// Get rooms with their occupancy combined
pub async fn get_rooms_with_occupancy_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<RoomWithOccupancy>>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;

    let rooms_with_occupancy = rq::fetch_rooms_with_occupancy(&pool).await?;
    Ok(Json(rooms_with_occupancy))
}
