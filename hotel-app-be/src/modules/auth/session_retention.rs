//! Signed-in session retention.
//!
//! Staff sessions live in `refresh_tokens`, one row per signed-in device.
//! Signing out or revoking a device only marks the row revoked, and an
//! expired row is never touched again, so the table grew without bound and
//! the Profile page's device list filled with stale sessions. This module
//! owns the three policies that keep it bounded:
//!
//! * **Purge** (hourly, from [`run`]): hard-delete sessions that expired or
//!   were revoked more than a grace period ago. Such rows are already
//!   unusable — every request re-checks the session through
//!   `AuthService::is_session_active` — so deleting them changes nothing for
//!   any signed-in user. The grace keeps a recently signed-out device visible
//!   to support for a short while. The same sweep clears expired
//!   `guest_portal_sessions` and the legacy `user_sessions` table.
//! * **Idle timeout** (optional, also hourly): revoke a live session that has
//!   not refreshed for N days. Off by default; refresh tokens already slide a
//!   30-day expiry on every refresh, so only values below 30 change anything.
//! * **Per-user cap** (at every sign-in, from
//!   `auth::service::issue_authenticated_response`): keep at most N live
//!   sessions per account and revoke the least recently used beyond that.
//!   Scripts and test runs that sign in without signing out are what produce
//!   hundreds of live sessions on one account.
//!
//! `audit_logs` is deliberately out of scope: it is append-only by design
//! (see `prevent_audit_log_mutation`) and login history is kept.
//!
//! Every knob is a `system_settings` row, overridable by an environment
//! variable, and `0` switches that policy off.

use std::time::Duration;

use serde::Serialize;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::models::AuditEvent;
use crate::services::audit::AuditLog;

/// How often the purge runs. The grace periods are whole days, so hourly is
/// already far finer than any policy needs.
pub const PURGE_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// Rows removed per statement. Small enough that a first sweep over months of
/// backlog never holds a long lock on the session table that every request
/// reads.
const PURGE_BATCH_SIZE: i64 = 1_000;

/// Statements per table per tick. Bounds one tick at 100k rows per table; a
/// larger backlog simply drains over the following hours.
const MAX_BATCHES_PER_TICK: usize = 100;

/// One retention knob: its `system_settings` key, the environment variable
/// that overrides it, and the value it ships with.
#[derive(Debug, Clone, Copy)]
pub struct RetentionSetting {
    pub key: &'static str,
    pub env: &'static str,
    pub default: i32,
}

pub const EXPIRED_DAYS: RetentionSetting = RetentionSetting {
    key: "session_purge_expired_days",
    env: "SESSION_PURGE_EXPIRED_DAYS",
    default: 7,
};
pub const REVOKED_DAYS: RetentionSetting = RetentionSetting {
    key: "session_purge_revoked_days",
    env: "SESSION_PURGE_REVOKED_DAYS",
    default: 7,
};
pub const MAX_ACTIVE_PER_USER: RetentionSetting = RetentionSetting {
    key: "session_max_active_per_user",
    env: "SESSION_MAX_ACTIVE_PER_USER",
    default: 10,
};
pub const IDLE_DAYS: RetentionSetting = RetentionSetting {
    key: "session_idle_days",
    env: "SESSION_IDLE_DAYS",
    default: 0,
};

/// Resolve one knob. A set environment variable wins over the database row;
/// a missing (or blank) row falls back to the shipped default.
///
/// Anything that is present but not a non-negative whole number resolves to
/// `0`, which switches the policy off. That direction matters: a typo must
/// never read as "purge everything after zero days".
pub fn resolve_setting(env_value: Option<&str>, stored: Option<&str>, default: i32) -> i32 {
    let parse = |raw: &str| match raw.trim().parse::<i32>() {
        Ok(value) if value >= 0 => value,
        _ => 0,
    };
    if let Some(raw) = env_value.filter(|raw| !raw.trim().is_empty()) {
        return parse(raw);
    }
    match stored.filter(|raw| !raw.trim().is_empty()) {
        Some(raw) => parse(raw),
        None => default,
    }
}

async fn load_setting(pool: &DbPool, setting: RetentionSetting) -> i32 {
    let env_value = std::env::var(setting.env).ok();
    let stored = settings_cache::get_optional_string(pool, setting.key).await;
    let resolved = resolve_setting(env_value.as_deref(), stored.as_deref(), setting.default);
    if resolved == 0 && setting.default != 0 {
        let raw = env_value.or(stored).unwrap_or_default();
        if raw.trim() != "0" {
            log::warn!(
                "{} / {} is {:?}, not a whole number of days; treating it as 0 (off)",
                setting.env,
                setting.key,
                raw
            );
        }
    }
    resolved
}

/// The effective policy for one sweep. Each field is in days (or sessions,
/// for the cap); `0` means that part is off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct RetentionPolicy {
    pub expired_days: i32,
    pub revoked_days: i32,
    pub max_active_per_user: i32,
    pub idle_days: i32,
}

