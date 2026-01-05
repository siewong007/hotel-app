//! Booking handlers
//!
//! Handles booking CRUD, check-in/out, and pre-check-in.

use crate::core::auth::AuthService;
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::models::*;
use crate::services::audit::AuditLog;
use axum::{
    extract::{Extension, Path, State},
    http::HeaderMap,
    response::Json,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Deserialize;
use sqlx::{PgPool, Row};

fn parse_date_flexible(date_str: &str) -> Result<NaiveDate, String> {
    if date_str.contains('T') {
        let date_part = date_str.split('T').next().unwrap_or(date_str);
        NaiveDate::parse_from_str(date_part, "%Y-%m-%d")
            .map_err(|e| format!("Invalid date format: {}", e))
    } else {
        NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|e| format!("Invalid date format: {}", e))
    }
}

pub async fn get_bookings_handler(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<BookingWithDetails>>, ApiError> {
    let bookings: Vec<BookingWithDetails> = sqlx::query_as(
        r#"
        SELECT
            b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
            g.guest_type::text as guest_type,
            b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
            b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
            b.payment_status, b.source, b.is_complimentary, b.complimentary_reason,
            b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
            b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
            b.created_at, b.is_posted, b.posted_date
        FROM bookings b
        INNER JOIN guests g ON b.guest_id = g.id
        INNER JOIN rooms r ON b.room_id = r.id
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        ORDER BY b.created_at DESC
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(bookings))
}

pub async fn get_my_bookings_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<BookingWithDetails>>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let user_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let bookings: Vec<BookingWithDetails> = sqlx::query_as(
        r#"
        SELECT
            b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
            g.guest_type::text as guest_type,
            b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
            b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
            b.payment_status, b.source, b.is_complimentary, b.complimentary_reason,
            b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
            b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
            b.created_at, b.is_posted, b.posted_date
        FROM bookings b
        INNER JOIN guests g ON b.guest_id = g.id
        INNER JOIN rooms r ON b.room_id = r.id
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE g.email = $1
        ORDER BY b.created_at DESC
        "#
    )
    .bind(&user_email)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(bookings))
}

pub async fn create_booking_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<BookingInput>,
) -> Result<Json<Booking>, ApiError> {
    let check_in = parse_date_flexible(&input.check_in_date)
        .map_err(|_| ApiError::BadRequest("Invalid check-in date format".to_string()))?;
    let check_out = parse_date_flexible(&input.check_out_date)
        .map_err(|_| ApiError::BadRequest("Invalid check-out date format".to_string()))?;

    if check_out <= check_in {
        return Err(ApiError::BadRequest("Check-out date must be after check-in date".to_string()));
    }

    let row = sqlx::query(
        r#"
        SELECT r.id, r.room_number, rt.name as room_type,
               COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
               CASE WHEN r.status IN ('available', 'reserved', 'cleaning', 'dirty') THEN true ELSE false END as available,
               rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1 AND r.is_active = true
        FOR UPDATE OF r
        "#
    )
    .bind(input.room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

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

    if !room.available {
        return Err(ApiError::BadRequest("Room is not available".to_string()));
    }

    // Only check for ACTIVE bookings that would conflict
    // Active statuses: reserved, confirmed, checked_in, pending
    // Inactive statuses (don't block): cancelled, no_show, checked_out, completed
    let conflict = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = $1 AND status IN ('reserved', 'confirmed', 'checked_in', 'pending')
            AND ((check_in_date <= $2 AND check_out_date > $2)
                OR (check_in_date < $3 AND check_out_date >= $3)
                OR (check_in_date >= $2 AND check_out_date <= $3))
        )
        "#
    )
    .bind(input.room_id)
    .bind(check_in)
    .bind(check_out)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if conflict {
        return Err(ApiError::BadRequest("Room is already booked for these dates".to_string()));
    }

    let nights = (check_out - check_in).num_days() as i32;
    let room_rate = room.price_per_night;
    // The configured room price is tax-inclusive (final price)
    // Store total_amount as the configured price × nights without adding additional tax
    let subtotal = room_rate * Decimal::from(nights);
    let tax_amount = Decimal::ZERO; // Tax is calculated on frontend using hotel settings rate
    let total_amount = subtotal; // Configured price is the final price

    // Use provided booking_number for online bookings, or auto-generate for walk-ins
    let booking_number = match &input.booking_number {
        Some(bn) if !bn.trim().is_empty() => bn.trim().to_string(),
        _ => format!("BK-{}-{:04}", chrono::Utc::now().format("%Y%m%d"),
            sqlx::query_scalar::<_, i64>("SELECT nextval('bookings_id_seq')")
                .fetch_one(&pool).await.unwrap_or(1)
        )
    };

    let source = input.source.clone().unwrap_or_else(|| "walk_in".to_string());

    let deposit_paid = input.deposit_paid.unwrap_or(false);
    let deposit_amount = input.deposit_amount.map(|d| Decimal::from_f64_retain(d).unwrap_or(Decimal::ZERO));
    let payment_status = input.payment_status.clone().unwrap_or_else(|| "unpaid".to_string());

    let booking: Booking = sqlx::query_as(
        r#"
        INSERT INTO bookings (
            booking_number, guest_id, room_id, check_in_date, check_out_date,
            room_rate, subtotal, tax_amount, total_amount, status, payment_status, remarks, created_by, adults, source,
            deposit_paid, deposit_amount, deposit_paid_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', $10, $11, $12, 1, $13, $14, $15, CASE WHEN $14 THEN CURRENT_TIMESTAMP ELSE NULL END)
        RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, company_id, company_name, payment_note, created_at, updated_at
        "#
    )
    .bind(&booking_number)
    .bind(input.guest_id)
    .bind(input.room_id)
    .bind(check_in)
    .bind(check_out)
    .bind(room_rate)
    .bind(subtotal)
    .bind(tax_amount)
    .bind(total_amount)
    .bind(&payment_status)
    .bind(input.booking_remarks.as_deref())
    .bind(user_id)
    .bind(&source)
    .bind(deposit_paid)
    .bind(deposit_amount)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query("UPDATE rooms SET status = 'reserved' WHERE id = $1")
        .bind(input.room_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Log booking creation
    let _ = AuditLog::log_booking_created(&pool, user_id, booking.id, input.guest_id, input.room_id).await;

    Ok(Json(booking))
}

pub async fn get_booking_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<BookingWithDetails>, ApiError> {
    let booking = sqlx::query_as::<_, BookingWithDetails>(
        r#"
        SELECT
            b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
            g.guest_type::text as guest_type,
            b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
            b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
            b.payment_status, b.source, b.is_complimentary, b.complimentary_reason,
            b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
            b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note, b.created_at,
            b.is_posted, b.posted_date
        FROM bookings b
        INNER JOIN guests g ON b.guest_id = g.id
        INNER JOIN rooms r ON b.room_id = r.id
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.id = $1
        "#
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let has_booking_access = AuthService::check_permission(&pool, user_id, "bookings:read")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "bookings:manage")
            .await
            .unwrap_or(false);

    let owns_booking = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_guests ug INNER JOIN bookings b ON ug.guest_id = b.guest_id WHERE ug.user_id = $1 AND b.id = $2)"
    )
    .bind(user_id)
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !has_booking_access && !owns_booking {
        return Err(ApiError::Unauthorized("You don't have permission to view this booking".to_string()));
    }

    Ok(Json(booking))
}

