//! Booking-related models

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use super::guest::GuestUpdateInput;

/// Pagination and filter query parameters for bookings.
#[derive(Debug, Deserialize)]
pub struct BookingPaginationParams {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    /// General text search: guest name, booking fields, invoices, and linked ledger fields.
    pub search: Option<String>,
    /// Filter by exact booking status. Pass "all" to include every status (including voided).
    pub status: Option<String>,
    /// Filter by room number (partial match).
    pub room_number: Option<String>,
    /// Only return bookings billed to a company.
    pub company_billed: Option<bool>,
    /// Only bookings whose check-in date matches this date.
    pub date_search: Option<NaiveDate>,
    /// Bookings with check-in >= this date.
    pub check_in_from: Option<NaiveDate>,
    /// Bookings with check-in <= this date.
    pub check_in_to: Option<NaiveDate>,
    /// Column to sort by.
    pub sort_by: Option<String>,
    /// Sort direction: asc | desc.
    pub sort_order: Option<String>,
}

/// Lightweight booking statistics.
#[derive(Debug, Serialize)]
pub struct BookingStats {
    pub total: i64,
    pub checked_in: i64,
    pub confirmed: i64,
    pub today_check_ins: i64,
    pub today_check_outs: i64,
    pub pending: i64,
    pub active: i64,
    pub total_revenue: f64,
    pub revenue_last_7_days: Vec<BookingRevenuePoint>,
}

#[derive(Debug, Serialize)]
pub struct BookingRevenuePoint {
    pub date: NaiveDate,
    pub revenue: f64,
}

/// Paginated response wrapper.
#[derive(Debug, Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: T,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

/// Core booking entity
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub payment_method: Option<String>,
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
    pub is_complimentary: Option<bool>,
    pub complimentary_reason: Option<String>,
    pub complimentary_start_date: Option<NaiveDate>,
    pub complimentary_end_date: Option<NaiveDate>,
    pub original_total_amount: Option<Decimal>,
    pub complimentary_nights: Option<i32>,
    pub deposit_paid: Option<bool>,
    pub deposit_amount: Option<Decimal>,
    pub deposit_paid_at: Option<DateTime<Utc>>,
    pub company_id: Option<i64>,
    pub company_name: Option<String>,
    pub payment_note: Option<String>,
    pub daily_rates: Option<serde_json::Value>,

    pub cleaning_preference: Option<bool>,
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
    pub late_checkout_penalty: Option<f64>,
    pub payment_method: Option<String>,
    pub payment_status: Option<String>, // unpaid, unpaid_deposit, paid
    pub amount_paid: Option<f64>,
    pub source: Option<String>,         // walk_in, online, phone, agent
    pub booking_number: Option<String>, // Optional - if provided, use this instead of auto-generating
    pub deposit_paid: Option<bool>,
    pub deposit_amount: Option<f64>,
    pub room_rate_override: Option<f64>,
    pub special_requests: Option<String>,
    pub daily_rates: Option<serde_json::Value>,
    pub cleaning_preference: Option<bool>,
    /// Company / city-ledger billing, attached at booking time (e.g. inline from
    /// the check-in advisory in the walk-in flow).
    pub company_id: Option<i64>,
    pub company_name: Option<String>,
}

/// Input for cancelling a booking
#[derive(Debug, Serialize, Deserialize)]
pub struct BookingCancellationRequest {
    pub booking_id: i64,
    pub reason: Option<String>,
}

