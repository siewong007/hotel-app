//! Guest portal data access

use chrono::{DateTime, Utc};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{Booking, Guest, GuestUpdateInput};

const BOOKING_SELECT: &str = "SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, created_at, updated_at FROM bookings";

pub struct GuestPortalRepository;

impl GuestPortalRepository {
    pub async fn find_eligible_booking_by_number(
        pool: &DbPool,
        booking_number: &str,
    ) -> Result<Option<Booking>, ApiError> {
        sqlx::query_as::<_, Booking>(&format!(
            "{} WHERE booking_number = $1 AND status IN ('confirmed', 'pending')",
            BOOKING_SELECT
        ))
        .bind(booking_number)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to fetch booking: {}", e)))
    }

    pub async fn find_booking_by_token(
        pool: &DbPool,
        token: &str,
    ) -> Result<Option<Booking>, ApiError> {
        sqlx::query_as::<_, Booking>(&format!("{} WHERE pre_checkin_token = $1", BOOKING_SELECT))
            .bind(token)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to fetch booking: {}", e)))
    }

    pub async fn find_booking_by_id(pool: &DbPool, booking_id: i64) -> Result<Booking, ApiError> {
        sqlx::query_as::<_, Booking>(&format!("{} WHERE id = $1", BOOKING_SELECT))
            .bind(booking_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to fetch updated booking: {}", e)))
    }

    pub async fn find_guest(pool: &DbPool, guest_id: i64) -> Result<Guest, ApiError> {
        sqlx::query_as::<_, Guest>("SELECT * FROM guests WHERE id = $1")
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to fetch guest: {}", e)))
    }

    pub async fn update_precheckin_token(
        pool: &DbPool,
        booking_id: i64,
        token: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE bookings
            SET pre_checkin_token = $1,
                pre_checkin_token_expires_at = $2
            WHERE id = $3
            "#,
        )
        .bind(token)
        .bind(expires_at)
        .bind(booking_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to update token: {}", e)))?;

        Ok(())
    }

    pub async fn update_guest_precheckin(
        pool: &DbPool,
        guest_id: i64,
        guest_update: &GuestUpdateInput,
    ) -> Result<(), ApiError> {
        let mut query_parts = Vec::new();
        let mut values = Vec::new();

        push_update(
            &mut query_parts,
            &mut values,
            "first_name",
            &guest_update.first_name,
        );
        push_update(
            &mut query_parts,
            &mut values,
            "last_name",
            &guest_update.last_name,
        );
        if let Some(email) = &guest_update.email {
            if email.is_empty() {
                query_parts.push("email = NULL".to_string());
            } else {
                push_update(&mut query_parts, &mut values, "email", &guest_update.email);
            }
        }
        push_update(&mut query_parts, &mut values, "phone", &guest_update.phone);
        push_update(
            &mut query_parts,
            &mut values,
            "alt_phone",
            &guest_update.alt_phone,
        );
        push_update(
            &mut query_parts,
            &mut values,
            "nationality",
            &guest_update.nationality,
        );
        push_update(
            &mut query_parts,
            &mut values,
            "address_line1",
            &guest_update.address_line1,
        );
        push_update(&mut query_parts, &mut values, "city", &guest_update.city);
        push_update(
            &mut query_parts,
            &mut values,
            "state_province",
            &guest_update.state_province,
        );
        push_update(
            &mut query_parts,
            &mut values,
            "postal_code",
            &guest_update.postal_code,
        );
        push_update(
            &mut query_parts,
            &mut values,
            "country",
            &guest_update.country,
        );
        push_update(&mut query_parts, &mut values, "title", &guest_update.title);
        push_update(
            &mut query_parts,
            &mut values,
            "ic_number",
            &guest_update.ic_number,
        );

        if query_parts.is_empty() {
            return Ok(());
        }

        let query = format!(
            "UPDATE guests SET {} WHERE id = ${}",
            query_parts.join(", "),
            values.len() + 1
        );

        let mut sqlx_query = sqlx::query(&query);
        for value in values {
            sqlx_query = sqlx_query.bind(value);
        }
        sqlx_query = sqlx_query.bind(guest_id);

        sqlx_query
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| ApiError::Database(format!("Failed to update guest: {}", e)))
    }

    pub async fn update_booking_precheckin(
        pool: &DbPool,
        booking_id: i64,
        market_code: Option<String>,
        special_requests: Option<String>,
        completed_at: String,
    ) -> Result<(), ApiError> {
        let mut updates = Vec::new();
        let mut values = Vec::new();

        if let Some(market_code) = market_code {
            updates.push(format!("market_code = ${}", values.len() + 1));
            values.push(market_code);
        }
        if let Some(special_requests) = special_requests {
            updates.push(format!("special_requests = ${}", values.len() + 1));
            values.push(special_requests);
        }

        updates.push("pre_checkin_completed = true".to_string());
        updates.push(format!("pre_checkin_completed_at = ${}", values.len() + 1));
        values.push(completed_at);

        let query = format!(
            "UPDATE bookings SET {} WHERE id = ${}",
            updates.join(", "),
            values.len() + 1
        );

        let mut sqlx_query = sqlx::query(&query);
        for value in values {
            sqlx_query = sqlx_query.bind(value);
        }
        sqlx_query = sqlx_query.bind(booking_id);

        sqlx_query
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| ApiError::Database(format!("Failed to update booking: {}", e)))
    }
}

fn push_update(
    query_parts: &mut Vec<String>,
    values: &mut Vec<String>,
    column: &str,
    value: &Option<String>,
) {
    if let Some(value) = value {
        query_parts.push(format!("{} = ${}", column, values.len() + 1));
        values.push(value.clone());
    }
}