pub async fn update_booking_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(input): Json<BookingUpdateInput>,
) -> Result<Json<Booking>, ApiError> {
    let existing_booking: Booking = sqlx::query_as(
        "SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, company_id, company_name, payment_note, created_at, updated_at FROM bookings WHERE id = $1"
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let has_booking_update = AuthService::check_permission(&pool, user_id, "bookings:update")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "bookings:manage")
            .await
            .unwrap_or(false);

    let owns_booking = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = $1 AND ug.guest_id = $2)"
    )
    .bind(user_id)
    .bind(existing_booking.guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !has_booking_update && !owns_booking {
        return Err(ApiError::Forbidden("You don't have permission to modify this booking".to_string()));
    }

    let new_room_id = if let Some(ref room_id_str) = input.room_id {
        room_id_str.parse::<i64>()
            .map_err(|_| ApiError::BadRequest("Invalid room_id format".to_string()))?
    } else {
        existing_booking.room_id
    };

    let new_status = input.status.as_ref().unwrap_or(&existing_booking.status).clone();

    let check_in = if let Some(ref date_str) = input.check_in_date {
        parse_date_flexible(date_str).map_err(|_| ApiError::BadRequest("Invalid check-in date format".to_string()))?
    } else {
        existing_booking.check_in_date
    };

    let check_out = if let Some(ref date_str) = input.check_out_date {
        parse_date_flexible(date_str).map_err(|_| ApiError::BadRequest("Invalid check-out date format".to_string()))?
    } else {
        existing_booking.check_out_date
    };

    if input.check_in_date.is_some() || input.check_out_date.is_some() {
        if check_out < check_in {
            return Err(ApiError::BadRequest("Check-out date must be on or after check-in date".to_string()));
        }
    }

    // Determine post_type based on dates: same_day if check_in == check_out
    let post_type = if check_in == check_out {
        Some("same_day".to_string())
    } else {
        None // Normal stay
    };

    let new_payment_status = input.payment_status.as_ref().unwrap_or(&existing_booking.payment_status.clone().unwrap_or_else(|| "unpaid".to_string())).clone();

    // Handle deposit fields
    let deposit_paid = input.deposit_paid;
    let deposit_amount = input.deposit_amount.map(|d| Decimal::from_f64_retain(d).unwrap_or(Decimal::ZERO));

    let booking: Booking = sqlx::query_as(
        r#"UPDATE bookings SET
            room_id = $1, status = $2, check_in_date = $3, check_out_date = $4,
            post_type = $5, payment_status = $6,
            deposit_paid = COALESCE($8, deposit_paid),
            deposit_amount = COALESCE($9, deposit_amount),
            deposit_paid_at = CASE WHEN $8 = true AND deposit_paid_at IS NULL THEN CURRENT_TIMESTAMP ELSE deposit_paid_at END,
            company_id = COALESCE($10, company_id),
            company_name = COALESCE($11, company_name),
            payment_note = COALESCE($12, payment_note),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $7
        RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, company_id, company_name, payment_note, created_at, updated_at"#
    )
    .bind(&new_room_id)
    .bind(&new_status)
    .bind(check_in)
    .bind(check_out)
    .bind(&post_type)
    .bind(&new_payment_status)
    .bind(booking_id)
    .bind(deposit_paid)
    .bind(deposit_amount)
    .bind(input.company_id)
    .bind(&input.company_name)
    .bind(&input.payment_note)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let old_status = existing_booking.status.as_str();
    let updated_status = booking.status.as_str();

    if new_room_id != existing_booking.room_id {
        let has_other_bookings: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(SELECT 1 FROM bookings WHERE room_id = $1 AND id != $2 AND status IN ('confirmed', 'checked_in', 'auto_checked_in') AND check_out_date > CURRENT_DATE)"#
        )
        .bind(existing_booking.room_id)
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap_or(false);

        if !has_other_bookings {
            sqlx::query("UPDATE rooms SET status = 'available' WHERE id = $1")
                .bind(existing_booking.room_id).execute(&pool).await.ok();
        }

        if updated_status == "confirmed" || updated_status == "pending" {
            sqlx::query("UPDATE rooms SET status = 'reserved' WHERE id = $1")
                .bind(new_room_id).execute(&pool).await.ok();
        }
    }

    if old_status != updated_status {
        match updated_status {
            "cancelled" | "no_show" => {
                let has_other_bookings: bool = sqlx::query_scalar(
                    r#"SELECT EXISTS(SELECT 1 FROM bookings WHERE room_id = $1 AND id != $2 AND status IN ('confirmed', 'checked_in', 'auto_checked_in') AND check_out_date > CURRENT_DATE)"#
                )
                .bind(new_room_id)
                .bind(booking_id)
                .fetch_one(&pool)
                .await
                .unwrap_or(false);

                if !has_other_bookings {
                    sqlx::query("UPDATE rooms SET status = 'available' WHERE id = $1")
                        .bind(new_room_id).execute(&pool).await.ok();
                }
            }
            "checked_out" | "completed" => {
                sqlx::query("UPDATE rooms SET status = 'cleaning' WHERE id = $1")
                    .bind(new_room_id).execute(&pool).await.ok();
            }
            "checked_in" | "auto_checked_in" => {
                sqlx::query("UPDATE rooms SET status = 'occupied' WHERE id = $1")
                    .bind(new_room_id).execute(&pool).await.ok();
            }
            _ => {}
        }
    }

    // Log booking update
    let changes = serde_json::json!({
        "room_id": if new_room_id != existing_booking.room_id { Some(new_room_id) } else { None },
        "status": if old_status != updated_status { Some(&new_status) } else { None },
        "check_in_date": &input.check_in_date,
        "check_out_date": &input.check_out_date,
        "payment_status": &input.payment_status,
    });
    let _ = AuditLog::log_booking_updated(&pool, user_id, booking.id, changes).await;

    Ok(Json(booking))
}

