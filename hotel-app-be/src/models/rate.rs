//! Rate plan and pricing models

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Rate plan configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatePlan {
    pub id: i64,
    pub name: String,
    pub code: String,
    pub description: Option<String>,
    pub plan_type: String,
    pub adjustment_type: String,
    pub adjustment_value: Option<Decimal>,
    pub valid_from: Option<NaiveDate>,
    pub valid_to: Option<NaiveDate>,
    pub applies_monday: bool,
    pub applies_tuesday: bool,
    pub applies_wednesday: bool,
    pub applies_thursday: bool,
    pub applies_friday: bool,
    pub applies_saturday: bool,
    pub applies_sunday: bool,
    pub min_nights: i32,
    pub max_nights: Option<i32>,
    pub min_advance_booking: i32,
    pub max_advance_booking: Option<i32>,
    pub is_active: bool,
    pub priority: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Input for creating a rate plan
#[derive(Debug, Serialize, Deserialize)]
pub struct RatePlanInput {
    pub name: String,
    pub code: String,
    pub description: Option<String>,
    pub plan_type: Option<String>,
    pub adjustment_type: Option<String>,
    pub adjustment_value: Option<f64>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub applies_monday: Option<bool>,
    pub applies_tuesday: Option<bool>,
    pub applies_wednesday: Option<bool>,
    pub applies_thursday: Option<bool>,
    pub applies_friday: Option<bool>,
    pub applies_saturday: Option<bool>,
    pub applies_sunday: Option<bool>,
    pub min_nights: Option<i32>,
    pub max_nights: Option<i32>,
    pub min_advance_booking: Option<i32>,
    pub max_advance_booking: Option<i32>,
    pub blackout_dates: Option<Vec<String>>,
    pub is_active: Option<bool>,
    pub priority: Option<i32>,
}

/// Parsed values for creating a rate plan.
#[derive(Debug, Clone)]
pub struct RatePlanCreateValues {
    pub name: String,
    pub code: String,
    pub description: Option<String>,
    pub plan_type: Option<String>,
    pub adjustment_type: Option<String>,
    pub adjustment_value: Option<Decimal>,
    pub valid_from: Option<NaiveDate>,
    pub valid_to: Option<NaiveDate>,
    pub applies_monday: bool,
    pub applies_tuesday: bool,
    pub applies_wednesday: bool,
    pub applies_thursday: bool,
    pub applies_friday: bool,
    pub applies_saturday: bool,
    pub applies_sunday: bool,
    pub min_nights: i32,
    pub max_nights: Option<i32>,
    pub min_advance_booking: i32,
    pub max_advance_booking: Option<i32>,
    pub blackout_dates: Option<Vec<String>>,
    pub is_active: bool,
    pub priority: i32,
}

/// Input for updating a rate plan
#[derive(Debug, Serialize, Deserialize)]
pub struct RatePlanUpdateInput {
    pub name: Option<String>,
    pub code: Option<String>,
    pub description: Option<String>,
    pub plan_type: Option<String>,
    pub adjustment_type: Option<String>,
    pub adjustment_value: Option<f64>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub applies_monday: Option<bool>,
    pub applies_tuesday: Option<bool>,
    pub applies_wednesday: Option<bool>,
    pub applies_thursday: Option<bool>,
    pub applies_friday: Option<bool>,
    pub applies_saturday: Option<bool>,
    pub applies_sunday: Option<bool>,
    pub min_nights: Option<i32>,
    pub max_nights: Option<i32>,
    pub min_advance_booking: Option<i32>,
    pub max_advance_booking: Option<i32>,
    pub is_active: Option<bool>,
    pub priority: Option<i32>,
}

/// Parsed values for updating a rate plan.
#[derive(Debug, Clone, Default)]
pub struct RatePlanUpdateValues {
    pub name: Option<String>,
    pub code: Option<String>,
    pub description: Option<String>,
    pub plan_type: Option<String>,
    pub adjustment_type: Option<String>,
    pub adjustment_value: Option<Decimal>,
    pub valid_from: Option<NaiveDate>,
    pub valid_to: Option<NaiveDate>,
    pub applies_monday: Option<bool>,
    pub applies_tuesday: Option<bool>,
    pub applies_wednesday: Option<bool>,
    pub applies_thursday: Option<bool>,
    pub applies_friday: Option<bool>,
    pub applies_saturday: Option<bool>,
    pub applies_sunday: Option<bool>,
    pub min_nights: Option<i32>,
    pub max_nights: Option<i32>,
    pub min_advance_booking: Option<i32>,
    pub max_advance_booking: Option<i32>,
    pub is_active: Option<bool>,
    pub priority: Option<i32>,
}

/// Rate plan with associated room rates
#[derive(Debug, Serialize, Deserialize)]
pub struct RatePlanWithRates {
    pub rate_plan: RatePlan,
    pub rates: Vec<RoomRateWithDetails>,
}

/// Room rate configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomRate {
    pub id: i64,
    pub rate_plan_id: i64,
    pub room_type_id: i64,
    pub price: Decimal,
    pub effective_from: NaiveDate,
    pub effective_to: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
}

