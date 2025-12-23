//! Room-related models

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use super::booking::BookingWithDetails;

/// Core room entity - Note: This struct is used for manual construction
/// The actual DB columns differ but handlers construct this for API responses
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Room {
    pub id: i64,
    pub room_number: String,
    pub room_type: String,
    pub price_per_night: Decimal,
    pub available: bool,
    pub status: Option<String>,
    pub description: Option<String>,
    pub max_occupancy: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Input for creating a room (simple)
#[derive(Debug, Serialize, Deserialize)]
pub struct RoomInput {
    pub room_number: String,
    pub room_type: String,
    pub price_per_night: f64,
    pub description: Option<String>,
    pub max_occupancy: i32,
}

/// Input for creating a room (full)
#[derive(Debug, Serialize, Deserialize)]
pub struct RoomCreateInput {
    pub room_number: String,
    pub room_type: String,
    pub room_type_id: Option<i64>,
    pub price_per_night: f64,
    pub custom_price: Option<f64>,
    pub description: Option<String>,
    pub max_occupancy: i32,
    pub floor: Option<i32>,
    pub building: Option<String>,
    pub is_accessible: Option<bool>,
    pub status: Option<String>,
}

/// Input for updating a room
#[derive(Debug, Serialize, Deserialize)]
pub struct RoomUpdateInput {
    pub room_number: Option<String>,
    pub room_type: Option<String>,
    pub price_per_night: Option<f64>,
    pub available: Option<bool>,
    pub description: Option<String>,
    pub max_occupancy: Option<i32>,
}

/// Input for updating room status
#[derive(Debug, Serialize, Deserialize)]
pub struct RoomStatusUpdateInput {
    pub status: String,
    pub reason: Option<String>,
    pub notes: Option<String>,
    pub reserved_start_date: Option<String>,
    pub reserved_end_date: Option<String>,
    pub maintenance_start_date: Option<String>,
    pub maintenance_end_date: Option<String>,
    pub cleaning_start_date: Option<String>,
    pub cleaning_end_date: Option<String>,
    pub target_room_id: Option<i64>,
    pub booking_id: Option<i64>,
    pub guest_id: Option<i64>,
    pub reward_id: Option<i64>,
}

/// Room with detailed status information
#[derive(Debug, Serialize, Deserialize)]
pub struct RoomDetailedStatus {
    pub id: i64,
    pub room_number: String,
    pub room_type: String,
    pub status: String,
    pub available: bool,
    pub current_booking: Option<BookingWithDetails>,
    pub next_booking: Option<BookingWithDetails>,
    pub recent_events: Vec<RoomEvent>,
    pub maintenance_notes: Option<String>,
    pub last_maintenance_date: Option<NaiveDate>,
    pub next_maintenance_date: Option<NaiveDate>,
    pub reserved_start_date: Option<DateTime<Utc>>,
    pub reserved_end_date: Option<DateTime<Utc>>,
    pub maintenance_start_date: Option<DateTime<Utc>>,
    pub maintenance_end_date: Option<DateTime<Utc>>,
    pub cleaning_start_date: Option<DateTime<Utc>>,
    pub cleaning_end_date: Option<DateTime<Utc>>,
    pub target_room_id: Option<i64>,
    pub status_notes: Option<String>,
}

/// Room event (maintenance, cleaning, etc.)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RoomEvent {
    pub id: i64,
    pub room_id: i64,
    pub event_type: String,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub notes: Option<String>,
    pub scheduled_date: Option<DateTime<Utc>>,
    pub created_by: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Input for creating a room event
#[derive(Debug, Serialize, Deserialize)]
pub struct RoomEventInput {
    pub event_type: String,
    pub notes: Option<String>,
    pub status: String,
    pub scheduled_date: Option<String>,
    pub priority: Option<String>,
}

/// Room with rating information
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RoomWithRating {
    pub id: i64,
    pub room_number: String,
    pub room_type: String,
    pub price_per_night: Decimal,
    pub available: bool,
    pub status: Option<String>,
    pub description: Option<String>,
    pub max_occupancy: i32,
    pub maintenance_start_date: Option<DateTime<Utc>>,
    pub maintenance_end_date: Option<DateTime<Utc>>,
    pub cleaning_start_date: Option<DateTime<Utc>>,
    pub cleaning_end_date: Option<DateTime<Utc>>,
    pub reserved_start_date: Option<DateTime<Utc>>,
    pub reserved_end_date: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub average_rating: Option<f64>,
    pub review_count: Option<i64>,
}

/// Guest review for a room
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct GuestReview {
    pub id: i64,
    pub guest_id: i64,
    pub guest_name: String,
    pub room_type_id: Option<i64>,
    pub overall_rating: Option<Decimal>,
    pub cleanliness_rating: Option<Decimal>,
    pub staff_rating: Option<Decimal>,
    pub facilities_rating: Option<Decimal>,
    pub value_rating: Option<Decimal>,
    pub location_rating: Option<Decimal>,
    pub title: Option<String>,
    pub review_text: Option<String>,
    pub pros: Option<String>,
    pub cons: Option<String>,
    pub recommend: Option<bool>,
    pub stay_type: Option<String>,
    pub is_verified: bool,
    pub helpful_count: i32,
    pub created_at: DateTime<Utc>,
}

/// Room type configuration
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RoomType {
    pub id: i64,
    pub name: String,
    pub code: String,
    pub description: Option<String>,
    pub base_price: Decimal,
    pub max_occupancy: i32,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Room current occupancy (derived from active bookings - no manual input)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RoomCurrentOccupancy {
    pub room_id: i64,
    pub room_number: String,
    pub room_type_id: Option<i64>,
    pub room_type_name: Option<String>,
    pub max_occupancy: Option<i32>,
    pub room_status: Option<String>,
    pub current_adults: i32,
    pub current_children: i32,
    pub current_infants: i32,
    pub current_total_guests: i32,
    pub occupancy_percentage: Option<Decimal>,
    pub current_booking_id: Option<i64>,
    pub current_booking_number: Option<String>,
    pub current_guest_id: Option<i64>,
    pub check_in_date: Option<NaiveDate>,
    pub check_out_date: Option<NaiveDate>,
    pub is_occupied: bool,
}

/// Hotel-wide occupancy summary (calculated automatically)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct HotelOccupancySummary {
    pub total_rooms: i64,
    pub occupied_rooms: i64,
    pub available_rooms: i64,
    pub occupancy_rate: Option<Decimal>,
    pub total_adults: i64,
    pub total_children: i64,
    pub total_infants: i64,
    pub total_guests: i64,
    pub total_capacity: i64,
    pub guest_occupancy_rate: Option<Decimal>,
}

/// Occupancy by room type
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct OccupancyByRoomType {
    pub room_type_id: Option<i64>,
    pub room_type_name: Option<String>,
    pub capacity_per_room: Option<i32>,
    pub total_rooms: i64,
    pub occupied_rooms: i64,
    pub room_occupancy_rate: Option<Decimal>,
    pub total_guests: i64,
    pub total_capacity: i64,
    pub guest_occupancy_rate: Option<Decimal>,
}

/// Room with occupancy (combined view)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomWithOccupancy {
    #[serde(flatten)]
    pub room: Room,
    pub current_adults: i32,
    pub current_children: i32,
    pub current_infants: i32,
    pub current_total_guests: i32,
    pub is_occupied: bool,
    pub current_booking_id: Option<i64>,
    pub current_guest_id: Option<i64>,
}
