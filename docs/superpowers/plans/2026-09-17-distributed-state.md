# Distributed State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace in-memory rate limiting, cache invalidation, and per-process
schedulers with PostgreSQL-backed shared state so `hotel-app-be` can run N
replicas.

**Architecture:** Fixed-window `rate_limit_buckets` upsert for all 19 limiters;
`LISTEN/NOTIFY` for RBAC/settings cache invalidation plus `data_changed` WS
fan-out; `pg_try_advisory_lock` single-runner gating for the five spawned
schedulers. Spec: `docs/superpowers/specs/2026-09-17-distributed-state-design.md`.

**Tech Stack:** Rust 1.95.0, Axum 0.8, SQLx 0.9 (plain `sqlx::query()`, not
macros), PostgreSQL 19.

## Global Constraints

- SQLx is runtime-checked only — use `core::sql_compat` helpers (`param!(N)`,
  `current_timestamp()`, `current_date()`), never literal `$1`/`NOW()`.
- The baseline is pg_dump-shaped: table bodies, then PKs via `ALTER TABLE …
  ADD CONSTRAINT`, then FKs. No inline `REFERENCES`.
- Patch registration requires FIVE places: `patches/manifest.tsv`,
  `deploy/deploy.sh` (file list ~L70 + install ~L341), `deploy/deploy-staging.sh`
  (~L70 + ~L296), `.github/workflows/deploy.yml` (cp ~L176 + bundle list ~L199),
  `.github/workflows/deploy-staging.yml` (~L194 + ~L217).
  `tests/postgres_patch_catalog.rs` enforces parity.
- Checksums: `sha256:$(shasum -a 256 <file> | awk '{print $1}')` — `.gitattributes`
  pins `*.sql`/`*.tsv` to `eol=lf`; verify `file` shows LF not CRLF.
- Rate-limit DB errors fail OPEN (log warn + `metrics::incr`), never deny.
- `#[allow(dead_code)]` on `RateLimiter::check` — tests/ uses it; do not remove.
- Desktop mirror: `bun run sync:resources` copies `database/postgres/` →
  `hotel-desktop/src-tauri/database/postgres/`; `make db-mirror-check` (CI) diffs.
- Do NOT touch `main.rs` re-declared dead_code warnings — grep `tests/` before
  deleting anything.
- Verify: `cargo check --all-features` then `cargo clippy --all-features -- -D warnings`.

---

### Task 1: `rate_limit_buckets` schema — baseline, patch 0008, registration, mirror

**Files:**
- Modify: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`
- Create: `hotel-app-be/database/postgres/patches/0008_distributed_state.sql`
- Modify: `hotel-app-be/database/postgres/patches/manifest.tsv`
- Modify: `deploy/deploy.sh` (2 spots), `deploy/deploy-staging.sh` (2 spots)
- Modify: `.github/workflows/deploy.yml` (2 spots), `.github/workflows/deploy-staging.yml` (2 spots)
- Mirror: `hotel-desktop/src-tauri/database/postgres/` via `bun run sync:resources`

**Interfaces:**
- Produces: table `public.rate_limit_buckets(bucket text, window_start timestamptz, count integer)` PK `(bucket, window_start)` used by Task 2 and Task 4's prune.

- [ ] **Step 1: Add the table to the V1 baseline (pg_dump shape)**

Find the table-body section (alphabetical `CREATE TABLE public.*` blocks) and add:

```sql
CREATE TABLE public.rate_limit_buckets (
    bucket text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer NOT NULL
);
```

Then find the `ALTER TABLE ONLY … ADD CONSTRAINT … PRIMARY KEY` section and add:

```sql
ALTER TABLE ONLY public.rate_limit_buckets
    ADD CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (bucket, window_start);
