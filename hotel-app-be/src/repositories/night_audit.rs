//! Night audit repository

use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::Row;
use std::collections::HashMap;

use crate::core::db::{DbPool, decimal_to_db};
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::models::row_mappers;
use crate::models::{
    AuditDetailsResponse, JournalEntry, JournalSection, NightAuditPreview, NightAuditRunWithUser,
    PostedBookingDetail, RevenueBreakdownItem, RoomSnapshot, UnpostedBooking,
};
use crate::utils::report_labels::payment_account_label;

/// Get preview data for what will be posted on an audit date.
pub async fn preview(pool: &DbPool, audit_date: NaiveDate) -> Result<NightAuditPreview, ApiError> {
    let already_run = is_audit_completed(pool, audit_date).await;

    let rows = sqlx::query(
        r#"
        SELECT
            b.id as booking_id,
            b.booking_number,
            COALESCE(g.full_name, COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')) as guest_name,
            r.room_number,
            b.check_in_date::text as check_in_date,
            b.check_out_date::text as check_out_date,
            COALESCE(b.status, 'unknown') as status,
            b.room_rate,
            COALESCE(b.extra_bed_charge, 0) as extra_bed_charge,
            b.total_amount,
            b.payment_method,
            b.source
        FROM bookings b
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        WHERE b.status NOT IN ('pending', 'confirmed', 'voided')
        AND (
            -- Overnight stay: occupied the room the night of the audit date
            (b.check_in_date <= $1 AND b.check_out_date > $1)
            -- Same-day (hourly) checkout: check-in and check-out both on the audit date
            OR (b.status = 'checked_out' AND b.check_in_date = $1 AND b.check_out_date = $1)
        )
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = $1
        )
        ORDER BY r.room_number
        "#,
    )
    .bind(audit_date)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        log::error!("Error fetching unposted bookings: {:?}", e);
        ApiError::Database(e.to_string())
    })?;

    let mut unposted_bookings: Vec<UnpostedBooking> = Vec::new();
    let mut payment_method_map: HashMap<String, (i32, Decimal)> = HashMap::new();
    let mut booking_channel_map: HashMap<String, (i32, Decimal)> = HashMap::new();

    for row in rows.iter() {
        let check_in_str: String = row.get("check_in_date");
        let check_out_str: String = row.get("check_out_date");

        let check_in = NaiveDate::parse_from_str(&check_in_str, "%Y-%m-%d")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap());
        let check_out = NaiveDate::parse_from_str(&check_out_str, "%Y-%m-%d")
            .unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap());

        let payment_method: Option<String> = row.get("payment_method");
        let source: Option<String> = row.get("source");
        let room_rate = row_mappers::get_decimal(row, "room_rate");
        let extra_bed_charge = row_mappers::get_decimal(row, "extra_bed_charge");
        let status: String = row.get("status");

        let night_total = room_rate + extra_bed_charge;
        let pm_key = payment_method
            .clone()
            .unwrap_or_else(|| "Unknown".to_string());
        let pm_entry = payment_method_map
            .entry(pm_key)
            .or_insert((0, Decimal::ZERO));
        pm_entry.0 += 1;
        pm_entry.1 += night_total;

        let bc_key = source.clone().unwrap_or_else(|| "Unknown".to_string());
        let bc_entry = booking_channel_map
            .entry(bc_key)
            .or_insert((0, Decimal::ZERO));
        bc_entry.0 += 1;
        bc_entry.1 += night_total;

        unposted_bookings.push(UnpostedBooking {
            booking_id: row.get("booking_id"),
            booking_number: row.get("booking_number"),
            guest_name: row.get("guest_name"),
            room_number: row.get("room_number"),
            check_in_date: check_in,
            check_out_date: check_out,
            status,
            total_amount: night_total,
            payment_method,
            source,
        });
    }

    let payment_method_breakdown: Vec<RevenueBreakdownItem> = payment_method_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem {
            category,
            count,
            amount,
        })
        .collect();

    let booking_channel_breakdown: Vec<RevenueBreakdownItem> = booking_channel_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem {
            category,
            count,
            amount,
        })
        .collect();

    let total_unposted = unposted_bookings.len() as i32;
    let estimated_revenue: Decimal = unposted_bookings.iter().map(|b| b.total_amount).sum();

    let room_row = sqlx::query(
        r#"
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status IN ('available', 'clean')) as available,
            COUNT(*) FILTER (WHERE status = 'occupied') as occupied,
            COUNT(*) FILTER (WHERE status = 'reserved') as reserved,
            COUNT(*) FILTER (WHERE status IN ('maintenance', 'out_of_order')) as maintenance,
            COUNT(*) FILTER (WHERE status IN ('dirty', 'cleaning')) as dirty
        FROM rooms
        "#,
    )
    .fetch_one(pool)
    .await
    .map_err(|e| {
        log::error!("Error fetching room snapshot: {:?}", e);
        ApiError::Database(e.to_string())
    })?;

    let total: i64 = room_row.get("total");
    let available: i64 = room_row.get("available");
    let occupied: i64 = room_row.get("occupied");
    let reserved: i64 = room_row.get("reserved");
    let maintenance: i64 = room_row.get("maintenance");
    let dirty: i64 = room_row.get("dirty");

    let occupied_from_bookings: i64 = sqlx::query_scalar::<_, Option<i64>>(
        r#"
        SELECT COUNT(DISTINCT r.id)
        FROM rooms r
        JOIN bookings b ON r.id = b.room_id
        WHERE b.status = 'checked_in'
        AND b.check_in_date <= $1
        AND b.check_out_date > $1
        "#,
    )
    .bind(audit_date)
    .fetch_one(pool)
    .await
    .unwrap_or(Some(0))
    .unwrap_or(0);

    let journal_sections = generate_journal_sections(pool, audit_date, false).await;

    Ok(NightAuditPreview {
        audit_date: audit_date.to_string(),
        can_run: !already_run,
        already_run,
        unposted_bookings,
        total_unposted,
        estimated_revenue,
        room_snapshot: RoomSnapshot {
            total: total as i32,
            available: available as i32,
            occupied: std::cmp::max(occupied as i32, occupied_from_bookings as i32),
            reserved: reserved as i32,
            maintenance: maintenance as i32,
            dirty: dirty as i32,
        },
        payment_method_breakdown,
        booking_channel_breakdown,
        journal_sections,
    })
}

