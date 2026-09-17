# Distributed state — multi-instance readiness

Design approved 2026-09-17. Replaces the in-memory rate limiting, cache
invalidation, and per-process scheduler model so `hotel-app-be` can run
N replicas behind a load balancer. Backing store: **PostgreSQL only** —
zero new infrastructure, one code path on server and desktop.

## Scope

In scope:

1. Shared rate limiting via a Postgres bucket table (all 19 limiters).
2. Cross-instance cache invalidation via `LISTEN/NOTIFY` for the RBAC and
   settings caches (local caches stay — NOTIFY makes invalidation immediate;
   the existing TTL remains the bound for a missed notify).
3. Single-runner schedulers via `pg_try_advisory_lock` (night audit,
   payment receipts, unpaid-hold release, communications worker + scheduler).
4. Realtime `data_changed` fan-out via `pg_notify` so a mutation on replica
   A refreshes clients connected to replica B.
5. Documentation of the remaining boundaries (below).

Explicitly not fixed (documented instead):

- Sticky sessions required for staged import uploads (`private_uploads/` is
  local disk), import-job status polling (`IMPORT_JOBS` is process-local),
  and WebSocket connections (inherently pinned).
- Loyalty/support broadcast hubs stay per-replica (user-targeted events;
  sessions are sticky anyway).
- Per-replica by design: `/metrics` atomics, PayPal OAuth token cache,
  Google JWKS cache, uptime probe.

## 1. Rate limiting — `rate_limit_buckets`

```sql
CREATE TABLE rate_limit_buckets (
    bucket       text        NOT NULL,
    window_start timestamptz NOT NULL,
    count        integer     NOT NULL,
    PRIMARY KEY (bucket, window_start)
);
```

`bucket` = `{category}:{key}` where `category` names the limiter
(`auth`, `register`, `sensitive`, `guest_portal_token_read`, …) and `key`
is the IP string or caller-provided key. One atomic upsert per check:

```sql
INSERT INTO rate_limit_buckets (bucket, window_start, count)
VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $3) * $3), 1)
ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1
RETURNING count, window_start
```

`allowed = count <= max_requests`; `retry_after = window_start + window − now()`.
Window math runs in SQL so every replica shares the database clock.
Implementation follows the repo's PG contract: `core::sql_compat` helpers
(`param!(N)`, `current_timestamp()`) rather than literal `$N`/`NOW()` — the
sketch above is illustrative.

**Semantics change (accepted):** fixed window instead of the current exact
sliding window — a key can burst up to 2× `max_requests` across a window
boundary. Limits are coarse abuse ceilings, not meters.

**Fail-open:** a database error during the check logs a warning, increments
a metric, and allows the request. A dead database fails auth anyway; the
limiter must not make it worse.

**Call sites unchanged:** `RateLimiters::new(pool)` bakes the pool into each
limiter (`routes/mod.rs` already constructs it where the pool exists);
`check_with_retry(ip)` keeps its signature at all ~46 call sites.

**Backend enum** inside `RateLimiter`/`KeyedRateLimiter`:
`Postgres(DbPool)` used everywhere in production — desktop's embedded
Postgres takes the identical path, no config flag. `Memory` stays only for
the existing no-DB unit tests (constructed via the current `new(config)`
signature, now memory-only).

**Pruning:** `DELETE FROM rate_limit_buckets WHERE window_start < now() −
2×window` run by the lock-gated maintenance loop (§3) — replaces the
5-minute in-process cleanup tasks.

## 2. Cache invalidation — `LISTEN/NOTIFY`

- `rbac_cache::invalidate_all()` → `invalidate_all(pool).await`: clears the
  local map **and** `SELECT pg_notify('hotel_cache', 'rbac')`. Ten call
  sites in `modules/rbac/service.rs`, all with `pool` in scope.
- `settings_cache::invalidate_key(key)` → `invalidate_key(pool, key).await`:
  same shape, payload `settings:{key}`. Two call sites in
  `modules/settings/service.rs`.
