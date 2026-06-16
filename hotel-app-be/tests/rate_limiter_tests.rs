//! Unit tests for `core::rate_limiter`
//!
//! Tests the in-memory rate limiter implementation. These are pure unit tests
//! that don't require a database connection.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::time::sleep;

// Re-import the rate limiter module for testing.
// The rate_limiter module is in core::rate_limiter. The actual internal
// implementation is private, so we test through the public interface
// provided by the backend crate.
use hotel_app_be::core::rate_limiter::{RateLimitConfig, RateLimiters, RateLimiter};

#[tokio::test]
async fn rate_limiter_allows_requests_within_limit() {
    let limiter = RateLimiters::new();
    let ip = "127.0.0.1".parse().unwrap();

    // First request should always be allowed
    assert!(limiter.check_rate_limit("auth:login", &ip).await);
}

#[tokio::test]
async fn rate_limiter_enforces_limit() {
    let limiter = RateLimiter::new(RateLimitConfig::new(10, 60));
    let ip = "10.0.0.1".parse().unwrap();

    // Send many requests rapidly
    let mut allowed_count = 0;
    for _ in 0..20 {
        if limiter.check(ip).await {
            allowed_count += 1;
        }
    }

    // Should never allow more than the configured burst limit in this test
    assert!(allowed_count <= 10, "Rate limiter allowed {allowed_count} requests, expected ≤ 10");
}

#[tokio::test]
async fn rate_limiter_different_ips_have_independent_buckets() {
    let limiter = RateLimiters::new();
    let ip1 = "192.168.1.1".parse().unwrap();
    let ip2 = "192.168.1.2".parse().unwrap();

    // Exhaust ip1's budget
    for _ in 0..20 {
        limiter.check_rate_limit("api:generic", &ip1).await;
    }

    // ip2 should still have a full budget
    let allowed = limiter.check_rate_limit("api:generic", &ip2).await;
    assert!(allowed, "Different IP should have independent rate limit bucket");
}

#[tokio::test]
async fn rate_limiter_different_routes_have_independent_buckets() {
    let limiter = RateLimiters::new();
    let ip = "10.0.0.2".parse().unwrap();

    // Exhaust one route's budget
    for _ in 0..20 {
        limiter.check_rate_limit("auth:login", &ip).await;
    }

    // A different route should still be allowed
    let allowed = limiter.check_rate_limit("api:generic", &ip).await;
    assert!(allowed, "Different route should have independent rate limit bucket");
}

#[tokio::test]
async fn rate_limiter_recovers_over_time() {
    let limiter = RateLimiter::new(RateLimitConfig::new(1, 1));
    let ip = "10.0.0.3".parse().unwrap();

    // Exhaust the budget
    assert!(limiter.check(ip).await);
    assert!(!limiter.check(ip).await);

    // Wait for recovery beyond the one-second window
    sleep(Duration::from_secs(2)).await;

    // Should allow a request again
    let recovered = limiter.check(ip).await;
    assert!(recovered, "Rate limiter should recover over time");
}

#[tokio::test]
async fn rate_limiter_handles_high_load_gracefully() {
    let limiter = RateLimiters::new();

    // Generate many unique IPs simulating distributed load
    let mut results = Vec::new();
    for i in 0..100 {
        let ip = format!("10.0.{}.{}", i / 256, i % 256).parse().unwrap();
        let allowed = limiter.check_rate_limit("api:generic", &ip).await;
        results.push(allowed);
    }

    // All should be allowed since they're unique IPs
    let all_allowed = results.iter().all(|&x| x);
    assert!(all_allowed, "All unique IPs should be allowed within their own budgets");
}