pub async fn delete_booking_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let booking_row = sqlx::query("SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, created_at, updated_at FROM bookings WHERE id = $1")
        .bind(booking_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let booking_row = booking_row.ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let guest_id: i64 = booking_row.get("guest_id");
    let room_id: i64 = booking_row.get("room_id");
    let status: String = booking_row.get("status");
    let is_complimentary: Option<bool> = booking_row.get("is_complimentary");
    let check_in_date: NaiveDate = booking_row.get("check_in_date");
    let check_out_date: NaiveDate = booking_row.get("check_out_date");

    let has_booking_delete = AuthService::check_permission(&pool, user_id, "bookings:delete")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "bookings:manage")
            .await
            .unwrap_or(false);

    let owns_booking = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = $1 AND ug.guest_id = $2)"
    )
    .bind(user_id)
    .bind(guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !has_booking_delete && !owns_booking {
        return Err(ApiError::Forbidden("You don't have permission to delete this booking".to_string()));
    }

    if matches!(status.as_str(), "checked_in" | "completed") {
        return Err(ApiError::BadRequest("Cannot delete booking that is checked in or completed".to_string()));
    }

    let result = sqlx::query(
        r#"
        UPDATE bookings
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP, cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $2
        WHERE id = $1 AND status NOT IN ('checked_in', 'completed')
        "#
    )
    .bind(booking_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::BadRequest("Booking cannot be cancelled".to_string()));
    }

    sqlx::query("UPDATE rooms SET status = 'available' WHERE id = $1")
        .bind(room_id)
        .execute(&pool)
        .await
        .ok();

    // If the booking was complimentary, convert the nights to guest credits
    let mut nights_credited = 0;
    if is_complimentary == Some(true) {
        let nights = (check_out_date - check_in_date).num_days() as i32;
        sqlx::query(
            "UPDATE guests SET complimentary_nights_credit = COALESCE(complimentary_nights_credit, 0) + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2"
        )
        .bind(nights)
        .bind(guest_id)
        .execute(&pool)
        .await
        .ok();
        nights_credited = nights;
    }

    // Log booking cancellation
    let _ = AuditLog::log_booking_cancelled(&pool, user_id, booking_id).await;

    Ok(Json(serde_json::json!({
        "message": "Booking cancelled successfully",
        "booking_id": booking_id,
        "complimentary_nights_credited": nights_credited
    })))
}

