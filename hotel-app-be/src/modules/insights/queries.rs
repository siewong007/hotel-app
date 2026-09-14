//! KPI queries — the single definition site for dashboard/overview metrics.
//!
//! The room-status derivation below mirrors `GET_ROOMS_QUERY` in
//! `repositories/rooms_queries.rs` (stored status ∪ current booking state)
//! and the bucket mapping the dashboard previously computed client-side.
//! Changing the definition here changes it everywhere.

use std::collections::HashMap;

use chrono::NaiveDate;
use sqlx::Row;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::modules::insights::models::{BookingKpis, RoomBuckets, RoomTypeLoad};

/// Buckets `derived status` the way the dashboard's `buildDashboardAnalyticsData`
/// did: occupied; reserved (arriving ≤ today); cleaning (dirty states);
/// maintenance; everything else available.
fn status_bucket(derived: &str) -> &'static str {
    match derived {
        "occupied" => "occupied",
        "reserved" => "reserved",
        "dirty" | "cleaning" | "reserved_dirty" => "cleaning",
        "maintenance" | "out_of_order" => "maintenance",
        _ => "available",
    }
}

/// Per-room derived status + room type, mirroring the room list's CASE.
const DERIVED_ROOMS: &str = r#"
WITH current_bookings AS (
    SELECT DISTINCT ON (room_id)
        room_id,
        status as booking_status,
        check_in_date
    FROM bookings
    WHERE status IN ('reserved', 'confirmed', 'checked_in', 'auto_checked_in',
                     'pending', 'pending_payment', 'pending_confirmation')
      AND check_out_date >= $1
    ORDER BY room_id,
        CASE
            WHEN status IN ('checked_in', 'auto_checked_in') THEN 1
            WHEN status = 'confirmed' AND check_in_date <= $1 THEN 2
            WHEN status = 'confirmed' THEN 3
            WHEN status IN ('pending', 'pending_payment', 'pending_confirmation')
                 AND check_in_date <= $1 THEN 4
            ELSE 5
        END,
        check_in_date
)
SELECT
    rt.name AS room_type,
    CASE
        WHEN cb.booking_status IN ('checked_in', 'auto_checked_in') THEN 'occupied'
        WHEN r.status IN ('maintenance', 'out_of_order', 'dirty', 'cleaning', 'reserved_dirty')
            THEN r.status
        WHEN cb.booking_status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')
             AND cb.check_in_date <= $1 THEN 'reserved'
        ELSE 'available'
    END AS derived_status
FROM rooms r
INNER JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN current_bookings cb ON cb.room_id = r.id
WHERE r.is_active = true
"#;

/// Active rooms grouped into the dashboard's operational buckets.
pub async fn room_buckets(
    pool: &DbPool,
    today: NaiveDate,
) -> Result<(RoomBuckets, Vec<RoomTypeLoad>), ApiError> {
    let rows = sqlx::query(DERIVED_ROOMS)
        .bind(today)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut buckets = RoomBuckets {
        total: 0,
        occupied: 0,
        reserved: 0,
        available: 0,
        cleaning: 0,
        maintenance: 0,
    };
    let mut by_type: HashMap<String, (i64, i64)> = HashMap::new();

    for row in &rows {
        let derived: &str = row.get("derived_status");
        let bucket = status_bucket(derived);
        buckets.total += 1;
        match bucket {
            "occupied" => buckets.occupied += 1,
            "reserved" => buckets.reserved += 1,
            "cleaning" => buckets.cleaning += 1,
            "maintenance" => buckets.maintenance += 1,
            _ => buckets.available += 1,
        }
        let entry = by_type
            .entry(row.get::<String, _>("room_type"))
            .or_insert((0, 0));
        entry.0 += 1;
        if bucket == "occupied" {
            entry.1 += 1;
        }
    }

    let mut types: Vec<RoomTypeLoad> = by_type
        .into_iter()
        .map(|(name, (total, occupied))| RoomTypeLoad {
            name,
            total,
            occupied,
            available: total - occupied,
        })
        .collect();
    types.sort_by(|a, b| a.name.cmp(&b.name));

    Ok((buckets, types))
}

/// Booking counters — the same status predicates `get_booking_stats_handler`
/// uses, consolidated into one pass per counter.
pub async fn booking_kpis(pool: &DbPool, today: NaiveDate) -> Result<BookingKpis, ApiError> {
    let row = sqlx::query(
        "SELECT
            COUNT(*) FILTER (WHERE status != 'voided') AS total,
            COUNT(*) FILTER (WHERE status = 'checked_in') AS checked_in,
            COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
            COUNT(*) FILTER (WHERE status IN ('pending', 'confirmed')) AS pending,
            COUNT(*) FILTER (WHERE status IN ('pending', 'confirmed', 'checked_in', 'auto_checked_in')) AS active,
            COUNT(*) FILTER (WHERE status IN ('pending', 'confirmed') AND check_in_date = $1) AS today_check_ins,
            COUNT(*) FILTER (WHERE status IN ('checked_in', 'auto_checked_in', 'checked_out', 'completed') AND check_out_date = $1) AS today_check_outs
         FROM bookings",
    )
    .bind(today)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(BookingKpis {
        total: row.get("total"),
        checked_in: row.get("checked_in"),
        confirmed: row.get("confirmed"),
        pending: row.get("pending"),
        active: row.get("active"),
        today_check_ins: row.get("today_check_ins"),
        today_check_outs: row.get("today_check_outs"),
    })
}

pub async fn guests_total(pool: &DbPool) -> Result<i64, ApiError> {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM guests WHERE deleted_at IS NULL")
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
}

/// Revenue from non-voided bookings created on `date` — the definition the
/// dashboard revenue strip and booking stats have always used.
pub async fn revenue_for_date(pool: &DbPool, date: NaiveDate) -> Result<f64, ApiError> {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(total_amount), 0) AS revenue
         FROM bookings
         WHERE status != 'voided' AND created_at::date = $1",
    )
    .bind(date)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(decimal_to_f64(crate::models::row_mappers::get_decimal(
        &row, "revenue",
    )))
}

fn decimal_to_f64(value: rust_decimal::Decimal) -> f64 {
    value.to_string().parse::<f64>().unwrap_or(0.0)
}