pub async fn update_audit_notes(
    pool: &DbPool,
    audit_run_id: i64,
    notes: &str,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE night_audit_runs SET notes = $1 WHERE id = $2")
        .bind(notes)
        .bind(audit_run_id)
        .execute(pool)
        .await
        .map_err(ApiError::from)?;

    Ok(())
}

pub async fn list_audit_runs(
    pool: &DbPool,
    page_size: i64,
    offset: i64,
) -> Result<Vec<NightAuditRunWithUser>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT
            nar.id,
            nar.audit_date,
            nar.run_at,
            u.username,
            nar.status,
            COALESCE(nar.total_bookings_posted, 0) as total_bookings_posted,
            COALESCE(nar.total_checkins, 0) as total_checkins,
            COALESCE(nar.total_checkouts, 0) as total_checkouts,
            COALESCE(nar.total_revenue, 0) as total_revenue,
            COALESCE(nar.occupancy_rate, 0) as occupancy_rate,
            COALESCE(nar.rooms_available, 0) as rooms_available,
            COALESCE(nar.rooms_occupied, 0) as rooms_occupied,
            COALESCE(nar.rooms_reserved, 0) as rooms_reserved,
            COALESCE(nar.rooms_maintenance, 0) as rooms_maintenance,
            COALESCE(nar.rooms_dirty, 0) as rooms_dirty,
            nar.notes,
            nar.created_at
        FROM night_audit_runs nar
        LEFT JOIN users u ON nar.run_by = u.id
        ORDER BY nar.audit_date DESC
        LIMIT $1 OFFSET $2
        "#,
    )
    .bind(page_size)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        log::error!("Failed to fetch night audit runs: {}", e);
        ApiError::Database(e.to_string())
    })?;

    let mut result: Vec<NightAuditRunWithUser> = Vec::new();
    for row in rows.iter() {
        let audit_date: NaiveDate = row.get("audit_date");
        let (payment_method_breakdown, booking_channel_breakdown) =
            fetch_breakdown_for_date(pool, audit_date).await;

        result.push(NightAuditRunWithUser {
            id: row.get("id"),
            audit_date,
            run_at: row.get("run_at"),
            run_by_username: row.get("username"),
            status: row.get("status"),
            total_bookings_posted: row.get("total_bookings_posted"),
            total_checkins: row.get("total_checkins"),
            total_checkouts: row.get("total_checkouts"),
            total_revenue: row_mappers::get_decimal(row, "total_revenue"),
            occupancy_rate: row_mappers::get_decimal(row, "occupancy_rate"),
            rooms_available: row.get("rooms_available"),
            rooms_occupied: row.get("rooms_occupied"),
            rooms_reserved: row.get("rooms_reserved"),
            rooms_maintenance: row.get("rooms_maintenance"),
            rooms_dirty: row.get("rooms_dirty"),
            notes: row.get("notes"),
            created_at: row.get("created_at"),
            payment_method_breakdown,
            booking_channel_breakdown,
        });
    }

    Ok(result)
}

