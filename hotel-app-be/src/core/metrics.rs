//! Lightweight in-process counters for operational alerting.
//!
//! These exist so the backend can answer "is something abnormal happening right
//! now?" without adding a metrics stack (no Prometheus, no new dependency) to a
//! single-instance PMS running in a 192MB container.
//!
//! Every counter is a monotonically increasing `AtomicU64` touched on request
//! hot paths, so all operations use `Ordering::Relaxed`: the values are read for
//! threshold comparison only, never to synchronise access to other memory.
//!
//! **Counters reset to zero when the process restarts.** Alert rules must
//! therefore compare two [`snapshot`] values taken at different times and treat
//! a decrease as "process restarted" rather than as a negative rate — see
//! [`MetricsSnapshot::delta_since`].

// Counter plumbing is in place ahead of the readers that will expose it.
#![allow(dead_code)]

use std::sync::atomic::{AtomicU64, Ordering};

/// Requests that took at least this long are counted as slow.
pub const SLOW_REQUEST_THRESHOLD_MS: u64 = 1_000;

/// Every HTTP request that reached the application.
pub static REQUESTS_TOTAL: AtomicU64 = AtomicU64::new(0);
/// Responses with a 4xx status.
pub static RESPONSES_4XX: AtomicU64 = AtomicU64::new(0);
/// Responses with a 5xx status.
pub static RESPONSES_5XX: AtomicU64 = AtomicU64::new(0);
/// Responses that took at least [`SLOW_REQUEST_THRESHOLD_MS`].
pub static REQUESTS_SLOW: AtomicU64 = AtomicU64::new(0);
/// Requests rejected by a rate limiter before the handler ran.
pub static RATE_LIMIT_REJECTIONS: AtomicU64 = AtomicU64::new(0);
/// Authentication failures raised by the auth middleware (missing/invalid token).
pub static AUTH_DENIED: AtomicU64 = AtomicU64::new(0);
/// Authorization failures raised by the permission middleware (valid user, missing permission).
pub static PERMISSION_DENIED: AtomicU64 = AtomicU64::new(0);
/// Audit-log writes that failed. Non-zero means the audit trail has holes.
pub static AUDIT_WRITE_FAILURES: AtomicU64 = AtomicU64::new(0);

/// Increment a counter by one.
#[inline]
pub fn incr(counter: &AtomicU64) {
    counter.fetch_add(1, Ordering::Relaxed);
}

/// Record the outcome of one HTTP request.
///
/// Takes plain integers rather than `axum` types so the counters stay unit-testable
/// without constructing a request/response pair.
pub fn record_response(status: u16, elapsed_ms: u64) {
    incr(&REQUESTS_TOTAL);
    if (400..500).contains(&status) {
        incr(&RESPONSES_4XX);
    } else if status >= 500 {
        incr(&RESPONSES_5XX);
    }
    if elapsed_ms >= SLOW_REQUEST_THRESHOLD_MS {
        incr(&REQUESTS_SLOW);
    }
}

/// A point-in-time reading of every counter.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct MetricsSnapshot {
    pub requests_total: u64,
    pub responses_4xx: u64,
    pub responses_5xx: u64,
    pub requests_slow: u64,
    pub rate_limit_rejections: u64,
    pub auth_denied: u64,
    pub permission_denied: u64,
    pub audit_write_failures: u64,
}

