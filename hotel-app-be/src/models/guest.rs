//! Guest-related models

use crate::constants::{GuestType, TourismType};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Core guest entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Guest {
    pub id: i64,
    pub full_name: String,
    pub email: Option<String>,
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
    pub guest_type: GuestType,
    pub tourism_type: Option<TourismType>,
    pub discount_percentage: i32,
    pub company_name: Option<String>,
    pub complimentary_nights_credit: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Aggregate counters populated by the list endpoint (subqueries against
    /// the bookings table). These stay `None` for endpoints that don't compute
    /// them so we don't pay the cost on every per-guest fetch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bookings_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_stay_date: Option<chrono::NaiveDate>,
}

/// Authoritative metrics for the Guest 360 profile view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestSummary {
    pub completed_stays: i64,
    pub total_nights: i64,
    pub total_room_revenue: Decimal,
    pub last_stay_at: Option<NaiveDate>,
    pub next_stay_at: Option<NaiveDate>,
    pub outstanding_balance: Decimal,
    pub total_bookings: i64,
    pub active_booking_id: Option<i64>,
    pub active_booking_number: Option<String>,
}

/// Reservation row shown on the Guest 360 profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestProfileBooking {
    pub id: i64,
    pub booking_number: Option<String>,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub nights: i64,
    pub status: String,
    pub payment_status: Option<String>,
    pub total_amount: Decimal,
    pub total_paid: Decimal,
    pub balance_due: Decimal,
    pub created_at: DateTime<Utc>,
    pub room_number: String,
    pub room_type: String,
    pub special_requests: Option<String>,
    pub source: Option<String>,
}

/// Candidate duplicate profile with transparent scoring reasons.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestDuplicateCandidate {
    pub guest: Guest,
    pub score: i32,
    pub match_reasons: Vec<String>,
    pub blocking_reasons: Vec<String>,
    pub recommended_action: String,
}

/// Guest 360 profile response assembled from source-of-truth records.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestProfile {
    pub guest: Guest,
    pub summary: GuestSummary,
    pub reservations: Vec<GuestProfileBooking>,
    pub duplicate_candidates: Vec<GuestDuplicateCandidate>,
}

/// Input for creating a guest
#[derive(Debug, Serialize, Deserialize)]
pub struct GuestInput {
    pub first_name: String,
    pub last_name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub ic_number: Option<String>,
    pub nationality: Option<String>,
    pub address_line1: Option<String>,
    pub city: Option<String>,
    pub state_province: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub guest_type: Option<GuestType>,
    pub tourism_type: Option<TourismType>,
    pub discount_percentage: Option<i32>,
    pub company_name: Option<String>,
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
    pub guest_type: Option<GuestType>,
    pub tourism_type: Option<TourismType>,
    pub discount_percentage: Option<i32>,
    pub company_name: Option<String>,
}

/// Existing values needed to resolve partial guest updates.
#[derive(Debug, sqlx::FromRow)]
pub struct GuestUpdateState {
    pub first_name: String,
    pub last_name: String,
    pub email: Option<String>,
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
    pub company_name: Option<String>,
    pub guest_type: GuestType,
    pub tourism_type: Option<TourismType>,
    pub discount_percentage: i32,
}

/// Fully resolved guest update values.
#[derive(Debug)]
pub struct GuestUpdateValues {
    pub full_name: String,
    pub first_name: String,
    pub last_name: String,
    pub email: Option<String>,
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
    pub guest_type: GuestType,
    pub tourism_type: Option<TourismType>,
    pub discount_percentage: i32,
    pub company_name: Option<String>,
}

/// Guest booking row for the guest detail endpoint.
#[derive(Debug)]
pub struct GuestBookingRow {
    pub id: i64,
    pub booking_number: Option<String>,
    pub check_in_date: chrono::NaiveDate,
    pub check_out_date: chrono::NaiveDate,
    pub nights: Option<i32>,
    pub status: String,
    pub total_amount: Decimal,
    pub created_at: DateTime<Utc>,
    pub room_number: String,
    pub room_type: String,
}

/// Complimentary credit row joined to room type details.
#[derive(Debug, sqlx::FromRow)]
pub struct GuestCreditRow {
    pub id: i32,
    pub guest_id: i64,
    pub room_type_id: i64,
    pub room_type_name: String,
    pub room_type_code: String,
    pub nights_available: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Linked guest row with legacy credit total.
#[derive(Debug, sqlx::FromRow)]
pub struct LinkedGuestCreditRow {
    pub id: i64,
    pub full_name: String,
    pub email: Option<String>,
    pub legacy_credits: i32,
}

/// Room-type credit row for linked guest summaries.
#[derive(Debug, sqlx::FromRow)]
pub struct GuestRoomCreditRow {
    pub room_type_id: i64,
    pub room_type_name: String,
    pub room_type_code: String,
    pub nights_available: i32,
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

/// Pagination parameters for guest listing.
#[derive(Debug, Deserialize)]
pub struct GuestPaginationParams {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    /// Search by guest ID, name, email, phone, IC/passport number, or company.
    pub search: Option<String>,
    /// Filter by guest type: "member" or "non_member".
    pub guest_type: Option<String>,
}

/// Paginated guest list response.
#[derive(Debug, Serialize)]
pub struct GuestPaginatedResponse {
    pub data: Vec<Guest>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for GuestBookingRow {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(GuestBookingRow {
            id: row.try_get("id")?,
            booking_number: row.try_get("booking_number")?,
            check_in_date: row.try_get("check_in_date")?,
            check_out_date: row.try_get("check_out_date")?,
            nights: row.try_get("nights")?,
            status: row.try_get("status")?,
            total_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val =
                    crate::core::db::parse_decimal(&row.try_get::<String, _>("total_amount")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("total_amount")?;
                val
            },
            created_at: row.try_get("created_at")?,
            room_number: row.try_get("room_number")?,
            room_type: row.try_get("room_type")?,
        })
    }
}
