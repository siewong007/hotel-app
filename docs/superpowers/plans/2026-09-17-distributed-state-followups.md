# Distributed-State Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the four residual correctness/hardening items left deferred by the second-pass review of `feat/distributed-state`.

**Architecture:** Pure-code fixes only — no schema or patch changes. Each item closes a real overlap/partition failure mode the leader contract exposed but did not create.

**Tech Stack:** Rust 2024, Axum, sqlx 0.9, PostgreSQL 19.

## Global Constraints

- No schema changes in this plan (avoids a patch-0009 registration cycle; every fix is code-side).
- `git status --short --branch` before editing — shared tree.
- Format touched files only (`rustfmt --edition 2024 <file>`), never repo-wide `cargo fmt`.
- Verification per task: `cargo check --all-features`, plus the named test suite.
- Worktree: `.worktrees/distributed-state`, branch `feat/distributed-state`.
- Test DB: `DATABASE_URL=postgres://postgres:postgres@localhost:55432/hotel_dstest`; `psql` via `PATH="/opt/homebrew/opt/libpq/bin:$PATH"`.

---

### Task 1: Swallow the audit-partition create race in the caller

`ensure_audit_logs_partition` (baseline fn) is check-then-create: under a leader overlap two callers can both pass `IF NOT EXISTS` and the loser gets `duplicate_table` (SQLSTATE `42P07`). It self-heals next tick, but the error needlessly propagates. Catch `42P07` at the single call site — the desired end state (partition exists) holds either way. No patch needed: the function contract "creates the partition" is satisfied by whichever caller won.

**Files:**
- Modify: `hotel-app-be/src/repositories/audit.rs:373-385`

- [x] **Step 1: Apply the caller-side guard**

Replace the `.execute(pool).await.map_err(...)` tail in `ensure_upcoming_partitions` with an `or_else` that accepts `42P07`:

```rust
    pub async fn ensure_upcoming_partitions(pool: &DbPool) -> Result<(), ApiError> {
        sqlx::query(
            "SELECT public.ensure_audit_logs_partition(month_start::date) \
             FROM generate_series( \
                 date_trunc('month', CURRENT_DATE)::date, \
                 (date_trunc('month', CURRENT_DATE) + interval '2 months')::date, \
                 interval '1 month') AS month_start",
        )
        .execute(pool)
        .await
        .or_else(|e| {
            // Two overlapping leaders can both pass the function's
            // IF NOT EXISTS check; the loser's CREATE raises 42P07 —
            // the partition exists either way, so the race is benign.
            let raced = e
                .as_database_error()
                .is_some_and(|d| d.code().as_deref() == Some("42P07"));
            if raced {
                Ok(sqlx::postgres::PgQueryResult::default())
            } else {
                Err(e)
            }
        })
        .map_err(|e| ApiError::Database(e.to_string()))?;
        Ok(())
    }
```

- [x] **Step 2: Verify**

Run: `cd hotel-app-be && cargo check --all-features`
Expected: clean compile.

- [x] **Step 3: Commit**

```bash
git add hotel-app-be/src/repositories/audit.rs
git commit -m "fix(audit): tolerate partition-create race in ensure_upcoming_partitions"
```

---

### Task 2: Resume campaigns abandoned mid-expansion