- One `PgListener` task spawned in `main.rs` listens on `hotel_cache` and
  dispatches payloads to the local clear functions; reconnects in a loop on
  error. NOTIFY inside a transaction delivers on commit — correct semantics
  for mutation paths that run in txns.

## 3. Scheduler leadership — advisory locks

`core/leader.rs::spawn_exclusive(name, lock_key, pool, run)`:

- Pins one pooled connection per attempt; `SELECT pg_try_advisory_lock($1)`.
- Won → runs `run(pool)` under `tokio::select!` against a 15s watchdog that
  pings the pinned conn (`SELECT 1`); conn death → cancel the run, loop to
  re-acquire. Lock auto-releases on session death → automatic failover.
- Lost → sleep 30s, retry.
- Lock keys: distinct `i64` constants per scheduler.

Wraps all five `main.rs` spawns — `night_audit::scheduler`,
`payments::receipt_scheduler`, `bookings::unpaid_hold_scheduler`,
`communications::worker`, `communications::scheduler` — whose
`pub fn spawn(pool)` signatures already fit. Their bodies are unchanged;
the wrapper owns the exclusivity.

## 4. Realtime fan-out — `pg_notify` on `publish_data_changed`

`DataChangeHub` gains the pool and a per-process instance UUID (both set at
construction). `publish_data_changed(domain)` sends locally and spawns
`pg_notify('hotel_data_changed', '{uuid}:{domain}')`. The §2 listener opens
a second channel and re-broadcasts on every replica except the origin UUID
(origin-suppression prevents a local double-send).

## 5. Plumbing (repo rules)

- Baseline `0001_v1_baseline.sql` gains `rate_limit_buckets` (fresh
  installs) **and** new patch `0008_distributed_state.sql` registered in
  `patches/manifest.tsv`, `deploy/deploy.sh`, `deploy/deploy-staging.sh`,
  and both `.github/workflows/deploy*.yml`. Mirror via
  `bun run sync:resources` into `hotel-desktop/src-tauri/database/postgres/`.
- The patch converges both the current and previous baseline (exact
  `pg_get_constraintdef`/`pg_get_functiondef` guards where applicable); the
  table has no such dependencies, so a plain `CREATE TABLE IF NOT EXISTS`
  guard suffices.

## 6. Error handling

- Rate-limit DB error → fail open + `log::warn` + metric counter.
- Listener disconnect → log + exponential-ish reconnect loop; TTL covers
  the gap.
- Lock loss mid-run → watchdog cancels the task; the loser-side loop
  re-acquires later. Schedulers are loop-based and idempotent by design.
- `pg_notify` failure on publish → warn log only (event delivery is
  best-effort; the refetch happens on the next mutation anyway).

## 7. Tests

- Existing `rate_limiter` unit tests unchanged (memory backend).
- New `tests/distributed_state.rs` (PG-gated like the rest):
  - two `RateLimiter` objects sharing one pool enforce one shared limit;
  - `retry_after` is positive and ≤ window;
  - stale bucket rows are pruned by the maintenance statement;
  - two `spawn_exclusive` on one lock key → exactly one runs the body;
  - `pg_notify` dispatch: publish + listener receives payload shape
    `settings:<key>`/`rbac`/`{uuid}:{domain}`.
- `tests/postgres_patch_catalog.rs` enforces manifest↔deploy parity for
  patch 0008 automatically.
- `openapi_drift` unaffected (no routes added).

## 8. Docs updated on merge

- `docs/guides/deployment.md` — multi-replica section: sticky-session
  requirement (data-transfer, imports, WS), Caddy `lb_policy` note,
  scale-out checklist.
- `AGENTS.md` — the "keep rate limiting in-memory" dependency rule becomes
  "shared state lives in Postgres (`rate_limit_buckets`, LISTEN/NOTIFY,
  advisory locks)".
- `CLAUDE.md` — backend notes updated (limiter backend, leader locks,
  listener task in `main.rs` spawn list).
- `README.md` Limitations — single-instance bullet already removed;
  verify no re-introduction.
- `.claude/rules/00-diagnosis.md` Leak #3 checklist — add "new in-memory
  cross-request state needs a Postgres home or an explicit per-replica
  justification".
