use std::collections::BTreeMap;

use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::Row;

use super::models::{RateCalendarCell, RateCalendarRoomType, RevenueChannelMix, RevenueDailyPoint};
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
                JOIN rooms r ON r.id = b.room_id
                CROSS JOIN LATERAL generate_series(
                    b.check_in_date,
                    GREATEST(b.check_out_date - 1, b.check_in_date)
                ) AS gs
                WHERE b.status NOT IN ('voided', 'comp_void', 'no_show')
                  AND ($3::bigint IS NULL OR r.room_type_id = $3)
                  AND ($4::bigint IS NULL OR b.booking_channel_id = $4)
                  AND gs::date BETWEEN $1 AND $2
            ),
            created AS (
                SELECT b.status
                FROM bookings b
                JOIN rooms r ON r.id = b.room_id
                WHERE b.created_at::date BETWEEN $1 AND $2
                  AND ($3::bigint IS NULL OR r.room_type_id = $3)
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
                JOIN rooms r ON r.id = b.room_id
                CROSS JOIN LATERAL generate_series(
                    b.check_in_date,
                    GREATEST(b.check_out_date - 1, b.check_in_date)
                ) AS gs
                WHERE b.status NOT IN ('voided', 'comp_void', 'no_show')
                  AND ($3::bigint IS NULL OR r.room_type_id = $3)
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
            JOIN rooms r ON r.id = b.room_id
            LEFT JOIN booking_channels bc ON bc.id = b.booking_channel_id
            WHERE b.created_at::date BETWEEN $1 AND $2
              AND b.status NOT IN ('voided', 'comp_void')
              AND ($3::bigint IS NULL OR r.room_type_id = $3)
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

    /// Resolved staff rate calendar: one cell per active room type × stay
    /// date. The rate-resolution predicate mirrors
    /// `RateRepository::applicable_rate` (plan active, validity window,
    /// day-of-week flags, band bounds, `priority DESC, rr.id DESC`) — keep
    /// the two in sync. Falls back to `room_types.base_price`. Occupancy
    /// counts rooms holding a sold-status booking on the stay date, over
    /// sellable physical rooms (active, not maintenance/out-of-order) — the
    /// same denominators the online-inventory grid uses.
    pub async fn rate_calendar(
        pool: &DbPool,
        range: &RevenueRange,
    ) -> Result<(Vec<RateCalendarRoomType>, Vec<RateCalendarCell>), ApiError> {
        let rows = sqlx::query(
            r#"
            WITH dates AS (
                SELECT generate_series($1::date, $2::date, interval '1 day')::date
                    AS stay_date
            ),
            rts AS (
                SELECT id, code, name, base_price FROM room_types WHERE is_active = true
            )
            SELECT rt.id AS room_type_id, rt.code, rt.name, d.stay_date,
                   COALESCE(resolved.price, rt.base_price) AS plan_rate,
                   COALESCE(resolved.rate_plan_code, 'BASE') AS rate_plan_code,
                   (resolved.price IS NULL) AS is_base_rate,
                   a.custom_price AS custom_price,
                   COALESCE(a.online_booking_enabled, true) AS online_booking_enabled,
                   COALESCE(a.walk_in_reserved_rooms, 0) AS walk_in_reserved_rooms,
                   phys.cnt AS physical_rooms,
                   COALESCE(sold.cnt, 0)::bigint AS sold_rooms
            FROM rts rt
            CROSS JOIN dates d
            LEFT JOIN LATERAL (
                SELECT rr.price, rp.code AS rate_plan_code
                FROM room_rates rr
                JOIN rate_plans rp ON rr.rate_plan_id = rp.id
                WHERE rr.room_type_id = rt.id
                  AND rp.is_active = true
                  AND rr.effective_from <= d.stay_date
                  AND (rr.effective_to IS NULL OR rr.effective_to >= d.stay_date)
                  AND (rp.valid_from IS NULL OR rp.valid_from <= d.stay_date)
                  AND (rp.valid_to IS NULL OR rp.valid_to >= d.stay_date)
                  AND CASE extract(isodow FROM d.stay_date)
                        WHEN 1 THEN rp.applies_monday
                        WHEN 2 THEN rp.applies_tuesday
                        WHEN 3 THEN rp.applies_wednesday
                        WHEN 4 THEN rp.applies_thursday
                        WHEN 5 THEN rp.applies_friday
                        WHEN 6 THEN rp.applies_saturday
                        ELSE rp.applies_sunday
                      END
                ORDER BY rp.priority DESC, rr.id DESC
                LIMIT 1
            ) resolved ON true
            LEFT JOIN online_inventory_allocations a
                   ON a.room_type_id = rt.id AND a.stay_date = d.stay_date
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::bigint AS cnt FROM rooms r
                WHERE r.room_type_id = rt.id AND r.is_active = true
                  AND COALESCE(r.status, 'available')
                      NOT IN ('maintenance', 'out_of_order')
            ) phys ON true
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS cnt FROM bookings b
                JOIN rooms r ON r.id = b.room_id
                WHERE r.room_type_id = rt.id
                  AND r.is_active = true
                  AND COALESCE(r.status, 'available')
                      NOT IN ('maintenance', 'out_of_order')
                  AND b.status NOT IN ('voided', 'comp_void', 'no_show')
                  AND b.check_in_date <= d.stay_date
                  AND b.check_out_date > d.stay_date
            ) sold ON true
            ORDER BY rt.name, d.stay_date
            "#,
        )
        .bind(range.from)
        .bind(range.to)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;

        let mut room_types: BTreeMap<i64, RateCalendarRoomType> = BTreeMap::new();
        let mut cells = Vec::with_capacity(rows.len());
        for row in &rows {
            let room_type_id: i64 = row.get("room_type_id");
            room_types
                .entry(room_type_id)
                .or_insert_with(|| RateCalendarRoomType {
                    room_type_id,
                    code: row.get("code"),
                    name: row.get("name"),
                });
            let plan_rate: Decimal = row.get("plan_rate");
            let custom_price: Option<Decimal> = row.get("custom_price");
            let physical_rooms: i64 = row.get("physical_rooms");
            let sold_rooms: i64 = row.get("sold_rooms");
            let occupancy_pct = if physical_rooms > 0 {
                (Decimal::from(sold_rooms) * Decimal::from(100) / Decimal::from(physical_rooms))
                    .round_dp(1)
            } else {
                Decimal::ZERO
            };
            cells.push(RateCalendarCell {
                room_type_id,
                stay_date: row.get("stay_date"),
                rate_plan_code: row.get("rate_plan_code"),
                plan_rate,
                is_base_rate: row.get("is_base_rate"),
                custom_price,
                effective_rate: custom_price.unwrap_or(plan_rate),
                physical_rooms,
                sold_rooms,
                available_rooms: (physical_rooms - sold_rooms).max(0),
                occupancy_pct,
                online_booking_enabled: row.get("online_booking_enabled"),
                walk_in_reserved_rooms: row.get("walk_in_reserved_rooms"),
            });
        }
        Ok((room_types.into_values().collect(), cells))
    }
}