```

- [ ] **Step 2: Write the converge-style patch**

`hotel-app-be/database/postgres/patches/0008_distributed_state.sql`:

```sql
-- Adds the shared rate-limit bucket store used by the distributed
-- (multi-replica) rate limiter. Fresh installs already carry the table from
-- the V1 baseline; this patch creates it on installed databases and refuses
-- to converge onto a same-named table with a different shape.
DO $rate_limit_buckets$
BEGIN
    IF to_regclass('public.rate_limit_buckets') IS NULL THEN
        CREATE TABLE public.rate_limit_buckets (
            bucket text NOT NULL,
            window_start timestamp with time zone NOT NULL,
            count integer NOT NULL,
            CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (bucket, window_start)
        );
    ELSIF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'rate_limit_buckets'
          AND constraint_name = 'rate_limit_buckets_pkey'
          AND constraint_type = 'PRIMARY KEY'
    ) THEN
        RAISE EXCEPTION 'rate_limit_buckets exists without expected primary key';
    END IF;
END
$rate_limit_buckets$;
```

- [ ] **Step 3: Register in the manifest**

Append to `hotel-app-be/database/postgres/patches/manifest.tsv` (tab-separated):

```text
1	8	distributed-state	sha256:<sha256 of the file>	0008_distributed_state.sql
```

Compute: `shasum -a 256 hotel-app-be/database/postgres/patches/0008_distributed_state.sql | awk '{print $1}'`

- [ ] **Step 4: Register in deploy scripts**

`deploy/deploy.sh` and `deploy/deploy-staging.sh`: add
`database/patches/0008_distributed_state.sql` to the file list after the 0007
line (~L70) AND the matching `install -m 0644 …` line after the 0007 install
line (~L341 / ~L296).

- [ ] **Step 5: Register in deploy workflows**

`.github/workflows/deploy.yml` (~L176-177 and ~L199) and
`.github/workflows/deploy-staging.yml` (~L194-195 and ~L217): mirror the
existing two-line `cp`/`"$bundle_dir/…"` pattern for 0008.

- [ ] **Step 6: Mirror to desktop and verify catalog parity**

```bash
cd hotel-desktop && bun run sync:resources && cd ..
make db-mirror-check   # or: diff -r the two postgres dirs
cd hotel-app-be && cargo test --all-features --test postgres_patch_catalog
```

Expected: mirror identical; catalog test PASS (it cross-checks manifest ↔
deploy registrations).

- [ ] **Step 7: Commit**

```bash
git add hotel-app-be/database deploy .github/workflows hotel-desktop/src-tauri/database
git commit -m "feat(db): rate_limit_buckets table (patch 0008 distributed-state)"
```

---

### Task 2: Postgres backend for `RateLimiter`/`KeyedRateLimiter`

**Files:**
- Modify: `hotel-app-be/src/core/rate_limiter.rs`
- Modify: `hotel-app-be/src/routes/mod.rs:404`
- Modify: `hotel-app-be/src/core/mod.rs` (no change needed if same module)

**Interfaces:**
- Consumes: `rate_limit_buckets` (Task 1).
- Produces: `RateLimiter::postgres(category: &'static str, config: RateLimitConfig, pool: DbPool)`; `KeyedRateLimiter::postgres(...)`; `RateLimiters::new(pool: DbPool)`; unchanged `check_with_retry(ip)` / `check_with_retry(key)` signatures for all ~46 call sites; `RateLimiter::new(config)` stays as the memory-only test constructor.

- [ ] **Step 1: Write the failing PG test** (in `tests/distributed_state.rs`, created here and extended by Tasks 4–5)

```rust
//! Distributed-state integration tests. PG-gated like the other suites.
use hotel_app_be::core::rate_limiter::{RateLimiter, RateLimitConfig};

async fn pool() -> Option<sqlx::PgPool> {
    let url = std::env::var("DATABASE_URL").ok()?;
    sqlx::PgPool::connect(&url).await.ok()
}

#[tokio::test]
async fn postgres_limiter_shares_bucket_across_instances() {
    let Some(pool) = pool().await else { return };
    sqlx::query("DELETE FROM rate_limit_buckets").execute(&pool).await.unwrap();
    // Two limiter objects on one pool behave as one limiter (two replicas).
    let a = RateLimiter::postgres("auth", RateLimitConfig::new(2, 60), pool.clone());
    let b = RateLimiter::postgres("auth", RateLimitConfig::new(2, 60), pool.clone());
    let ip = "203.0.113.9".parse().unwrap();
    assert_eq!(a.check_with_retry(ip).await.0, true);
    assert_eq!(b.check_with_retry(ip).await.0, true);
    assert_eq!(a.check_with_retry(ip).await.0, false);
}
```

Run: `cd hotel-app-be && cargo test --all-features --test distributed_state`
Expected: FAIL — `postgres` doesn't exist yet (or no-DB early-return; confirm
fail with DATABASE_URL set).

