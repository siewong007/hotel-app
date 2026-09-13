use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A staff-authored guest interaction or note (guest_notes row).
#[derive(Debug, Clone, Serialize)]
pub struct GuestInteraction {
    pub id: i64,
    pub guest_id: i64,
    pub interaction_type: String,   // note|call|email|in_person|follow_up
    pub note_type: String,
    pub subject: Option<String>,
    pub content: String,
    pub booking_id: Option<i64>,
    pub is_alert: bool,
    pub is_private: bool,
    pub follow_up_at: Option<DateTime<Utc>>,
    pub follow_up_completed_at: Option<DateTime<Utc>>,
    pub assigned_to: Option<i64>,
    pub assigned_to_name: Option<String>,
    pub created_by: Option<i64>,
    pub created_by_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct GuestInteractionInput {
    pub interaction_type: Option<String>,
    pub subject: Option<String>,
    pub content: String,
    pub booking_id: Option<i64>,
    pub is_alert: Option<bool>,
    pub is_private: Option<bool>,
    pub follow_up_at: Option<DateTime<Utc>>,
    pub assigned_to: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct GuestInteractionUpdate {
    pub subject: Option<String>,
    pub content: Option<String>,
    pub interaction_type: Option<String>,
    pub is_alert: Option<bool>,
    pub follow_up_at: Option<DateTime<Utc>>,
    pub follow_up_completed: Option<bool>, // sets/clears follow_up_completed_at
    pub assigned_to: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct InteractionListQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub include_completed_followups: Option<bool>,
}

/// Paged envelope for the interactions timeline — mirrors
/// `SupportConversationListResponse` (minus queue metrics).
#[derive(Debug, Serialize)]
pub struct InteractionListResponse {
    pub items: Vec<GuestInteraction>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestPreference {
    pub id: i64,
    pub category: String,
    pub preference_key: String,
    pub preference_value: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct GuestPreferenceEntry {
    pub category: String,
    pub preference_key: String,
    pub preference_value: String,
}

#[derive(Debug, Deserialize)]
pub struct GuestPreferencesPut {
    pub entries: Vec<GuestPreferenceEntry>,
    /// When true, keys absent from entries are deleted for the listed categories.
    pub replace_categories: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestReviewRow {
    pub id: i64,
    pub booking_id: Option<i64>,
    pub overall_rating: f64,
    pub title: Option<String>,
    pub content: Option<String>,
    pub response: Option<String>,
    pub response_at: Option<DateTime<Utc>>,
    pub is_published: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct GuestReviewResponseInput {
    pub response: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestLoyaltySummary {
    pub member_number: String,
    pub status: String,
    pub tier_code: String,
    pub tier_name: String,
    pub available_points: i32,
    pub lifetime_points: i32,
    pub qualifying_nights: i32,
    pub recent_redemptions: Vec<GuestRedemptionRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestRedemptionRow {
    pub id: i64,
    pub reward_name: Option<String>,
    pub points: i32,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestVoucherRow {
    pub id: i64,
    pub code: String,
    pub status: String,
    pub source: String,
    pub promotion_id: i64,
    /// Joined from `promotions` (`vouchers.promotion_id` is NOT NULL).
    pub promotion_name: Option<String>,
    pub promotion_slug: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub redeemed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestCommunicationsSummary {
    pub marketing_opt_in: bool,
    pub communication_preference: Option<String>,
    pub language_preference: Option<String>,
    pub email_suppressed: bool,
    pub subscriptions: Vec<GuestSubscriptionRow>,
    pub recent_deliveries: Vec<GuestDeliveryRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestSubscriptionRow {
    pub channel: String,
    pub topic: String,
    pub subscribed: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestDeliveryRow {
    pub id: i64,
    pub kind: String,
    pub subject: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
}
