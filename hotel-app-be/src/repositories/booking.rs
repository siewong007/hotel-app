//! Booking repository for database operations

use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::PgPool;
use crate::core::error::ApiError;
use crate::models::{Booking, BookingWithDetails};

pub struct BookingRepository;

impl BookingRepository {
    /// Find all bookings with details
    pub async fn find_all_with_details(pool: &PgPool) -> Result<Vec<BookingWithDetails>, ApiError> {
        sqlx::query_as::<_, BookingWithDetails>(
            r#"
            SELECT b.id, b.booking_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
                   b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
                   b.check_in_date, b.check_out_date, b.total_amount, b.status,
                   b.payment_status, b.source, b.created_at
            FROM bookings b
            JOIN guests g ON b.guest_id = g.id
            JOIN rooms r ON b.room_id = r.id
            LEFT JOIN room_types rt ON r.room_type_id = rt.id
            ORDER BY b.created_at DESC
            "#
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find booking by ID
    pub async fn find_by_id(pool: &PgPool, id: i64) -> Result<Option<Booking>, ApiError> {
        sqlx::query_as::<_, Booking>(
            r#"
            SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date,
                   room_rate, subtotal, tax_amount, discount_amount, total_amount, status,
                   payment_status, adults, children, special_requests, remarks, source,
                   market_code, discount_percentage, rate_override_weekday, rate_override_weekend,
                   pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token,
                   pre_checkin_token_expires_at, created_by, created_at, updated_at
            FROM bookings
            WHERE id = $1
            "#
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find booking with details by ID
    pub async fn find_by_id_with_details(pool: &PgPool, id: i64) -> Result<Option<BookingWithDetails>, ApiError> {
        sqlx::query_as::<_, BookingWithDetails>(
            r#"
            SELECT b.id, b.booking_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
                   b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
                   b.check_in_date, b.check_out_date, b.total_amount, b.status,
                   b.payment_status, b.source, b.created_at
            FROM bookings b
            JOIN guests g ON b.guest_id = g.id
            JOIN rooms r ON b.room_id = r.id
            LEFT JOIN room_types rt ON r.room_type_id = rt.id
            WHERE b.id = $1
            "#
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Find bookings by guest ID
    pub async fn find_by_guest_id(pool: &PgPool, guest_id: i64) -> Result<Vec<BookingWithDetails>, ApiError> {
        sqlx::query_as::<_, BookingWithDetails>(
            r#"
            SELECT b.id, b.booking_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
                   b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
                   b.check_in_date, b.check_out_date, b.total_amount, b.status,
                   b.payment_status, b.source, b.created_at
            FROM bookings b
            JOIN guests g ON b.guest_id = g.id
            JOIN rooms r ON b.room_id = r.id
            LEFT JOIN room_types rt ON r.room_type_id = rt.id
            WHERE b.guest_id = $1
            ORDER BY b.created_at DESC
            "#
        )
        .bind(guest_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Create a new booking
    pub async fn create(
        pool: &PgPool,
        guest_id: i64,
        room_id: i64,
        check_in_date: NaiveDate,
        check_out_date: NaiveDate,
        total_amount: Decimal,
        created_by: i64,
    ) -> Result<Booking, ApiError> {
        let booking_number = format!("BK-{}-{:06}", chrono::Utc::now().format("%Y%m%d"), rand::random::<u32>() % 1000000);
        sqlx::query_as::<_, Booking>(
            r#"
            INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, total_amount, status, created_by, adults)
            VALUES ($1, $2, $3, $4, $5, $6, $6, $6, 'pending', $7, 1)
            RETURNING id, booking_number, guest_id, room_id, check_in_date, check_out_date,
                      room_rate, subtotal, tax_amount, discount_amount, total_amount, status,
                      payment_status, adults, children, special_requests, remarks, source,
                      market_code, discount_percentage, rate_override_weekday, rate_override_weekend,
                      pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token,
                      pre_checkin_token_expires_at, created_by, created_at, updated_at
            "#
        )
        .bind(&booking_number)
        .bind(guest_id)
        .bind(room_id)
        .bind(check_in_date)
        .bind(check_out_date)
        .bind(total_amount)
        .bind(created_by)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Update booking status
    pub async fn update_status(pool: &PgPool, id: i64, status: &str) -> Result<(), ApiError> {
        sqlx::query("UPDATE bookings SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2")
            .bind(status)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Check in a booking
    pub async fn check_in(pool: &PgPool, id: i64, _check_in_time: &str) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE bookings
            SET status = 'checked_in', actual_check_in = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            "#
        )
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Check out a booking
    pub async fn check_out(pool: &PgPool, id: i64, _check_out_time: &str) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE bookings
            SET status = 'checked_out', actual_check_out = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            "#
        )
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Check if booking exists
    pub async fn exists(pool: &PgPool, id: i64) -> Result<bool, ApiError> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM bookings WHERE id = $1"
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(count > 0)
    }
}
