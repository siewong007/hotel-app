//! Unit tests for `core::rate_limiter`
//!
//! Tests the in-memory rate limiter implementation using the public API
//! with small explicit configurations for deterministic, fast tests.
//! This mirrors the already-correct inline `#[cfg(test)] mod tests` from
//! the rate_limiter module itself.

use std::net::IpAddr;
use std::time::Duration;
use tokio::time::sleep;

use hotel_app_be::core::rate_limiter::{KeyedRateLimiter, RateLimitConfig, RateLimiter};

fn ip(last_octet: u8) -> IpAddr {
    IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, last_octet))
}

#[tokio::test]
async fn rate_limiter_allows_requests_up_to_configured_limit() {
    let limiter = RateLimiter::new(RateLimitConfig::new(2, 60));

    assert_eq!(limiter.check_with_retry(ip(1)).await, (true, 0));
    assert_eq!(limiter.check_with_retry(ip(1)).await, (true, 0));

    let (allowed, retry_after) = limiter.check_with_retry(ip(1)).await;
    assert!(!allowed);
    assert!(retry_after > 0);
}

#[tokio::test]
async fn rate_limiter_enforces_limit() {
    let limiter = RateLimiter::new(RateLimitConfig::new(10, 60));
    let ip = ip(2);

    let mut allowed_count = 0;
    for _ in 0..20 {
        if limiter.check(ip).await {
            allowed_count += 1;
        }
    }

    assert!(
        allowed_count <= 10,
        "Rate limiter allowed {allowed_count} requests, expected ≤ 10"
    );
}

#[tokio::test]
async fn rate_limiter_different_ips_have_independent_buckets() {
    let limiter = RateLimiter::new(RateLimitConfig::new(1, 60));

    // Exhaust ip1's budget
    assert!(limiter.check(ip(1)).await);
    assert!(!limiter.check(ip(1)).await);

    // ip2 should still have a full budget
    assert!(
        limiter.check(ip(2)).await,
        "Different IP should have independent rate limit bucket"
    );
}

#[tokio::test]
async fn rate_limiter_different_routes_have_independent_buckets() {
    let ip = ip(3);
    let auth_limiter = RateLimiter::new(RateLimitConfig::new(1, 60));
    let api_limiter = RateLimiter::new(RateLimitConfig::new(1, 60));

    // Exhaust auth route's budget
    assert!(auth_limiter.check(ip).await);
    assert!(!auth_limiter.check(ip).await);

    // A different limiter (representing a different route) should still allow
    assert!(
        api_limiter.check(ip).await,
        "Different route should have independent rate limit bucket"
    );
}

#[tokio::test]
async fn rate_limiter_recovers_over_time() {
    let limiter = RateLimiter::new(RateLimitConfig::new(1, 1));
    let ip = ip(4);

    // Exhaust the budget
    assert!(limiter.check(ip).await);
    assert!(!limiter.check(ip).await);

    // Wait for the 1-second window to expire (with margin)
    sleep(Duration::from_millis(1_100)).await;

    // Should allow a request again
    assert!(
        limiter.check(ip).await,
        "Rate limiter should recover over time"
    );
}

#[tokio::test]
async fn rate_limiter_handles_high_load_gracefully() {
    let limiter = RateLimiter::new(RateLimitConfig::new(10, 60));

    // Generate many unique IPs simulating distributed load
    let mut results = Vec::new();
    for i in 0..100 {
        results.push(limiter.check(ip(i as u8)).await);
    }

    // All should be allowed since they're unique IPs
    assert!(
        results.iter().all(|&x| x),
        "All unique IPs should be allowed within their own budgets"
    );
}

#[tokio::test]
async fn keyed_rate_limiter_tracks_keys_independently() {
    let limiter = KeyedRateLimiter::new(RateLimitConfig::new(1, 60));

    assert_eq!(limiter.check_with_retry("booking-a").await, (true, 0));
    assert!(!limiter.check_with_retry("booking-a").await.0);
    assert_eq!(limiter.check_with_retry("booking-b").await, (true, 0));
}