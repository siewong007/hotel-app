//! Maintenance ticket domain models

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceTicket {
    pub id: i64,
    pub room_id: Option<i64>,
    pub room_number: Option<String>,
    pub ticket_number: String,
    pub title: String,
    pub description: Option<String>,
    pub category: String,
    pub priority: String,
    pub status: String,
    pub assigned_to: Option<i64>,
    pub assigned_to_name: Option<String>,
    pub reported_by: Option<i64>,
    pub estimated_cost: Option<Decimal>,
    pub actual_cost: Option<Decimal>,
    pub estimated_hours: Option<Decimal>,
    pub actual_hours: Option<Decimal>,
    pub scheduled_date: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolution_notes: Option<String>,
    pub images: Option<Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateMaintenanceTicketRequest {
    pub room_id: Option<i64>,
    pub title: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub priority: Option<String>,
    pub assigned_to: Option<i64>,
    pub estimated_cost: Option<Decimal>,
    pub estimated_hours: Option<Decimal>,
    pub scheduled_date: Option<DateTime<Utc>>,
    pub images: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMaintenanceTicketRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub priority: Option<String>,
    pub status: Option<String>,
    pub assigned_to: Option<i64>,
    pub estimated_cost: Option<Decimal>,
    pub actual_cost: Option<Decimal>,
    pub estimated_hours: Option<Decimal>,
    pub actual_hours: Option<Decimal>,
    pub scheduled_date: Option<DateTime<Utc>>,
    pub resolution_notes: Option<String>,
    pub images: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct ListMaintenanceTicketsQuery {
    pub status: Option<String>,
    pub room_id: Option<i64>,
    pub assigned_to: Option<i64>,
    pub category: Option<String>,
    pub priority: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct MaintenanceTicketListResponse {
    pub items: Vec<MaintenanceTicket>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Default)]
pub struct MaintenanceTicketPatch {
    pub title: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub priority: Option<String>,
    pub status: Option<String>,
    pub assigned_to: Option<i64>,
    pub estimated_cost: Option<Decimal>,
    pub actual_cost: Option<Decimal>,
    pub estimated_hours: Option<Decimal>,
    pub actual_hours: Option<Decimal>,
    pub scheduled_date: Option<DateTime<Utc>>,
    pub resolution_notes: Option<String>,
    pub images: Option<Value>,
}
