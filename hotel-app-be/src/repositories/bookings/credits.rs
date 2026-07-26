//! Guest complimentary-credit handlers.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::models::*;
use crate::services::audit::AuditLog;
use crate::utils::sanitization::Sanitizer;
use axum::{
    extract::{Extension, Path, State},
    http::HeaderMap,
    response::Json,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::Row;

/// Book a room using complimentary credits
pub async fn book_with_credits_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<BookWithCreditsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let has_access =
        crate::services::bookings::can_book_with_credits_for_guest(&pool, user_id, input.guest_id)
            .await?;

    if !has_access {
        return Err(ApiError::Unauthorized(
            "You don't have access to this guest profile".to_string(),
        ));
    }

    // Calculate total nights
    let check_in = NaiveDate::parse_from_str(&input.check_in_date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid check-in date. Use YYYY-MM-DD".to_string()))?;
    let check_out = NaiveDate::parse_from_str(&input.check_out_date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid check-out date. Use YYYY-MM-DD".to_string()))?;

    let total_nights = (check_out - check_in).num_days() as i32;
    if total_nights <= 0 {
        return Err(ApiError::BadRequest(
            "Check-out date must be after check-in date".to_string(),
        ));
    }

    // Validate complimentary dates
    if input.complimentary_dates.is_empty() {
        return Err(ApiError::BadRequest(
            "You must select at least 1 complimentary date".to_string(),
        ));
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
    let room_info: Option<(i64, Decimal, String)> = sqlx::query(
        r#"
        SELECT rt.id, COALESCE(r.custom_price, rt.base_price), rt.name
        FROM rooms r
        INNER JOIN room_types rt ON r.room_type_id = rt.id
        WHERE r.id = $1
        "#,
    )
    .bind(input.room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .map(|r| {
        use crate::core::db::DbRowExt;
        use sqlx::Row;
        (r.get(0), r.get_decimal(1), r.get(2))
    });

    let (room_type_id, room_rate, room_type_name) =
        room_info.ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    // Check guest's complimentary credits for this room type
    let available_credits: i32 = sqlx::query_scalar(
        "SELECT COALESCE(nights_available, 0) FROM guest_complimentary_credits WHERE guest_id = $1 AND room_type_id = $2"
    )
    .bind(input.guest_id)
    .bind(room_type_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .unwrap_or(0);

    if available_credits < complimentary_nights {
        return Err(ApiError::BadRequest(format!(
            "Insufficient complimentary credits for {}. Requested: {} nights, Available: {} nights",
            room_type_name, complimentary_nights, available_credits
        )));
    }

    // Check room availability
    let room_available: bool = sqlx::query_scalar(
        r#"
        SELECT NOT EXISTS(
            SELECT 1 FROM bookings
            WHERE room_id = $1
              AND status NOT IN ('checked_out', 'voided')
              AND check_in_date < $3
              AND check_out_date > $2
        )
        "#,
    )
    .bind(input.room_id)
    .bind(check_in)
    .bind(check_out)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !room_available {
        return Err(ApiError::BadRequest(
            "Room is not available for the selected dates".to_string(),
        ));
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
    let _complimentary_dates_json =
        serde_json::to_string(&complimentary_dates_str).unwrap_or_default();

    // Determine if booking is fully or partially complimentary
    let is_fully_complimentary = complimentary_nights == total_nights;
    let complimentary_reason = if is_fully_complimentary {
        format!(
            "Free Gift - {} complimentary night(s) for {}",
            complimentary_nights, room_type_name
        )
    } else {
        format!(
            "Partial Free Gift - {} of {} nights complimentary for {} (dates: {})",
            complimentary_nights,
            total_nights,
            room_type_name,
            complimentary_dates_str.join(", ")
        )
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
        "#,
    )
    .bind(&booking_number)
    .bind(input.guest_id)
    .bind(input.room_id)
    .bind(check_in)
    .bind(check_out)
    .bind(crate::core::db::decimal_to_db(room_rate))
    .bind(crate::core::db::decimal_to_db(subtotal))
    .bind(crate::core::db::decimal_to_db(tax_amount))
    .bind(crate::core::db::decimal_to_db(total_amount))
    .bind(if is_fully_complimentary {
        "paid"
    } else {
        "unpaid"
    })
    .bind(input.adults.unwrap_or(1))
    .bind(input.children.unwrap_or(0))
    .bind(&input.special_requests)
    .bind(&complimentary_reason)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Deduct credits from room-type specific credits
    sqlx::query(
        "UPDATE guest_complimentary_credits SET nights_available = nights_available - $1, updated_at = CURRENT_TIMESTAMP WHERE guest_id = $2 AND room_type_id = $3"
    )
    .bind(complimentary_nights)
    .bind(input.guest_id)
    .bind(room_type_id)
    .execute(&pool)
    .await
    .ok();

    sqlx::query("UPDATE rooms SET status = $1 WHERE id = $2")
        .bind("reserved")
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

/// Get all guests with complimentary credits
pub async fn get_guests_with_credits_handler(
    State(pool): State<DbPool>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get room type specific credits
    let credits: Vec<serde_json::Value> = sqlx::query(
        r#"
        SELECT gc.guest_id, g.full_name as guest_name, g.email,
               gc.room_type_id, rt.name as room_type_name, rt.code as room_type_code,
               gc.nights_available, gc.notes
        FROM guest_complimentary_credits gc
        INNER JOIN guests g ON gc.guest_id = g.id
        INNER JOIN room_types rt ON gc.room_type_id = rt.id
        WHERE gc.nights_available > 0
        ORDER BY g.full_name, rt.name
        "#,
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
            "nights_available": row.get::<i32, _>("nights_available"),
            "notes": row.get::<Option<String>, _>("notes")
        })
    })
    .collect();

    Ok(Json(serde_json::json!({
        "credits": credits
    })))
}

/// Add complimentary credits to a guest
pub async fn add_guest_credits_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<AddGuestCreditsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let reason = normalize_credit_reason(input.reason.as_deref())?;

    // Validate guest exists
    let guest_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM guests WHERE id = $1)")
            .bind(input.guest_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

    if !guest_exists {
        return Err(ApiError::NotFound(format!(
            "Guest with id {} not found",
            input.guest_id
        )));
    }

    // Validate room type exists
    let room_type_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM room_types WHERE id = $1)")
            .bind(input.room_type_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

    if !room_type_exists {
        return Err(ApiError::NotFound(format!(
            "Room type with id {} not found",
            input.room_type_id
        )));
    }

    if input.nights <= 0 {
        return Err(ApiError::BadRequest(
            "Nights must be greater than 0".to_string(),
        ));
    }

    // Upsert credits
    sqlx::query(
        r#"
        INSERT INTO guest_complimentary_credits (guest_id, room_type_id, nights_available, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (guest_id, room_type_id)
        DO UPDATE SET nights_available = guest_complimentary_credits.nights_available + $3,
                      notes = $4,
                      updated_at = CURRENT_TIMESTAMP
        "#
    )
    .bind(input.guest_id)
    .bind(input.room_type_id)
    .bind(input.nights)
    .bind(&reason)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get updated credit info
    let credit = sqlx::query(
        r#"
        SELECT gc.guest_id, g.full_name as guest_name, gc.room_type_id, rt.name as room_type_name,
               gc.nights_available, gc.notes
        FROM guest_complimentary_credits gc
        INNER JOIN guests g ON gc.guest_id = g.id
        INNER JOIN room_types rt ON gc.room_type_id = rt.id
        WHERE gc.guest_id = $1 AND gc.room_type_id = $2
        "#,
    )
    .bind(input.guest_id)
    .bind(input.room_type_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let nights_available = credit.get::<i32, _>("nights_available");
    let room_type_name = credit.get::<String, _>("room_type_name");

    let _ = AuditLog::log_event(
        &pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "guest_complimentary_credits_granted",
            resource_type: "guest",
            resource_id: Some(input.guest_id),
            details: Some(serde_json::json!({
                "guest_id": input.guest_id,
                "room_type_id": input.room_type_id,
                "room_type_name": room_type_name,
                "nights_added": input.nights,
                "nights_available": nights_available,
                "reason": reason,
            })),
            ..Default::default()
        },
    )
    .await;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Added {} nights to guest credits", input.nights),
        "credit": {
            "guest_id": credit.get::<i64, _>("guest_id"),
            "guest_name": credit.get::<String, _>("guest_name"),
            "room_type_id": credit.get::<i64, _>("room_type_id"),
            "room_type_name": room_type_name,
            "nights_available": nights_available,
            "reason": reason,
            "notes": reason
        }
    })))
}