/// Input for updating a booking
#[derive(Debug, Serialize, Deserialize)]
pub struct BookingUpdateInput {
    pub room_id: Option<String>,
    pub check_in_date: Option<String>,
    pub check_out_date: Option<String>,
    pub total_amount: Option<f64>,
    pub status: Option<String>,
    pub payment_status: Option<String>,
    pub post_type: Option<String>,
    pub rate_code: Option<String>,
    pub is_tourist: Option<bool>,
    pub tourism_tax_amount: Option<f64>,
    pub extra_bed_count: Option<i32>,
    pub extra_bed_charge: Option<f64>,
    pub late_checkout_penalty: Option<f64>,
    pub payment_method: Option<String>,
    pub market_code: Option<String>,
    pub discount_percentage: Option<f64>,
    pub rate_override_weekday: Option<f64>,
    pub rate_override_weekend: Option<f64>,
    pub check_in_time: Option<String>,
    pub check_out_time: Option<String>,
    pub deposit_paid: Option<bool>,
    pub deposit_amount: Option<f64>,
    pub company_id: Option<i64>,
    pub company_name: Option<String>,
    pub payment_note: Option<String>,
    pub remarks: Option<String>,
    pub special_requests: Option<String>,
    pub source: Option<String>,
    pub room_rate_override: Option<f64>,
    pub daily_rates: Option<serde_json::Value>,
    pub cleaning_preference: Option<bool>,
}

/// Payment to record during check-in
#[derive(Debug, Serialize, Deserialize)]
pub struct CheckInPaymentRecord {
    pub amount: f64,
    pub payment_method: String,
    pub payment_type: Option<String>,
    pub notes: Option<String>,
}

/// Request for checking in a guest
#[derive(Debug, Serialize, Deserialize)]
pub struct CheckInRequest {
    pub guest_update: Option<GuestUpdateInput>,
    pub booking_update: Option<BookingUpdateInput>,
    pub payment_record: Option<CheckInPaymentRecord>,
}

/// Request for pre-check-in update
#[derive(Debug, Serialize, Deserialize)]
pub struct PreCheckInUpdateRequest {
    pub guest_update: GuestUpdateInput,
    pub market_code: Option<String>,
    pub special_requests: Option<String>,
}

/// Request for marking a booking as complimentary (with date range)
#[derive(Debug, Serialize, Deserialize)]
pub struct MarkComplimentaryRequest {
    pub reason: Option<String>,
    pub complimentary_start_date: Option<String>, // YYYY-MM-DD format
    pub complimentary_end_date: Option<String>,   // YYYY-MM-DD format
}

/// Request for booking with complimentary credits.
#[derive(Debug, Deserialize)]
pub struct BookWithCreditsRequest {
    pub guest_id: i64,
    pub room_id: i64,
    pub check_in_date: String,
    pub check_out_date: String,
    pub adults: Option<i32>,
    pub children: Option<i32>,
    pub special_requests: Option<String>,
    /// Specific dates to mark as complimentary (YYYY-MM-DD format).
    pub complimentary_dates: Vec<String>,
}

/// Request for updating complimentary dates.
#[derive(Debug, Deserialize)]
pub struct UpdateComplimentaryRequest {
    pub complimentary_start_date: Option<String>,
    pub complimentary_end_date: Option<String>,
    pub complimentary_reason: Option<String>,
}

/// Request to add credits to a guest.
#[derive(Debug, Deserialize)]
pub struct AddGuestCreditsRequest {
    pub guest_id: i64,
    pub room_type_id: i64,
    pub nights: i32,
    pub notes: Option<String>,
}

/// Request to update guest credits.
#[derive(Debug, Deserialize)]
pub struct UpdateGuestCreditsRequest {
    pub nights_available: Option<i32>,
    pub notes: Option<String>,
}

