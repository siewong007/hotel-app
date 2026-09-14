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

/// Patch semantics: every field is `Option` where `None` = unchanged. `Some`
/// carries the replacement — for `subject`, `Some("")` sanitizes to a NULL
/// (clears the column); for `is_private`, `Some(false)` reverts a mistakenly
/// privatized note.
#[derive(Debug, Deserialize)]
pub struct GuestInteractionUpdate {
    pub subject: Option<String>,
    pub content: Option<String>,
    pub interaction_type: Option<String>,
    pub is_alert: Option<bool>,
    pub is_private: Option<bool>,
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

/// `GET /guest-relations/follow-ups` params — `due` is one of
/// `overdue | today | upcoming | all` (default `all`, unknown values are
/// treated as `all` by the repository match).
#[derive(Debug, Deserialize)]
pub struct FollowUpQueueQuery {
    pub due: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

/// Paged envelope for the interactions timeline — same `{ data, total, page,
/// page_size }` shape as `GuestPaginatedResponse` (the support inbox uses
/// `items`; guest-domain lists use `data`).
#[derive(Debug, Serialize)]
pub struct InteractionListResponse {
    pub data: Vec<GuestInteraction>,
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

// ------------------------------------------------------------------
// Phase 2 — cross-guest operational layer (overview + follow-up queue)
// ------------------------------------------------------------------

/// `count` over the full matching set plus up to 5 preview `items` — every
/// overview section carries this shape so the dashboard renders in one
/// aggregate payload.
#[derive(Debug, Serialize)]
pub struct OverviewSection<T> {
    pub count: i64,
    pub items: Vec<T>,
}

/// Booking preview row shared by the `arrivals` / `in_house` / `departures`
/// / `vip_arrivals` sections.
#[derive(Debug, Serialize)]
pub struct OverviewBookingItem {
    pub booking_id: i64,
    pub guest_id: i64,
    pub guest_name: String,
    pub status: String,
    pub room_label: Option<String>,
    pub is_vip: bool,
}

#[derive(Debug, Serialize)]
pub struct OverviewSupportItem {
    pub conversation_id: i64,
    pub conversation_number: String,
    pub guest_id: Option<i64>,
    pub guest_name: Option<String>,
    pub status: String,
    pub priority: Option<String>,
    pub subject: String,
}

/// Open-conversation counts plus preview rows. `open` is every
/// `status <> 'closed'` conversation — the staff-inbox definition of open —
/// with the `waiting_for_staff` backlog split out for the dashboard.
#[derive(Debug, Serialize)]
pub struct OverviewSupportSection {
    pub open: i64,
    pub waiting_for_staff: i64,
    pub items: Vec<OverviewSupportItem>,
}

#[derive(Debug, Serialize)]
pub struct OverviewReviewItem {
    pub review_id: i64,
    pub guest_id: i64,
    pub guest_name: String,
    pub rating: Option<f64>,
    pub created_at: DateTime<Utc>,
}

/// One open follow-up (`guest_notes.follow_up_at` set, not yet completed) in
/// the cross-guest queue; also the preview row for the overview's
/// `follow_ups` section. `snippet` is the first 160 chars of `content`.
#[derive(Debug, Serialize)]
pub struct FollowUpQueueItem {
    pub note_id: i64,
    pub guest_id: i64,
    pub guest_name: String,
    pub subject: Option<String>,
    pub interaction_type: String,
    pub follow_up_at: DateTime<Utc>,
    pub assigned_to: Option<i64>,
    pub assigned_to_name: Option<String>,
    pub created_by_name: Option<String>,
    pub snippet: Option<String>,
}

/// `support` / `reviews` are present only when the caller holds
/// `support:read` / `reviews:read`; omitted (not `null`) otherwise so
/// consumers can distinguish "no access" from "no data" — the same
/// omit-not-null convention as `GuestSensitiveProfile` on `GuestProfile`.
#[derive(Debug, Serialize)]
pub struct OverviewResponse {
    pub arrivals: OverviewSection<OverviewBookingItem>,
    pub in_house: OverviewSection<OverviewBookingItem>,
    pub departures: OverviewSection<OverviewBookingItem>,
    pub vip_arrivals: OverviewSection<OverviewBookingItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub support: Option<OverviewSupportSection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviews: Option<OverviewSection<OverviewReviewItem>>,
    pub follow_ups: OverviewSection<FollowUpQueueItem>,
}
