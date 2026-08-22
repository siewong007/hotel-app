//! Guest portal data access

use chrono::{DateTime, Utc};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::models::{Booking, Guest, GuestUpdateInput};
use crate::param;

const BOOKING_SELECT: &str = "SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, currency, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, created_at, updated_at FROM bookings";

pub struct GuestPortalRepository;

impl GuestPortalRepository {
    pub async fn find_eligible_booking_by_number(
        pool: &DbPool,
        booking_number: &str,
    ) -> Result<Option<Booking>, ApiError> {
        let row = sqlx::query(&format!(
            "{} WHERE booking_number = {} AND status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')",
            BOOKING_SELECT,
            param!(1)
        ))
        .bind(booking_number)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to fetch booking: {}", e)))?;
        Ok(row.as_ref().map(row_mappers::row_to_booking))
    }

    pub async fn find_booking_by_token(
        pool: &DbPool,
        token: &str,
    ) -> Result<Option<Booking>, ApiError> {
        let row = sqlx::query(&format!(
            "{} WHERE pre_checkin_token = {}",
            BOOKING_SELECT,
            param!(1)
        ))
        .bind(token)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to fetch booking: {}", e)))?;
        Ok(row.as_ref().map(row_mappers::row_to_booking))
    }

    pub async fn find_booking_by_id(pool: &DbPool, booking_id: i64) -> Result<Booking, ApiError> {
        let row = sqlx::query(&format!("{} WHERE id = {}", BOOKING_SELECT, param!(1)))
            .bind(booking_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to fetch updated booking: {}", e)))?;
        Ok(row_mappers::row_to_booking(&row))
    }

    pub async fn find_guest(pool: &DbPool, guest_id: i64) -> Result<Guest, ApiError> {
        let query = r#"
                SELECT id, full_name, email, phone, ic_number, nationality,
                       address_line_1 as address_line1, city, state as state_province,
                       postal_code, country, title, alt_phone, is_active,
                       guest_type, tourism_type,
                       COALESCE(discount_percentage, 0) as discount_percentage,
                       company_name,
                       COALESCE(complimentary_nights_credit, 0) as complimentary_nights_credit,
                       created_at, updated_at,
                       NULL::BIGINT as bookings_count,
                       NULL::DATE as last_stay_date
                FROM guests
                WHERE id = $1
            "#;

        sqlx::query_as::<_, Guest>(query)
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
        let sql = format!(
            "UPDATE bookings SET pre_checkin_token = {}, pre_checkin_token_expires_at = {} WHERE id = {}",
            param!(1),
            param!(2),
            param!(3)
        );
        sqlx::query(&sql)
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
            "address_line_1",
            &guest_update.address_line1,
        );
        push_update(&mut query_parts, &mut values, "city", &guest_update.city);
        push_update(
            &mut query_parts,
            &mut values,
            "state",
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
            "UPDATE guests SET {} WHERE id = {}",
            query_parts.join(", "),
            parameter(values.len() + 1)
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
            updates.push(format!("market_code = {}", parameter(values.len() + 1)));
            values.push(market_code);
        }
        if let Some(special_requests) = special_requests {
            updates.push(format!(
                "special_requests = {}",
                parameter(values.len() + 1)
            ));
            values.push(special_requests);
        }

        updates.push("pre_checkin_completed = true".to_string());
        updates.push(format!(
            "pre_checkin_completed_at = {}",
            parameter(values.len() + 1)
        ));
        values.push(completed_at);
        updates.push("pre_checkin_token = NULL".to_string());
        updates.push("pre_checkin_token_expires_at = NULL".to_string());

        let query = format!(
            "UPDATE bookings SET {} WHERE id = {}",
            updates.join(", "),
            parameter(values.len() + 1)
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
        query_parts.push(format!("{} = {}", column, parameter(values.len() + 1)));
        values.push(value.clone());
    }
}

fn parameter(index: usize) -> String {
    format!("{}{}", "$", index)
}
