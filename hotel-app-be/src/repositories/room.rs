//! Room repository for database operations

use crate::core::db::{DbPool, DbRow};
use crate::core::error::ApiError;
use crate::models::{Room, RoomWithRating, RoomType, RoomEvent, GuestReview};
use sqlx::Row;

/// Helper function to map a database row to RoomType
/// This avoids using FromRow which doesn't work for Decimal in SQLite
fn row_to_room_type(row: DbRow) -> RoomType {
    // Read Decimal fields as String and parse (works for both PostgreSQL and SQLite)
    let base_price: String = row.try_get::<String, _>("base_price")
        .or_else(|_| row.try_get::<f64, _>("base_price").map(|f| f.to_string()))
        .unwrap_or_else(|_| "0".to_string());
    let weekday_rate: Option<String> = row.try_get::<String, _>("weekday_rate").ok()
        .or_else(|| row.try_get::<f64, _>("weekday_rate").ok().map(|f| f.to_string()));
    let weekend_rate: Option<String> = row.try_get::<String, _>("weekend_rate").ok()
        .or_else(|| row.try_get::<f64, _>("weekend_rate").ok().map(|f| f.to_string()));
    let extra_bed_charge: String = row.try_get::<String, _>("extra_bed_charge")
        .or_else(|_| row.try_get::<f64, _>("extra_bed_charge").map(|f| f.to_string()))
        .unwrap_or_else(|_| "0".to_string());

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
        base_price: base_price.parse().unwrap_or_default(),
        weekday_rate: weekday_rate.and_then(|s| s.parse().ok()),
        weekend_rate: weekend_rate.and_then(|s| s.parse().ok()),
        max_occupancy: row.get("max_occupancy"),
        bed_type: row.try_get("bed_type").ok(),
        bed_count: row.try_get("bed_count").ok(),
        allows_extra_bed,
        max_extra_beds: row.try_get("max_extra_beds").unwrap_or(0),
        extra_bed_charge: extra_bed_charge.parse().unwrap_or_default(),
        is_active,
        sort_order: row.try_get("sort_order").unwrap_or(0),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

pub struct RoomRepository;

impl RoomRepository {
    /// Find all rooms with ratings
    pub async fn find_all_with_ratings(pool: &DbPool) -> Result<Vec<RoomWithRating>, ApiError> {
        sqlx::query_as::<_, RoomWithRating>(
            r#"
            SELECT r.id, r.room_number, r.room_type, r.price_per_night, r.available,
                   r.status, r.description, r.max_occupancy,
                   r.maintenance_start_date, r.maintenance_end_date,
                   r.cleaning_start_date, r.cleaning_end_date,
                   r.reserved_start_date, r.reserved_end_date,
                   r.created_at, r.updated_at,
                   COALESCE(AVG(rv.overall_rating)::float8, 0) as average_rating,
                   COALESCE(COUNT(rv.id), 0) as review_count
            FROM rooms r
            LEFT JOIN room_types rt ON r.room_type_id = rt.id
            LEFT JOIN guest_reviews rv ON rt.id = rv.room_type_id
            WHERE r.deleted_at IS NULL
            GROUP BY r.id
            ORDER BY r.room_number
            "#
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find room by ID
    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Option<Room>, ApiError> {
        sqlx::query_as::<_, Room>(
            r#"
            SELECT id, room_number, room_type, price_per_night, available, status,
                   description, max_occupancy, created_at, updated_at
            FROM rooms
            WHERE id = $1 AND deleted_at IS NULL
            "#
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find room by room number
    pub async fn find_by_room_number(pool: &DbPool, room_number: &str) -> Result<Option<Room>, ApiError> {
        sqlx::query_as::<_, Room>(
            r#"
            SELECT id, room_number, room_type, price_per_night, available, status,
                   description, max_occupancy, created_at, updated_at
            FROM rooms
            WHERE room_number = $1 AND deleted_at IS NULL
            "#
        )
        .bind(room_number)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get all room types
    pub async fn get_room_types(pool: &DbPool) -> Result<Vec<RoomType>, ApiError> {
        let room_types: Vec<RoomType> = sqlx::query(
            r#"
            SELECT * FROM room_types
            WHERE is_active = true
            ORDER BY name
            "#
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .into_iter()
        .map(row_to_room_type)
        .collect();
        Ok(room_types)
    }

    /// Get room events
    pub async fn get_events(pool: &DbPool, room_id: i64) -> Result<Vec<RoomEvent>, ApiError> {
        sqlx::query_as::<_, RoomEvent>(
            r#"
            SELECT id, room_id, event_type, status, priority, notes,
                   scheduled_date, created_by, created_at, updated_at
            FROM room_events
            WHERE room_id = $1
            ORDER BY created_at DESC
            "#
        )
        .bind(room_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get reviews for a room type
    pub async fn get_reviews(pool: &DbPool, room_type: &str) -> Result<Vec<GuestReview>, ApiError> {
        sqlx::query_as::<_, GuestReview>(
            r#"
            SELECT gr.id, gr.guest_id, g.full_name as guest_name, gr.room_type_id,
                   gr.overall_rating, gr.cleanliness_rating, gr.staff_rating,
                   gr.facilities_rating, gr.value_rating, gr.location_rating,
                   gr.title, gr.review_text, gr.pros, gr.cons, gr.recommend,
                   gr.stay_type, gr.is_verified, gr.helpful_count, gr.created_at
            FROM guest_reviews gr
            JOIN guests g ON gr.guest_id = g.id
            JOIN room_types rt ON gr.room_type_id = rt.id
            WHERE LOWER(rt.name) = LOWER($1)
            ORDER BY gr.created_at DESC
            "#
        )
        .bind(room_type)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Update room status
    pub async fn update_status(
        pool: &DbPool,
        room_id: i64,
        status: &str,
        available: bool,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE rooms
            SET status = $1, available = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            "#
        )
        .bind(status)
        .bind(available)
        .bind(room_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Check if room exists
    pub async fn exists(pool: &DbPool, id: i64) -> Result<bool, ApiError> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM rooms WHERE id = $1 AND deleted_at IS NULL"
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(count > 0)
    }
}
