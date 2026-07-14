use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
pub struct SupportConversationSummary {
    pub id: i64,
    pub conversation_number: String,
    pub guest_id: i64,
    pub guest_name: String,
    pub guest_email: Option<String>,
    pub booking_id: Option<i64>,
    pub booking_reference: Option<String>,
    pub room_number: Option<String>,
    pub category: String,
    pub status: String,
    pub priority: String,
    pub queue: String,
    pub assigned_to_user_id: Option<i64>,
    pub assigned_to_name: Option<String>,
    pub escalation_level: i32,
    pub escalated_at: Option<DateTime<Utc>>,
    pub first_response_due_at: Option<DateTime<Utc>>,
    pub resolution_due_at: Option<DateTime<Utc>>,
    pub first_response_at: Option<DateTime<Utc>>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    pub last_message_preview: Option<String>,
    pub last_message_at: Option<DateTime<Utc>>,
    pub last_activity_at: DateTime<Utc>,
    pub unread_count: i64,
    pub is_sla_at_risk: bool,
    pub is_sla_breached: bool,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SupportConversation {
    #[serde(flatten)]
    pub summary: SupportConversationSummary,
    pub subject: Option<String>,
    pub stay_status: Option<String>,
    pub check_in_date: Option<NaiveDate>,
    pub check_out_date: Option<NaiveDate>,
    pub resolution_code: Option<String>,
    pub resolution_summary: Option<String>,
    pub reopen_count: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SupportMessage {
    pub id: i64,
    pub conversation_id: i64,
    pub author_type: String,
    pub author_user_id: Option<i64>,
    pub author_guest_id: Option<i64>,
    pub author_name: Option<String>,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SupportEvent {
    pub id: i64,
    pub conversation_id: i64,
    pub event_type: String,
    pub actor_user_id: Option<i64>,
    pub actor_name: Option<String>,
    pub body: Option<String>,
    pub metadata: Option<Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct SupportConversationDetail {
    pub conversation: SupportConversation,
    pub messages: Vec<SupportMessage>,
    pub events: Vec<SupportEvent>,
}

#[derive(Debug, Serialize)]
pub struct SupportConversationListResponse {
    pub items: Vec<SupportConversationSummary>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub metrics: SupportQueueMetrics,
}

#[derive(Debug, Default, Serialize)]
pub struct SupportQueueMetrics {
    pub total_open: i64,
    pub unassigned: i64,
    pub waiting_for_staff: i64,
    pub waiting_for_guest: i64,
    pub at_risk: i64,
    pub breached: i64,
}

#[derive(Debug, Serialize)]
pub struct SupportAgent {
    pub id: i64,
    pub name: String,
    pub email: Option<String>,
    pub is_available: bool,
}

#[derive(Debug, Deserialize)]
pub struct SupportListQuery {
    pub queue: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub assigned_to_user_id: Option<i64>,
    pub search: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SupportMessageRequest {
    pub message: String,
    pub client_message_id: Option<String>,
    pub expected_version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SupportActionRequest {
    pub action: String,
    pub expected_version: Option<i64>,
    pub assignee_id: Option<i64>,
    pub priority: Option<String>,
    pub reason: Option<String>,
    pub resolution_code: Option<String>,
    pub resolution_summary: Option<String>,
    pub client_action_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateGuestSupportConversationRequest {
    pub category: String,
    pub message: String,
    pub booking_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct GuestSupportMessageRequest {
    pub message: String,
    pub client_message_id: Option<String>,
    pub expected_version: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestSupportConversation {
    pub id: i64,
    pub category: String,
    pub status: String,
    pub assigned_team: String,
    pub booking_id: Option<i64>,
    pub subject: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_activity_at: DateTime<Utc>,
    pub first_response_at: Option<DateTime<Utc>>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    pub can_reopen: bool,
    pub version: i64,
}

#[derive(Debug, Serialize)]
pub struct GuestSupportConversationDetail {
    pub conversation: GuestSupportConversation,
    pub messages: Vec<SupportMessage>,
}

#[derive(Debug, Serialize)]
pub struct GuestSupportConversationListResponse {
    pub items: Vec<GuestSupportConversation>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone)]
pub struct SupportActionInput {
    pub action: String,
    pub expected_version: Option<i64>,
    pub assignee_id: Option<i64>,
    pub priority: Option<String>,
    pub reason: Option<String>,
    pub resolution_code: Option<String>,
    pub resolution_summary: Option<String>,
    pub client_action_id: Option<String>,
}

impl From<SupportActionRequest> for SupportActionInput {
    fn from(request: SupportActionRequest) -> Self {
        Self {
            action: request.action,
            expected_version: request.expected_version,
            assignee_id: request.assignee_id,
            priority: request.priority,
            reason: request.reason,
            resolution_code: request.resolution_code,
            resolution_summary: request.resolution_summary,
            client_action_id: request.client_action_id,
        }
    }
}
