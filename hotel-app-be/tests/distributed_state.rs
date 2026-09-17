//! Distributed-state integration tests: Postgres-backed rate-limit buckets,
//! advisory-lock scheduler leadership, and NOTIFY cache invalidation.
//!
//! Requires DATABASE_URL like the other PG suites; each test returns early
//! without it so a no-DB run still exits 0.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use hotel_app_be::core::leader;
use hotel_app_be::core::rate_limiter::{RateLimitConfig, RateLimiter};

async fn pool() -> Option<sqlx::PgPool> {
    let url = std::env::var("DATABASE_URL").ok()?;
    sqlx::PgPool::connect(&url).await.ok()
}

/// Scoped cleanup: each test owns a `test_*` category prefix so concurrent
/// tests in this binary never touch each other's buckets.
async fn clear_bucket_prefix(pool: &sqlx::PgPool, prefix: &str) {
    sqlx::query("DELETE FROM rate_limit_buckets WHERE bucket LIKE $1")
        .bind(format!("{prefix}:%"))
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn postgres_limiter_shares_bucket_across_instances() {
    let Some(pool) = pool().await else { return };
    clear_bucket_prefix(&pool, "test_shared").await;
    // Two limiter objects on one pool behave as one limiter (two replicas).
    let a = RateLimiter::postgres("test_shared", RateLimitConfig::new(2, 60), pool.clone());
    let b = RateLimiter::postgres("test_shared", RateLimitConfig::new(2, 60), pool.clone());
    let ip = "203.0.113.9".parse().unwrap();
    assert_eq!(a.check_with_retry(ip).await.0, true);
    assert_eq!(b.check_with_retry(ip).await.0, true);
    assert_eq!(a.check_with_retry(ip).await.0, false);
}

#[tokio::test]
async fn postgres_limiter_reports_bounded_retry_after() {
    let Some(pool) = pool().await else { return };
    clear_bucket_prefix(&pool, "test_retry").await;
    let limiter = RateLimiter::postgres("test_retry", RateLimitConfig::new(1, 60), pool.clone());
    let ip = "203.0.113.10".parse().unwrap();
    assert_eq!(limiter.check_with_retry(ip).await.0, true);
    let (allowed, retry_after) = limiter.check_with_retry(ip).await;
    assert!(!allowed);
    assert!(retry_after >= 1 && retry_after <= 60);
}

#[tokio::test]
async fn postgres_limiter_namespaces_categories() {
    let Some(pool) = pool().await else { return };
    clear_bucket_prefix(&pool, "test_ns_auth").await;
    clear_bucket_prefix(&pool, "test_ns_webhook").await;
    let ip = "203.0.113.11".parse().unwrap();
    // Same IP, different categories — each gets its own budget.
    let auth = RateLimiter::postgres("test_ns_auth", RateLimitConfig::new(1, 60), pool.clone());
    let webhook =
        RateLimiter::postgres("test_ns_webhook", RateLimitConfig::new(1, 60), pool.clone());
    assert_eq!(auth.check_with_retry(ip).await.0, true);
    assert_eq!(webhook.check_with_retry(ip).await.0, true);
    assert_eq!(auth.check_with_retry(ip).await.0, false);
    assert_eq!(webhook.check_with_retry(ip).await.0, false);
}

#[tokio::test]
async fn exclusive_scheduler_runs_on_one_instance_only() {
    let Some(pool) = pool().await else { return };
    let runs = Arc::new(AtomicUsize::new(0));
    for _ in 0..2 {
        let runs = runs.clone();
        leader::spawn_exclusive("test", 999_999, pool.clone(), move |_pool| {
            let runs = runs.clone();
            async move {
                runs.fetch_add(1, Ordering::SeqCst);
                // Hold the "scheduler" open like a real loop so the loser
                // doesn't win the lock after the winner's run ends.
                std::future::pending::<()>().await;
            }
        });
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn cache_invalidate_notifies_other_replicas() {
    let Some(pool) = pool().await else { return };
    let mut listener = sqlx::postgres::PgListener::connect_with(&pool)
        .await
        .unwrap();
    listener.listen("hotel_cache").await.unwrap();

    hotel_app_be::core::rbac_cache::invalidate_all(&pool).await;
    let note = tokio::time::timeout(Duration::from_secs(5), listener.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(note.payload(), "rbac");

    hotel_app_be::core::settings_cache::invalidate_key(&pool, "timezone").await;
    let note = tokio::time::timeout(Duration::from_secs(5), listener.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(note.payload(), "settings:timezone");
}

#[tokio::test]
async fn data_change_publish_fans_out_with_origin() {
    let Some(pool) = pool().await else { return };
    let mut listener = sqlx::postgres::PgListener::connect_with(&pool)
        .await
        .unwrap();
    listener.listen("hotel_data_changed").await.unwrap();

    let hub = hotel_app_be::modules::realtime::hub::DataChangeHub::new(pool.clone());
    hub.publish_data_changed("bookings");

    let note = tokio::time::timeout(Duration::from_secs(5), listener.recv())
        .await
        .unwrap()
        .unwrap();
    let payload = note.payload();
    let (origin, domain) = payload.split_once(':').unwrap();
    assert_eq!(
        origin,
        hotel_app_be::core::cache_bus::instance_id().to_string()
    );
    assert_eq!(domain, "bookings");
}
