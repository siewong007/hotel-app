//! Night audit domain models

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RevenueBreakdownItem {
    pub category: String,
    pub count: i32,
    pub amount: Decimal,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NightAuditRunWithUser {
    pub id: i64,
    pub audit_date: NaiveDate,
    pub run_at: DateTime<Utc>,
    pub run_by_username: Option<String>,
    pub status: String,
    pub total_bookings_posted: i32,
    pub total_checkins: i32,
    pub total_checkouts: i32,
    pub total_revenue: Decimal,
    pub occupancy_rate: Decimal,
    pub rooms_available: i32,
    pub rooms_occupied: i32,
    pub rooms_reserved: i32,
    pub rooms_maintenance: i32,
    pub rooms_dirty: i32,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub payment_method_breakdown: Vec<RevenueBreakdownItem>,
    #[serde(default)]
    pub booking_channel_breakdown: Vec<RevenueBreakdownItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UnpostedBooking {
    pub booking_id: i64,
    pub booking_number: String,
    pub guest_name: String,
    pub room_number: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub status: String,
    pub total_amount: Decimal,
    pub payment_method: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntry {
    pub booking_number: String,
    pub room_number: String,
    pub entry_type: String,
    pub debit: Decimal,
    pub credit: Decimal,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalSection {
    pub entry_type: String,
    pub display_name: String,
    pub entries: Vec<JournalEntry>,
    pub total_debit: Decimal,
    pub total_credit: Decimal,
}

#[derive(Debug, Deserialize)]
pub struct RunNightAuditRequest {
    pub audit_date: String,
    pub notes: Option<String>,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Deserialize)]
pub struct ListAuditsQuery {
    pub page: Option<i32>,
    pub page_size: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct NightAuditResponse {
    pub success: bool,
    pub audit_run: NightAuditRunWithUser,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct RoomSnapshot {
    pub total: i32,
    pub available: i32,
    pub occupied: i32,
    pub reserved: i32,
    pub maintenance: i32,
    pub dirty: i32,
}

#[derive(Debug, Serialize)]
pub struct NightAuditPreview {
    pub audit_date: String,
    pub can_run: bool,
    pub already_run: bool,
    pub unposted_bookings: Vec<UnpostedBooking>,
    pub total_unposted: i32,
    pub estimated_revenue: Decimal,
    pub room_snapshot: RoomSnapshot,
    pub payment_method_breakdown: Vec<RevenueBreakdownItem>,
    pub booking_channel_breakdown: Vec<RevenueBreakdownItem>,
    pub journal_sections: Vec<JournalSection>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PostedBookingDetail {
    pub booking_id: i64,
    pub booking_number: String,
    pub guest_name: String,
    pub room_number: String,
    pub room_type: String,
    pub room_type_code: Option<String>,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub nights: i32,
    pub status: String,
    pub total_amount: Decimal,
    pub payment_status: Option<String>,
    pub payment_method: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuditDetailsResponse {
    pub audit_run: NightAuditRunWithUser,
    pub posted_bookings: Vec<PostedBookingDetail>,
    pub journal_sections: Vec<JournalSection>,
}
