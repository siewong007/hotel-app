//! Night Audit handlers for posting daily data for reporting

use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::Row;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::models::{
    AuditDetailsResponse, ListAuditsQuery, NightAuditPreview, NightAuditResponse,
    NightAuditRunWithUser, PostedBookingDetail, RevenueBreakdownItem, RoomSnapshot,
    RunNightAuditRequest, UnpostedBooking,
};
use crate::services::audit::AuditLog;
use crate::services::night_audit as svc;
use std::collections::HashMap;

/// Get preview of what will be posted for a given date
pub async fn get_night_audit_preview(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<NightAuditPreview>, ApiError> {
    log::info!("Night audit preview called with params: {:?}", params);

    let _user_id = match require_permission_helper(&pool, &headers, "night_audit:read").await {
        Ok(id) => id,
        Err(e) => {
            log::error!("Permission check failed: {:?}", e);
            return Err(e);
        }
    };

    let audit_date_str = params
        .get("date")
        .ok_or_else(|| ApiError::BadRequest("date parameter is required".to_string()))?;

    let audit_date = NaiveDate::parse_from_str(audit_date_str, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid date format. Use YYYY-MM-DD".to_string()))?;

    log::info!("Checking if audit already run for date: {}", audit_date);

    let already_run = svc::is_audit_completed(&pool, audit_date).await;

    log::info!("Already run: {}, fetching unposted bookings", already_run);

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
            (b.status IN ('checked_in', 'auto_checked_in') AND b.check_in_date <= $1 AND b.check_out_date > $1)
            OR (b.status = 'checked_out' AND b.check_in_date <= $1 AND b.check_out_date >= $1)
        )
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = $1
        )
        ORDER BY r.room_number
        "#,
    )
    .bind(audit_date)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        log::error!("Error fetching unposted bookings: {:?}", e);
        ApiError::Database(e.to_string())
    })?;

    log::info!("Fetched {} booking rows", rows.len());

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
        let room_rate: Decimal = row.get("room_rate");
        let extra_bed_charge: Decimal = row.get("extra_bed_charge");
        let _total_amount: Decimal = row.get("total_amount");
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

    log::info!("Parsed {} unposted bookings", unposted_bookings.len());

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

    log::info!(
        "Estimated revenue: {}, fetching room snapshot",
        estimated_revenue
    );

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
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        log::error!("Error fetching room snapshot: {:?}", e);
        ApiError::Database(e.to_string())
    })?;

    log::info!("Room snapshot fetched successfully");

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
    .fetch_one(&pool)
    .await
    .unwrap_or(Some(0))
    .unwrap_or(0);

    log::info!("Occupied from bookings: {}", occupied_from_bookings);

    let journal_sections = svc::generate_journal_sections(&pool, audit_date, false).await;

    Ok(Json(NightAuditPreview {
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
    }))
}

/// Run night audit for a specific date
pub async fn run_night_audit(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<RunNightAuditRequest>,
) -> Result<Json<NightAuditResponse>, ApiError> {
    log::info!(
        "Run night audit called for date: {}, force: {}",
        input.audit_date,
        input.force
    );
    let user_id = require_permission_helper(&pool, &headers, "night_audit:execute").await?;
    log::info!("User {} authorized for night audit", user_id);

    let audit_date = NaiveDate::parse_from_str(&input.audit_date, "%Y-%m-%d").map_err(|e| {
        log::error!("Invalid date format: {} - error: {}", input.audit_date, e);
        ApiError::BadRequest(format!(
            "Invalid date format '{}'. Use YYYY-MM-DD",
            input.audit_date
        ))
    })?;

    let already_run = svc::is_audit_completed(&pool, audit_date).await;
    log::info!(
        "Checking if audit already run for {}: {}",
        audit_date,
        already_run
    );

    if already_run {
        if input.force {
            log::info!(
                "Force rerun requested for {}. Resetting previous audit.",
                audit_date
            );
            svc::reset_audit(&pool, audit_date).await?;
            log::info!("Previous audit for {} has been reset", audit_date);
        } else {
            return Err(ApiError::BadRequest(format!(
                "Night audit already completed for {}. Use force=true to rerun.",
                audit_date
            )));
        }
    }

    log::info!("Running night audit database function for {}", audit_date);
    let audit_run_id = svc::run_audit_procedure(&pool, audit_date, user_id).await?;
    log::info!("Night audit completed, run ID: {}", audit_run_id);

    // Catch up any checked-out bookings that didn't get an invoice row at
    // checkout time. The startup-only backfill leaves a gap whenever the
    // backend isn't restarted; running here gives us at least one daily pass.
    match crate::services::invoice_numbers::backfill_missing_booking_invoices(&pool).await {
        Ok(0) => {}
        Ok(n) => log::info!("Night audit backfilled invoice numbers for {} booking(s)", n),
        Err(e) => log::warn!("Night audit invoice backfill failed: {}", e),
    }

    if let Some(notes) = &input.notes {
        let _ = sqlx::query("UPDATE night_audit_runs SET notes = $1 WHERE id = $2")
            .bind(notes)
            .bind(audit_run_id)
            .execute(&pool)
            .await;
    }

    let audit_run = svc::fetch_audit_run_by_id(&pool, audit_run_id).await?;

    let _ = AuditLog::log_event(
        &pool,
        Some(user_id),
        "night_audit_run",
        "night_audit",
        Some(audit_run_id),
        Some(serde_json::json!({
            "audit_date": audit_date.to_string(),
            "bookings_posted": audit_run.total_bookings_posted,
            "revenue": audit_run.total_revenue.to_string(),
        })),
        None,
        None,
    )
    .await;

    Ok(Json(NightAuditResponse {
        success: true,
        message: format!("Night audit completed successfully for {}", audit_date),
        audit_run,
    }))
}

