//! In-memory rate limiter for API endpoints
//!
//! Uses a sliding window counter approach keyed by IP address.
//! Suitable for single-instance deployments (hotel PMS).
//!
//! Categories:
//! - `auth`: Login attempts (strict)
//! - `register`: Account creation (strict)
//! - `sensitive`: Password changes, 2FA ops, token refresh (moderate)
//! - `api`: General authenticated API requests (lenient)

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// Configuration for a rate limit rule
#[derive(Clone)]
pub struct RateLimitConfig {
    /// Maximum number of requests in the window
    pub max_requests: u32,
    /// Window duration
    pub window: Duration,
}

impl RateLimitConfig {
    pub fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            max_requests,
            window: Duration::from_secs(window_secs),
        }
    }
}

/// Entry tracking requests from a single IP
struct RateLimitEntry {
    /// Timestamps of recent requests within the window
    timestamps: Vec<Instant>,
}

impl RateLimitEntry {
    fn new() -> Self {
        Self {
            timestamps: Vec::new(),
        }
    }

    /// Prune expired timestamps and check if a new request is allowed.
    /// Returns (allowed, seconds_until_next_slot) so callers can set Retry-After.
    fn check_and_record(&mut self, config: &RateLimitConfig) -> (bool, u64) {
        let now = Instant::now();
        let cutoff = now - config.window;

        // Remove expired entries
        self.timestamps.retain(|t| *t > cutoff);

        if (self.timestamps.len() as u32) < config.max_requests {
            self.timestamps.push(now);
            (true, 0)
        } else {
            // Calculate how long until the oldest entry expires
            let oldest = self.timestamps.first().unwrap();
            let retry_after = config
                .window
                .as_secs()
                .saturating_sub(now.duration_since(*oldest).as_secs());
            (false, retry_after.max(1))
        }
    }
}

/// Thread-safe rate limiter
#[derive(Clone)]
pub struct RateLimiter {
    entries: Arc<Mutex<HashMap<IpAddr, RateLimitEntry>>>,
    config: RateLimitConfig,
}

impl RateLimiter {
    pub fn new(config: RateLimitConfig) -> Self {
        let limiter = Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
            config,
        };

        // Spawn cleanup task every 5 minutes
        let entries = limiter.entries.clone();
        let window = limiter.config.window;
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(300)).await;
                let mut map = entries.lock().await;
                let now = Instant::now();
                map.retain(|_, entry| {
                    entry.timestamps.retain(|t| now.duration_since(*t) < window);
                    !entry.timestamps.is_empty()
                });
            }
        });

        limiter
    }

    /// Check if a request from this IP is allowed. Returns true if allowed.
    #[allow(dead_code)]
    pub async fn check(&self, ip: IpAddr) -> bool {
        let mut entries = self.entries.lock().await;
        let entry = entries.entry(ip).or_insert_with(RateLimitEntry::new);
        entry.check_and_record(&self.config).0
    }

    /// Check if a request is allowed, returning (allowed, retry_after_secs).
    pub async fn check_with_retry(&self, ip: IpAddr) -> (bool, u64) {
        let mut entries = self.entries.lock().await;
        let entry = entries.entry(ip).or_insert_with(RateLimitEntry::new);
        entry.check_and_record(&self.config)
    }

    /// Get the window duration (for Retry-After headers)
    #[allow(dead_code)]
    pub fn window_secs(&self) -> u64 {
        self.config.window.as_secs()
    }
}

/// Global rate limiters for different endpoint categories
#[derive(Clone)]
pub struct RateLimiters {
    /// Login attempts: 5 per minute per IP (strict - brute force protection)
    pub auth: RateLimiter,
    /// Registration: 3 per 10 minutes per IP (strict - spam prevention)
    pub register: RateLimiter,
    /// Sensitive operations: 10 per 5 minutes per IP (password change, 2FA, refresh)
    pub sensitive: RateLimiter,
    /// General API: 200 per minute per IP (lenient - normal usage)
    #[allow(dead_code)]
    pub api: RateLimiter,
}

impl Default for RateLimiters {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimiters {
    pub fn new() -> Self {
        Self {
            auth: RateLimiter::new(RateLimitConfig::new(5, 60)),
            register: RateLimiter::new(RateLimitConfig::new(3, 600)),
            sensitive: RateLimiter::new(RateLimitConfig::new(10, 300)),
            api: RateLimiter::new(RateLimitConfig::new(200, 60)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    fn ip(last_octet: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(127, 0, 0, last_octet))
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
    async fn rate_limiter_tracks_ips_independently() {
        let limiter = RateLimiter::new(RateLimitConfig::new(1, 60));

        assert!(limiter.check(ip(1)).await);
        assert!(!limiter.check(ip(1)).await);
        assert!(limiter.check(ip(2)).await);
    }

    #[tokio::test]
    async fn rate_limiter_reopens_slot_after_window_expires() {
        let limiter = RateLimiter::new(RateLimitConfig::new(1, 1));

        assert!(limiter.check(ip(1)).await);
        assert!(!limiter.check(ip(1)).await);

        tokio::time::sleep(Duration::from_millis(1_100)).await;

        assert!(limiter.check(ip(1)).await);
    }
}