If the leader dies mid-`expand_campaign`, the campaign stays `running` forever: `due_scheduled_campaigns` selects only `scheduled`, and `complete_campaign_if_done` then marks it `completed` once in-flight deliveries drain — finalizing a partial audience. Expansion is already idempotent (`campaign:{id}:guest:{id}` keys + `audience_batch`'s `NOT EXISTS delivery` filter), so a stale-running campaign just needs re-expansion, and completion must wait for the audience to be exhausted.

**Files:**
- Modify: `hotel-app-be/src/modules/communications/repository.rs` (after `due_scheduled_campaigns` ~:906; `complete_campaign_if_done` ~:1266)
- Modify: `hotel-app-be/src/modules/communications/scheduler.rs:287-297`
- Modify: `hotel-app-be/src/modules/communications/worker.rs:112-116`

**Interfaces:**
- Consumes: `Repo::get_campaign` (existing, returns `Option<EmailCampaign>` with `topic`, `segment_id`), `segments::service::audience_scope_for(pool, segment_id) -> Result<SegmentScope, ApiError>` (existing, called by `expand_campaign`), `Repo::audience_batch(pool, topic, campaign_id, &scope, limit)` (existing).
- Produces: `Repo::stale_running_campaigns(pool) -> Result<Vec<EmailCampaign>, ApiError>`.

- [x] **Step 1: Add the stale-running query**

In `repository.rs` after `due_scheduled_campaigns` (~line 914), add:

```rust
    /// Campaigns stuck `running` past the point any live leader could still
    /// be expanding them — the leader died mid-expansion. Re-expanding is
    /// safe: audience_batch excludes guests that already have a delivery row.
    pub async fn stale_running_campaigns(pool: &DbPool) -> Result<Vec<EmailCampaign>, ApiError> {
        let sql = "SELECT {COLS} FROM email_campaigns WHERE status = 'running' AND started_at < CURRENT_TIMESTAMP - interval '15 minutes' ORDER BY started_at"
            .replace("{COLS}", CAMPAIGN_COLUMNS);
        let rows = query(sqlx::AssertSqlSafe(&*sql))
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
        Ok(rows.iter().map(campaign_from_row).collect())
    }
```

- [x] **Step 2: Resume stale campaigns in the tick**

Replace `tick_campaigns` body (`scheduler.rs:287-297`) with:

```rust
pub async fn tick_campaigns(pool: &DbPool) -> Result<usize, ApiError> {
    let mut expanded = 0;
    for campaign in Repo::due_scheduled_campaigns(pool).await? {
        if !Repo::mark_campaign_running(pool, campaign.id).await? {
            continue; // another instance won the transition
        }
        expanded += expand_campaign(pool, &campaign).await?;
    }
    // A leader that died mid-expansion leaves the campaign 'running' with a
    // partial audience. Re-expansion is idempotent — audience_batch skips
    // guests that already have a delivery row.
    for campaign in Repo::stale_running_campaigns(pool).await? {
        expanded += expand_campaign(pool, &campaign).await?;
    }
    Ok(expanded)
}
```

- [x] **Step 3: Gate completion on an exhausted audience**

In `worker.rs`, replace the `complete_campaign_if_done` loop (~:112-116) with an audience check first:

```rust
    for campaign_id in campaigns_touched {
        // Don't finalize a campaign whose expansion is incomplete — a leader
        // that died mid-expansion leaves un-expanded audience with no
        // delivery rows, which the stale-running resume above will pick up.
        if let Some(campaign) = Repo::get_campaign(pool, campaign_id).await? {
            let scope =
                crate::modules::segments::service::audience_scope_for(pool, campaign.segment_id)
                    .await?;
            let remaining =
                Repo::audience_batch(pool, &campaign.topic, campaign_id, &scope, 1).await?;
            if !remaining.is_empty() {
                continue;
            }
        }
        if Repo::complete_campaign_if_done(pool, campaign_id).await? {
            log::info!("Campaign {campaign_id} completed");
        }
    }
```

Check `get_campaign`'s return field names (`topic`, `segment_id`) while editing — use whatever the `EmailCampaign` struct actually exposes.

- [x] **Step 4: Verify**

Run: `cargo check --all-features` then
`PATH="/opt/homebrew/opt/libpq/bin:$PATH" DATABASE_URL=postgres://postgres:postgres@localhost:55432/hotel_dstest cargo test --all-features --test admin_communications_api --test segment_targeting`
Expected: clean compile; suites green.

- [x] **Step 5: Commit**

```bash
git add hotel-app-be/src/modules/communications/
git commit -m "fix(comms): resume campaigns abandoned mid-expansion"
```

---

### Task 3: Return real retry-after from the two boolean `check()` callers

`guest_portal/routes.rs:526` and `:556` call `guest_portal_token_ip.check(ip)` and return a hardcoded `900` as `Retry-After` — the configured window, not the remaining seconds. `check_with_retry` returns the real bound.

**Files:**
- Modify: `hotel-app-be/src/modules/guest_portal/routes.rs:526-533` and `:556-563`

- [x] **Step 1: Swap both call sites**

At each site, replace:

```rust
    if !limiters.guest_portal_token_ip.check(ip).await {
        return Err(ApiError::TooManyRequestsRetryAfter(
            "Too many requests. Please try again later.".to_string(),
            900,
        ));
    }
```

with:

```rust
    let (allowed, retry_after) = limiters.guest_portal_token_ip.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!("Too many requests. Please try again in {retry_after} seconds."),
            retry_after,
        ));
    }
```

- [x] **Step 2: Verify**

Run: `cargo check --all-features` then `DATABASE_URL=... cargo test --all-features --test guest_portal_postgres`
Expected: clean compile; suite green (no test asserts on the literal 900 — grep first if unsure).

- [x] **Step 3: Commit**

```bash
git add hotel-app-be/src/modules/guest_portal/routes.rs
git commit -m "fix(guest-portal): return real retry-after from token-ip limiter"
```

---

### Task 4: UNLISTEN before returning a dead listener's connection

`PgListener`'s connection goes back to the pool still holding its `LISTEN` registrations (sqlx doesn't clear session state). Reconnect cycles accumulate dead registrations on pooled conns — benign (notifications are discarded during query use) but trivially avoidable.

