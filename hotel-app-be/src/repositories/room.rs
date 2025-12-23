//! Room repository for database operations

use sqlx::PgPool;
use crate::core::error::ApiError;
use crate::models::{Room, RoomWithRating, RoomType, RoomEvent, GuestReview};

pub struct RoomRepository;

impl RoomRepository {
    /// Find all rooms with ratings
    pub async fn find_all_with_ratings(pool: &PgPool) -> Result<Vec<RoomWithRating>, ApiError> {
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
    pub async fn find_by_id(pool: &PgPool, id: i64) -> Result<Option<Room>, ApiError> {
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
    pub async fn find_by_room_number(pool: &PgPool, room_number: &str) -> Result<Option<Room>, ApiError> {
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
    pub async fn get_room_types(pool: &PgPool) -> Result<Vec<RoomType>, ApiError> {
        sqlx::query_as::<_, RoomType>(
            r#"
            SELECT id, name, code, description, base_price, max_occupancy,
                   is_active, created_at, updated_at
            FROM room_types
            WHERE is_active = true
            ORDER BY name
            "#
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Get room events
    pub async fn get_events(pool: &PgPool, room_id: i64) -> Result<Vec<RoomEvent>, ApiError> {
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
    pub async fn get_reviews(pool: &PgPool, room_type: &str) -> Result<Vec<GuestReview>, ApiError> {
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
        pool: &PgPool,
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
    pub async fn exists(pool: &PgPool, id: i64) -> Result<bool, ApiError> {
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
