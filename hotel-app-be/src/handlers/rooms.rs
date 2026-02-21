//! Room handlers
//!
//! Handles room CRUD, status management, and events.

use crate::core::db::{DbPool, opt_decimal_to_db, DbRow};
use crate::core::error::ApiError;
use crate::core::middleware::{require_auth, require_permission_helper};
use crate::handlers::rooms_queries::*;
use crate::models::*;
use crate::services::audit::AuditLog;
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use sqlx::Row;

/// Helper function to map a database row to RoomType
/// This avoids using FromRow which doesn't work for Decimal in SQLite
fn row_to_room_type(row: &DbRow) -> RoomType {
    // Read Decimal fields - try Decimal first (PostgreSQL NUMERIC), then String, then f64 (SQLite)
    let base_price: Decimal = row.try_get::<Decimal, _>("base_price")
        .or_else(|_| row.try_get::<String, _>("base_price").map(|s| s.parse().unwrap_or_default()))
        .or_else(|_| row.try_get::<f64, _>("base_price").map(|f| Decimal::from_f64_retain(f).unwrap_or_default()))
        .unwrap_or_default();
    let weekday_rate: Option<Decimal> = row.try_get::<Decimal, _>("weekday_rate").ok()
        .or_else(|| row.try_get::<String, _>("weekday_rate").ok().and_then(|s| s.parse().ok()))
        .or_else(|| row.try_get::<f64, _>("weekday_rate").ok().and_then(|f| Decimal::from_f64_retain(f)));
    let weekend_rate: Option<Decimal> = row.try_get::<Decimal, _>("weekend_rate").ok()
        .or_else(|| row.try_get::<String, _>("weekend_rate").ok().and_then(|s| s.parse().ok()))
        .or_else(|| row.try_get::<f64, _>("weekend_rate").ok().and_then(|f| Decimal::from_f64_retain(f)));
    let extra_bed_charge: Decimal = row.try_get::<Decimal, _>("extra_bed_charge")
        .or_else(|_| row.try_get::<String, _>("extra_bed_charge").map(|s| s.parse().unwrap_or_default()))
        .or_else(|_| row.try_get::<f64, _>("extra_bed_charge").map(|f| Decimal::from_f64_retain(f).unwrap_or_default()))
        .unwrap_or_default();

    // Handle boolean fields for SQLite (returns 0/1)
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let allows_extra_bed: bool = row.try_get::<i32, _>("allows_extra_bed").map(|v| v != 0).unwrap_or(false);
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    let allows_extra_bed: bool = row.try_get("allows_extra_bed").unwrap_or(false);

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let is_active: bool = row.try_get::<i32, _>("is_active").map(|v| v != 0).unwrap_or(true);
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    let is_active: bool = row.try_get("is_active").unwrap_or(true);

    RoomType {
        id: row.get("id"),
        name: row.get("name"),
        code: row.get("code"),
        description: row.try_get("description").ok(),
        base_price,
        weekday_rate,
        weekend_rate,
        max_occupancy: row.get("max_occupancy"),
        bed_type: row.try_get("bed_type").ok(),
        bed_count: row.try_get("bed_count").ok(),
        allows_extra_bed,
        max_extra_beds: row.try_get("max_extra_beds").unwrap_or(0),
        extra_bed_charge,
        is_active,
        sort_order: row.try_get("sort_order").unwrap_or(0),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

pub async fn get_rooms_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<RoomWithRating>>, ApiError> {
    // Use database-specific query
    let rows = sqlx::query(GET_ROOMS_QUERY)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut rooms = Vec::new();
    for row in rows {
        // Read average_rating as f64 (works for both PostgreSQL and SQLite NULL)
        let average_rating: Option<f64> = row.try_get(9).ok();
        let review_count: Option<i64> = row.try_get(10).ok();
        let status: Option<String> = row.try_get(11).ok();
        let maintenance_start_date: Option<DateTime<Utc>> = row.try_get(12).ok();
        let maintenance_end_date: Option<DateTime<Utc>> = row.try_get(13).ok();
        let cleaning_start_date: Option<DateTime<Utc>> = row.try_get(14).ok();
        let cleaning_end_date: Option<DateTime<Utc>> = row.try_get(15).ok();
        let reserved_start_date: Option<DateTime<Utc>> = row.try_get(16).ok();
        let reserved_end_date: Option<DateTime<Utc>> = row.try_get(17).ok();

        // Handle available field - SQLite returns 0/1, PostgreSQL returns bool
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let available: bool = row.get::<i32, _>(4) != 0;
        #[cfg(any(
            all(feature = "postgres", not(feature = "sqlite")),
            all(feature = "sqlite", feature = "postgres")
        ))]
        let available: bool = row.get(4);

        rooms.push(RoomWithRating {
            id: row.get(0),
            room_number: row.get(1),
            room_type: row.get(2),
            price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
            available,
            description: row.get(5),
            max_occupancy: row.get(6),
            created_at: row.get(7),
            updated_at: row.get(8),
            average_rating,
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
    State(pool): State<DbPool>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<RoomWithRating>>, ApiError> {
    // Parse date range if provided for availability check
    let check_in: Option<NaiveDate> = query.check_in_date.as_ref()
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
    let check_out: Option<NaiveDate> = query.check_out_date.as_ref()
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());

    // Use database-specific queries
    let rows = if let (Some(ci), Some(co)) = (check_in, check_out) {
        sqlx::query(SEARCH_ROOMS_WITH_DATES_QUERY)
            .bind(ci)
            .bind(co)
            .fetch_all(&pool)
            .await
    } else {
        sqlx::query(SEARCH_ROOMS_NO_DATES_QUERY)
            .fetch_all(&pool)
            .await
    }
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut rooms = Vec::new();
    for row in rows {
        let average_rating: Option<f64> = row.try_get(9).ok();
        let review_count: Option<i64> = row.try_get(10).ok();
        let status: Option<String> = row.try_get(11).ok();
        let maintenance_start_date: Option<DateTime<Utc>> = row.try_get(12).ok();
        let maintenance_end_date: Option<DateTime<Utc>> = row.try_get(13).ok();
        let cleaning_start_date: Option<DateTime<Utc>> = row.try_get(14).ok();
        let cleaning_end_date: Option<DateTime<Utc>> = row.try_get(15).ok();
        let reserved_start_date: Option<DateTime<Utc>> = row.try_get(16).ok();
        let reserved_end_date: Option<DateTime<Utc>> = row.try_get(17).ok();

        // Handle available field - SQLite returns 0/1, PostgreSQL returns bool
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let available: bool = row.get::<i32, _>(4) != 0;
        #[cfg(any(
            all(feature = "postgres", not(feature = "sqlite")),
            all(feature = "sqlite", feature = "postgres")
        ))]
        let available: bool = row.get(4);

        rooms.push(RoomWithRating {
            id: row.get(0),
            room_number: row.get(1),
            room_type: row.get(2),
            price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
            available,
            description: row.get(5),
            max_occupancy: row.get(6),
            created_at: row.get(7),
            updated_at: row.get(8),
            average_rating,
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
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    Json(input): Json<RoomUpdateInput>,
) -> Result<Json<Room>, ApiError> {
    // Check if room exists and get current values with JOIN to room_types
    let existing_row = sqlx::query(GET_EXISTING_ROOM_FOR_UPDATE)
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    let current_room_number: String = existing_row.get(1);
    let current_room_type: String = existing_row.get(2);
    let current_price: Decimal = existing_row.get::<String, _>(3).parse().unwrap_or_default();

    // Handle available field - SQLite returns 0/1, PostgreSQL returns bool
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let current_available: bool = existing_row.get::<i32, _>(4) != 0;
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
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
        let active_booking: Option<i64> = sqlx::query_scalar(CHECK_ACTIVE_BOOKING)
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
        sqlx::query(UPDATE_ROOM_WITH_STATUS_QUERY)
            .bind(room_number)
            .bind(opt_decimal_to_db(custom_price))
            .bind(status)
            .bind(room_id)
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    } else {
        sqlx::query(UPDATE_ROOM_NO_STATUS_QUERY)
            .bind(room_number)
            .bind(opt_decimal_to_db(custom_price))
            .bind(room_id)
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    let row = sqlx::query(GET_ROOM_BY_ID_QUERY)
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Handle available field - SQLite returns 0/1, PostgreSQL returns bool
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let available: bool = row.get::<i32, _>(4) != 0;
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    let available: bool = row.get(4);

    Ok(Json(Room {
        id: row.get(0),
        room_number: row.get(1),
        room_type: row.get(2),
        price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
        available,
        description: row.get(5),
        max_occupancy: row.get(6),
        status: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
    }))
}

pub async fn create_room_handler(
    State(pool): State<DbPool>,
    Json(input): Json<RoomCreateInput>,
) -> Result<Json<Room>, ApiError> {
    let existing: Option<i64> = sqlx::query_scalar(CHECK_ROOM_NUMBER_EXISTS)
        .bind(&input.room_number)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if existing.is_some() {
        return Err(ApiError::BadRequest(format!("Room number '{}' already exists", input.room_number)));
    }

    let room_type_exists: Option<i64> = sqlx::query_scalar(CHECK_ROOM_TYPE_EXISTS)
        .bind(input.room_type_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if room_type_exists.is_none() {
        return Err(ApiError::BadRequest("Invalid room_type_id".to_string()));
    }

    let custom_price_decimal = input.custom_price
        .map(|p| Decimal::from_f64_retain(p).unwrap_or_default());

    // SQLite doesn't support RETURNING, so we need different handling
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let room_id: i64 = {
        sqlx::query(INSERT_ROOM_QUERY)
            .bind(&input.room_number)
            .bind(input.room_type_id)
            .bind(input.floor)
            .bind(&input.building)
            .bind(opt_decimal_to_db(custom_price_decimal))
            .bind(if input.is_accessible.unwrap_or(false) { 1i32 } else { 0i32 })
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        sqlx::query_scalar::<_, i64>("SELECT last_insert_rowid()")
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    };

    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    let room_id: i64 = sqlx::query_scalar(INSERT_ROOM_QUERY)
        .bind(&input.room_number)
        .bind(input.room_type_id)
        .bind(input.floor)
        .bind(&input.building)
        .bind(opt_decimal_to_db(custom_price_decimal))
        .bind(input.is_accessible.unwrap_or(false))
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let row = sqlx::query(GET_ROOM_BY_ID_QUERY)
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Handle available field - SQLite returns 0/1, PostgreSQL returns bool
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let available: bool = row.get::<i32, _>(4) != 0;
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    let available: bool = row.get(4);

    Ok(Json(Room {
        id: row.get(0),
        room_number: row.get(1),
        room_type: row.get(2),
        price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
        available,
        description: row.get(5),
        max_occupancy: row.get(6),
        status: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
    }))
}

pub async fn delete_room_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let room_exists: Option<i64> = sqlx::query_scalar(CHECK_ROOM_EXISTS_BY_ID)
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if room_exists.is_none() {
        return Err(ApiError::NotFound("Room not found".to_string()));
    }

    // Only block deletion if there are currently checked-in guests
    let has_active_booking: Option<i64> = sqlx::query_scalar(CHECK_ROOM_HAS_ACTIVE_BOOKING)
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if has_active_booking.is_some() {
        return Err(ApiError::BadRequest(
            "Cannot delete room with a guest currently checked in. Please complete the checkout first.".to_string()
        ));
    }

    // Delete all bookings associated with this room (past, pending, confirmed, cancelled)
    sqlx::query(DELETE_ROOM_BOOKINGS)
        .bind(room_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Delete room status change logs
    sqlx::query(DELETE_ROOM_STATUS_LOGS)
        .bind(room_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Now delete the room
    sqlx::query(DELETE_ROOM_QUERY)
        .bind(room_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Room and associated bookings deleted successfully"
    })))
}

pub async fn get_room_types_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<RoomType>>, ApiError> {
    let rows = sqlx::query(GET_ROOM_TYPES_ACTIVE)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let room_types: Vec<RoomType> = rows.iter().map(row_to_room_type).collect();
    Ok(Json(room_types))
}

pub async fn get_all_room_types_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<RoomType>>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;

    let rows = sqlx::query(GET_ALL_ROOM_TYPES)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let room_types: Vec<RoomType> = rows.iter().map(row_to_room_type).collect();
    Ok(Json(room_types))
}

