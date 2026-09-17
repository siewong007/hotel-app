//! Rate limiter for API endpoints
//!
//! Fixed-window counters stored in PostgreSQL (`rate_limit_buckets`), so all
//! replicas share one budget and one clock. Buckets are namespaced
//! `{category}:{key}`; the check is a single atomic
//! `INSERT … ON CONFLICT … DO UPDATE … RETURNING count` — allowed when the
//! returned count is within `max_requests`, with `Retry-After` computed from
//! the shared window end.
//!
//! Deployment boundary (SEC-05): a process restart no longer resets counters
//! and N replicas no longer multiply limits. Stale bucket rows are pruned by
//! the leader-gated maintenance loop in `main.rs`.
//!
//! Categories (see [`RateLimiters::new`]):
//! - `auth`, `register`: login and account creation (strict)
//! - `sensitive`: password changes, 2FA ops, token refresh (moderate)
//! - `guest_portal_*`, `public_booking_*`: public portal and booking endpoints
//! - `webhook`: inbound payment webhooks

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

use crate::core::db::DbPool;

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

/// Entry tracking requests from a single key (memory backend only)
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
            // Calculate how long until the oldest entry expires. Defensive
            // against a degenerate max_requests = 0 configuration, where this
            // branch is reached with an empty list and the old
            // .first().unwrap() panicked on the very first request.
            let retry_after = match self.timestamps.first() {
                Some(oldest) => {
                    let elapsed = now.duration_since(*oldest).as_secs();
                    config.window.as_secs().saturating_sub(elapsed)
                }
                None => 0,
            };
            (false, retry_after.max(1))
        }
    }
}

/// Where a limiter keeps its counters.
#[derive(Clone)]
enum Backend {
    /// Process-local buckets — the `new` constructors, kept for unit tests
    /// that run without DATABASE_URL. Only tests construct it; the bin
    /// always uses Postgres.
    #[allow(dead_code)]
    Memory(Arc<Mutex<HashMap<String, RateLimitEntry>>>),
    /// Shared fixed-window counters in `rate_limit_buckets`.
    Postgres {
        pool: DbPool,
        category: &'static str,
    },
}

/// One atomic upsert against `rate_limit_buckets`. The window is computed in
/// the database (`date_bin`) so replicas share one clock. Fails open on a
/// database error: a dead database already fails authenticated work, and the
/// limiter must not make the outage worse.
async fn check_postgres(pool: &DbPool, bucket: &str, config: &RateLimitConfig) -> (bool, u64) {
    let window_secs = config.window.as_secs().max(1) as f64;
    let result = sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO rate_limit_buckets (bucket, window_start, count) \
         VALUES ({p1}, date_bin(make_interval(secs => {p2}), {now}, 'epoch'), 1) \
         ON CONFLICT (bucket, window_start) DO UPDATE \
         SET count = rate_limit_buckets.count + 1 \
         RETURNING count, window_start",
        p1 = crate::param!(1),
        p2 = crate::param!(2),
        now = crate::core::sql_compat::current_timestamp(),
    )))
    .bind(bucket)
    .bind(window_secs)
    .fetch_one(pool)
    .await;

    match result {
        Ok(row) => {
            use sqlx::Row;
            let count: i32 = row.get("count");
            let window_start: chrono::DateTime<chrono::Utc> = row.get("window_start");
            if (count as u32) <= config.max_requests {
                (true, 0)
            } else {
                let window_end =
                    window_start + chrono::Duration::from_std(config.window).unwrap_or_default();
                let secs = (window_end - chrono::Utc::now()).num_seconds().max(1) as u64;
                (false, secs)
            }
        }
        Err(error) => {
            log::warn!("rate limit check failed, allowing request: {error}");
            (true, 0)
        }
    }
}

/// Thread-safe rate limiter
#[derive(Clone)]
pub struct RateLimiter {
    backend: Backend,
    config: RateLimitConfig,
}

