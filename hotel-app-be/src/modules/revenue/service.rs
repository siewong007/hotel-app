use chrono::Duration;
use rust_decimal::Decimal;
use serde_json::{Value, json};

use super::models::{
    RevenueChannelMix, RevenueDailyPoint, RevenueKpis, RevenueOverview, RevenueOverviewQuery,
    RevenueRangeInfo,
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

pub struct RevenueService;

impl RevenueService {
    pub async fn overview(
        pool: &DbPool,
        query: RevenueOverviewQuery,
    ) -> Result<RevenueOverview, ApiError> {
        let range = resolve_range(pool, &query).await?;
        let days = (range.to - range.from).num_days() + 1;
        // Same-length window immediately before the reported range.
        let previous = RevenueRange {
            from: range.from - Duration::days(days),
            to: range.from - Duration::days(1),
        };
        let (current, prior, mut daily, mut channels) = tokio::try_join!(
            RevenueRepository::stay_sums(pool, &range, query.room_type_id, query.channel_id),
            RevenueRepository::stay_sums(pool, &previous, query.room_type_id, query.channel_id),
            RevenueRepository::daily(pool, &range, query.room_type_id, query.channel_id),
            RevenueRepository::channel_mix(pool, &range, query.room_type_id, query.channel_id),
        )?;
        let direct_share = direct_share(&channels);
        let current_kpis = kpis(&current, days, direct_share);
        let previous_kpis = kpis(&prior, days, Decimal::ZERO);
        fill_daily(&mut daily, current.sellable_rooms);
        fill_channel_shares(&mut channels);
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
fn kpis(sums: &StaySums, days: i64, direct_share: Decimal) -> RevenueKpis {
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

fn fill_daily(daily: &mut [RevenueDailyPoint], sellable_rooms: i64) {
    for point in daily.iter_mut() {
        point.occupancy_rate = ratio_pct(Decimal::from(point.room_nights_sold), sellable_rooms);
        point.adr = if point.room_nights_sold > 0 {
            (point.room_revenue / Decimal::from(point.room_nights_sold)).round_dp(2)
        } else {
            Decimal::ZERO
        };
        point.room_revenue = point.room_revenue.round_dp(2);
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
        let kpi = kpis(&sums(14000, 140, 50, 60, 3, 1, 20), 10, Decimal::from(50));
        assert_eq!(kpi.room_revenue, Decimal::from(14000));
        assert_eq!(kpi.occupancy_rate, Decimal::new(700, 1));
        assert_eq!(kpi.adr, Decimal::from(100));
        assert_eq!(kpi.revpar, Decimal::from(70));
        assert_eq!(kpi.alos_nights, Decimal::new(28, 1));
        assert_eq!(kpi.void_rate, Decimal::from(5));
        assert_eq!(kpi.no_show_rate, Decimal::new(17, 1));
    }

    #[test]
    fn empty_window_reports_zeros_not_nulls() {
        let kpi = kpis(&sums(0, 0, 0, 0, 0, 0, 20), 30, Decimal::ZERO);
        assert_eq!(kpi.occupancy_rate, Decimal::ZERO);
        assert_eq!(kpi.adr, Decimal::ZERO);
        assert_eq!(kpi.revpar, Decimal::ZERO);
        assert_eq!(kpi.alos_nights, Decimal::ZERO);
        assert_eq!(kpi.void_rate, Decimal::ZERO);
    }

    #[test]
    fn zero_sellable_rooms_never_divides() {
        let kpi = kpis(&sums(100, 5, 1, 1, 0, 0, 0), 1, Decimal::ZERO);
        assert_eq!(kpi.occupancy_rate, Decimal::ZERO);
        assert_eq!(kpi.revpar, Decimal::ZERO);
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
