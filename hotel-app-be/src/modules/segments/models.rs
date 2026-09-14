use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

#[derive(Debug, Clone, Serialize)]
pub struct GuestSegment {
    pub id: i64,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub rules: JsonValue,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// How a campaign audience query treats a segment reference.
#[derive(Debug, Clone)]
pub enum SegmentScope {
    /// No segment on the campaign — audience is unchanged.
    Unrestricted,
    /// Segment referenced but missing or inactive — fail closed, match nobody.
    Empty,
    /// Active segment's stored rules — intersect the audience.
    Rules(JsonValue),
}

#[derive(Debug, Clone, Deserialize)]
pub struct SegmentInput {
    pub name: String,
    pub description: Option<String>,
    pub rules: JsonValue,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SegmentListQuery {
    pub search: Option<String>,
    pub is_active: Option<bool>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SegmentListResponse {
    pub items: Vec<SegmentSummary>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Serialize)]
pub struct SegmentSummary {
    pub id: i64,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub rules: JsonValue,
    pub is_active: bool,
    pub member_count: i64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SegmentPreviewInput {
    pub rules: JsonValue,
}

#[derive(Debug, Serialize)]
pub struct SegmentPreview {
    pub count: i64,
    pub sample: Vec<SegmentSampleGuest>,
}

#[derive(Debug, Serialize)]
pub struct SegmentSampleGuest {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct SegmentFieldOptions {
    pub loyalty_tiers: Vec<LoyaltyTierOption>,
    pub guest_types: Vec<String>,
    /// Observed distinct values on guests — powers selects with real data.
    pub distinct_values: SegmentDistinctValues,
}

#[derive(Debug, Serialize)]
pub struct SegmentDistinctValues {
    pub countries: Vec<String>,
    pub nationalities: Vec<String>,
    pub languages: Vec<String>,
    pub communication_preferences: Vec<String>,
    pub vip_statuses: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct LoyaltyTierOption {
    pub id: i64,
    pub name: String,
}