/// List all night audit runs
pub async fn list_night_audits(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<ListAuditsQuery>,
) -> Result<Json<Vec<NightAuditRunWithUser>>, ApiError> {
    log::info!("List night audits called");
    let _user_id = require_permission_helper(&pool, &headers, "night_audit:read").await?;

    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(30).min(100);
    let offset = (page - 1) * page_size;
    log::info!("Fetching audits page {} with size {}", page, page_size);

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
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        log::error!("Failed to fetch night audit runs: {}", e);
        ApiError::Database(e.to_string())
    })?;

    log::info!("Fetched {} night audit rows", rows.len());

    let mut result: Vec<NightAuditRunWithUser> = Vec::new();
    for row in rows.iter() {
        let audit_date: NaiveDate = row.get("audit_date");
        let (payment_method_breakdown, booking_channel_breakdown) =
            svc::fetch_breakdown_for_date(&pool, audit_date).await;

        result.push(NightAuditRunWithUser {
            id: row.get("id"),
            audit_date,
            run_at: row.get("run_at"),
            run_by_username: row.get("username"),
            status: row.get("status"),
            total_bookings_posted: row.get("total_bookings_posted"),
            total_checkins: row.get("total_checkins"),
            total_checkouts: row.get("total_checkouts"),
            total_revenue: row.get("total_revenue"),
            occupancy_rate: row.get("occupancy_rate"),
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

    log::info!("List night audits returning {} results", result.len());
    Ok(Json(result))
}

/// Get a specific night audit run by ID
pub async fn get_night_audit(
    State(pool): State<DbPool>,
    Path(audit_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<NightAuditRunWithUser>, ApiError> {
    let _user_id = require_permission_helper(&pool, &headers, "night_audit:read").await?;
    let audit_run = svc::fetch_audit_run_by_id(&pool, audit_id).await?;
    Ok(Json(audit_run))
}

/// Get audit details including all posted bookings
pub async fn get_night_audit_details(
    State(pool): State<DbPool>,
    Path(audit_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<AuditDetailsResponse>, ApiError> {
    let _user_id = require_permission_helper(&pool, &headers, "night_audit:read").await?;

    let audit_run = svc::fetch_audit_run_by_id(&pool, audit_id).await?;
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
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let posted_bookings: Vec<PostedBookingDetail> = booking_rows
        .iter()
        .map(|row| {
            let source: Option<String> = row.get("source");
            let total_amount: Decimal = row.get("total_amount");
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

    let journal_sections = svc::generate_journal_sections(&pool, audit_date, true).await;

    Ok(Json(AuditDetailsResponse {
        audit_run,
        posted_bookings,
        journal_sections,
    }))
}

/// Check if a booking is posted (can be used to prevent editing)
pub async fn is_booking_posted(
    State(pool): State<DbPool>,
    Path(booking_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _user_id = require_permission_helper(&pool, &headers, "bookings:read").await?;

    let row = sqlx::query(
        "SELECT COALESCE(is_posted, false) as is_posted, posted_date FROM bookings WHERE id = $1",
    )
    .bind(booking_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    match row {
        Some(r) => Ok(Json(serde_json::json!({
            "booking_id": booking_id,
            "is_posted": r.get::<bool, _>("is_posted"),
            "posted_date": r.get::<Option<NaiveDate>, _>("posted_date"),
        }))),
        None => Err(ApiError::NotFound("Booking not found".to_string())),
    }
}
