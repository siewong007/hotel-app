//! Rate plan and pricing models

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Rate plan configuration
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
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

/// Rate plan with associated room rates
#[derive(Debug, Serialize, Deserialize)]
pub struct RatePlanWithRates {
    pub rate_plan: RatePlan,
    pub rates: Vec<RoomRateWithDetails>,
}

/// Room rate configuration
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
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

/// Input for updating a room rate
#[derive(Debug, Serialize, Deserialize)]
pub struct RoomRateUpdateInput {
    pub price: Option<f64>,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
}

/// Room rate with related details
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
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
