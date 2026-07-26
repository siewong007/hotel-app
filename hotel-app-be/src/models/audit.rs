//! Audit-log API models.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

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

/// Fields written to `audit_logs` for a single event.
///
/// `Default` exists so call sites can omit the request-context fields
/// (`ip_address`/`user_agent`) with `..Default::default()` — most internal
/// callers have no HTTP request in scope.
#[derive(Debug, Default)]
pub struct AuditEvent<'a> {
    pub user_id: Option<i64>,
    pub action: &'a str,
    pub resource_type: &'a str,
    pub resource_id: Option<i64>,
    pub details: Option<Value>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
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
    /// True when the audit payload contains field-level change markers.
    pub has_changes: bool,
    /// Derived classification for display/export: `field_change` or `action_only`.
    pub change_kind: String,
    pub details: Option<Value>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Database row used before deriving the activity-stream category.
#[derive(Debug, FromRow)]
pub struct AuditLogRow {
    pub id: i64,
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<i64>,
    pub details: Option<Value>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow, Serialize)]
pub struct AuditUserOption {
    pub id: i64,
    pub username: String,
}

#[derive(Debug, FromRow)]
pub struct AuditResourceTypeCount {
    pub resource_type: String,
    pub count: i64,
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

/// Query parameters for the DB statements diagnostics endpoint.
#[derive(Debug, Deserialize)]
pub struct DbStatementsQuery {
    /// Number of top statements to return (default 20, clamped to 1..=200).
    pub limit: Option<i64>,
}