fn normalize_credit_reason(reason: Option<&str>) -> Result<String, ApiError> {
    let reason = reason
        .map(Sanitizer::sanitize_notes)
        .unwrap_or_default()
        .trim()
        .to_string();

    if reason.is_empty() {
        return Err(ApiError::BadRequest(
            "A reason is required when granting complimentary credits".to_string(),
        ));
    }

    if reason.chars().count() > 500 {
        return Err(ApiError::BadRequest(
            "Complimentary credit reason must be 500 characters or fewer".to_string(),
        ));
    }

    Ok(reason)
}

/// Update guest complimentary credits
pub async fn update_guest_credits_handler(
    State(pool): State<DbPool>,
    Path((guest_id, room_type_id)): Path<(i64, i64)>,
    Json(input): Json<UpdateGuestCreditsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Check if credit record exists
    let credit_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM guest_complimentary_credits WHERE guest_id = $1 AND room_type_id = $2)"
    )
    .bind(guest_id)
    .bind(room_type_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !credit_exists {
        return Err(ApiError::NotFound(format!(
            "Credit record not found for guest {} and room type {}",
            guest_id, room_type_id
        )));
    }

    if let Some(nights) = input.nights_available
        && nights < 0
    {
        return Err(ApiError::BadRequest(
            "Nights available cannot be negative".to_string(),
        ));
    }

    // Build update query dynamically
    let mut updates = Vec::new();
    let mut param_count = 0;

    if input.nights_available.is_some() {
        param_count += 1;
        updates.push(format!("nights_available = ${}", param_count));
    }
    if input.notes.is_some() {
        param_count += 1;
        updates.push(format!("notes = ${}", param_count));
    }

    if updates.is_empty() {
        return Err(ApiError::BadRequest("No fields to update".to_string()));
    }

    updates.push("updated_at = CURRENT_TIMESTAMP".to_string());

    let query = format!(
        "UPDATE guest_complimentary_credits SET {} WHERE guest_id = ${} AND room_type_id = ${}",
        updates.join(", "),
        param_count + 1,
        param_count + 2
    );

    let mut q = sqlx::query(&query);

    if let Some(nights) = input.nights_available {
        q = q.bind(nights);
    }
    if let Some(ref notes) = input.notes {
        q = q.bind(notes);
    }

    q = q.bind(guest_id).bind(room_type_id);

    q.execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Get updated credit info
    let credit = sqlx::query(
        r#"
        SELECT gc.guest_id, g.full_name as guest_name, gc.room_type_id, rt.name as room_type_name,
               gc.nights_available, gc.notes
        FROM guest_complimentary_credits gc
        INNER JOIN guests g ON gc.guest_id = g.id
        INNER JOIN room_types rt ON gc.room_type_id = rt.id
        WHERE gc.guest_id = $1 AND gc.room_type_id = $2
        "#,
    )
    .bind(guest_id)
    .bind(room_type_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Credits updated successfully",
        "credit": {
            "guest_id": credit.get::<i64, _>("guest_id"),
            "guest_name": credit.get::<String, _>("guest_name"),
            "room_type_id": credit.get::<i64, _>("room_type_id"),
            "room_type_name": credit.get::<String, _>("room_type_name"),
            "nights_available": credit.get::<i32, _>("nights_available"),
            "notes": credit.get::<Option<String>, _>("notes")
        }
    })))
}