impl RetentionPolicy {
    pub async fn load(pool: &DbPool) -> Self {
        Self {
            expired_days: load_setting(pool, EXPIRED_DAYS).await,
            revoked_days: load_setting(pool, REVOKED_DAYS).await,
            max_active_per_user: load_setting(pool, MAX_ACTIVE_PER_USER).await,
            idle_days: load_setting(pool, IDLE_DAYS).await,
        }
    }
}

/// What one sweep did; recorded as the `job_runs` detail.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct PurgeReport {
    pub idle_revoked: u64,
    pub revoked_deleted: u64,
    pub expired_deleted: u64,
    pub guest_portal_deleted: u64,
    pub user_sessions_deleted: u64,
}

/// Run `statement` (which must delete at most `$1` rows) until it removes
/// fewer than a full batch or the per-tick bound is reached.
async fn delete_in_batches(
    pool: &DbPool,
    statement: &'static str,
    days: i32,
) -> Result<u64, ApiError> {
    let mut total = 0u64;
    for _ in 0..MAX_BATCHES_PER_TICK {
        let deleted = sqlx::query(statement)
            .bind(PURGE_BATCH_SIZE)
            .bind(days)
            .execute(pool)
            .await
            .map_err(|error| ApiError::Database(format!("session purge failed: {error}")))?
            .rows_affected();
        total += deleted;
        if deleted < PURGE_BATCH_SIZE as u64 {
            break;
        }
    }
    Ok(total)
}

/// A revoked row with no `revoked_at` (nothing writes one today, but the
/// column is nullable) is aged by `created_at` and kept at least 30 days.
const DELETE_REVOKED_SQL: &str = "
    DELETE FROM refresh_tokens
    WHERE id IN (
        SELECT id FROM refresh_tokens
        WHERE (revoked_at IS NOT NULL
               AND revoked_at < CURRENT_TIMESTAMP - make_interval(days => $2))
           OR (revoked_at IS NULL AND is_revoked = true
               AND created_at < CURRENT_TIMESTAMP - make_interval(days => GREATEST($2, 30)))
        LIMIT $1
    )";

const DELETE_EXPIRED_SQL: &str = "
    DELETE FROM refresh_tokens
    WHERE id IN (
        SELECT id FROM refresh_tokens
        WHERE expires_at < CURRENT_TIMESTAMP - make_interval(days => $2)
        LIMIT $1
    )";

const DELETE_GUEST_PORTAL_SQL: &str = "
    DELETE FROM guest_portal_sessions
    WHERE id IN (
        SELECT id FROM guest_portal_sessions
        WHERE expires_at < CURRENT_TIMESTAMP - make_interval(days => $2)
        LIMIT $1
    )";

const DELETE_USER_SESSIONS_SQL: &str = "
    DELETE FROM user_sessions
    WHERE id IN (
        SELECT id FROM user_sessions
        WHERE expires_at < CURRENT_TIMESTAMP - make_interval(days => $2)
        LIMIT $1
    )";

const REVOKE_IDLE_SQL: &str = "
    UPDATE refresh_tokens
    SET is_revoked = true, revoked_at = CURRENT_TIMESTAMP
    WHERE revoked_at IS NULL AND is_revoked = false
      AND expires_at > CURRENT_TIMESTAMP
      AND COALESCE(last_used_at, created_at) < CURRENT_TIMESTAMP - make_interval(days => $1)";

/// One retention sweep under `policy`. Idempotent: running it twice, or on
/// two replicas at once during a leader hand-over, deletes the same rows.
pub async fn purge(pool: &DbPool, policy: &RetentionPolicy) -> Result<PurgeReport, ApiError> {
    let mut report = PurgeReport::default();

    // Idle first, so a session it revokes starts its revoked grace now rather
    // than being deleted in the same sweep.
    if policy.idle_days > 0 {
        report.idle_revoked = sqlx::query(REVOKE_IDLE_SQL)
            .bind(policy.idle_days)
            .execute(pool)
            .await
            .map_err(|error| ApiError::Database(format!("idle session revoke failed: {error}")))?
            .rows_affected();
    }
    if policy.revoked_days > 0 {
        report.revoked_deleted =
            delete_in_batches(pool, DELETE_REVOKED_SQL, policy.revoked_days).await?;
    }
    if policy.expired_days > 0 {
        report.expired_deleted =
            delete_in_batches(pool, DELETE_EXPIRED_SQL, policy.expired_days).await?;
        report.guest_portal_deleted =
            delete_in_batches(pool, DELETE_GUEST_PORTAL_SQL, policy.expired_days).await?;
        report.user_sessions_deleted =
            delete_in_batches(pool, DELETE_USER_SESSIONS_SQL, policy.expired_days).await?;
    }
    Ok(report)
}

