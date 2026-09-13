//! Insights service — typed overview KPIs plus the envelope adapter that
//! wraps legacy report payloads into [`ReportEnvelope`].

use chrono::Utc;
use serde_json::Value;

use crate::core::db::{DbPool, hotel_today};
use crate::core::error::ApiError;
use crate::models::ReportQuery;
use crate::modules::insights::models::{
    InsightsOverview, KpiFormat, ReportCatalogEntry, ReportColumn, ReportEnvelope, ReportKpi,
    ReportMeta, ReportSection, RevenuePoint,
};
use crate::modules::insights::{queries, report_catalog};

/// Query params for `GET /api/insights/reports/{id}` — `ReportQuery` minus the
/// path-carried `report_type`.
#[derive(Debug, serde::Deserialize)]
pub struct InsightsReportQuery {
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

pub async fn overview(pool: &DbPool) -> Result<InsightsOverview, ApiError> {
    let today = hotel_today(pool).await?;

    let (rooms, room_types) = queries::room_buckets(pool, today).await?;
    let bookings = queries::booking_kpis(pool, today).await?;
    let guests_total = queries::guests_total(pool).await?;
    let revenue_today = queries::revenue_for_date(pool, today).await?;

    let mut revenue_last_7_days = Vec::with_capacity(7);
    for days_ago in (0..7).rev() {
        let date = today - chrono::Duration::days(days_ago);
        let revenue = queries::revenue_for_date(pool, date).await?;
        revenue_last_7_days.push(RevenuePoint { date, revenue });
    }

    let occupancy_rate = if rooms.total > 0 {
        rooms.occupied as f64 / rooms.total as f64 * 100.0
    } else {
        0.0
    };

    Ok(InsightsOverview {
        business_date: today,
        occupancy_rate,
        rooms,
        bookings,
        revenue_today,
        revenue_last_7_days,
        guests_total,
        room_types,
    })
}

pub fn catalog() -> &'static [ReportCatalogEntry] {
    report_catalog::CATALOG
}

/// Run a catalog report and wrap its payload in the typed envelope. Unknown
/// ids are a 404 — the catalog is the allowlist.
pub async fn report_envelope(
    pool: &DbPool,
    user_id: i64,
    report_id: &str,
    query: InsightsReportQuery,
) -> Result<ReportEnvelope, ApiError> {
    let entry = report_catalog::find(report_id)
        .ok_or_else(|| ApiError::NotFound(format!("Unknown report: {report_id}")))?;

    let params = ReportQuery {
        report_type: report_id.to_string(),
        start_date: query.start_date.clone(),
        end_date: query.end_date.clone(),
        shift: query.shift.clone(),
        drawer: query.drawer.clone(),
        company_name: query.company_name.clone(),
        booking_channel_id: query.booking_channel_id,
        booking_channel: query.booking_channel.clone(),
        platform_name: query.platform_name.clone(),
        booking_status: query.booking_status.clone(),
        posted_status: query.posted_status.clone(),
        room_type: query.room_type.clone(),
    };

    // Services layer keeps the generation audit event on the new path too.
    let payload = crate::services::analytics::generate_report(pool, user_id, params).await?;

    Ok(wrap_payload(entry, &query, payload))
}

// ---------------------------------------------------------------------------
// Payload → envelope adapter
// ---------------------------------------------------------------------------
//
// Deliberately generic: every report returns an object whose fields fall into
// four shapes — `period` (range metadata), `summary` (headline KPIs), arrays
// of objects (table sections), scalar maps (2-column sections), and scalars
// (KPIs when numeric). Declared-per-type mapping would just restate what the
// payload already says.

