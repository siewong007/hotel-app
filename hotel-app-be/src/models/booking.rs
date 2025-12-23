//! Booking-related models

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use super::guest::GuestUpdateInput;

/// Core booking entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Booking {
    pub id: i64,
    pub booking_number: String,
    pub guest_id: i64,
    pub room_id: i64,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub room_rate: Decimal,
    pub subtotal: Decimal,
    pub tax_amount: Option<Decimal>,
    pub discount_amount: Option<Decimal>,
    pub total_amount: Decimal,
    pub status: String,
    pub payment_status: Option<String>,
    pub adults: Option<i32>,
    pub children: Option<i32>,
    pub special_requests: Option<String>,
    pub remarks: Option<String>,
    pub source: Option<String>,
    pub market_code: Option<String>,
    pub discount_percentage: Option<Decimal>,
    pub rate_override_weekday: Option<Decimal>,
    pub rate_override_weekend: Option<Decimal>,
    pub pre_checkin_completed: Option<bool>,
    pub pre_checkin_completed_at: Option<DateTime<Utc>>,
    pub pre_checkin_token: Option<String>,
    pub pre_checkin_token_expires_at: Option<DateTime<Utc>>,
    pub created_by: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Input for creating a booking
#[derive(Debug, Serialize, Deserialize)]
pub struct BookingInput {
    pub guest_id: i64,
    pub room_id: i64,
    pub check_in_date: String,
    pub check_out_date: String,
    pub post_type: Option<String>,
    pub rate_code: Option<String>,
    pub booking_remarks: Option<String>,
    pub is_tourist: Option<bool>,
    pub tourism_tax_amount: Option<f64>,
    pub extra_bed_count: Option<i32>,
    pub extra_bed_charge: Option<f64>,
    pub room_card_deposit: Option<f64>,
    pub late_checkout_penalty: Option<f64>,
    pub payment_method: Option<String>,
}

/// Input for updating a booking
#[derive(Debug, Serialize, Deserialize)]
pub struct BookingUpdateInput {
    pub room_id: Option<String>,
    pub check_in_date: Option<String>,
    pub check_out_date: Option<String>,
    pub total_amount: Option<f64>,
    pub status: Option<String>,
    pub post_type: Option<String>,
    pub rate_code: Option<String>,
    pub is_tourist: Option<bool>,
    pub tourism_tax_amount: Option<f64>,
    pub extra_bed_count: Option<i32>,
    pub extra_bed_charge: Option<f64>,
    pub room_card_deposit: Option<f64>,
    pub late_checkout_penalty: Option<f64>,
    pub payment_method: Option<String>,
    pub market_code: Option<String>,
    pub discount_percentage: Option<f64>,
    pub rate_override_weekday: Option<f64>,
    pub rate_override_weekend: Option<f64>,
    pub check_in_time: Option<String>,
    pub check_out_time: Option<String>,
}

/// Request for checking in a guest
#[derive(Debug, Serialize, Deserialize)]
pub struct CheckInRequest {
    pub guest_update: Option<GuestUpdateInput>,
    pub booking_update: Option<BookingUpdateInput>,
}

/// Request for pre-check-in update
#[derive(Debug, Serialize, Deserialize)]
pub struct PreCheckInUpdateRequest {
    pub guest_update: GuestUpdateInput,
    pub market_code: Option<String>,
    pub special_requests: Option<String>,
}

/// Booking with related details (guest, room info)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct BookingWithDetails {
    pub id: i64,
    pub booking_number: String,
    pub guest_id: i64,
    pub guest_name: String,
    pub guest_email: Option<String>,
    pub room_id: i64,
    pub room_number: String,
    pub room_type: String,
    pub room_type_code: Option<String>,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub total_amount: Decimal,
    pub status: String,
    pub payment_status: Option<String>,
    pub source: Option<String>,
    pub created_at: DateTime<Utc>,
}
