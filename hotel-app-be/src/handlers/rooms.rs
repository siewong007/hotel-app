//! Room handlers
//!
//! Handles room CRUD, status management, and events.

use crate::core::error::ApiError;
use crate::core::middleware::{require_auth, require_permission_helper};
use crate::models::*;
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use sqlx::{PgPool, Row};

pub async fn get_rooms_handler(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<RoomWithRating>>, ApiError> {
    // Compute room status dynamically based on current bookings
    // This ensures room management and reservation timeline show consistent status
    let rows = sqlx::query(
        r#"
        WITH current_bookings AS (
            -- Get the most relevant booking for each room based on today's date
            SELECT DISTINCT ON (room_id)
                room_id,
                status as booking_status,
                check_in_date,
                check_out_date
            FROM bookings
            WHERE status IN ('checked_in', 'confirmed', 'pending')
              AND check_out_date >= CURRENT_DATE
            ORDER BY room_id,
                -- Prioritize: checked_in > confirmed today > confirmed future
                CASE
                    WHEN status = 'checked_in' THEN 1
                    WHEN status = 'confirmed' AND check_in_date <= CURRENT_DATE THEN 2
                    WHEN status = 'confirmed' THEN 3
                    WHEN status = 'pending' AND check_in_date <= CURRENT_DATE THEN 4
                    ELSE 5
                END,
                check_in_date
        )
        SELECT
            r.id,
            r.room_number,
            rt.name as room_type,
            COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
            -- Compute availability based on dynamic status
            CASE
                WHEN cb.booking_status = 'checked_in' THEN false
                WHEN cb.booking_status IN ('confirmed', 'pending') AND cb.check_in_date <= CURRENT_DATE THEN false
                WHEN r.status IN ('maintenance', 'out_of_order', 'dirty') THEN false
                ELSE true
            END as available,
            rt.description,
            rt.max_occupancy,
            r.created_at,
            r.updated_at,
            NULL::DECIMAL as average_rating,
            NULL::BIGINT as review_count,
            -- Compute dynamic status based on bookings
            CASE
                WHEN cb.booking_status = 'checked_in' THEN 'occupied'
                WHEN cb.booking_status IN ('confirmed', 'pending') AND cb.check_in_date <= CURRENT_DATE THEN 'reserved'
                WHEN r.status IN ('maintenance', 'out_of_order', 'dirty', 'cleaning') THEN r.status
                ELSE 'available'
            END as status,
            r.maintenance_start_date,
            r.maintenance_end_date,
            r.cleaning_start_date,
            r.cleaning_end_date,
            r.reserved_start_date,
            r.reserved_end_date
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        LEFT JOIN current_bookings cb ON cb.room_id = r.id
        WHERE r.is_active = true
        ORDER BY r.room_number
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut rooms = Vec::new();
    for row in rows {
        let average_rating: Option<rust_decimal::Decimal> = row.try_get(9).ok();
        let review_count: Option<i64> = row.try_get(10).ok();
        let status: Option<String> = row.try_get(11).ok();
        let maintenance_start_date: Option<DateTime<Utc>> = row.try_get(12).ok();
        let maintenance_end_date: Option<DateTime<Utc>> = row.try_get(13).ok();
        let cleaning_start_date: Option<DateTime<Utc>> = row.try_get(14).ok();
        let cleaning_end_date: Option<DateTime<Utc>> = row.try_get(15).ok();
        let reserved_start_date: Option<DateTime<Utc>> = row.try_get(16).ok();
        let reserved_end_date: Option<DateTime<Utc>> = row.try_get(17).ok();

        rooms.push(RoomWithRating {
            id: row.get(0),
            room_number: row.get(1),
            room_type: row.get(2),
            price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
            available: row.get(4),
            description: row.get(5),
            max_occupancy: row.get(6),
            created_at: row.get(7),
            updated_at: row.get(8),
            average_rating: average_rating.map(|d| d.to_string().parse::<f64>().unwrap_or(0.0)),
            review_count,
            status,
            maintenance_start_date,
            maintenance_end_date,
            cleaning_start_date,
            cleaning_end_date,
            reserved_start_date,
            reserved_end_date,
        });
    }

    Ok(Json(rooms))
}

pub async fn search_rooms_handler(
    State(pool): State<PgPool>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<RoomWithRating>>, ApiError> {
    // Parse date range if provided for availability check
    let check_in: Option<NaiveDate> = query.check_in_date.as_ref()
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
    let check_out: Option<NaiveDate> = query.check_out_date.as_ref()
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());

    // Build query based on whether date range is provided
    let sql = if check_in.is_some() && check_out.is_some() {
        // Query with date range - check for conflicts in the specified period
        r#"
        WITH conflicting_bookings AS (
            SELECT DISTINCT room_id
            FROM bookings
            WHERE status NOT IN ('cancelled', 'no_show', 'checked_out')
              AND (
                  (check_in_date < $2 AND check_out_date > $1) -- Booking overlaps with requested dates
              )
        )
        SELECT
            r.id,
            r.room_number,
            rt.name as room_type,
            COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
            true as available,
            rt.description,
            rt.max_occupancy,
            r.created_at,
            r.updated_at,
            NULL::DECIMAL as average_rating,
            NULL::BIGINT as review_count,
            'available' as status,
            r.maintenance_start_date,
            r.maintenance_end_date,
            r.cleaning_start_date,
            r.cleaning_end_date,
            r.reserved_start_date,
            r.reserved_end_date
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        LEFT JOIN conflicting_bookings cb ON cb.room_id = r.id
        WHERE r.is_active = true
          AND r.status NOT IN ('maintenance', 'out_of_order')
          AND cb.room_id IS NULL
        ORDER BY COALESCE(r.custom_price, rt.base_price)
        "#
    } else {
        // Query without date range - show rooms available today
        r#"
        WITH current_bookings AS (
            SELECT DISTINCT ON (room_id)
                room_id,
                status as booking_status,
                check_in_date
            FROM bookings
            WHERE status IN ('checked_in', 'confirmed', 'pending')
              AND check_out_date >= CURRENT_DATE
            ORDER BY room_id,
                CASE
                    WHEN status = 'checked_in' THEN 1
                    WHEN status = 'confirmed' AND check_in_date <= CURRENT_DATE THEN 2
                    ELSE 3
                END,
                check_in_date
        )
        SELECT
            r.id,
            r.room_number,
            rt.name as room_type,
            COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
            true as available,
            rt.description,
            rt.max_occupancy,
            r.created_at,
            r.updated_at,
            NULL::DECIMAL as average_rating,
            NULL::BIGINT as review_count,
            'available' as status,
            r.maintenance_start_date,
            r.maintenance_end_date,
            r.cleaning_start_date,
            r.cleaning_end_date,
            r.reserved_start_date,
            r.reserved_end_date
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        LEFT JOIN current_bookings cb ON cb.room_id = r.id
        WHERE r.is_active = true
          AND r.status NOT IN ('maintenance', 'out_of_order')
          AND (cb.room_id IS NULL OR NOT (
              cb.booking_status = 'checked_in' OR
              (cb.booking_status IN ('confirmed', 'pending') AND cb.check_in_date <= CURRENT_DATE)
          ))
        ORDER BY COALESCE(r.custom_price, rt.base_price)
        "#
    };

    let rows = if let (Some(ci), Some(co)) = (check_in, check_out) {
        sqlx::query(sql)
            .bind(ci)
            .bind(co)
            .fetch_all(&pool)
            .await
    } else {
        sqlx::query(sql)
            .fetch_all(&pool)
            .await
    }
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut rooms = Vec::new();
    for row in rows {
        let average_rating: Option<rust_decimal::Decimal> = row.try_get(9).ok();
        let review_count: Option<i64> = row.try_get(10).ok();
        let status: Option<String> = row.try_get(11).ok();
        let maintenance_start_date: Option<DateTime<Utc>> = row.try_get(12).ok();
        let maintenance_end_date: Option<DateTime<Utc>> = row.try_get(13).ok();
        let cleaning_start_date: Option<DateTime<Utc>> = row.try_get(14).ok();
        let cleaning_end_date: Option<DateTime<Utc>> = row.try_get(15).ok();
        let reserved_start_date: Option<DateTime<Utc>> = row.try_get(16).ok();
        let reserved_end_date: Option<DateTime<Utc>> = row.try_get(17).ok();

        rooms.push(RoomWithRating {
            id: row.get(0),
            room_number: row.get(1),
            room_type: row.get(2),
            price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
            available: row.get(4),
            description: row.get(5),
            max_occupancy: row.get(6),
            created_at: row.get(7),
            updated_at: row.get(8),
            average_rating: average_rating.map(|d| d.to_string().parse::<f64>().unwrap_or(0.0)),
            review_count,
            status,
            maintenance_start_date,
            maintenance_end_date,
            cleaning_start_date,
            cleaning_end_date,
            reserved_start_date,
            reserved_end_date,
        });
    }

    Ok(Json(rooms))
}

pub async fn update_room_handler(
    State(pool): State<PgPool>,
    Path(room_id): Path<i64>,
    Json(input): Json<RoomUpdateInput>,
) -> Result<Json<Room>, ApiError> {
    // Check if room exists and get current values with JOIN to room_types
    let existing_row = sqlx::query(
        r#"
        SELECT r.id, r.room_number, rt.name as room_type,
               COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
               CASE WHEN r.status IN ('available', 'cleaning') THEN true ELSE false END as available,
               rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at, r.custom_price::text
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1
        "#
    )
    .bind(room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    let current_room_number: String = existing_row.get(1);
    let current_room_type: String = existing_row.get(2);
    let current_price: Decimal = existing_row.get::<String, _>(3).parse().unwrap_or_default();
    let current_available: bool = existing_row.get(4);
    let current_description: Option<String> = existing_row.get(5);
    let current_max_occupancy: i32 = existing_row.get(6);
    let current_status: Option<String> = existing_row.get(7);

    // Check if anything actually changed
    if input.room_number.is_none()
        && input.price_per_night.is_none()
        && input.available.is_none() {
        return Ok(Json(Room {
            id: existing_row.get(0),
            room_number: current_room_number,
            room_type: current_room_type,
            price_per_night: current_price,
            available: current_available,
            description: current_description,
            max_occupancy: current_max_occupancy,
            status: current_status,
            created_at: existing_row.get(8),
            updated_at: existing_row.get(9),
        }));
    }

    let room_number = input.room_number.as_ref().unwrap_or(&current_room_number);
    let custom_price = input.price_per_night
        .map(|p| rust_decimal::Decimal::from_f64_retain(p).unwrap_or_default());

    let new_status = if let Some(avail) = input.available {
        if avail { Some("available") } else { Some("out_of_order") }
    } else {
        None
    };

    // Check if trying to set room as available while there's an active booking
    if new_status == Some("available") {
        let active_booking: Option<i64> = sqlx::query_scalar(
            r#"
            SELECT id FROM bookings
            WHERE room_id = $1
            AND status = 'checked_in'
            AND check_in_date <= CURRENT_DATE
            AND check_out_date >= CURRENT_DATE
            LIMIT 1
            "#
        )
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        if active_booking.is_some() {
            return Err(ApiError::BadRequest(
                "Cannot set room as available for booking while there is an active booking. Please check out the guest first.".to_string()
            ));
        }
    }

    if let Some(status) = new_status {
        sqlx::query(
            r#"
            UPDATE rooms
            SET room_number = $1,
                custom_price = $2,
                status = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            "#
        )
        .bind(room_number)
        .bind(custom_price)
        .bind(status)
        .bind(room_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    } else {
        sqlx::query(
            r#"
            UPDATE rooms
            SET room_number = $1,
                custom_price = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            "#
        )
        .bind(room_number)
        .bind(custom_price)
        .bind(room_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    let row = sqlx::query(
        r#"
        SELECT r.id, r.room_number, rt.name as room_type,
               COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
               CASE WHEN r.status IN ('available', 'cleaning') THEN true ELSE false END as available,
               rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1
        "#
    )
    .bind(room_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(Room {
        id: row.get(0),
        room_number: row.get(1),
        room_type: row.get(2),
        price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
        available: row.get(4),
        description: row.get(5),
        max_occupancy: row.get(6),
        status: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
    }))
}

pub async fn create_room_handler(
    State(pool): State<PgPool>,
    Json(input): Json<RoomCreateInput>,
) -> Result<Json<Room>, ApiError> {
    use rust_decimal::Decimal;

    let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM rooms WHERE room_number = $1")
        .bind(&input.room_number)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if existing.is_some() {
        return Err(ApiError::BadRequest(format!("Room number '{}' already exists", input.room_number)));
    }

    let room_type_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM room_types WHERE id = $1")
        .bind(input.room_type_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if room_type_exists.is_none() {
        return Err(ApiError::BadRequest("Invalid room_type_id".to_string()));
    }

    let custom_price_decimal = input.custom_price
        .map(|p| Decimal::from_f64_retain(p).unwrap_or_default());

    let room_id: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO rooms (room_number, room_type_id, floor, building, custom_price, is_accessible, status, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, 'available', true)
        RETURNING id
        "#
    )
    .bind(&input.room_number)
    .bind(input.room_type_id)
    .bind(input.floor)
    .bind(&input.building)
    .bind(custom_price_decimal)
    .bind(input.is_accessible.unwrap_or(false))
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let row = sqlx::query(
        r#"
        SELECT r.id, r.room_number, rt.name as room_type,
               COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
               CASE WHEN r.status IN ('available', 'cleaning') THEN true ELSE false END as available,
               rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1
        "#
    )
    .bind(room_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(Room {
        id: row.get(0),
        room_number: row.get(1),
        room_type: row.get(2),
        price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
        available: row.get(4),
        description: row.get(5),
        max_occupancy: row.get(6),
        status: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
    }))
}

pub async fn delete_room_handler(
    State(pool): State<PgPool>,
    Path(room_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let room_exists: Option<i64> = sqlx::query_scalar("SELECT id FROM rooms WHERE id = $1")
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if room_exists.is_none() {
        return Err(ApiError::NotFound("Room not found".to_string()));
    }

    let has_bookings: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM bookings WHERE room_id = $1 LIMIT 1"
    )
    .bind(room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if has_bookings.is_some() {
        return Err(ApiError::BadRequest(
            "Cannot delete room with existing bookings. Please cancel all bookings first.".to_string()
        ));
    }

    sqlx::query("DELETE FROM rooms WHERE id = $1")
        .bind(room_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Room deleted successfully"
    })))
}

pub async fn get_room_types_handler(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    let room_types: Vec<RoomType> = sqlx::query_as(
        r#"
        SELECT id, name, code, description, base_price, max_occupancy, is_active, created_at, updated_at
        FROM room_types
        WHERE is_active = true
        ORDER BY name
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let result: Vec<serde_json::Value> = room_types
        .into_iter()
        .map(|rt| {
            serde_json::json!({
                "id": rt.id,
                "name": rt.name,
                "code": rt.code,
                "base_price": rt.base_price
            })
        })
        .collect();

    Ok(Json(result))
}

pub async fn update_room_status_handler(
    State(pool): State<PgPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<RoomStatusUpdateInput>,
) -> Result<Json<Room>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    let valid_statuses = vec!["available", "occupied", "cleaning", "maintenance", "reserved", "dirty", "clean"];
    if !valid_statuses.contains(&input.status.as_str()) {
        return Err(ApiError::BadRequest(format!("Invalid status. Must be one of: {:?}", valid_statuses)));
    }

    // Map "clean" to "available" for consistency
    let target_status = if input.status == "clean" { "available".to_string() } else { input.status.clone() };

    // Get current status to check if we're transitioning from a protected status
    let current_status_check: Option<String> = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // If transitioning from dirty/cleaning/maintenance to available, we need to include
    // the magic marker in status_notes to bypass the database trigger protection
    let needs_bypass_marker = current_status_check
        .as_ref()
        .map(|s| ["dirty", "cleaning", "maintenance", "out_of_order"].contains(&s.as_str()))
        .unwrap_or(false)
        && target_status == "available";

    let status_notes = if needs_bypass_marker {
        Some(format!("{} [via update_room_status]", input.notes.as_deref().unwrap_or("Status updated")))
    } else {
        input.notes.clone()
    };

    let current_status: Option<String> = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if target_status == "available" {
        let active_booking: Option<i64> = sqlx::query_scalar(
            r#"
            SELECT id FROM bookings
            WHERE room_id = $1
            AND status = 'checked_in'
            AND check_in_date <= CURRENT_DATE
            AND check_out_date >= CURRENT_DATE
            LIMIT 1
            "#
        )
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        if active_booking.is_some() {
            return Err(ApiError::BadRequest(
                "Cannot change room to available status while there is an active booking. Please check out the guest first.".to_string()
            ));
        }
    }

    // Require booking_id when setting status to "reserved"
    // This ensures guest details are captured through the booking flow
    if target_status == "reserved" {
        if input.booking_id.is_none() {
            return Err(ApiError::BadRequest(
                "Cannot reserve a room directly. Please create a booking with guest details first. Use the 'Book Room' or 'Walk-in Check-in' option instead.".to_string()
            ));
        }

        // Verify the booking exists and is valid
        let booking_exists: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM bookings WHERE id = $1 AND room_id = $2 AND status IN ('confirmed', 'pending')"
        )
        .bind(input.booking_id)
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        if booking_exists.is_none() {
            return Err(ApiError::BadRequest(
                "Invalid booking_id or booking is not for this room.".to_string()
            ));
        }
    }

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
                return nd.and_hms_opt(0, 0, 0).map(|ndt| DateTime::<Utc>::from_naive_utc_and_offset(ndt, Utc));
            }
            None
        })
    };

    let reserved_start = parse_datetime(&input.reserved_start_date);
    let reserved_end = parse_datetime(&input.reserved_end_date);
    let maintenance_start = parse_datetime(&input.maintenance_start_date);
    let maintenance_end = parse_datetime(&input.maintenance_end_date);
    let cleaning_start = parse_datetime(&input.cleaning_start_date);
    let cleaning_end = parse_datetime(&input.cleaning_end_date);

    sqlx::query(
        r#"
        UPDATE rooms
        SET status = $1,
            notes = COALESCE($2, notes),
            status_notes = $3,
            reserved_start_date = $4,
            reserved_end_date = $5,
            maintenance_start_date = $6,
            maintenance_end_date = $7,
            cleaning_start_date = $8,
            cleaning_end_date = $9,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $10
        "#
    )
    .bind(&target_status)
    .bind(&input.notes)
    .bind(&status_notes)
    .bind(&reserved_start)
    .bind(&reserved_end)
    .bind(&maintenance_start)
    .bind(&maintenance_end)
    .bind(&cleaning_start)
    .bind(&cleaning_end)
    .bind(room_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Insert room history record
    let history_start = reserved_start.or(maintenance_start).or(cleaning_start);
    let history_end = reserved_end.or(maintenance_end).or(cleaning_end);

    let _ = sqlx::query(
        r#"
        INSERT INTO room_history (
            room_id, from_status, to_status,
            start_date, end_date, changed_by, notes, is_auto_generated
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, false)
        "#
    )
    .bind(room_id)
    .bind(&current_status)
    .bind(&target_status)
    .bind(&history_start)
    .bind(&history_end)
    .bind(user_id)
    .bind(&input.notes)
    .execute(&pool)
    .await;

    // Create event log
    let _ = sqlx::query(
        r#"
        INSERT INTO room_events (room_id, event_type, status, priority, notes, created_by)
        VALUES ($1, 'status_change', 'completed', 'normal', $2, $3)
        "#
    )
    .bind(room_id)
    .bind(format!("Status changed to: {}", target_status))
    .bind(user_id)
    .execute(&pool)
    .await;

    let row = sqlx::query(
        r#"
        SELECT r.id, r.room_number, rt.name as room_type,
               COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
               CASE WHEN r.status IN ('available', 'cleaning') THEN true ELSE false END as available,
               rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1
        "#
    )
    .bind(room_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(Room {
        id: row.get(0),
        room_number: row.get(1),
        room_type: row.get(2),
        price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
        available: row.get(4),
        description: row.get::<Option<String>, _>(5),
        max_occupancy: row.get(6),
        status: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
    }))
}