pub async fn audit_details(pool: &DbPool, audit_id: i64) -> Result<AuditDetailsResponse, ApiError> {
    let audit_run = fetch_audit_run_by_id(pool, audit_id).await?;
    let audit_date = audit_run.audit_date;

    let booking_rows = sqlx::query(
        r#"
        SELECT
            b.id as booking_id,
            b.booking_number,
            COALESCE(g.full_name, COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')) as guest_name,
            r.room_number,
            COALESCE(rt.name, 'Unknown') as room_type,
            rt.code as room_type_code,
            b.check_in_date,
            b.check_out_date,
            (b.check_out_date - b.check_in_date)::integer as nights,
            COALESCE(b.status, 'unknown') as status,
            napn.total_posted as total_amount,
            b.payment_status,
            b.source,
            b.remarks as booking_remarks,
            COALESCE(b.payment_method, 'Unknown') as payment_method
        FROM night_audit_posted_nights napn
        JOIN bookings b ON napn.booking_id = b.id
        JOIN guests g ON b.guest_id = g.id
        JOIN rooms r ON b.room_id = r.id
        LEFT JOIN room_types rt ON r.room_type_id = rt.id
        WHERE napn.audit_date = $1
        ORDER BY r.room_number, b.check_in_date
        "#,
    )
    .bind(audit_date)
    .fetch_all(pool)
    .await
    .map_err(ApiError::from)?;

    let posted_bookings: Vec<PostedBookingDetail> = booking_rows
        .iter()
        .map(|row| {
            let source: Option<String> = row.get("source");
            let total_amount = row_mappers::get_decimal(row, "total_amount");
            let pm: String = row.get("payment_method");

            PostedBookingDetail {
                booking_id: row.get("booking_id"),
                booking_number: row.get("booking_number"),
                guest_name: row.get("guest_name"),
                room_number: row.get("room_number"),
                room_type: row.get("room_type"),
                room_type_code: row.get("room_type_code"),
                check_in_date: row.get("check_in_date"),
                check_out_date: row.get("check_out_date"),
                nights: row.get("nights"),
                status: row.get("status"),
                total_amount,
                payment_status: row.get("payment_status"),
                payment_method: Some(pm),
                source,
                booking_remarks: row.get("booking_remarks"),
            }
        })
        .collect();

    let journal_sections = generate_journal_sections(pool, audit_date, true).await;

    Ok(AuditDetailsResponse {
        audit_run,
        posted_bookings,
        journal_sections,
    })
}

pub async fn booking_posted_status(
    pool: &DbPool,
    booking_id: i64,
) -> Result<serde_json::Value, ApiError> {
    let row = sqlx::query(
        "SELECT COALESCE(is_posted, false) as is_posted, posted_date FROM bookings WHERE id = $1",
    )
    .bind(booking_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)?;

    match row {
        Some(r) => Ok(serde_json::json!({
            "booking_id": booking_id,
            "is_posted": r.get::<bool, _>("is_posted"),
            "posted_date": r.get::<Option<NaiveDate>, _>("posted_date"),
        })),
        None => Err(ApiError::NotFound("Booking not found".to_string())),
    }
}

/// Backfill missing `night_audit_posted_nights` rows for a booking whose stay
/// overlaps one or more already-completed audit dates.
///
/// Runs after a booking transitions into a "stayed" status (e.g. checked_in,
/// checked_out) so that back-dated bookings — created after the relevant
/// night audits already closed — still appear on those reports.
/// Mirrors the per-night calculations of `run_night_audit`.
/// No-op for bookings in non-stay statuses. Returns the number of nights posted.
pub async fn backfill_booking_posted_nights(
    pool: &DbPool,
    booking_id: i64,
    posted_by: i64,
) -> Result<u32, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT b.check_in_date, b.check_out_date, b.room_rate,
               COALESCE(b.daily_rates, '{}'::jsonb) as daily_rates,
               COALESCE(b.is_tourist, false) as is_tourist,
               COALESCE(b.tourism_tax_amount, 0) as tourism_tax_amount,
               COALESCE(b.extra_bed_charge, 0) as extra_bed_charge,
               b.status
        FROM bookings b
        WHERE b.id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound(format!("Booking {} not found", booking_id)))?;

    let status: String = row.get("status");
    if matches!(
        status.as_str(),
        "pending" | "confirmed" | "cancelled" | "no_show" | "voided"
    ) {
        return Ok(0);
    }

    let check_in: NaiveDate = row.get("check_in_date");
    let check_out: NaiveDate = row.get("check_out_date");
    let room_rate = row_mappers::get_decimal(&row, "room_rate");
    let daily_rates: serde_json::Value = row.get("daily_rates");
    let is_tourist: bool = row.get("is_tourist");
    let tourism_tax_amount = row_mappers::get_decimal(&row, "tourism_tax_amount");
    let extra_bed_charge_full = row_mappers::get_decimal(&row, "extra_bed_charge");

    let tax_rate_pct =
        settings_cache::get_positive_decimal(pool, "service_tax_rate", Decimal::new(8, 0)).await;
    let divisor = Decimal::ONE + tax_rate_pct / Decimal::new(100, 0);

    let is_hourly = check_in == check_out;
    let nights_total = (check_out - check_in).num_days().max(1);
    let tourism_tax_per_night = if is_tourist && tourism_tax_amount > Decimal::ZERO {
        if is_hourly {
            tourism_tax_amount
        } else {
            (tourism_tax_amount / Decimal::from(nights_total)).round_dp(2)
        }
    } else {
        Decimal::ZERO
    };

    let (eb_charge_per_night, eb_tax_per_night) = if extra_bed_charge_full > Decimal::ZERO {
        let c = (extra_bed_charge_full / divisor).round_dp(2);
        (c, extra_bed_charge_full - c)
    } else {
        (Decimal::ZERO, Decimal::ZERO)
    };

    let iter_end = if is_hourly {
        check_in
            .succ_opt()
            .ok_or_else(|| ApiError::Database("Date overflow".to_string()))?
    } else {
        check_out
    };

    let mut date = check_in;
    let mut inserted: u32 = 0;

    while date < iter_end {
        let audit_run_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM night_audit_runs WHERE audit_date = $1 AND status = 'completed' LIMIT 1",
        )
        .bind(date)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

        if let Some(run_id) = audit_run_id {
            let date_key = date.format("%Y-%m-%d").to_string();
            let night_rate = daily_rates
                .as_object()
                .and_then(|o| o.get(&date_key))
                .and_then(|v| {
                    v.as_str()
                        .and_then(|s| s.parse::<Decimal>().ok())
                        .or_else(|| v.as_f64().and_then(Decimal::from_f64_retain))
                })
                .unwrap_or(room_rate);

            let room_charge = (night_rate / divisor).round_dp(2);
            let service_tax = night_rate - room_charge;
            let night_total = night_rate + extra_bed_charge_full + tourism_tax_per_night;

            let res = sqlx::query(
                r#"
                INSERT INTO night_audit_posted_nights
                    (booking_id, audit_date, room_rate, room_charge, service_tax, tourism_tax,
                     extra_bed_charge, extra_bed_tax, total_posted, audit_run_id, posted_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (booking_id, audit_date) DO NOTHING
                "#,
            )
            .bind(booking_id)
            .bind(date)
            .bind(decimal_to_db(night_rate))
            .bind(decimal_to_db(room_charge))
            .bind(decimal_to_db(service_tax))
            .bind(decimal_to_db(tourism_tax_per_night))
            .bind(decimal_to_db(eb_charge_per_night))
            .bind(decimal_to_db(eb_tax_per_night))
            .bind(decimal_to_db(night_total))
            .bind(run_id)
            .bind(posted_by)
            .execute(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

            if res.rows_affected() > 0 {
                sqlx::query(
                    r#"
                    UPDATE night_audit_runs
                    SET total_bookings_posted = COALESCE(total_bookings_posted, 0) + 1,
                        total_revenue = COALESCE(total_revenue, 0) + $2
                    WHERE id = $1
                    "#,
                )
                .bind(run_id)
                .bind(decimal_to_db(night_total))
                .execute(pool)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;

                inserted += 1;
            }
        }

        date = date
            .succ_opt()
            .ok_or_else(|| ApiError::Database("Date overflow".to_string()))?;
    }

    Ok(inserted)
}

