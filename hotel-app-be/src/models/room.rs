//! Room-related models

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use super::booking::BookingWithDetails;

/// Core room entity - Note: This struct is used for manual construction
/// The actual DB columns differ but handlers construct this for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub notes: Option<String>,

    pub is_smoking: Option<bool>,
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
    pub is_smoking: Option<bool>,
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
    pub notes: Option<String>,
    pub is_smoking: Option<bool>,
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
    pub last_maintenance_date: Option<DateTime<Utc>>,
    pub next_maintenance_date: Option<DateTime<Utc>>,
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub notes: Option<String>,

    pub is_smoking: Option<bool>,
}

/// Guest review for a room
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomType {
    pub id: i64,
    pub name: String,
    pub code: String,
    pub description: Option<String>,
    pub base_price: Decimal,
    pub weekday_rate: Option<Decimal>,
    pub weekend_rate: Option<Decimal>,
    pub max_occupancy: i32,
    pub bed_type: Option<String>,
    pub bed_count: Option<i32>,
    pub allows_extra_bed: bool,
    pub max_extra_beds: i32,
    pub extra_bed_charge: Decimal,
    pub is_active: bool,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Input for creating a room type
#[derive(Debug, Serialize, Deserialize)]
pub struct RoomTypeCreateInput {
    pub name: String,
    pub code: String,
    pub description: Option<String>,
    pub base_price: f64,
    pub weekday_rate: Option<f64>,
    pub weekend_rate: Option<f64>,
    pub max_occupancy: Option<i32>,
    pub bed_type: Option<String>,
    pub bed_count: Option<i32>,
    pub allows_extra_bed: Option<bool>,
    pub max_extra_beds: Option<i32>,
    pub extra_bed_charge: Option<f64>,
    pub sort_order: Option<i32>,
}

/// Input for updating a room type
#[derive(Debug, Serialize, Deserialize)]
pub struct RoomTypeUpdateInput {
    pub name: Option<String>,
    pub code: Option<String>,
    pub description: Option<String>,
    pub base_price: Option<f64>,
    pub weekday_rate: Option<f64>,
    pub weekend_rate: Option<f64>,
    pub max_occupancy: Option<i32>,
    pub bed_type: Option<String>,
    pub bed_count: Option<i32>,
    pub allows_extra_bed: Option<bool>,
    pub max_extra_beds: Option<i32>,
    pub extra_bed_charge: Option<f64>,
    pub is_active: Option<bool>,
    pub sort_order: Option<i32>,
}

/// Room current occupancy (derived from active bookings - no manual input)
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for Room {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Room {
            id: row.try_get("id")?,
            room_number: row.try_get("room_number")?,
            room_type: row.try_get("room_type")?,
            price_per_night: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val =
                    crate::core::db::parse_decimal(&row.try_get::<String, _>("price_per_night")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("price_per_night")?;
                val
            },
            available: row.try_get("available")?,
            status: row.try_get("status")?,
            description: row.try_get("description")?,
            max_occupancy: row.try_get("max_occupancy")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            notes: row.try_get("notes")?,
            is_smoking: row.try_get("is_smoking")?,
        })
    }
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for RoomWithRating {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(RoomWithRating {
            id: row.try_get("id")?,
            room_number: row.try_get("room_number")?,
            room_type: row.try_get("room_type")?,
            price_per_night: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val =
                    crate::core::db::parse_decimal(&row.try_get::<String, _>("price_per_night")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("price_per_night")?;
                val
            },
            available: row.try_get("available")?,
            status: row.try_get("status")?,
            description: row.try_get("description")?,
            max_occupancy: row.try_get("max_occupancy")?,
            maintenance_start_date: row.try_get("maintenance_start_date")?,
            maintenance_end_date: row.try_get("maintenance_end_date")?,
            cleaning_start_date: row.try_get("cleaning_start_date")?,
            cleaning_end_date: row.try_get("cleaning_end_date")?,
            reserved_start_date: row.try_get("reserved_start_date")?,
            reserved_end_date: row.try_get("reserved_end_date")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            average_rating: row.try_get("average_rating")?,
            review_count: row.try_get("review_count")?,
            notes: row.try_get("notes")?,
            is_smoking: row.try_get("is_smoking")?,
        })
    }
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for GuestReview {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(GuestReview {
            id: row.try_get("id")?,
            guest_id: row.try_get("guest_id")?,
            guest_name: row.try_get("guest_name")?,
            room_type_id: row.try_get("room_type_id")?,
            overall_rating: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("overall_rating")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("overall_rating")?;
                val
            },
            cleanliness_rating: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("cleanliness_rating")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("cleanliness_rating")?;
                val
            },
            staff_rating: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("staff_rating")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("staff_rating")?;
                val
            },
            facilities_rating: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("facilities_rating")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("facilities_rating")?;
                val
            },
            value_rating: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("value_rating")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("value_rating")?;
                val
            },
            location_rating: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("location_rating")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("location_rating")?;
                val
            },
            title: row.try_get("title")?,
            review_text: row.try_get("review_text")?,
            pros: row.try_get("pros")?,
            cons: row.try_get("cons")?,
            recommend: row.try_get("recommend")?,
            stay_type: row.try_get("stay_type")?,
            is_verified: row.try_get("is_verified")?,
            helpful_count: row.try_get("helpful_count")?,
            created_at: row.try_get("created_at")?,
        })
    }
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for RoomType {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(RoomType {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            code: row.try_get("code")?,
            description: row.try_get("description")?,
            base_price: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("base_price")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("base_price")?;
                val
            },
            weekday_rate: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("weekday_rate")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("weekday_rate")?;
                val
            },
            weekend_rate: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("weekend_rate")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("weekend_rate")?;
                val
            },
            max_occupancy: row.try_get("max_occupancy")?,
            bed_type: row.try_get("bed_type")?,
            bed_count: row.try_get("bed_count")?,
            allows_extra_bed: row.try_get("allows_extra_bed")?,
            max_extra_beds: row.try_get("max_extra_beds")?,
            extra_bed_charge: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val =
                    crate::core::db::parse_decimal(&row.try_get::<String, _>("extra_bed_charge")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("extra_bed_charge")?;
                val
            },
            is_active: row.try_get("is_active")?,
            sort_order: row.try_get("sort_order")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for RoomCurrentOccupancy {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(RoomCurrentOccupancy {
            room_id: row.try_get("room_id")?,
            room_number: row.try_get("room_number")?,
            room_type_id: row.try_get("room_type_id")?,
            room_type_name: row.try_get("room_type_name")?,
            max_occupancy: row.try_get("max_occupancy")?,
            room_status: row.try_get("room_status")?,
            current_adults: row.try_get("current_adults")?,
            current_children: row.try_get("current_children")?,
            current_infants: row.try_get("current_infants")?,
            current_total_guests: row.try_get("current_total_guests")?,
            occupancy_percentage: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("occupancy_percentage")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("occupancy_percentage")?;
                val
            },
            current_booking_id: row.try_get("current_booking_id")?,
            current_booking_number: row.try_get("current_booking_number")?,
            current_guest_id: row.try_get("current_guest_id")?,
            check_in_date: row.try_get("check_in_date")?,
            check_out_date: row.try_get("check_out_date")?,
            is_occupied: row.try_get("is_occupied")?,
        })
    }
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for HotelOccupancySummary {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(HotelOccupancySummary {
            total_rooms: row.try_get("total_rooms")?,
            occupied_rooms: row.try_get("occupied_rooms")?,
            available_rooms: row.try_get("available_rooms")?,
            occupancy_rate: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("occupancy_rate")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("occupancy_rate")?;
                val
            },
            total_adults: row.try_get("total_adults")?,
            total_children: row.try_get("total_children")?,
            total_infants: row.try_get("total_infants")?,
            total_guests: row.try_get("total_guests")?,
            total_capacity: row.try_get("total_capacity")?,
            guest_occupancy_rate: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("guest_occupancy_rate")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("guest_occupancy_rate")?;
                val
            },
        })
    }
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for OccupancyByRoomType {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(OccupancyByRoomType {
            room_type_id: row.try_get("room_type_id")?,
            room_type_name: row.try_get("room_type_name")?,
            capacity_per_room: row.try_get("capacity_per_room")?,
            total_rooms: row.try_get("total_rooms")?,
            occupied_rooms: row.try_get("occupied_rooms")?,
            room_occupancy_rate: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("room_occupancy_rate")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("room_occupancy_rate")?;
                val
            },
            total_guests: row.try_get("total_guests")?,
            total_capacity: row.try_get("total_capacity")?,
            guest_occupancy_rate: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("guest_occupancy_rate")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("guest_occupancy_rate")?;
                val
            },
        })
    }
}
