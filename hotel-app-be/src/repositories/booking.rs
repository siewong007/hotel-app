//! Booking repository for database operations

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{Booking, BookingPaginationParams, BookingWithDetails, row_mappers};
use crate::repositories::booking_list;
use crate::utils::pagination::Pagination;
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

    /// Find booking by ID
    #[allow(dead_code)] // used by tests/payment_characterization.rs
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

    /// Check out a booking
    #[allow(dead_code)] // used by tests/rooms_housekeeping.rs
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

}