/// Booking with related details (guest, room info)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookingWithDetails {
    pub id: i64,
    pub booking_number: String,
    pub folio_number: Option<String>,
    pub guest_id: i64,
    pub guest_name: String,
    pub guest_email: Option<String>,
    pub guest_type: Option<String>,
    pub guest_tourism_type: Option<String>,
    pub room_id: i64,
    pub room_number: String,
    pub room_type: String,
    pub room_type_code: Option<String>,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    #[serde(rename = "price_per_night")]
    pub room_rate: Decimal,
    pub total_amount: Decimal,
    pub status: String,
    pub payment_status: Option<String>,
    pub payment_method: Option<String>,
    pub source: Option<String>,
    pub remarks: Option<String>,
    pub special_requests: Option<String>,
    pub is_complimentary: Option<bool>,
    pub complimentary_reason: Option<String>,
    pub complimentary_start_date: Option<NaiveDate>,
    pub complimentary_end_date: Option<NaiveDate>,
    pub original_total_amount: Option<Decimal>,
    pub complimentary_nights: Option<i32>,
    pub deposit_paid: Option<bool>,
    pub deposit_amount: Option<Decimal>,
    pub room_card_deposit: Option<Decimal>,
    pub total_paid: Option<Decimal>,
    pub total_refunded: Option<Decimal>,
    pub balance_due: Option<Decimal>,
    pub deposit_refunded: Option<bool>,
    pub company_id: Option<i64>,
    pub company_name: Option<String>,
    pub payment_note: Option<String>,
    pub created_at: DateTime<Utc>,
    // Night audit posting fields
    pub is_posted: Option<bool>,
    pub posted_date: Option<NaiveDate>,
    // Tourist and extra charges
    pub is_tourist: Option<bool>,
    pub tourism_tax_amount: Option<Decimal>,
    pub extra_bed_count: Option<i32>,
    pub extra_bed_charge: Option<Decimal>,
    // Rate override fields
    pub rate_override_weekday: Option<Decimal>,
    pub rate_override_weekend: Option<Decimal>,
    // Actual checkout timestamp (for early checkout detection)
    pub actual_check_out: Option<DateTime<Utc>>,
    // Per-day rate overrides
    pub daily_rates: Option<serde_json::Value>,
    // Joined from invoices table (set after checkout)
    pub invoice_number: Option<String>,
    // Per-booking daily-cleaning preference (NULL = not set)
    pub cleaning_preference: Option<bool>,
}

