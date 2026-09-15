//! Booking channel, pricing-rule, commission-rule, and mapping models.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookingChannel {
    pub id: i64,
    pub name: String,
    pub channel_type: String,
    pub default_commission_type: String,
    pub default_commission_value: Decimal,
    pub default_commission_scope: String,
    pub is_active: bool,
    pub abbreviation: Option<String>,
    pub code: Option<String>,
    pub integration_mode: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BookingChannelInput {
    pub name: String,
    pub channel_type: Option<String>,
    pub default_commission_type: Option<String>,
    pub default_commission_value: Option<Decimal>,
    pub default_commission_scope: Option<String>,
    pub is_active: Option<bool>,
    pub abbreviation: Option<String>,
    pub code: Option<String>,
    pub integration_mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BookingChannelUpdate {
    pub name: Option<String>,
    pub channel_type: Option<String>,
    pub default_commission_type: Option<String>,
    pub default_commission_value: Option<Decimal>,
    pub default_commission_scope: Option<String>,
    pub is_active: Option<bool>,
    pub abbreviation: Option<String>,
    pub code: Option<String>,
    pub integration_mode: Option<String>,
}

// ---------------------------------------------------------------------------
// Channel pricing rules — selling-price derivation per stay night.
// ---------------------------------------------------------------------------

/// One effective-dated rule describing how a channel's selling price differs
/// from the resolved source rate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelPricingRule {
    pub id: i64,
    pub channel_id: i64,
    pub room_type_id: Option<i64>,
    pub rate_plan_id: Option<i64>,
    /// markup_percent | markup_fixed | discount_percent | fixed_price | net_rate
    pub rule_type: String,
    /// Percent, per-night amount, nightly fixed price, or nightly net rate.
    pub value: Decimal,
    pub effective_from: NaiveDate,
    /// Inclusive; NULL = open-ended.
    pub effective_to: Option<NaiveDate>,
    pub min_price: Option<Decimal>,
    pub max_price: Option<Decimal>,
    pub priority: i32,
    pub is_active: bool,
    pub reason: Option<String>,
    pub created_by: Option<i64>,
    pub updated_by: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChannelPricingRuleInput {
    pub room_type_id: Option<i64>,
    pub rate_plan_id: Option<i64>,
    pub rule_type: String,
    pub value: f64,
    pub effective_from: String,
    pub effective_to: Option<String>,
    pub min_price: Option<f64>,
    pub max_price: Option<f64>,
    pub priority: Option<i32>,
    pub is_active: Option<bool>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChannelPricingRuleUpdate {
    pub room_type_id: Option<Option<i64>>,
    pub rate_plan_id: Option<Option<i64>>,
    pub rule_type: Option<String>,
    pub value: Option<f64>,
    pub effective_from: Option<String>,
    pub effective_to: Option<Option<String>>,
    pub min_price: Option<Option<f64>>,
    pub max_price: Option<Option<f64>>,
    pub priority: Option<i32>,
    pub is_active: Option<bool>,
    pub reason: Option<String>,
}

/// Parsed, validated rule fields ready for persistence.
#[derive(Debug, Clone)]
pub struct ChannelPricingRuleValues {
    pub room_type_id: Option<i64>,
    pub rate_plan_id: Option<i64>,
    pub rule_type: String,
    pub value: Decimal,
    pub effective_from: NaiveDate,
    pub effective_to: Option<NaiveDate>,
    pub min_price: Option<Decimal>,
    pub max_price: Option<Decimal>,
    pub priority: i32,
    pub is_active: bool,
    pub reason: Option<String>,
}

// ---------------------------------------------------------------------------
// Channel commission rules — effective-dated distribution cost overrides.
// The channel row's default_commission_* remains the fallback.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelCommissionRule {
    pub id: i64,
    pub channel_id: i64,
    /// percentage | fixed_amount
    pub commission_type: String,
    pub value: Decimal,
    /// per_booking | per_night
    pub scope: String,
    pub effective_from: NaiveDate,
    pub effective_to: Option<NaiveDate>,
    pub priority: i32,
    pub is_active: bool,
    pub reason: Option<String>,
    pub created_by: Option<i64>,
    pub updated_by: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChannelCommissionRuleInput {
    pub commission_type: String,
    pub value: f64,
    pub scope: Option<String>,
    pub effective_from: String,
    pub effective_to: Option<String>,
    pub priority: Option<i32>,
    pub is_active: Option<bool>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChannelCommissionRuleUpdate {
    pub commission_type: Option<String>,
    pub value: Option<f64>,
    pub scope: Option<String>,
    pub effective_from: Option<String>,
    pub effective_to: Option<Option<String>>,
    pub priority: Option<i32>,
    pub is_active: Option<bool>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ChannelCommissionRuleValues {
    pub commission_type: String,
    pub value: Decimal,
    pub scope: String,
    pub effective_from: NaiveDate,
    pub effective_to: Option<NaiveDate>,
    pub priority: i32,
    pub is_active: bool,
    pub reason: Option<String>,
}

// ---------------------------------------------------------------------------
// Integration mappings — channel-manager readiness. Inert until a sync
// integration exists; they carry the channel's external identifiers.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelRoomTypeMapping {
    pub id: i64,
    pub channel_id: i64,
    pub room_type_id: i64,
    pub room_type_name: Option<String>,
    pub external_room_id: Option<String>,
    pub external_room_name: Option<String>,
    pub is_enabled: bool,
    pub sync_status: Option<String>,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelRatePlanMapping {
    pub id: i64,
    pub channel_id: i64,
    pub rate_plan_id: i64,
    pub rate_plan_name: Option<String>,
    pub external_rate_plan_id: Option<String>,
    pub external_rate_plan_name: Option<String>,
    pub is_enabled: bool,
    pub sync_status: Option<String>,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChannelRoomTypeMappingInput {
    pub room_type_id: i64,
    pub external_room_id: Option<String>,
    pub external_room_name: Option<String>,
    pub is_enabled: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChannelRatePlanMappingInput {
    pub rate_plan_id: i64,
    pub external_rate_plan_id: Option<String>,
    pub external_rate_plan_name: Option<String>,
    pub is_enabled: Option<bool>,
}

/// Both mapping lists for one channel, returned by GET mappings.
#[derive(Debug, Clone, Serialize)]
pub struct ChannelMappings {
    pub room_types: Vec<ChannelRoomTypeMapping>,
    pub rate_plans: Vec<ChannelRatePlanMapping>,
}

// ---------------------------------------------------------------------------
// Preview & matrix — read-side resolution output.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ChannelPricePreviewRequest {
    pub channel_id: i64,
    pub room_type_id: i64,
    pub rate_plan_id: Option<i64>,
    pub check_in: String,
    pub check_out: String,
}

/// One night in a resolved preview/matrix row.
#[derive(Debug, Clone, Serialize)]
pub struct NightlyChannelPrice {
    pub date: NaiveDate,
    /// Resolved pre-channel rate (plan band / weekday / weekend / base).
    pub source_rate: Decimal,
    /// Guest-facing nightly price on the channel. `None` for net-rate
    /// channels, whose sell price is channel-managed.
    pub selling_price: Option<Decimal>,
    /// Nightly net amount for net-rate rules.
    pub net_rate: Option<Decimal>,
    pub rule_id: Option<i64>,
    /// Human label like "BASE", "markup_percent +10%".
    pub rule_label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChannelPricePreview {
    pub channel_id: i64,
    pub channel_name: String,
    pub room_type_id: i64,
    pub room_type_name: String,
    pub rate_plan_id: Option<i64>,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub currency: String,
    pub nights: Vec<NightlyChannelPrice>,
    /// Sum of nightly selling prices; `None` when a net-rate rule applies.
    pub selling_subtotal: Option<Decimal>,
    /// Room revenue the commission is computed on (post-discount; before
    /// tourism tax / extra-bed / services).
    pub commission_base: Decimal,
    pub commission_type: String,
    pub commission_value: Decimal,
    pub commission_scope: String,
    /// Estimated commission retained by the channel for the stay.
    pub commission_amount: Option<Decimal>,
    /// Estimated hotel net revenue — labeled estimated, never "profit".
    pub net_revenue: Option<Decimal>,
}

/// One cell of the pricing matrix: channel × room type on one date.
#[derive(Debug, Clone, Serialize)]
pub struct ChannelMatrixCell {
    pub channel_id: i64,
    pub channel_name: String,
    pub channel_type: String,
    pub room_type_id: i64,
    pub source_rate: Decimal,
    pub selling_price: Option<Decimal>,
    pub net_rate: Option<Decimal>,
    pub rule_id: Option<i64>,
    pub rule_label: String,
    /// Estimated commission on one night at the resolved sell/net price.
    pub commission_amount: Option<Decimal>,
    pub net_revenue: Option<Decimal>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChannelMatrix {
    pub date: NaiveDate,
    pub rate_plan_id: Option<i64>,
    pub currency: String,
    pub cells: Vec<ChannelMatrixCell>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChannelMatrixQuery {
    /// YYYY-MM-DD; defaults to today in the handler when absent.
    pub date: Option<String>,
    pub rate_plan_id: Option<i64>,
}