- [ ] **Step 2: Rework `core/rate_limiter.rs`**

Replace the shared `entries` field with a backend enum. Keep `RateLimitEntry`
and its `check_and_record` (memory path reuses it):

```rust
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

use crate::core::db::DbPool;
use crate::core::sql_compat::param;

enum Backend {
    /// Test-only in-memory buckets (no DATABASE_URL unit tests).
    Memory(Arc<Mutex<HashMap<String, RateLimitEntry>>>),
    /// Shared fixed-window counters in `rate_limit_buckets`.
    Postgres { pool: DbPool, category: &'static str },
}

async fn check_postgres(
    pool: &DbPool,
    bucket: &str,
    config: &RateLimitConfig,
) -> (bool, u64) {
    let window_secs = config.window.as_secs().max(1) as f64;
    // date_bin buckets now() into fixed windows in-database — the clock all
    // replicas share. AssertSqlSafe wraps format!-built SQL per repo
    // convention (see rbac_cache.rs).
    let result = sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO rate_limit_buckets (bucket, window_start, count) \
         VALUES ({p1}, date_bin(make_interval(secs => {p2}), {now}, '1970-01-01'), 1) \
         ON CONFLICT (bucket, window_start) DO UPDATE \
         SET count = rate_limit_buckets.count + 1 \
         RETURNING count, window_start",
        p1 = param!(1),
        p2 = param!(2),
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
                let window_end = window_start + chrono::Duration::from_std(config.window).unwrap_or_default();
                let secs = (window_end - chrono::Utc::now()).num_seconds().max(1) as u64;
                (false, secs)
            }
        }
        // Fail open: a dead database fails auth anyway; the limiter must not
        // make it worse.
        Err(error) => {
            log::warn!("rate limit check failed, allowing request: {error}");
            (true, 0)
        }
    }
}
```

`RateLimiter` becomes `{ backend: Backend, config: RateLimitConfig }`:
`new(config)` builds `Backend::Memory` (test constructor);
`postgres(category, config, pool)` builds `Backend::Postgres`.
`check`/`check_with_retry` match on backend — memory uses the existing
`RateLimitEntry` logic keyed by `ip.to_string()`; postgres calls
`check_postgres(&pool, &format!("{category}:{ip}"), &config)` and increments
`RATE_LIMIT_REJECTIONS` on deny in BOTH paths. Delete both `tokio::spawn`
cleanup loops (pruning moves to Task 4). Same for `KeyedRateLimiter`
(`key.into()` string instead of ip).

`RateLimiters::new(pool: DbPool)` builds each field via
`RateLimiter::postgres("<field_name>", config, pool.clone())` /
`KeyedRateLimiter::postgres("<field_name>", config, pool.clone())` —
category strings equal the field names.

- [ ] **Step 3: Pass the pool in `routes/mod.rs`**

```rust
let rate_limiters = RateLimiters::new(pool.clone());
```

- [ ] **Step 4: Verify**

`cargo check --all-features` → clean; run the Task-2 test → PASS (with
DATABASE_URL); `cargo test --all-features --lib` → memory unit tests PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(rate-limit): Postgres fixed-window buckets behind unchanged call sites"`

