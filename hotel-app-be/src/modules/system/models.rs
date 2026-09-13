//! Operational-health DTOs for the admin System Health and Jobs surfaces.

use serde::Serialize;
use sqlx::FromRow;

use crate::core::metrics::MetricsSnapshot;

/// Latest state of one background loop, aggregated from `job_runs`.
#[derive(Debug, Clone, Serialize)]
pub struct JobHealth {
    pub job_name: String,
    pub last_status: String,
    pub last_run_at: chrono::DateTime<chrono::Utc>,
    pub last_duration_ms: Option<i32>,
    pub last_error: Option<String>,
    pub last_detail: Option<serde_json::Value>,
    pub runs_24h: i64,
    pub failures_24h: i64,
}

/// One `job_runs` row, for the Jobs page's recent-failures feed.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct JobRunRow {
    pub id: i64,
    pub job_name: String,
    pub status: String,
    pub detail: Option<serde_json::Value>,
    pub error: Option<String>,
    pub duration_ms: Option<i32>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// `email_deliveries` backlog snapshot. `queued` + `sending` is work the
/// worker still owes; `failed` is terminal; `sent_24h` is throughput.
#[derive(Debug, Clone, Serialize)]
pub struct EmailQueueHealth {
    pub queued: i64,
    pub sending: i64,
    pub failed: i64,
    pub sent_24h: i64,
}

/// One staff notification as seen by a specific user (`read_at` null = unread).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct StaffNotificationItem {
    pub id: i64,
    pub kind: String,
    pub subject: Option<String>,
    pub title: String,
    pub body: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub read_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// `GET /api/system/notifications` — the caller's feed plus its unread count.
#[derive(Debug, Serialize)]
pub struct StaffNotificationsResponse {
    pub unread: i64,
    pub items: Vec<StaffNotificationItem>,
}

/// Aggregated answer for `GET /api/system/health`.
///
/// `job_runs_enabled` distinguishes "no jobs have run" from "the `job_runs`
/// table does not exist on this database" (pre-patch installs) — the UI shows
/// an honest empty state instead of implying every loop is dead.
#[derive(Debug, Serialize)]
pub struct SystemHealthResponse {
    pub database: &'static str,
    pub uptime_seconds: u64,
    pub metrics: MetricsSnapshot,
    pub email_queue: EmailQueueHealth,
    pub jobs: Vec<JobHealth>,
    pub job_runs_enabled: bool,
}
