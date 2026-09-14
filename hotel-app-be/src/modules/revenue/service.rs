use chrono::{Duration, NaiveDate};
use rust_decimal::Decimal;
use serde_json::{Value, json};

use super::models::{
    DebtorRow, RateCalendar, RateCalendarQuery, Receivables, ReceivablesBucket,
    RevenueChannelMix, RevenueDailyPoint, RevenueKpis, RevenueOverview,
    RevenueOverviewQuery, RevenuePipeline, RevenueRangeInfo, RoomTypePerformance,
};
use super::repository::{RevenueRepository, StaySums};
use super::validation::{RevenueRange, revenue_range};
use crate::core::db::{DbPool, hotel_today};
use crate::core::error::ApiError;

/// Channel types that count as direct business for `direct_share`
/// (verified against `booking_channels_channel_type_check`).
const DIRECT_CHANNEL_TYPES: [&str; 4] = ["direct", "website", "walk_in", "phone"];

/// Window used when the caller supplies neither bound: trailing 30 days.
const DEFAULT_RANGE_DAYS: i64 = 30;

/// Default rate-calendar window: two weeks starting today.
const DEFAULT_CALENDAR_DAYS: i64 = 14;

/// Ageing buckets by days past `COALESCE(due_date, issue_date)`; `<= 0` is
/// "Current" (issued but not yet due).
const AGE_BUCKETS: [(&str, &str); 5] = [
    ("current", "Current"),
    ("1_30", "1–30 days"),
    ("31_60", "31–60 days"),
    ("61_90", "61–90 days"),
    ("90_plus", "90+ days"),
];

const TOP_DEBTORS: usize = 5;

fn age_bucket(days_past_due: i64) -> (&'static str, &'static str) {
    match days_past_due {
        i64::MIN..=0 => AGE_BUCKETS[0],
        1..=30 => AGE_BUCKETS[1],
        31..=60 => AGE_BUCKETS[2],
        61..=90 => AGE_BUCKETS[3],
        _ => AGE_BUCKETS[4],
    }
}

pub struct RevenueService;

impl RevenueService {
    pub async fn overview(
        pool: &DbPool,
        query: RevenueOverviewQuery,
    ) -> Result<RevenueOverview, ApiError> {
        let range = resolve_range(pool, &query).await?;
        let days = (range.to - range.from).num_days() + 1;
        let today = hotel_today(pool).await.map_err(ApiError::from)?;
        // Same-length window immediately before the reported range.
        let previous = RevenueRange {
            from: range.from - Duration::days(days),
            to: range.from - Duration::days(1),
        };
        let (
            current,
            prior,
            mut daily,
            mut channels,
            service_revenue,
            prior_service_revenue,
            daily_service,
            mut room_types,
            pipeline_sums,
        ) = tokio::try_join!(
            RevenueRepository::stay_sums(pool, &range, query.room_type_id, query.channel_id),
            RevenueRepository::stay_sums(pool, &previous, query.room_type_id, query.channel_id),
            RevenueRepository::daily(pool, &range, query.room_type_id, query.channel_id),
            RevenueRepository::channel_mix(pool, &range, query.room_type_id, query.channel_id),
            RevenueRepository::service_sums(pool, &range, query.room_type_id, query.channel_id),
            RevenueRepository::service_sums(pool, &previous, query.room_type_id, query.channel_id),
            RevenueRepository::daily_service(pool, &range, query.room_type_id, query.channel_id),
            RevenueRepository::room_type_performance(pool, &range, query.channel_id),
            RevenueRepository::pipeline(pool, &range, today),
        )?;
        let direct_share = direct_share(&channels);
        let current_kpis = kpis(&current, days, direct_share, service_revenue);
        let previous_kpis = kpis(&prior, days, Decimal::ZERO, prior_service_revenue);
        merge_daily_service(&mut daily, &daily_service);
        fill_daily(&mut daily, current.sellable_rooms);
        fill_channel_shares(&mut channels);
        fill_room_type_performance(&mut room_types, days);
        let pipeline = RevenuePipeline {
            booked: pipeline_sums.booked.round_dp(2),
            earned: current_kpis.room_revenue,
            collected: pipeline_sums.collected.round_dp(2),
            outstanding: pipeline_sums.outstanding.round_dp(2),
        };
        Ok(RevenueOverview {
            range: RevenueRangeInfo {
                from: range.from,
                to: range.to,
            },
            currency: currency(pool).await,
            previous_period: RevenueRangeInfo {
                from: previous.from,
                to: previous.to,
            },
            deltas_pct: deltas(&current_kpis, &previous_kpis),
            kpis: current_kpis,
            previous_kpis,
            daily,
            channels,
            room_types,
            pipeline,
        })
    }

