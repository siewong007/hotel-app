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

/// Run the night audit on behalf of an interactive user (front-desk staff).
pub async fn run(
    pool: &DbPool,
    user_id: i64,
    input: RunNightAuditRequest,
) -> Result<NightAuditResponse, ApiError> {
    run_with_user(pool, Some(user_id), input).await
}

/// Run the night audit unattended (scheduler). Posts under a `NULL` user so the
/// run is distinguishable from a manual one, and never forces a rerun.
pub async fn run_automated(
    pool: &DbPool,
    audit_date: NaiveDate,
) -> Result<NightAuditResponse, ApiError> {
    run_with_user(
        pool,
        None,
        RunNightAuditRequest {
            audit_date: audit_date.to_string(),
            notes: Some("Automated night audit".to_string()),
            force: false,
        },
    )
    .await
}

/// Core audit execution. `run_by` is `Some(user_id)` for a manual run and `None`
/// for an automated/scheduled run.
pub async fn run_with_user(
    pool: &DbPool,
    run_by: Option<i64>,
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

    let audit_run_id = run_audit_procedure(pool, audit_date, run_by).await?;

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
        run_by,
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
/// `user_id` is `None` for an automated/scheduled run (posts under a NULL user).
pub async fn run_audit_procedure(
    pool: &DbPool,
    audit_date: NaiveDate,
    user_id: Option<i64>,
) -> Result<i64, ApiError> {
    repo::run_audit_procedure(pool, audit_date, user_id).await
}

/// The most recent business date with a completed audit run, if any.
pub async fn last_completed_audit_date(pool: &DbPool) -> Result<Option<NaiveDate>, ApiError> {
    repo::last_completed_audit_date(pool).await
}

/// Decide which business dates are due for posting but not yet closed.
///
/// Pure (no I/O) so it can be unit-tested. `now_local`/`configured` are in the
/// hotel's local timezone. Returns dates ascending (oldest first); the caller
/// still re-checks `is_audit_completed` per date before running.
///
/// - Today's audit only becomes due once `now_local` reaches `configured` time.
/// - On first-ever enable (`last_completed == None`) only the target date is
///   posted — we never back-fill arbitrary history.
/// - Catch-up after downtime is bounded to `catchup_days` so a long gap (or a
///   fresh database) can't trigger an unbounded sweep.
pub fn due_audit_dates(
    now_local: chrono::NaiveDateTime,
    configured: chrono::NaiveTime,
    last_completed: Option<NaiveDate>,
    catchup_days: i64,
) -> Vec<NaiveDate> {
    let today = now_local.date();
    let target = if now_local.time() >= configured {
        today
    } else {
        today - chrono::Duration::days(1)
    };

    let mut start = match last_completed {
        Some(d) => d + chrono::Duration::days(1),
        None => target,
    };
    let floor = target - chrono::Duration::days(catchup_days.max(0));
    if start < floor {
        start = floor;
    }

    if start > target {
        return Vec::new();
    }

    let mut dates = Vec::new();
    let mut d = start;
    while d <= target {
        dates.push(d);
        d += chrono::Duration::days(1);
    }
    dates
}

/// Fetch a single audit run row with payment/channel breakdowns populated.
pub async fn fetch_audit_run_by_id(
    pool: &DbPool,
    audit_run_id: i64,
) -> Result<NightAuditRunWithUser, ApiError> {
    repo::fetch_audit_run_by_id(pool, audit_run_id).await
}

#[cfg(test)]
mod tests {
    use super::due_audit_dates;
    use chrono::{NaiveDate, NaiveDateTime, NaiveTime};

    fn dt(date: &str, time: &str) -> NaiveDateTime {
        NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .unwrap()
            .and_time(NaiveTime::parse_from_str(time, "%H:%M").unwrap())
    }

    fn d(date: &str) -> NaiveDate {
        NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap()
    }

    fn at_23() -> NaiveTime {
        NaiveTime::parse_from_str("23:00", "%H:%M").unwrap()
    }

    #[test]
    fn before_configured_time_with_yesterday_closed_is_empty() {
        // 22:00, configured 23:00 → today not yet due; yesterday already closed.
        let out = due_audit_dates(dt("2026-06-19", "22:00"), at_23(), Some(d("2026-06-18")), 7);
        assert!(out.is_empty());
    }

    #[test]
    fn after_configured_time_runs_today() {
        let out = due_audit_dates(dt("2026-06-19", "23:30"), at_23(), Some(d("2026-06-18")), 7);
        assert_eq!(out, vec![d("2026-06-19")]);
    }

    #[test]
    fn catches_up_missed_dates_in_order() {
        // Last close was 5 days ago; after the time today → close the gap + today.
        let out = due_audit_dates(dt("2026-06-19", "23:30"), at_23(), Some(d("2026-06-14")), 7);
        assert_eq!(
            out,
            vec![
                d("2026-06-15"),
                d("2026-06-16"),
                d("2026-06-17"),
                d("2026-06-18"),
                d("2026-06-19"),
            ]
        );
    }

    #[test]
    fn first_ever_run_does_not_backfill_history() {
        let out = due_audit_dates(dt("2026-06-19", "23:30"), at_23(), None, 7);
        assert_eq!(out, vec![d("2026-06-19")]);
    }

    #[test]
    fn catchup_is_bounded_by_window() {
        // 30-day gap, window 7 → only the last 7 days through today (8 dates).
        let out = due_audit_dates(dt("2026-06-19", "23:30"), at_23(), Some(d("2026-05-20")), 7);
        assert_eq!(out.first(), Some(&d("2026-06-12")));
        assert_eq!(out.last(), Some(&d("2026-06-19")));
        assert_eq!(out.len(), 8);
    }

    #[test]
    fn before_time_catches_up_through_yesterday() {
        // 10:00 today, configured 23:00, last close 3 days ago → close up to yesterday.
        let out = due_audit_dates(dt("2026-06-19", "10:00"), at_23(), Some(d("2026-06-16")), 7);
        assert_eq!(out, vec![d("2026-06-17"), d("2026-06-18")]);
    }
}
