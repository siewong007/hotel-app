//! Analytics/reporting API models.

/// Query parameters accepted by report generation endpoints.
#[derive(Debug, serde::Deserialize)]
pub struct ReportQuery {
    pub report_type: String,
    pub start_date: String,
    pub end_date: String,
    pub shift: Option<String>,
    pub drawer: Option<String>,
    pub company_name: Option<String>,
    pub booking_channel_id: Option<i64>,
    pub booking_channel: Option<String>,
    pub platform_name: Option<String>,
    pub booking_status: Option<String>,
    pub posted_status: Option<String>,
    pub room_type: Option<String>,
}
