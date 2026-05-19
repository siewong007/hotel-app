//! Audit-log API models.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Query parameters for audit log listing.
#[derive(Debug, Deserialize)]
pub struct AuditLogQuery {
    pub user_id: Option<i64>,
    pub action: Option<String>,
    pub resource_type: Option<String>,
    /// Activity stream: rooms | guests | bookings | system | reports
    pub category: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub search: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
}

/// Extended audit log entry with username.
#[derive(Debug, Serialize)]
pub struct AuditLogEntryWithUser {
    pub id: i64,
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub action: String,
    pub resource_type: String,
    /// Activity stream this entry belongs to (derived from `resource_type`).
    pub category: String,
    pub resource_id: Option<i64>,
    pub details: Option<Value>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Per-activity-stream event counts for the audit category rail.
#[derive(Debug, Serialize, Default)]
pub struct AuditCategoryCounts {
    pub rooms: i64,
    pub guests: i64,
    pub bookings: i64,
    pub system: i64,
    pub reports: i64,
    pub other: i64,
    pub total: i64,
}

/// Response for paginated audit logs.
#[derive(Debug, Serialize)]
pub struct AuditLogResponse {
    pub data: Vec<AuditLogEntryWithUser>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_pages: i64,
}
