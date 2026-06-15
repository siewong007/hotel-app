//! Complimentary-night booking handlers.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use axum::{
    extract::{Extension, Path, State},
    response::Json,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::Row;

pub async fn mark_complimentary_handler(
    State(pool): State<DbPool>,
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
        "#,
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
        return Err(ApiError::BadRequest(
            "Booking is already marked as complimentary".to_string(),
        ));
    }

    // Parse and validate complimentary date range
    let comp_start = NaiveDate::parse_from_str(&input.complimentary_start_date, "%Y-%m-%d")
        .map_err(|_| {
            ApiError::BadRequest(
                "Invalid complimentary_start_date format. Use YYYY-MM-DD".to_string(),
            )
        })?;
    let comp_end =
        NaiveDate::parse_from_str(&input.complimentary_end_date, "%Y-%m-%d").map_err(|_| {
            ApiError::BadRequest(
                "Invalid complimentary_end_date format. Use YYYY-MM-DD".to_string(),
            )
        })?;

    // Validate date range is within booking period
    if comp_start < check_in || comp_end > check_out {
        return Err(ApiError::BadRequest(format!(
            "Complimentary dates must be within booking period ({} to {})",
            check_in, check_out
        )));
    }
    if comp_start >= comp_end {
        return Err(ApiError::BadRequest(
            "Complimentary end date must be after start date".to_string(),
        ));
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
        "paid" // Fully complimentary = nothing to pay
    } else {
        "partial" // Partial complimentary = partial payment needed
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
        "#,
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
        "#,
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

    // Record in booking_modifications audit trail
    sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, price_adjustment, modified_by) VALUES ($1, $2, $3, $4, $5, $6)"
    )
    .bind(booking_id)
    .bind("mark_complimentary")
    .bind(serde_json::json!({"status": &status, "total_amount": original_total.to_string(), "is_complimentary": false}))
    .bind(serde_json::json!({"status": new_status, "total_amount": new_total.to_string(), "is_complimentary": true, "complimentary_nights": complimentary_nights, "reason": &input.reason}))
    .bind(new_total - original_total)
    .bind(_user_id)
    .execute(&pool)
    .await
    .ok();

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
    State(pool): State<DbPool>,
    Extension(_user_id): Extension<i64>,
    Path(booking_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get booking details with room info
    let booking_row = sqlx::query(
        r#"
        SELECT b.id, b.guest_id, b.room_id, b.status, b.is_complimentary, b.check_in_date, b.check_out_date,
               r.room_type_id, rt.name as room_type_name
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.id = $1
        "#
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    let guest_id: i64 = booking_row.get("guest_id");
    let status: String = booking_row.get("status");
    let is_complimentary: Option<bool> = booking_row.get("is_complimentary");
    let check_in: NaiveDate = booking_row.get("check_in_date");
    let check_out: NaiveDate = booking_row.get("check_out_date");
    let room_type_id: i64 = booking_row.get("room_type_id");
    let room_type_name: String = booking_row.get("room_type_name");

    if is_complimentary != Some(true) {
        return Err(ApiError::BadRequest(
            "Only complimentary bookings can be converted to credits".to_string(),
        ));
    }

    // Only allow conversion for voided bookings
    if status != "voided" {
        return Err(ApiError::BadRequest(format!(
            "Can only convert complimentary bookings with status voided. Current status: {}",
            status
        )));
    }

    // Calculate number of nights
    let nights = (check_out - check_in).num_days() as i32;

    // Add to room-type specific credits
    sqlx::query(
        r#"
        INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available, notes, created_at, updated_at)
        VALUES ($1, $2, $3, 'Converted from voided complimentary booking', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (guest_id, room_type_id)
        DO UPDATE SET nights_available = guest_complimentary_credits.nights_available + $3, updated_at = CURRENT_TIMESTAMP
        "#
    )
    .bind(guest_id)
    .bind(room_type_id)
    .bind(nights)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("{} complimentary night(s) converted to {} credits for guest", nights, room_type_name),
        "nights_credited": nights,
        "guest_id": guest_id,
        "room_type": room_type_name
    })))
}

/// Get all complimentary bookings
pub async fn get_complimentary_bookings_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<BookingWithDetails>>, ApiError> {
    let bookings: Vec<BookingWithDetails> = sqlx::query_as(
        r#"
        SELECT
            b.id, b.booking_number, b.folio_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
            g.guest_type::text as guest_type, g.tourism_type::text as guest_tourism_type,
            b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
            b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
            b.payment_status, b.payment_method, b.source, b.remarks, b.special_requests, b.is_complimentary, b.complimentary_reason,
            b.complimentary_start_date, b.complimentary_end_date, b.original_total_amount, b.complimentary_nights,
            b.deposit_paid, b.deposit_amount, b.room_card_deposit, b.company_id, b.company_name, b.payment_note,
            b.created_at, b.is_posted, b.posted_date,
            b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
            b.rate_override_weekday, b.rate_override_weekend, b.actual_check_out,
            (SELECT inv.invoice_number FROM invoices inv WHERE inv.booking_id = b.id ORDER BY inv.created_at DESC LIMIT 1) AS invoice_number
        FROM bookings b
        INNER JOIN guests g ON b.guest_id = g.id
        INNER JOIN rooms r ON b.room_id = r.id
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.is_complimentary = true
           OR b.status IN ('partial_complimentary', 'fully_complimentary')
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
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Total complimentary bookings
    let total_bookings: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings WHERE is_complimentary = true OR status IN ('partial_complimentary', 'fully_complimentary')"
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

    // Total credits available (sum of all room-type specific credits)
    let total_credits_available: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(nights_available), 0) FROM guest_complimentary_credits",
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
        "total_credits_available": total_credits_available,
        "value_of_complimentary_nights": value_given.to_string()
    })))
}

