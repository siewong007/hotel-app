use std::collections::BTreeMap;

use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::Row;

use super::models::{
    DebtorRow, RateCalendarCell, RateCalendarRoomType, RevenueChannelMix, RevenueDailyPoint,
    RoomTypePerformance,
};
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

/// `RevenueRepository::pipeline` output — `earned` comes from the stay sums.
pub struct PipelineSums {
    pub booked: Decimal,
    /// Completed payments minus same-range refunds.
    pub collected: Decimal,
    pub outstanding: Decimal,
}

/// One open invoice with debtor identity resolved; ageing is computed in the
/// service so the bucketing rules stay unit-testable.
pub struct OpenInvoice {
    pub corporate_id: Option<uuid::Uuid>,
    pub debtor: DebtorRow,
    /// `COALESCE(due_date, issue_date)` — the date ageing anchors to.
    pub anchor: NaiveDate,
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
                    GREATEST(b.check_out_date - 1, b.check_in_date),
                    interval '1 day'
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
                    GREATEST(b.check_out_date - 1, b.check_in_date),
                    interval '1 day'
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
                other_revenue: Decimal::ZERO,
                room_nights_sold: row.get::<i64, _>("room_nights_sold"),
                // Ratios are filled in by the service, which owns the formulas.
                occupancy_rate: Decimal::ZERO,
                adr: Decimal::ZERO,
            })
            .collect())
    }

    /// Non-room revenue: `booking_services` rendered inside the range
    /// (service-date basis). Joins bookings/rooms so the optional room-type
    /// and channel filters apply the same way as the stay aggregates.
    pub async fn service_sums(
        pool: &DbPool,
        range: &RevenueRange,
        room_type_id: Option<i64>,
        channel_id: Option<i64>,
    ) -> Result<Decimal, ApiError> {
        let row = sqlx::query(
            r#"
            SELECT COALESCE(SUM(bs.total_price), 0) AS service_revenue
            FROM booking_services bs
            JOIN bookings b ON b.id = bs.booking_id
            JOIN rooms r ON r.id = b.room_id
            WHERE bs.status <> 'void'
              AND bs.service_date::date BETWEEN $1 AND $2
              AND ($3::bigint IS NULL OR r.room_type_id = $3)
              AND ($4::bigint IS NULL OR b.booking_channel_id = $4)
            "#,
        )
        .bind(range.from)
        .bind(range.to)
        .bind(room_type_id)
        .bind(channel_id)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(row.get::<Decimal, _>("service_revenue"))
    }

    /// Per-date service revenue for merging into the daily series.
    pub async fn daily_service(
        pool: &DbPool,
        range: &RevenueRange,
        room_type_id: Option<i64>,
        channel_id: Option<i64>,
    ) -> Result<Vec<(NaiveDate, Decimal)>, ApiError> {
        let rows = sqlx::query(
            r#"
            SELECT bs.service_date::date AS date,
                   COALESCE(SUM(bs.total_price), 0) AS other_revenue
            FROM booking_services bs
            JOIN bookings b ON b.id = bs.booking_id
            JOIN rooms r ON r.id = b.room_id
            WHERE bs.status <> 'void'
              AND bs.service_date::date BETWEEN $1 AND $2
              AND ($3::bigint IS NULL OR r.room_type_id = $3)
              AND ($4::bigint IS NULL OR b.booking_channel_id = $4)
            GROUP BY bs.service_date::date
            ORDER BY date
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
            .map(|row| {
                (
                    row.get::<NaiveDate, _>("date"),
                    row.get::<Decimal, _>("other_revenue"),
                )
            })
            .collect())
    }

    /// Per-room-type stay-date performance. `room_type_id` is intentionally
    /// not applied — this IS the per-type breakdown — while `channel_id`
    /// still scopes the stay nights.
    pub async fn room_type_performance(
        pool: &DbPool,
        range: &RevenueRange,
        channel_id: Option<i64>,
    ) -> Result<Vec<RoomTypePerformance>, ApiError> {
        let rows = sqlx::query(
            r#"
            WITH stay_nights AS (
                SELECT r.room_type_id, gs::date AS stay_date,
                       (b.subtotal / GREATEST(b.check_out_date - b.check_in_date, 1))
                           AS nightly_revenue
                FROM bookings b
                JOIN rooms r ON r.id = b.room_id
                CROSS JOIN LATERAL generate_series(
                    b.check_in_date,
                    GREATEST(b.check_out_date - 1, b.check_in_date),
                    interval '1 day'
                ) AS gs
                WHERE b.status NOT IN ('voided', 'comp_void', 'no_show')
                  AND ($3::bigint IS NULL OR b.booking_channel_id = $3)
                  AND gs::date BETWEEN $1 AND $2
            )
            SELECT rt.id AS room_type_id, rt.name,
                   (SELECT COUNT(*) FROM rooms pr
                     WHERE pr.room_type_id = rt.id AND pr.is_active = true
                       AND COALESCE(pr.status, 'available')
                           NOT IN ('maintenance', 'out_of_order')) AS rooms,
                   COALESCE(COUNT(sn.stay_date), 0) AS nights_sold,
                   COALESCE(SUM(sn.nightly_revenue), 0) AS room_revenue
            FROM room_types rt
            LEFT JOIN stay_nights sn ON sn.room_type_id = rt.id
            WHERE rt.is_active = true
            GROUP BY rt.id, rt.name
            ORDER BY room_revenue DESC, rt.name
            "#,
        )
        .bind(range.from)
        .bind(range.to)
        .bind(channel_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows
            .iter()
            .map(|row| RoomTypePerformance {
                room_type_id: row.get("room_type_id"),
                name: row.get("name"),
                rooms: row.get("rooms"),
                nights_sold: row.get("nights_sold"),
                // Ratios are derived in the service (single definition site).
                occupancy_rate: Decimal::ZERO,
                adr: Decimal::ZERO,
                room_revenue: row.get::<Decimal, _>("room_revenue"),
            })
            .collect())
    }

    /// Booked / collected / outstanding aggregates. `earned` is derived in the
    /// service from the stay sums — it is deliberately not re-queried here.
    pub async fn pipeline(
        pool: &DbPool,
        range: &RevenueRange,
        today: NaiveDate,
    ) -> Result<PipelineSums, ApiError> {
        let row = sqlx::query(
            r#"
            SELECT
                (SELECT COALESCE(SUM(COALESCE(b.net_revenue, b.subtotal)), 0)
                 FROM bookings b
                 WHERE b.check_in_date > $3
                   AND b.status NOT IN ('voided', 'comp_void', 'no_show')) AS booked,
                (SELECT COALESCE(SUM(p.amount), 0)
                 FROM payments p
                 WHERE p.status = 'completed'
                   AND p.created_at::date BETWEEN $1 AND $2) AS collected,
                (SELECT COALESCE(SUM(p.refund_amount), 0)
                 FROM payments p
                 WHERE p.refund_amount IS NOT NULL
                   AND p.refunded_at::date BETWEEN $1 AND $2) AS refunded,
                (SELECT COALESCE(SUM(i.balance_due), 0)
                 FROM invoices i
                 WHERE i.balance_due > 0
                   AND i.status IN ('issued', 'overdue')) AS outstanding
            "#,
        )
        .bind(range.from)
        .bind(range.to)
        .bind(today)
        .fetch_one(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(PipelineSums {
            booked: row.get("booked"),
            collected: row.get::<Decimal, _>("collected") - row.get::<Decimal, _>("refunded"),
            outstanding: row.get("outstanding"),
        })
    }

    /// Every open invoice (`issued`/`overdue` with a positive balance) with
    /// the debtor name resolved — guest nick_name, company name, or the
    /// invoice's own `billing_name` as fallback.
    pub async fn open_invoices(pool: &DbPool) -> Result<Vec<OpenInvoice>, ApiError> {
        let rows = sqlx::query(
            r#"
            SELECT i.invoice_number, i.billing_name,
                   i.bill_to_guest_id, i.bill_to_corporate_id,
                   i.issue_date, i.due_date, i.balance_due,
                   COALESCE(i.due_date, i.issue_date) AS anchor,
                   g.nick_name AS guest_name,
                   ca.name AS company_name,
                   r.room_number
            FROM invoices i
            LEFT JOIN guests g ON g.id = i.bill_to_guest_id
            LEFT JOIN corporate_accounts ca ON ca.id = i.bill_to_corporate_id
            LEFT JOIN bookings b ON b.id = i.booking_id
            LEFT JOIN rooms r ON r.id = b.room_id
            WHERE i.balance_due > 0
              AND i.status IN ('issued', 'overdue')
            ORDER BY i.balance_due DESC
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(ApiError::from)?;
        Ok(rows
            .iter()
            .map(|row| {
                let guest_name: Option<String> = row.get("guest_name");
                let company_name: Option<String> = row.get("company_name");
                let billing_name: String = row.get("billing_name");
                OpenInvoice {
                    corporate_id: row.get("bill_to_corporate_id"),
                    anchor: row.get("anchor"),
                    debtor: DebtorRow {
                        name: company_name.or(guest_name).unwrap_or(billing_name),
                        invoice_number: row.get("invoice_number"),
                        balance: row.get::<Decimal, _>("balance_due"),
                        // Filled by the service once the age is known.
                        bucket: "",
                        bucket_key: "",
                        due_date: row.get("due_date"),
                        room: row.get("room_number"),
                    },
                }
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
                   COALESCE(a.walk_in_reserved_rooms, 0)::bigint AS walk_in_reserved_rooms,
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