    /// Receivables ageing + top debtors, anchored to the hotel business day.
    /// Invoices are fetched once and bucketed in Rust so the boundary rules
    /// stay unit-testable.
    pub async fn receivables(pool: &DbPool) -> Result<Receivables, ApiError> {
        let today = hotel_today(pool).await.map_err(ApiError::from)?;
        let open = RevenueRepository::open_invoices(pool).await?;

        let mut buckets: Vec<ReceivablesBucket> = AGE_BUCKETS
            .iter()
            .map(|(key, label)| ReceivablesBucket {
                key,
                label,
                total: Decimal::ZERO,
                count: 0,
            })
            .collect();
        let mut guests: Vec<DebtorRow> = Vec::new();
        let mut companies: Vec<DebtorRow> = Vec::new();
        let mut total = Decimal::ZERO;

        for mut inv in open {
            let days = (today - inv.anchor).num_days();
            let (key, label) = age_bucket(days);
            let bucket = buckets.iter_mut().find(|b| b.key == key).unwrap();
            bucket.total += inv.debtor.balance;
            bucket.count += 1;
            total += inv.debtor.balance;
            inv.debtor.bucket = label;
            // `bill_to_corporate_id` marks company receivables; everything
            // else (guest-linked or unclassified billing name) lands on the
            // guest tab.
            if inv.corporate_id.is_some() {
                companies.push(inv.debtor);
            } else {
                guests.push(inv.debtor);
            }
        }

        guests.truncate(TOP_DEBTORS);
        companies.truncate(TOP_DEBTORS);

        Ok(Receivables {
            as_of: today,
            total,
            buckets,
            guests,
            companies,
        })
    }

    /// Staff rate calendar. Unlike the overview (trailing window), an
    /// unbounded request defaults to a forward-looking 14-day window —
    /// rate management looks ahead, not back.
    pub async fn rate_calendar(
        pool: &DbPool,
        query: RateCalendarQuery,
    ) -> Result<RateCalendar, ApiError> {
        let range = match (&query.from, &query.to) {
            (Some(from), Some(to)) => revenue_range(from, to)?,
            (None, None) => {
                let from = hotel_today(pool).await.map_err(ApiError::from)?;
                RevenueRange {
                    from,
                    to: from + Duration::days(DEFAULT_CALENDAR_DAYS - 1),
                }
            }
            _ => {
                return Err(ApiError::BadRequest(
                    "'from' and 'to' must be provided together".to_string(),
                ));
            }
        };
        let (room_types, cells) = RevenueRepository::rate_calendar(pool, &range).await?;
        Ok(RateCalendar {
            from: range.from,
            to: range.to,
            room_types,
            cells,
        })
    }
}

async fn resolve_range(
    pool: &DbPool,
    query: &RevenueOverviewQuery,
) -> Result<RevenueRange, ApiError> {
    match (&query.from, &query.to) {
        (Some(from), Some(to)) => revenue_range(from, to),
        (None, None) => {
            let to = hotel_today(pool).await.map_err(ApiError::from)?;
            Ok(RevenueRange {
                from: to - Duration::days(DEFAULT_RANGE_DAYS - 1),
                to,
            })
        }
        _ => Err(ApiError::BadRequest(
            "'from' and 'to' must be provided together".to_string(),
        )),
    }
}

async fn currency(pool: &DbPool) -> String {
    crate::modules::settings::service::get_setting_value(pool, "currency")
        .await
        .ok()
        .map(|value| value.trim().to_ascii_uppercase())
        .filter(|value| value.len() == 3)
        .unwrap_or_else(|| "USD".to_string())
}

fn ratio_pct(part: Decimal, whole: i64) -> Decimal {
    if whole <= 0 {
        return Decimal::ZERO;
    }
    (part * Decimal::from(100) / Decimal::from(whole)).round_dp(1)
}

/// Derive every ratio from raw sums — the formulas live here and nowhere else.
fn kpis(sums: &StaySums, days: i64, direct_share: Decimal, service_revenue: Decimal) -> RevenueKpis {
    let capacity = sums.sellable_rooms * days.max(1);
    let sold = Decimal::from(sums.room_nights_sold);
    RevenueKpis {
        room_revenue: sums.room_revenue.round_dp(2),
        room_nights_sold: sums.room_nights_sold,
        occupancy_rate: ratio_pct(sold, capacity),
        adr: if sums.room_nights_sold > 0 {
            (sums.room_revenue / sold).round_dp(2)
        } else {
            Decimal::ZERO
        },
        revpar: if capacity > 0 {
            (sums.room_revenue / Decimal::from(capacity)).round_dp(2)
        } else {
            Decimal::ZERO
        },
        alos_nights: if sums.stay_bookings > 0 {
            (sold / Decimal::from(sums.stay_bookings)).round_dp(1)
        } else {
            Decimal::ZERO
        },
        bookings_created: sums.bookings_created,
        void_rate: ratio_pct(Decimal::from(sums.voided_created), sums.bookings_created),
        no_show_rate: ratio_pct(Decimal::from(sums.no_show_created), sums.bookings_created),
        direct_share,
        service_revenue: service_revenue.round_dp(2),
        total_revenue: (sums.room_revenue + service_revenue).round_dp(2),
    }
}