/// Input for creating a room rate
#[derive(Debug, Serialize, Deserialize)]
pub struct RoomRateInput {
    pub rate_plan_id: i64,
    pub room_type_id: i64,
    pub price: f64,
    pub effective_from: String,
    pub effective_to: Option<String>,
}

/// Parsed values for creating a room rate.
#[derive(Debug, Clone)]
pub struct RoomRateCreateValues {
    pub rate_plan_id: i64,
    pub room_type_id: i64,
    pub price: Decimal,
    pub effective_from: NaiveDate,
    pub effective_to: Option<NaiveDate>,
}

/// Input for updating a room rate
#[derive(Debug, Serialize, Deserialize)]
pub struct RoomRateUpdateInput {
    pub price: Option<f64>,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
}

/// Parsed values for updating a room rate.
#[derive(Debug, Clone, Default)]
pub struct RoomRateUpdateValues {
    pub price: Option<Decimal>,
    pub effective_from: Option<NaiveDate>,
    pub effective_to: Option<NaiveDate>,
}

/// Room rate with related details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomRateWithDetails {
    pub id: i64,
    pub rate_plan_id: i64,
    pub rate_plan_name: String,
    pub rate_plan_code: String,
    pub room_type_id: i64,
    pub room_type_name: String,
    pub room_type_code: String,
    pub price: Decimal,
    pub effective_from: NaiveDate,
    pub effective_to: Option<NaiveDate>,
}

/// Query for applicable rate lookup.
#[derive(Debug, Deserialize)]
pub struct ApplicableRateQuery {
    pub room_type_id: i64,
    pub date: String,
}


impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for RatePlan {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(RatePlan {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            code: row.try_get("code")?,
            description: row.try_get("description")?,
            plan_type: row.try_get("plan_type")?,
            adjustment_type: row.try_get("adjustment_type")?,
            adjustment_value: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_opt_decimal(row.try_get::<Option<String>, _>("adjustment_value")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("adjustment_value")?;
                val
            },
            valid_from: row.try_get("valid_from")?,
            valid_to: row.try_get("valid_to")?,
            applies_monday: row.try_get("applies_monday")?,
            applies_tuesday: row.try_get("applies_tuesday")?,
            applies_wednesday: row.try_get("applies_wednesday")?,
            applies_thursday: row.try_get("applies_thursday")?,
            applies_friday: row.try_get("applies_friday")?,
            applies_saturday: row.try_get("applies_saturday")?,
            applies_sunday: row.try_get("applies_sunday")?,
            min_nights: row.try_get("min_nights")?,
            max_nights: row.try_get("max_nights")?,
            min_advance_booking: row.try_get("min_advance_booking")?,
            max_advance_booking: row.try_get("max_advance_booking")?,
            is_active: row.try_get("is_active")?,
            priority: row.try_get("priority")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}


impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for RoomRate {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(RoomRate {
            id: row.try_get("id")?,
            rate_plan_id: row.try_get("rate_plan_id")?,
            room_type_id: row.try_get("room_type_id")?,
            price: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("price")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("price")?;
                val
            },
            effective_from: row.try_get("effective_from")?,
            effective_to: row.try_get("effective_to")?,
            created_at: row.try_get("created_at")?,
        })
    }
}


impl<'r> sqlx::FromRow<'r, crate::core::db::DbRow> for RoomRateWithDetails {
    fn from_row(row: &'r crate::core::db::DbRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(RoomRateWithDetails {
            id: row.try_get("id")?,
            rate_plan_id: row.try_get("rate_plan_id")?,
            rate_plan_name: row.try_get("rate_plan_name")?,
            rate_plan_code: row.try_get("rate_plan_code")?,
            room_type_id: row.try_get("room_type_id")?,
            room_type_name: row.try_get("room_type_name")?,
            room_type_code: row.try_get("room_type_code")?,
            price: {
                #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
                let val = crate::core::db::parse_decimal(&row.try_get::<String, _>("price")?);
                #[cfg(any(
                    all(feature = "postgres", not(feature = "sqlite")),
                    all(feature = "sqlite", feature = "postgres")
                ))]
                let val = row.try_get("price")?;
                val
            },
            effective_from: row.try_get("effective_from")?,
            effective_to: row.try_get("effective_to")?,
        })
    }
}
