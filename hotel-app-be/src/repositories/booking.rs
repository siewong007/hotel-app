//! Booking repository for database operations

use crate::core::db::{DbPool, decimal_to_db};
use crate::core::error::ApiError;
use crate::models::{Booking, BookingPaginationParams, BookingWithDetails, row_mappers};
use crate::repositories::booking_list;
use crate::utils::pagination::Pagination;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::Row;

pub struct BookingRepository;

impl BookingRepository {
    /// Find paginated bookings with details using the booking list query planner.
    pub async fn find_paginated_with_details(
        pool: &DbPool,
        params: &BookingPaginationParams,
        base_query: &str,
        pagination: Pagination,
    ) -> Result<(i64, Vec<BookingWithDetails>), ApiError> {
        let list_query = booking_list::build_booking_list_query(params, base_query, pagination);
        let binds = &list_query.binds;

        macro_rules! apply_binds {
            ($q:expr) => {{
                let q = $q;
                let q = if let Some(ref v) = binds.status {
                    q.bind(v.as_str())
                } else {
                    q
                };
                let q = if let Some(ref v) = binds.search {
                    q.bind(v.as_str())
                } else {
                    q
                };
                let q = if let Some(ref v) = binds.room_number {
                    q.bind(v.as_str())
                } else {
                    q
                };
                let q = if let Some(ref v) = binds.payment_method {
                    q.bind(v.as_str())
                } else {
                    q
                };
                let q = if let Some(ref v) = binds.payment_date_from {
                    q.bind(*v)
                } else {
                    q
                };
                let q = if let Some(ref v) = binds.payment_date_to {
                    q.bind(*v)
                } else {
                    q
                };
                let q = if let Some(ref v) = binds.online_channel {
                    q.bind(v.as_str())
                } else {
                    q
                };
                let q = if let Some(ref v) = binds.date_search {
                    q.bind(*v)
                } else {
                    q
                };
                let q = if let Some(ref v) = binds.check_in_from {
                    q.bind(*v)
                } else {
                    q
                };
                let q = if let Some(ref v) = binds.check_in_to {
                    q.bind(*v)
                } else {
                    q
                };
                let q = if let Some(ref v) = binds.month_search_last_day {
                    q.bind(*v)
                } else {
                    q
                };
                let q = if let Some(ref v) = binds.month_search_first_day {
                    q.bind(*v)
                } else {
                    q
                };
                q
            }};
        }

        let rows = apply_binds!(sqlx::query(&list_query.data_sql))
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        // The windowed COUNT(*) OVER() rides along on every data row, so the page
        // total comes back without a second query. Only an empty page needs the
        // standalone count (offset past the end / no matching rows).
        let total: i64 = match rows.first() {
            Some(first) => first.try_get::<i64, _>("total_count").unwrap_or(0),
            None => apply_binds!(sqlx::query_scalar::<_, i64>(&list_query.count_sql))
                .fetch_one(pool)
                .await
                .unwrap_or(0),
        };

        let bookings = rows
            .iter()
            .map(row_mappers::row_to_booking_with_details)
            .collect();

        Ok((total, bookings))
    }

    /// Find all bookings with details
    pub async fn find_all_with_details(pool: &DbPool) -> Result<Vec<BookingWithDetails>, ApiError> {
        let rows = sqlx::query(
            r#"
            SELECT b.id, b.booking_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
                   b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
                   b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
                   b.payment_status, b.payment_method, b.source, b.remarks, b.created_at
            FROM bookings b
            JOIN guests g ON b.guest_id = g.id
            JOIN rooms r ON b.room_id = r.id
            LEFT JOIN room_types rt ON r.room_type_id = rt.id
            ORDER BY b.created_at DESC
            "#
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(rows
            .iter()
            .map(row_mappers::row_to_booking_with_details)
            .collect())
    }

    /// Find booking by ID
    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Option<Booking>, ApiError> {
        let row = sqlx::query(
            r#"
            SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date,
                   room_rate, subtotal, tax_amount, discount_amount, total_amount, status,
                   payment_status, adults, children, special_requests, remarks, source,
                   market_code, discount_percentage, rate_override_weekday, rate_override_weekend,
                   pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token,
                   pre_checkin_token_expires_at, created_by, created_at, updated_at
            FROM bookings
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(row.as_ref().map(row_mappers::row_to_booking))
    }

    /// Find booking by ID using the compatibility row mapper.
    pub async fn find_mapped_by_id(pool: &DbPool, id: i64) -> Result<Option<Booking>, ApiError> {
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        let query = "SELECT * FROM bookings WHERE id = ?1";

        #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
        let query = "SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, \
            room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, \
            payment_method, adults, children, special_requests, remarks, source, market_code, \
            discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, \
            pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, \
            is_complimentary, complimentary_reason, complimentary_start_date, complimentary_end_date, \
            original_total_amount, complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at, \
            company_id, company_name, payment_note, daily_rates, created_at, updated_at, post_type \
            FROM bookings WHERE id = $1";

        let row = sqlx::query(query)
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(row.as_ref().map(row_mappers::row_to_booking))
    }

    /// Find booking with details by ID
    pub async fn find_by_id_with_details(
        pool: &DbPool,
        id: i64,
    ) -> Result<Option<BookingWithDetails>, ApiError> {
        let row = sqlx::query(
            r#"
            SELECT b.id, b.booking_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
                   b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
                   b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
                   b.payment_status, b.payment_method, b.source, b.remarks, b.created_at
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
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(row.as_ref().map(row_mappers::row_to_booking_with_details))
    }

    /// Find bookings by guest ID
    pub async fn find_by_guest_id(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Vec<BookingWithDetails>, ApiError> {
        let rows = sqlx::query(
            r#"
            SELECT b.id, b.booking_number, b.guest_id, g.full_name as guest_name, g.email as guest_email,
                   b.room_id, r.room_number, rt.name as room_type, rt.code as room_type_code,
                   b.check_in_date, b.check_out_date, b.room_rate, b.total_amount, b.status,
                   b.payment_status, b.payment_method, b.source, b.remarks, b.created_at
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
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(rows
            .iter()
            .map(row_mappers::row_to_booking_with_details)
            .collect())
    }

    /// Create a new booking
    pub async fn create(
        pool: &DbPool,
        guest_id: i64,
        room_id: i64,
        check_in_date: NaiveDate,
        check_out_date: NaiveDate,
        total_amount: Decimal,
        created_by: i64,
    ) -> Result<Booking, ApiError> {
        let booking_number = format!(
            "BK-{}-{:06}",
            chrono::Utc::now().format("%Y%m%d"),
            rand::random::<u32>() % 1000000
        );
        sqlx::query(
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
        .bind(decimal_to_db(total_amount))
        .bind(created_by)
        .fetch_one(pool)
        .await
        .map(|row| row_mappers::row_to_booking(&row))
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Update booking status
    pub async fn update_status(pool: &DbPool, id: i64, status: &str) -> Result<(), ApiError> {
        sqlx::query(
            "UPDATE bookings SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        )
        .bind(status)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(())
    }

    /// Check in a booking
    pub async fn check_in(pool: &DbPool, id: i64, _check_in_time: &str) -> Result<(), ApiError> {
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
    pub async fn check_out(pool: &DbPool, id: i64, _check_out_time: &str) -> Result<(), ApiError> {
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
    pub async fn exists(pool: &DbPool, id: i64) -> Result<bool, ApiError> {
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM bookings WHERE id = $1)")
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }
}