impl RateLimiter {
    /// In-memory backend — for unit tests without a database.
    #[allow(dead_code)] // constructed only by tests; the bin uses `postgres`
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            backend: Backend::Memory(Arc::new(Mutex::new(HashMap::new()))),
            config,
        }
    }

    /// Postgres backend — the production constructor. `category` namespaces
    /// this limiter's buckets inside `rate_limit_buckets`.
    pub fn postgres(category: &'static str, config: RateLimitConfig, pool: DbPool) -> Self {
        Self {
            backend: Backend::Postgres { pool, category },
            config,
        }
    }

    #[allow(dead_code)] // used by tests/rate_limiter_tests.rs
    /// Check if a request from this IP is allowed. Returns true if allowed.
    pub async fn check(&self, ip: IpAddr) -> bool {
        self.check_inner(ip.to_string()).await.0
    }

    /// Check if a request is allowed, returning (allowed, retry_after_secs).
    pub async fn check_with_retry(&self, ip: IpAddr) -> (bool, u64) {
        // Instrumented here rather than at the ~43 call sites: every per-IP
        // limiter funnels through this method, so one increment covers them all.
        let outcome = self.check_inner(ip.to_string()).await;
        if !outcome.0 {
            crate::core::metrics::incr(&crate::core::metrics::RATE_LIMIT_REJECTIONS);
        }
        outcome
    }

    async fn check_inner(&self, key: String) -> (bool, u64) {
        match &self.backend {
            Backend::Memory(entries) => {
                let mut entries = entries.lock().await;
                let entry = entries.entry(key).or_insert_with(RateLimitEntry::new);
                entry.check_and_record(&self.config)
            }
            Backend::Postgres { pool, category } => {
                check_postgres(pool, &format!("{category}:{key}"), &self.config).await
            }
        }
    }
}

/// Thread-safe rate limiter keyed by caller-provided text identifiers.
#[derive(Clone)]
pub struct KeyedRateLimiter {
    backend: Backend,
    config: RateLimitConfig,
}

impl KeyedRateLimiter {
    /// In-memory backend — for unit tests without a database.
    #[allow(dead_code)] // constructed only by tests; the bin uses `postgres`
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            backend: Backend::Memory(Arc::new(Mutex::new(HashMap::new()))),
            config,
        }
    }

    /// Postgres backend — the production constructor.
    pub fn postgres(category: &'static str, config: RateLimitConfig, pool: DbPool) -> Self {
        Self {
            backend: Backend::Postgres { pool, category },
            config,
        }
    }

    /// Check if a request for this key is allowed, returning (allowed, retry_after_secs).
    pub async fn check_with_retry(&self, key: impl Into<String>) -> (bool, u64) {
        let key = key.into();
        let outcome = match &self.backend {
            Backend::Memory(entries) => {
                let mut entries = entries.lock().await;
                let entry = entries.entry(key).or_insert_with(RateLimitEntry::new);
                entry.check_and_record(&self.config)
            }
            Backend::Postgres { pool, category } => {
                check_postgres(pool, &format!("{category}:{key}"), &self.config).await
            }
        };
        if !outcome.0 {
            crate::core::metrics::incr(&crate::core::metrics::RATE_LIMIT_REJECTIONS);
        }
        outcome
    }
}

