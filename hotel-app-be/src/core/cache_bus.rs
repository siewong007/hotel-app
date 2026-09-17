//! Cross-instance cache invalidation and realtime fan-out over
//! `LISTEN`/`NOTIFY`.
//!
//! Local caches keep their 30s TTL as the correctness floor; notifications
//! are a best-effort fast path so a mutation on one replica invalidates the
//! others immediately instead of after TTL expiry. The same listener carries
//! `hotel_data_changed` so staff websockets on every replica learn about
//! mutations no matter which replica served the write.

use std::sync::LazyLock;
use std::time::Duration;

use sqlx::Executor;
use tokio::time::{sleep, timeout};
use uuid::Uuid;

use super::db::DbPool;

/// Channel for cache-invalidation payloads (`rbac`, `settings:<key>`).
pub const CACHE_CHANNEL: &str = "hotel_cache";
/// Channel for realtime data-change fan-out (`<instance_uuid>:<domain>`).
pub const DATA_CHANNEL: &str = "hotel_data_changed";

static INSTANCE_ID: LazyLock<Uuid> = LazyLock::new(Uuid::new_v4);

/// Stable per-process identifier stamped on `hotel_data_changed` payloads so
/// the origin replica can skip its own echo.
pub fn instance_id() -> Uuid {
    *INSTANCE_ID
}

/// Fire-and-log a cache-invalidation payload. Best-effort: the TTL bounds a
/// missed notification, so a transient failure only delays convergence.
pub async fn publish(pool: &DbPool, payload: &str) {
    let _ = sqlx::query("SELECT pg_notify($1, $2)")
        .bind(CACHE_CHANNEL)
        .bind(payload)
        .execute(pool)
        .await
        .inspect_err(|e| log::warn!("cache notify failed: {e}"));
}

/// Spawn the reconnecting LISTEN loop that dispatches notifications on both
/// channels to the local caches and the realtime hub.
pub fn spawn_listener(pool: DbPool) {
    tokio::spawn(async move {
        loop {
            match sqlx::postgres::PgListener::connect_with(&pool).await {
                Ok(mut listener) => {
                    let ready = listener.listen(CACHE_CHANNEL).await.is_ok()
                        && listener.listen(DATA_CHANNEL).await.is_ok();
                    if ready {
                        // `recv` alone cannot distinguish silence from a
                        // half-open connection (no traffic looks identical to
                        // a dead peer until TCP gives up, ~hours by default).
                        // Probe quiet connections; reconnect only when the
                        // probe itself fails or stalls.
                        loop {
                            match timeout(Duration::from_secs(60), listener.recv()).await {
                                Ok(Ok(note)) => dispatch(note.channel(), note.payload()),
                                Ok(Err(_)) => break,
                                Err(_) => {
                                    let alive = timeout(
                                        Duration::from_secs(5),
                                        listener.execute("SELECT 1"),
                                    )
                                    .await
                                    .map(|result| result.is_ok())
                                    .unwrap_or(false);
                                    if !alive {
                                        log::warn!("cache listener connection dead; reconnecting");
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => log::warn!("cache listener connect failed: {e}"),
            }
            sleep(Duration::from_secs(5)).await;
        }
    });
}

fn dispatch(channel: &str, payload: &str) {
    match channel {
        CACHE_CHANNEL => {
            if payload == "rbac" {
                crate::core::rbac_cache::clear_all();
            } else if let Some(key) = payload.strip_prefix("settings:") {
                if key == "*" {
                    crate::core::settings_cache::clear_all();
                } else {
                    crate::core::settings_cache::clear_key(key);
                }
            }
        }
        DATA_CHANNEL => {
            if let Some((origin, domain)) = payload.split_once(':')
                && origin != instance_id().to_string()
                && let Some(tx) = crate::modules::realtime::hub::fanout_sender()
            {
                let _ = tx.send(crate::modules::realtime::hub::DataChangeEvent {
                    event_type: "data_changed",
                    domain: std::borrow::Cow::Owned(domain.to_string()),
                });
            }
        }
        _ => {}
    }
}
