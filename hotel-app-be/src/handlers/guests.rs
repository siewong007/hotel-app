//! Guest handlers
//!
//! Handles guest CRUD and user-guest relationships.

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::models::*;
use crate::services::audit::AuditLog;
use crate::utils::sanitization::Sanitizer;
use axum::{
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct GuestPaginationParams {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    /// Search by name, email, or phone (partial match)
    pub search: Option<String>,
    /// Filter by guest type: "member" or "non_member"
    pub guest_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GuestPaginatedResponse {
    pub data: Vec<Guest>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

pub async fn get_guests_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<GuestPaginationParams>,
) -> Result<Json<GuestPaginatedResponse>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Check if user has guests:read or guests:manage permission
    let has_guest_access = AuthService::check_permission(&pool, user_id, "guests:read")
        .await
        .unwrap_or(false)
        || AuthService::check_permission(&pool, user_id, "guests:manage")
            .await
            .unwrap_or(false);

    if !has_guest_access {
        return Ok(Json(GuestPaginatedResponse {
            data: vec![],
            total: 0,
            page: 1,
            page_size: 100,
        }));
    }

    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(100).min(500);
    let offset = (page - 1) * page_size;

    let search = params.search.as_deref().filter(|s| !s.trim().is_empty());
    let guest_type_filter = params.guest_type.as_deref().filter(|s| !s.trim().is_empty());

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let like_op = "LIKE";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let like_op = "ILIKE";

    // Build WHERE clause conditions
    let type_clause = match guest_type_filter {
        Some(gt) if gt == "member" => " AND guest_type = 'member'",
        Some(gt) if gt == "non_member" => " AND (guest_type = 'non_member' OR guest_type IS NULL)",
        _ => "",
    };

    let select_cols = r#"id, full_name, email, phone, ic_number, nationality,
        address_line_1 as address_line1, city, state as state_province,
        postal_code, country, title, alt_phone, true as is_active,
        guest_type, tourism_type,
        COALESCE(discount_percentage, 0) as discount_percentage, company_name,
        COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
        created_at, updated_at"#;

    let (total, guests) = if let Some(q) = search {
        let pattern = format!("%{}%", q.trim());

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let (p1, p2, p3, p_limit, p_offset) = ("?1", "?1", "?1", "?2", "?3");
        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let (p1, p2, p3, p_limit, p_offset) = ("$1", "$1", "$1", "$2", "$3");

        let count_sql = format!(
            "SELECT COUNT(*) FROM guests WHERE deleted_at IS NULL{type_clause} AND \
             (full_name {like_op} {p1} OR email {like_op} {p2} OR phone {like_op} {p3})"
        );
        let data_sql = format!(
            "SELECT {select_cols} FROM guests \
             WHERE deleted_at IS NULL{type_clause} AND \
             (full_name {like_op} {p1} OR email {like_op} {p2} OR phone {like_op} {p3}) \
             ORDER BY full_name LIMIT {p_limit} OFFSET {p_offset}"
        );

        let total: i64 = sqlx::query_scalar(&count_sql)
            .bind(&pattern)
            .fetch_one(&pool)
            .await
            .unwrap_or(0);

        let guests = sqlx::query_as::<_, Guest>(&data_sql)
            .bind(&pattern)
            .bind(page_size)
            .bind(offset)
            .fetch_all(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        (total, guests)
    } else {
        let count_sql = format!(
            "SELECT COUNT(*) FROM guests WHERE deleted_at IS NULL{type_clause}"
        );
        let data_sql = format!(
            "SELECT {select_cols} FROM guests \
             WHERE deleted_at IS NULL{type_clause} \
             ORDER BY full_name \
             LIMIT $1 OFFSET $2"
        );

        let total: i64 = sqlx::query_scalar(&count_sql)
            .fetch_one(&pool)
            .await
            .unwrap_or(0);

        let guests = sqlx::query_as::<_, Guest>(&data_sql)
            .bind(page_size)
            .bind(offset)
            .fetch_all(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        (total, guests)
    };

    Ok(Json(GuestPaginatedResponse { data: guests, total, page, page_size }))
}

pub async fn create_guest_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<GuestInput>,
) -> Result<Json<Guest>, ApiError> {
    let user_id = require_auth(&headers).await?;

    if input.first_name.trim().is_empty() {
        return Err(ApiError::BadRequest("First name cannot be empty".to_string()));
    }
    if input.last_name.trim().is_empty() {
        return Err(ApiError::BadRequest("Last name cannot be empty".to_string()));
    }

    // Validate email format only if provided
    if let Some(ref email) = input.email
        && !email.trim().is_empty() {
            let email_regex = regex::Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$").unwrap();
            if !email_regex.is_match(email) {
                return Err(ApiError::BadRequest("Invalid email format".to_string()));
            }
        }

    // Sanitize inputs to prevent XSS and injection attacks
    let first_name = Sanitizer::sanitize_guest_name(&input.first_name);
    let last_name = Sanitizer::sanitize_guest_name(&input.last_name);

    // Normalize empty email to None so DB NULL constraint is satisfied
    let email = input.email.as_deref()
        .filter(|e| !e.trim().is_empty())
        .map(Sanitizer::sanitize_email);

    // Compute full_name from sanitized first_name and last_name
    let full_name = format!("{} {}", first_name, last_name).trim().to_string();

    // Default to NonMember if not specified
    let guest_type = input.guest_type.unwrap_or(GuestType::NonMember);
    let discount_percentage = input.discount_percentage.unwrap_or(0);

    // Block creation if a guest with the same full_name already exists (case-insensitive)
    let existing_guest_id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM guests WHERE LOWER(TRIM(full_name)) = LOWER($1) AND deleted_at IS NULL LIMIT 1"
    )
    .bind(&full_name)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if existing_guest_id.is_some() {
        return Err(ApiError::BadRequest(format!(
            "A guest with the name '{}' already exists. Please select the existing guest instead of creating a new one.",
            full_name
        )));
    }

    let guest = sqlx::query_as::<_, Guest>(
        r#"
        INSERT INTO guests (full_name, first_name, last_name, email, phone, ic_number, nationality, address_line_1, city, state, postal_code, country, guest_type, tourism_type, discount_percentage, company_name, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id, full_name, email, phone, ic_number, nationality, address_line_1 as address_line1, city, state as state_province, postal_code, country,
                  NULL::TEXT as title, NULL::TEXT as alt_phone,
                  true as is_active,
                  guest_type,
                  tourism_type,
                  COALESCE(discount_percentage, 0) as discount_percentage,
                  company_name,
                  COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
                  created_at, updated_at
        "#
    )
    .bind(&full_name)
    .bind(&first_name)
    .bind(&last_name)
    .bind(&email)
    .bind(input.phone.as_deref().map(Sanitizer::sanitize_phone))
    .bind(input.ic_number.as_deref().map(Sanitizer::sanitize_text))
    .bind(input.nationality.as_deref().map(Sanitizer::sanitize_text))
    .bind(input.address_line1.as_deref().map(Sanitizer::sanitize_text))
    .bind(input.city.as_deref().map(Sanitizer::sanitize_text))
    .bind(input.state_province.as_deref().map(Sanitizer::sanitize_text))
    .bind(input.postal_code.as_deref().map(Sanitizer::sanitize_text))
    .bind(input.country.as_deref().map(Sanitizer::sanitize_text))
    .bind(&guest_type)
    .bind(&input.tourism_type)
    .bind(discount_percentage)
    .bind(input.company_name.as_deref().map(Sanitizer::sanitize_text))
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Log guest creation
    let _ = AuditLog::log_event(
        &pool,
        Some(user_id),
        "guest_created",
        "guest",
        Some(guest.id),
        Some(serde_json::json!({"name": &guest.full_name, "email": &guest.email})),
        None,
        None,
    ).await;

    Ok(Json(guest))
}

pub async fn update_guest_handler(
    State(pool): State<DbPool>,
    Path(guest_id): Path<i64>,
    Json(input): Json<GuestUpdateInput>,
) -> Result<Json<Guest>, ApiError> {
    // Get basic existing guest data (limited tuple to avoid FromRow size limit)
    #[allow(clippy::type_complexity)]
    let existing_basic: Option<(i64, String, String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, first_name, last_name, email, phone, ic_number, nationality, address_line_1, city, state, postal_code, country, title, alt_phone, company_name FROM guests WHERE id = $1 AND deleted_at IS NULL"
    )
    .bind(guest_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let existing_basic = existing_basic.ok_or_else(|| ApiError::NotFound("Guest not found".to_string()))?;

    // Get guest_type, tourism_type, and discount_percentage separately
    let (existing_guest_type, existing_tourism_type, existing_discount_percentage): (GuestType, Option<TourismType>, i32) = sqlx::query_as(
        "SELECT guest_type, tourism_type, COALESCE(discount_percentage, 0) FROM guests WHERE id = $1"
    )
    .bind(guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Extract existing values
    let (_, existing_first_name, existing_last_name, existing_email, existing_phone, existing_ic_number, existing_nationality, existing_address_line1, existing_city, existing_state_province, existing_postal_code, existing_country, existing_title, existing_alt_phone, existing_company_name) = existing_basic;

    // Apply updates, falling back to existing values
    let first_name = input.first_name.unwrap_or(existing_first_name);
    let last_name = input.last_name.unwrap_or(existing_last_name);
    // Normalize empty email to None so DB check constraint is satisfied
    let email = match input.email {
        Some(ref e) if e.trim().is_empty() => None,
        Some(e) => {
            let trimmed = e.trim().to_string();
            // Validate email format
            let email_regex = regex::Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$").unwrap();
            if !email_regex.is_match(&trimmed) {
                return Err(ApiError::BadRequest("Invalid email format".to_string()));
            }
            Some(trimmed)
        },
        None => existing_email,
    };
    let phone = input.phone.or(existing_phone);
    let ic_number = input.ic_number.or(existing_ic_number);
    let nationality = input.nationality.or(existing_nationality);
    let address_line1 = input.address_line1.or(existing_address_line1);
    let city = input.city.or(existing_city);
    let state_province = input.state_province.or(existing_state_province);
    let postal_code = input.postal_code.or(existing_postal_code);
    let country = input.country.or(existing_country);
    let title = input.title.or(existing_title);
    let alt_phone = input.alt_phone.or(existing_alt_phone);
    let _is_active = input.is_active.unwrap_or(true);
    let guest_type = input.guest_type.unwrap_or(existing_guest_type);
    let tourism_type = input.tourism_type.or(existing_tourism_type);
    let discount_percentage = input.discount_percentage.unwrap_or(existing_discount_percentage);
    let company_name = match input.company_name {
        Some(ref c) if c.trim().is_empty() => None,
        Some(c) => Some(c),
        None => existing_company_name,
    };

    // Compute full_name from first_name and last_name
    let full_name = format!("{} {}", first_name.trim(), last_name.trim()).trim().to_string();

    // Check if another guest already has this full_name (case-insensitive)
    let name_conflict: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM guests WHERE LOWER(TRIM(full_name)) = LOWER($1) AND deleted_at IS NULL AND id != $2 LIMIT 1"
    )
    .bind(&full_name)
    .bind(guest_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if name_conflict.is_some() {
        return Err(ApiError::BadRequest(format!(
            "A guest with the name '{}' already exists. Guest names must be unique.",
            full_name
        )));
    }

    let updated_guest: Guest = sqlx::query_as(
        r#"
        UPDATE guests
        SET full_name = $1,
            first_name = $2,
            last_name = $3,
            email = $4,
            phone = $5,
            ic_number = $6,
            nationality = $7,
            address_line_1 = $8,
            city = $9,
            state = $10,
            postal_code = $11,
            country = $12,
            title = $13,
            alt_phone = $14,
            guest_type = $15,
            tourism_type = $16,
            discount_percentage = $17,
            company_name = $18,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $19
        RETURNING id, full_name, email, phone, ic_number, nationality, address_line_1 as address_line1, city, state as state_province, postal_code, country, title, alt_phone, true as is_active, guest_type, tourism_type, COALESCE(discount_percentage, 0) as discount_percentage, company_name, COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit, created_at, updated_at
        "#
    )
    .bind(&full_name)
    .bind(&first_name)
    .bind(&last_name)
    .bind(&email)
    .bind(&phone)
    .bind(&ic_number)
    .bind(&nationality)
    .bind(&address_line1)
    .bind(&city)
    .bind(&state_province)
    .bind(&postal_code)
    .bind(&country)
    .bind(&title)
    .bind(&alt_phone)
    .bind(&guest_type)
    .bind(&tourism_type)
    .bind(discount_percentage)
    .bind(&company_name)
    .bind(guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Log guest update
    let _ = AuditLog::log_event(
        &pool,
        None,  // No user_id available in this handler
        "guest_updated",
        "guest",
        Some(guest_id),
        Some(serde_json::json!({"name": &updated_guest.full_name})),
        None,
        None,
    ).await;

    Ok(Json(updated_guest))
}

pub async fn delete_guest_handler(
    State(pool): State<DbPool>,
    Path(guest_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM guests WHERE id = $1")
        .bind(guest_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if exists.is_none() {
        return Err(ApiError::NotFound("Guest not found".to_string()));
    }

    // Only block deletion if the guest is currently checked in
    let has_active_booking: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM bookings WHERE guest_id = $1 AND status = 'checked_in' LIMIT 1"
    )
    .bind(guest_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if has_active_booking.is_some() {
        return Err(ApiError::BadRequest(
            "Cannot delete guest who is currently checked in. Please complete the checkout first.".to_string()
        ));
    }

    // Hard delete guest - related bookings will be cascade deleted via foreign key constraint
    sqlx::query("DELETE FROM guests WHERE id = $1")
        .bind(guest_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Log guest deletion
    let _ = AuditLog::log_event(
        &pool,
        None,  // No user_id available in this handler
        "guest_deleted",
        "guest",
        Some(guest_id),
        None,
        None,
        None,
    ).await;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Guest deleted successfully"
    })))
}

pub async fn get_guest_bookings_handler(
    State(pool): State<DbPool>,
    Path(guest_id): Path<i64>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    #[allow(clippy::type_complexity)]
    let rows: Vec<(i64, Option<String>, NaiveDate, NaiveDate, Option<i32>, String, Decimal, DateTime<Utc>, String, String)> = sqlx::query_as(
        r#"
        SELECT
            b.id,
            b.booking_number,
            b.check_in_date,
            b.check_out_date,
            (b.check_out_date - b.check_in_date) as nights,
            b.status,
            b.total_amount,
            b.created_at,
            r.room_number,
            rt.name as room_type
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        LEFT JOIN room_types rt ON r.room_type_id = rt.id
        WHERE b.guest_id = $1
        ORDER BY b.created_at DESC
        "#
    )
    .bind(guest_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let result: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(id, booking_number, check_in_date, check_out_date, nights, status, total_amount, created_at, room_number, room_type)| serde_json::json!({
            "id": id.to_string(),
            "booking_number": booking_number,
            "check_in_date": check_in_date,
            "check_out_date": check_out_date,
            "nights": nights,
            "status": status,
            "total_amount": total_amount.to_string(),
            "created_at": created_at,
            "room_number": room_number,
            "room_type": room_type
        }))
        .collect();

    Ok(Json(result))
}

pub async fn link_guest_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<LinkGuestInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let guest_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM guests WHERE id = $1 AND deleted_at IS NULL)"
    )
    .bind(input.guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !guest_exists {
        return Err(ApiError::NotFound("Guest not found".to_string()));
    }

    sqlx::query(
        r#"
        INSERT INTO user_guests (user_id, guest_id, relationship_type, can_book_for, can_view_bookings, can_modify, notes, linked_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id, guest_id) DO UPDATE SET
            relationship_type = EXCLUDED.relationship_type,
            can_book_for = EXCLUDED.can_book_for,
            can_view_bookings = EXCLUDED.can_view_bookings,
            can_modify = EXCLUDED.can_modify,
            notes = EXCLUDED.notes
        "#
    )
    .bind(user_id)
    .bind(input.guest_id)
    .bind(input.relationship_type.unwrap_or_else(|| "owner".to_string()))
    .bind(input.can_book_for.unwrap_or(true))
    .bind(input.can_view_bookings.unwrap_or(true))
    .bind(input.can_modify.unwrap_or(true))
    .bind(input.notes)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "message": "Guest linked successfully",
        "guest_id": input.guest_id
    })))
}