/// Global rate limiters for different endpoint categories
#[derive(Clone)]
pub struct RateLimiters {
    /// Login attempts: 5 per minute per IP (strict - brute force protection)
    pub auth: RateLimiter,
    /// Registration: 10 per 10 minutes per IP (strict - spam prevention)
    pub register: RateLimiter,
    /// Sensitive operations: 10 per 5 minutes per IP (password change, 2FA, refresh)
    pub sensitive: RateLimiter,
    /// Guest portal verification: 10 attempts per 5 minutes per IP
    pub guest_portal_verify: RateLimiter,
    /// Shared ceiling for unauthenticated token-gated requests from one
    /// origin IP (booking read, pre-check-in submit, auto check-in). The
    /// per-token keyed budgets below only bound repeats of the SAME key, so
    /// without this ceiling a flood of distinct garbage keys allocates a map
    /// entry per request and is never throttled.
    pub guest_portal_token_ip: RateLimiter,
    /// Anonymous booking search and quote from one origin IP. These are the
    /// only unauthenticated endpoints that price live inventory, so they carry
    /// their own ceiling instead of sharing a token-gated budget: there is no
    /// account or token to key on, and the IP is the only identity available.
    /// Sized for real browsing (a search plus a quote per room type considered)
    /// while still bounding a scraper.
    pub public_booking_read_ip: RateLimiter,
    /// Anonymous booking creation from one origin IP. Deliberately tighter than
    /// the read budget: each success allocates a real room and a guest profile.
    pub public_booking_create_ip: RateLimiter,
    /// Guest portal verification: 5 attempts per 15 minutes per booking number
    pub guest_portal_booking: KeyedRateLimiter,
    /// Guest portal token-gated MUTATIONS (pre-checkin submit, auto-checkin):
    /// 5 attempts per 15 minutes per token (mirrors guest_portal_booking's keying)
    pub guest_portal_token: KeyedRateLimiter,
    /// Guest portal token-gated payment writes. This has its own more generous
    /// budget so checkout retries do not consume the pre-check-in budget.
    pub guest_portal_token_payment: KeyedRateLimiter,
    /// Guest portal token-gated READS (get booking, dashboard tabs, support
    /// conversations, socket handshakes): 120 per 15 minutes per token. This
    /// budget is now shared across ~11 read endpoints plus the guest support
    /// websocket handshake (one hit at connect, then free). Reads are not a
    /// brute-force surface (the token is already known), so throttle only
    /// scripted hammering, not normal multi-tab/multi-page browsing.
    pub guest_portal_token_read: KeyedRateLimiter,
    /// Authenticated guest support mutations: enough headroom for a real chat
    /// while preventing a compromised portal session from flooding the queue.
    pub guest_portal_support_mutation: KeyedRateLimiter,
    /// Shared ceiling for guest support mutations from one origin IP.
    pub guest_portal_support_mutation_ip: RateLimiter,
    /// Authenticated guest payment-write attempts (session bank-transfer claim
    /// and PayPal create-order/capture), keyed by guest id. Mirrors the
    /// per-token payment limit (`guest_portal_token_payment`) used by the
    /// unauthenticated token payment routes: 100 attempts per 10 minutes.
    pub guest_portal_payment: KeyedRateLimiter,
    /// Authenticated direct-booking submissions, keyed by guest.
    pub guest_portal_booking_create: KeyedRateLimiter,
    /// Shared ceiling for direct-booking submissions from one origin IP.
    pub guest_portal_booking_create_ip: RateLimiter,
    /// Guest-portal eKYC writes (document upload + submission), keyed by guest.
    /// One shared budget covers both endpoints: a full submission is at most
    /// four documents plus one submit, so 20 per 15 minutes allows roughly four
    /// complete attempts — enough to re-take a blurry photo, not enough to use
    /// the endpoint as a file drop.
    pub guest_portal_ekyc: KeyedRateLimiter,
    /// Shared ceiling for eKYC writes from one origin IP. `/auth/register` is
    /// public and mints `user_type = 'guest'` accounts, so the per-guest budget
    /// alone does not bound how much an attacker can write to disk — they can
    /// simply register more guests. This is the limit that actually does.
    pub guest_portal_ekyc_ip: RateLimiter,
    /// Inbound webhooks (`/api/webhooks/*`): unauthenticated by design and
    /// each request can cost an upstream verification call, so keep the
    /// per-IP ceiling well below the general API limit while still clearing
    /// any realistic provider redelivery burst.
    pub webhook: RateLimiter,
}