impl MetricsSnapshot {
    /// Difference between this snapshot and an earlier one.
    ///
    /// Returns `None` if **any** counter went backwards, which can only happen
    /// when the process restarted between the two readings. Callers should treat
    /// `None` as "no comparable window" and skip the interval rather than
    /// reporting a spurious spike or a negative rate.
    pub fn delta_since(&self, earlier: &MetricsSnapshot) -> Option<MetricsSnapshot> {
        let fields = [
            (self.requests_total, earlier.requests_total),
            (self.responses_4xx, earlier.responses_4xx),
            (self.responses_5xx, earlier.responses_5xx),
            (self.requests_slow, earlier.requests_slow),
            (self.rate_limit_rejections, earlier.rate_limit_rejections),
            (self.auth_denied, earlier.auth_denied),
            (self.permission_denied, earlier.permission_denied),
            (self.audit_write_failures, earlier.audit_write_failures),
        ];
        if fields.iter().any(|(now, before)| now < before) {
            return None;
        }

        Some(MetricsSnapshot {
            requests_total: self.requests_total - earlier.requests_total,
            responses_4xx: self.responses_4xx - earlier.responses_4xx,
            responses_5xx: self.responses_5xx - earlier.responses_5xx,
            requests_slow: self.requests_slow - earlier.requests_slow,
            rate_limit_rejections: self.rate_limit_rejections - earlier.rate_limit_rejections,
            auth_denied: self.auth_denied - earlier.auth_denied,
            permission_denied: self.permission_denied - earlier.permission_denied,
            audit_write_failures: self.audit_write_failures - earlier.audit_write_failures,
        })
    }
}

/// Read every counter. Not atomic as a group — counters are sampled one at a
/// time, so a snapshot taken under load may straddle a request. That is
/// acceptable for threshold alerting and avoids a lock on the request path.
pub fn snapshot() -> MetricsSnapshot {
    MetricsSnapshot {
        requests_total: REQUESTS_TOTAL.load(Ordering::Relaxed),
        responses_4xx: RESPONSES_4XX.load(Ordering::Relaxed),
        responses_5xx: RESPONSES_5XX.load(Ordering::Relaxed),
        requests_slow: REQUESTS_SLOW.load(Ordering::Relaxed),
        rate_limit_rejections: RATE_LIMIT_REJECTIONS.load(Ordering::Relaxed),
        auth_denied: AUTH_DENIED.load(Ordering::Relaxed),
        permission_denied: PERMISSION_DENIED.load(Ordering::Relaxed),
        audit_write_failures: AUDIT_WRITE_FAILURES.load(Ordering::Relaxed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_response_classifies_status_and_latency() {
        let before = snapshot();

        record_response(200, 5);
        record_response(404, 5);
        record_response(500, 5);
        record_response(200, SLOW_REQUEST_THRESHOLD_MS);

        let after = snapshot();
        let delta = after
            .delta_since(&before)
            .expect("counters must not go backwards within one process");

        assert_eq!(delta.requests_total, 4);
        assert_eq!(delta.responses_4xx, 1);
        assert_eq!(delta.responses_5xx, 1);
        assert_eq!(delta.requests_slow, 1);
    }

    #[test]
    fn delta_since_rejects_a_restarted_process() {
        let later = MetricsSnapshot {
            requests_total: 5,
            ..Default::default()
        };
        let earlier = MetricsSnapshot {
            requests_total: 900,
            ..Default::default()
        };

        assert!(later.delta_since(&earlier).is_none());
    }

    #[test]
    fn delta_since_subtracts_every_field() {
        let earlier = MetricsSnapshot {
            requests_total: 10,
            responses_4xx: 2,
            responses_5xx: 1,
            requests_slow: 3,
            rate_limit_rejections: 4,
            auth_denied: 5,
            permission_denied: 6,
            audit_write_failures: 7,
        };
        let later = MetricsSnapshot {
            requests_total: 11,
            responses_4xx: 4,
            responses_5xx: 4,
            requests_slow: 6,
            rate_limit_rejections: 8,
            auth_denied: 10,
            permission_denied: 12,
            audit_write_failures: 14,
        };

        let delta = later.delta_since(&earlier).expect("monotonic");
        assert_eq!(
            delta,
            MetricsSnapshot {
                requests_total: 1,
                responses_4xx: 2,
                responses_5xx: 3,
                requests_slow: 3,
                rate_limit_rejections: 4,
                auth_denied: 5,
                permission_denied: 6,
                audit_write_failures: 7,
            }
        );
    }
}
