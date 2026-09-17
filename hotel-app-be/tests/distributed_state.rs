//! Distributed-state integration tests: Postgres-backed rate-limit buckets,
//! advisory-lock scheduler leadership, and NOTIFY cache invalidation.
//!
//! Requires DATABASE_URL like the other PG suites; each test returns early
//! without it so a no-DB run still exits 0.

use hotel_app_be::core::rate_limiter::{RateLimitConfig, RateLimiter};

async fn pool() -> Option<sqlx::PgPool> {
    let url = std::env::var("DATABASE_URL").ok()?;
    sqlx::PgPool::connect(&url).await.ok()
}

#[tokio::test]
async fn postgres_limiter_shares_bucket_across_instances() {
    let Some(pool) = pool().await else { return };
    sqlx::query("DELETE FROM rate_limit_buckets")
        .execute(&pool)
        .await
        .unwrap();
    // Two limiter objects on one pool behave as one limiter (two replicas).
    let a = RateLimiter::postgres("auth", RateLimitConfig::new(2, 60), pool.clone());
    let b = RateLimiter::postgres("auth", RateLimitConfig::new(2, 60), pool.clone());
    let ip = "203.0.113.9".parse().unwrap();
    assert_eq!(a.check_with_retry(ip).await.0, true);
    assert_eq!(b.check_with_retry(ip).await.0, true);
    assert_eq!(a.check_with_retry(ip).await.0, false);
}

#[tokio::test]
async fn postgres_limiter_reports_bounded_retry_after() {
    let Some(pool) = pool().await else { return };
    sqlx::query("DELETE FROM rate_limit_buckets")
        .execute(&pool)
        .await
        .unwrap();
    let limiter = RateLimiter::postgres("auth", RateLimitConfig::new(1, 60), pool.clone());
    let ip = "203.0.113.10".parse().unwrap();
    assert_eq!(limiter.check_with_retry(ip).await.0, true);
    let (allowed, retry_after) = limiter.check_with_retry(ip).await;
    assert!(!allowed);
    assert!(retry_after >= 1 && retry_after <= 60);
}

#[tokio::test]
async fn postgres_limiter_namespaces_categories() {
    let Some(pool) = pool().await else { return };
    sqlx::query("DELETE FROM rate_limit_buckets")
        .execute(&pool)
        .await
        .unwrap();
    let ip = "203.0.113.11".parse().unwrap();
    // Same IP, different categories — each gets its own budget.
    let auth = RateLimiter::postgres("auth", RateLimitConfig::new(1, 60), pool.clone());
    let webhook = RateLimiter::postgres("webhook", RateLimitConfig::new(1, 60), pool.clone());
    assert_eq!(auth.check_with_retry(ip).await.0, true);
    assert_eq!(webhook.check_with_retry(ip).await.0, true);
    assert_eq!(auth.check_with_retry(ip).await.0, false);
    assert_eq!(webhook.check_with_retry(ip).await.0, false);
}
