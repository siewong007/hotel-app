use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::Row;

use super::models::{RevenueChannelMix, RevenueDailyPoint};
use super::validation::RevenueRange;
use crate::core::db::DbPool;
use crate::core::error::ApiError;

/// Raw stay-window aggregates; every ratio metric is derived in the service
/// so the definitions live in exactly one place.
pub struct StaySums {
    pub room_revenue: Decimal,
    pub room_nights_sold: i64,
    /// Distinct bookings with at least one counted night in range.
    pub stay_bookings: i64,
    /// Bookings created inside the range (booking-date basis).
    pub bookings_created: i64,
    /// Created bookings that ended `voided`/`comp_void` (the cancellation set).
    pub voided_created: i64,
    /// Created bookings that ended `no_show`.
    pub no_show_created: i64,
    /// Sellable inventory: all rooms except `out_of_order`.
    pub sellable_rooms: i64,
}

pub struct RevenueRepository;

impl RevenueRepository {
    /// Aggregate one stay-date window. `$1`/`$2` are inclusive bounds; `$3`
    /// and `$4` are optional `room_type_id`/`booking_channel_id` filters
    /// (`NULL` binds disable them).
    pub async fn stay_sums(
        pool: &DbPool,
        range: &RevenueRange,
        room_type_id: Option<i64>,
        channel_id: Option<i64>,
    ) -> Result<StaySums, ApiError> {
        let row = sqlx::query(
            r#"
            WITH stay_nights AS (
                SELECT b.id AS booking_id, gs::date AS stay_date,
                       (b.subtotal / GREATEST(b.check_out_date - b.check_in_date, 1))
                           AS nightly_revenue
                FROM bookings b
                CROSS JOIN LATERAL generate_series(
                    b.check_in_date,
                    GREATEST(b.check_out_date - 1, b.check_in_date)
                ) AS gs
                WHERE b.status NOT IN ('voided', 'comp_void', 'no_show')
                  AND ($3::bigint IS NULL OR b.room_type_id = $3)
                  AND ($4::bigint IS NULL OR b.booking_channel_id = $4)
                  AND gs::date BETWEEN $1 AND $2
            ),
            created AS (
                SELECT b.status
                FROM bookings b
                WHERE b.created_at::date BETWEEN $1 AND $2
                  AND ($3::bigint IS NULL OR b.room_type_id = $3)
                  AND ($4::bigint IS NULL OR b.booking_channel_id = $4)
            )
            SELECT
                COALESCE((SELECT SUM(nightly_revenue) FROM stay_nights), 0) AS room_revenue,
                (SELECT COUNT(*) FROM stay_nights) AS room_nights_sold,
                (SELECT COUNT(DISTINCT booking_id) FROM stay_nights) AS stay_bookings,
                (SELECT COUNT(*) FROM created) AS bookings_created,
                (SELECT COUNT(*) FROM created
                    WHERE status IN ('voided', 'comp_void')) AS voided_created,
                (SELECT COUNT(*) FROM created WHERE status = 'no_show') AS no_show_created,
                (SELECT COUNT(*) FROM rooms WHERE status <> 'out_of_order') AS sellable_rooms
            "#,
        )
            .bind(range.from)
            .bind(range.to)
            .bind(room_type_id)
            .bind(channel_id)
            .fetch_one(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(StaySums {
            room_revenue: row.get::<Decimal, _>("room_revenue"),
            room_nights_sold: row.get::<i64, _>("room_nights_sold"),
            stay_bookings: row.get::<i64, _>("stay_bookings"),
            bookings_created: row.get::<i64, _>("bookings_created"),
            voided_created: row.get::<i64, _>("voided_created"),
            no_show_created: row.get::<i64, _>("no_show_created"),
            sellable_rooms: row.get::<i64, _>("sellable_rooms"),
        })
    }

    /// Per-stay-date series for the range (sold-status set only).
    pub async fn daily(
        pool: &DbPool,
        range: &RevenueRange,
        room_type_id: Option<i64>,
        channel_id: Option<i64>,
    ) -> Result<Vec<RevenueDailyPoint>, ApiError> {
        let rows = sqlx::query(
            r#"
            WITH stay_nights AS (
                SELECT gs::date AS stay_date,
                       (b.subtotal / GREATEST(b.check_out_date - b.check_in_date, 1))
                           AS nightly_revenue
                FROM bookings b
                CROSS JOIN LATERAL generate_series(
                    b.check_in_date,
                    GREATEST(b.check_out_date - 1, b.check_in_date)
                ) AS gs
                WHERE b.status NOT IN ('voided', 'comp_void', 'no_show')
                  AND ($3::bigint IS NULL OR b.room_type_id = $3)
                  AND ($4::bigint IS NULL OR b.booking_channel_id = $4)
                  AND gs::date BETWEEN $1 AND $2
            )
            SELECT stay_date AS date,
                   COALESCE(SUM(nightly_revenue), 0) AS room_revenue,
                   COUNT(*) AS room_nights_sold
            FROM stay_nights
            GROUP BY stay_date
            ORDER BY stay_date
            "#,
        )
            .bind(range.from)
            .bind(range.to)
            .bind(room_type_id)
            .bind(channel_id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(rows
            .iter()
            .map(|row| RevenueDailyPoint {
                date: row.get::<NaiveDate, _>("date"),
                room_revenue: row.get::<Decimal, _>("room_revenue"),
                room_nights_sold: row.get::<i64, _>("room_nights_sold"),
                // Ratios are filled in by the service, which owns the formulas.
                occupancy_rate: Decimal::ZERO,
                adr: Decimal::ZERO,
            })
            .collect())
    }

    /// Channel attribution for bookings CREATED in the range. Bookings with no
    /// `booking_channel_id` report as Direct; `net_revenue` falls back to
    /// `subtotal` for rows written before channel commission tracking.
    pub async fn channel_mix(
        pool: &DbPool,
        range: &RevenueRange,
        room_type_id: Option<i64>,
        channel_id: Option<i64>,
    ) -> Result<Vec<RevenueChannelMix>, ApiError> {
        let rows = sqlx::query(
            r#"
            SELECT b.booking_channel_id AS channel_id,
                   COALESCE(bc.name, 'Direct') AS channel_name,
                   COALESCE(bc.channel_type, 'direct') AS channel_type,
                   COUNT(*) AS bookings,
                   COALESCE(SUM(COALESCE(b.net_revenue, b.subtotal)), 0) AS net_revenue
            FROM bookings b
            LEFT JOIN booking_channels bc ON bc.id = b.booking_channel_id
            WHERE b.created_at::date BETWEEN $1 AND $2
              AND b.status NOT IN ('voided', 'comp_void')
              AND ($3::bigint IS NULL OR b.room_type_id = $3)
              AND ($4::bigint IS NULL OR b.booking_channel_id = $4)
            GROUP BY b.booking_channel_id, bc.name, bc.channel_type
            ORDER BY net_revenue DESC
            "#,
        )
        .bind(range.from)
        .bind(range.to)
        .bind(room_type_id)
        .bind(channel_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows
            .iter()
            .map(|row| RevenueChannelMix {
                channel_id: row.get::<Option<i64>, _>("channel_id"),
                channel_name: row.get::<String, _>("channel_name"),
                channel_type: row.get::<String, _>("channel_type"),
                bookings: row.get::<i64, _>("bookings"),
                net_revenue: row.get::<Decimal, _>("net_revenue"),
                // share_pct is filled in by the service against the total.
                share_pct: Decimal::ZERO,
            })
            .collect())
    }
}
