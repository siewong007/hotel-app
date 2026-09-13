//! Integration tests for the operational-health surfaces: `job_runs`
//! heartbeat persistence, per-job aggregation, staff-notification fan-out and
//! read state, and the `/system/health` service aggregate.
//!
//! Service/repository layer (not HTTP), against a live PostgreSQL database.
//! Skips gracefully when `DATABASE_URL` is unset or when `job_runs` does not
//! exist on the target database (pre-patch installs).
//!
//! Fixture keys are prefixed `sys990` — no other test file touches them.
//! Each test uses its own `job_name` because tests run in parallel in one
//! binary and `job_runs` rows are keyed by name.

mod postgres_tests {
    use std::time::Duration;

    use hotel_app_be::core::job_runs;
    use hotel_app_be::modules::system::repository;
    use hotel_app_be::modules::system::service;
    use sqlx::{PgPool, postgres::PgPoolOptions};

    const JOB_A: &str = "sys990_test_job_a";
    const JOB_B: &str = "sys990_test_job_b";

    async fn setup_pg_pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping system-health test because DATABASE_URL is not set");
                return None;
            }
        };
        let pool = PgPoolOptions::new()
            .max_connections(3)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database");
        if !job_runs::table_present(&pool).await {
            eprintln!("Skipping system-health test: job_runs is not installed on this database");
            return None;
        }
        Some(pool)
    }

    async fn cleanup(pool: &PgPool, job: &str) {
        sqlx::query("DELETE FROM job_runs WHERE job_name = $1")
            .bind(job)
            .execute(pool)
            .await
            .expect("job_runs cleanup");
        sqlx::query("DELETE FROM staff_notifications WHERE subject = $1")
            .bind(job)
            .execute(pool)
            .await
            .expect("staff_notifications cleanup");
    }

    #[tokio::test]
    async fn record_persists_runs_and_health_aggregates() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        cleanup(&pool, JOB_A).await;

        job_runs::record(
            &pool,
            JOB_A,
            Some(serde_json::json!({ "processed": 3 })),
            None,
            Duration::from_millis(5),
        )
        .await;
        job_runs::record(
            &pool,
            JOB_A,
            None,
            Some("boom".to_string()),
            Duration::from_millis(7),
        )
        .await;

        let jobs = repository::latest_per_job(&pool)
            .await
            .expect("latest_per_job");
        let job = jobs
            .iter()
            .find(|j| j.job_name == JOB_A)
            .expect("recorded job must appear");
        assert_eq!(job.last_status, "error");
        assert_eq!(job.last_error.as_deref(), Some("boom"));
        assert_eq!(job.runs_24h, 2);
        assert_eq!(job.failures_24h, 1);

        let failures = repository::recent_failures(&pool, 10)
            .await
            .expect("recent_failures");
        assert!(failures.iter().any(|f| f.job_name == JOB_A));

        let health = service::system_health(&pool).await.expect("system_health");
        assert_eq!(health.database, "ok");
        assert!(health.job_runs_enabled);
        assert!(health.jobs.iter().any(|j| j.job_name == JOB_A));

        cleanup(&pool, JOB_A).await;
    }

    #[tokio::test]
    async fn job_failure_notifies_once_per_hour_and_read_state_tracks() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        cleanup(&pool, JOB_B).await;

        // Two consecutive failures → the dedup window allows only one
        // staff notification for this job.
        for _ in 0..2 {
            job_runs::record(
                &pool,
                JOB_B,
                None,
                Some("boom".to_string()),
                Duration::from_millis(1),
            )
            .await;
        }
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM staff_notifications WHERE kind = 'job_failure' AND subject = $1",
        )
        .bind(JOB_B)
        .fetch_one(&pool)
        .await
        .expect("notification count");
        assert_eq!(count, 1, "hourly dedup must collapse repeat failures");

        // A user holding the audience permission sees it; read state starts null.
        let user_id: i64 = sqlx::query_scalar("SELECT MIN(id) FROM users")
            .fetch_one(&pool)
            .await
            .expect("a user must exist for the read-state join");
        let perms = vec!["settings:manage".to_string()];
        let items = repository::list_notifications(&pool, user_id, &perms, 50)
            .await
            .expect("list_notifications");
        let item = items
            .iter()
            .find(|n| n.subject.as_deref() == Some(JOB_B))
            .expect("job_failure notification must be listed");
        assert!(item.read_at.is_none());

        repository::mark_notification_read(&pool, item.id, user_id, &perms)
            .await
            .expect("mark_notification_read");
        let items = repository::list_notifications(&pool, user_id, &perms, 50)
            .await
            .expect("list_notifications");
        let item = items
            .iter()
            .find(|n| n.subject.as_deref() == Some(JOB_B))
            .expect("still listed after read");
        assert!(item.read_at.is_some());

        // A permission that is not the audience sees nothing.
        let other =
            repository::list_notifications(&pool, user_id, &["housekeeping:read".to_string()], 50)
                .await
                .expect("list_notifications");
        assert!(!other.iter().any(|n| n.subject.as_deref() == Some(JOB_B)));

        cleanup(&pool, JOB_B).await;
    }
}
