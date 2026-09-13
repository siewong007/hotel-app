//! Read queries for the operational-health surfaces. All tolerant of a
//! `job_runs` table that does not exist yet (pre-patch databases): callers
//! gate on [`table_present`].

use sqlx::Row;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::job_runs;
use crate::modules::system::models::{
    EmailQueueHealth, JobHealth, JobRunRow, StaffNotificationItem,
};

/// Same probe the writer uses — false until `job_runs` exists on this
/// database. Re-exported so the service shares one source of truth.
pub async fn table_present(pool: &DbPool) -> bool {
    job_runs::table_present(pool).await
}

/// Latest run per job plus 24-hour counters.
pub async fn latest_per_job(pool: &DbPool) -> Result<Vec<JobHealth>, ApiError> {
    let rows = sqlx::query(
        "SELECT DISTINCT ON (r.job_name)
                r.job_name, r.status, r.detail, r.error, r.duration_ms, r.created_at,
                (SELECT COUNT(*) FROM job_runs j
                  WHERE j.job_name = r.job_name
                    AND j.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours') AS runs_24h,
                (SELECT COUNT(*) FROM job_runs j
                  WHERE j.job_name = r.job_name AND j.status = 'error'
                    AND j.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours') AS failures_24h
         FROM job_runs r
         ORDER BY r.job_name, r.created_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(ApiError::from)?;

    Ok(rows
        .into_iter()
        .map(|row| JobHealth {
            job_name: row.get("job_name"),
            last_status: row.get("status"),
            last_detail: row.get("detail"),
            last_error: row.get("error"),
            last_duration_ms: row.get("duration_ms"),
            last_run_at: row.get("created_at"),
            runs_24h: row.get("runs_24h"),
            failures_24h: row.get("failures_24h"),
        })
        .collect())
}

/// Most recent failed iterations, newest first — the Jobs page's alert feed.
pub async fn recent_failures(pool: &DbPool, limit: i64) -> Result<Vec<JobRunRow>, ApiError> {
    sqlx::query_as::<_, JobRunRow>(
        "SELECT id, job_name, status, detail, error, duration_ms, created_at
         FROM job_runs
         WHERE status = 'error'
         ORDER BY created_at DESC
         LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(ApiError::from)
}

/// `email_deliveries` backlog and throughput. This table predates `job_runs`,
/// so it is queried unconditionally.
pub async fn email_queue_health(pool: &DbPool) -> Result<EmailQueueHealth, ApiError> {
    let row = sqlx::query(
        "SELECT
            COUNT(*) FILTER (WHERE status = 'queued') AS queued,
            COUNT(*) FILTER (WHERE status = 'sending') AS sending,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed,
            COUNT(*) FILTER (WHERE status = 'sent'
                              AND sent_at > CURRENT_TIMESTAMP - INTERVAL '24 hours') AS sent_24h
         FROM email_deliveries",
    )
    .fetch_one(pool)
    .await
    .map_err(ApiError::from)?;

    Ok(EmailQueueHealth {
        queued: row.get("queued"),
        sending: row.get("sending"),
        failed: row.get("failed"),
        sent_24h: row.get("sent_24h"),
    })
}

/// Notifications addressed to any of `permissions` (the caller's effective
/// permission names), newest first, with the caller's read state joined in.
/// `staff_notifications` shares its install with `job_runs`, so callers gate
/// on [`table_present`] the same way.
pub async fn list_notifications(
    pool: &DbPool,
    user_id: i64,
    permissions: &[String],
    limit: i64,
) -> Result<Vec<StaffNotificationItem>, ApiError> {
    sqlx::query_as::<_, StaffNotificationItem>(
        "SELECT n.id, n.kind, n.subject, n.title, n.body, n.created_at, r.read_at
         FROM staff_notifications n
         LEFT JOIN staff_notification_reads r
           ON r.notification_id = n.id AND r.user_id = $1
         WHERE n.audience_permission = ANY($2)
         ORDER BY n.created_at DESC
         LIMIT $3",
    )
    .bind(user_id)
    .bind(permissions)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(ApiError::from)
}

/// Mark one notification read for `user_id` — a no-op when the notification is
/// not addressed to a permission the user holds, so callers cannot mark
/// notifications they cannot see (and no existence check leaks anything).
pub async fn mark_notification_read(
    pool: &DbPool,
    notification_id: i64,
    user_id: i64,
    permissions: &[String],
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO staff_notification_reads (notification_id, user_id)
         SELECT n.id, $2 FROM staff_notifications n
         WHERE n.id = $1 AND n.audience_permission = ANY($3)
         ON CONFLICT DO NOTHING",
    )
    .bind(notification_id)
    .bind(user_id)
    .bind(permissions)
    .execute(pool)
    .await
    .map_err(ApiError::from)?;
    Ok(())
}

/// Mark every notification visible to the user as read.
pub async fn mark_all_notifications_read(
    pool: &DbPool,
    user_id: i64,
    permissions: &[String],
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO staff_notification_reads (notification_id, user_id)
         SELECT n.id, $1 FROM staff_notifications n
         WHERE n.audience_permission = ANY($2)
         ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .bind(permissions)
    .execute(pool)
    .await
    .map_err(ApiError::from)?;
    Ok(())
}