pub async fn manual_checkin_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(checkin_data): Json<Option<CheckInRequest>>,
) -> Result<Json<Booking>, ApiError> {
    let booking: Booking = sqlx::query_as(
        "SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, company_id, company_name, payment_note, created_at, updated_at FROM bookings WHERE id = $1"
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let has_checkin_permission = AuthService::check_permission(&pool, user_id, "bookings:update")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "bookings:manage")
            .await
            .unwrap_or(false);

    let created_booking = booking.created_by == Some(user_id);

    if !has_checkin_permission && !created_booking {
        return Err(ApiError::Unauthorized("You don't have permission to check in this booking".to_string()));
    }

    if booking.status != "confirmed" && booking.status != "pending" {
        return Err(ApiError::BadRequest(format!("Cannot check in booking with status: {}", booking.status)));
    }

    // Check if room is ready for check-in (not dirty or cleaning)
    let room_status: Option<String> = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
        .bind(booking.room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if let Some(status) = room_status {
        if status == "dirty" || status == "cleaning" {
            return Err(ApiError::BadRequest(format!(
                "Cannot check in - room is currently {}. Please clean the room first.",
                status
            )));
        }
        if status == "maintenance" || status == "out_of_order" {
            return Err(ApiError::BadRequest(format!(
                "Cannot check in - room is currently under {}.",
                status.replace("_", " ")
            )));
        }
    }

    if let Some(ref checkin) = checkin_data {
        if let Some(ref guest_update) = checkin.guest_update {
            let mut updates = vec!["updated_at = CURRENT_TIMESTAMP".to_string()];
            let mut params: Vec<String> = vec![];

            if let Some(ref v) = guest_update.first_name { updates.push(format!("first_name = ${}", params.len() + 1)); params.push(v.clone()); }
            if let Some(ref v) = guest_update.last_name { updates.push(format!("last_name = ${}", params.len() + 1)); params.push(v.clone()); }
            if let Some(ref v) = guest_update.email { updates.push(format!("email = ${}", params.len() + 1)); params.push(v.clone()); }
            if let Some(ref v) = guest_update.phone { updates.push(format!("phone = ${}", params.len() + 1)); params.push(v.clone()); }
            if let Some(ref v) = guest_update.ic_number { updates.push(format!("ic_number = ${}", params.len() + 1)); params.push(v.clone()); }
            if let Some(ref v) = guest_update.nationality { updates.push(format!("nationality = ${}", params.len() + 1)); params.push(v.clone()); }
            if let Some(ref v) = guest_update.address_line1 { updates.push(format!("address_line1 = ${}", params.len() + 1)); params.push(v.clone()); }
            if let Some(ref v) = guest_update.city { updates.push(format!("city = ${}", params.len() + 1)); params.push(v.clone()); }
            if let Some(ref v) = guest_update.state_province { updates.push(format!("state_province = ${}", params.len() + 1)); params.push(v.clone()); }
            if let Some(ref v) = guest_update.postal_code { updates.push(format!("postal_code = ${}", params.len() + 1)); params.push(v.clone()); }
            if let Some(ref v) = guest_update.country { updates.push(format!("country = ${}", params.len() + 1)); params.push(v.clone()); }

            if !params.is_empty() {
                let query = format!("UPDATE guests SET {} WHERE id = ${}", updates.join(", "), params.len() + 1);
                let mut q = sqlx::query(&query);
                for p in &params { q = q.bind(p); }
                q = q.bind(booking.guest_id);
                q.execute(&pool).await.ok();
            }
        }
    }

    let updated_booking: Booking = sqlx::query_as(
        r#"
        UPDATE bookings SET status = 'checked_in', actual_check_in = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1
        RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, company_id, company_name, payment_note, created_at, updated_at
        "#
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query("UPDATE rooms SET status = 'occupied' WHERE id = $1")
        .bind(booking.room_id)
        .execute(&pool)
        .await
        .ok();

    // Log check-in
    let _ = AuditLog::log_event(
        &pool,
        Some(user_id),
        "booking_checkin",
        "booking",
        Some(booking_id),
        Some(serde_json::json!({"guest_id": booking.guest_id, "room_id": booking.room_id})),
        None,
        None,
    ).await;

    Ok(Json(updated_booking))
}

pub async fn pre_checkin_update_handler(
    State(pool): State<PgPool>,
    Path(booking_id): Path<i64>,
    Json(update_data): Json<PreCheckInUpdateRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let booking_row = sqlx::query("SELECT id, guest_id, status FROM bookings WHERE id = $1")
        .bind(booking_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let guest_id: i64 = booking_row.get(1);
    let status: String = booking_row.get(2);

    if status != "pending" && status != "confirmed" {
        return Err(ApiError::BadRequest(format!("Cannot pre-check-in booking with status: {}", status)));
    }

    let first_name = update_data.guest_update.first_name.as_deref().unwrap_or("");
    let last_name = update_data.guest_update.last_name.as_deref().unwrap_or("");

    sqlx::query(
        r#"
        UPDATE guests
        SET first_name = $1, last_name = $2, email = $3, phone = $4, ic_number = $5, nationality = $6,
            address_line1 = $7, city = $8, state_province = $9, postal_code = $10, country = $11,
            title = $12, alt_phone = $13, updated_at = CURRENT_TIMESTAMP
        WHERE id = $14
        "#
    )
    .bind(first_name)
    .bind(last_name)
    .bind(&update_data.guest_update.email)
    .bind(&update_data.guest_update.phone)
    .bind(&update_data.guest_update.ic_number)
    .bind(&update_data.guest_update.nationality)
    .bind(&update_data.guest_update.address_line1)
    .bind(&update_data.guest_update.city)
    .bind(&update_data.guest_update.state_province)
    .bind(&update_data.guest_update.postal_code)
    .bind(&update_data.guest_update.country)
    .bind(&update_data.guest_update.title)
    .bind(&update_data.guest_update.alt_phone)
    .bind(guest_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(
        "UPDATE bookings SET market_code = $1, pre_checkin_completed = true, pre_checkin_completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2"
    )
    .bind(&update_data.market_code)
    .bind(booking_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Pre-check-in information updated successfully"
    })))
}

pub async fn mark_complimentary_handler(
    State(pool): State<PgPool>,
    Extension(_user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(input): Json<MarkComplimentaryRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Check if booking exists and is in a valid state, get room and rate info
    let booking_row = sqlx::query(
        r#"
        SELECT b.id, b.guest_id, b.status, b.is_complimentary, b.check_in_date, b.check_out_date,
               b.room_rate, b.total_amount, b.subtotal, b.tax_amount,
               r.room_type_id, rt.name as room_type_name
        FROM bookings b
        INNER JOIN rooms r ON b.room_id = r.id
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.id = $1
        "#
    )
        .bind(booking_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let guest_id: i64 = booking_row.get(1);
    let status: String = booking_row.get(2);
    let is_already_complimentary: Option<bool> = booking_row.get(3);
    let check_in: NaiveDate = booking_row.get(4);
    let check_out: NaiveDate = booking_row.get(5);
    let room_rate: Decimal = booking_row.get(6);
    let original_total: Decimal = booking_row.get(7);
    let _subtotal: Decimal = booking_row.get(8);
    let tax_amount: Option<Decimal> = booking_row.get(9);
    let room_type_id: i64 = booking_row.get(10);
    let room_type_name: String = booking_row.get(11);

    // Only allow marking as complimentary if booking is confirmed/pending (not checked in yet)
    if status != "confirmed" && status != "pending" {
        return Err(ApiError::BadRequest(format!(
            "Cannot mark booking as complimentary with status: {}. Only confirmed or pending bookings can be marked.",
            status
        )));
    }

    if is_already_complimentary == Some(true) {
        return Err(ApiError::BadRequest("Booking is already marked as complimentary".to_string()));
    }

    // Parse and validate complimentary date range
    let comp_start = NaiveDate::parse_from_str(&input.complimentary_start_date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid complimentary_start_date format. Use YYYY-MM-DD".to_string()))?;
    let comp_end = NaiveDate::parse_from_str(&input.complimentary_end_date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid complimentary_end_date format. Use YYYY-MM-DD".to_string()))?;

    // Validate date range is within booking period
    if comp_start < check_in || comp_end > check_out {
        return Err(ApiError::BadRequest(
            format!("Complimentary dates must be within booking period ({} to {})", check_in, check_out)
        ));
    }
    if comp_start >= comp_end {
        return Err(ApiError::BadRequest("Complimentary end date must be after start date".to_string()));
    }

    // Calculate nights
    let total_nights = (check_out - check_in).num_days() as i32;
    let complimentary_nights = (comp_end - comp_start).num_days() as i32;
    let paid_nights = total_nights - complimentary_nights;

    // Determine new status
    let new_status = if complimentary_nights == total_nights {
        "fully_complimentary"
    } else {
        "partial_complimentary"
    };

    // Calculate new pricing
    let new_subtotal = room_rate * Decimal::from(paid_nights);
    // Calculate tax proportionally (if there was tax before)
    let tax_rate = if original_total > Decimal::ZERO && total_nights > 0 {
        tax_amount.unwrap_or(Decimal::ZERO) / (room_rate * Decimal::from(total_nights))
    } else {
        Decimal::new(10, 2) // Default 10% if we can't calculate
    };
    let new_tax = new_subtotal * tax_rate;
    let new_total = new_subtotal + new_tax;

    // Determine payment status
    let payment_status = if complimentary_nights == total_nights {
        "paid"  // Fully complimentary = nothing to pay
    } else {
        "partial"  // Partial complimentary = partial payment needed
    };

    // Update booking with all new fields
    sqlx::query(
        r#"
        UPDATE bookings
        SET is_complimentary = true,
            complimentary_reason = $1,
            complimentary_start_date = $2,
            complimentary_end_date = $3,
            complimentary_nights = $4,
            original_total_amount = total_amount,
            subtotal = $5,
            tax_amount = $6,
            total_amount = $7,
            status = $8,
            payment_status = $9,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $10
        "#
    )
    .bind(&input.reason)
    .bind(comp_start)
    .bind(comp_end)
    .bind(complimentary_nights)
    .bind(new_subtotal)
    .bind(new_tax)
    .bind(new_total)
    .bind(new_status)
    .bind(payment_status)
    .bind(booking_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Add room type specific credits to guest for the complimentary nights
    let rows_affected = sqlx::query(
        r#"
        UPDATE guest_complimentary_credits
        SET nights_available = nights_available + $1, updated_at = CURRENT_TIMESTAMP
        WHERE guest_id = $2 AND room_type_id = $3
        "#
    )
    .bind(complimentary_nights)
    .bind(guest_id)
    .bind(room_type_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .rows_affected();

    if rows_affected == 0 {
        // No existing record, insert new one
        sqlx::query(
            r#"
            INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available, created_at, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            "#
        )
        .bind(guest_id)
        .bind(room_type_id)
        .bind(complimentary_nights)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    let status_display = new_status.replace("_", " ");
    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Booking marked as {}.", status_display),
        "booking_id": booking_id,
        "status": new_status,
        "total_nights": total_nights,
        "complimentary_nights": complimentary_nights,
        "paid_nights": paid_nights,
        "complimentary_start_date": comp_start.to_string(),
        "complimentary_end_date": comp_end.to_string(),
        "original_total": original_total.to_string(),
        "new_total": new_total.to_string(),
        "payment_status": payment_status,
        "nights_credited": complimentary_nights,
        "room_type": room_type_name
    })))
}

pub async fn convert_complimentary_to_credits_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get booking details
    let booking_row = sqlx::query(
        "SELECT id, guest_id, status, is_complimentary, check_in_date, check_out_date FROM bookings WHERE id = $1"
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let guest_id: i64 = booking_row.get(1);
    let status: String = booking_row.get(2);
    let is_complimentary: Option<bool> = booking_row.get(3);
    let check_in: NaiveDate = booking_row.get(4);
    let check_out: NaiveDate = booking_row.get(5);

    if is_complimentary != Some(true) {
        return Err(ApiError::BadRequest("Only complimentary bookings can be converted to credits".to_string()));
    }

    // Only allow conversion for cancelled or no_show bookings
    if status != "cancelled" && status != "no_show" {
        return Err(ApiError::BadRequest(format!(
            "Can only convert complimentary bookings with status cancelled or no_show. Current status: {}",
            status
        )));
    }

    // Calculate number of nights
    let nights = (check_out - check_in).num_days() as i32;

    // Add credits to guest
    sqlx::query(
        "UPDATE guests SET complimentary_nights_credit = COALESCE(complimentary_nights_credit, 0) + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2"
    )
    .bind(nights)
    .bind(guest_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("{} complimentary night(s) converted to credits for guest", nights),
        "nights_credited": nights,
        "guest_id": guest_id
    })))
}

/// Request for booking with complimentary credits
#[derive(Debug, Deserialize)]
pub struct BookWithCreditsRequest {
    pub guest_id: i64,
    pub room_id: i64,
    pub check_in_date: String,
    pub check_out_date: String,
    pub adults: Option<i32>,
    pub children: Option<i32>,
    pub special_requests: Option<String>,
    /// Specific dates to mark as complimentary (YYYY-MM-DD format)
    /// Must have at least 1 date and all dates must be within the booking range
    pub complimentary_dates: Vec<String>,
}

/// Book a room using complimentary credits
pub async fn book_with_credits_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(input): Json<BookWithCreditsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Verify user has access to this guest
    let has_access: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_guests WHERE user_id = $1 AND guest_id = $2)"
    )
    .bind(user_id)
    .bind(input.guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !has_access {
        return Err(ApiError::Unauthorized("You don't have access to this guest profile".to_string()));
    }

    // Calculate total nights
    let check_in = NaiveDate::parse_from_str(&input.check_in_date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid check_in_date format".to_string()))?;
    let check_out = NaiveDate::parse_from_str(&input.check_out_date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid check_out_date format".to_string()))?;

    let total_nights = (check_out - check_in).num_days() as i32;
    if total_nights <= 0 {
        return Err(ApiError::BadRequest("Check-out date must be after check-in date".to_string()));
    }

    // Validate complimentary dates
    if input.complimentary_dates.is_empty() {
        return Err(ApiError::BadRequest("You must select at least 1 complimentary date".to_string()));
    }

    // Parse and validate all complimentary dates
    let mut complimentary_dates: Vec<NaiveDate> = Vec::new();
    for date_str in &input.complimentary_dates {
        let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|_| ApiError::BadRequest(format!("Invalid date format: {}", date_str)))?;

        // Check date is within booking range (check_in <= date < check_out)
        if date < check_in || date >= check_out {
            return Err(ApiError::BadRequest(format!(
                "Date {} is outside the booking range ({} to {})",
                date_str, input.check_in_date, input.check_out_date
            )));
        }

        if !complimentary_dates.contains(&date) {
            complimentary_dates.push(date);
        }
    }

    let complimentary_nights = complimentary_dates.len() as i32;

    // Get room info including room type
    let room_info: Option<(i64, Decimal, String)> = sqlx::query_as(
        r#"
        SELECT rt.id, COALESCE(r.custom_price, rt.base_price), rt.name
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1
        "#
    )
    .bind(input.room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let (room_type_id, room_rate, room_type_name) = room_info
        .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    // Check guest's complimentary credits for this room type
    let room_type_credits: i32 = sqlx::query_scalar(
        "SELECT COALESCE(nights_available, 0) FROM guest_complimentary_credits WHERE guest_id = $1 AND room_type_id = $2"
    )
    .bind(input.guest_id)
    .bind(room_type_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .unwrap_or(0);

    // Also check legacy credits as fallback
    let legacy_credits: i32 = sqlx::query_scalar(
        "SELECT COALESCE(complimentary_nights_credit, 0) FROM guests WHERE id = $1"
    )
    .bind(input.guest_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    let total_available_credits = room_type_credits + legacy_credits;

    if total_available_credits < complimentary_nights {
        return Err(ApiError::BadRequest(format!(
            "Insufficient complimentary credits for {}. Requested: {} nights, Available: {} nights (room type) + {} nights (legacy)",
            room_type_name, complimentary_nights, room_type_credits, legacy_credits
        )));
    }

    // Check room availability
    let room_available: bool = sqlx::query_scalar(
        r#"
        SELECT NOT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = $1
              AND status NOT IN ('cancelled', 'checked_out', 'no_show')
              AND check_in_date < $3
              AND check_out_date > $2
        )
        "#
    )
    .bind(input.room_id)
    .bind(check_in)
    .bind(check_out)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !room_available {
        return Err(ApiError::BadRequest("Room is not available for the selected dates".to_string()));
    }

    // Calculate charges for non-complimentary nights
    let paid_nights = total_nights - complimentary_nights;
    let subtotal = room_rate * Decimal::from(paid_nights);
    let tax_amount = subtotal * Decimal::from_str_exact("0.10").unwrap_or_default();
    let total_amount = subtotal + tax_amount;

    // Generate booking number
    let booking_number = format!("COMP-{}", chrono::Utc::now().format("%Y%m%d%H%M%S"));

    // Format complimentary dates for storage
    let complimentary_dates_str: Vec<String> = complimentary_dates
        .iter()
        .map(|d| d.format("%Y-%m-%d").to_string())
        .collect();
    let complimentary_dates_json = serde_json::to_string(&complimentary_dates_str).unwrap_or_default();

    // Determine if booking is fully or partially complimentary
    let is_fully_complimentary = complimentary_nights == total_nights;
    let complimentary_reason = if is_fully_complimentary {
        format!("Free Gift - {} complimentary night(s) for {}", complimentary_nights, room_type_name)
    } else {
        format!("Partial Free Gift - {} of {} nights complimentary for {} (dates: {})",
            complimentary_nights, total_nights, room_type_name, complimentary_dates_str.join(", "))
    };

    // Create the booking
    let booking_id: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO bookings (
            booking_number, guest_id, room_id, check_in_date, check_out_date,
            room_rate, subtotal, tax_amount, discount_amount, total_amount,
            status, payment_status, adults, children, special_requests,
            source, is_complimentary, complimentary_reason, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, 'confirmed', $10, $11, $12, $13,
                'complimentary_credits', true, $14, $15)
        RETURNING id
        "#
    )
    .bind(&booking_number)
    .bind(input.guest_id)
    .bind(input.room_id)
    .bind(check_in)
    .bind(check_out)
    .bind(room_rate)
    .bind(subtotal)
    .bind(tax_amount)
    .bind(total_amount)
    .bind(if is_fully_complimentary { "paid" } else { "unpaid" })
    .bind(input.adults.unwrap_or(1))
    .bind(input.children.unwrap_or(0))
    .bind(&input.special_requests)
    .bind(&complimentary_reason)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Deduct credits - first from room type specific, then from legacy
    let mut credits_to_deduct = complimentary_nights;

    // Deduct from room type specific credits first
    if room_type_credits > 0 {
        let deduct_from_room_type = std::cmp::min(credits_to_deduct, room_type_credits);
        sqlx::query(
            "UPDATE guest_complimentary_credits SET nights_available = nights_available - $1, updated_at = CURRENT_TIMESTAMP WHERE guest_id = $2 AND room_type_id = $3"
        )
        .bind(deduct_from_room_type)
        .bind(input.guest_id)
        .bind(room_type_id)
        .execute(&pool)
        .await
        .ok();
        credits_to_deduct -= deduct_from_room_type;
    }

    // Deduct remaining from legacy credits if needed
    if credits_to_deduct > 0 {
        sqlx::query(
            "UPDATE guests SET complimentary_nights_credit = complimentary_nights_credit - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2"
        )
        .bind(credits_to_deduct)
        .bind(input.guest_id)
        .execute(&pool)
        .await
        .ok();
    }

    // Update room status to reserved
    sqlx::query("UPDATE rooms SET status = 'reserved' WHERE id = $1")
        .bind(input.room_id)
        .execute(&pool)
        .await
        .ok();

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Successfully booked room using {} complimentary night(s)", complimentary_nights),
        "booking_id": booking_id,
        "booking_number": booking_number,
        "total_nights": total_nights,
        "complimentary_nights": complimentary_nights,
        "complimentary_dates": complimentary_dates_str,
        "paid_nights": paid_nights,
        "total_amount": total_amount.to_string(),
        "room_type": room_type_name,
        "is_free_gift": is_fully_complimentary
    })))
}