/// Revoke `user_id`'s least recently used live sessions so at most `cap`
/// remain, never touching `keep_session_id` (the session just minted).
/// Returns how many were revoked. `cap <= 0` is a no-op.
pub async fn enforce_session_cap(
    pool: &DbPool,
    user_id: i64,
    keep_session_id: &str,
    cap: i32,
) -> Result<u64, sqlx::Error> {
    if cap <= 0 {
        return Ok(0);
    }
    let revoked = sqlx::query(
        "UPDATE refresh_tokens
         SET is_revoked = true, revoked_at = CURRENT_TIMESTAMP
         WHERE id IN (
             SELECT id FROM refresh_tokens
             WHERE user_id = $1 AND id <> $2::uuid
               AND expires_at > CURRENT_TIMESTAMP
               AND revoked_at IS NULL AND is_revoked = false
             ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC, id DESC
             OFFSET $3
         )",
    )
    .bind(user_id)
    .bind(keep_session_id)
    // The kept session occupies one slot of the cap.
    .bind(i64::from(cap) - 1)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(revoked)
}

/// Sign-in hook: apply the configured cap after a new session is stored.
/// Best-effort — a failure here is logged and never fails the sign-in.
pub async fn apply_cap_after_sign_in(
    pool: &DbPool,
    user_id: i64,
    session_id: &str,
    ip_address: Option<&str>,
    user_agent: Option<&str>,
) {
    let cap = load_setting(pool, MAX_ACTIVE_PER_USER).await;
    match enforce_session_cap(pool, user_id, session_id, cap).await {
        Ok(0) => {}
        Ok(revoked) => {
            let _ = AuditLog::log_event(
                pool,
                AuditEvent {
                    user_id: Some(user_id),
                    action: "sessions_capped",
                    resource_type: "user",
                    resource_id: Some(user_id),
                    details: Some(serde_json::json!({
                        "revoked": revoked,
                        "max_active_per_user": cap,
                    })),
                    ip_address: ip_address.map(str::to_string),
                    user_agent: user_agent.map(str::to_string),
                },
            )
            .await;
        }
        Err(error) => {
            log::warn!("Failed to enforce the live-session cap after a sign-in: {error}");
        }
    }
}

/// One sweep with the current settings, for the scheduler and its tests.
pub async fn tick(pool: &DbPool) -> Result<serde_json::Value, ApiError> {
    let policy = RetentionPolicy::load(pool).await;
    let report = purge(pool, &policy).await?;
    let removed = report.revoked_deleted
        + report.expired_deleted
        + report.guest_portal_deleted
        + report.user_sessions_deleted;
    if removed > 0 || report.idle_revoked > 0 {
        log::info!(
            "Session retention: deleted {removed} stale session(s), revoked {} idle",
            report.idle_revoked
        );
    }
    Ok(serde_json::json!({ "policy": policy, "report": report }))
}

/// Job name recorded in `job_runs` and shown on the admin Jobs page.
pub const JOB_NAME: &str = "session_retention";

/// Run one sweep and record it in `job_runs`. Never fails the caller.
pub async fn run_once(pool: &DbPool) {
    let started = std::time::Instant::now();
    let outcome = tick(pool).await;
    crate::core::job_runs::record_outcome(pool, JOB_NAME, &outcome, started.elapsed()).await;
    if let Err(error) = &outcome {
        log::warn!("Session retention sweep failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_row_uses_the_shipped_default() {
        assert_eq!(resolve_setting(None, None, 7), 7);
        assert_eq!(resolve_setting(None, Some("  "), 10), 10);
    }

    #[test]
    fn a_stored_value_is_used() {
        assert_eq!(resolve_setting(None, Some("14"), 7), 14);
        assert_eq!(resolve_setting(None, Some(" 3 "), 7), 3);
    }

    #[test]
    fn zero_switches_a_policy_off() {
        assert_eq!(resolve_setting(None, Some("0"), 7), 0);
        assert_eq!(resolve_setting(Some("0"), Some("7"), 7), 0);
    }

    #[test]
    fn the_environment_overrides_the_database() {
        assert_eq!(resolve_setting(Some("2"), Some("7"), 7), 2);
        assert_eq!(resolve_setting(Some(""), Some("5"), 7), 5);
    }

    #[test]
    fn a_malformed_or_negative_value_never_reads_as_purge_now() {
        // Off, not the default and certainly not "0 days ago".
        for raw in ["-1", "seven", "7.5", "1e3"] {
            assert_eq!(resolve_setting(None, Some(raw), 7), 0, "{raw}");
            assert_eq!(resolve_setting(Some(raw), Some("7"), 7), 0, "{raw}");
        }
    }

    #[test]
    fn defaults_match_the_shipped_settings() {
        assert_eq!(EXPIRED_DAYS.default, 7);
        assert_eq!(REVOKED_DAYS.default, 7);
        assert_eq!(MAX_ACTIVE_PER_USER.default, 10);
        assert_eq!(IDLE_DAYS.default, 0);
    }
}