pub async fn end_maintenance_handler(
    State(pool): State<PgPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Room>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    let current_status: Option<String> = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if current_status.is_none() {
        return Err(ApiError::NotFound("Room not found".to_string()));
    }

    let status = current_status.as_ref().unwrap();
    if status == "available" {
        sqlx::query(
            r#"
            UPDATE rooms
            SET maintenance_start_date = NULL,
                maintenance_end_date = NULL,
                cleaning_start_date = NULL,
                cleaning_end_date = NULL,
                reserved_start_date = NULL,
                reserved_end_date = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            "#
        )
        .bind(room_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        let row = sqlx::query(
            r#"
            SELECT r.id, r.room_number, rt.name as room_type,
                   COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
                   CASE WHEN r.status IN ('available', 'cleaning') THEN true ELSE false END as available,
                   rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at
            FROM rooms r
            INNER JOIN room_types rt ON r.room_type_id = rt.id
            WHERE r.id = $1
            "#
        )
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        return Ok(Json(Room {
            id: row.get(0),
            room_number: row.get(1),
            room_type: row.get(2),
            price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
            available: row.get(4),
            description: row.get::<Option<String>, _>(5),
            max_occupancy: row.get(6),
            status: row.get(7),
            created_at: row.get(8),
            updated_at: row.get(9),
        }));
    }

    if status == "occupied" {
        return Err(ApiError::BadRequest(
            "Cannot clear status for occupied room. Please check out the guest first.".to_string()
        ));
    }

    sqlx::query(
        r#"
        UPDATE rooms
        SET status = 'available',
            maintenance_start_date = NULL,
            maintenance_end_date = NULL,
            cleaning_start_date = NULL,
            cleaning_end_date = NULL,
            reserved_start_date = NULL,
            reserved_end_date = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        "#
    )
    .bind(room_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let status_label = current_status.as_ref().unwrap_or(&"unknown".to_string()).clone();
    let _ = sqlx::query(
        r#"
        INSERT INTO room_history (
            room_id, from_status, to_status, changed_by, notes, is_auto_generated
        )
        VALUES ($1, $2, 'available', $3, $4, false)
        "#
    )
    .bind(room_id)
    .bind(&current_status)
    .bind(user_id)
    .bind(format!("{} completed and room returned to available", status_label))
    .execute(&pool)
    .await;

    let _ = sqlx::query(
        r#"
        INSERT INTO room_events (room_id, event_type, status, priority, notes, created_by)
        VALUES ($1, 'status_change', 'completed', 'normal', $2, $3)
        "#
    )
    .bind(room_id)
    .bind(format!("Ended {} - Room available", status_label))
    .bind(user_id)
    .execute(&pool)
    .await;

    let row = sqlx::query(
        r#"
        SELECT r.id, r.room_number, rt.name as room_type,
               COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
               CASE WHEN r.status IN ('available', 'cleaning') THEN true ELSE false END as available,
               rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1
        "#
    )
    .bind(room_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(Room {
        id: row.get(0),
        room_number: row.get(1),
        room_type: row.get(2),
        price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
        available: row.get(4),
        description: row.get::<Option<String>, _>(5),
        max_occupancy: row.get(6),
        status: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
    }))
}

pub async fn end_cleaning_handler(
    State(pool): State<PgPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    let current_status: Option<String> = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if let Some(status) = &current_status {
        if status != "cleaning" {
            return Err(ApiError::BadRequest(
                format!("Room is not in cleaning status. Current status: {}. Only rooms in 'cleaning' status can be marked as cleaned.", status)
            ));
        }
    } else {
        return Err(ApiError::NotFound("Room not found".to_string()));
    }

    let next_status: String = sqlx::query_scalar("SELECT get_room_next_status($1)")
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(
        r#"
        UPDATE rooms
        SET status = $1,
            cleaning_start_date = NULL,
            cleaning_end_date = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        "#
    )
    .bind(&next_status)
    .bind(room_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let _ = sqlx::query(
        r#"
        INSERT INTO room_history (
            room_id, from_status, to_status, changed_by, notes, is_auto_generated
        )
        VALUES ($1, 'cleaning', $2, $3, 'Cleaning completed by staff', false)
        "#
    )
    .bind(room_id)
    .bind(&next_status)
    .bind(user_id)
    .execute(&pool)
    .await;

    let _ = sqlx::query(
        r#"
        INSERT INTO room_events (room_id, event_type, status, priority, notes, created_by)
        VALUES ($1, 'status_change', 'completed', 'normal', $2, $3)
        "#
    )
    .bind(room_id)
    .bind(format!("Cleaning completed - Room now {}", next_status))
    .bind(user_id)
    .execute(&pool)
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
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    let rows = sqlx::query("SELECT * FROM sync_all_room_statuses()")
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut changes = Vec::new();
    for row in &rows {
        changes.push(serde_json::json!({
            "room_id": row.get::<i64, _>("room_id"),
            "room_number": row.get::<String, _>("room_number"),
            "old_status": row.get::<String, _>("old_status"),
            "new_status": row.get::<String, _>("new_status"),
        }));
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "synced_count": rows.len(),
        "changes": changes,
        "message": if rows.len() > 0 {
            format!("Successfully synchronized {} room(s)", rows.len())
        } else {
            "All room statuses are already consistent".to_string()
        }
    })))
}