/// Get all complimentary bookings
pub async fn get_complimentary_bookings_handler(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<BookingWithDetails>>, ApiError> {
    let bookings: Vec<BookingWithDetails> = sqlx::query_as(
        r#"
        SELECT
            b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
            g.guest_type::text as guest_type,
            b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
            b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
            b.payment_status, b.source, b.is_complimentary, b.complimentary_reason,
            b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
            b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
            b.created_at, b.is_posted, b.posted_date
        FROM bookings b
        INNER JOIN guests g ON b.guest_id = g.id
        INNER JOIN rooms r ON b.room_id = r.id
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.is_complimentary = true
           OR b.status IN ('partial_complimentary', 'fully_complimentary', 'comp_cancelled')
        ORDER BY b.created_at DESC
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(bookings))
}

/// Get complimentary statistics summary
pub async fn get_complimentary_summary_handler(
    State(pool): State<PgPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Total complimentary bookings
    let total_bookings: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings WHERE is_complimentary = true OR status IN ('partial_complimentary', 'fully_complimentary', 'comp_cancelled')"
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    // Total complimentary nights
    let total_nights: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(complimentary_nights), 0) FROM bookings WHERE is_complimentary = true OR status IN ('partial_complimentary', 'fully_complimentary')"
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    // Total credits issued (sum of all guest credits)
    let total_credits_issued: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(nights_available), 0) FROM guest_complimentary_credits"
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    // Legacy credits
    let legacy_credits: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(complimentary_nights_credit), 0) FROM guests WHERE complimentary_nights_credit > 0"
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    // Value of complimentary nights (sum of original amounts - adjusted amounts)
    let value_given: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(original_total_amount - total_amount), 0) FROM bookings WHERE is_complimentary = true AND original_total_amount IS NOT NULL"
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(Decimal::ZERO);

    Ok(Json(serde_json::json!({
        "total_complimentary_bookings": total_bookings,
        "total_complimentary_nights": total_nights,
        "total_credits_available": total_credits_issued + legacy_credits,
        "room_type_credits": total_credits_issued,
        "legacy_credits": legacy_credits,
        "value_of_complimentary_nights": value_given.to_string()
    })))
}

