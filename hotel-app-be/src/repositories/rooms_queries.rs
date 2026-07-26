//! Room domain repository: SQL text + row mapping for `services::rooms`.
//!
//! Every function here owns its query text and, where it returns typed data,
//! its row-to-struct mapping. `services::rooms` holds the business logic
//! (branching, permission checks, audit calls) and calls these functions.

use crate::core::db::{DbDatabase, DbPool, DbRow, DbTransaction, decimal_to_db, opt_decimal_to_db};
use crate::core::error::ApiError;
use crate::models::row_mappers::{self, get_decimal, get_opt_decimal};
use crate::models::*;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use sqlx::Row;

fn db_err(e: sqlx::Error) -> ApiError {
    ApiError::Database(e.to_string())
}

fn opt_bool(row: &DbRow, col: &str) -> Option<bool> {
    row.try_get::<bool, _>(col).ok()
}

// ==================== Row mappers ====================

fn row_to_room(row: &DbRow) -> Room {
    Room {
        id: row.get("id"),
        room_number: row.get("room_number"),
        room_type: row.get("room_type"),
        price_per_night: row
            .get::<String, _>("price_per_night")
            .parse()
            .unwrap_or_default(),
        available: row.get("available"),
        description: row.get("description"),
        max_occupancy: row.get("max_occupancy"),
        status: row.get("status"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        notes: row.get("notes"),
        is_smoking: opt_bool(row, "is_smoking"),
    }
}

fn row_to_room_with_rating(row: &DbRow) -> RoomWithRating {
    RoomWithRating {
        id: row.get("id"),
        room_number: row.get("room_number"),
        room_type: row.get("room_type"),
        price_per_night: row
            .get::<String, _>("price_per_night")
            .parse()
            .unwrap_or_default(),
        available: row.get("available"),
        description: row.get("description"),
        max_occupancy: row.get("max_occupancy"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        average_rating: row.try_get("average_rating").ok(),
        review_count: row.try_get("review_count").ok(),
        status: row.try_get("status").ok(),
        maintenance_start_date: row.try_get("maintenance_start_date").ok(),
        maintenance_end_date: row.try_get("maintenance_end_date").ok(),
        cleaning_start_date: row.try_get("cleaning_start_date").ok(),
        cleaning_end_date: row.try_get("cleaning_end_date").ok(),
        reserved_start_date: row.try_get("reserved_start_date").ok(),
        reserved_end_date: row.try_get("reserved_end_date").ok(),
        notes: row.try_get("notes").ok(),
        is_smoking: opt_bool(row, "is_smoking"),
    }
}

/// Helper function to map a database row to RoomType
fn row_to_room_type(row: &DbRow) -> RoomType {
    let base_price = get_decimal(row, "base_price");
    let weekday_rate = get_opt_decimal(row, "weekday_rate");
    let weekend_rate = get_opt_decimal(row, "weekend_rate");
    let extra_bed_charge = get_decimal(row, "extra_bed_charge");

    let allows_extra_bed: bool = row.try_get("allows_extra_bed").unwrap_or(false);
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

// ==================== Room listing / search ====================

const GET_ROOMS_QUERY: &str = r#"
WITH current_bookings AS (
    SELECT DISTINCT ON (room_id)
        room_id,
        status as booking_status,
        check_in_date,
        check_out_date
    FROM bookings
    WHERE status IN ('checked_in', 'auto_checked_in', 'confirmed', 'pending')
      AND check_out_date >= CURRENT_DATE
    ORDER BY room_id,
        CASE
            WHEN status IN ('checked_in', 'auto_checked_in') THEN 1
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
    CASE
        WHEN cb.booking_status IN ('checked_in', 'auto_checked_in') THEN false
        WHEN cb.booking_status IN ('confirmed', 'pending') THEN false
        WHEN r.status IN ('maintenance', 'out_of_order', 'dirty', 'cleaning', 'reserved_dirty') THEN false
        ELSE true
    END as available,
    rt.description,
    rt.max_occupancy,
    r.created_at,
    r.updated_at,
    NULL::DECIMAL as average_rating,
    NULL::BIGINT as review_count,
    CASE
        WHEN cb.booking_status IN ('checked_in', 'auto_checked_in') THEN 'occupied'
        WHEN r.status IN ('maintenance', 'out_of_order', 'dirty', 'cleaning', 'reserved_dirty') THEN r.status
        WHEN cb.booking_status IN ('confirmed', 'pending') AND cb.check_in_date <= CURRENT_DATE THEN 'reserved'
        ELSE 'available'
    END as status,
    r.maintenance_start_date,
    r.maintenance_end_date,
    r.cleaning_start_date,
    r.cleaning_end_date,
    r.reserved_start_date,
    r.reserved_end_date,
    r.notes,
    r.is_smoking
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN current_bookings cb ON cb.room_id = r.id
WHERE r.is_active = true
ORDER BY r.room_number
"#;

pub async fn fetch_rooms(pool: &DbPool) -> Result<Vec<RoomWithRating>, ApiError> {
    let rows = sqlx::query(GET_ROOMS_QUERY)
        .fetch_all(pool)
        .await
        .map_err(db_err)?;
    Ok(rows.iter().map(row_to_room_with_rating).collect())
}

const SEARCH_ROOMS_WITH_DATES_QUERY: &str = r#"
WITH conflicting_bookings AS (
    SELECT DISTINCT room_id
    FROM bookings
    WHERE status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending')
      AND (check_in_date < $2 AND check_out_date > $1)
      AND ($3::BIGINT IS NULL OR id != $3)
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
    r.status as status,
    r.maintenance_start_date,
    r.maintenance_end_date,
    r.cleaning_start_date,
    r.cleaning_end_date,
    r.reserved_start_date,
    r.reserved_end_date,
    r.notes,
    r.is_smoking
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN conflicting_bookings cb ON cb.room_id = r.id
WHERE r.is_active = true
  AND r.status NOT IN ('maintenance', 'out_of_order')
  AND cb.room_id IS NULL
  AND ($4::text IS NULL OR LOWER(rt.name) = LOWER($4) OR LOWER(rt.code) = LOWER($4))
  AND ($5::DOUBLE PRECISION IS NULL OR COALESCE(r.custom_price, rt.base_price) <= $5)
ORDER BY COALESCE(r.custom_price, rt.base_price)
"#;

#[allow(clippy::too_many_arguments)]
pub async fn search_rooms_with_dates(
    pool: &DbPool,
    check_in: NaiveDate,
    check_out: NaiveDate,
    exclude_booking_id: Option<i64>,
    room_type: Option<&str>,
    max_price: Option<f64>,
) -> Result<Vec<RoomWithRating>, ApiError> {
    let rows = sqlx::query(SEARCH_ROOMS_WITH_DATES_QUERY)
        .bind(check_in)
        .bind(check_out)
        .bind(exclude_booking_id)
        .bind(room_type)
        .bind(max_price)
        .fetch_all(pool)
        .await
        .map_err(db_err)?;
    Ok(rows.iter().map(row_to_room_with_rating).collect())
}

const SEARCH_ROOMS_NO_DATES_QUERY: &str = r#"
WITH current_bookings AS (
    SELECT DISTINCT ON (room_id)
        room_id,
        status as booking_status,
        check_in_date
    FROM bookings
    WHERE status IN ('checked_in', 'auto_checked_in', 'confirmed', 'pending')
      AND check_out_date >= CURRENT_DATE
    ORDER BY room_id,
        CASE
            WHEN status IN ('checked_in', 'auto_checked_in') THEN 1
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
    r.reserved_end_date,
    r.notes,
    r.is_smoking
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN current_bookings cb ON cb.room_id = r.id
WHERE r.is_active = true
  AND r.status NOT IN ('maintenance', 'out_of_order', 'dirty', 'cleaning', 'reserved_dirty', 'occupied', 'reserved')
  AND (cb.room_id IS NULL OR NOT (
      cb.booking_status IN ('checked_in', 'auto_checked_in') OR
      (cb.booking_status IN ('confirmed', 'pending') AND cb.check_in_date <= CURRENT_DATE)
  ))
  AND ($1::text IS NULL OR LOWER(rt.name) = LOWER($1) OR LOWER(rt.code) = LOWER($1))
  AND ($2::DOUBLE PRECISION IS NULL OR COALESCE(r.custom_price, rt.base_price) <= $2)
ORDER BY COALESCE(r.custom_price, rt.base_price)
"#;

pub async fn search_rooms_no_dates(
    pool: &DbPool,
    room_type: Option<&str>,
    max_price: Option<f64>,
) -> Result<Vec<RoomWithRating>, ApiError> {
    let rows = sqlx::query(SEARCH_ROOMS_NO_DATES_QUERY)
        .bind(room_type)
        .bind(max_price)
        .fetch_all(pool)
        .await
        .map_err(db_err)?;
    Ok(rows.iter().map(row_to_room_with_rating).collect())
}

// ==================== Room CRUD ====================

const GET_ROOM_BY_ID_QUERY: &str = r#"
SELECT r.id, r.room_number, rt.name as room_type,
       COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
       CASE WHEN r.status = 'available' THEN true ELSE false END as available,
       rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at, r.notes, r.is_smoking
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
WHERE r.id = $1
"#;

/// Fetch a room by id. Errors (including "not found") surface as `ApiError::Database`,
/// matching the original `fetch_one` call sites that assume the room exists.
pub async fn fetch_room_by_id(pool: &DbPool, room_id: i64) -> Result<Room, ApiError> {
    let row = sqlx::query(GET_ROOM_BY_ID_QUERY)
        .bind(room_id)
        .fetch_one(pool)
        .await
        .map_err(db_err)?;
    Ok(row_to_room(&row))
}

pub struct ExistingRoomForUpdate {
    pub id: i64,
    pub room_number: String,
    pub room_type: String,
    pub price_per_night: Decimal,
    pub available: bool,
    pub description: Option<String>,
    pub max_occupancy: i32,
    pub status: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub notes: Option<String>,
    pub is_smoking: Option<bool>,
}

const GET_EXISTING_ROOM_FOR_UPDATE: &str = r#"
SELECT r.id, r.room_number, rt.name as room_type,
       COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
       CASE WHEN r.status = 'available' THEN true ELSE false END as available,
       rt.description, rt.max_occupancy, r.status, r.created_at, r.updated_at, r.custom_price::text, r.notes, r.is_smoking
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
WHERE r.id = $1
"#;

pub async fn fetch_existing_room_for_update(
    pool: &DbPool,
    room_id: i64,
) -> Result<Option<ExistingRoomForUpdate>, ApiError> {
    let row = sqlx::query(GET_EXISTING_ROOM_FOR_UPDATE)
        .bind(room_id)
        .fetch_optional(pool)
        .await
        .map_err(db_err)?;
    Ok(row.map(|row| ExistingRoomForUpdate {
        id: row.get("id"),
        room_number: row.get("room_number"),
        room_type: row.get("room_type"),
        price_per_night: row
            .get::<String, _>("price_per_night")
            .parse()
            .unwrap_or_default(),
        available: row.get("available"),
        description: row.get("description"),
        max_occupancy: row.get("max_occupancy"),
        status: row.get("status"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        notes: row.try_get("notes").ok(),
        is_smoking: opt_bool(&row, "is_smoking"),
    }))
}

const UPDATE_ROOM_WITH_STATUS_QUERY: &str = r#"
UPDATE rooms
SET room_number = $1,
    custom_price = $2,
    status = $3,
    notes = $4,
    is_smoking = COALESCE($5, is_smoking),
    updated_at = CURRENT_TIMESTAMP
WHERE id = $6
"#;

#[allow(clippy::too_many_arguments)]
pub async fn update_room_with_status(
    pool: &DbPool,
    room_number: &str,
    custom_price: Option<Decimal>,
    status: &str,
    notes: &Option<String>,
    is_smoking: Option<bool>,
    room_id: i64,
) -> Result<(), ApiError> {
    sqlx::query(UPDATE_ROOM_WITH_STATUS_QUERY)
        .bind(room_number)
        .bind(opt_decimal_to_db(custom_price))
        .bind(status)
        .bind(notes)
        .bind(is_smoking)
        .bind(room_id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

const UPDATE_ROOM_NO_STATUS_QUERY: &str = r#"
UPDATE rooms
SET room_number = $1,
    custom_price = $2,
    notes = $3,
    is_smoking = COALESCE($4, is_smoking),
    updated_at = CURRENT_TIMESTAMP
WHERE id = $5
"#;

pub async fn update_room_no_status(
    pool: &DbPool,
    room_number: &str,
    custom_price: Option<Decimal>,
    notes: &Option<String>,
    is_smoking: Option<bool>,
    room_id: i64,
) -> Result<(), ApiError> {
    sqlx::query(UPDATE_ROOM_NO_STATUS_QUERY)
        .bind(room_number)
        .bind(opt_decimal_to_db(custom_price))
        .bind(notes)
        .bind(is_smoking)
        .bind(room_id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

pub async fn room_number_exists(pool: &DbPool, room_number: &str) -> Result<bool, ApiError> {
    let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM rooms WHERE room_number = $1")
        .bind(room_number)
        .fetch_optional(pool)
        .await
        .map_err(db_err)?;
    Ok(existing.is_some())
}

pub async fn room_type_exists(pool: &DbPool, room_type_id: Option<i64>) -> Result<bool, ApiError> {
    let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM room_types WHERE id = $1")
        .bind(room_type_id)
        .fetch_optional(pool)
        .await
        .map_err(db_err)?;
    Ok(existing.is_some())
}

const INSERT_ROOM_QUERY: &str = r#"
INSERT INTO rooms (room_number, room_type_id, floor, building, custom_price, is_accessible, is_smoking, status, is_active)
VALUES ($1, $2, $3, $4, $5, $6, $7, 'available', true)
RETURNING id
"#;

#[allow(clippy::too_many_arguments)]
pub async fn insert_room(
    pool: &DbPool,
    room_number: &str,
    room_type_id: Option<i64>,
    floor: Option<i32>,
    building: &Option<String>,
    custom_price: Option<Decimal>,
    is_accessible: bool,
    is_smoking: bool,
) -> Result<i64, ApiError> {
    let room_id: i64 = sqlx::query_scalar(INSERT_ROOM_QUERY)
        .bind(room_number)
        .bind(room_type_id)
        .bind(floor)
        .bind(building)
        .bind(opt_decimal_to_db(custom_price))
        .bind(is_accessible)
        .bind(is_smoking)
        .fetch_one(pool)
        .await
        .map_err(db_err)?;
    Ok(room_id)
}

pub async fn room_exists_by_id(pool: &DbPool, room_id: i64) -> Result<bool, ApiError> {
    let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM rooms WHERE id = $1")
        .bind(room_id)
        .fetch_optional(pool)
        .await
        .map_err(db_err)?;
    Ok(existing.is_some())
}

/// Only blocks deletion if there's a guest currently checked in.
pub async fn room_has_active_checked_in_booking(
    pool: &DbPool,
    room_id: i64,
) -> Result<bool, ApiError> {
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM bookings WHERE room_id = $1 AND status = 'checked_in' LIMIT 1",
    )
    .bind(room_id)
    .fetch_optional(pool)
    .await
    .map_err(db_err)?;
    Ok(existing.is_some())
}

/// Deletes a room and everything that FK-references it, in the same order and
/// on the same (non-transactional) connection as the original handler.
pub async fn delete_room_cascade(pool: &DbPool, room_id: i64) -> Result<(), ApiError> {
    sqlx::query("DELETE FROM bookings WHERE room_id = $1")
        .bind(room_id)
        .execute(pool)
        .await
        .map_err(db_err)?;

    sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
        .bind(room_id)
        .execute(pool)
        .await
        .map_err(db_err)?;

    sqlx::query("DELETE FROM rooms WHERE id = $1")
        .bind(room_id)
        .execute(pool)
        .await
        .map_err(db_err)?;

    Ok(())
}

// ==================== Room type CRUD ====================

const ROOM_TYPE_COLUMNS: &str = r#"id, name, code, description, base_price, weekday_rate, weekend_rate,
       max_occupancy, bed_type, bed_count, allows_extra_bed, max_extra_beds,
       extra_bed_charge, is_active, sort_order, created_at, updated_at"#;

pub async fn fetch_active_room_types(pool: &DbPool) -> Result<Vec<RoomType>, ApiError> {
    let query = format!(
        "SELECT {} FROM room_types WHERE is_active = true ORDER BY sort_order, name",
        ROOM_TYPE_COLUMNS
    );
    let rows = sqlx::query(&query).fetch_all(pool).await.map_err(db_err)?;
    Ok(rows.iter().map(row_to_room_type).collect())
}

pub async fn fetch_all_room_types(pool: &DbPool) -> Result<Vec<RoomType>, ApiError> {
    let query = format!(
        "SELECT {} FROM room_types ORDER BY sort_order, name LIMIT 1000",
        ROOM_TYPE_COLUMNS
    );
    let rows = sqlx::query(&query).fetch_all(pool).await.map_err(db_err)?;
    Ok(rows.iter().map(row_to_room_type).collect())
}

pub async fn fetch_room_type_by_id(pool: &DbPool, id: i64) -> Result<RoomType, ApiError> {
    let query = format!("SELECT {} FROM room_types WHERE id = $1", ROOM_TYPE_COLUMNS);
    let row = sqlx::query(&query)
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(db_err)?;
    Ok(row_to_room_type(&row))
}

pub struct NewRoomType<'a> {
    pub name: &'a str,
    pub code: &'a str,
    pub description: &'a Option<String>,
    pub base_price: Decimal,
    pub weekday_rate: Option<Decimal>,
    pub weekend_rate: Option<Decimal>,
    pub max_occupancy: i32,
    pub bed_type: &'a Option<String>,
    pub bed_count: i32,
    pub allows_extra_bed: bool,
    pub max_extra_beds: i32,
    pub extra_bed_charge: Decimal,
    pub sort_order: i32,
}

pub async fn insert_room_type(pool: &DbPool, input: NewRoomType<'_>) -> Result<i64, ApiError> {
    let row = sqlx::query(
        r#"
        INSERT INTO room_types (
            name, code, description, base_price, weekday_rate, weekend_rate,
            max_occupancy, bed_type, bed_count, allows_extra_bed, max_extra_beds,
            extra_bed_charge, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id
        "#,
    )
    .bind(input.name)
    .bind(input.code)
    .bind(input.description)
    .bind(decimal_to_db(input.base_price))
    .bind(opt_decimal_to_db(input.weekday_rate))
    .bind(opt_decimal_to_db(input.weekend_rate))
    .bind(input.max_occupancy)
    .bind(input.bed_type)
    .bind(input.bed_count)
    .bind(input.allows_extra_bed)
    .bind(input.max_extra_beds)
    .bind(decimal_to_db(input.extra_bed_charge))
    .bind(input.sort_order)
    .fetch_one(pool)
    .await
    .map_err(db_err)?;
    Ok(row.get::<i64, _>("id"))
}

pub struct RoomTypeUpdate<'a> {
    pub name: &'a Option<String>,
    pub code: &'a Option<String>,
    pub description: &'a Option<String>,
    pub base_price: Option<Decimal>,
    pub weekday_rate: Option<Decimal>,
    pub weekend_rate: Option<Decimal>,
    pub max_occupancy: Option<i32>,
    pub bed_type: &'a Option<String>,
    pub bed_count: Option<i32>,
    pub allows_extra_bed: Option<bool>,
    pub max_extra_beds: Option<i32>,
    pub extra_bed_charge: Option<Decimal>,
    pub is_active: Option<bool>,
    pub sort_order: Option<i32>,
}

pub async fn update_room_type(
    pool: &DbPool,
    id: i64,
    input: RoomTypeUpdate<'_>,
) -> Result<(), ApiError> {
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
        "#,
    )
    .bind(id)
    .bind(input.name)
    .bind(input.code)
    .bind(input.description)
    .bind(opt_decimal_to_db(input.base_price))
    .bind(opt_decimal_to_db(input.weekday_rate))
    .bind(opt_decimal_to_db(input.weekend_rate))
    .bind(input.max_occupancy)
    .bind(input.bed_type)
    .bind(input.bed_count)
    .bind(input.allows_extra_bed)
    .bind(input.max_extra_beds)
    .bind(opt_decimal_to_db(input.extra_bed_charge))
    .bind(input.is_active)
    .bind(input.sort_order)
    .execute(pool)
    .await
    .map_err(db_err)?;
    Ok(())
}

pub async fn room_type_name_and_code(
    pool: &DbPool,
    id: i64,
) -> Result<Option<(String, String)>, ApiError> {
    sqlx::query_as("SELECT name, code FROM room_types WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(db_err)
}

pub async fn count_rooms_by_type(pool: &DbPool, id: i64) -> Result<i64, ApiError> {
    sqlx::query_scalar("SELECT COUNT(*) FROM rooms WHERE room_type_id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(db_err)
}

pub async fn delete_room_type(pool: &DbPool, id: i64) -> Result<(), ApiError> {
    sqlx::query("DELETE FROM room_types WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

// ==================== Status / transition queries ====================
//
// These are shared between plain-pool handlers and `complete_housekeeping_cleaning_tx`
// (which receives an already-open transaction), so they're generic over `Executor`
// — the same pattern as `core::db::hotel_today`.

const GET_ROOM_STATUS: &str = "SELECT status FROM rooms WHERE id = $1";

pub async fn room_status<'e, E>(executor: E, room_id: i64) -> Result<Option<String>, ApiError>
where
    E: sqlx::Executor<'e, Database = DbDatabase>,
{
    sqlx::query_scalar(GET_ROOM_STATUS)
        .bind(room_id)
        .fetch_optional(executor)
        .await
        .map_err(db_err)
}

const CHECK_ACTIVE_BOOKING: &str = r#"
SELECT id FROM bookings
WHERE room_id = $1
AND status IN ('checked_in', 'auto_checked_in')
AND check_in_date <= CURRENT_DATE
AND check_out_date >= CURRENT_DATE
LIMIT 1
"#;

pub async fn has_active_booking<'e, E>(executor: E, room_id: i64) -> Result<bool, ApiError>
where
    E: sqlx::Executor<'e, Database = DbDatabase>,
{
    let found: Option<i64> = sqlx::query_scalar(CHECK_ACTIVE_BOOKING)
        .bind(room_id)
        .fetch_optional(executor)
        .await
        .map_err(db_err)?;
    Ok(found.is_some())
}

const CHECK_NEXT_RESERVATION: &str = r#"
SELECT id, check_in_date, check_out_date
FROM bookings
WHERE room_id = $1
  AND status IN ('confirmed', 'pending')
  AND check_out_date >= CURRENT_DATE
ORDER BY check_in_date ASC
LIMIT 1
"#;

pub async fn next_reservation<'e, E>(
    executor: E,
    room_id: i64,
) -> Result<Option<(i64, NaiveDate, NaiveDate)>, ApiError>
where
    E: sqlx::Executor<'e, Database = DbDatabase>,
{
    sqlx::query_as(CHECK_NEXT_RESERVATION)
        .bind(room_id)
        .fetch_optional(executor)
        .await
        .map_err(db_err)
}

/// Check for a reservation arriving today, once the configured check-in time
/// has passed (used to auto-flip a room to `reserved` when staff mark it
/// available). `check_in_time` is e.g. '15:00:00'.
const CHECK_RESERVATION_TODAY: &str = r#"
SELECT id, check_in_date, check_out_date FROM bookings
WHERE room_id = $1
AND status IN ('confirmed', 'pending')
AND check_in_date = CURRENT_DATE
AND CURRENT_TIME >= $2::TIME
ORDER BY check_in_date ASC
LIMIT 1
"#;

pub async fn reservation_arriving_today<'e, E>(
    executor: E,
    room_id: i64,
    check_in_time: &str,
) -> Result<Option<(i64, NaiveDate, NaiveDate)>, ApiError>
where
    E: sqlx::Executor<'e, Database = DbDatabase>,
{
    sqlx::query_as(CHECK_RESERVATION_TODAY)
        .bind(room_id)
        .bind(check_in_time)
        .fetch_optional(executor)
        .await
        .map_err(db_err)
}

pub async fn booking_valid_for_reservation(
    pool: &DbPool,
    booking_id: Option<i64>,
    room_id: i64,
) -> Result<bool, ApiError> {
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM bookings WHERE id = $1 AND room_id = $2 AND status IN ('confirmed', 'pending')",
    )
    .bind(booking_id)
    .bind(room_id)
    .fetch_optional(pool)
    .await
    .map_err(db_err)?;
    Ok(found.is_some())
}

pub async fn required_transition_permission(
    pool: &DbPool,
    from_status: &str,
    to_status: &str,
) -> Result<Option<String>, ApiError> {
    let query = r#"
SELECT requires_permission
FROM room_status_transitions
WHERE from_status = $1 AND to_status = $2 AND is_allowed = true
"#;

    // `requires_permission` is a nullable column: an allowed transition may
    // require no special permission (NULL). Decode the scalar as Option<String>
    // so a present-but-NULL value doesn't error — fetch_optional only handles
    // the no-row case, not a NULL column within a returned row. Then flatten
    // (no row) and (row with NULL) both into None.
    sqlx::query_scalar::<_, Option<String>>(query)
        .bind(from_status)
        .bind(to_status)
        .fetch_optional(pool)
        .await
        .map(Option::flatten)
        .map_err(db_err)
}

const UPDATE_ROOM_STATUS_WITH_DATES: &str = r#"
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
"#;

#[allow(clippy::too_many_arguments)]
pub async fn update_room_status_with_dates<'e, E>(
    executor: E,
    target_status: &str,
    notes: Option<&str>,
    status_notes: &Option<String>,
    reserved_start: Option<DateTime<Utc>>,
    reserved_end: Option<DateTime<Utc>>,
    maintenance_start: Option<DateTime<Utc>>,
    maintenance_end: Option<DateTime<Utc>>,
    cleaning_start: Option<DateTime<Utc>>,
    cleaning_end: Option<DateTime<Utc>>,
    room_id: i64,
) -> Result<(), ApiError>
where
    E: sqlx::Executor<'e, Database = DbDatabase>,
{
    sqlx::query(UPDATE_ROOM_STATUS_WITH_DATES)
        .bind(target_status)
        .bind(notes)
        .bind(status_notes)
        .bind(reserved_start)
        .bind(reserved_end)
        .bind(maintenance_start)
        .bind(maintenance_end)
        .bind(cleaning_start)
        .bind(cleaning_end)
        .bind(room_id)
        .execute(executor)
        .await
        .map_err(db_err)?;
    Ok(())
}

const INSERT_ROOM_HISTORY: &str = r#"
INSERT INTO room_history (
    room_id, from_status, to_status,
    start_date, end_date, changed_by, notes, is_auto_generated
)
VALUES ($1, $2, $3, $4, $5, $6, $7, false)
"#;

/// Best-effort: callers ignore the error and keep going (matches the
/// original `let _ = sqlx::query(...)` call sites).
#[allow(clippy::too_many_arguments)]
pub async fn insert_room_history(
    pool: &DbPool,
    room_id: i64,
    from_status: &Option<String>,
    to_status: &str,
    start: Option<DateTime<Utc>>,
    end: Option<DateTime<Utc>>,
    user_id: i64,
    notes: &Option<String>,
) -> Result<(), ApiError> {
    sqlx::query(INSERT_ROOM_HISTORY)
        .bind(room_id)
        .bind(from_status)
        .bind(to_status)
        .bind(start)
        .bind(end)
        .bind(user_id)
        .bind(notes)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

const INSERT_ROOM_EVENT: &str = r#"
INSERT INTO room_events (room_id, event_type, status, priority, notes, created_by)
VALUES ($1, 'status_change', 'completed', 'normal', $2, $3)
"#;

/// Best-effort status-change event log; callers ignore failure.
pub async fn insert_room_status_event<'e, E>(
    executor: E,
    room_id: i64,
    note: String,
    user_id: i64,
) -> Result<(), ApiError>
where
    E: sqlx::Executor<'e, Database = DbDatabase>,
{
    sqlx::query(INSERT_ROOM_EVENT)
        .bind(room_id)
        .bind(note)
        .bind(user_id)
        .execute(executor)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// Same as [`insert_room_status_event`], but run inside an already-open
/// transaction as a SAVEPOINT so a failure can never poison the parent
/// transaction (see lessons.md 2026-07-10b) — the whole best-effort dance
/// is one repository function since it is a single atomic unit of work.
pub async fn insert_room_status_event_best_effort_tx(
    tx: &mut DbTransaction<'_>,
    room_id: i64,
    note: String,
    user_id: i64,
) -> Result<(), ApiError> {
    sqlx::query("SAVEPOINT sp_room_event")
        .execute(&mut **tx)
        .await
        .map_err(db_err)?;
    match sqlx::query(INSERT_ROOM_EVENT)
        .bind(room_id)
        .bind(note)
        .bind(user_id)
        .execute(&mut **tx)
        .await
    {
        Ok(_) => {
            sqlx::query("RELEASE SAVEPOINT sp_room_event")
                .execute(&mut **tx)
                .await
                .map_err(db_err)?;
        }
        Err(e) => {
            log::warn!(
                "Best-effort room_events insert failed for room {}: {}",
                room_id,
                e
            );
            sqlx::query("ROLLBACK TO SAVEPOINT sp_room_event")
                .execute(&mut **tx)
                .await
                .map_err(db_err)?;
        }
    }
    Ok(())
}

pub async fn room_number(pool: &DbPool, room_id: i64) -> Result<String, ApiError> {
    sqlx::query_scalar("SELECT room_number FROM rooms WHERE id = $1")
        .bind(room_id)
        .fetch_one(pool)
        .await
        .map_err(db_err)
}

// ==================== complete_housekeeping_cleaning_tx support ====================

pub async fn check_in_time_setting_tx(tx: &mut DbTransaction<'_>) -> Result<String, ApiError> {
    let value: Option<String> =
        sqlx::query_scalar("SELECT value FROM system_settings WHERE key = $1")
            .bind("check_in_time")
            .fetch_optional(&mut **tx)
            .await
            .map_err(db_err)?;
    Ok(value.unwrap_or_else(|| "15:00:00".to_string()))
}

pub async fn touch_last_cleaned_at_tx(
    tx: &mut DbTransaction<'_>,
    room_id: i64,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE rooms SET last_cleaned_at = CURRENT_TIMESTAMP WHERE id = $1")
        .bind(room_id)
        .execute(&mut **tx)
        .await
        .map_err(db_err)?;
    Ok(())
}

// ==================== End maintenance / end cleaning ====================

const CLEAR_MAINTENANCE_DATES: &str = r#"
UPDATE rooms
SET maintenance_start_date = NULL,
    maintenance_end_date = NULL,
    cleaning_start_date = NULL,
    cleaning_end_date = NULL,
    reserved_start_date = NULL,
    reserved_end_date = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1
"#;

pub async fn clear_maintenance_dates(pool: &DbPool, room_id: i64) -> Result<(), ApiError> {
    sqlx::query(CLEAR_MAINTENANCE_DATES)
        .bind(room_id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

const END_MAINTENANCE_SET_AVAILABLE: &str = r#"
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
"#;

pub async fn end_maintenance_set_available(pool: &DbPool, room_id: i64) -> Result<(), ApiError> {
    sqlx::query(END_MAINTENANCE_SET_AVAILABLE)
        .bind(room_id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

const END_CLEANING_UPDATE: &str = r#"
UPDATE rooms
SET status = $1,
    cleaning_start_date = NULL,
    cleaning_end_date = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $2
"#;

pub async fn end_cleaning_update(
    pool: &DbPool,
    next_status: &str,
    room_id: i64,
) -> Result<(), ApiError> {
    sqlx::query(END_CLEANING_UPDATE)
        .bind(next_status)
        .bind(room_id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

pub async fn next_room_status(pool: &DbPool, room_id: i64) -> Result<String, ApiError> {
    let query = r#"
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM bookings
            WHERE room_id = $1
            AND status IN ('confirmed', 'pending')
            AND check_out_date >= CURRENT_DATE
        ) THEN 'reserved'
        ELSE 'available'
    END
"#;
    sqlx::query_scalar(query)
        .bind(room_id)
        .fetch_one(pool)
        .await
        .map_err(db_err)
}

// ==================== Bulk status sync ====================

pub struct RoomStatusSyncChange {
    pub room_id: i64,
    pub room_number: String,
    pub old_status: String,
    pub new_status: String,
}

pub async fn sync_all_room_statuses(
    pool: &DbPool,
    user_id: i64,
) -> Result<Vec<RoomStatusSyncChange>, ApiError> {
    let rows = sqlx::query(
        "SELECT room_id, room_number, old_status, new_status FROM sync_all_room_statuses($1)",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(db_err)?;

    Ok(rows
        .iter()
        .map(|row| RoomStatusSyncChange {
            room_id: row.get("room_id"),
            room_number: row.get("room_number"),
            old_status: row.get("old_status"),
            new_status: row.get("new_status"),
        })
        .collect())
}

// ==================== Room change (move guest to another room) ====================

const GET_ACTIVE_BOOKING_FOR_ROOM: &str = r#"
SELECT id, guest_id FROM bookings
WHERE room_id = $1
  AND status IN ('confirmed', 'checked_in')
  AND check_in_date <= CURRENT_DATE
  AND check_out_date >= CURRENT_DATE
ORDER BY
    CASE WHEN status = 'checked_in' THEN 0 ELSE 1 END,
    check_in_date
LIMIT 1
"#;

pub async fn active_booking_for_room(
    pool: &DbPool,
    room_id: i64,
) -> Result<Option<(i64, i64)>, ApiError> {
    sqlx::query_as(GET_ACTIVE_BOOKING_FOR_ROOM)
        .bind(room_id)
        .fetch_optional(pool)
        .await
        .map_err(db_err)
}

const GET_TARGET_ROOM_STATUS: &str = r#"
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM bookings
            WHERE room_id = r.id
            AND status = 'checked_in'
            AND check_out_date >= CURRENT_DATE
        ) THEN 'occupied'
        WHEN r.status IN ('maintenance', 'out_of_order', 'dirty', 'cleaning', 'reserved_dirty') THEN r.status
        WHEN EXISTS (
            SELECT 1 FROM bookings
            WHERE room_id = r.id
            AND status IN ('confirmed', 'pending')
            AND check_in_date <= CURRENT_DATE
            AND check_out_date >= CURRENT_DATE
        ) THEN 'reserved'
        ELSE 'available'
    END as computed_status,
    r.is_active,
    r.id IS NOT NULL as exists
FROM rooms r
WHERE r.id = $1
"#;

/// (computed_status, is_active, exists)
pub async fn target_room_status(
    pool: &DbPool,
    room_id: i64,
) -> Result<Option<(String, bool, bool)>, ApiError> {
    sqlx::query_as(GET_TARGET_ROOM_STATUS)
        .bind(room_id)
        .fetch_optional(pool)
        .await
        .map_err(db_err)
}

/// Runs the whole room-change transaction body as one unit: update the
/// booking's room, flip source/target room statuses, and record the change,
/// history, and modification rows. Preserves the original single-transaction
/// boundary — split calls here would risk partial commits.
#[allow(clippy::too_many_arguments)]
pub async fn execute_room_change_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
    room_id: i64,
    target_id: i64,
    guest_id: i64,
    reason: &str,
    user_id: i64,
    from_room_number: &str,
    to_room_number: &str,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE bookings SET room_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
        .bind(target_id)
        .bind(booking_id)
        .execute(&mut **tx)
        .await
        .map_err(db_err)?;

    sqlx::query("UPDATE rooms SET status = 'dirty', updated_at = CURRENT_TIMESTAMP WHERE id = $1")
        .bind(room_id)
        .execute(&mut **tx)
        .await
        .map_err(db_err)?;

    sqlx::query(
        "UPDATE rooms SET status = 'occupied', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
    )
    .bind(target_id)
    .execute(&mut **tx)
    .await
    .map_err(db_err)?;

    sqlx::query(
        r#"
        INSERT INTO room_changes (booking_id, from_room_id, to_room_id, guest_id, reason, changed_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(booking_id)
    .bind(room_id)
    .bind(target_id)
    .bind(guest_id)
    .bind(reason)
    .bind(user_id)
    .execute(&mut **tx)
    .await
    .map_err(db_err)?;

    let history_query = r#"
        INSERT INTO room_history (
            room_id, from_status, to_status,
            changed_by, notes, is_auto_generated
        )
        VALUES ($1, $2, $3, $4, $5, $6)
    "#;

    sqlx::query(history_query)
        .bind(room_id)
        .bind("occupied")
        .bind("dirty")
        .bind(user_id)
        .bind(format!(
            "Guest moved to room {} - {}",
            to_room_number, reason
        ))
        .execute(&mut **tx)
        .await
        .map_err(db_err)?;

    sqlx::query(history_query)
        .bind(target_id)
        .bind("available")
        .bind("occupied")
        .bind(user_id)
        .bind(format!(
            "Guest moved from room {} - {}",
            from_room_number, reason
        ))
        .execute(&mut **tx)
        .await
        .map_err(db_err)?;

    sqlx::query(
        r#"
        INSERT INTO booking_modifications (booking_id, modification_type, old_value, new_value, modified_by)
        VALUES ($1, 'room_change', $2, $3, $4)
        "#,
    )
    .bind(booking_id)
    .bind(serde_json::json!({ "room_id": room_id, "room_number": from_room_number }))
    .bind(serde_json::json!({ "room_id": target_id, "room_number": to_room_number, "reason": reason }))
    .bind(user_id)
    .execute(&mut **tx)
    .await
    .map_err(db_err)?;

    Ok(())
}

pub struct RoomChangeHistoryRow {
    pub id: i64,
    pub booking_id: i64,
    pub booking_number: String,
    pub from_room_id: i64,
    pub from_room_number: String,
    pub from_room_type: String,
    pub to_room_id: i64,
    pub to_room_number: String,
    pub to_room_type: String,
    pub guest_id: i64,
    pub guest_name: String,
    pub reason: Option<String>,
    pub changed_by: Option<i64>,
    pub changed_by_name: Option<String>,
    pub changed_at: DateTime<Utc>,
}

const GET_ROOM_CHANGE_HISTORY: &str = r#"
SELECT
    rc.id,
    rc.booking_id,
    b.booking_number,
    rc.from_room_id,
    fr.room_number as from_room_number,
    frt.name as from_room_type,
    rc.to_room_id,
    tr.room_number as to_room_number,
    trt.name as to_room_type,
    rc.guest_id,
    g.full_name as guest_name,
    rc.reason,
    rc.changed_by,
    u.full_name as changed_by_name,
    rc.changed_at
FROM room_changes rc
JOIN bookings b ON rc.booking_id = b.id
JOIN rooms fr ON rc.from_room_id = fr.id
JOIN room_types frt ON fr.room_type_id = frt.id
JOIN rooms tr ON rc.to_room_id = tr.id
JOIN room_types trt ON tr.room_type_id = trt.id
JOIN guests g ON rc.guest_id = g.id
LEFT JOIN users u ON rc.changed_by = u.id
WHERE ($1::BIGINT IS NULL OR rc.booking_id = $1)
  AND ($2::BIGINT IS NULL OR rc.guest_id = $2)
  AND ($3::BIGINT IS NULL OR rc.from_room_id = $3 OR rc.to_room_id = $3)
ORDER BY rc.changed_at DESC
LIMIT $4
"#;

pub async fn fetch_room_change_history(
    pool: &DbPool,
    booking_id: Option<i64>,
    guest_id: Option<i64>,
    room_id: Option<i64>,
    limit: i64,
) -> Result<Vec<RoomChangeHistoryRow>, ApiError> {
    let rows = sqlx::query(GET_ROOM_CHANGE_HISTORY)
        .bind(booking_id)
        .bind(guest_id)
        .bind(room_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(db_err)?;

    Ok(rows
        .iter()
        .map(|row| RoomChangeHistoryRow {
            id: row.get("id"),
            booking_id: row.get("booking_id"),
            booking_number: row.get("booking_number"),
            from_room_id: row.get("from_room_id"),
            from_room_number: row.get("from_room_number"),
            from_room_type: row.get("from_room_type"),
            to_room_id: row.get("to_room_id"),
            to_room_number: row.get("to_room_number"),
            to_room_type: row.get("to_room_type"),
            guest_id: row.get("guest_id"),
            guest_name: row.get("guest_name"),
            reason: row.get("reason"),
            changed_by: row.get("changed_by"),
            changed_by_name: row.get("changed_by_name"),
            changed_at: row.get("changed_at"),
        })
        .collect())
}

// ==================== Room events ====================

const INSERT_ROOM_EVENT_FULL: &str = r#"
INSERT INTO room_events (room_id, event_type, status, priority, notes, scheduled_date, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, room_id, event_type, status, priority, notes, scheduled_date, created_by, created_at, updated_at
"#;

#[allow(clippy::too_many_arguments)]
pub async fn insert_room_event_full(
    pool: &DbPool,
    room_id: i64,
    event_type: &str,
    status: &str,
    priority: &str,
    notes: &Option<String>,
    scheduled_date: Option<NaiveDate>,
    user_id: i64,
) -> Result<RoomEvent, ApiError> {
    sqlx::query_as::<_, RoomEvent>(INSERT_ROOM_EVENT_FULL)
        .bind(room_id)
        .bind(event_type)
        .bind(status)
        .bind(priority)
        .bind(notes)
        .bind(scheduled_date)
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(db_err)
}

/// Best-effort; callers ignore the error.
pub async fn set_room_status_simple(
    pool: &DbPool,
    status: &str,
    room_id: i64,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE rooms SET status = $1 WHERE id = $2")
        .bind(status)
        .bind(room_id)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

// ==================== Detailed status ====================

pub struct RoomStatusDetailRow {
    pub id: i64,
    pub room_number: String,
    pub room_type: String,
    pub status: Option<String>,
    pub available: bool,
    pub notes: Option<String>,
    pub last_cleaned_at: Option<DateTime<Utc>>,
    pub last_inspected_at: Option<DateTime<Utc>>,
    pub reserved_start_date: Option<DateTime<Utc>>,
    pub reserved_end_date: Option<DateTime<Utc>>,
    pub maintenance_start_date: Option<DateTime<Utc>>,
    pub maintenance_end_date: Option<DateTime<Utc>>,
    pub cleaning_start_date: Option<DateTime<Utc>>,
    pub cleaning_end_date: Option<DateTime<Utc>>,
    pub connecting_room_id: Option<i64>,
    pub status_notes: Option<String>,
}

const GET_ROOM_DETAILED_STATUS: &str = r#"
SELECT r.id, r.room_number, rt.name as room_type, r.status,
       CASE WHEN r.status = 'available' THEN true ELSE false END as available,
       r.notes, r.last_cleaned_at, r.last_inspected_at,
       r.reserved_start_date, r.reserved_end_date,
       r.maintenance_start_date, r.maintenance_end_date,
       r.cleaning_start_date, r.cleaning_end_date,
       r.connecting_room_id, r.status_notes
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
WHERE r.id = $1
"#;

pub async fn fetch_room_detailed_status(
    pool: &DbPool,
    room_id: i64,
) -> Result<Option<RoomStatusDetailRow>, ApiError> {
    let row = sqlx::query(GET_ROOM_DETAILED_STATUS)
        .bind(room_id)
        .fetch_optional(pool)
        .await
        .map_err(db_err)?;

    Ok(row.map(|row| RoomStatusDetailRow {
        id: row.get("id"),
        room_number: row.get("room_number"),
        room_type: row.get("room_type"),
        status: row.try_get("status").ok(),
        available: row.try_get("available").unwrap_or(false),
        notes: row.try_get("notes").ok(),
        last_cleaned_at: row.try_get("last_cleaned_at").ok(),
        last_inspected_at: row.try_get("last_inspected_at").ok(),
        reserved_start_date: row.try_get("reserved_start_date").ok(),
        reserved_end_date: row.try_get("reserved_end_date").ok(),
        maintenance_start_date: row.try_get("maintenance_start_date").ok(),
        maintenance_end_date: row.try_get("maintenance_end_date").ok(),
        cleaning_start_date: row.try_get("cleaning_start_date").ok(),
        cleaning_end_date: row.try_get("cleaning_end_date").ok(),
        connecting_room_id: row.try_get("connecting_room_id").ok(),
        status_notes: row.try_get("status_notes").ok(),
    }))
}

const GET_CURRENT_BOOKING_FOR_ROOM: &str = r#"
SELECT b.id, b.guest_id, g.full_name as guest_name, g.email as guest_email,
       b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
       b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
       b.booking_number, NULL::VARCHAR as post_type, NULL::VARCHAR as rate_code, b.created_at
FROM bookings b
JOIN guests g ON b.guest_id = g.id
JOIN rooms r ON b.room_id = r.id
JOIN room_types rt ON r.room_type_id = rt.id
WHERE b.room_id = $1
  AND b.status NOT IN ('checked_out', 'voided')
  AND b.check_in_date <= CURRENT_DATE
  AND b.check_out_date > CURRENT_DATE
ORDER BY b.check_in_date DESC
LIMIT 1
"#;

pub async fn fetch_current_booking_for_room(
    pool: &DbPool,
    room_id: i64,
) -> Result<Option<BookingWithDetails>, ApiError> {
    let row = sqlx::query(GET_CURRENT_BOOKING_FOR_ROOM)
        .bind(room_id)
        .fetch_optional(pool)
        .await
        .map_err(db_err)?;
    Ok(row.map(|row| row_mappers::row_to_booking_with_details(&row)))
}

const GET_NEXT_BOOKING_FOR_ROOM: &str = r#"
SELECT b.id, b.guest_id, g.full_name as guest_name, g.email as guest_email,
       b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
       b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
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
"#;

pub async fn fetch_next_booking_for_room(
    pool: &DbPool,
    room_id: i64,
) -> Result<Option<BookingWithDetails>, ApiError> {
    let row = sqlx::query(GET_NEXT_BOOKING_FOR_ROOM)
        .bind(room_id)
        .fetch_optional(pool)
        .await
        .map_err(db_err)?;
    Ok(row.map(|row| row_mappers::row_to_booking_with_details(&row)))
}

const GET_ROOM_EVENTS: &str = r#"
SELECT id, room_id, event_type, status, priority, notes, scheduled_date, created_by, created_at, updated_at
FROM room_events
WHERE room_id = $1
ORDER BY created_at DESC
LIMIT 10
"#;

/// Swallows any failure (e.g. table not present) and returns an empty list,
/// matching the original `.unwrap_or_default()` call site.
pub async fn fetch_room_events(pool: &DbPool, room_id: i64) -> Vec<RoomEvent> {
    sqlx::query_as::<_, RoomEvent>(GET_ROOM_EVENTS)
        .bind(room_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
}

// ==================== Room history ====================

pub struct RoomHistoryRow {
    pub id: i64,
    pub room_id: i64,
    pub from_status: Option<String>,
    pub to_status: String,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
    pub changed_by: Option<i64>,
    pub changed_by_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub notes: Option<String>,
    pub is_auto_generated: bool,
}

const GET_ROOM_HISTORY: &str = r#"
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
"#;

pub async fn fetch_room_history(
    pool: &DbPool,
    room_id: i64,
) -> Result<Vec<RoomHistoryRow>, ApiError> {
    let rows = sqlx::query(GET_ROOM_HISTORY)
        .bind(room_id)
        .fetch_all(pool)
        .await
        .map_err(db_err)?;

    Ok(rows
        .iter()
        .map(|row| RoomHistoryRow {
            id: row.get("id"),
            room_id: row.get("room_id"),
            from_status: row.get("from_status"),
            to_status: row.get("to_status"),
            start_date: row.get("start_date"),
            end_date: row.get("end_date"),
            changed_by: row.get("changed_by"),
            changed_by_name: row.get("changed_by_name"),
            created_at: row.get("created_at"),
            notes: row.get("notes"),
            is_auto_generated: row.get("is_auto_generated"),
        })
        .collect())
}

// ==================== Reviews ====================

const GET_ROOM_REVIEWS: &str = r#"
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
"#;

pub async fn fetch_room_reviews(
    pool: &DbPool,
    room_type: &str,
) -> Result<Vec<GuestReview>, ApiError> {
    let rows = sqlx::query(GET_ROOM_REVIEWS)
        .bind(room_type)
        .fetch_all(pool)
        .await
        .map_err(db_err)?;
    Ok(rows.iter().map(row_mappers::row_to_guest_review).collect())
}

// ==================== Occupancy ====================

const ROOM_CURRENT_OCCUPANCY_COLUMNS: &str = r#"
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
"#;

pub async fn fetch_all_room_occupancy(pool: &DbPool) -> Result<Vec<RoomCurrentOccupancy>, ApiError> {
    let query = format!(
        "SELECT {} FROM room_current_occupancy ORDER BY room_number",
        ROOM_CURRENT_OCCUPANCY_COLUMNS
    );
    let rows = sqlx::query(&query).fetch_all(pool).await.map_err(db_err)?;
    Ok(rows
        .iter()
        .map(row_mappers::row_to_room_current_occupancy)
        .collect())
}

pub async fn fetch_room_occupancy(
    pool: &DbPool,
    room_id: i64,
) -> Result<Option<RoomCurrentOccupancy>, ApiError> {
    let query = format!(
        "SELECT {} FROM room_current_occupancy WHERE room_id = $1",
        ROOM_CURRENT_OCCUPANCY_COLUMNS
    );
    let row = sqlx::query(&query)
        .bind(room_id)
        .fetch_optional(pool)
        .await
        .map_err(db_err)?;
    Ok(row.map(|row| row_mappers::row_to_room_current_occupancy(&row)))
}

pub async fn fetch_hotel_occupancy_summary(pool: &DbPool) -> Result<HotelOccupancySummary, ApiError> {
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
        "#,
    )
    .fetch_one(pool)
    .await
    .map_err(db_err)?;
    Ok(row_mappers::row_to_hotel_occupancy_summary(&row))
}

pub async fn fetch_occupancy_by_room_type(
    pool: &DbPool,
) -> Result<Vec<OccupancyByRoomType>, ApiError> {
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
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(db_err)?;
    Ok(rows
        .iter()
        .map(row_mappers::row_to_occupancy_by_room_type)
        .collect())
}

const GET_ROOMS_WITH_OCCUPANCY: &str = r#"
SELECT
    r.id,
    r.room_number,
    rt.name as room_type,
    COALESCE(r.custom_price, rt.base_price)::text as price_per_night,
    CASE WHEN r.status = 'available' THEN true ELSE false END as available,
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
"#;

pub async fn fetch_rooms_with_occupancy(pool: &DbPool) -> Result<Vec<RoomWithOccupancy>, ApiError> {
    let rows = sqlx::query(GET_ROOMS_WITH_OCCUPANCY)
        .fetch_all(pool)
        .await
        .map_err(db_err)?;

    Ok(rows
        .iter()
        .map(|row| {
            let room = Room {
                id: row.get("id"),
                room_number: row.get("room_number"),
                room_type: row.get("room_type"),
                price_per_night: row
                    .get::<String, _>("price_per_night")
                    .parse()
                    .unwrap_or_default(),
                available: row.get("available"),
                description: row.get("description"),
                max_occupancy: row.get("max_occupancy"),
                status: row.get("status"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                notes: None,
                is_smoking: None,
            };

            RoomWithOccupancy {
                room,
                current_adults: row.get("current_adults"),
                current_children: row.get("current_children"),
                current_infants: row.get("current_infants"),
                current_total_guests: row.get("current_total_guests"),
                is_occupied: row.get("is_occupied"),
                current_booking_id: row.get("current_booking_id"),
                current_guest_id: row.get("current_guest_id"),
            }
        })
        .collect())
}