pub async fn get_room_type_handler(
    State(pool): State<DbPool>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<RoomType>, ApiError> {
    require_permission_helper(&pool, &headers, "rooms:read").await?;

    let row = sqlx::query(GET_ROOM_TYPE_BY_ID)
        .bind(id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(row_to_room_type(&row)))
}

pub async fn create_room_type_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<RoomTypeCreateInput>,
) -> Result<Json<RoomType>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:write").await?;

    // Convert f64 prices to Decimal for proper binding to DECIMAL columns
    let base_price_decimal = Decimal::from_f64_retain(input.base_price).unwrap_or(Decimal::ZERO);
    let weekday_rate_decimal = input.weekday_rate.map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO));
    let weekend_rate_decimal = input.weekend_rate.map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO));
    let extra_bed_charge_decimal = Decimal::from_f64_retain(input.extra_bed_charge.unwrap_or(0.0)).unwrap_or(Decimal::ZERO);

    // PostgreSQL version with RETURNING
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    let room_type_id: i64 = {
        let row = sqlx::query(
            r#"
            INSERT INTO room_types (
                name, code, description, base_price, weekday_rate, weekend_rate,
                max_occupancy, bed_type, bed_count, allows_extra_bed, max_extra_beds,
                extra_bed_charge, sort_order
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id
            "#
        )
        .bind(&input.name)
        .bind(&input.code)
        .bind(&input.description)
        .bind(base_price_decimal)
        .bind(weekday_rate_decimal)
        .bind(weekend_rate_decimal)
        .bind(input.max_occupancy.unwrap_or(2))
        .bind(&input.bed_type)
        .bind(input.bed_count.unwrap_or(1))
        .bind(input.allows_extra_bed.unwrap_or(false))
        .bind(input.max_extra_beds.unwrap_or(0))
        .bind(extra_bed_charge_decimal)
        .bind(input.sort_order.unwrap_or(0))
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
        row.get::<i64, _>("id")
    };

    // SQLite version without RETURNING
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let room_type_id: i64 = {
        sqlx::query(
            r#"
            INSERT INTO room_types (
                name, code, description, base_price, weekday_rate, weekend_rate,
                max_occupancy, bed_type, bed_count, allows_extra_bed, max_extra_beds,
                extra_bed_charge, sort_order
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            "#
        )
        .bind(&input.name)
        .bind(&input.code)
        .bind(&input.description)
        .bind(base_price_decimal)
        .bind(weekday_rate_decimal)
        .bind(weekend_rate_decimal)
        .bind(input.max_occupancy.unwrap_or(2))
        .bind(&input.bed_type)
        .bind(input.bed_count.unwrap_or(1))
        .bind(input.allows_extra_bed.unwrap_or(false) as i32)
        .bind(input.max_extra_beds.unwrap_or(0))
        .bind(extra_bed_charge_decimal)
        .bind(input.sort_order.unwrap_or(0))
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        sqlx::query_scalar::<_, i64>("SELECT last_insert_rowid()")
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
    };

    // Fetch the created room type
    let row = sqlx::query(GET_ROOM_TYPE_BY_ID)
        .bind(room_type_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let room_type = row_to_room_type(&row);

    // Audit log: room type created
    let _ = AuditLog::log_event(
        &pool,
        Some(user_id),
        "room_type_created",
        "room_type",
        Some(room_type.id),
        Some(serde_json::json!({
            "name": room_type.name,
            "code": room_type.code,
            "base_price": input.base_price
        })),
        None,
        None,
    ).await;

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
    let base_price_decimal = input.base_price.map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO));
    let weekday_rate_decimal = input.weekday_rate.map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO));
    let weekend_rate_decimal = input.weekend_rate.map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO));
    let extra_bed_charge_decimal = input.extra_bed_charge.map(|v| Decimal::from_f64_retain(v).unwrap_or(Decimal::ZERO));

    // PostgreSQL version with RETURNING
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        sqlx::query(
            r#"
            UPDATE room_types SET
                name = COALESCE($2, name),
                code = COALESCE($3, code),
                description = COALESCE($4, description),
                base_price = COALESCE($5, base_price),
                weekday_rate = COALESCE($6, weekday_rate),
                weekend_rate = COALESCE($7, weekend_rate),
                max_occupancy = COALESCE($8, max_occupancy),
                bed_type = COALESCE($9, bed_type),
                bed_count = COALESCE($10, bed_count),
                allows_extra_bed = COALESCE($11, allows_extra_bed),
                max_extra_beds = COALESCE($12, max_extra_beds),
                extra_bed_charge = COALESCE($13, extra_bed_charge),
                is_active = COALESCE($14, is_active),
                sort_order = COALESCE($15, sort_order),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            "#
        )
        .bind(id)
        .bind(&input.name)
        .bind(&input.code)
        .bind(&input.description)
        .bind(base_price_decimal)
        .bind(weekday_rate_decimal)
        .bind(weekend_rate_decimal)
        .bind(input.max_occupancy)
        .bind(&input.bed_type)
        .bind(input.bed_count)
        .bind(input.allows_extra_bed)
        .bind(input.max_extra_beds)
        .bind(extra_bed_charge_decimal)
        .bind(input.is_active)
        .bind(input.sort_order)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    // SQLite version without RETURNING
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        // Convert Option<bool> to Option<i32> for SQLite
        let allows_extra_bed_i32 = input.allows_extra_bed.map(|b| if b { 1i32 } else { 0i32 });
        let is_active_i32 = input.is_active.map(|b| if b { 1i32 } else { 0i32 });

        sqlx::query(
            r#"
            UPDATE room_types SET
                name = COALESCE(?2, name),
                code = COALESCE(?3, code),
                description = COALESCE(?4, description),
                base_price = COALESCE(?5, base_price),
                weekday_rate = COALESCE(?6, weekday_rate),
                weekend_rate = COALESCE(?7, weekend_rate),
                max_occupancy = COALESCE(?8, max_occupancy),
                bed_type = COALESCE(?9, bed_type),
                bed_count = COALESCE(?10, bed_count),
                allows_extra_bed = COALESCE(?11, allows_extra_bed),
                max_extra_beds = COALESCE(?12, max_extra_beds),
                extra_bed_charge = COALESCE(?13, extra_bed_charge),
                is_active = COALESCE(?14, is_active),
                sort_order = COALESCE(?15, sort_order),
                updated_at = datetime('now')
            WHERE id = ?1
            "#
        )
        .bind(id)
        .bind(&input.name)
        .bind(&input.code)
        .bind(&input.description)
        .bind(base_price_decimal)
        .bind(weekday_rate_decimal)
        .bind(weekend_rate_decimal)
        .bind(input.max_occupancy)
        .bind(&input.bed_type)
        .bind(input.bed_count)
        .bind(allows_extra_bed_i32)
        .bind(input.max_extra_beds)
        .bind(extra_bed_charge_decimal)
        .bind(is_active_i32)
        .bind(input.sort_order)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    // Fetch the updated room type
    let row = sqlx::query(GET_ROOM_TYPE_BY_ID)
        .bind(id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let room_type = row_to_room_type(&row);

    // Audit log: room type updated
    let _ = AuditLog::log_event(
        &pool,
        Some(user_id),
        "room_type_updated",
        "room_type",
        Some(id),
        Some(serde_json::json!({
            "name": room_type.name,
            "code": room_type.code,
            "is_active": room_type.is_active,
            "changes": input
        })),
        None,
        None,
    ).await;

    Ok(Json(room_type))
}

