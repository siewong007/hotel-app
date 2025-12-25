//! Guest-related models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Core guest entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Guest {
    pub id: i64,
    pub full_name: String,
    pub email: String,
    pub phone: Option<String>,
    pub ic_number: Option<String>,
    pub nationality: Option<String>,
    pub address_line1: Option<String>,
    pub city: Option<String>,
    pub state_province: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub title: Option<String>,
    pub alt_phone: Option<String>,
    pub is_active: bool,
    pub complimentary_nights_credit: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Input for creating a guest
#[derive(Debug, Serialize, Deserialize)]
pub struct GuestInput {
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub phone: Option<String>,
    pub ic_number: Option<String>,
    pub nationality: Option<String>,
    pub address_line1: Option<String>,
    pub city: Option<String>,
    pub state_province: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
}

/// Input for updating a guest
#[derive(Debug, Serialize, Deserialize)]
pub struct GuestUpdateInput {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub title: Option<String>,
    pub alt_phone: Option<String>,
    pub ic_number: Option<String>,
    pub nationality: Option<String>,
    pub address_line1: Option<String>,
    pub city: Option<String>,
    pub state_province: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub is_active: Option<bool>,
}

/// Input for linking a guest to a user
#[derive(Debug, Serialize, Deserialize)]
pub struct LinkGuestInput {
    pub guest_id: i64,
    pub relationship_type: Option<String>,
    pub can_book_for: Option<bool>,
    pub can_view_bookings: Option<bool>,
    pub can_modify: Option<bool>,
    pub notes: Option<String>,
}

/// Input for upgrading a guest to a user
#[derive(Debug, Serialize, Deserialize)]
pub struct UpgradeGuestInput {
    pub guest_id: i64,
    pub username: String,
    pub password: String,
    pub role: Option<String>,
}

/// User-Guest relationship
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct UserGuestLink {
    pub user_id: i64,
    pub guest_id: i64,
    pub relationship_type: String,
    pub can_book_for: bool,
    pub can_view_bookings: bool,
    pub can_modify: bool,
}

/// Guest complimentary credits by room type
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct GuestComplimentaryCredit {
    pub id: i64,
    pub guest_id: i64,
    pub room_type_id: i64,
    pub room_type_name: String,
    pub room_type_code: String,
    pub nights_available: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Summary of guest complimentary credits
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestCreditsSummary {
    pub guest_id: i64,
    pub guest_name: String,
    pub total_nights: i32,
    pub credits_by_room_type: Vec<GuestComplimentaryCredit>,
}
