//! In-memory rate limiter for auth endpoints
//!
//! Uses a sliding window counter approach keyed by IP address.
//! Suitable for single-instance deployments (hotel PMS).

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

    /// Prune expired timestamps and check if a new request is allowed
    fn check_and_record(&mut self, config: &RateLimitConfig) -> bool {
        let now = Instant::now();
        let cutoff = now - config.window;

        // Remove expired entries
        self.timestamps.retain(|t| *t > cutoff);

        if (self.timestamps.len() as u32) < config.max_requests {
            self.timestamps.push(now);
            true
        } else {
            false
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
    pub async fn check(&self, ip: IpAddr) -> bool {
        let mut entries = self.entries.lock().await;
        let entry = entries.entry(ip).or_insert_with(RateLimitEntry::new);
        entry.check_and_record(&self.config)
    }
}

/// Global rate limiters for different endpoint categories
#[derive(Clone)]
pub struct RateLimiters {
    /// Login attempts: 10 per minute per IP
    pub auth: RateLimiter,
    /// Registration: 5 per 10 minutes per IP
    pub register: RateLimiter,
}

impl RateLimiters {
    pub fn new() -> Self {
        Self {
            auth: RateLimiter::new(RateLimitConfig::new(10, 60)),
            register: RateLimiter::new(RateLimitConfig::new(5, 600)),
        }
    }
}
