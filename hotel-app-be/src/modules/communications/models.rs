use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct NotificationSubscription {
    pub id: i64,
    pub guest_id: i64,
    pub channel: String,
    pub topic: String,
    pub subscribed: bool,
    pub source: Option<String>,
    pub policy_version: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConsentEvent {
    pub id: i64,
    pub guest_id: i64,
    pub channel: String,
    pub topic: String,
    pub action: String,
    pub source: String,
    pub policy_version: Option<String>,
    pub actor_type: String,
    pub actor_user_id: Option<i64>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EmailCampaign {
    pub id: i64,
    pub name: String,
    pub campaign_type: String,
    pub topic: String,
    pub status: String,
    pub subject: String,
    pub body_html: String,
    pub body_text: Option<String>,
    pub template_id: Option<i64>,
    pub promotion_id: Option<i64>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub total_recipients: i32,
    pub sent_count: i32,
    pub failed_count: i32,
    pub error: Option<String>,
    pub created_by: Option<i64>,
    pub cancelled_by: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// One booking due a pre-arrival reminder email.
#[derive(Debug, Clone)]
pub struct PreArrivalBooking {
    pub id: i64,
    pub guest_id: i64,
    pub booking_number: String,
    pub guest_name: String,
    pub guest_email: String,
    pub check_in_date: chrono::NaiveDate,
    pub check_out_date: chrono::NaiveDate,
    pub room_number: Option<String>,
    pub room_type_name: Option<String>,
}

/// Full outbox row. Deliberately NOT Serialize: rendered bodies and raw
/// recipient addresses must never reach an HTTP response or audit payload.
/// API responses use [`DeliverySummary`].
// Lease/idempotency bookkeeping is driven entirely in SQL; those columns are
// mapped here for completeness but never read in Rust.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct EmailDelivery {
    pub id: i64,
    pub campaign_id: Option<i64>,
    pub kind: String,
    pub guest_id: i64,
    pub topic: String,
    pub recipient_email: String,
    pub subject: String,
    pub body_html: String,
    pub body_text: Option<String>,
    pub voucher_id: Option<i64>,
    pub status: String,
    pub attempts: i32,
    pub max_attempts: i32,
    pub next_attempt_at: DateTime<Utc>,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<DateTime<Utc>>,
    pub provider_message_id: Option<String>,
    pub idempotency_key: String,
    pub last_error: Option<String>,
    pub sent_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeliverySummary {
    pub id: i64,
    pub campaign_id: Option<i64>,
    pub kind: String,
    pub guest_id: i64,
    pub topic: String,
    pub subject: String,
    pub recipient_masked: String,
    pub status: String,
    pub attempts: i32,
    pub last_error: Option<String>,
    pub sent_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EmailSuppression {
    pub id: i64,
    pub email: String,
    pub reason: String,
    pub source: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EmailTemplate {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub subject: String,
    pub body_html: String,
    pub body_text: Option<String>,
    pub variables: Vec<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudienceCount {
    pub eligible: i64,
    pub excluded_no_email: i64,
    pub excluded_inactive: i64,
    pub excluded_unsubscribed: i64,
    pub excluded_suppressed: i64,
}

#[derive(Debug, Serialize)]
pub struct CampaignListResponse {
    pub items: Vec<EmailCampaign>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

/// Query params for the admin notification-center delivery feed.
#[derive(Debug, Deserialize)]
pub struct DeliveryFeedQuery {
    /// `all` (default) | `transactional` | `marketing`
    pub tier: Option<String>,
    /// Optional exact delivery-status filter.
    pub status: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

/// One feed row: masked summary plus its derived priority tier.
#[derive(Debug, Clone, Serialize)]
pub struct DeliveryFeedItem {
    #[serde(flatten)]
    pub summary: DeliverySummary,
    pub tier: &'static str,
}

#[derive(Debug, Serialize)]
pub struct DeliveryFeedResponse {
    pub items: Vec<DeliveryFeedItem>,
    pub total: i64,
    /// Deliveries still queued or sending, across all filters — drives the
    /// global bell badge.
    pub unread: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Serialize)]
pub struct DeliveryListResponse {
    pub items: Vec<DeliverySummary>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Serialize)]
pub struct SuppressionListResponse {
    pub items: Vec<EmailSuppression>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SubscriptionUpdateInput {
    pub topic: String,
    pub subscribed: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PreferenceUpdateInput {
    pub subscriptions: Vec<SubscriptionUpdateInput>,
    pub policy_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CampaignInput {
    pub name: String,
    pub campaign_type: String,
    pub subject: String,
    pub body_html: String,
    pub body_text: Option<String>,
    pub template_id: Option<i64>,
    pub promotion_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CampaignListQuery {
    pub status: Option<String>,
    pub campaign_type: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TemplateInput {
    pub code: String,
    pub name: String,
    pub subject: String,
    pub body_html: String,
    pub body_text: Option<String>,
    pub variables: Option<Vec<String>>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TestSendInput {
    pub recipient_email: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SuppressionInput {
    pub email: String,
    pub reason: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PreviewResponse {
    pub subject: String,
    pub body_html: String,
    pub audience: AudienceCount,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScheduleCampaignInput {
    pub scheduled_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UnsubscribeApplyInput {
    pub topic: Option<String>,
    pub global: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TopicPreference {
    pub topic: String,
    pub subscribed: bool,
}

#[derive(Debug, Serialize)]
pub struct PreferencesResponse {
    pub subscriptions: Vec<TopicPreference>,
}

#[derive(Debug, Serialize)]
pub struct ConsentStatusResponse {
    pub subscriptions: Vec<TopicPreference>,
    pub events: Vec<ConsentEvent>,
}

/// Internal row for scheduler audience expansion. Never serialized.
#[derive(Debug, Clone)]
pub struct AudienceGuest {
    pub id: i64,
    pub email: String,
    pub first_name: String,
    pub full_name: String,
}

/// Masks a recipient address for staff-facing delivery listings:
/// `jane.doe@example.com` -> `j•••@example.com`.
pub fn mask_email(email: &str) -> String {
    match email.split_once('@') {
        Some((local, domain)) => {
            let first = local.chars().next().map(String::from).unwrap_or_default();
            format!("{first}•••@{domain}")
        }
        None => "•••".to_string(),
    }
}
