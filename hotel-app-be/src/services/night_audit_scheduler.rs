//! Background scheduler that runs the night audit automatically at the
//! configured `night_shift_time`.
//!
//! Opt-in via the `night_audit_auto_enabled` setting — the loop is inert (a
//! cheap settings read, then sleep) until an admin turns it on, so the manual
//! Night Audit workflow is unchanged by default.
//!
//! Single-instance design: idempotency is structural, not racy. The
//! `night_audit_runs.audit_date` UNIQUE constraint plus the `is_audit_completed`
//! pre-check mean a duplicate tick (or a restart mid-window) can never
//! double-post a date. Catch-up after downtime is bounded by
//! `night_audit_catchup_days` so a long gap or a fresh database can't trigger an
//! unbounded sweep.

use std::time::Duration;

use chrono::{Datelike, NaiveDateTime, NaiveTime};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::services::night_audit;

/// How often the loop wakes to check whether an audit is due. The audit fires at
/// most once per business date regardless of this cadence.
const POLL_INTERVAL: Duration = Duration::from_secs(60);
const DEFAULT_SHIFT_TIME: &str = "23:00";
const DEFAULT_CATCHUP_DAYS: i32 = 7;

/// Spawn the night-audit scheduler. Returns immediately; the task runs for the
/// lifetime of the process and never propagates a panic/error to the caller.
pub fn spawn(pool: DbPool) {
    tokio::spawn(async move {
        log::info!(
            "Night audit scheduler started (polling every {}s; enable via 'night_audit_auto_enabled')",
            POLL_INTERVAL.as_secs()
        );
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            if let Err(e) = tick(&pool).await {
                // Log and keep looping — a transient DB error must not kill the
                // scheduler; the next tick retries.
                log::warn!("Night audit scheduler tick failed: {}", e);
            }
        }
    });
}

/// One scheduler iteration: if automation is enabled, post any business dates
/// that are due but not yet closed, oldest first.
async fn tick(pool: &DbPool) -> Result<(), ApiError> {
    // Audit-partition maintenance runs on this cadence regardless of whether
    // night-audit automation is on — `audit_logs` is written by every domain,
    // and letting the pre-created window lapse would silently push all new
    // audit rows into the unbounded default partition.
    ensure_audit_partitions_once_daily(pool).await;

    if !is_enabled(pool).await {
        return Ok(());
    }

    let configured =
        parse_time(&settings_cache::get_string(pool, "night_shift_time", DEFAULT_SHIFT_TIME).await);
    let catchup_days =
        settings_cache::get_positive_i32(pool, "night_audit_catchup_days", DEFAULT_CATCHUP_DAYS)
            .await as i64;

    let now_local = hotel_local_now(pool).await?;
    let last_completed = night_audit::last_completed_audit_date(pool).await?;

    let dates = night_audit::due_audit_dates(now_local, configured, last_completed, catchup_days);

    for date in dates {
        // Re-check right before running: covers a run (manual or a prior tick)
        // that completed after `last_completed` was read.
        if night_audit::is_audit_completed(pool, date).await {
            continue;
        }
        match night_audit::run_automated(pool, date).await {
            Ok(resp) => log::info!(
                "Automated night audit completed for {}: {} booking(s) posted, revenue {}",
                date,
                resp.audit_run.total_bookings_posted,
                resp.audit_run.total_revenue
            ),
            Err(e) => {
                // Stop the sweep on the first failure so we don't skip a date;
                // the next tick resumes from the same point.
                log::error!("Automated night audit failed for {}: {}", date, e);
                break;
            }
        }
    }

    Ok(())
}

async fn is_enabled(pool: &DbPool) -> bool {
    let raw = settings_cache::get_string(pool, "night_audit_auto_enabled", "false").await;
    matches!(
        raw.trim().to_ascii_lowercase().as_str(),
        "true" | "1" | "yes" | "on"
    )
}

/// Day-of-epoch of the last successful partition ensure; `i64::MIN` forces the
/// first tick to run it. A failed ensure retries on the next tick (the marker
/// only advances on success), so a transient DB blip self-heals. Two racing
/// ticks may both ensure — the call is idempotent, so that is harmless.
static LAST_PARTITION_ENSURE_EPOCH_DAY: std::sync::atomic::AtomicI64 =
    std::sync::atomic::AtomicI64::new(i64::MIN);

async fn ensure_audit_partitions_once_daily(pool: &DbPool) {
    let today_epoch_day: i64 = match hotel_local_now(pool).await {
        Ok(now) => now.date().num_days_from_ce().into(),
        Err(_) => return,
    };
    if LAST_PARTITION_ENSURE_EPOCH_DAY.load(std::sync::atomic::Ordering::Relaxed) >= today_epoch_day
    {
        return;
    }
    match crate::repositories::audit::AuditRepository::ensure_upcoming_partitions(pool).await {
        Ok(()) => {
            LAST_PARTITION_ENSURE_EPOCH_DAY
                .store(today_epoch_day, std::sync::atomic::Ordering::Relaxed);
        }
        Err(error) => {
            log::warn!("audit_logs partition ensure failed (retries next tick): {error}");
        }
    }
}

fn parse_time(raw: &str) -> NaiveTime {
    let raw = raw.trim();
    NaiveTime::parse_from_str(raw, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(raw, "%H:%M:%S"))
        .unwrap_or_else(|_| NaiveTime::from_hms_opt(23, 0, 0).unwrap())
}

/// "Now" in the hotel's configured timezone. Read from the database so it uses
/// the same per-connection `SET timezone` the rest of the app relies on for date
/// math (see `core/db.rs`), avoiding a separate timezone dependency.
async fn hotel_local_now(pool: &DbPool) -> Result<NaiveDateTime, ApiError> {
    sqlx::query_scalar::<_, NaiveDateTime>("SELECT LOCALTIMESTAMP")
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
}