/// Check whether a completed audit run exists for the given date.
pub async fn is_audit_completed(pool: &DbPool, audit_date: NaiveDate) -> bool {
    sqlx::query_scalar::<_, Option<bool>>(
        "SELECT EXISTS(SELECT 1 FROM night_audit_runs WHERE audit_date = $1 AND status = 'completed')",
    )
    .bind(audit_date)
    .fetch_one(pool)
    .await
    .unwrap_or(Some(false))
    .unwrap_or(false)
}

/// Delete all records from a previous audit run so it can be re-executed.
pub async fn reset_audit(pool: &DbPool, audit_date: NaiveDate) -> Result<(), ApiError> {
    sqlx::query("DELETE FROM night_audit_posted_nights WHERE audit_date = $1")
        .bind(audit_date)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(
        "UPDATE bookings SET is_posted = FALSE, posted_date = NULL, posted_at = NULL, posted_by = NULL \
         WHERE posted_date = $1",
    )
    .bind(audit_date)
    .execute(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    sqlx::query(
        "DELETE FROM night_audit_details \
         WHERE audit_run_id IN (SELECT id FROM night_audit_runs WHERE audit_date = $1)",
    )
    .bind(audit_date)
    .execute(pool)
    .await
    .ok();

    sqlx::query("DELETE FROM night_audit_runs WHERE audit_date = $1")
        .bind(audit_date)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

/// Call the `run_night_audit` stored procedure and return the new audit run ID.
pub async fn run_audit_procedure(
    pool: &DbPool,
    audit_date: NaiveDate,
    user_id: i64,
) -> Result<i64, ApiError> {
    sqlx::query_scalar("SELECT run_night_audit($1, $2)")
        .bind(audit_date)
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(|e| {
            log::error!("Failed to run night audit: {}", e);
            ApiError::Database(format!("Failed to run night audit: {}", e))
        })
}

/// Fetch a single audit run row with payment/channel breakdowns populated.
pub async fn fetch_audit_run_by_id(
    pool: &DbPool,
    audit_run_id: i64,
) -> Result<NightAuditRunWithUser, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT
            nar.id,
            nar.audit_date,
            nar.run_at,
            u.username,
            nar.status,
            COALESCE(nar.total_bookings_posted, 0) as total_bookings_posted,
            COALESCE(nar.total_checkins, 0) as total_checkins,
            COALESCE(nar.total_checkouts, 0) as total_checkouts,
            COALESCE(nar.total_revenue, 0) as total_revenue,
            COALESCE(nar.occupancy_rate, 0) as occupancy_rate,
            COALESCE(nar.rooms_available, 0) as rooms_available,
            COALESCE(nar.rooms_occupied, 0) as rooms_occupied,
            COALESCE(nar.rooms_reserved, 0) as rooms_reserved,
            COALESCE(nar.rooms_maintenance, 0) as rooms_maintenance,
            COALESCE(nar.rooms_dirty, 0) as rooms_dirty,
            nar.notes,
            nar.created_at
        FROM night_audit_runs nar
        LEFT JOIN users u ON nar.run_by = u.id
        WHERE nar.id = $1
        "#,
    )
    .bind(audit_run_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .ok_or_else(|| ApiError::NotFound("Night audit run not found".to_string()))?;

    let audit_date: NaiveDate = row.get("audit_date");
    let (payment_method_breakdown, booking_channel_breakdown) =
        fetch_breakdown_for_date(pool, audit_date).await;

    Ok(NightAuditRunWithUser {
        id: row.get("id"),
        audit_date,
        run_at: row.get("run_at"),
        run_by_username: row.get("username"),
        status: row.get("status"),
        total_bookings_posted: row.get("total_bookings_posted"),
        total_checkins: row.get("total_checkins"),
        total_checkouts: row.get("total_checkouts"),
        total_revenue: row_mappers::get_decimal(&row, "total_revenue"),
        occupancy_rate: row_mappers::get_decimal(&row, "occupancy_rate"),
        rooms_available: row.get("rooms_available"),
        rooms_occupied: row.get("rooms_occupied"),
        rooms_reserved: row.get("rooms_reserved"),
        rooms_maintenance: row.get("rooms_maintenance"),
        rooms_dirty: row.get("rooms_dirty"),
        notes: row.get("notes"),
        created_at: row.get("created_at"),
        payment_method_breakdown,
        booking_channel_breakdown,
    })
}

/// Compute payment-method and booking-channel revenue breakdowns from posted night records.
pub async fn fetch_breakdown_for_date(
    pool: &DbPool,
    audit_date: NaiveDate,
) -> (Vec<RevenueBreakdownItem>, Vec<RevenueBreakdownItem>) {
    let rows = sqlx::query(
        r#"
        SELECT
            COALESCE(b.payment_method, 'Unknown') as payment_method,
            COALESCE(b.source, 'Unknown') as source,
            napn.total_posted as room_rate
        FROM night_audit_posted_nights napn
        JOIN bookings b ON napn.booking_id = b.id
        WHERE napn.audit_date = $1
          AND b.status != 'voided'
        "#,
    )
    .bind(audit_date)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut pm_map: HashMap<String, (i32, Decimal)> = HashMap::new();
    let mut bc_map: HashMap<String, (i32, Decimal)> = HashMap::new();

    for row in &rows {
        let pm: String = row.get("payment_method");
        let src: String = row.get("source");
        let amt = row_mappers::get_decimal(row, "room_rate");

        let e = pm_map.entry(pm).or_insert((0, Decimal::ZERO));
        e.0 += 1;
        e.1 += amt;

        let e = bc_map.entry(src).or_insert((0, Decimal::ZERO));
        e.0 += 1;
        e.1 += amt;
    }

    let pm_breakdown = pm_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem {
            category,
            count,
            amount,
        })
        .collect();

    let bc_breakdown = bc_map
        .into_iter()
        .map(|(category, (count, amount))| RevenueBreakdownItem {
            category,
            count,
            amount,
        })
        .collect();

    (pm_breakdown, bc_breakdown)
}

