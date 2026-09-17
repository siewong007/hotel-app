//! Single-runner gating for spawned background loops via Postgres advisory
//! locks.
//!
//! Each guarded task pins one pooled connection and holds a session-scoped
//! `pg_advisory_lock` on it. Only the winner's `run` future is driven; losers
//! retry until the lock frees. Session death releases the lock automatically,
//! so a crashed leader hands off to the next replica without any lease
//! bookkeeping. A watchdog ping on the pinned connection detects lock loss
//! (failover, network partition) and re-enters the acquisition loop.

use std::future::Future;
use std::time::Duration;

use tokio::time::sleep;

use super::db::DbPool;

/// How long a loser waits before retrying `pg_try_advisory_lock`, and how
/// long a leader that lost its connection waits before re-acquiring.
const RETRY_DELAY: Duration = Duration::from_secs(30);
/// How often the leader pings the lock-holding connection.
const WATCHDOG_INTERVAL: Duration = Duration::from_secs(15);

/// Advisory-lock keys. One namespace (820_xxx) keeps every guarded task
/// distinct from any other advisory-lock user.
pub const LOCK_NIGHT_AUDIT: i64 = 820_001;
pub const LOCK_RECEIPTS: i64 = 820_002;
pub const LOCK_UNPAID_HOLD: i64 = 820_003;
pub const LOCK_COMMS_WORKER: i64 = 820_004;
pub const LOCK_COMMS_SCHED: i64 = 820_005;
pub const LOCK_RATE_LIMIT_PRUNE: i64 = 820_006;

/// Spawn `run` so that exactly one process in the replica set drives it at a
/// time. `run` receives the pool and is expected to never return (a
/// scheduler loop); if it does, or the lock connection dies, the acquisition
/// loop starts over.
pub fn spawn_exclusive<F, Fut>(name: &'static str, lock_key: i64, pool: DbPool, run: F)
where
    F: Fn(DbPool) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = ()> + Send,
{
    tokio::spawn(async move {
        loop {
            let Ok(mut conn) = pool.acquire().await else {
                sleep(RETRY_DELAY).await;
                continue;
            };
            let won = sqlx::query_scalar::<_, bool>("SELECT pg_try_advisory_lock($1)")
                .bind(lock_key)
                .fetch_one(&mut *conn)
                .await
                .unwrap_or(false);
            if !won {
                drop(conn);
                sleep(RETRY_DELAY).await;
                continue;
            }
            log::info!("scheduler '{name}' holds leader lock {lock_key}");

            let mut run_fut = std::pin::pin!(run(pool.clone()));
            let mut watchdog = tokio::time::interval(WATCHDOG_INTERVAL);
            loop {
                tokio::select! {
                    _ = &mut run_fut => {
                        log::warn!("scheduler '{name}' exited; re-acquiring lock");
                        break;
                    }
                    _ = watchdog.tick() => {
                        if sqlx::query("SELECT 1").execute(&mut *conn).await.is_err() {
                            log::warn!(
                                "scheduler '{name}' lost lock connection; re-acquiring"
                            );
                            break;
                        }
                    }
                }
            }
            drop(conn); // session drop releases the advisory lock
        }
    });
}