pub async fn unlink_guest_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let result = sqlx::query(
        "DELETE FROM user_guests WHERE user_id = $1 AND guest_id = $2"
    )
    .bind(user_id)
    .bind(guest_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("Guest link not found".to_string()));
    }

    Ok(Json(serde_json::json!({
        "message": "Guest unlinked successfully",
        "guest_id": guest_id
    })))
}

pub async fn get_my_guests_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<Guest>>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let guests = sqlx::query_as::<_, Guest>(
        r#"
        SELECT DISTINCT g.id, g.full_name, g.email, g.phone, g.ic_number, g.nationality,
               g.address_line_1 as address_line1, g.city, g.state as state_province, g.postal_code, g.country, g.title, g.alt_phone,
               true as is_active,
               g.guest_type,
               g.tourism_type,
               COALESCE(g.discount_percentage, 0) as discount_percentage,
               COALESCE(g.complimentary_nights_credit, 0) as complimentary_nights_credit,
               g.created_at, g.updated_at
        FROM guests g
        INNER JOIN user_guests ug ON g.id = ug.guest_id
        WHERE ug.user_id = $1 AND g.deleted_at IS NULL
        ORDER BY g.full_name
        "#
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(guests))
}

pub async fn upgrade_guest_to_user_handler(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Json(input): Json<UpgradeGuestInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let has_relationship: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_guests WHERE user_id = $1 AND guest_id = $2 AND can_modify = true)"
    )
    .bind(user_id)
    .bind(input.guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if !has_relationship {
        return Err(ApiError::Unauthorized("You don't have permission to upgrade this guest".to_string()));
    }

    let password_hash = AuthService::hash_password(&input.password)
        .await
        .map_err(|_| ApiError::Internal("Password hashing failed".to_string()))?;

    let new_user_id: i64 = sqlx::query_scalar(
        "SELECT upgrade_guest_to_user($1, $2, $3, $4)"
    )
    .bind(input.guest_id)
    .bind(&input.username)
    .bind(&password_hash)
    .bind(input.role.unwrap_or_else(|| "guest".to_string()))
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        let err_msg = e.to_string();
        if err_msg.contains("already exists") {
            ApiError::BadRequest("User with this email already exists".to_string())
        } else if err_msg.contains("not found") {
            ApiError::NotFound("Guest not found or deleted".to_string())
        } else {
            ApiError::Database(err_msg)
        }
    })?;

    Ok(Json(serde_json::json!({
        "message": "Guest upgraded to user successfully",
        "guest_id": input.guest_id,
        "user_id": new_user_id,
        "username": input.username
    })))
}

