//! Night audit business logic

use chrono::NaiveDate;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    AuditDetailsResponse, ListAuditsQuery, NightAuditPreview, NightAuditResponse,
    NightAuditRunWithUser, RunNightAuditRequest,
};
use crate::repositories::night_audit as repo;
use crate::services::audit::AuditLog;
use crate::utils::pagination::normalize_pagination;

pub async fn preview(pool: &DbPool, audit_date: NaiveDate) -> Result<NightAuditPreview, ApiError> {
    repo::preview(pool, audit_date).await
}

pub async fn run(
    pool: &DbPool,
    user_id: i64,
    input: RunNightAuditRequest,
) -> Result<NightAuditResponse, ApiError> {
    let audit_date = NaiveDate::parse_from_str(&input.audit_date, "%Y-%m-%d").map_err(|e| {
        log::error!("Invalid date format: {} - error: {}", input.audit_date, e);
        ApiError::BadRequest(format!(
            "Invalid date format '{}'. Use YYYY-MM-DD",
            input.audit_date
        ))
    })?;

    let already_run = is_audit_completed(pool, audit_date).await;
    if already_run {
        if input.force {
            reset_audit(pool, audit_date).await?;
        } else {
            return Err(ApiError::BadRequest(format!(
                "Night audit already completed for {}. Use force=true to rerun.",
                audit_date
            )));
        }
    }

    let audit_run_id = run_audit_procedure(pool, audit_date, user_id).await?;

    match crate::services::invoice_numbers::backfill_missing_booking_invoices(pool).await {
        Ok(0) => {}
        Ok(n) => log::info!(
            "Night audit backfilled invoice numbers for {} booking(s)",
            n
        ),
        Err(e) => log::warn!("Night audit invoice backfill failed: {}", e),
    }

    if let Some(notes) = &input.notes {
        let _ = repo::update_audit_notes(pool, audit_run_id, notes).await;
    }

    let audit_run = fetch_audit_run_by_id(pool, audit_run_id).await?;

    let _ = AuditLog::log_event(
        pool,
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

    Ok(NightAuditResponse {
        success: true,
        message: format!("Night audit completed successfully for {}", audit_date),
        audit_run,
    })
}

pub async fn list(
    pool: &DbPool,
    params: ListAuditsQuery,
) -> Result<Vec<NightAuditRunWithUser>, ApiError> {
    let pagination = normalize_pagination(
        params.page.map(i64::from),
        params.page_size.map(i64::from),
        30,
        100,
    );

    repo::list_audit_runs(pool, pagination.page_size, pagination.offset).await
}

pub async fn get(pool: &DbPool, audit_id: i64) -> Result<NightAuditRunWithUser, ApiError> {
    fetch_audit_run_by_id(pool, audit_id).await
}

pub async fn details(pool: &DbPool, audit_id: i64) -> Result<AuditDetailsResponse, ApiError> {
    repo::audit_details(pool, audit_id).await
}

pub async fn booking_posted_status(
    pool: &DbPool,
    booking_id: i64,
) -> Result<serde_json::Value, ApiError> {
    repo::booking_posted_status(pool, booking_id).await
}

/// Backfill missing `night_audit_posted_nights` rows for a booking whose stay
/// overlaps one or more already-completed audit dates.
pub async fn backfill_booking_posted_nights(
    pool: &DbPool,
    booking_id: i64,
    posted_by: i64,
) -> Result<u32, ApiError> {
    repo::backfill_booking_posted_nights(pool, booking_id, posted_by).await
}

/// Check whether a completed audit run exists for the given date.
pub async fn is_audit_completed(pool: &DbPool, audit_date: NaiveDate) -> bool {
    repo::is_audit_completed(pool, audit_date).await
}

/// Delete all records from a previous audit run so it can be re-executed.
pub async fn reset_audit(pool: &DbPool, audit_date: NaiveDate) -> Result<(), ApiError> {
    repo::reset_audit(pool, audit_date).await
}

/// Call the `run_night_audit` stored procedure and return the new audit run ID.
pub async fn run_audit_procedure(
    pool: &DbPool,
    audit_date: NaiveDate,
    user_id: i64,
) -> Result<i64, ApiError> {
    repo::run_audit_procedure(pool, audit_date, user_id).await
}

/// Fetch a single audit run row with payment/channel breakdowns populated.
pub async fn fetch_audit_run_by_id(
    pool: &DbPool,
    audit_run_id: i64,
) -> Result<NightAuditRunWithUser, ApiError> {
    repo::fetch_audit_run_by_id(pool, audit_run_id).await
}