/// Request for updating complimentary dates
#[derive(Debug, Deserialize)]
pub struct UpdateComplimentaryRequest {
    pub complimentary_start_date: Option<String>,
    pub complimentary_end_date: Option<String>,
    pub complimentary_reason: Option<String>,
}

/// Update complimentary dates for a booking
pub async fn update_complimentary_handler(
    State(pool): State<PgPool>,
    Extension(_user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(input): Json<UpdateComplimentaryRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get current booking
    let booking_row = sqlx::query(
        "SELECT id, is_complimentary, check_in_date, check_out_date, room_rate, total_amount FROM bookings WHERE id = $1"
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let is_complimentary: Option<bool> = booking_row.get(1);
    if is_complimentary != Some(true) {
        return Err(ApiError::BadRequest("Booking is not marked as complimentary".to_string()));
    }

    let check_in: NaiveDate = booking_row.get(2);
    let check_out: NaiveDate = booking_row.get(3);
    let room_rate: Decimal = booking_row.get(4);
    let original_total: Decimal = booking_row.get(5);

    // Parse new dates if provided
    let comp_start = if let Some(ref date_str) = input.complimentary_start_date {
        Some(NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|_| ApiError::BadRequest("Invalid complimentary_start_date format".to_string()))?)
    } else {
        None
    };

    let comp_end = if let Some(ref date_str) = input.complimentary_end_date {
        Some(NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|_| ApiError::BadRequest("Invalid complimentary_end_date format".to_string()))?)
    } else {
        None
    };

    // Validate dates if both provided
    if let (Some(start), Some(end)) = (comp_start, comp_end) {
        if start < check_in || end > check_out {
            return Err(ApiError::BadRequest(
                format!("Complimentary dates must be within booking period ({} to {})", check_in, check_out)
            ));
        }
        if start >= end {
            return Err(ApiError::BadRequest("Complimentary end date must be after start date".to_string()));
        }

        // Recalculate amounts
        let total_nights = (check_out - check_in).num_days() as i32;
        let complimentary_nights = (end - start).num_days() as i32;
        let paid_nights = total_nights - complimentary_nights;

        let new_status = if complimentary_nights == total_nights {
            "fully_complimentary"
        } else {
            "partial_complimentary"
        };

        let new_subtotal = room_rate * Decimal::from(paid_nights);
        let tax_rate = Decimal::from_str_exact("0.10").unwrap_or_default();
        let new_tax = new_subtotal * tax_rate;
        let new_total = new_subtotal + new_tax;

        sqlx::query(
            r#"
            UPDATE bookings
            SET complimentary_start_date = $1,
                complimentary_end_date = $2,
                complimentary_reason = COALESCE($3, complimentary_reason),
                complimentary_nights = $4,
                subtotal = $5,
                tax_amount = $6,
                total_amount = $7,
                status = $8,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $9
            "#
        )
        .bind(start)
        .bind(end)
        .bind(&input.complimentary_reason)
        .bind(complimentary_nights)
        .bind(new_subtotal)
        .bind(new_tax)
        .bind(new_total)
        .bind(new_status)
        .bind(booking_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        return Ok(Json(serde_json::json!({
            "success": true,
            "message": "Complimentary dates updated",
            "booking_id": booking_id,
            "complimentary_nights": complimentary_nights,
            "new_total": new_total.to_string()
        })));
    }

    // Just update reason if no dates provided
    if let Some(ref reason) = input.complimentary_reason {
        sqlx::query("UPDATE bookings SET complimentary_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(reason)
            .bind(booking_id)
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Complimentary booking updated",
        "booking_id": booking_id
    })))
}