fn direct_share(channels: &[RevenueChannelMix]) -> Decimal {
    let total: Decimal = channels.iter().map(|channel| channel.net_revenue).sum();
    if total.is_zero() {
        return Decimal::ZERO;
    }
    let direct: Decimal = channels
        .iter()
        .filter(|channel| DIRECT_CHANNEL_TYPES.contains(&channel.channel_type.as_str()))
        .map(|channel| channel.net_revenue)
        .sum();
    (direct * Decimal::from(100) / total).round_dp(1)
}

/// Merge per-date service revenue into the stay-date series. Dates present
/// only in `daily_service` get a zero-revenue stay point so service income on
/// roomless days is not dropped from the chart.
fn merge_daily_service(daily: &mut Vec<RevenueDailyPoint>, service: &[(NaiveDate, Decimal)]) {
    for (date, amount) in service {
        match daily.iter_mut().find(|point| point.date == *date) {
            Some(point) => point.other_revenue = *amount,
            None => daily.push(RevenueDailyPoint {
                date: *date,
                room_revenue: Decimal::ZERO,
                other_revenue: *amount,
                room_nights_sold: 0,
                occupancy_rate: Decimal::ZERO,
                adr: Decimal::ZERO,
            }),
        }
    }
    daily.sort_by_key(|point| point.date);
}

fn fill_daily(daily: &mut [RevenueDailyPoint], sellable_rooms: i64) {
    for point in daily.iter_mut() {
        point.occupancy_rate = ratio_pct(Decimal::from(point.room_nights_sold), sellable_rooms);
        point.adr = if point.room_nights_sold > 0 {
            (point.room_revenue / Decimal::from(point.room_nights_sold)).round_dp(2)
        } else {
            Decimal::ZERO
        };
        point.room_revenue = point.room_revenue.round_dp(2);
        point.other_revenue = point.other_revenue.round_dp(2);
    }
}

fn fill_room_type_performance(room_types: &mut [RoomTypePerformance], days: i64) {
    for rt in room_types.iter_mut() {
        let capacity = rt.rooms * days.max(1);
        rt.occupancy_rate = ratio_pct(Decimal::from(rt.nights_sold), capacity);
        rt.adr = if rt.nights_sold > 0 {
            (rt.room_revenue / Decimal::from(rt.nights_sold)).round_dp(2)
        } else {
            Decimal::ZERO
        };
        rt.room_revenue = rt.room_revenue.round_dp(2);
    }
}

fn fill_channel_shares(channels: &mut [RevenueChannelMix]) {
    let total: Decimal = channels.iter().map(|channel| channel.net_revenue).sum();
    for channel in channels.iter_mut() {
        channel.share_pct = if total.is_zero() {
            Decimal::ZERO
        } else {
            (channel.net_revenue * Decimal::from(100) / total).round_dp(1)
        };
        channel.net_revenue = channel.net_revenue.round_dp(2);
    }
}

fn pct_delta(current: Decimal, previous: Decimal) -> Value {
    if previous.is_zero() {
        // No baseline → null, never a fabricated percentage.
        return Value::Null;
    }
    json!(((current - previous) / previous * Decimal::from(100)).round_dp(1))
}