/// Build journal sections from bookings and payments for a given audit date.
///
/// `is_posted` controls whether to read from `night_audit_posted_nights` (true)
/// or from active unposted bookings (false / preview mode).
pub async fn generate_journal_sections(
    pool: &DbPool,
    audit_date: NaiveDate,
    is_posted: bool,
) -> Vec<JournalSection> {
    let mut entries: Vec<JournalEntry> = Vec::new();

    let tax_rate_pct =
        settings_cache::get_positive_decimal(pool, "service_tax_rate", Decimal::new(8, 0)).await;
    let divisor = Decimal::ONE + tax_rate_pct / Decimal::new(100, 0);

    let hotel_timezone: String =
        sqlx::query_scalar::<_, String>("SELECT value FROM system_settings WHERE key = 'timezone'")
            .fetch_optional(pool)
            .await
            .unwrap_or(None)
            .unwrap_or_else(|| "UTC".to_string());

    if is_posted {
        let query = r#"
            SELECT
                b.booking_number,
                r.room_number,
                napn.room_charge,
                napn.service_tax,
                COALESCE(napn.tourism_tax, 0) as tourism_tax,
                COALESCE(napn.extra_bed_charge, 0) as extra_bed_charge,
                COALESCE(napn.extra_bed_tax, 0) as extra_bed_tax,
                COALESCE(b.deposit_amount, 0) as deposit_amount,
                b.check_in_date,
                b.status
            FROM night_audit_posted_nights napn
            JOIN bookings b ON napn.booking_id = b.id
            JOIN rooms r ON b.room_id = r.id
            WHERE napn.audit_date = $1
            ORDER BY r.room_number
        "#;

        match sqlx::query(query).bind(audit_date).fetch_all(pool).await {
            Ok(rows) => {
                for row in &rows {
                    let booking_number: String = row.get("booking_number");
                    let room_number: String = row.get("room_number");
                    let room_charge = row_mappers::get_decimal(row, "room_charge");
                    let service_tax = row_mappers::get_decimal(row, "service_tax");
                    let tourism_tax = row_mappers::get_decimal(row, "tourism_tax");
                    let extra_bed_charge = row_mappers::get_decimal(row, "extra_bed_charge");
                    let extra_bed_tax = row_mappers::get_decimal(row, "extra_bed_tax");
                    let deposit_amount = row_mappers::get_decimal(row, "deposit_amount");
                    let check_in_date: NaiveDate = row.get("check_in_date");

                    if room_charge > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "room_charge".to_string(),
                            debit: Decimal::ZERO,
                            credit: room_charge,
                            description: Some("Room Charge".to_string()),
                        });
                    }
                    if service_tax > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "service_tax".to_string(),
                            debit: Decimal::ZERO,
                            credit: service_tax,
                            description: Some("Service Tax".to_string()),
                        });
                    }
                    if extra_bed_charge > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "extra_bed_charge".to_string(),
                            debit: Decimal::ZERO,
                            credit: extra_bed_charge,
                            description: Some("Extra Bed Charge".to_string()),
                        });
                    }
                    if extra_bed_tax > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "extra_bed_tax".to_string(),
                            debit: Decimal::ZERO,
                            credit: extra_bed_tax,
                            description: Some("Extra Bed Tax".to_string()),
                        });
                    }
                    if tourism_tax > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "tourism_tax".to_string(),
                            debit: Decimal::ZERO,
                            credit: tourism_tax,
                            description: Some("Tourism Tax".to_string()),
                        });
                    }
                    if check_in_date == audit_date && deposit_amount > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "deposit".to_string(),
                            debit: deposit_amount,
                            credit: Decimal::ZERO,
                            description: Some("Deposit".to_string()),
                        });
                    }
                }
            }
            Err(e) => {
                log::error!(
                    "Failed to fetch posted room charges for {}: {}",
                    audit_date,
                    e
                );
            }
        }
    } else {
        let query = r#"
            SELECT
                b.booking_number,
                r.room_number,
                b.room_rate,
                COALESCE(b.extra_bed_charge, 0) as extra_bed_charge,
                COALESCE(b.deposit_amount, 0) as deposit_amount,
                COALESCE(b.source, 'walk_in') as source,
                COALESCE(b.remarks, '') as remarks,
                b.check_in_date,
                b.check_out_date,
                b.status,
                COALESCE(b.is_tourist, false) as is_tourist,
                COALESCE(b.tourism_tax_amount, 0) as tourism_tax_amount
            FROM bookings b
            JOIN rooms r ON b.room_id = r.id
            WHERE b.status NOT IN ('pending', 'confirmed', 'voided')
            AND (
                -- Overnight stay: occupied the room the night of the audit date
                (b.check_in_date <= $1 AND b.check_out_date > $1)
                -- Same-day (hourly) checkout: check-in and check-out both on the audit date
                OR (b.status = 'checked_out' AND b.check_in_date = $1 AND b.check_out_date = $1)
            )
            AND NOT EXISTS (
                SELECT 1 FROM night_audit_posted_nights napn
                WHERE napn.booking_id = b.id AND napn.audit_date = $1
            )
            ORDER BY r.room_number
        "#;

        match sqlx::query(query).bind(audit_date).fetch_all(pool).await {
            Ok(rows) => {
                for row in &rows {
                    let booking_number: String = row.get("booking_number");
                    let room_number: String = row.get("room_number");
                    let nightly_rate = row_mappers::get_decimal(row, "room_rate");
                    let extra_bed_charge_raw = row_mappers::get_decimal(row, "extra_bed_charge");
                    let deposit_amount = row_mappers::get_decimal(row, "deposit_amount");
                    let check_in_date: NaiveDate = row.get("check_in_date");
                    let check_out_date: NaiveDate = row.get("check_out_date");
                    let is_tourist: bool = row.get("is_tourist");
                    let tourism_tax_amount = row_mappers::get_decimal(row, "tourism_tax_amount");

                    let room_charge = (nightly_rate / divisor).round_dp(2);
                    let service_tax = nightly_rate - room_charge;

                    if room_charge > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "room_charge".to_string(),
                            debit: Decimal::ZERO,
                            credit: room_charge,
                            description: Some("Room Charge".to_string()),
                        });
                    }
                    if service_tax > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "service_tax".to_string(),
                            debit: Decimal::ZERO,
                            credit: service_tax,
                            description: Some("Service Tax".to_string()),
                        });
                    }

                    if extra_bed_charge_raw > Decimal::ZERO {
                        let extra_bed_charge = (extra_bed_charge_raw / divisor).round_dp(2);
                        let extra_bed_tax = extra_bed_charge_raw - extra_bed_charge;

                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "extra_bed_charge".to_string(),
                            debit: Decimal::ZERO,
                            credit: extra_bed_charge,
                            description: Some("Extra Bed Charge".to_string()),
                        });
                        if extra_bed_tax > Decimal::ZERO {
                            entries.push(JournalEntry {
                                booking_number: booking_number.clone(),
                                room_number: room_number.clone(),
                                entry_type: "extra_bed_tax".to_string(),
                                debit: Decimal::ZERO,
                                credit: extra_bed_tax,
                                description: Some("Extra Bed Tax".to_string()),
                            });
                        }
                    }

                    if is_tourist && tourism_tax_amount > Decimal::ZERO {
                        let nights = (check_out_date - check_in_date).num_days().max(1);
                        let per_night = (tourism_tax_amount / Decimal::from(nights)).round_dp(2);
                        if per_night > Decimal::ZERO {
                            entries.push(JournalEntry {
                                booking_number: booking_number.clone(),
                                room_number: room_number.clone(),
                                entry_type: "tourism_tax".to_string(),
                                debit: Decimal::ZERO,
                                credit: per_night,
                                description: Some("Tourism Tax".to_string()),
                            });
                        }
                    }

                    if check_in_date == audit_date && deposit_amount > Decimal::ZERO {
                        entries.push(JournalEntry {
                            booking_number: booking_number.clone(),
                            room_number: room_number.clone(),
                            entry_type: "deposit".to_string(),
                            debit: deposit_amount,
                            credit: Decimal::ZERO,
                            description: Some("Deposit".to_string()),
                        });
                    }
                }
            }
            Err(e) => {
                log::error!(
                    "Failed to fetch unposted room charges for {}: {}",
                    audit_date,
                    e
                );
            }
        }
    }

    // Payments made on the audit date
    let payment_query = r#"
        SELECT
            b.booking_number,
            r.room_number,
            p.amount,
            COALESCE(p.payment_method, '') as payment_method,
            COALESCE(p.payment_type, '') as payment_type,
            COALESCE(p.notes, '') as payment_notes,
            COALESCE(b.source, '') as source,
            COALESCE(b.remarks, '') as booking_remarks,
            b.check_in_date,
            b.check_out_date
        FROM payments p
        JOIN bookings b ON p.booking_id = b.id
        JOIN rooms r ON b.room_id = r.id
        WHERE p.status = 'completed'
        AND p.payment_type != 'refund'
        AND b.status != 'voided'
        AND (p.created_at AT TIME ZONE $2)::date = $1
        ORDER BY r.room_number
    "#;

    match sqlx::query(payment_query)
        .bind(audit_date)
        .bind(&hotel_timezone)
        .fetch_all(pool)
        .await
    {
        Ok(payment_rows) => {
            for row in &payment_rows {
                let booking_number: String = row.get("booking_number");
                let room_number: String = row.get("room_number");
                let amount = row_mappers::get_decimal(row, "amount");
                let payment_method: String = row.get("payment_method");
                let payment_type: String = row.get("payment_type");
                let payment_notes: String = row.get("payment_notes");
                let source: String = row.get("source");
                let booking_remarks: String = row.get("booking_remarks");
                let check_in_date: NaiveDate = row.get("check_in_date");

                if payment_type == "refund" {
                    continue;
                }

                let account_name = payment_account_label(
                    Some(&payment_method),
                    Some(&source),
                    Some(&booking_remarks),
                );

                let description = if check_in_date > audit_date {
                    let room_desc = if !payment_notes.is_empty() {
                        payment_notes.clone()
                    } else {
                        format!(
                            "Book {} on {}",
                            room_number,
                            check_in_date.format("%d.%m.%Y")
                        )
                    };
                    Some(room_desc)
                } else {
                    None
                };

                entries.push(JournalEntry {
                    booking_number: booking_number.clone(),
                    room_number: room_number.clone(),
                    entry_type: format!("payment_{}", account_name),
                    debit: amount,
                    credit: Decimal::ZERO,
                    description: description.or_else(|| Some(account_name.clone())),
                });
            }
        }
        Err(e) => {
            log::error!("Failed to fetch payments for {}: {}", audit_date, e);
        }
    }

    // Deposit refunds are driven by the refund payment record itself: one entry
    // per payments row with payment_type='refund' whose created_at (in hotel TZ)
    // falls on the audit date. Amount comes from the payment, not the booking's
    // deposit_amount column.
    let refund_query = r#"
        SELECT
            b.booking_number,
            r.room_number,
            p.amount,
            p.payment_method,
            p.notes
        FROM payments p
        JOIN bookings b ON p.booking_id = b.id
        JOIN rooms r ON b.room_id = r.id
        WHERE p.payment_type = 'refund'
        AND p.status = 'refunded'
        AND b.status != 'voided'
        AND (p.created_at AT TIME ZONE $2)::date = $1
        ORDER BY r.room_number
    "#;

    match sqlx::query(refund_query)
        .bind(audit_date)
        .bind(&hotel_timezone)
        .fetch_all(pool)
        .await
    {
        Ok(refund_rows) => {
            for row in &refund_rows {
                let booking_number: String = row.get("booking_number");
                let room_number: String = row.get("room_number");
                let amount = row_mappers::get_decimal(row, "amount");
                let notes: Option<String> = row.try_get("notes").ok();

                entries.push(JournalEntry {
                    booking_number,
                    room_number,
                    entry_type: "deposit_refund".to_string(),
                    debit: Decimal::ZERO,
                    credit: amount,
                    description: Some(
                        notes
                            .filter(|s| !s.trim().is_empty())
                            .unwrap_or_else(|| "Deposit Refund".to_string()),
                    ),
                });
            }
        }
        Err(e) => {
            log::error!("Failed to fetch deposit refunds for {}: {}", audit_date, e);
        }
    }

    // City ledger payments received on the audit date
    let city_ledger_query = r#"
        SELECT
            cl.company_name,
            COALESCE(cl.room_number, '') as room_number,
            clp.payment_amount,
            COALESCE(clp.payment_method, 'Unknown') as payment_method
        FROM customer_ledger_payments clp
        JOIN customer_ledgers cl ON clp.ledger_id = cl.id
        WHERE cl.void_at IS NULL
        AND (clp.payment_date AT TIME ZONE $2)::date = $1
        ORDER BY cl.company_name
    "#;

    match sqlx::query(city_ledger_query)
        .bind(audit_date)
        .bind(&hotel_timezone)
        .fetch_all(pool)
        .await
    {
        Ok(clp_rows) => {
            for row in &clp_rows {
                let company_name: String = row.get("company_name");
                let room_number: String = row.get("room_number");
                let payment_amount = row_mappers::get_decimal(row, "payment_amount");
                let payment_method: String = row.get("payment_method");

                entries.push(JournalEntry {
                    booking_number: company_name,
                    room_number,
                    entry_type: "city_ledger".to_string(),
                    debit: Decimal::ZERO,
                    credit: payment_amount,
                    description: Some(format!("City Ledger Payment ({})", payment_method)),
                });
            }
        }
        Err(e) => {
            log::error!(
                "Failed to fetch city ledger payments for {}: {}",
                audit_date,
                e
            );
        }
    }

    // Group entries into ordered sections
    let fixed_types = [
        ("room_charge", "Room Charges"),
        ("service_tax", "Service Tax"),
        ("extra_bed_charge", "Extra Bed Charges"),
        ("extra_bed_tax", "Extra Bed Tax"),
        ("tourism_tax", "Tourism Tax"),
    ];

    let mut sections: Vec<JournalSection> = Vec::new();

    for (type_key, display_name) in &fixed_types {
        let type_entries: Vec<JournalEntry> = entries
            .iter()
            .filter(|e| e.entry_type == *type_key)
            .cloned()
            .collect();
        if !type_entries.is_empty() {
            let total_debit = type_entries.iter().map(|e| e.debit).sum();
            let total_credit = type_entries.iter().map(|e| e.credit).sum();
            sections.push(JournalSection {
                entry_type: type_key.to_string(),
                display_name: display_name.to_string(),
                entries: type_entries,
                total_debit,
                total_credit,
            });
        }
    }

    let mut payment_types: Vec<String> = entries
        .iter()
        .filter(|e| e.entry_type.starts_with("payment_"))
        .map(|e| e.entry_type.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    payment_types.sort();

    for pt in &payment_types {
        let type_entries: Vec<JournalEntry> = entries
            .iter()
            .filter(|e| e.entry_type == *pt)
            .cloned()
            .collect();
        if !type_entries.is_empty() {
            let total_debit = type_entries.iter().map(|e| e.debit).sum();
            let total_credit = type_entries.iter().map(|e| e.credit).sum();
            let display_name = type_entries
                .first()
                .map(|_| pt.replace("payment_", ""))
                .unwrap_or_else(|| pt.replace("payment_", ""));
            sections.push(JournalSection {
                entry_type: pt.clone(),
                display_name,
                entries: type_entries,
                total_debit,
                total_credit,
            });
        }
    }

    let trailing_types = [
        ("deposit", "Deposit"),
        ("deposit_refund", "Deposit Refund"),
        ("city_ledger", "City Ledger"),
    ];

    for (type_key, display_name) in &trailing_types {
        let type_entries: Vec<JournalEntry> = entries
            .iter()
            .filter(|e| e.entry_type == *type_key)
            .cloned()
            .collect();
        if !type_entries.is_empty() {
            let total_debit = type_entries.iter().map(|e| e.debit).sum();
            let total_credit = type_entries.iter().map(|e| e.credit).sum();
            sections.push(JournalSection {
                entry_type: type_key.to_string(),
                display_name: display_name.to_string(),
                entries: type_entries,
                total_debit,
                total_credit,
            });
        }
    }

    sections
}
