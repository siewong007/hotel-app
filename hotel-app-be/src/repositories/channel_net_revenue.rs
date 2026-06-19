//! Channel net revenue report.

use std::collections::{HashMap, HashSet};

use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::Row;

use crate::core::db::{DbPool, DbRow};
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::models::{BookingChannel, ReportQuery};
use crate::repositories::booking_channels;
use crate::utils::report_labels::booking_channel_label;

#[derive(Debug, Clone)]
struct RawRevenueRow {
    booking_id: i64,
    booking_number: String,
    guest_name: String,
    room_number: String,
    room_type: String,
    check_in_date: NaiveDate,
    check_out_date: NaiveDate,
    business_date: NaiveDate,
    booking_status: String,
    source: Option<String>,
    remarks: Option<String>,
    booking_channel_id: Option<i64>,
    commission_type_override: Option<String>,
    commission_value_override: Option<Decimal>,
    commission_scope_override: Option<String>,
    legacy_commission_rate: Option<Decimal>,
    gross_room_revenue: Decimal,
    service_tax: Decimal,
    tourism_tax: Decimal,
    stay_nights: i64,
    posted_status: &'static str,
}

#[derive(Debug, Clone)]
struct ChannelRule {
    id: Option<i64>,
    name: String,
    channel_type: String,
    commission_type: String,
    commission_value: Decimal,
    commission_scope: String,
}

#[derive(Debug, Clone)]
struct ComputedRevenueRow {
    booking_id: i64,
    booking_number: String,
    guest_name: String,
    room_number: String,
    room_type: String,
    check_in_date: NaiveDate,
    check_out_date: NaiveDate,
    business_date: NaiveDate,
    booking_channel_id: Option<i64>,
    booking_channel: String,
    channel_type: String,
    platform_name: String,
    gross_room_revenue: Decimal,
    commission_type: String,
    commission_scope: String,
    commission_value: Decimal,
    commission_amount: Decimal,
    net_hotel_revenue: Decimal,
    service_tax: Decimal,
    tourism_tax: Decimal,
    booking_status: String,
    posted_status: &'static str,
}

#[derive(Debug, Default)]
struct ChannelAggregate {
    channel_type: String,
    booking_ids: HashSet<i64>,
    room_nights: i64,
    gross_revenue: Decimal,
    commission_amount: Decimal,
    net_revenue: Decimal,
}