---

### Task 3: `core/leader.rs` — advisory-lock single-runner + bucket prune

**Files:**
- Create: `hotel-app-be/src/core/leader.rs`
- Modify: `hotel-app-be/src/core/mod.rs` (add `pub mod leader;`)
- Modify: `hotel-app-be/src/main.rs` (wrap the five spawns)
- Test: `hotel-app-be/tests/distributed_state.rs`

**Interfaces:**
- Produces: `pub fn spawn_exclusive<F, Fut>(name: &'static str, lock_key: i64, pool: DbPool, run: F)` where `F: Fn(DbPool) -> Fut + Send + Sync + 'static`, `Fut: Future<Output = ()> + Send`. Lock keys: `LOCK_NIGHT_AUDIT=820_001`, `LOCK_RECEIPTS=820_002`, `LOCK_UNPAID_HOLD=820_003`, `LOCK_COMMS_WORKER=820_004`, `LOCK_COMMS_SCHED=820_005`, `LOCK_RATE_LIMIT_PRUNE=820_006`.

- [ ] **Step 1: Write the failing test** (append to `tests/distributed_state.rs`)

```rust
use hotel_app_be::core::leader;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

#[tokio::test]
async fn exclusive_scheduler_runs_on_one_instance_only() {
    let Some(pool) = pool().await else { return };
    let runs = Arc::new(AtomicUsize::new(0));
    for _ in 0..2 {
        let runs = runs.clone();
        leader::spawn_exclusive("test", 999_999, pool.clone(), move |_pool| {
            let runs = runs.clone();
            async move { runs.fetch_add(1, Ordering::SeqCst); }
        });
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}
```

- [ ] **Step 2: Implement `core/leader.rs`**

```rust
//! Single-runner gating for spawned background loops via PG advisory locks.
//! Session-scoped locks auto-release on connection death → automatic failover.

use std::future::Future;
use std::time::Duration;
use tokio::time::sleep;

use super::db::DbPool;

const RETRY_DELAY: Duration = Duration::from_secs(30);
const WATCHDOG_INTERVAL: Duration = Duration::from_secs(15);

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
            let won = sqlx::query_scalar::<_, bool>(
                "SELECT pg_try_advisory_lock($1)",
            )
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
                    _ = &mut run_fut => break,          // task ended (shouldn't happen)
                    _ = watchdog.tick() => {
                        if sqlx::query("SELECT 1").execute(&mut *conn).await.is_err() {
                            log::warn!("scheduler '{name}' lost lock connection; re-acquiring");
                            break;                     // conn drop releases the lock
                        }
                    }
                }
            }
            drop(conn);                                  // release lock before re-loop
        }
    });
}
```

- [ ] **Step 3: Wrap the five spawns + add the prune loop in `main.rs`**

```rust
use crate::core::leader::{self, *};

leader::spawn_exclusive("night_audit", LOCK_NIGHT_AUDIT, pool.clone(),
    |p| async move { modules::night_audit::scheduler::run(p).await });
leader::spawn_exclusive("receipts", LOCK_RECEIPTS, pool.clone(),
    |p| async move { modules::payments::receipt_scheduler::run(p).await });
leader::spawn_exclusive("unpaid_hold", LOCK_UNPAID_HOLD, pool.clone(),
    |p| async move { modules::bookings::unpaid_hold_scheduler::run(p).await });
leader::spawn_exclusive("comms_worker", LOCK_COMMS_WORKER, pool.clone(),
    |p| async move { modules::communications::worker::run(p).await });
leader::spawn_exclusive("comms_scheduler", LOCK_COMMS_SCHED, pool.clone(),
    |p| async move { modules::communications::scheduler::run(p).await });
leader::spawn_exclusive("rate_limit_prune", LOCK_RATE_LIMIT_PRUNE, pool.clone(),
    |p| async move {
        loop {
            let _ = sqlx::query(
                "DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '2 hours'")
                .execute(&p).await;
            tokio::time::sleep(Duration::from_secs(600)).await;
        }
    });
```