/// Remove complimentary status from a booking
pub async fn remove_complimentary_handler(
    State(pool): State<PgPool>,
    Extension(_user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get current booking
    let booking_row = sqlx::query(
        "SELECT id, guest_id, is_complimentary, original_total_amount, complimentary_nights, status FROM bookings WHERE id = $1"
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let guest_id: i64 = booking_row.get(1);
    let is_complimentary: Option<bool> = booking_row.get(2);
    let original_total: Option<Decimal> = booking_row.get(3);
    let complimentary_nights: Option<i32> = booking_row.get(4);
    let status: String = booking_row.get(5);

    if is_complimentary != Some(true) {
        return Err(ApiError::BadRequest("Booking is not marked as complimentary".to_string()));
    }

    // Only allow removal for non-checked-in bookings
    if status == "checked_in" || status == "checked_out" {
        return Err(ApiError::BadRequest(
            format!("Cannot remove complimentary status from booking with status: {}", status)
        ));
    }

    // Restore original amount and clear complimentary fields
    sqlx::query(
        r#"
        UPDATE bookings
        SET is_complimentary = false,
            complimentary_reason = NULL,
            complimentary_start_date = NULL,
            complimentary_end_date = NULL,
            complimentary_nights = NULL,
            total_amount = COALESCE(original_total_amount, total_amount),
            original_total_amount = NULL,
            status = 'confirmed',
            payment_status = 'unpaid',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        "#
    )
    .bind(booking_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Remove any credits that were added (if applicable)
    // Note: This is a simplification - in production you might want more sophisticated tracking

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Complimentary status removed",
        "booking_id": booking_id,
        "restored_total": original_total.map(|d| d.to_string())
    })))
}