fn normalize_token(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn title_case_label(value: &str) -> String {
    let label = value.trim().replace(['_', '-'], " ");
    if label.is_empty() {
        return "Direct".to_string();
    }

    label
        .split_whitespace()
        .map(|part| {
            if part.contains('.') {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                    None => String::new(),
                }
            } else {
                let lower = part.to_ascii_lowercase();
                let mut chars = lower.chars();
                match chars.next() {
                    Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn row_i64(row: &DbRow, col: &str) -> i64 {
    row.try_get::<i64, _>(col)
        .or_else(|_| row.try_get::<i32, _>(col).map(i64::from))
        .unwrap_or(0)
}

fn row_date(row: &DbRow, col: &str) -> NaiveDate {
    if let Ok(value) = row.try_get::<NaiveDate, _>(col) {
        return value;
    }

    row.try_get::<String, _>(col)
        .ok()
        .and_then(|value| NaiveDate::parse_from_str(&value, "%Y-%m-%d").ok())
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap())
}

fn decimal_to_f64(value: Decimal) -> f64 {
    value.to_string().parse::<f64>().unwrap_or(0.0)
}

fn normalize_commission_type(value: &str) -> String {
    match value.trim().to_ascii_lowercase().replace('-', "_").as_str() {
        "percentage" | "percent" => "percentage".to_string(),
        "fixed" | "fixed_amount" | "fixed_per_booking" | "amount" => "fixed_amount".to_string(),
        "fixed_per_night" => "fixed_amount".to_string(),
        _ => "none".to_string(),
    }
}

fn normalize_commission_scope(value: Option<&str>, commission_type: &str) -> String {
    if commission_type != "fixed_amount" {
        return "per_booking".to_string();
    }

    match value
        .unwrap_or("per_booking")
        .trim()
        .to_ascii_lowercase()
        .replace('-', "_")
        .as_str()
    {
        "night" | "per_night" | "fixed_per_night" => "per_night".to_string(),
        _ => "per_booking".to_string(),
    }
}

fn channel_rule_from_channel(channel: &BookingChannel) -> ChannelRule {
    ChannelRule {
        id: Some(channel.id),
        name: channel.name.clone(),
        channel_type: channel.channel_type.clone(),
        commission_type: normalize_commission_type(&channel.default_commission_type),
        commission_value: channel.default_commission_value,
        commission_scope: normalize_commission_scope(
            Some(&channel.default_commission_scope),
            &channel.default_commission_type,
        ),
    }
}

fn direct_rule(name: String, channel_type: String) -> ChannelRule {
    ChannelRule {
        id: None,
        name,
        channel_type,
        commission_type: "none".to_string(),
        commission_value: Decimal::ZERO,
        commission_scope: "per_booking".to_string(),
    }
}

fn resolve_channel(raw: &RawRevenueRow, channels: &[BookingChannel]) -> ChannelRule {
    if let Some(channel_id) = raw.booking_channel_id
        && let Some(channel) = channels.iter().find(|channel| channel.id == channel_id)
    {
        return channel_rule_from_channel(channel);
    }

    let source = raw.source.as_deref().unwrap_or_default();
    let remarks = raw.remarks.as_deref().unwrap_or_default();
    let inferred_label = booking_channel_label(Some(source), Some(remarks));
    let source_token = normalize_token(source);
    let remarks_token = normalize_token(remarks);
    let inferred_token = inferred_label
        .as_ref()
        .map(|label| normalize_token(label))
        .unwrap_or_default();

    if let Some(channel) = channels.iter().find(|channel| {
        let channel_token = normalize_token(&channel.name);
        !channel_token.is_empty()
            && (Some(channel.id) == raw.booking_channel_id
                || channel_token == inferred_token
                || channel_token == source_token
                || remarks_token.contains(&channel_token)
                || source_token.contains(&channel_token))
    }) {
        return channel_rule_from_channel(channel);
    }

    let source_lower = source.trim().to_ascii_lowercase();
    if source_lower.is_empty() || matches!(source_lower.as_str(), "direct" | "walk_in" | "walk-in")
    {
        if let Some(channel) = channels
            .iter()
            .find(|channel| normalize_token(&channel.name) == "direct")
            .or_else(|| {
                channels
                    .iter()
                    .find(|channel| channel.channel_type == "direct")
            })
        {
            return channel_rule_from_channel(channel);
        }
        return direct_rule("Direct".to_string(), "direct".to_string());
    }

    if source_lower.contains("phone") {
        return direct_rule("Phone".to_string(), "phone".to_string());
    }

    if let Some(label) = inferred_label {
        return direct_rule(label, "ota".to_string());
    }

    direct_rule(title_case_label(source), "other".to_string())
}

fn commission_for_row(
    raw: &RawRevenueRow,
    channel: &ChannelRule,
) -> (String, String, Decimal, Decimal) {
    let mut commission_type = channel.commission_type.clone();
    let mut commission_scope = channel.commission_scope.clone();
    let mut commission_value = channel.commission_value;

    if let Some(legacy_rate) = raw.legacy_commission_rate
        && raw.commission_type_override.is_none()
        && commission_type == "none"
        && legacy_rate > Decimal::ZERO
    {
        commission_type = "percentage".to_string();
        commission_scope = "per_booking".to_string();
        commission_value = legacy_rate;
    }

    if let Some(override_type) = raw.commission_type_override.as_deref() {
        let normalized = normalize_commission_type(override_type);
        commission_type = normalized.clone();
        commission_scope =
            normalize_commission_scope(raw.commission_scope_override.as_deref(), &normalized);
        commission_value = raw.commission_value_override.unwrap_or(Decimal::ZERO);
    }

    let commission_amount = match commission_type.as_str() {
        "percentage" => {
            (raw.gross_room_revenue * commission_value / Decimal::new(100, 0)).round_dp(2)
        }
        "fixed_amount" if commission_scope == "per_night" => commission_value.round_dp(2),
        "fixed_amount" => {
            let nights = raw.stay_nights.max(1);
            (commission_value / Decimal::from(nights)).round_dp(2)
        }
        _ => Decimal::ZERO,
    };

    (
        commission_type,
        commission_scope,
        commission_value,
        commission_amount,
    )
}

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
fn map_posted_row(row: &DbRow) -> RawRevenueRow {
    RawRevenueRow {
        booking_id: row.get("booking_id"),
        booking_number: row.get("booking_number"),
        guest_name: row.get("guest_name"),
        room_number: row.get("room_number"),
        room_type: row
            .try_get("room_type")
            .unwrap_or_else(|_| "Unknown".to_string()),
        check_in_date: row_date(row, "check_in_date"),
        check_out_date: row_date(row, "check_out_date"),
        business_date: row_date(row, "business_date"),
        booking_status: row
            .try_get("booking_status")
            .unwrap_or_else(|_| "unknown".to_string()),
        source: row.try_get("source").ok().flatten(),
        remarks: row.try_get("remarks").ok().flatten(),
        booking_channel_id: row.try_get("booking_channel_id").ok().flatten(),
        commission_type_override: row.try_get("commission_type_override").ok().flatten(),
        commission_value_override: crate::models::row_mappers::get_opt_decimal(
            row,
            "commission_value_override",
        ),
        commission_scope_override: row.try_get("commission_scope_override").ok().flatten(),
        legacy_commission_rate: crate::models::row_mappers::get_opt_decimal(
            row,
            "legacy_commission_rate",
        ),
        gross_room_revenue: crate::models::row_mappers::get_decimal(row, "gross_room_revenue"),
        service_tax: crate::models::row_mappers::get_decimal(row, "service_tax"),
        tourism_tax: crate::models::row_mappers::get_decimal(row, "tourism_tax"),
        stay_nights: row_i64(row, "stay_nights").max(1),
        posted_status: "posted",
    }
}

fn map_unposted_row(row: &DbRow, tax_rate: Decimal) -> RawRevenueRow {
    let nightly_rate = crate::models::row_mappers::get_decimal(row, "nightly_rate");
    let extra_bed_charge_raw = crate::models::row_mappers::get_decimal(row, "extra_bed_charge");
    let divisor = Decimal::ONE + tax_rate;
    let room_charge = (nightly_rate / divisor).round_dp(2);
    let service_tax = nightly_rate - room_charge;
    let extra_bed_charge = (extra_bed_charge_raw / divisor).round_dp(2);
    let extra_bed_tax = extra_bed_charge_raw - extra_bed_charge;

    RawRevenueRow {
        booking_id: row.get("booking_id"),
        booking_number: row.get("booking_number"),
        guest_name: row.get("guest_name"),
        room_number: row.get("room_number"),
        room_type: row
            .try_get("room_type")
            .unwrap_or_else(|_| "Unknown".to_string()),
        check_in_date: row_date(row, "check_in_date"),
        check_out_date: row_date(row, "check_out_date"),
        business_date: row_date(row, "business_date"),
        booking_status: row
            .try_get("booking_status")
            .unwrap_or_else(|_| "unknown".to_string()),
        source: row.try_get("source").ok().flatten(),
        remarks: row.try_get("remarks").ok().flatten(),
        booking_channel_id: row.try_get("booking_channel_id").ok().flatten(),
        commission_type_override: row.try_get("commission_type_override").ok().flatten(),
        commission_value_override: crate::models::row_mappers::get_opt_decimal(
            row,
            "commission_value_override",
        ),
        commission_scope_override: row.try_get("commission_scope_override").ok().flatten(),
        legacy_commission_rate: crate::models::row_mappers::get_opt_decimal(
            row,
            "legacy_commission_rate",
        ),
        gross_room_revenue: (room_charge + extra_bed_charge).round_dp(2),
        service_tax: (service_tax + extra_bed_tax).round_dp(2),
        tourism_tax: crate::models::row_mappers::get_decimal(row, "tourism_tax"),
        stay_nights: row_i64(row, "stay_nights").max(1),
        posted_status: "unposted",
    }
}

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
async fn fetch_posted_rows(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<Vec<RawRevenueRow>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT
            b.id AS booking_id,
            b.booking_number,
            COALESCE(NULLIF(TRIM(g.full_name), ''), NULLIF(TRIM(b.guest_name), ''), 'Guest') AS guest_name,
            r.room_number,
            COALESCE(rt.name, 'Unknown') AS room_type,
            b.check_in_date,
            b.check_out_date,
            napn.audit_date AS business_date,
            COALESCE(b.status, 'unknown') AS booking_status,
            b.source,
            b.remarks,
            b.booking_channel_id,
            b.commission_type_override,
            b.commission_value_override,
            b.commission_scope_override,
            b.commission_rate AS legacy_commission_rate,
            (COALESCE(napn.room_charge, 0) + COALESCE(napn.extra_bed_charge, 0)) AS gross_room_revenue,
            (COALESCE(napn.service_tax, 0) + COALESCE(napn.extra_bed_tax, 0)) AS service_tax,
            COALESCE(napn.tourism_tax, 0) AS tourism_tax,
            GREATEST((b.check_out_date - b.check_in_date), 1) AS stay_nights
        FROM night_audit_posted_nights napn
        JOIN bookings b ON b.id = napn.booking_id
        JOIN guests g ON g.id = b.guest_id
        JOIN rooms r ON r.id = b.room_id
        LEFT JOIN room_types rt ON rt.id = r.room_type_id
        WHERE napn.audit_date >= $1
          AND napn.audit_date <= $2
          AND COALESCE(b.status, '') NOT IN ('voided', 'comp_void', 'no_show')
        ORDER BY napn.audit_date, b.booking_number, r.room_number
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(rows.iter().map(map_posted_row).collect())
}

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
async fn fetch_posted_rows(
    _pool: &DbPool,
    _start_date: NaiveDate,
    _end_date: NaiveDate,
) -> Result<Vec<RawRevenueRow>, ApiError> {
    Ok(Vec::new())
}

#[cfg(any(feature = "postgres", not(feature = "sqlite")))]
async fn fetch_unposted_rows(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
    tax_rate: Decimal,
) -> Result<Vec<RawRevenueRow>, ApiError> {
    let rows = sqlx::query(
        r#"
        WITH booking_nights AS (
            SELECT
                b.*,
                gs.business_date::date AS business_date
            FROM bookings b
            CROSS JOIN LATERAL generate_series(
                GREATEST(b.check_in_date, $1::date),
                LEAST(
                    CASE
                        WHEN b.check_out_date > b.check_in_date THEN b.check_out_date - 1
                        ELSE b.check_in_date
                    END,
                    $2::date
                ),
                interval '1 day'
            ) AS gs(business_date)
            WHERE b.check_in_date <= $2
              AND (
                    CASE
                        WHEN b.check_out_date > b.check_in_date THEN b.check_out_date - 1
                        ELSE b.check_in_date
                    END
                  ) >= $1
              AND COALESCE(b.status, '') NOT IN ('voided', 'comp_void', 'no_show')
        )
        SELECT
            b.id AS booking_id,
            b.booking_number,
            COALESCE(NULLIF(TRIM(g.full_name), ''), NULLIF(TRIM(b.guest_name), ''), 'Guest') AS guest_name,
            r.room_number,
            COALESCE(rt.name, 'Unknown') AS room_type,
            b.check_in_date,
            b.check_out_date,
            b.business_date,
            COALESCE(b.status, 'unknown') AS booking_status,
            b.source,
            b.remarks,
            b.booking_channel_id,
            b.commission_type_override,
            b.commission_value_override,
            b.commission_scope_override,
            b.commission_rate AS legacy_commission_rate,
            CASE
                WHEN b.daily_rates IS NOT NULL AND b.daily_rates ? b.business_date::text
                    THEN (b.daily_rates ->> b.business_date::text)::DECIMAL
                ELSE b.room_rate
            END AS nightly_rate,
            COALESCE(b.extra_bed_charge, 0) AS extra_bed_charge,
            CASE
                WHEN COALESCE(b.is_tourist, false) AND COALESCE(b.tourism_tax_amount, 0) > 0
                    THEN ROUND(COALESCE(b.tourism_tax_amount, 0) / GREATEST((b.check_out_date - b.check_in_date), 1), 2)
                ELSE 0
            END AS tourism_tax,
            GREATEST((b.check_out_date - b.check_in_date), 1) AS stay_nights
        FROM booking_nights b
        JOIN guests g ON g.id = b.guest_id
        JOIN rooms r ON r.id = b.room_id
        LEFT JOIN room_types rt ON rt.id = r.room_type_id
        WHERE NOT EXISTS (
            SELECT 1
            FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id
              AND napn.audit_date = b.business_date
        )
        ORDER BY b.business_date, b.booking_number, r.room_number
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|row| map_unposted_row(row, tax_rate))
        .collect())
}

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
async fn fetch_unposted_rows(
    pool: &DbPool,
    start_date: NaiveDate,
    end_date: NaiveDate,
    tax_rate: Decimal,
) -> Result<Vec<RawRevenueRow>, ApiError> {
    let rows = sqlx::query(
        r#"
        WITH RECURSIVE booking_nights AS (
            SELECT
                b.*,
                CASE WHEN b.check_in_date > ?1 THEN b.check_in_date ELSE ?1 END AS business_date,
                CASE
                    WHEN b.check_out_date > b.check_in_date THEN date(b.check_out_date, '-1 day')
                    ELSE b.check_in_date
                END AS last_night
            FROM bookings b
            WHERE b.check_in_date <= ?2
              AND (
                    CASE
                        WHEN b.check_out_date > b.check_in_date THEN date(b.check_out_date, '-1 day')
                        ELSE b.check_in_date
                    END
                  ) >= ?1
              AND COALESCE(b.status, '') NOT IN ('voided', 'comp_void', 'no_show')
            UNION ALL
            SELECT
                booking_nights.*,
                date(booking_nights.business_date, '+1 day') AS business_date,
                booking_nights.last_night
            FROM booking_nights
            WHERE booking_nights.business_date < booking_nights.last_night
              AND booking_nights.business_date < ?2
        )
        SELECT
            b.id AS booking_id,
            COALESCE(b.booking_number, CAST(b.id AS TEXT)) AS booking_number,
            COALESCE(NULLIF(TRIM(g.full_name), ''), NULLIF(TRIM(g.first_name || ' ' || g.last_name), ''), 'Guest') AS guest_name,
            r.room_number,
            COALESCE(rt.name, 'Unknown') AS room_type,
            b.check_in_date,
            b.check_out_date,
            b.business_date,
            COALESCE(b.status, 'unknown') AS booking_status,
            b.source,
            b.booking_remarks AS remarks,
            b.booking_channel_id,
            b.commission_type_override,
            b.commission_value_override,
            b.commission_scope_override,
            NULL AS legacy_commission_rate,
            b.rate_per_night AS nightly_rate,
            0 AS extra_bed_charge,
            0 AS tourism_tax,
            MAX(CAST(julianday(b.check_out_date) - julianday(b.check_in_date) AS INTEGER), 1) AS stay_nights
        FROM booking_nights b
        JOIN guests g ON g.id = b.guest_id
        JOIN rooms r ON r.id = b.room_id
        LEFT JOIN room_types rt ON rt.id = r.room_type_id
        ORDER BY b.business_date, b.booking_number, r.room_number
        "#,
    )
    .bind(start_date)
    .bind(end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|row| map_unposted_row(row, tax_rate))
        .collect())
}

fn matches_filter(actual: &str, filter: &Option<String>) -> bool {
    let Some(filter) = filter.as_deref() else {
        return true;
    };
    let filter = filter.trim();
    if filter.is_empty() || filter.eq_ignore_ascii_case("all") {
        return true;
    }

    normalize_token(actual).contains(&normalize_token(filter))
}

fn should_include(row: &ComputedRevenueRow, params: &ReportQuery) -> bool {
    if let Some(channel_id) = params.booking_channel_id
        && row.booking_channel_id != Some(channel_id)
    {
        return false;
    }

    matches_filter(&row.booking_channel, &params.booking_channel)
        && matches_filter(&row.platform_name, &params.platform_name)
        && matches_filter(&row.booking_status, &params.booking_status)
        && matches_filter(&row.room_type, &params.room_type)
}

fn row_to_json(row: &ComputedRevenueRow) -> serde_json::Value {
    serde_json::json!({
        "booking_id": row.booking_id,
        "booking_number": row.booking_number,
        "guest_name": row.guest_name,
        "room_number": row.room_number,
        "room_type": row.room_type,
        "check_in_date": row.check_in_date.to_string(),
        "check_out_date": row.check_out_date.to_string(),
        "business_date": row.business_date.to_string(),
        "posted_date": if row.posted_status == "posted" { Some(row.business_date.to_string()) } else { None },
        "booking_channel_id": row.booking_channel_id,
        "booking_channel": row.booking_channel,
        "channel_type": row.channel_type,
        "platform_name": row.platform_name,
        "gross_room_revenue": decimal_to_f64(row.gross_room_revenue),
        "commission_type": row.commission_type,
        "commission_scope": row.commission_scope,
        "commission_value": decimal_to_f64(row.commission_value),
        "commission_amount": decimal_to_f64(row.commission_amount),
        "net_hotel_revenue": decimal_to_f64(row.net_hotel_revenue),
        "service_tax": decimal_to_f64(row.service_tax),
        "tourism_tax": decimal_to_f64(row.tourism_tax),
        "booking_status": row.booking_status,
        "posted_status": row.posted_status
    })
}

pub async fn generate(
    pool: &DbPool,
    params: &ReportQuery,
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<serde_json::Value, ApiError> {
    let posted_status = params
        .posted_status
        .as_deref()
        .unwrap_or("all")
        .trim()
        .to_ascii_lowercase();
    let include_posted = posted_status != "unposted";
    let include_unposted = posted_status != "posted";

    let tax_rate_pct =
        settings_cache::get_positive_decimal(pool, "service_tax_rate", Decimal::new(8, 0)).await;
    let tax_rate = tax_rate_pct / Decimal::new(100, 0);

    let channels = booking_channels::list(pool).await?;
    let mut raw_rows = Vec::new();
    if include_posted {
        raw_rows.extend(fetch_posted_rows(pool, start_date, end_date).await?);
    }
    if include_unposted {
        raw_rows.extend(fetch_unposted_rows(pool, start_date, end_date, tax_rate).await?);
    }

    let mut rows: Vec<ComputedRevenueRow> = raw_rows
        .into_iter()
        .map(|raw| {
            let channel = resolve_channel(&raw, &channels);
            let (commission_type, commission_scope, commission_value, commission_amount) =
                commission_for_row(&raw, &channel);
            let net_hotel_revenue = (raw.gross_room_revenue - commission_amount).round_dp(2);

            ComputedRevenueRow {
                booking_id: raw.booking_id,
                booking_number: raw.booking_number,
                guest_name: raw.guest_name,
                room_number: raw.room_number,
                room_type: raw.room_type,
                check_in_date: raw.check_in_date,
                check_out_date: raw.check_out_date,
                business_date: raw.business_date,
                booking_channel_id: channel.id,
                booking_channel: channel.name.clone(),
                channel_type: channel.channel_type.clone(),
                platform_name: channel.name,
                gross_room_revenue: raw.gross_room_revenue,
                commission_type,
                commission_scope,
                commission_value,
                commission_amount,
                net_hotel_revenue,
                service_tax: raw.service_tax,
                tourism_tax: raw.tourism_tax,
                booking_status: raw.booking_status,
                posted_status: raw.posted_status,
            }
        })
        .filter(|row| should_include(row, params))
        .collect();

    rows.sort_by(|a, b| {
        a.business_date
            .cmp(&b.business_date)
            .then(a.booking_channel.cmp(&b.booking_channel))
            .then(a.booking_number.cmp(&b.booking_number))
    });

    let total_gross: Decimal = rows.iter().map(|row| row.gross_room_revenue).sum();
    let total_commission: Decimal = rows.iter().map(|row| row.commission_amount).sum();
    let total_net: Decimal = rows.iter().map(|row| row.net_hotel_revenue).sum();
    let total_service_tax: Decimal = rows.iter().map(|row| row.service_tax).sum();
    let total_tourism_tax: Decimal = rows.iter().map(|row| row.tourism_tax).sum();
    let finalized_gross: Decimal = rows
        .iter()
        .filter(|row| row.posted_status == "posted")
        .map(|row| row.gross_room_revenue)
        .sum();
    let projected_gross: Decimal = rows
        .iter()
        .filter(|row| row.posted_status == "unposted")
        .map(|row| row.gross_room_revenue)
        .sum();

    let average_commission_percentage = if total_gross > Decimal::ZERO {
        (total_commission / total_gross * Decimal::new(100, 0)).round_dp(2)
    } else {
        Decimal::ZERO
    };

    let mut unique_bookings = HashMap::new();
    for row in &rows {
        unique_bookings.insert(row.booking_id, ());
    }

    let mut by_channel: HashMap<String, ChannelAggregate> = HashMap::new();
    for row in &rows {
        let entry = by_channel
            .entry(row.booking_channel.clone())
            .or_insert_with(|| ChannelAggregate {
                channel_type: row.channel_type.clone(),
                ..Default::default()
            });
        entry.booking_ids.insert(row.booking_id);
        entry.room_nights += 1;
        entry.gross_revenue += row.gross_room_revenue;
        entry.commission_amount += row.commission_amount;
        entry.net_revenue += row.net_hotel_revenue;
    }

    let mut by_channel_json: Vec<serde_json::Value> = by_channel
        .iter()
        .map(|(name, aggregate)| {
            serde_json::json!({
                "channel_name": name,
                "channel_type": aggregate.channel_type,
                "bookings": aggregate.booking_ids.len(),
                "room_nights": aggregate.room_nights,
                "gross_revenue": decimal_to_f64(aggregate.gross_revenue),
                "commission_amount": decimal_to_f64(aggregate.commission_amount),
                "net_revenue": decimal_to_f64(aggregate.net_revenue)
            })
        })
        .collect();
    by_channel_json.sort_by(|a, b| {
        b["gross_revenue"]
            .as_f64()
            .unwrap_or(0.0)
            .partial_cmp(&a["gross_revenue"].as_f64().unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let top_ota_by_revenue = by_channel_json.first().cloned();
    let top_ota_by_commission_cost = by_channel_json.iter().cloned().max_by(|a, b| {
        a["commission_amount"]
            .as_f64()
            .unwrap_or(0.0)
            .partial_cmp(&b["commission_amount"].as_f64().unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(serde_json::json!({
        "type": "channel_net_revenue",
        "period": {
            "start": start_date.to_string(),
            "end": end_date.to_string()
        },
        "summary": {
            "total_gross_revenue": decimal_to_f64(total_gross),
            "total_platform_commission": decimal_to_f64(total_commission),
            "total_net_hotel_revenue": decimal_to_f64(total_net),
            "average_commission_percentage": decimal_to_f64(average_commission_percentage),
            "total_bookings": unique_bookings.len(),
            "room_nights": rows.len(),
            "top_ota_by_revenue": top_ota_by_revenue,
            "top_ota_by_commission_cost": top_ota_by_commission_cost,
            "finalized_gross_revenue": decimal_to_f64(finalized_gross),
            "projected_gross_revenue": decimal_to_f64(projected_gross),
            "service_tax": decimal_to_f64(total_service_tax),
            "tourism_tax": decimal_to_f64(total_tourism_tax)
        },
        "by_channel": by_channel_json,
        "rows": rows.iter().map(row_to_json).collect::<Vec<_>>(),
        "channels": channels
    }))
}