/// Delete guest complimentary credits
pub async fn delete_guest_credits_handler(
    State(pool): State<DbPool>,
    Path((guest_id, room_type_id)): Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Check if credit record exists
    let credit = sqlx::query(
        r#"
        SELECT gc.nights_available, g.full_name as guest_name, rt.name as room_type_name
        FROM guest_complimentary_credits gc
        INNER JOIN guests g ON gc.guest_id = g.id
        INNER JOIN room_types rt ON gc.room_type_id = rt.id
        WHERE gc.guest_id = $1 AND gc.room_type_id = $2
        "#,
    )
    .bind(guest_id)
    .bind(room_type_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let credit = match credit {
        Some(c) => c,
        None => {
            return Err(ApiError::NotFound(format!(
                "Credit record not found for guest {} and room type {}",
                guest_id, room_type_id
            )));
        }
    };

    let nights_deleted = credit.get::<i32, _>("nights_available");
    let guest_name = credit.get::<String, _>("guest_name");
    let room_type_name = credit.get::<String, _>("room_type_name");

    // Delete the credit record
    sqlx::query(
        "DELETE FROM guest_complimentary_credits WHERE guest_id = $1 AND room_type_id = $2",
    )
    .bind(guest_id)
    .bind(room_type_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Deleted {} nights of {} credits for {}", nights_deleted, room_type_name, guest_name),
        "deleted": {
            "guest_id": guest_id,
            "guest_name": guest_name,
            "room_type_id": room_type_id,
            "room_type_name": room_type_name,
            "nights_deleted": nights_deleted
        }
    })))
}

#[cfg(test)]
mod tests {
    use super::normalize_credit_reason;

    #[test]
    fn complimentary_credit_reason_is_required() {
        assert!(normalize_credit_reason(None).is_err());
        assert!(normalize_credit_reason(Some("   ")).is_err());
    }

    #[test]
    fn complimentary_credit_reason_is_sanitized_and_trimmed() {
        let reason = normalize_credit_reason(Some("  Loyalty reward\u{0007}  ")).unwrap();
        assert_eq!(reason, "Loyalty reward");
    }

    #[test]
    fn complimentary_credit_reason_is_limited_to_five_hundred_characters() {
        assert!(normalize_credit_reason(Some(&"a".repeat(500))).is_ok());
        assert!(normalize_credit_reason(Some(&"a".repeat(501))).is_err());
    }
}
