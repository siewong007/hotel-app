//! Guest repository for database operations

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::Guest;

pub struct GuestRepository;

impl GuestRepository {
    /// Find all guests
    pub async fn find_all(pool: &DbPool) -> Result<Vec<Guest>, ApiError> {
        sqlx::query_as::<_, Guest>(
            r#"
            SELECT id, full_name, email, phone, ic_number, nationality,
                   address_line1, city, state_province, postal_code, country,
                   title, alt_phone, is_active, created_at, updated_at
            FROM guests
            WHERE deleted_at IS NULL
            ORDER BY full_name
            "#
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find guest by ID
    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Option<Guest>, ApiError> {
        sqlx::query_as::<_, Guest>(
            r#"
            SELECT id, full_name, email, phone, ic_number, nationality,
                   address_line1, city, state_province, postal_code, country,
                   title, alt_phone, is_active, created_at, updated_at
            FROM guests
            WHERE id = $1 AND deleted_at IS NULL
            "#
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find guest by email
    pub async fn find_by_email(pool: &DbPool, email: &str) -> Result<Option<Guest>, ApiError> {
        sqlx::query_as::<_, Guest>(
            r#"
            SELECT id, full_name, email, phone, ic_number, nationality,
                   address_line1, city, state_province, postal_code, country,
                   title, alt_phone, is_active, created_at, updated_at
            FROM guests
            WHERE email = $1 AND deleted_at IS NULL
            "#
        )
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find guests linked to a user
    pub async fn find_by_user_id(pool: &DbPool, user_id: i64) -> Result<Vec<Guest>, ApiError> {
        sqlx::query_as::<_, Guest>(
            r#"
            SELECT g.id, g.full_name, g.email, g.phone, g.ic_number, g.nationality,
                   g.address_line1, g.city, g.state_province, g.postal_code, g.country,
                   g.title, g.alt_phone, g.is_active, g.created_at, g.updated_at
            FROM guests g
            JOIN user_guests ug ON g.id = ug.guest_id
            WHERE ug.user_id = $1 AND g.deleted_at IS NULL
            ORDER BY g.full_name
            "#
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Create a new guest
    pub async fn create(
        pool: &DbPool,
        full_name: &str,
        email: &str,
        phone: Option<&str>,
        ic_number: Option<&str>,
        nationality: Option<&str>,
    ) -> Result<Guest, ApiError> {
        sqlx::query_as::<_, Guest>(
            r#"
            INSERT INTO guests (full_name, email, phone, ic_number, nationality, is_active)
            VALUES ($1, $2, $3, $4, $5, true)
            RETURNING id, full_name, email, phone, ic_number, nationality,
                      address_line1, city, state_province, postal_code, country,
                      title, alt_phone, is_active, created_at, updated_at
            "#
        )
        .bind(full_name)
        .bind(email)
        .bind(phone)
        .bind(ic_number)
        .bind(nationality)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Link guest to user
    pub async fn link_to_user(
        pool: &DbPool,
        user_id: i64,
        guest_id: i64,
        relationship_type: &str,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            INSERT INTO user_guests (user_id, guest_id, relationship_type, can_book_for, can_view_bookings, can_modify)
            VALUES ($1, $2, $3, true, true, false)
            ON CONFLICT (user_id, guest_id) DO NOTHING
            "#
        )
        .bind(user_id)
        .bind(guest_id)
        .bind(relationship_type)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Unlink guest from user
    pub async fn unlink_from_user(pool: &DbPool, user_id: i64, guest_id: i64) -> Result<(), ApiError> {
        sqlx::query("DELETE FROM user_guests WHERE user_id = $1 AND guest_id = $2")
            .bind(user_id)
            .bind(guest_id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Check if guest exists
    pub async fn exists(pool: &DbPool, id: i64) -> Result<bool, ApiError> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM guests WHERE id = $1 AND deleted_at IS NULL"
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(count > 0)
    }

    /// Soft delete a guest
    pub async fn delete(pool: &DbPool, id: i64) -> Result<(), ApiError> {
        sqlx::query("UPDATE guests SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }
}
