//! Housekeeping domain models

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HousekeepingTask {
    pub id: i64,
    pub room_id: i64,
    pub room_number: String,
    pub room_type: String,
    pub task_type: String,
    pub priority: String,
    pub status: String,
    pub assigned_to: Option<i64>,
    pub assigned_to_name: Option<String>,
    pub scheduled_date: Option<NaiveDate>,
    pub task_date: NaiveDate,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub notes: Option<String>,
    pub inspection_notes: Option<String>,
    pub items_used: Option<Value>,
    pub created_at: DateTime<Utc>,
    pub created_by: Option<i64>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateHousekeepingTaskRequest {
    pub room_id: i64,
    pub task_type: Option<String>,
    pub priority: Option<String>,
    pub assigned_to: Option<i64>,
    pub scheduled_date: Option<NaiveDate>,
    pub notes: Option<String>,
    pub inspection_notes: Option<String>,
    pub items_used: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateHousekeepingTaskRequest {
    pub priority: Option<String>,
    pub status: Option<String>,
    pub assigned_to: Option<i64>,
    pub scheduled_date: Option<NaiveDate>,
    pub notes: Option<String>,
    pub inspection_notes: Option<String>,
    pub items_used: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct ListHousekeepingTasksQuery {
    pub status: Option<String>,
    pub room_id: Option<i64>,
    pub assigned_to: Option<i64>,
    pub scheduled_date: Option<NaiveDate>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct HousekeepingTaskListResponse {
    pub items: Vec<HousekeepingTask>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct HousekeepingBoardRoom {
    pub id: i64,
    pub room_number: String,
    pub room_type: String,
    pub floor: Option<i32>,
    pub status: String,
    pub open_task: Option<HousekeepingTask>,
}

#[derive(Debug, Serialize)]
pub struct HousekeepingBoardResponse {
    pub rooms: Vec<HousekeepingBoardRoom>,
}

#[derive(Debug, Clone)]
pub struct HousekeepingTaskPatch {
    pub priority: Option<String>,
    pub status: Option<String>,
    pub assigned_to: Option<i64>,
    pub scheduled_date: Option<NaiveDate>,
    pub notes: Option<String>,
    pub inspection_notes: Option<String>,
    pub items_used: Option<Value>,
}
