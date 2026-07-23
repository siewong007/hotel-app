use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct BookingSearchQuery {
    pub check_in_date: String,
    pub check_out_date: String,
    pub adults: Option<i32>,
    pub children: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OnlineInventoryQuery {
    pub stay_date: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateOnlineInventoryRequest {
    pub walk_in_reserved_rooms: i32,
    pub online_booking_enabled: bool,
    pub custom_price: Option<Decimal>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OnlineInventoryAllocation {
    pub room_type_id: i64,
    pub room_type_code: String,
    pub room_type_name: String,
    pub stay_date: NaiveDate,
    pub physical_available_rooms: i64,
    pub walk_in_reserved_rooms: i32,
    pub online_booking_enabled: bool,
    pub custom_price: Option<Decimal>,
    pub online_available_rooms: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BookingQuoteRequest {
    pub room_type_id: i64,
    pub check_in_date: String,
    pub check_out_date: String,
    pub adults: Option<i32>,
    pub children: Option<i32>,
    pub voucher_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateGuestBookingRequest {
    pub client_request_id: String,
    pub room_type_id: i64,
    pub check_in_date: String,
    pub check_out_date: String,
    pub adults: Option<i32>,
    pub children: Option<i32>,
    pub voucher_id: Option<i64>,
    pub expected_total: Decimal,
    pub special_requests: Option<String>,
    pub cleaning_preference: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightlyRate {
    pub date: NaiveDate,
    pub rate_plan_code: String,
    pub amount: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestBookingOffer {
    pub room_type_id: i64,
    pub room_type_code: String,
    pub room_type_name: String,
    pub description: Option<String>,
    pub max_occupancy: i32,
    pub bed_type: Option<String>,
    pub bed_count: Option<i32>,
    pub images: Vec<String>,
    pub features: Vec<String>,
    pub available_rooms: i64,
    pub currency: String,
    pub nightly_rates: Vec<NightlyRate>,
    pub subtotal: Decimal,
    pub discount_amount: Decimal,
    pub tax_amount: Decimal,
    pub total_amount: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestBookingQuote {
    pub room_type_id: i64,
    pub room_type_code: String,
    pub room_type_name: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub adults: i32,
    pub children: i32,
    pub currency: String,
    pub nightly_rates: Vec<NightlyRate>,
    pub subtotal: Decimal,
    pub discount_amount: Decimal,
    pub tax_amount: Decimal,
    pub total_amount: Decimal,
    pub voucher_id: Option<i64>,
    pub voucher_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestBookingVoucherOptions {
    pub quote: GuestBookingQuote,
    pub eligible_voucher_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestBookingConfirmation {
    pub booking_id: i64,
    pub booking_number: String,
    pub room_type_name: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub status: String,
    pub payment_status: String,
    pub currency: String,
    pub subtotal: Decimal,
    pub discount_amount: Decimal,
    pub tax_amount: Decimal,
    pub total_amount: Decimal,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct RoomTypeInventory {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub base_price: Decimal,
    pub weekday_rate: Option<Decimal>,
    pub weekend_rate: Option<Decimal>,
    pub max_occupancy: i32,
    pub bed_type: Option<String>,
    pub bed_count: Option<i32>,
    pub images: Vec<String>,
    pub features: Vec<String>,
    pub available_rooms: i64,
}

#[derive(Debug, Clone)]
pub struct VoucherPricing {
    pub voucher_id: i64,
    pub promotion_id: i64,
    pub promotion_name: String,
    pub discount_type: String,
    pub discount_value: Decimal,
    pub max_discount_amount: Option<Decimal>,
}

#[derive(Debug, Clone)]
pub struct GuestContact {
    pub actor_user_id: Option<i64>,
    pub full_name: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone)]
pub struct BookingInsert {
    pub portal_request_id: String,
    pub guest_id: i64,
    pub actor_user_id: Option<i64>,
    pub room_id: i64,
    pub booking_number: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub adults: i32,
    pub children: i32,
    pub room_rate: Decimal,
    pub subtotal: Decimal,
    pub discount_amount: Decimal,
    pub total_amount: Decimal,
    pub currency: String,
    pub special_requests: Option<String>,
    pub cleaning_preference: Option<bool>,
    pub booking_channel_id: Option<i64>,
    pub nightly_rates: serde_json::Value,
}
