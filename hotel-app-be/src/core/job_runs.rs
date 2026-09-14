//! Heartbeat persistence for the background loops spawned in `main.rs`.
//!
//! Each loop calls [`record`] or [`record_outcome`] once per iteration;
//! `job_runs` then answers the two questions the admin Jobs page asks — is the
//! loop alive, and did its last run succeed — without a queue framework or
//! per-loop bookkeeping.
//!
//! Two deliberate properties:
//!
//! * **Best-effort.** A monitoring row must never kill the loop it observes,
//!   so a failed insert is logged and dropped, and a missing table (the table
//!   is baseline-only until its patch ships) is a once-per-process probe, not
//!   an error.
//! * **Every tick writes a row.** Recording only "did work" iterations would
//!   make a healthy-but-quiet loop indistinguishable from a dead one. At a
//!   60-second cadence that is ~1,400 small rows per job per day — the size
//!   that makes liveness honest.

use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;

use crate::core::db::DbPool;
use crate::core::error::ApiError;

/// Probed once per process: databases installed before `job_runs` entered the
/// baseline report `false` for the process lifetime. A restart after the patch
/// lands is what turns instrumentation on there — documented behavior, not a
/// retry loop.
static JOB_RUNS_PRESENT: OnceLock<bool> = OnceLock::new();

/// Shared by the writer (`record`) and the admin read side so both agree on
/// whether `job_runs` exists on this database.
pub async fn table_present(pool: &DbPool) -> bool {
    if let Some(present) = JOB_RUNS_PRESENT.get() {
        return *present;
    }
    let present =
        sqlx::query_scalar::<_, bool>("SELECT to_regclass('public.job_runs') IS NOT NULL")
            .fetch_one(pool)
            .await
            .unwrap_or(false);
    let _ = JOB_RUNS_PRESENT.set(present);
    present
}

/// Persist one loop iteration. `error` set means the tick failed; `detail`
/// carries the outcome payload (counts, flags) for a successful one.
pub async fn record(
    pool: &DbPool,
    job_name: &str,
    detail: Option<serde_json::Value>,
    error: Option<String>,
    duration: Duration,
) {
    if !table_present(pool).await {
        return;
    }
    let duration_ms = i32::try_from(duration.as_millis()).unwrap_or(i32::MAX);
    if let Err(e) = sqlx::query(
        "INSERT INTO job_runs (job_name, status, detail, error, duration_ms) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(job_name)
    .bind(if error.is_some() { "error" } else { "ok" })
    .bind(detail)
    .bind(error.clone())
    .bind(duration_ms)
    .execute(pool)
    .await
    {
        log::warn!("job_runs write failed for {job_name}: {e}");
        return;
    }

    // A failed iteration also raises a staff notification, deduplicated to at
    // most one per job per hour so a loop that keeps failing does not bury the
    // notification center. `staff_notifications` ships in the same baseline as
    // `job_runs`, so the table_present gate above covers it too.
    if let Some(error) = error
        && let Err(e) = sqlx::query(
            "INSERT INTO staff_notifications
                (audience_permission, kind, subject, title, body)
             SELECT 'settings:manage', 'job_failure', $1, $2, $3
             WHERE NOT EXISTS (
                SELECT 1 FROM staff_notifications
                WHERE kind = 'job_failure' AND subject = $1
                  AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
             )",
        )
        .bind(job_name)
        .bind(format!("Background job failed: {job_name}"))
        .bind(error)
        .execute(pool)
        .await
    {
        log::warn!("staff notification write failed for {job_name}: {e}");
    }
}

/// Convenience for ticks whose outcome is a `Result`: serializes `Ok` into
/// `detail`, stringifies `Err` into `error`.
pub async fn record_outcome<T: Serialize>(
    pool: &DbPool,
    job_name: &str,
    outcome: &Result<T, ApiError>,
    duration: Duration,
) {
    let (detail, error) = match outcome {
        Ok(d) => (serde_json::to_value(d).ok(), None),
        Err(e) => (None, Some(e.to_string())),
    };
    record(pool, job_name, detail, error, duration).await;
}