pub async fn execute_room_change_handler(
    State(pool): State<PgPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
    Json(target_room_id): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:update").await?;

    let target_id: i64 = target_room_id.get("target_room_id")
        .and_then(|v| {
            v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
        .ok_or_else(|| ApiError::BadRequest("Invalid target_room_id".to_string()))?;

    let booking: Option<(i64, i64)> = sqlx::query_as(
        "SELECT id, guest_id FROM bookings WHERE room_id = $1 AND status IN ('confirmed', 'checked_in') ORDER BY created_at DESC LIMIT 1"
    )
    .bind(room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let (booking_id, guest_id) = booking.ok_or_else(||
        ApiError::BadRequest("No active booking found for this room. Room must have a confirmed or checked-in guest.".to_string())
    )?;

    let target_available: bool = sqlx::query_scalar(
        "SELECT status = 'available' AND is_active = true FROM rooms WHERE id = $1"
    )
    .bind(target_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !target_available {
        return Err(ApiError::BadRequest("Target room is not available".to_string()));
    }

    let mut tx = pool.begin().await.map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query("UPDATE bookings SET room_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
        .bind(target_id)
        .bind(booking_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(
        "UPDATE rooms SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = $1"
    )
    .bind(room_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(
        "UPDATE rooms SET status = 'occupied', updated_at = CURRENT_TIMESTAMP WHERE id = $1"
    )
    .bind(target_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(
        r#"
        INSERT INTO room_changes (booking_id, from_room_id, to_room_id, guest_id, reason, changed_by)
        VALUES ($1, $2, $3, $4, 'Room change requested', $5)
        "#
    )
    .bind(booking_id)
    .bind(room_id)
    .bind(target_id)
    .bind(guest_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(
        r#"
        INSERT INTO room_history (
            room_id, from_status, to_status,
            changed_by, notes, is_auto_generated
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#
    )
    .bind(room_id)
    .bind("occupied")
    .bind("available")
    .bind(user_id)
    .bind(format!("Guest moved to room {} (booking: {})", target_id, booking_id))
    .bind(false)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(
        r#"
        INSERT INTO room_history (
            room_id, from_status, to_status,
            changed_by, notes, is_auto_generated
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#
    )
    .bind(target_id)
    .bind("available")
    .bind("occupied")
    .bind(user_id)
    .bind(format!("Guest moved from room {} (booking: {})", room_id, booking_id))
    .bind(false)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    tx.commit().await.map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Room change completed successfully",
        "from_room_id": room_id,
        "to_room_id": target_id,
        "booking_id": booking_id
    })))
}

pub async fn create_room_event_handler(
    State(pool): State<PgPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<RoomEventInput>,
) -> Result<Json<RoomEvent>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    let valid_types = vec!["reserved", "cleaning", "maintenance"];
    if !valid_types.contains(&input.event_type.as_str()) {
        return Err(ApiError::BadRequest(format!("Invalid event type. Must be one of: {:?}", valid_types)));
    }

    let valid_statuses = vec!["pending", "in_progress", "completed", "cancelled"];
    if !valid_statuses.contains(&input.status.as_str()) {
        return Err(ApiError::BadRequest(format!("Invalid status. Must be one of: {:?}", valid_statuses)));
    }

    let scheduled_date = if let Some(date_str) = &input.scheduled_date {
        Some(NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|_| ApiError::BadRequest("Invalid date format. Use YYYY-MM-DD".to_string()))?)
    } else {
        None
    };

    let priority = input.priority.as_deref().unwrap_or("normal");

    let valid_priorities = vec!["low", "normal", "high", "urgent"];
    if !valid_priorities.contains(&priority) {
        return Err(ApiError::BadRequest(format!("Invalid priority. Must be one of: {:?}", valid_priorities)));
    }

    let row = sqlx::query(
        r#"
        INSERT INTO room_events (room_id, event_type, status, priority, notes, scheduled_date, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, room_id, event_type, status, priority, notes, scheduled_date, created_by, created_at, updated_at
        "#
    )
    .bind(room_id)
    .bind(&input.event_type)
    .bind(&input.status)
    .bind(priority)
    .bind(&input.notes)
    .bind(scheduled_date)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let event = RoomEvent {
        id: row.get(0),
        room_id: row.get(1),
        event_type: row.get(2),
        status: row.get(3),
        priority: row.get(4),
        notes: row.get(5),
        scheduled_date: row.get(6),
        created_by: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
    };

    if input.event_type == "cleaning" || input.event_type == "maintenance" {
        let _ = sqlx::query(
            "UPDATE rooms SET status = $1 WHERE id = $2"
        )
        .bind(&input.event_type)
        .bind(room_id)
        .execute(&pool)
        .await;
    }

    Ok(Json(event))
}

pub async fn get_room_detailed_status_handler(
    State(pool): State<PgPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<RoomDetailedStatus>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let room_row = sqlx::query(
        r#"
        SELECT r.id, r.room_number, rt.name as room_type, r.status,
               CASE WHEN r.status IN ('available', 'cleaning') THEN true ELSE false END as available,
               r.notes, r.last_cleaned_at, r.last_inspected_at,
               r.reserved_start_date, r.reserved_end_date,
               r.maintenance_start_date, r.maintenance_end_date,
               r.cleaning_start_date, r.cleaning_end_date,
               r.connecting_room_id, r.status_notes
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1
        "#
    )
    .bind(room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    let status: Option<String> = room_row.try_get(3).ok();
    let available: bool = room_row.try_get(4).unwrap_or(false);
    let maintenance_notes: Option<String> = room_row.try_get(5).ok(); // now 'notes' column
    let last_maintenance_date: Option<DateTime<Utc>> = room_row.try_get(6).ok(); // now 'last_cleaned_at'
    let next_maintenance_date: Option<DateTime<Utc>> = room_row.try_get(7).ok(); // now 'last_inspected_at'
    let reserved_start_date: Option<DateTime<Utc>> = room_row.try_get(8).ok();
    let reserved_end_date: Option<DateTime<Utc>> = room_row.try_get(9).ok();
    let maintenance_start_date: Option<DateTime<Utc>> = room_row.try_get(10).ok();
    let maintenance_end_date: Option<DateTime<Utc>> = room_row.try_get(11).ok();
    let cleaning_start_date: Option<DateTime<Utc>> = room_row.try_get(12).ok();
    let cleaning_end_date: Option<DateTime<Utc>> = room_row.try_get(13).ok();
    let target_room_id: Option<i64> = room_row.try_get(14).ok();
    let status_notes: Option<String> = room_row.try_get(15).ok();

    let current_booking = sqlx::query_as::<_, BookingWithDetails>(
        r#"
        SELECT b.id, b.guest_id, g.full_name as guest_name, g.email as guest_email,
               b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
               b.check_in_date, b.check_out_date, b.total_amount, b.status,
               b.booking_number, NULL::VARCHAR as post_type, NULL::VARCHAR as rate_code, b.created_at
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.room_id = $1
          AND b.status NOT IN ('cancelled', 'checked_out')
          AND b.check_in_date <= CURRENT_DATE
          AND b.check_out_date > CURRENT_DATE
        ORDER BY b.check_in_date DESC
        LIMIT 1
        "#
    )
    .bind(room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let next_booking = sqlx::query_as::<_, BookingWithDetails>(
        r#"
        SELECT b.id, b.guest_id, g.full_name as guest_name, g.email as guest_email,
               b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
               b.check_in_date, b.check_out_date, b.total_amount, b.status,
               b.booking_number, NULL::VARCHAR as post_type, NULL::VARCHAR as rate_code, b.created_at
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.room_id = $1
          AND b.status = 'confirmed'
          AND b.check_in_date > CURRENT_DATE
        ORDER BY b.check_in_date ASC
        LIMIT 1
        "#
    )
    .bind(room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Query room_events if table exists, otherwise return empty list
    let recent_events = sqlx::query_as::<_, RoomEvent>(
        r#"
        SELECT id, room_id, event_type, status, priority, notes, scheduled_date, created_by, created_at, updated_at
        FROM room_events
        WHERE room_id = $1
        ORDER BY created_at DESC
        LIMIT 10
        "#
    )
    .bind(room_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let detailed_status = RoomDetailedStatus {
        id: room_row.get(0),
        room_number: room_row.get(1),
        room_type: room_row.get(2),
        status: status.unwrap_or_else(|| "available".to_string()),
        available,
        current_booking,
        next_booking,
        recent_events,
        maintenance_notes,
        last_maintenance_date,
        next_maintenance_date,
        reserved_start_date,
        reserved_end_date,
        maintenance_start_date,
        maintenance_end_date,
        cleaning_start_date,
        cleaning_end_date,
        target_room_id,
        status_notes,
    };

    Ok(Json(detailed_status))
}

pub async fn get_room_history_handler(
    State(pool): State<PgPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let history = match sqlx::query(
        r#"
        SELECT
            rh.id,
            rh.room_id,
            rh.from_status,
            rh.to_status,
            rh.start_date,
            rh.end_date,
            rh.changed_by,
            u.full_name as changed_by_name,
            rh.created_at,
            rh.notes,
            rh.is_auto_generated
        FROM room_history rh
        LEFT JOIN users u ON rh.changed_by = u.id
        WHERE rh.room_id = $1
        ORDER BY rh.created_at DESC
        LIMIT 50
        "#
    )
    .bind(room_id)
    .fetch_all(&pool)
    .await {
        Ok(rows) => rows,
        Err(e) => {
            if e.to_string().contains("relation") && e.to_string().contains("does not exist") {
                return Ok(Json(vec![]));
            }
            return Err(ApiError::Database(e.to_string()));
        }
    };

    let history_json: Vec<serde_json::Value> = history
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<i64, _>("id").to_string(),
                "room_id": row.get::<i64, _>("room_id").to_string(),
                "from_status": row.get::<Option<String>, _>("from_status"),
                "to_status": row.get::<String, _>("to_status"),
                "start_date": row.get::<Option<chrono::NaiveDateTime>, _>("start_date").map(|d| d.to_string()),
                "end_date": row.get::<Option<chrono::NaiveDateTime>, _>("end_date").map(|d| d.to_string()),
                "changed_by": row.get::<Option<i64>, _>("changed_by").map(|id| id.to_string()),
                "changed_by_name": row.get::<Option<String>, _>("changed_by_name"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
                "notes": row.get::<Option<String>, _>("notes"),
                "is_auto_generated": row.get::<bool, _>("is_auto_generated"),
            })
        })
        .collect();

    Ok(Json(history_json))
}

pub async fn get_room_reviews_handler(
    State(pool): State<PgPool>,
    Path(room_type): Path<String>,
) -> Result<Json<Vec<GuestReview>>, ApiError> {
    let reviews = sqlx::query_as::<_, GuestReview>(
        r#"
        SELECT
            gr.id,
            gr.guest_id,
            g.full_name as guest_name,
            gr.room_type_id,
            gr.overall_rating,
            gr.cleanliness_rating,
            gr.staff_rating,
            gr.facilities_rating,
            gr.value_rating,
            gr.location_rating,
            gr.title,
            gr.review_text,
            gr.pros,
            gr.cons,
            gr.recommend,
            gr.stay_type,
            gr.is_verified,
            gr.helpful_count,
            gr.created_at
        FROM guest_reviews gr
        INNER JOIN guests g ON gr.guest_id = g.id
        INNER JOIN room_types rt ON gr.room_type_id = rt.id
        WHERE rt.name = $1 AND gr.is_published = true
        ORDER BY gr.created_at DESC
        "#
    )
    .bind(&room_type)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(reviews))
}

// ==================== OCCUPANCY HANDLERS ====================
// These handlers provide automatic occupancy data derived from active bookings
// No manual input required - all computed from booking status

/// Get all rooms with their current occupancy status
pub async fn get_all_room_occupancy_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<RoomCurrentOccupancy>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let occupancy = sqlx::query_as::<_, RoomCurrentOccupancy>(
        r#"
        SELECT
            room_id,
            room_number,
            room_type_id,
            room_type_name,
            max_occupancy,
            room_status,
            current_adults,
            current_children,
            current_infants,
            current_total_guests,
            occupancy_percentage,
            current_booking_id,
            current_booking_number,
            current_guest_id,
            check_in_date,
            check_out_date,
            is_occupied
        FROM room_current_occupancy
        ORDER BY room_number
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(occupancy))
}

/// Get occupancy for a specific room
pub async fn get_room_occupancy_handler(
    State(pool): State<PgPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<RoomCurrentOccupancy>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let occupancy = sqlx::query_as::<_, RoomCurrentOccupancy>(
        r#"
        SELECT
            room_id,
            room_number,
            room_type_id,
            room_type_name,
            max_occupancy,
            room_status,
            current_adults,
            current_children,
            current_infants,
            current_total_guests,
            occupancy_percentage,
            current_booking_id,
            current_booking_number,
            current_guest_id,
            check_in_date,
            check_out_date,
            is_occupied
        FROM room_current_occupancy
        WHERE room_id = $1
        "#
    )
    .bind(room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    Ok(Json(occupancy))
}

/// Get hotel-wide occupancy summary
pub async fn get_hotel_occupancy_summary_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<HotelOccupancySummary>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let summary = sqlx::query_as::<_, HotelOccupancySummary>(
        r#"
        SELECT
            total_rooms,
            occupied_rooms,
            available_rooms,
            occupancy_rate,
            total_adults,
            total_children,
            total_infants,
            total_guests,
            total_capacity,
            guest_occupancy_rate
        FROM hotel_occupancy_summary
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(summary))
}

/// Get occupancy breakdown by room type
pub async fn get_occupancy_by_room_type_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<OccupancyByRoomType>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let occupancy = sqlx::query_as::<_, OccupancyByRoomType>(
        r#"
        SELECT
            room_type_id,
            room_type_name,
            capacity_per_room,
            total_rooms,
            occupied_rooms,
            room_occupancy_rate,
            total_guests,
            total_capacity,
            guest_occupancy_rate
        FROM occupancy_by_room_type
        ORDER BY room_type_name
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(occupancy))
}

/// Get rooms with their occupancy combined
pub async fn get_rooms_with_occupancy_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<RoomWithOccupancy>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let rows = sqlx::query(
        r#"
        SELECT
            r.id,
            r.room_number,
            rt.name as room_type,
            COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
            CASE WHEN r.status IN ('available', 'cleaning') THEN true ELSE false END as available,
            rt.description,
            rt.max_occupancy,
            r.status,
            r.created_at,
            r.updated_at,
            COALESCE(rco.current_adults, 0) as current_adults,
            COALESCE(rco.current_children, 0) as current_children,
            COALESCE(rco.current_infants, 0) as current_infants,
            COALESCE(rco.current_total_guests, 0) as current_total_guests,
            COALESCE(rco.is_occupied, false) as is_occupied,
            rco.current_booking_id,
            rco.current_guest_id
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        LEFT JOIN room_current_occupancy rco ON r.id = rco.room_id
        WHERE r.is_active = true
        ORDER BY r.room_number
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut rooms_with_occupancy = Vec::new();
    for row in rows {
        let room = Room {
            id: row.get(0),
            room_number: row.get(1),
            room_type: row.get(2),
            price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
            available: row.get(4),
            description: row.get(5),
            max_occupancy: row.get(6),
            status: row.get(7),
            created_at: row.get(8),
            updated_at: row.get(9),
        };

        rooms_with_occupancy.push(RoomWithOccupancy {
            room,
            current_adults: row.get(10),
            current_children: row.get(11),
            current_infants: row.get(12),
            current_total_guests: row.get(13),
            is_occupied: row.get(14),
            current_booking_id: row.get(15),
            current_guest_id: row.get(16),
        });
    }

    Ok(Json(rooms_with_occupancy))
}
