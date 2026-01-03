//! Guest portal handlers
//!
//! Handles guest self-service features including pre-check-in.

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::core::error::ApiError;
use crate::models::{Booking, Guest, PreCheckInUpdateRequest};

/// Request for verifying guest booking
#[derive(Debug, Deserialize)]
pub struct GuestPortalVerifyRequest {
    pub booking_number: String,
    pub email: String,
}

/// Response for verification
#[derive(Debug, Serialize)]
pub struct GuestPortalVerifyResponse {
    pub token: String,
    pub expires_at: String,
    pub booking_id: String,
}

/// Response for booking details
#[derive(Debug, Serialize)]
pub struct GuestPortalBookingResponse {
    pub booking: Booking,
    pub guest: Guest,
}

/// Generate a secure random token for pre-checkin
fn generate_precheckin_token() -> String {
    Uuid::new_v4().to_string()
}

/// POST /guest-portal/verify
/// Verifies booking number + email and generates a time-limited token
pub async fn verify_guest_booking(
    State(pool): State<PgPool>,
    Json(request): Json<GuestPortalVerifyRequest>,
) -> Result<Json<GuestPortalVerifyResponse>, ApiError> {
    // Find booking by booking_number
    let booking = sqlx::query_as::<_, Booking>(
        r#"
        SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, created_at, updated_at
        FROM bookings
        WHERE booking_number = $1
        AND status IN ('confirmed', 'pending')
        "#,
    )
    .bind(&request.booking_number)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to fetch booking: {}", e)))?
    .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;

    // Verify guest email matches
    let guest = sqlx::query_as::<_, Guest>("SELECT * FROM guests WHERE id = $1")
        .bind(&booking.guest_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to fetch guest: {}", e)))?;

    if guest.email.as_deref() != Some(request.email.as_str()) {
        return Err(ApiError::Unauthorized(
            "Email does not match booking".to_string(),
        ));
    }

    // Check if booking is eligible for pre-checkin (check-in date within next 7 days)
    let check_in_date = booking.check_in_date;
    let today = Utc::now().date_naive();
    let days_until_checkin = (check_in_date - today).num_days();

    if days_until_checkin < 0 {
        return Err(ApiError::BadRequest(
            "Check-in date has passed. Please check in at reception.".to_string(),
        ));
    }

    if days_until_checkin > 7 {
        return Err(ApiError::BadRequest(
            "Pre-check-in is only available 7 days before arrival.".to_string(),
        ));
    }

    // Generate token and set expiration (48 hours from now)
    let token = generate_precheckin_token();
    let expires_at = Utc::now() + Duration::hours(48);

    // Update booking with token
    sqlx::query(
        r#"
        UPDATE bookings
        SET pre_checkin_token = $1,
            pre_checkin_token_expires_at = $2
        WHERE id = $3
        "#,
    )
    .bind(&token)
    .bind(expires_at)
    .bind(&booking.id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to update token: {}", e)))?;

    Ok(Json(GuestPortalVerifyResponse {
        token,
        expires_at: expires_at.to_rfc3339(),
        booking_id: booking.id.to_string(),
    }))
}

/// GET /guest-portal/booking/:token
/// Gets booking details using the pre-checkin token
pub async fn get_booking_by_token(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> Result<Json<GuestPortalBookingResponse>, ApiError> {
    // Find booking by token
    let booking = sqlx::query_as::<_, Booking>(
        r#"
        SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, created_at, updated_at
        FROM bookings
        WHERE pre_checkin_token = $1
        "#,
    )
    .bind(&token)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to fetch booking: {}", e)))?
    .ok_or_else(|| ApiError::NotFound("Invalid or expired token".to_string()))?;

    // Check if token is expired
    if let Some(expires_at) = booking.pre_checkin_token_expires_at {
        if expires_at < Utc::now() {
            return Err(ApiError::Unauthorized("Token has expired".to_string()));
        }
    } else {
        return Err(ApiError::Unauthorized("Invalid token".to_string()));
    }

    // Get guest details
    let guest = sqlx::query_as::<_, Guest>("SELECT * FROM guests WHERE id = $1")
        .bind(&booking.guest_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to fetch guest: {}", e)))?;

    Ok(Json(GuestPortalBookingResponse { booking, guest }))
}

/// POST /guest-portal/pre-checkin/:token
/// Allows guest to update their information before arrival
pub async fn submit_precheckin_update(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
    Json(request): Json<PreCheckInUpdateRequest>,
) -> Result<Json<GuestPortalBookingResponse>, ApiError> {
    // Verify token and get booking
    let booking = sqlx::query_as::<_, Booking>(
        r#"
        SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, created_at, updated_at
        FROM bookings
        WHERE pre_checkin_token = $1
        "#,
    )
    .bind(&token)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to fetch booking: {}", e)))?
    .ok_or_else(|| ApiError::NotFound("Invalid or expired token".to_string()))?;

    // Check if token is expired
    if let Some(expires_at) = booking.pre_checkin_token_expires_at {
        if expires_at < Utc::now() {
            return Err(ApiError::Unauthorized("Token has expired".to_string()));
        }
    } else {
        return Err(ApiError::Unauthorized("Invalid token".to_string()));
    }

    // Update guest information
    let guest_update = request.guest_update;
    let mut query_parts = vec![];
    let mut values: Vec<String> = vec![];

    if let Some(ref first_name) = guest_update.first_name {
        query_parts.push(format!("first_name = ${}", values.len() + 1));
        values.push(first_name.clone());
    }
    if let Some(ref last_name) = guest_update.last_name {
        query_parts.push(format!("last_name = ${}", values.len() + 1));
        values.push(last_name.clone());
    }
    if let Some(ref email) = guest_update.email {
        query_parts.push(format!("email = ${}", values.len() + 1));
        values.push(email.clone());
    }
    if let Some(ref phone) = guest_update.phone {
        query_parts.push(format!("phone = ${}", values.len() + 1));
        values.push(phone.clone());
    }
    if let Some(ref alt_phone) = guest_update.alt_phone {
        query_parts.push(format!("alt_phone = ${}", values.len() + 1));
        values.push(alt_phone.clone());
    }
    if let Some(ref nationality) = guest_update.nationality {
        query_parts.push(format!("nationality = ${}", values.len() + 1));
        values.push(nationality.clone());
    }
    if let Some(ref address) = guest_update.address_line1 {
        query_parts.push(format!("address_line1 = ${}", values.len() + 1));
        values.push(address.clone());
    }
    if let Some(ref city) = guest_update.city {
        query_parts.push(format!("city = ${}", values.len() + 1));
        values.push(city.clone());
    }
    if let Some(ref state) = guest_update.state_province {
        query_parts.push(format!("state_province = ${}", values.len() + 1));
        values.push(state.clone());
    }
    if let Some(ref postal_code) = guest_update.postal_code {
        query_parts.push(format!("postal_code = ${}", values.len() + 1));
        values.push(postal_code.clone());
    }
    if let Some(ref country) = guest_update.country {
        query_parts.push(format!("country = ${}", values.len() + 1));
        values.push(country.clone());
    }
    if let Some(ref title) = guest_update.title {
        query_parts.push(format!("title = ${}", values.len() + 1));
        values.push(title.clone());
    }
    if let Some(ref ic_number) = guest_update.ic_number {
        query_parts.push(format!("ic_number = ${}", values.len() + 1));
        values.push(ic_number.clone());
    }

    if !query_parts.is_empty() {
        let query = format!(
            "UPDATE guests SET {} WHERE id = ${}",
            query_parts.join(", "),
            values.len() + 1
        );

        let mut sqlx_query = sqlx::query(&query);
        for value in values {
            sqlx_query = sqlx_query.bind(value);
        }
        sqlx_query = sqlx_query.bind(&booking.guest_id);

        sqlx_query
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to update guest: {}", e)))?;
    }

    // Update booking fields if provided - using parameterized queries
    let mut booking_updates = Vec::new();
    let mut booking_values: Vec<String> = Vec::new();

    if let Some(market_code) = request.market_code {
        booking_updates.push(format!("market_code = ${}", booking_values.len() + 1));
        booking_values.push(market_code);
    }
    if let Some(special_requests) = request.special_requests {
        booking_updates.push(format!("special_requests = ${}", booking_values.len() + 1));
        booking_values.push(special_requests);
    }

    // Always mark pre-checkin as completed
    booking_updates.push("pre_checkin_completed = true".to_string());
    booking_updates.push(format!(
        "pre_checkin_completed_at = ${}",
        booking_values.len() + 1
    ));
    let completed_at = Utc::now().to_rfc3339();
    booking_values.push(completed_at);

    if !booking_updates.is_empty() {
        let query = format!(
            "UPDATE bookings SET {} WHERE id = ${}",
            booking_updates.join(", "),
            booking_values.len() + 1
        );

        let mut sqlx_query = sqlx::query(&query);
        for value in booking_values {
            sqlx_query = sqlx_query.bind(value);
        }
        sqlx_query = sqlx_query.bind(&booking.id);

        sqlx_query
            .execute(&pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to update booking: {}", e)))?;
    }

    // Return updated data
    let updated_booking = sqlx::query_as::<_, Booking>("SELECT id, booking_number, guest_id, room_id, check_in_date, check_out_date, room_rate, subtotal, tax_amount, discount_amount, total_amount, status, payment_status, adults, children, special_requests, remarks, source, market_code, discount_percentage, rate_override_weekday, rate_override_weekend, pre_checkin_completed, pre_checkin_completed_at, pre_checkin_token, pre_checkin_token_expires_at, created_by, created_at, updated_at FROM bookings WHERE id = $1")
        .bind(&booking.id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to fetch updated booking: {}", e)))?;

    let updated_guest = sqlx::query_as::<_, Guest>("SELECT * FROM guests WHERE id = $1")
        .bind(&updated_booking.guest_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to fetch updated guest: {}", e)))?;

    Ok(Json(GuestPortalBookingResponse {
        booking: updated_booking,
        guest: updated_guest,
    }))
}