impl RateLimiters {
    pub fn new(pool: DbPool) -> Self {
        Self {
            auth: RateLimiter::postgres("auth", RateLimitConfig::new(5, 60), pool.clone()),
            register: RateLimiter::postgres(
                "register",
                RateLimitConfig::new(10, 600),
                pool.clone(),
            ),
            sensitive: RateLimiter::postgres(
                "sensitive",
                RateLimitConfig::new(10, 300),
                pool.clone(),
            ),
            guest_portal_verify: RateLimiter::postgres(
                "guest_portal_verify",
                RateLimitConfig::new(10, 300),
                pool.clone(),
            ),
            guest_portal_token_ip: RateLimiter::postgres(
                "guest_portal_token_ip",
                RateLimitConfig::new(240, 900),
                pool.clone(),
            ),
            public_booking_read_ip: RateLimiter::postgres(
                "public_booking_read_ip",
                RateLimitConfig::new(120, 900),
                pool.clone(),
            ),
            public_booking_create_ip: RateLimiter::postgres(
                "public_booking_create_ip",
                RateLimitConfig::new(10, 900),
                pool.clone(),
            ),
            guest_portal_booking: KeyedRateLimiter::postgres(
                "guest_portal_booking",
                RateLimitConfig::new(5, 900),
                pool.clone(),
            ),
            guest_portal_token: KeyedRateLimiter::postgres(
                "guest_portal_token",
                RateLimitConfig::new(5, 900),
                pool.clone(),
            ),
            guest_portal_token_payment: KeyedRateLimiter::postgres(
                "guest_portal_token_payment",
                RateLimitConfig::new(100, 600),
                pool.clone(),
            ),
            guest_portal_payment: KeyedRateLimiter::postgres(
                "guest_portal_payment",
                RateLimitConfig::new(100, 600),
                pool.clone(),
            ),
            guest_portal_token_read: KeyedRateLimiter::postgres(
                "guest_portal_token_read",
                RateLimitConfig::new(120, 900),
                pool.clone(),
            ),
            guest_portal_support_mutation: KeyedRateLimiter::postgres(
                "guest_portal_support_mutation",
                RateLimitConfig::new(30, 900),
                pool.clone(),
            ),
            guest_portal_support_mutation_ip: RateLimiter::postgres(
                "guest_portal_support_mutation_ip",
                RateLimitConfig::new(120, 900),
                pool.clone(),
            ),
            guest_portal_booking_create: KeyedRateLimiter::postgres(
                "guest_portal_booking_create",
                RateLimitConfig::new(10, 900),
                pool.clone(),
            ),
            guest_portal_booking_create_ip: RateLimiter::postgres(
                "guest_portal_booking_create_ip",
                RateLimitConfig::new(30, 900),
                pool.clone(),
            ),
            guest_portal_ekyc: KeyedRateLimiter::postgres(
                "guest_portal_ekyc",
                RateLimitConfig::new(20, 900),
                pool.clone(),
            ),
            guest_portal_ekyc_ip: RateLimiter::postgres(
                "guest_portal_ekyc_ip",
                RateLimitConfig::new(60, 900),
                pool.clone(),
            ),
            webhook: RateLimiter::postgres("webhook", RateLimitConfig::new(60, 60), pool),
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
    async fn zero_limit_config_denies_without_panicking_on_first_request() {
        // Degenerate configuration guard: max_requests = 0 used to reach
        // .first().unwrap() on an empty list and panic the request task.
        let limiter = RateLimiter::new(RateLimitConfig::new(0, 60));
        let (allowed, retry_after) = limiter.check_with_retry(ip(1)).await;
        assert!(!allowed);
        assert!(retry_after >= 1);
    }

    #[tokio::test]
    async fn rate_limiter_reopens_slot_after_window_expires() {
        let limiter = RateLimiter::new(RateLimitConfig::new(1, 1));

        assert!(limiter.check(ip(1)).await);
        assert!(!limiter.check(ip(1)).await);

        tokio::time::sleep(Duration::from_millis(1_100)).await;

        assert!(limiter.check(ip(1)).await);
    }

    #[tokio::test]
    async fn keyed_rate_limiter_tracks_keys_independently() {
        let limiter = KeyedRateLimiter::new(RateLimitConfig::new(1, 60));

        assert_eq!(limiter.check_with_retry("booking-a").await, (true, 0));
        assert!(!limiter.check_with_retry("booking-a").await.0);
        assert_eq!(limiter.check_with_retry("booking-b").await, (true, 0));
    }

    #[tokio::test]
    async fn registration_limiter_allows_ten_attempts_per_window() {
        // Same rule the `register` field carries in production.
        let limiter = RateLimiter::new(RateLimitConfig::new(10, 600));

        for _ in 0..10 {
            assert_eq!(limiter.check_with_retry(ip(1)).await, (true, 0));
        }

        let (allowed, retry_after) = limiter.check_with_retry(ip(1)).await;
        assert!(!allowed);
        assert!(retry_after > 0);
    }
}