/// Timeline event for a booking workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookingTimelineEntry {
    pub id: String,
    pub source: String,
    pub event_type: String,
    pub title: String,
    pub description: Option<String>,
    pub status_from: Option<String>,
    pub status_to: Option<String>,
    pub amount: Option<String>,
    pub actor_id: Option<i64>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for Booking {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Booking {
            id: row.try_get("id")?,
            booking_number: row.try_get("booking_number")?,
            guest_id: row.try_get("guest_id")?,
            room_id: row.try_get("room_id")?,
            check_in_date: row.try_get("check_in_date")?,
            check_out_date: row.try_get("check_out_date")?,
            room_rate: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("room_rate")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("room_rate")?;
                val
            },
            subtotal: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("subtotal")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("subtotal")?;
                val
            },
            tax_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("tax_amount")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("tax_amount")?;
                val
            },
            discount_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("discount_amount")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("discount_amount")?;
                val
            },
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
            status: row.try_get("status")?,
            payment_status: row.try_get("payment_status")?,
            payment_method: row.try_get("payment_method")?,
            adults: row.try_get("adults")?,
            children: row.try_get("children")?,
            special_requests: row.try_get("special_requests")?,
            remarks: row.try_get("remarks")?,
            source: row.try_get("source")?,
            market_code: row.try_get("market_code")?,
            discount_percentage: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("discount_percentage")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("discount_percentage")?;
                val
            },
            rate_override_weekday: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("rate_override_weekday")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("rate_override_weekday")?;
                val
            },
            rate_override_weekend: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("rate_override_weekend")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("rate_override_weekend")?;
                val
            },
            pre_checkin_completed: row.try_get("pre_checkin_completed")?,
            pre_checkin_completed_at: row.try_get("pre_checkin_completed_at")?,
            pre_checkin_token: row.try_get("pre_checkin_token")?,
            pre_checkin_token_expires_at: row.try_get("pre_checkin_token_expires_at")?,
            created_by: row.try_get("created_by")?,
            is_complimentary: row.try_get("is_complimentary")?,
            complimentary_reason: row.try_get("complimentary_reason")?,
            complimentary_start_date: row.try_get("complimentary_start_date")?,
            complimentary_end_date: row.try_get("complimentary_end_date")?,
            original_total_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("original_total_amount")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("original_total_amount")?;
                val
            },
            complimentary_nights: row.try_get("complimentary_nights")?,
            deposit_paid: row.try_get("deposit_paid")?,
            deposit_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("deposit_amount")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("deposit_amount")?;
                val
            },
            deposit_paid_at: row.try_get("deposit_paid_at")?,
            company_id: row.try_get("company_id")?,
            company_name: row.try_get("company_name")?,
            payment_note: row.try_get("payment_note")?,
            daily_rates: row.try_get("daily_rates")?,
            cleaning_preference: row.try_get("cleaning_preference")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for BookingWithDetails {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(BookingWithDetails {
            id: row.try_get("id")?,
            booking_number: row.try_get("booking_number")?,
            folio_number: row.try_get("folio_number")?,
            guest_id: row.try_get("guest_id")?,
            guest_name: row.try_get("guest_name")?,
            guest_email: row.try_get("guest_email")?,
            guest_type: row.try_get("guest_type")?,
            guest_tourism_type: row.try_get("guest_tourism_type")?,
            room_id: row.try_get("room_id")?,
            room_number: row.try_get("room_number")?,
            room_type: row.try_get("room_type")?,
            room_type_code: row.try_get("room_type_code")?,
            check_in_date: row.try_get("check_in_date")?,
            check_out_date: row.try_get("check_out_date")?,
            room_rate: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("room_rate")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("room_rate")?;
                val
            },
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
            status: row.try_get("status")?,
            payment_status: row.try_get("payment_status")?,
            payment_method: row.try_get("payment_method")?,
            source: row.try_get("source")?,
            remarks: row.try_get("remarks")?,
            special_requests: row.try_get("special_requests")?,
            is_complimentary: row.try_get("is_complimentary")?,
            complimentary_reason: row.try_get("complimentary_reason")?,
            complimentary_start_date: row.try_get("complimentary_start_date")?,
            complimentary_end_date: row.try_get("complimentary_end_date")?,
            original_total_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("original_total_amount")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("original_total_amount")?;
                val
            },
            complimentary_nights: row.try_get("complimentary_nights")?,
            deposit_paid: row.try_get("deposit_paid")?,
            deposit_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("deposit_amount")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("deposit_amount")?;
                val
            },
            room_card_deposit: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("room_card_deposit")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("room_card_deposit")?;
                val
            },
            total_paid: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("total_paid")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("total_paid")?;
                val
            },
            total_refunded: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("total_refunded")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("total_refunded")?;
                val
            },
            balance_due: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("balance_due")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("balance_due")?;
                val
            },
            deposit_refunded: row.try_get("deposit_refunded")?,
            company_id: row.try_get("company_id")?,
            company_name: row.try_get("company_name")?,
            payment_note: row.try_get("payment_note")?,
            created_at: row.try_get("created_at")?,
            is_posted: row.try_get("is_posted")?,
            posted_date: row.try_get("posted_date")?,
            is_tourist: row.try_get("is_tourist")?,
            tourism_tax_amount: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("tourism_tax_amount")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("tourism_tax_amount")?;
                val
            },
            extra_bed_count: row.try_get("extra_bed_count")?,
            extra_bed_charge: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("extra_bed_charge")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("extra_bed_charge")?;
                val
            },
            rate_override_weekday: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("rate_override_weekday")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("rate_override_weekday")?;
                val
            },
            rate_override_weekend: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(
                    row.try_get::<Option<String>, _>("rate_override_weekend")?,
                );
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("rate_override_weekend")?;
                val
            },
            actual_check_out: row.try_get("actual_check_out")?,
            daily_rates: row.try_get("daily_rates")?,
            invoice_number: row.try_get("invoice_number")?,
            cleaning_preference: row.try_get("cleaning_preference")?,
        })
    }
}
