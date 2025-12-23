//! Guest handlers
//!
//! Handles guest CRUD and user-guest relationships.

use crate::core::auth::AuthService;
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::models::*;
use axum::{
    extract::{Extension, Path, State},
    http::HeaderMap,
    response::Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use sqlx::PgPool;

pub async fn get_guests_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<Guest>>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let is_admin = AuthService::check_role(&pool, user_id, "admin")
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let guests = if is_admin {
        sqlx::query_as::<_, Guest>(
            r#"
            SELECT
                id,
                full_name,
                email,
                phone,
                id_number as ic_number,
                nationality,
                address_line1,
                city,
                state_province,
                postal_code,
                country,
                title,
                alt_phone,
                COALESCE(is_active, true) as is_active,
                created_at,
                updated_at
            FROM guests
            WHERE deleted_at IS NULL
            ORDER BY full_name
            "#
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
    } else {
        vec![]
    };

    Ok(Json(guests))
}

pub async fn create_guest_handler(
    State(pool): State<PgPool>,
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
    if input.email.trim().is_empty() {
        return Err(ApiError::BadRequest("Email cannot be empty".to_string()));
    }

    let email_regex = regex::Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$").unwrap();
    if !email_regex.is_match(&input.email) {
        return Err(ApiError::BadRequest("Invalid email format".to_string()));
    }

    let guest = sqlx::query_as::<_, Guest>(
        r#"
        INSERT INTO guests (first_name, last_name, email, phone, id_number, nationality, address_line1, city, state_province, postal_code, country, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, full_name, email, phone, id_number as ic_number, nationality, address_line1, city, state_province, postal_code, country,
                  NULL::TEXT as title, NULL::TEXT as alt_phone,
                  true as is_active,
                  created_at, updated_at
        "#
    )
    .bind(&input.first_name)
    .bind(&input.last_name)
    .bind(&input.email)
    .bind(&input.phone)
    .bind(&input.ic_number)
    .bind(&input.nationality)
    .bind(&input.address_line1)
    .bind(&input.city)
    .bind(&input.state_province)
    .bind(&input.postal_code)
    .bind(&input.country)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(guest))
}

pub async fn update_guest_handler(
    State(pool): State<PgPool>,
    Path(guest_id): Path<i64>,
    Json(input): Json<GuestUpdateInput>,
) -> Result<Json<Guest>, ApiError> {
    let existing: Option<Guest> = sqlx::query_as(
        "SELECT id, full_name, email, phone, ic_number, nationality, address_line1, city, state_province, postal_code, country, title, alt_phone, is_active, created_at, updated_at FROM guests WHERE id = $1"
    )
    .bind(guest_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let existing = existing.ok_or_else(|| ApiError::NotFound("Guest not found".to_string()))?;

    let full_name = if input.first_name.is_some() || input.last_name.is_some() {
        let first = input.first_name.as_deref().unwrap_or_else(||
            existing.full_name.split_whitespace().next().unwrap_or("")
        );
        let last = input.last_name.as_deref().unwrap_or_else(||
            existing.full_name.split_whitespace().last().unwrap_or("")
        );
        format!("{} {}", first, last)
    } else {
        existing.full_name.clone()
    };

    let email = input.email.unwrap_or(existing.email.clone());
    let phone = input.phone.or(existing.phone.clone());
    let ic_number = input.ic_number.or(existing.ic_number.clone());
    let nationality = input.nationality.or(existing.nationality.clone());
    let address_line1 = input.address_line1.or(existing.address_line1.clone());
    let city = input.city.or(existing.city.clone());
    let state_province = input.state_province.or(existing.state_province.clone());
    let postal_code = input.postal_code.or(existing.postal_code.clone());
    let country = input.country.or(existing.country.clone());
    let title = input.title.or(existing.title.clone());
    let alt_phone = input.alt_phone.or(existing.alt_phone.clone());
    let is_active = input.is_active.unwrap_or(existing.is_active);

    let updated_guest: Guest = sqlx::query_as(
        r#"
        UPDATE guests
        SET full_name = $1,
            email = $2,
            phone = $3,
            ic_number = $4,
            nationality = $5,
            address_line1 = $6,
            city = $7,
            state_province = $8,
            postal_code = $9,
            country = $10,
            title = $11,
            alt_phone = $12,
            is_active = $13,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $14
        RETURNING id, full_name, email, phone, ic_number, nationality, address_line1, city, state_province, postal_code, country, title, alt_phone, is_active, created_at, updated_at
        "#
    )
    .bind(&full_name)
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
    .bind(is_active)
    .bind(guest_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(updated_guest))
}

pub async fn delete_guest_handler(
    State(pool): State<PgPool>,
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

    let has_bookings: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM bookings WHERE guest_id = $1 LIMIT 1"
    )
    .bind(guest_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if has_bookings.is_some() {
        return Err(ApiError::BadRequest(
            "Cannot delete guest with existing bookings. Please cancel or complete all bookings first.".to_string()
        ));
    }

    sqlx::query("DELETE FROM guests WHERE id = $1")
        .bind(guest_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Guest deleted successfully"
    })))
}

pub async fn get_guest_bookings_handler(
    State(pool): State<PgPool>,
    Path(guest_id): Path<i64>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
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
    State(pool): State<PgPool>,
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
    State(pool): State<PgPool>,
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
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<Guest>>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let guests = sqlx::query_as::<_, Guest>(
        r#"
        SELECT DISTINCT g.id, g.full_name, g.email, g.phone, g.id_number as ic_number, g.nationality, g.address_line1, g.city, g.state_province, g.postal_code, g.country, g.title, g.alt_phone, COALESCE(g.is_active, true) as is_active, g.created_at, g.updated_at
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
    State(pool): State<PgPool>,
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