/// Get guest complimentary credits by room type
pub async fn get_guest_credits_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Path(guest_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Verify user has access to this guest
    let has_access: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_guests WHERE user_id = $1 AND guest_id = $2)"
    )
    .bind(user_id)
    .bind(guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Also check if user has guests:read permission
    let has_guest_permission = AuthService::check_permission(&pool, user_id, "guests:read")
        .await
        .unwrap_or(false);

    if !has_access && !has_guest_permission {
        return Err(ApiError::Unauthorized("You don't have access to this guest's credits".to_string()));
    }

    // Get guest info
    let guest_info: Option<(i64, String)> = sqlx::query_as(
        "SELECT id, full_name FROM guests WHERE id = $1 AND deleted_at IS NULL"
    )
    .bind(guest_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let (guest_id, guest_name) = guest_info.ok_or_else(|| ApiError::NotFound("Guest not found".to_string()))?;

    // Get credits by room type from the guest_complimentary_credits table
    // If it doesn't exist, we'll try to create it from the legacy complimentary_nights_credit field
    // Note: gcc.id is i32 (integer), guest_id and room_type_id are i64 (bigint)
    #[allow(clippy::type_complexity)]
    let credits: Vec<(i32, i64, i64, String, String, i32, DateTime<Utc>, DateTime<Utc>)> = sqlx::query_as(
        r#"
        SELECT
            gcc.id,
            gcc.guest_id,
            gcc.room_type_id,
            rt.name as room_type_name,
            rt.code as room_type_code,
            gcc.nights_available,
            gcc.created_at,
            gcc.updated_at
        FROM guest_complimentary_credits gcc
        INNER JOIN room_types rt ON gcc.room_type_id = rt.id
        WHERE gcc.guest_id = $1 AND gcc.nights_available > 0
        ORDER BY rt.name
        "#
    )
    .bind(guest_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let credits_by_room_type: Vec<serde_json::Value> = credits
        .into_iter()
        .map(|(id, guest_id, room_type_id, room_type_name, room_type_code, nights_available, created_at, updated_at)| {
            serde_json::json!({
                "id": id,
                "guest_id": guest_id,
                "room_type_id": room_type_id,
                "room_type_name": room_type_name,
                "room_type_code": room_type_code,
                "nights_available": nights_available,
                "created_at": created_at,
                "updated_at": updated_at
            })
        })
        .collect();

    let total_nights: i32 = credits_by_room_type
        .iter()
        .map(|c| c["nights_available"].as_i64().unwrap_or(0) as i32)
        .sum();

    // Also get the legacy total from the guest table
    let legacy_total: i32 = sqlx::query_scalar(
        "SELECT COALESCE(complimentary_nights_credit, 0) FROM guests WHERE id = $1"
    )
    .bind(guest_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    Ok(Json(serde_json::json!({
        "guest_id": guest_id,
        "guest_name": guest_name,
        "total_nights": total_nights,
        "legacy_total_nights": legacy_total,
        "credits_by_room_type": credits_by_room_type
    })))
}

/// Get my linked guests with their complimentary credits by room type
pub async fn get_my_guests_with_credits_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Get all linked guests
    let guests: Vec<(i64, String, String, i32)> = sqlx::query_as(
        r#"
        SELECT DISTINCT g.id, g.full_name, g.email, COALESCE(g.complimentary_nights_credit, 0) as legacy_credits
        FROM guests g
        INNER JOIN user_guests ug ON g.id = ug.guest_id
        WHERE ug.user_id = $1 AND g.deleted_at IS NULL
        ORDER BY g.full_name
        "#
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut result = Vec::new();

    for (guest_id, full_name, email, legacy_credits) in guests {
        // Get credits by room type for each guest
        let credits: Vec<(i64, String, String, i32)> = sqlx::query_as(
            r#"
            SELECT
                gcc.room_type_id,
                rt.name as room_type_name,
                rt.code as room_type_code,
                gcc.nights_available
            FROM guest_complimentary_credits gcc
            INNER JOIN room_types rt ON gcc.room_type_id = rt.id
            WHERE gcc.guest_id = $1 AND gcc.nights_available > 0
            ORDER BY rt.name
            "#
        )
        .bind(guest_id)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        let credits_by_room_type: Vec<serde_json::Value> = credits
            .into_iter()
            .map(|(room_type_id, room_type_name, room_type_code, nights_available)| {
                serde_json::json!({
                    "room_type_id": room_type_id,
                    "room_type_name": room_type_name,
                    "room_type_code": room_type_code,
                    "nights_available": nights_available
                })
            })
            .collect();

        let total_credits: i32 = credits_by_room_type
            .iter()
            .map(|c| c["nights_available"].as_i64().unwrap_or(0) as i32)
            .sum();

        result.push(serde_json::json!({
            "id": guest_id,
            "full_name": full_name,
            "email": email,
            "legacy_complimentary_nights_credit": legacy_credits,
            "total_complimentary_credits": total_credits,
            "credits_by_room_type": credits_by_room_type
        }));
    }

    Ok(Json(result))
}