/// Guest credit information
#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct GuestCredit {
    pub guest_id: i64,
    pub guest_name: String,
    pub email: Option<String>,
    pub legacy_credits: i32,
}

/// Get all guests with complimentary credits
pub async fn get_guests_with_credits_handler(
    State(pool): State<PgPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get guests with legacy credits
    let legacy_guests: Vec<GuestCredit> = sqlx::query_as(
        r#"
        SELECT id as guest_id, full_name as guest_name, email, COALESCE(complimentary_nights_credit, 0) as legacy_credits
        FROM guests
        WHERE complimentary_nights_credit > 0
        ORDER BY complimentary_nights_credit DESC
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get room type specific credits
    let room_type_credits: Vec<serde_json::Value> = sqlx::query(
        r#"
        SELECT gc.guest_id, g.full_name as guest_name, g.email,
               gc.room_type_id, rt.name as room_type_name, rt.code as room_type_code,
               gc.nights_available
        FROM guest_complimentary_credits gc
        INNER JOIN guests g ON gc.guest_id = g.id
        INNER JOIN room_types rt ON gc.room_type_id = rt.id
        WHERE gc.nights_available > 0
        ORDER BY gc.nights_available DESC
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .iter()
    .map(|row| {
        serde_json::json!({
            "guest_id": row.get::<i64, _>("guest_id"),
            "guest_name": row.get::<String, _>("guest_name"),
            "email": row.get::<Option<String>, _>("email"),
            "room_type_id": row.get::<i64, _>("room_type_id"),
            "room_type_name": row.get::<String, _>("room_type_name"),
            "room_type_code": row.get::<Option<String>, _>("room_type_code"),
            "nights_available": row.get::<i32, _>("nights_available")
        })
    })
    .collect();

    Ok(Json(serde_json::json!({
        "legacy_credits": legacy_guests,
        "room_type_credits": room_type_credits
    })))
}
