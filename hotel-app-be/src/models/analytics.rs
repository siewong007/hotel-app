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
}