pub async fn delete_room_type_handler(
    State(pool): State<DbPool>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:write").await?;

    // Get room type info before deletion for audit log
    let room_type_info: Option<(String, String)> = sqlx::query_as(GET_ROOM_TYPE_NAME_CODE)
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Check if any rooms use this room type
    let room_count: i64 = sqlx::query_scalar(COUNT_ROOMS_BY_TYPE)
        .bind(id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if room_count > 0 {
        return Err(ApiError::BadRequest(format!(
            "Cannot delete room type: {} rooms are using this type. Deactivate it instead.",
            room_count
        )));
    }

    sqlx::query(DELETE_ROOM_TYPE)
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Audit log: room type deleted
    if let Some((name, code)) = room_type_info {
        let _ = AuditLog::log_event(
            &pool,
            Some(user_id),
            "room_type_deleted",
            "room_type",
            Some(id),
            Some(serde_json::json!({
                "name": name,
                "code": code
            })),
            None,
            None,
        ).await;
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

    let valid_statuses = vec!["available", "occupied", "cleaning", "maintenance", "reserved", "dirty", "clean"];
    if !valid_statuses.contains(&input.status.as_str()) {
        return Err(ApiError::BadRequest(format!("Invalid status. Must be one of: {:?}", valid_statuses)));
    }

    // Map "clean" to "available" for consistency
    let target_status = if input.status == "clean" { "available".to_string() } else { input.status.clone() };

    // Get current status to check if we're transitioning from a protected status
    let current_status_check: Option<String> = sqlx::query_scalar(GET_ROOM_STATUS)
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

    let current_status: Option<String> = sqlx::query_scalar(GET_ROOM_STATUS)
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if target_status == "available" {
        let active_booking: Option<i64> = sqlx::query_scalar(CHECK_ACTIVE_BOOKING)
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
        let booking_exists: Option<i64> = sqlx::query_scalar(CHECK_BOOKING_FOR_RESERVATION)
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

    sqlx::query(UPDATE_ROOM_STATUS_WITH_DATES)
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

    let _ = sqlx::query(INSERT_ROOM_HISTORY)
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
    let _ = sqlx::query(INSERT_ROOM_EVENT)
        .bind(room_id)
        .bind(format!("Status changed to: {}", target_status))
        .bind(user_id)
        .execute(&pool)
        .await;

    let row = sqlx::query(GET_ROOM_BY_ID_QUERY)
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let room_number: String = row.get(1);

    // Handle available field - SQLite returns 0/1, PostgreSQL returns bool
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let available: bool = row.get::<i32, _>(4) != 0;
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    let available: bool = row.get(4);

    // Audit log: room status change
    let _ = AuditLog::log_event(
        &pool,
        Some(user_id),
        "room_status_changed",
        "room",
        Some(room_id),
        Some(serde_json::json!({
            "room_number": room_number,
            "from_status": current_status,
            "to_status": target_status,
            "notes": input.notes
        })),
        None,
        None,
    ).await;

    Ok(Json(Room {
        id: row.get(0),
        room_number,
        room_type: row.get(2),
        price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
        available,
        description: row.get::<Option<String>, _>(5),
        max_occupancy: row.get(6),
        status: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
    }))
}

pub async fn end_maintenance_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Room>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    let current_status: Option<String> = sqlx::query_scalar(GET_ROOM_STATUS)
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if current_status.is_none() {
        return Err(ApiError::NotFound("Room not found".to_string()));
    }

    let status = current_status.as_ref().unwrap();
    if status == "available" {
        sqlx::query(CLEAR_MAINTENANCE_DATES)
            .bind(room_id)
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        let row = sqlx::query(GET_ROOM_BY_ID_QUERY)
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        // Handle available field - SQLite returns 0/1, PostgreSQL returns bool
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let available: bool = row.get::<i32, _>(4) != 0;
        #[cfg(any(
            all(feature = "postgres", not(feature = "sqlite")),
            all(feature = "sqlite", feature = "postgres")
        ))]
        let available: bool = row.get(4);

        return Ok(Json(Room {
            id: row.get(0),
            room_number: row.get(1),
            room_type: row.get(2),
            price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
            available,
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

    sqlx::query(END_MAINTENANCE_SET_AVAILABLE)
        .bind(room_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let status_label = current_status.as_ref().unwrap_or(&"unknown".to_string()).clone();
    let _ = sqlx::query(INSERT_ROOM_HISTORY_SIMPLE)
        .bind(room_id)
        .bind(&current_status)
        .bind(user_id)
        .bind(format!("{} completed and room returned to available", status_label))
        .execute(&pool)
        .await;

    let _ = sqlx::query(INSERT_ROOM_EVENT)
        .bind(room_id)
        .bind(format!("Ended {} - Room available", status_label))
        .bind(user_id)
        .execute(&pool)
        .await;

    let row = sqlx::query(GET_ROOM_BY_ID_QUERY)
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let room_number: String = row.get(1);

    // Handle available field - SQLite returns 0/1, PostgreSQL returns bool
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let available: bool = row.get::<i32, _>(4) != 0;
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    let available: bool = row.get(4);

    // Audit log: maintenance ended
    let _ = AuditLog::log_event(
        &pool,
        Some(user_id),
        "maintenance_ended",
        "room",
        Some(room_id),
        Some(serde_json::json!({
            "room_number": room_number,
            "from_status": status_label,
            "to_status": "available"
        })),
        None,
        None,
    ).await;

    Ok(Json(Room {
        id: row.get(0),
        room_number,
        room_type: row.get(2),
        price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
        available,
        description: row.get::<Option<String>, _>(5),
        max_occupancy: row.get(6),
        status: row.get(7),
        created_at: row.get(8),
        updated_at: row.get(9),
    }))
}

pub async fn end_cleaning_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "rooms:update").await?;

    let current_status: Option<String> = sqlx::query_scalar(GET_ROOM_STATUS)
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

    let next_status: String = sqlx::query_scalar(GET_NEXT_ROOM_STATUS)
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(END_CLEANING_UPDATE)
        .bind(&next_status)
        .bind(room_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let _ = sqlx::query(INSERT_ROOM_HISTORY_CLEANING)
        .bind(room_id)
        .bind(&next_status)
        .bind(user_id)
        .execute(&pool)
        .await;

    let _ = sqlx::query(INSERT_ROOM_EVENT)
        .bind(room_id)
        .bind(format!("Cleaning completed - Room now {}", next_status))
        .bind(user_id)
        .execute(&pool)
        .await;

    // Get room number for audit log
    let room_number: String = sqlx::query_scalar(GET_ROOM_NUMBER)
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|_| format!("{}", room_id));

    // Audit log: cleaning completed
    let _ = AuditLog::log_event(
        &pool,
        Some(user_id),
        "cleaning_completed",
        "room",
        Some(room_id),
        Some(serde_json::json!({
            "room_number": room_number,
            "from_status": "cleaning",
            "to_status": next_status
        })),
        None,
        None,
    ).await;

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
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "bookings:update").await?;

    let target_id: i64 = input.get("target_room_id")
        .and_then(|v| {
            v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
        .ok_or_else(|| ApiError::BadRequest("Invalid target_room_id".to_string()))?;

    let reason = input.get("reason")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Room change requested".to_string());

    // Prevent changing to the same room
    if room_id == target_id {
        return Err(ApiError::BadRequest("Cannot change to the same room".to_string()));
    }

    // Find the currently active booking for this room
    // Priority: checked_in first, then confirmed bookings that are currently active
    let booking: Option<(i64, i64)> = sqlx::query_as(GET_ACTIVE_BOOKING_FOR_ROOM)
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let (booking_id, guest_id) = booking.ok_or_else(||
        ApiError::BadRequest("No active booking found for this room. The room must have a guest currently checked in or a confirmed booking for today.".to_string())
    )?;

    // Check target room exists and is available using dynamic status computation
    // This matches the logic used in get_rooms_handler for consistency
    let target_room: Option<(String, bool, bool)> = sqlx::query_as(GET_TARGET_ROOM_STATUS)
        .bind(target_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let (target_status, target_active, _) = target_room.ok_or_else(||
        ApiError::BadRequest("Target room not found".to_string())
    )?;

    if !target_active {
        return Err(ApiError::BadRequest("Target room is not active".to_string()));
    }

    if target_status != "available" {
        return Err(ApiError::BadRequest(format!("Target room is not available (current status: {})", target_status)));
    }

    // Get room numbers for the history notes
    let from_room_number: String = sqlx::query_scalar(GET_ROOM_NUMBER)
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let to_room_number: String = sqlx::query_scalar(GET_ROOM_NUMBER)
        .bind(target_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut tx = pool.begin().await.map_err(|e| ApiError::Database(e.to_string()))?;

    // Update booking to new room
    sqlx::query(UPDATE_BOOKING_ROOM)
        .bind(target_id)
        .bind(booking_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Set source room to 'dirty' (needs cleaning after guest vacated)
    sqlx::query(SET_ROOM_DIRTY)
        .bind(room_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Set target room to 'occupied'
    sqlx::query(SET_ROOM_OCCUPIED)
        .bind(target_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Record in room_changes table
    sqlx::query(INSERT_ROOM_CHANGE)
        .bind(booking_id)
        .bind(room_id)
        .bind(target_id)
        .bind(guest_id)
        .bind(&reason)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Record history for source room (occupied -> dirty)
    sqlx::query(INSERT_ROOM_HISTORY_CHANGE)
        .bind(room_id)
        .bind("occupied")
        .bind("dirty")
        .bind(user_id)
        .bind(format!("Guest moved to room {} - {}", to_room_number, reason))
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Record history for target room (available -> occupied)
    sqlx::query(INSERT_ROOM_HISTORY_CHANGE)
        .bind(target_id)
        .bind("available")
        .bind("occupied")
        .bind(user_id)
        .bind(format!("Guest moved from room {} - {}", from_room_number, reason))
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Record in booking_modifications for audit trail
    sqlx::query(INSERT_BOOKING_MODIFICATION)
        .bind(booking_id)
        .bind(serde_json::json!({ "room_id": room_id, "room_number": from_room_number }))
        .bind(serde_json::json!({ "room_id": target_id, "room_number": to_room_number, "reason": reason }))
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    tx.commit().await.map_err(|e| ApiError::Database(e.to_string()))?;

    // Audit log: room change
    let _ = AuditLog::log_event(
        &pool,
        Some(user_id),
        "room_changed",
        "room",
        Some(room_id),
        Some(serde_json::json!({
            "from_room_id": room_id,
            "from_room_number": from_room_number,
            "to_room_id": target_id,
            "to_room_number": to_room_number,
            "booking_id": booking_id,
            "guest_id": guest_id,
            "reason": reason
        })),
        None,
        None,
    ).await;

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
    let limit = params.get("limit").and_then(|v| v.parse::<i64>().ok()).unwrap_or(50);

    let rows = sqlx::query(GET_ROOM_CHANGE_HISTORY)
        .bind(booking_id)
        .bind(guest_id)
        .bind(room_id)
        .bind(limit)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let changes: Vec<serde_json::Value> = rows.iter().map(|row| {
        serde_json::json!({
            "id": row.get::<i64, _>("id"),
            "booking_id": row.get::<i64, _>("booking_id"),
            "booking_number": row.get::<String, _>("booking_number"),
            "from_room": {
                "id": row.get::<i64, _>("from_room_id"),
                "room_number": row.get::<String, _>("from_room_number"),
                "room_type": row.get::<String, _>("from_room_type")
            },
            "to_room": {
                "id": row.get::<i64, _>("to_room_id"),
                "room_number": row.get::<String, _>("to_room_number"),
                "room_type": row.get::<String, _>("to_room_type")
            },
            "guest": {
                "id": row.get::<i64, _>("guest_id"),
                "name": row.get::<String, _>("guest_name")
            },
            "reason": row.get::<Option<String>, _>("reason"),
            "changed_by": {
                "id": row.get::<Option<i64>, _>("changed_by"),
                "name": row.get::<Option<String>, _>("changed_by_name")
            },
            "changed_at": row.get::<chrono::DateTime<chrono::Utc>, _>("changed_at")
        })
    }).collect();

    Ok(Json(changes))
}

pub async fn create_room_event_handler(
    State(pool): State<DbPool>,
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

    // SQLite doesn't support RETURNING, so we need different handling
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let event = {
        sqlx::query(INSERT_ROOM_EVENT_FULL)
            .bind(room_id)
            .bind(&input.event_type)
            .bind(&input.status)
            .bind(priority)
            .bind(&input.notes)
            .bind(scheduled_date)
            .bind(user_id)
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        let event_id: i64 = sqlx::query_scalar::<_, i64>("SELECT last_insert_rowid()")
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        let row = sqlx::query(GET_ROOM_EVENT_BY_ID)
            .bind(event_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        RoomEvent {
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
        }
    };

    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    let event = {
        let row = sqlx::query(INSERT_ROOM_EVENT_FULL)
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

        RoomEvent {
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
        }
    };

    if input.event_type == "cleaning" || input.event_type == "maintenance" {
        let _ = sqlx::query(UPDATE_ROOM_STATUS_SIMPLE)
            .bind(&input.event_type)
            .bind(room_id)
            .execute(&pool)
            .await;
    }

    Ok(Json(event))
}

pub async fn get_room_detailed_status_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<RoomDetailedStatus>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let room_row = sqlx::query(GET_ROOM_DETAILED_STATUS)
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    let status: Option<String> = room_row.try_get(3).ok();

    // Handle available field - SQLite returns 0/1, PostgreSQL returns bool
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let available: bool = room_row.try_get::<i32, _>(4).unwrap_or(0) != 0;
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
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

    let current_booking = sqlx::query(GET_CURRENT_BOOKING_FOR_ROOM)
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .map(|row| row_mappers::row_to_booking_with_details(&row));

    let next_booking = sqlx::query(GET_NEXT_BOOKING_FOR_ROOM)
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .map(|row| row_mappers::row_to_booking_with_details(&row));

    // Query room_events if table exists, otherwise return empty list
    let recent_events = sqlx::query_as::<_, RoomEvent>(GET_ROOM_EVENTS)
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
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let history = match sqlx::query(GET_ROOM_HISTORY)
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
            // Handle is_auto_generated - SQLite returns 0/1, PostgreSQL returns bool
            #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
            let is_auto_generated = row.get::<i32, _>("is_auto_generated") != 0;
            #[cfg(any(
                all(feature = "postgres", not(feature = "sqlite")),
                all(feature = "sqlite", feature = "postgres")
            ))]
            let is_auto_generated = row.get::<bool, _>("is_auto_generated");

            serde_json::json!({
                "id": row.get::<i64, _>("id").to_string(),
                "room_id": row.get::<i64, _>("room_id").to_string(),
                "from_status": row.get::<Option<String>, _>("from_status"),
                "to_status": row.get::<String, _>("to_status"),
                "start_date": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("start_date").map(|d| d.to_rfc3339()),
                "end_date": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("end_date").map(|d| d.to_rfc3339()),
                "changed_by": row.get::<Option<i64>, _>("changed_by").map(|id| id.to_string()),
                "changed_by_name": row.get::<Option<String>, _>("changed_by_name"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
                "notes": row.get::<Option<String>, _>("notes"),
                "is_auto_generated": is_auto_generated,
            })
        })
        .collect();

    Ok(Json(history_json))
}

pub async fn get_room_reviews_handler(
    State(pool): State<DbPool>,
    Path(room_type): Path<String>,
) -> Result<Json<Vec<GuestReview>>, ApiError> {
    let rows = sqlx::query(GET_ROOM_REVIEWS)
        .bind(&room_type)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let reviews: Vec<GuestReview> = rows.iter().map(|row| row_mappers::row_to_guest_review(row)).collect();
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
    let _user_id = require_auth(&headers).await?;

    let rows = sqlx::query(
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

    let occupancy: Vec<RoomCurrentOccupancy> = rows.iter().map(|row| row_mappers::row_to_room_current_occupancy(row)).collect();
    Ok(Json(occupancy))
}

/// Get occupancy for a specific room
pub async fn get_room_occupancy_handler(
    State(pool): State<DbPool>,
    Path(room_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<RoomCurrentOccupancy>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    let query = r#"
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
        WHERE room_id = ?1
        "#;

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    let query = r#"
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
        "#;

    let row = sqlx::query(query)
        .bind(room_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("Room not found".to_string()))?;

    Ok(Json(row_mappers::row_to_room_current_occupancy(&row)))
}

/// Get hotel-wide occupancy summary
pub async fn get_hotel_occupancy_summary_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<HotelOccupancySummary>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let row = sqlx::query(
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

    Ok(Json(row_mappers::row_to_hotel_occupancy_summary(&row)))
}

/// Get occupancy breakdown by room type
pub async fn get_occupancy_by_room_type_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<OccupancyByRoomType>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let rows = sqlx::query(
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

    let occupancy: Vec<OccupancyByRoomType> = rows.iter().map(|row| row_mappers::row_to_occupancy_by_room_type(row)).collect();

    Ok(Json(occupancy))
}

/// Get rooms with their occupancy combined
pub async fn get_rooms_with_occupancy_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<RoomWithOccupancy>>, ApiError> {
    let _user_id = require_auth(&headers).await?;

    let rows = sqlx::query(GET_ROOMS_WITH_OCCUPANCY)
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut rooms_with_occupancy = Vec::new();
    for row in rows {
        // Handle available field - SQLite returns 0/1, PostgreSQL returns bool
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let available: bool = row.get::<i32, _>(4) != 0;
        #[cfg(any(
            all(feature = "postgres", not(feature = "sqlite")),
            all(feature = "sqlite", feature = "postgres")
        ))]
        let available: bool = row.get(4);

        // Handle is_occupied field - SQLite returns 0/1, PostgreSQL returns bool
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let is_occupied: bool = row.get::<i32, _>(14) != 0;
        #[cfg(any(
            all(feature = "postgres", not(feature = "sqlite")),
            all(feature = "sqlite", feature = "postgres")
        ))]
        let is_occupied: bool = row.get(14);

        let room = Room {
            id: row.get(0),
            room_number: row.get(1),
            room_type: row.get(2),
            price_per_night: row.get::<String, _>(3).parse().unwrap_or_default(),
            available,
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
            is_occupied,
            current_booking_id: row.get(15),
            current_guest_id: row.get(16),
        });
    }

    Ok(Json(rooms_with_occupancy))
}
