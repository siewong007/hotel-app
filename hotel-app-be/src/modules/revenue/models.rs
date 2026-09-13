use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct RevenueOverviewQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub room_type_id: Option<i64>,
    pub channel_id: Option<i64>,
}

/// Headline metrics for one stay-date window. Ratios are pre-computed; all
/// division guards collapse to zero rather than null so the UI never has to
/// special-case empty data.
#[derive(Debug, Clone, Serialize, Default)]
pub struct RevenueKpis {
    /// `subtotal / nights` summed across the stay nights inside the range.
    pub room_revenue: Decimal,
    /// Occupied stay nights inside the range.
    pub room_nights_sold: i64,
    /// Sold room-nights ÷ (sellable rooms × days) × 100, one decimal.
    pub occupancy_rate: Decimal,
    /// Room revenue ÷ room nights sold.
    pub adr: Decimal,
    /// Room revenue ÷ (sellable rooms × days).
    pub revpar: Decimal,
    /// Counted nights per booking with at least one night in range.
    pub alos_nights: Decimal,
    /// Bookings created inside the range (booking-date basis).
    pub bookings_created: i64,
    /// Share of created bookings that ended voided/comp_void, one decimal.
    pub void_rate: Decimal,
    /// Share of created bookings that ended no_show, one decimal.
    pub no_show_rate: Decimal,
    /// Net-revenue share of direct-type channels
    /// (direct/website/walk_in/phone), one decimal.
    pub direct_share: Decimal,
}

#[derive(Debug, Serialize)]
pub struct RevenueDailyPoint {
    pub date: NaiveDate,
    pub room_revenue: Decimal,
    pub room_nights_sold: i64,
    pub occupancy_rate: Decimal,
    pub adr: Decimal,
}

#[derive(Debug, Serialize)]
pub struct RevenueChannelMix {
    /// `None` for bookings with no `booking_channel_id` (unattributed direct).
    pub channel_id: Option<i64>,
    pub channel_name: String,
    pub channel_type: String,
    pub bookings: i64,
    pub net_revenue: Decimal,
    pub share_pct: Decimal,
}

#[derive(Debug, Serialize)]
pub struct RevenueRangeInfo {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

#[derive(Debug, Serialize)]
pub struct RevenueOverview {
    /// Stay-date window actually reported (`to` = last counted night).
    pub range: RevenueRangeInfo,
    pub currency: String,
    pub kpis: RevenueKpis,
    /// Same-length window immediately before `range.from`.
    pub previous_period: RevenueRangeInfo,
    pub previous_kpis: RevenueKpis,
    /// KPI name → percent change vs previous period; JSON null where the
    /// previous value is zero so the UI never shows a fake "infinite" delta.
    pub deltas_pct: serde_json::Value,
    /// Stay-date basis daily series.
    pub daily: Vec<RevenueDailyPoint>,
    /// Booking-creation-date basis channel attribution.
    pub channels: Vec<RevenueChannelMix>,
}