fn deltas(current: &RevenueKpis, previous: &RevenueKpis) -> Value {
    json!({
        "room_revenue": pct_delta(current.room_revenue, previous.room_revenue),
        "room_nights_sold": pct_delta(
            Decimal::from(current.room_nights_sold),
            Decimal::from(previous.room_nights_sold),
        ),
        "occupancy_rate": pct_delta(current.occupancy_rate, previous.occupancy_rate),
        "adr": pct_delta(current.adr, previous.adr),
        "revpar": pct_delta(current.revpar, previous.revpar),
        "alos_nights": pct_delta(current.alos_nights, previous.alos_nights),
        "bookings_created": pct_delta(
            Decimal::from(current.bookings_created),
            Decimal::from(previous.bookings_created),
        ),
        "void_rate": pct_delta(current.void_rate, previous.void_rate),
        "no_show_rate": pct_delta(current.no_show_rate, previous.no_show_rate),
        "direct_share": pct_delta(current.direct_share, previous.direct_share),
        "service_revenue": pct_delta(current.service_revenue, previous.service_revenue),
        "total_revenue": pct_delta(current.total_revenue, previous.total_revenue),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sums(
        revenue: i64,
        nights: i64,
        stay_bookings: i64,
        created: i64,
        voided: i64,
        no_show: i64,
        rooms: i64,
    ) -> StaySums {
        StaySums {
            room_revenue: Decimal::from(revenue),
            room_nights_sold: nights,
            stay_bookings,
            bookings_created: created,
            voided_created: voided,
            no_show_created: no_show,
            sellable_rooms: rooms,
        }
    }

    #[test]
    fn kpis_derive_from_sums() {
        // 20 sellable rooms, 10-day range → 200 capacity; 140 sold → 70.0%.
        let kpi = kpis(&sums(14000, 140, 50, 60, 3, 1, 20), 10, Decimal::from(50), Decimal::from(2100));
        assert_eq!(kpi.room_revenue, Decimal::from(14000));
        assert_eq!(kpi.occupancy_rate, Decimal::new(700, 1));
        assert_eq!(kpi.adr, Decimal::from(100));
        assert_eq!(kpi.revpar, Decimal::from(70));
        assert_eq!(kpi.alos_nights, Decimal::new(28, 1));
        assert_eq!(kpi.void_rate, Decimal::from(5));
        assert_eq!(kpi.no_show_rate, Decimal::new(17, 1));
        assert_eq!(kpi.service_revenue, Decimal::from(2100));
        assert_eq!(kpi.total_revenue, Decimal::from(16100));
    }

    #[test]
    fn empty_window_reports_zeros_not_nulls() {
        let kpi = kpis(&sums(0, 0, 0, 0, 0, 0, 20), 30, Decimal::ZERO, Decimal::ZERO);
        assert_eq!(kpi.occupancy_rate, Decimal::ZERO);
        assert_eq!(kpi.adr, Decimal::ZERO);
        assert_eq!(kpi.revpar, Decimal::ZERO);
        assert_eq!(kpi.alos_nights, Decimal::ZERO);
        assert_eq!(kpi.void_rate, Decimal::ZERO);
        assert_eq!(kpi.service_revenue, Decimal::ZERO);
        assert_eq!(kpi.total_revenue, Decimal::ZERO);
    }

    #[test]
    fn zero_sellable_rooms_never_divides() {
        let kpi = kpis(&sums(100, 5, 1, 1, 0, 0, 0), 1, Decimal::ZERO, Decimal::ZERO);
        assert_eq!(kpi.occupancy_rate, Decimal::ZERO);
        assert_eq!(kpi.revpar, Decimal::ZERO);
    }

    #[test]
    fn service_only_dates_extend_the_daily_series() {
        let mut daily = vec![RevenueDailyPoint {
            date: NaiveDate::from_ymd_opt(2026, 9, 10).unwrap(),
            room_revenue: Decimal::from(900),
            other_revenue: Decimal::ZERO,
            room_nights_sold: 6,
            occupancy_rate: Decimal::ZERO,
            adr: Decimal::ZERO,
        }];
        let service = vec![
            (NaiveDate::from_ymd_opt(2026, 9, 10).unwrap(), Decimal::from(120)),
            (NaiveDate::from_ymd_opt(2026, 9, 11).unwrap(), Decimal::from(75)),
        ];
        merge_daily_service(&mut daily, &service);
        assert_eq!(daily.len(), 2);
        assert_eq!(daily[0].other_revenue, Decimal::from(120));
        assert_eq!(daily[1].other_revenue, Decimal::from(75));
        assert_eq!(daily[1].room_nights_sold, 0);
        assert!(daily[0].date < daily[1].date);
    }

    #[test]
    fn ageing_bucket_boundaries() {
        assert_eq!(age_bucket(-5).0, "current");
        assert_eq!(age_bucket(0).0, "current");
        assert_eq!(age_bucket(1).0, "1_30");
        assert_eq!(age_bucket(30).0, "1_30");
        assert_eq!(age_bucket(31).0, "31_60");
        assert_eq!(age_bucket(60).0, "31_60");
        assert_eq!(age_bucket(61).0, "61_90");
        assert_eq!(age_bucket(90).0, "61_90");
        assert_eq!(age_bucket(91).0, "90_plus");
    }

    #[test]
    fn delta_is_null_when_previous_is_zero() {
        assert_eq!(pct_delta(Decimal::from(100), Decimal::ZERO), Value::Null);
        assert_eq!(
            pct_delta(Decimal::from(110), Decimal::from(100)),
            json!(Decimal::new(100, 1))
        );
    }
}