The existing `spawn(pool)` fns spawn internally — refactor each to expose
`pub async fn run(pool: DbPool)` containing the loop body, keeping
`spawn(pool)` as `tokio::spawn(run(pool))` for any other callers (grep them
first). Then the wrappers pass `run`.

- [ ] **Step 4: Verify + commit**

`cargo check --all-features` → clean; `cargo test --all-features --test
distributed_state` → PASS; commit
`"feat(schedulers): advisory-lock single-runner for spawned loops"`.

---

### Task 4: NOTIFY cache bus — invalidation + WS fan-out

**Files:**
- Create: `hotel-app-be/src/core/cache_bus.rs`
- Modify: `hotel-app-be/src/core/mod.rs`, `core/rbac_cache.rs`, `core/settings_cache.rs`
- Modify: `hotel-app-be/src/modules/rbac/service.rs` (10 sites), `modules/settings/service.rs` (2 sites)
- Modify: `hotel-app-be/src/modules/realtime/hub.rs`
- Modify: `hotel-app-be/src/routes/mod.rs` (hub construction), `src/main.rs` (listener spawn)
- Test: `hotel-app-be/tests/distributed_state.rs`

**Interfaces:**
- Produces: `cache_bus::publish(pool, payload)`; `cache_bus::spawn_listener(pool)`; `cache_bus::instance_id() -> Uuid`; `rbac_cache::invalidate_all(pool).await`; `settings_cache::invalidate_key(pool, key).await`; `rbac_cache::clear_all()` / `settings_cache::clear_key(key)` (pub(crate) local clears); `DataChangeHub::new(pool, instance_id)`; `hub::fanout_sender()`.

- [ ] **Step 1: Write the failing test** (append to `tests/distributed_state.rs`)

```rust
#[tokio::test]
async fn cache_invalidate_notifies_other_replicas() {
    let Some(pool) = pool().await else { return };
    let mut listener = sqlx::postgres::PgListener::connect_with(&pool).await.unwrap();
    listener.listen("hotel_cache").await.unwrap();
    hotel_app_be::core::rbac_cache::invalidate_all(&pool).await;
    let note = tokio::time::timeout(Duration::from_secs(5), listener.recv())
        .await.unwrap().unwrap();
    assert_eq!(note.payload(), "rbac");
}
```

- [ ] **Step 2: `core/cache_bus.rs`**

```rust
//! Cross-instance cache invalidation + realtime fan-out over LISTEN/NOTIFY.

use std::sync::LazyLock;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

use super::db::DbPool;

pub const CACHE_CHANNEL: &str = "hotel_cache";
pub const DATA_CHANNEL: &str = "hotel_data_changed";

static INSTANCE_ID: LazyLock<Uuid> = LazyLock::new(Uuid::new_v4);

pub fn instance_id() -> Uuid { *INSTANCE_ID }

/// Fire-and-log; invalidation is best-effort on top of the 30s TTL.
pub async fn publish(pool: &DbPool, payload: &str) {
    let _ = sqlx::query("SELECT pg_notify($1, $2)")
    .bind(CACHE_CHANNEL).bind(payload).execute(pool).await
    .inspect_err(|e| log::warn!("cache notify failed: {e}"));
}

pub fn spawn_listener(pool: DbPool) {
    tokio::spawn(async move {
        loop {
            match sqlx::postgres::PgListener::connect_with(&pool).await {
                Ok(mut listener) => {
                    let ok = listener.listen(CACHE_CHANNEL).await.is_ok()
                        && listener.listen(DATA_CHANNEL).await.is_ok();
                    if ok {
                        while let Ok(note) = listener.recv().await {
                            dispatch(note.channel(), note.payload());
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
                crate::core::settings_cache::clear_key(key);
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
```

