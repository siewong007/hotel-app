//! Booking handlers
//!
//! Handles booking CRUD, check-in/out, and pre-check-in.

use crate::core::auth::AuthService;
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::models::*;
use axum::{
    extract::{Extension, Path, State},
    http::HeaderMap,
    response::Json,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
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
            b.id, b.booking_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
            b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
            b.check_in_date, b.check_out_date, b.total_amount, b.status,
            b.payment_status, b.source, b.created_at
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
            b.id, b.booking_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
            b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
            b.check_in_date, b.check_out_date, b.total_amount, b.status,
            b.payment_status, b.source, b.created_at
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
               CASE WHEN r.status IN ('available', 'reserved', 'cleaning') THEN true ELSE false END as available,
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

    let conflict = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = $1 AND status NOT IN ('cancelled', 'no_show')
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
    let subtotal = room_rate * Decimal::from(nights);
    let tax_amount = subtotal * Decimal::from_str_exact("0.10").unwrap_or_default();
    let total_amount = subtotal + tax_amount;

    let booking_number = format!("BK-{}-{:04}", chrono::Utc::now().format("%Y%m%d"),
        sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(id), 0) + 1 FROM bookings")
            .fetch_one(&pool).await.unwrap_or(1)
    );

    let booking: Booking = sqlx::query_as(
        r#"
        INSERT INTO bookings (
            booking_number, guest_id, room_id, check_in_date, check_out_date,
            room_rate, subtotal, tax_amount, total_amount, status, remarks, created_by, adults
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', $10, $11, 1)
        RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, created_at, updated_at
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
    .bind(input.booking_remarks.as_deref())
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query("UPDATE rooms SET status = 'reserved' WHERE id = $1")
        .bind(input.room_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

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
            b.id, b.guest_id, g.full_name as guest_name, g.email as guest_email,
            b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
            b.check_in_date, b.check_out_date, b.total_amount, b.status, b.booking_number,
            NULL::VARCHAR as post_type, NULL::VARCHAR as rate_code, b.created_at
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

    let is_admin = AuthService::check_role(&pool, user_id, "admin")
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let owns_booking = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_guests ug INNER JOIN bookings b ON ug.guest_id = b.guest_id WHERE ug.user_id = $1 AND b.id = $2)"
    )
    .bind(user_id)
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !is_admin && !owns_booking {
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
        "SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, created_at, updated_at FROM bookings WHERE id = $1"
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let is_admin = AuthService::check_role(&pool, user_id, "admin")
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let owns_booking = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = $1 AND ug.guest_id = $2 AND ug.can_modify = true)"
    )
    .bind(user_id)
    .bind(existing_booking.guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !is_admin && !owns_booking {
        return Err(ApiError::Unauthorized("You don't have permission to modify this booking".to_string()));
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
        if check_out <= check_in {
            return Err(ApiError::BadRequest("Check-out date must be after check-in date".to_string()));
        }
    }

    let booking: Booking = sqlx::query_as(
        "UPDATE bookings SET room_id = $1, status = $2, check_in_date = $3, check_out_date = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, created_at, updated_at"
    )
    .bind(&new_room_id)
    .bind(&new_status)
    .bind(check_in)
    .bind(check_out)
    .bind(booking_id)
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

    Ok(Json(booking))
}

pub async fn delete_booking_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let booking: Option<Booking> = sqlx::query_as("SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, created_at, updated_at FROM bookings WHERE id = $1")
        .bind(booking_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let booking = booking.ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let is_admin = AuthService::check_role(&pool, user_id, "admin")
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let owns_booking = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_guests ug WHERE ug.user_id = $1 AND ug.guest_id = $2 AND ug.can_modify = true)"
    )
    .bind(user_id)
    .bind(booking.guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !is_admin && !owns_booking {
        return Err(ApiError::Unauthorized("You don't have permission to delete this booking".to_string()));
    }

    if matches!(booking.status.as_str(), "checked_in" | "completed") {
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
        .bind(booking.room_id)
        .execute(&pool)
        .await
        .ok();

    Ok(Json(serde_json::json!({
        "message": "Booking cancelled successfully",
        "booking_id": booking_id
    })))
}

pub async fn manual_checkin_handler(
    State(pool): State<PgPool>,
    Extension(user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
    Json(checkin_data): Json<Option<CheckInRequest>>,
) -> Result<Json<Booking>, ApiError> {
    let booking: Booking = sqlx::query_as(
        "SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, created_at, updated_at FROM bookings WHERE id = $1"
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let is_admin = AuthService::check_role(&pool, user_id, "admin")
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let created_booking = booking.created_by == Some(user_id);

    if !is_admin && !created_booking {
        return Err(ApiError::Unauthorized("You don't have permission to check in this booking".to_string()));
    }

    if booking.status != "confirmed" && booking.status != "pending" {
        return Err(ApiError::BadRequest(format!("Cannot check in booking with status: {}", booking.status)));
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
        RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, created_at, updated_at
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