fn titleize(key: &str) -> String {
    key.split('_')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().chain(c).collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn guess_format(key: &str, value: &Value) -> KpiFormat {
    if !value.is_number() {
        return KpiFormat::Text;
    }
    let k = key.to_ascii_lowercase();
    if k.contains("rate") || k.contains("pct") || k.ends_with("_percent") {
        KpiFormat::Percent
    } else if [
        "revenue",
        "amount",
        "balance",
        "due",
        "adr",
        "revpar",
        "price",
        "debit",
        "credit",
        "paid",
        "discount",
        "payout",
        "commission",
        "earnings",
    ]
    .iter()
    .any(|m| k.contains(m))
    {
        KpiFormat::Currency
    } else {
        KpiFormat::Number
    }
}

fn columns_for(rows: &[serde_json::Map<String, Value>]) -> Vec<ReportColumn> {
    let mut columns: Vec<ReportColumn> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for row in rows {
        for (key, value) in row {
            if seen.insert(key.clone()) {
                columns.push(ReportColumn {
                    key: key.clone(),
                    label: titleize(key),
                    format: guess_format(key, value),
                });
            }
        }
    }
    columns
}

fn wrap_payload(
    entry: &ReportCatalogEntry,
    query: &InsightsReportQuery,
    payload: Value,
) -> ReportEnvelope {
    let mut kpis = Vec::new();
    let mut sections = Vec::new();
    let mut range_start = None;
    let mut range_end = None;

    if let Value::Object(fields) = &payload {
        for (key, value) in fields {
            match (key.as_str(), value) {
                ("period", Value::Object(period)) => {
                    range_start = period
                        .get("start")
                        .and_then(Value::as_str)
                        .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
                    range_end = period
                        .get("end")
                        .and_then(Value::as_str)
                        .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
                }
                ("summary", Value::Object(summary)) => {
                    for (k, v) in summary {
                        kpis.push(ReportKpi {
                            key: k.clone(),
                            label: titleize(k),
                            value: v.clone(),
                            format: guess_format(k, v),
                        });
                    }
                }
                (_, Value::Array(items)) if items.first().is_some_and(Value::is_object) => {
                    let rows: Vec<serde_json::Map<String, Value>> = items
                        .iter()
                        .filter_map(|i| i.as_object().cloned())
                        .collect();
                    let columns = columns_for(&rows);
                    sections.push(ReportSection {
                        key: key.clone(),
                        title: titleize(key),
                        columns,
                        rows,
                    });
                }
                // Scalar maps (e.g. room_status counts) → two-column section.
                (_, Value::Object(map)) if map.values().all(Value::is_number) => {
                    let rows: Vec<serde_json::Map<String, Value>> = map
                        .iter()
                        .map(|(k, v)| {
                            [
                                ("name".to_string(), Value::String(k.clone())),
                                ("value".to_string(), v.clone()),
                            ]
                            .into_iter()
                            .collect()
                        })
                        .collect();
                    sections.push(ReportSection {
                        key: key.clone(),
                        title: titleize(key),
                        columns: vec![
                            ReportColumn {
                                key: "name".into(),
                                label: "Name".into(),
                                format: KpiFormat::Text,
                            },
                            ReportColumn {
                                key: "value".into(),
                                label: "Value".into(),
                                format: KpiFormat::Number,
                            },
                        ],
                        rows,
                    });
                }
                // Numeric scalars are headline numbers; string scalars are
                // type discriminators (e.g. "type": "statement") and drop.
                (_, v) if v.is_number() || v.is_boolean() => kpis.push(ReportKpi {
                    key: key.clone(),
                    label: titleize(key),
                    value: v.clone(),
                    format: guess_format(key, v),
                }),
                _ => {}
            }
        }
    }

    ReportEnvelope {
        meta: ReportMeta {
            report_id: entry.id.to_string(),
            title: entry.title.to_string(),
            generated_at: Utc::now(),
            date_basis: entry.date_basis,
            range_start,
            range_end,
            filters: serde_json::json!({
                "start_date": query.start_date,
                "end_date": query.end_date,
                "shift": query.shift,
                "drawer": query.drawer,
                "company_name": query.company_name,
                "booking_channel_id": query.booking_channel_id,
                "booking_channel": query.booking_channel,
                "platform_name": query.platform_name,
                "booking_status": query.booking_status,
                "posted_status": query.posted_status,
                "room_type": query.room_type,
            }),
        },
        kpis,
        sections,
    }
}