**Files:**
- Modify: `hotel-app-be/src/core/cache_bus.rs` (the `Ok(Err(_))` and probe-fail `break` paths ~:60-75)

- [x] **Step 1: UNLISTEN before both break paths**

In the listener loop, before each `break`, release the registrations:

```rust
                                Ok(Err(_)) => {
                                    let _ = listener.execute("UNLISTEN *").await;
                                    break;
                                }
```

and in the probe-fail arm, before `log::warn!` + `break`:

```rust
                                    if !alive {
                                        let _ = listener.execute("UNLISTEN *").await;
                                        log::warn!(
                                            "cache listener connection dead; reconnecting"
                                        );
                                        break;
                                    }
```

(If the connection is already dead the `UNLISTEN` fails harmlessly — `let _ =`.)

- [x] **Step 2: Verify**

Run: `cargo check --all-features`
Expected: clean compile.

- [x] **Step 3: Commit**

```bash
git add hotel-app-be/src/core/cache_bus.rs
git commit -m "fix(cache-bus): UNLISTEN before returning dead listener connections"
```

---

### Task 5: Final verification + docs touch-up

- [x] **Step 1: Full gate**

```bash
cd hotel-app-be
cargo check --all-features
cargo clippy --all-features -- -D warnings
PATH="/opt/homebrew/opt/libpq/bin:$PATH" DATABASE_URL=postgres://postgres:postgres@localhost:55432/hotel_dstest cargo test --all-features
```

Expected: clean; full suite green.

- [x] **Step 2: Format check on touched files only**

`rustfmt --edition 2024 --check` each modified `.rs` file; fix only those.

- [x] **Step 3: Update the plan checklist + report**

Mark all boxes `[x]` in this file as tasks land; report items intentionally skipped:

- LISTEN-state cosmetic issue — resolved by Task 4.
- Advisory-keyspace collision with `hashtextextended` xact-lock users — noted in `leader.rs` comment; probability ~6/2⁶⁴ per hashed key, no action.
- `tcp_keepalive` — sqlx 0.9 has no such option; client-side timeouts in `leader.rs`/`cache_bus.rs` bound detection instead.
- CLAUDE.md's "1,317" no-DB run-count example — illustrative figure, not a gate.