/// Update complimentary dates for a booking
pub async fn update_complimentary_handler(
    State(pool): State<DbPool>,
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
        return Err(ApiError::BadRequest(
            "Booking is not marked as complimentary".to_string(),
        ));
    }

    let check_in: NaiveDate = booking_row.get(2);
    let check_out: NaiveDate = booking_row.get(3);
    let room_rate: Decimal = booking_row.get(4);
    let original_total: Decimal = booking_row.get(5);

    // Parse new dates if provided
    let comp_start = if let Some(ref date_str) = input.complimentary_start_date {
        Some(
            NaiveDate::parse_from_str(date_str, "%Y-%m-%d").map_err(|_| {
                ApiError::BadRequest("Invalid complimentary start date. Use YYYY-MM-DD".to_string())
            })?,
        )
    } else {
        None
    };

    let comp_end = if let Some(ref date_str) = input.complimentary_end_date {
        Some(
            NaiveDate::parse_from_str(date_str, "%Y-%m-%d").map_err(|_| {
                ApiError::BadRequest("Invalid complimentary end date. Use YYYY-MM-DD".to_string())
            })?,
        )
    } else {
        None
    };

    // Validate dates if both provided
    if let (Some(start), Some(end)) = (comp_start, comp_end) {
        if start < check_in || end > check_out {
            return Err(ApiError::BadRequest(format!(
                "Complimentary dates must be within booking period ({} to {})",
                check_in, check_out
            )));
        }
        if start >= end {
            return Err(ApiError::BadRequest(
                "Complimentary end date must be after start date".to_string(),
            ));
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
            "#,
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

        // Record in booking_modifications audit trail
        sqlx::query(
            "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, price_adjustment, modified_by) VALUES ($1, $2, $3, $4, $5, $6)"
        )
        .bind(booking_id)
        .bind("update_complimentary")
        .bind(serde_json::json!({"total_amount": original_total.to_string()}))
        .bind(serde_json::json!({"total_amount": new_total.to_string(), "complimentary_nights": complimentary_nights, "status": new_status}))
        .bind(new_total - original_total)
        .bind(_user_id)
        .execute(&pool)
        .await
        .ok();

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

        // Record in booking_modifications audit trail
        sqlx::query(
            "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES ($1, $2, $3, $4, $5)"
        )
        .bind(booking_id)
        .bind("update_complimentary")
        .bind(serde_json::json!({}))
        .bind(serde_json::json!({"complimentary_reason": reason}))
        .bind(_user_id)
        .execute(&pool)
        .await
        .ok();
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Complimentary booking updated",
        "booking_id": booking_id
    })))
}

/// Remove complimentary status from a booking
pub async fn remove_complimentary_handler(
    State(pool): State<DbPool>,
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

    let _guest_id: i64 = booking_row.get(1);
    let is_complimentary: Option<bool> = booking_row.get(2);
    let original_total: Option<Decimal> = booking_row.get(3);
    let complimentary_nights: Option<i32> = booking_row.get(4);
    let status: String = booking_row.get(5);

    if is_complimentary != Some(true) {
        return Err(ApiError::BadRequest(
            "Booking is not marked as complimentary".to_string(),
        ));
    }

    // Only allow removal for non-checked-in bookings
    if status == "checked_in" || status == "checked_out" {
        return Err(ApiError::BadRequest(format!(
            "Cannot remove complimentary status from booking with status: {}",
            status
        )));
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
        "#,
    )
    .bind(booking_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Remove any credits that were added (if applicable)
    // Note: This is a simplification - in production you might want more sophisticated tracking

    // Record in booking_modifications audit trail
    sqlx::query(
        "INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by) VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(booking_id)
    .bind("remove_complimentary")
    .bind(serde_json::json!({"status": &status, "is_complimentary": true, "complimentary_nights": complimentary_nights}))
    .bind(serde_json::json!({"status": "confirmed", "is_complimentary": false, "total_amount": original_total.map(|d| d.to_string())}))
    .bind(_user_id)
    .execute(&pool)
    .await
    .ok();

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Complimentary status removed",
        "booking_id": booking_id,
        "restored_total": original_total.map(|d| d.to_string())
    })))
}