- [ ] **Step 3: Signature changes**

`rbac_cache.rs`: rename current `pub fn invalidate_all` → `pub(crate) fn clear_all()`; add `pub async fn invalidate_all(pool: &DbPool) { clear_all(); crate::core::cache_bus::publish(pool, "rbac").await; }`. Update the 10 call sites in `modules/rbac/service.rs` → `crate::core::rbac_cache::invalidate_all(pool).await;`.

`settings_cache.rs`: same pattern — `pub(crate) fn clear_key(key)` + `pub async fn invalidate_key(pool: &DbPool, key: &str) { clear_key(key); publish(pool, &format!("settings:{key}")).await; }`. Update `modules/settings/service.rs` :70 and :113.

- [ ] **Step 4: Hub fan-out**

`hub.rs`: `domain: &'static str` → `domain: std::borrow::Cow<'static, str>`;
`publish_data_changed` takes `Cow::Borrowed(domain)` and also spawns
`pg_notify(DATA_CHANNEL, "{instance}:{domain}")` via stored `Option<DbPool>`.
Add `static FANOUT: OnceLock<broadcast::Sender<DataChangeEvent>>` registered
in `new`/`default`, exposed as `pub fn fanout_sender()`.
`DataChangeHub::new(pool: DbPool, instance_id: Uuid)` — `Default` keeps
`pool: None` (tests). `routes/mod.rs`: `DataChangeHub::new(pool.clone(),
crate::core::cache_bus::instance_id())`. Publish sites unchanged (`&'static
str` coerces to `Cow::Borrowed`).

- [ ] **Step 5: Wire listener in `main.rs`**

```rust
crate::core::cache_bus::spawn_listener(pool.clone());
```

before `create_router(pool)`.

- [ ] **Step 6: Verify + commit**

`cargo check --all-features` → clean; PG test → PASS;
`git commit -m "feat(cache): LISTEN/NOTIFY invalidation + data-change fan-out"`.

---

### Task 5: Docs — multi-replica guidance + rule updates

**Files:**
- Modify: `docs/guides/deployment.md` (new "Running multiple replicas" section)
- Modify: `AGENTS.md` (rate-limit dependency rule), `CLAUDE.md` (backend notes)
- Modify: `.claude/rules/00-diagnosis.md` (Leak #3 checklist)
- Verify: `README.md` Limitations stays without the single-instance bullet

- [ ] **Step 1: deployment.md multi-replica section**

Add a section covering: what is shared (rate-limit buckets, cache
invalidation, scheduler locks, data-change fan-out); what requires sticky
sessions (staged uploads on local disk, `IMPORT_JOBS` registry polling, WS
connections — Caddy `lb_policy ip_hash` or equivalent); what is per-replica
(`/metrics`, PayPal token cache, JWKS cache, uptime).

- [ ] **Step 2: AGENTS.md dependency rule**

Replace "Keep backend rate limiting in the existing in-memory implementation
unless a separate task approves a different design" with the Postgres
shared-state rule (this task IS the approved design — update the owning doc).

- [ ] **Step 3: CLAUDE.md backend notes + 00-diagnosis checklist**

Update the rate-limit/caching lines to describe `rate_limit_buckets`, the
listener, and `spawn_exclusive`. Add to Leak #3 checklist: "new cross-request
state → Postgres home or explicit per-replica justification".

- [ ] **Step 4: `make docs-check` + commit**

Links pass; `git commit -m "docs: multi-replica deployment guidance"`.

---

### Task 6: Full verification

- [ ] `cargo check --all-features` — clean
- [ ] `cargo clippy --all-features -- -D warnings` — clean
- [ ] `cargo test --all-features` with DATABASE_URL — new PG tests pass
- [ ] `cargo test --all-features` without DATABASE_URL — early-return pass
- [ ] `make db-mirror-check` — desktop mirror in sync
- [ ] `make docs-check` — links pass
- [ ] `git status` — only expected files changed
