//! Typed DTOs for the Insights reporting surface.
//!
//! The legacy `/reports/generate` endpoint returns `serde_json::Value`; the
//! insights endpoints wrap report payloads in [`ReportEnvelope`] so the
//! frontend can render any report through one `ReportShell` instead of
//! per-type components.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/// Room counts by operational bucket. The bucket mapping mirrors what the
/// room list derives (stored status + current booking state) and what the
/// dashboard used to compute client-side — this is now the single definition.
#[derive(Debug, Clone, Serialize)]
pub struct RoomBuckets {
    pub total: i64,
    pub occupied: i64,
    pub reserved: i64,
    pub available: i64,
    pub cleaning: i64,
    pub maintenance: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BookingKpis {
    pub total: i64,
    pub checked_in: i64,
    pub confirmed: i64,
    pub pending: i64,
    pub active: i64,
    pub today_check_ins: i64,
    pub today_check_outs: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RevenuePoint {
    pub date: NaiveDate,
    pub revenue: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomTypeLoad {
    pub name: String,
    pub total: i64,
    pub occupied: i64,
    pub available: i64,
}

/// `GET /api/insights/overview` — the admin dashboard's numbers, computed
/// once server-side from the same sources the individual endpoints use.
#[derive(Debug, Serialize)]
pub struct InsightsOverview {
    pub business_date: NaiveDate,
    pub rooms: RoomBuckets,
    /// Occupied rooms / total active rooms for the business date.
    pub occupancy_rate: f64,
    pub bookings: BookingKpis,
    /// Bookings *created* on the business date (booking-date basis — the same
    /// definition the dashboard's revenue strip has always used).
    pub revenue_today: f64,
    pub revenue_last_7_days: Vec<RevenuePoint>,
    pub guests_total: i64,
    pub room_types: Vec<RoomTypeLoad>,
}

// ---------------------------------------------------------------------------
// Report envelope
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ReportMeta {
    pub report_id: String,
    pub title: String,
    pub generated_at: DateTime<Utc>,
    /// 'stay' = stay dates, 'booking' = booking-creation dates, 'accounting' =
    /// ledger/payment posting dates. Declared per report in the catalog.
    pub date_basis: &'static str,
    pub range_start: Option<NaiveDate>,
    pub range_end: Option<NaiveDate>,
    /// Echo of the non-default filter params, for auditability of exports.
    pub filters: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum KpiFormat {
    Number,
    Currency,
    Percent,
    Text,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportKpi {
    pub key: String,
    pub label: String,
    pub value: serde_json::Value,
    pub format: KpiFormat,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportColumn {
    pub key: String,
    pub label: String,
    pub format: KpiFormat,
}

/// One renderable table within a report. Multi-section payloads (e.g.
/// occupancy's `by_room_type` + `daily`) become multiple sections.
#[derive(Debug, Clone, Serialize)]
pub struct ReportSection {
    pub key: String,
    pub title: String,
    pub columns: Vec<ReportColumn>,
    pub rows: Vec<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Debug, Serialize)]
pub struct ReportEnvelope {
    pub meta: ReportMeta,
    pub kpis: Vec<ReportKpi>,
    pub sections: Vec<ReportSection>,
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/// A report type in the governed catalog. `params` lists the ReportQuery
/// fields the generator actually consumes — the filter bar renders exactly
/// those controls.
#[derive(Debug, Clone, Serialize)]
pub struct ReportCatalogEntry {
    pub id: &'static str,
    pub title: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub date_basis: &'static str,
    pub params: &'static [&'static str],
}
