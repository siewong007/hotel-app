# Plan: Completely Remove SQLite Support from hotel-app-be

Written 2026-07-08. Evidence-gathering only — no source files were modified to
produce this plan. All counts below were measured fresh in-session (commands
shown or described); none are copied from prior refs without re-verification.

Path note: repo root has a trailing space in its volume name
(`/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app`) — quote it in
every shell command.

Decision this plan executes: `.claude/refs/architecture-enhancements.md` item 3
/ `.claude/refs/letter-to-future-sessions.md` item 2 "keep-or-kill" — user has
decided **kill**. Desktop ships embedded PostgreSQL and has zero references to
the `sqlite` feature anywhere under `hotel-desktop/` (freshly re-verified this
session: `grep -ril sqlite hotel-desktop --include='*.rs' --include='*.toml'
--include='*.mjs' --include='*.json' --include='*.ts' --include='*.tsx'`,
excluding `target/`/`gen/`/`node_modules`, returns nothing).

---

## INVENTORY

All counts measured against current `master` HEAD (working tree has 3
pre-existing unrelated uncommitted changes — see RISKS).

### 1. `sql_query!` macro call sites
- **63** grep hits for `sql_query!` in `hotel-app-be/src/` (`grep -rn "sql_query!" hotel-app-be/src/ | wc -l`).
- A structural parse (Python regex over the postgres:/sqlite: arms, raw-string aware) matched **60/63** cleanly:
  - **22 sites**: arms are identical once placeholder style (`$N` vs `?N`) and `::type` casts are normalized — pure mechanical collapse.
  - **38 sites**: arms have real SQL differences beyond placeholder syntax (extra `::text` casts, JSON/decimal handling, etc.) — e.g. `hotel-app-be/src/repositories/rbac.rs:284,339,615,665`, `hotel-app-be/src/repositories/booking_channels.rs:247`, `hotel-app-be/src/repositories/guest_portal.rs:52`, `hotel-app-be/src/repositories/ekyc.rs:142,457,555`, `hotel-app-be/src/repositories/guest.rs:70,397,409,519,531,550` (partial list, 38 total). In every case the transformation is still "keep the postgres arm, drop the sqlite arm" — the divergence just means each of these 38 sites needs a human/model glance (not blind sed) to confirm the postgres arm is self-contained after the sqlite arm is deleted.
  - **3 sites unmatched by the regex**: the macro definition itself (`core/sql_compat.rs:8-23`) and its own test (`core/sql_compat.rs:197`), plus one call site with nested quoting the parser skipped — **must be located manually during Phase 2** (grep again, don't trust this figure as exhaustive).

### 2. `#[cfg(feature = "sqlite")]`-family blocks
Precise regex count across `hotel-app-be/src/` + `hotel-app-be/tests/`:
- **362** occurrences of `#[cfg(all(feature = "sqlite", not(feature = "postgres")))]` — sqlite-only items. **Action: delete the attribute AND the item it guards** (whole function/impl/const).
- **340** occurrences of the postgres-or-both gate, in two textual forms that must both be handled:
  - 174× single-line `#[cfg(any(feature = "postgres", not(feature = "sqlite")))]`
  - 166× multi-line `#[cfg(any(\n  all(feature = "postgres", not(feature = "sqlite")),\n  all(feature = "sqlite", feature = "postgres")\n))]`
  - **Action: delete only the attribute (1-4 lines), keep the item body unconditional.**
- Naive earlier grep for the exact literal `cfg(feature = "sqlite")` (no `all`/`not`) returned 0 — **this repo never uses that literal form**; all gating goes through the `all(...)`/`any(...)` combinators above. Don't search for the literal form during execution, it's a dead end.
- Per-file weight (lines mentioning "sqlite" case-insensitive, `hotel-app-be/src/`, descending) — this is the effort proxy for Phase 3:
  `repositories/rooms_queries.rs` 168, `repositories/bookings/lifecycle.rs` 157, `models/booking.rs` 66, `services/rooms.rs` 62, `models/room.rs` 51, `core/sql_compat.rs` 45, `models/payment.rs` 36, `repositories/ledger.rs` 35, `repositories/payment.rs` 34, `repositories/guest.rs` 22, `repositories/analytics.rs` 22, `models/ledger.rs` 21, `core/db.rs` 21, `repositories/bookings_queries.rs` 16, `repositories/audit.rs` 13, `repositories/rate.rs` 10, `models/rate.rs` 9, `repositories/invoice_numbers.rs` 8, `models/row_mappers.rs` 8, `repositories/company.rs` 7, then 15 more files at ≤6 each (`repositories/ekyc.rs`, `booking_list.rs`, `models/loyalty.rs`, `core/config.rs`, `channel_net_revenue.rs`, `search.rs`, `bookings/checkin_advisory.rs`, `models/rewards.rs`, `models/guest.rs`, `models/company.rs`, `services/audit.rs`, `repositories/booking.rs`, `services/bookings.rs`, `models/user.rs`, `repositories/rbac.rs`, `repositories/booking_channels.rs`, `repositories/guest_portal.rs`, `repositories/guest_portal_session.rs`).
- `rooms_queries.rs` and `bookings/lifecycle.rs` use a **different pattern** from the `sql_query!` macro: whole **duplicate function bodies**, one `#[cfg(all(feature="sqlite",...))]`-gated and one `#[cfg(any(feature="postgres",...))]`-gated, doing the same job with different SQL/row-decoding inline (confirmed: `grep -c "sql_query!" rooms_queries.rs` = 0, `lifecycle.rs` = 1). `bookings/lifecycle.rs` is 4228 lines total and is the booking state machine — treat as the highest-risk single file in this plan.

### 3. Compat helpers — keep vs collapse vs delete
Usage counts (call sites outside `core/sql_compat.rs`/`core/db.rs` definitions and their own `#[cfg(test)]` blocks):

| Helper | Location | External call sites | Verdict |
|---|---|---|---|
| `param!` | sql_compat.rs macro | 21 | Collapse: after Phase 2 rewrites call sites to literal `$N`, delete the macro. |
| `sql_query!` | sql_compat.rs macro | 63 (see #1) | Collapse: after Phase 2 rewrites call sites to plain postgres string, delete the macro. |
| `current_timestamp()` | sql_compat.rs fn → `&'static str` | **2** (`repositories/guest_portal_session.rs:114,129`, imported by name) | Collapse to a plain (non-`cfg`) fn returning `"CURRENT_TIMESTAMP"`. Do not confuse with the *different* `core::db::current_timestamp() -> String` (chrono-based, already ungated, unrelated — verified by reading `guest_portal_session.rs:19` import, which explicitly pulls the `sql_compat` one). |
| `current_date()` | sql_compat.rs fn | **1** (`guest_portal_session.rs:401`, fully qualified) | Collapse to plain fn returning `"CURRENT_DATE"`. |
| `bool_true()` | sql_compat.rs fn | **1** (`guest_portal_session.rs:400`, fully qualified) | Collapse to plain fn returning `"true"`. |
| `bool_false()`, `cast_to_text()`, `coalesce_text()`, `null_type()`, `convert_params()`, `adapt_query()` | sql_compat.rs fns | **0** | Delete outright — dead code once the `#[cfg(test)]` block exercising them is also deleted. |
| `decimal_to_db` / `opt_decimal_to_db` | core/db.rs | 95 / 30 (from initial grep; postgres-branch call sites, unchanged in behavior) | Collapse: delete the `#[cfg(all(feature="sqlite",...))]` string-conversion arm (`core/db.rs:187-190`, `:201-204`); remove the `#[cfg(any(...))]` attribute from the identity arm (`:192-198`, `:206-212`) so it's the only, unconditional impl. **Zero call-site edits needed** — signature unchanged. |
| `generate_uuid()` | core/db.rs:166-168 | many | **Already ungated** — no `#[cfg]` on it at all (returns `uuid::Uuid::now_v7().to_string()` unconditionally). Confirmed by reading the function; **do not touch**, it was never part of the dual-DB split despite being listed in the task's helper set. |
| `DbRowExt::get_decimal` / `get_opt_decimal` | core/db.rs:216-243 | trait, used wherever decimals are read from rows | Delete the sqlite-string-parsing impl (`:221-230`); un-gate the postgres impl (`:232-243`). |
| `DbPool` / `DbRow` / `DbDatabase` type aliases | core/db.rs:1-38 | pervasive | Delete sqlite branch of each; un-gate the postgres branch (drop the `#[cfg(all(feature="postgres",...))]` too — with sqlite gone there's only one branch, no cfg needed). |
| `create_pool()` | core/db.rs:41-156 | 1 definition, called at startup | Delete the sqlite arm (`:42-85`, includes `sqlx::migrate!("./database/sqlite_migrations")`); un-gate the postgres arm (`:87-155`). |

### 4. Cargo.toml
`hotel-app-be/Cargo.toml`:
```
[features]
default = ["postgres"]
sqlite = ["sqlx/sqlite"]
postgres = ["sqlx/postgres"]
```
(lines 15-18). `sqlx` dependency (line 31) declares no sqlite/postgres feature itself — the feature is toggled only via the `[features]` indirection above, so removing the table and unconditionally adding `"postgres"` to `sqlx`'s feature list is a clean, self-contained edit.

### 5. `database/sqlite_migrations/`
- **14 files** (`001_initial_schema.sql` … `014_bookings_guest_portal_columns.sql`).
- Referenced from (fresh grep, all hits): `hotel-app-be/src/core/db.rs:80` (`sqlx::migrate!`), `hotel-app-be/tests/common/mod.rs:18` (same, sqlite-only test helper), `hotel-app-be/tests/status_vocabulary.rs:5` (`include_str!` of migration 001), plus prose in `AGENTS.md:88`, `README.md:126,180`, `docs/architecture/ADRS.md:198`, and four `.claude/` files (`rules/judgment-rubrics.md:34`, `rules/00-diagnosis.md:38`, `rules/delegation-templates.md:34`, `refs/ledger-workflow.md:22`, `refs/enhancement-backlog.md:34`) plus two historical `.claude/reports/*.md` entries (leave those — they're dated logs of past work, not living docs).

### 6. `core/db.rs` + `core/sql_compat.rs`
- `core/db.rs`: 325 lines, 21 lines mention "sqlite" (see table above for exact spans).
- `core/sql_compat.rs`: 265 lines, 45 lines mention "sqlite" — this file is almost entirely dual-DB scaffolding; after Phase 2 it shrinks to ~20 lines (two trivial constant-returning functions) or can be deleted entirely if `current_timestamp`/`current_date`/`bool_true` are inlined at their 4 call sites instead of kept as functions (both options are valid; inlining removes the file, collapsing keeps it — recommend **inlining and deleting the file**, since 4 call sites is cheaper than maintaining a module for 3 trivial constants).

### 7. `.github/workflows/ci.yml` — ASK-FIRST (see below)
Every feature-flag reference, with line numbers (fresh grep against current HEAD):
- `:79` `cargo check --all-features`
- `:82` `cargo test --all-features`
- `:88` `cargo test --features postgres --no-default-features --test status_vocabulary ...`
- `:99` `cargo test --features postgres --no-default-features --test booking_service ...`
- `:102` `cargo clippy --all-features -- -D warnings`
- `:107-129` entire **`backend-sqlite`** job ("Backend — SQLite Tests"), whose only step (`:129`) is `cargo test --features sqlite --no-default-features`
- `:185` `cargo test --features postgres --no-default-features` (inside `backend-postgres-smoke` job)
- `cargo build --release` (`:105`, no flags — unaffected)

### 8. Non-code references
- `CLAUDE.md` "Dual-database contract" paragraph (architecture-essentials section) and the `.env.example`/schema bullet.
- `.claude/rules/00-diagnosis.md` Leak #2 (entire section, lines 26-43) — the checklist this plan dismantles.
- `.claude/refs/architecture-enhancements.md` item 3 (line 10) and the "Enhancement opportunities" item 3 (lines 40-41, 58).
- `.claude/refs/enhancement-backlog.md` item 9 (lines 80-83).
- `.claude/refs/letter-to-future-sessions.md` item 2 (lines 19-27) and closing note (lines 87-89).
- `.claude/refs/ledger-workflow.md:22` (one factual mention of the sqlite migration file backing a unique index — needs updating to point at `schema.sql` only).
- `.claude/rules/judgment-rubrics.md:34` — rule text literally says "Schema touched → BOTH `database/schema.sql` and `database/sqlite_migrations/` updated" — **this is rule semantics in an ask-first file.**
- `.claude/rules/delegation-templates.md:34` — template boilerplate mentioning both files — not ask-first, editable freely.
- `README.md` (root, `hotel-app-be/README.md` has none): lines 41, 69, 92 (mermaid diagram), 126, 180, 194-200 (whole "SQLite Mode" subsection), 246, 373 (repo topics/keywords line), 404, 411, 479.
- `docs/architecture/ADRS.md`: ADR 002 "Dual-Database Support" (lines 27-46) and a cross-reference at lines 198, 205.
- `docs/guides/deployment.md`: lines 338-344 ("SQLite Setup" subsection), 452-455 (backup instructions).
- `hotel-app-be/.env.example`: `DATABASE_PATH` (line 80), `DATABASE_BUSY_TIMEOUT_SECS` comment (line 56, "SQLite busy_timeout"), `DATABASE_MAX_CONNECTIONS` comment (line 46, "both PostgreSQL and SQLite").
- `.claude/launch.json` — **no sqlite entry exists** (only `backend-postgres` and `frontend` configs; checked fresh). Task inventory item asked me to find a "backend-sqlite entry" — **none found, nothing to remove here.**
- `hotel_data.db`, `hotel_data.db-wal`, `hotel_data.db-shm`, `hotel.db` under `hotel-app-be/` — all four confirmed **gitignored and untracked** (`git ls-files` returns nothing for them; `.gitignore:54,55,58,59` covers the patterns). Safe to delete locally any time, zero git/rollback impact, not part of the code-removal blast radius. Not ask-first (untracked files the agent/user can freely remove), but low priority — treat as a one-line cleanup note, not a phase.
- `hotel-desktop/src-tauri/database/schema.sql` and its `target/debug/` copy: only **comments** mention "SQLite" (e.g. `:3780` "Postgres-only. SQLite migrations are unaffected.") — no functional code. Low-priority prose cleanup, not ask-first (this is desktop's own copy of schema.sql, a build artifact context, not the canonical `hotel-app-be/database/schema.sql`).

### 9. Test files / bins
- `hotel-app-be/src/bin/`: `fix_password.rs`, `hash_password.rs` — **0 sqlite references**, confirmed empty, no action.
- `hotel-app-be/tests/`: 17 files total; **11 contain `mod sqlite_tests { ... }` blocks** to delete wholesale, plus `tests/common/mod.rs` (18 lines, sqlite-only pool helper, `#[cfg(all(feature="sqlite",...))]`-gated, to delete) and `tests/status_vocabulary.rs:5` (`include_str!` of a sqlite migration file inside what is otherwise a postgres-focused test — verify context before deleting).
  Per-file sizes (mod start line : total file lines) — proxy for review effort, largest first:
  `booking_service.rs` 75:2793 (~1200-line sqlite mod, the largest deletion in the whole plan), `loyalty_portal.rs` 6:352, `rooms_search.rs` 9:216, `ledger_filters.rs` 18:210, `payment_record.rs` 4:193, `company_ledger_idempotency.rs` 19:178, `guest_credits.rs` 5:161, `rbac_dynamic.rs` 6:142, `deposit_refund_revert.rs` 4:141, `guest_filters.rs` 5:92, `ledger_transaction_tests.rs` 4:66.
  The remaining postgres-only tests in these same files are gated `#[cfg(all(feature = "postgres", not(feature = "sqlite")))]` (e.g. `status_vocabulary.rs:70`, `booking_service.rs:18,1282,2270,2576`) and need their attribute (not body) removed in the same pass.

### Could not verify / left for execution time
- Exact byte-for-byte diff of each of the 38 "divergent" `sql_query!` sites (listed file:line above; only ~15 sample lines were printed in this pass) — the remaining ~23 were not individually read.
- Whether any `.claude/reports/*.md` (dated logs) reference `sqlite_migrations/` in a way that would go stale in a misleading way if left alone — spot-checked 2, not exhaustive; recommend leaving all `.claude/reports/*` untouched regardless (they're timestamped historical logs, not living docs, per `maintenance.md`).
- Whether `backend-postgres-smoke` job (ci.yml, starts ~line 135) has additional feature-flag lines beyond the one at `:185` — only lines 175-200 were read; the job's full step list (schema apply, idempotency re-apply, health-check loop) was not read end-to-end.

---

## PHASES

Work on branch `feat/remove-sqlite` cut from current `master` (do not rewrite history; no `--force` anything). Each phase's verification gate assumes prior phases in this list are already applied.

**Phase 0 — Branch + snapshot (S, commander does directly, no dispatch)**
`git checkout -b feat/remove-sqlite`. Note in the PR description that 3 files (`​.claude/launch.json`, `docker-compose.yml`, `hotel-app-be/docker-compose.yml`) had pre-existing uncommitted changes unrelated to this work at branch-cut time (see RISKS) — commit or stash those first so they don't get tangled into this branch's diff.

**Phase 1 — Rewrite `sql_query!`/`param!` call sites (M, sonnet with an exact spec; write a small Python/regex script rather than hand-editing 63+21 sites)**
Transformation rule: `crate::sql_query!(postgres: PG, sqlite: SQ)` → `PG` (drop the macro wrapper and the sqlite arm entirely, keep the postgres string literal as-is, including its `r#"..."#` raw-string form). `param!(N)` → literal `$N` spliced into the surrounding string (this is a compile-time `concat!`, so the replacement is textual, not a runtime call). Do this as one scripted pass across all `.rs` files under `hotel-app-be/src/`, then hand-verify the 38 "divergent" sites from Inventory #1 by reading each — the risk there isn't the mechanical transform, it's confirming the postgres arm doesn't secretly depend on something the sqlite arm was compensating for (it shouldn't, since postgres was always the "default when both enabled" arm — worth one read to be sure).
Verification gate: `cargo check --features postgres --no-default-features` (must still pass at this point since both features remain defined but sqlite is untouched code-wise) then, once Phase 5's Cargo.toml edit lands, plain `cargo check`.
Files: all 33 files from Inventory #2's per-file table that contain `sql_query!` (subset — `rooms_queries.rs` and `bookings/lifecycle.rs` mostly use the other pattern, see Phase 3).

**Phase 2 — Collapse `core/sql_compat.rs` (S, sonnet)**
After Phase 1 empties out all `sql_query!`/`param!` call sites: delete the `sql_query!` and `param!` macro definitions (`sql_compat.rs:5-44`) and their test (`:196-221`). Delete `cast_to_text`, `coalesce_text`, `bool_false`, `null_type`, `convert_params`, `adapt_query` outright (0 external callers, confirmed). Inline `current_timestamp()` → `"CURRENT_TIMESTAMP"`, `current_date()` → `"CURRENT_DATE"`, `bool_true()` → `"true"` directly at their 4 call sites in `repositories/guest_portal_session.rs` (lines 114, 129, 400, 401) and delete the whole `sql_compat.rs` file + its `mod` declaration once empty. Remove the now-dead `use crate::core::sql_compat::...` and `use crate::{sql_query, param}` imports repo-wide (grep for both after this phase to confirm zero remain).
Verification: `cargo check --all-features` (still valid pre-Phase-5) must pass; grep for `sql_compat` and `sql_query!`/`param!` returns only the deletion's own commit diff, not live code.

**Phase 3 — Un-gate/delete the 362+340 `#[cfg(...sqlite...)]` blocks (L, split by risk)**
Transformation rule per block:
- `#[cfg(all(feature = "sqlite", not(feature = "postgres")))]` directly above an item → delete the attribute line(s) *and* the entire item (fn/impl/const/mod) it guards.
- `#[cfg(any(feature = "postgres", not(feature = "sqlite")))]` or the 4-line `#[cfg(any(\n  all(...),\n  all(...)\n))]` form → delete only the attribute, leave the item body exactly as-is (now unconditional).
- **3a (M, sonnet/haiku batch with exact spec)** — low-risk data/model files with no booking/money logic: `models/row_mappers.rs`, `models/rate.rs`, `models/rewards.rs`, `models/guest.rs`, `models/company.rs`, `models/user.rs`, `models/loyalty.rs`, `repositories/rate.rs`, `repositories/company.rs`, `repositories/invoice_numbers.rs`, `repositories/booking_list.rs`, `repositories/channel_net_revenue.rs`, `repositories/search.rs`, `repositories/bookings/checkin_advisory.rs`, `repositories/ekyc.rs`, `repositories/rbac.rs`, `repositories/booking_channels.rs`, `repositories/guest_portal.rs`, `repositories/guest_portal_session.rs`, `repositories/audit.rs`, `services/audit.rs`, `services/bookings.rs`, `repositories/booking.rs`.
- **3b (L, opus — rubric #1 applies: touches SQL schema + booking state machine + money math simultaneously)** — `repositories/bookings/lifecycle.rs` (4228 lines, 157 sqlite-mention lines, booking state machine), `repositories/rooms_queries.rs` (1627 lines, 168 sqlite-mention lines, whole-duplicate-function pattern, availability logic), `repositories/ledger.rs`, `repositories/payment.rs`, `repositories/guest.rs`, `repositories/analytics.rs`, `repositories/bookings_queries.rs`, `models/booking.rs`, `models/payment.rs`, `models/ledger.rs`, `models/room.rs`, `services/rooms.rs`. Adversarial second-opinion review (fresh opus, `.claude/rules/delegation-templates.md` template 5) required before merging this sub-phase given it touches money math + the booking state machine per judgment-rubrics rule #1.
Verification per file: `cargo check --features postgres --no-default-features` after each file (fast iteration), then `cargo check --all-features` + `cargo clippy --all-features -- -D warnings` (still meaningful until Phase 5 — will report zero warnings since sqlite arms are gone, which is itself a useful signal that nothing was left half-migrated) at the end of 3a and again at the end of 3b. Full `cargo test --all-features` at the end of 3b given booking/ledger tests live there.

**Phase 4 — `core/db.rs` + `core/config.rs` (M, sonnet; opus review since this is the pool/connection layer everything depends on)**
Per the Inventory #3 table: delete `DbPool`/`DbRow`/`DbDatabase` sqlite branches, un-gate (delete attribute, keep body, drop the now-single-branch `#[cfg]` entirely — no cfg needed for a single unconditional type alias) the postgres branch of each. Delete `create_pool`'s sqlite arm (`:42-85`); un-gate its postgres arm. Delete `decimal_to_db`/`opt_decimal_to_db`/`DbRowExt` sqlite impls; un-gate the postgres impls. In `core/config.rs`: delete `database_url_from_env`'s and `default_max_connections`'s sqlite arms, un-gate the postgres arms; remove the now-dead `sqlite_path` and `busy_timeout_secs` fields from `DatabaseConfig` (confirmed: `busy_timeout_secs` is read only inside the sqlite arm of `create_pool`, never by the postgres `PgPoolOptions` path — it becomes fully dead once that arm is deleted) and their `#[allow(dead_code)]` markers; remove the `DATABASE_PATH`/`DATABASE_BUSY_TIMEOUT_SECS` env var reads.
Verification: `cargo check --all-features` (or plain `cargo check` if Phase 5 already landed) + `cargo test <substring>` for anything touching `create_pool`/config (likely none directly, but check `tests/` for config-level tests) + a live smoke: `cargo run` against a real `DATABASE_URL` and `curl 127.0.0.1:3030/health` (this is the connection-pool layer — a compile pass does not prove `after_connect`/timezone logic still runs; run it for real once).

**Phase 5 — `Cargo.toml` (S, sonnet, coordinate with Phase 9)**
Recommended end state: delete the `[features]` table entirely; add `"postgres"` directly and unconditionally to `sqlx`'s `features = [...]` list in `[dependencies]`. This means no `--features`/`--all-features`/`--no-default-features` flag is ever needed again on any `cargo` invocation — every remaining `#[cfg(feature=...)]` reference anywhere in the crate (there should be zero after Phases 1-4) becomes a compile error if missed, which is a useful safety net: run `cargo check` and grep for `cfg(feature` as a final sweep. Alternative (more conservative, smaller diff): keep a single always-on `postgres` feature as a no-op label; rejected here because it preserves flag-passing overhead in CI/docs for no benefit once sqlite is gone.
Verification: `cargo check` (bare, no flags) and `cargo clippy -- -D warnings` both pass — **this is what replaces `--all-features` as the CI gate**: with only one backend, a plain check/clippy run already covers 100% of the compiled surface, so `--all-features` becomes not just trivial but meaningless (there are no features left to combine).

**Phase 6 — Delete `database/sqlite_migrations/` — ASK USER FIRST**
14 files. Also delete `hotel-app-be/tests/common/mod.rs`'s sqlite pool helper and the `include_str!` in `tests/status_vocabulary.rs:5` once Phase 7 confirms nothing else reads the directory (final check: `grep -rn "sqlite_migrations" hotel-app-be/` returns nothing).

**Phase 7 — Test files (M, sonnet with exact spec)**
Delete each `mod sqlite_tests { ... }` block wholesale (11 files, sizes in Inventory #9 — `booking_service.rs`'s ~1200-line block is the biggest single deletion in this plan, isolate it in its own commit for reviewability). Remove (attribute only) the `#[cfg(all(feature = "postgres", not(feature = "sqlite")))]` gates on the surviving tests in the same files (`status_vocabulary.rs:70`, `booking_service.rs:18,1282,2270,2576`, and others found by a final grep). Delete `tests/common/mod.rs`'s sqlite-gated pool helper (coordinates with Phase 6).
Verification: `cargo test` (bare) passes; `cargo test --all-features` is no longer a distinct configuration to check once Phase 5 lands.

**Phase 8 — `.github/workflows/ci.yml` — ASK USER FIRST**
Delete the `backend-sqlite` job (lines 107-129) entirely. In the remaining `backend` and `backend-postgres-smoke` jobs, strip `--features postgres --no-default-features` (lines 88, 99, 185) and `--all-features` (lines 79, 82, 102) down to bare `cargo check`/`cargo test`/`cargo clippy -- -D warnings` (per Phase 5's Cargo.toml decision, these flags become no-ops or invalid once the features are gone, so this edit is required, not optional, for CI to still pass). Read the full `backend-postgres-smoke` job (not fully read in this planning pass, ~line 135-210+) before editing to catch any other feature-flag line this inventory missed.

**Phase 9 — Docs & `.claude/` refs (S/M, mixed — see ASK-FIRST section)**
Freely editable (per `maintenance.md`, not on the ask-first list): `.claude/rules/00-diagnosis.md` Leak #2 (rewrite or delete the section — the dual-DB contract it describes no longer exists), `.claude/refs/architecture-enhancements.md` item 3, `.claude/refs/enhancement-backlog.md` item 9, `.claude/refs/letter-to-future-sessions.md` item 2, `.claude/refs/ledger-workflow.md:22`, `.claude/rules/delegation-templates.md:34`, `README.md`, `docs/guides/deployment.md`, `hotel-app-be/.env.example`. For `docs/architecture/ADRS.md`: **do not delete ADR 002** — append a new superseding ADR ("ADR-00X: Remove SQLite, PostgreSQL-only") that references and supersedes it, per standard ADR practice of preserving decision history.

---

## ASK-FIRST ITEMS (per `.claude/rules/maintenance.md`)

1. **`.github/workflows/ci.yml`** (Phase 8) — explicitly named ask-first in `maintenance.md`. Delete `backend-sqlite` job + strip feature flags from 2 remaining jobs.
2. **Deleting `database/sqlite_migrations/`** (Phase 6, 14 files) — falls under maintenance.md's "Deleting any file the agent did not create this session." None of these files were created in this planning session.
3. **`.claude/rules/judgment-rubrics.md:34`** — rule #2 item 4 ("Schema touched → BOTH `database/schema.sql` and `database/sqlite_migrations/` updated") is rule *semantics* in an explicitly ask-first file; needs rewording to drop the sqlite half once Phase 6 lands.
4. **`CLAUDE.md`** structural edit — the "Dual-database contract" paragraph in Architecture essentials is a structural/semantic change requiring approval (fixing a stale path is fine per maintenance.md, but this is removing an entire contract description, not a typo fix).
6. **`AGENTS.md:88`** — references the dual-DB contract but the file is Codex-owned (maintenance.md + `.claude/refs/codex-collab.md`): do NOT edit it in this plan. Flag the stale line to the user so they (or Codex) update it.
5. **`database/schema.sql` structure** — named ask-first in maintenance.md as a blanket rule for *any* structural edit, even though this plan's schema.sql changes (if any) are additive/no-op — flagging defensively since Phase 3/4 touch code that reads it; confirm no schema.sql edits are actually needed (current read: none are — schema.sql is already postgres-only and unaffected by this removal, only `sqlite_migrations/` goes away).

Backup rule per maintenance.md: before editing items 3-4 (once approved), copy originals to `.claude/backups/<name>.<YYYY-MM-DD>.bak`.

---

## RISKS

1. **`bookings/lifecycle.rs` (4228 lines) and `rooms_queries.rs` (1627 lines) use whole-duplicate-function gating, not the `sql_query!` macro.** This is a structurally different, higher-effort pattern than the rest of the codebase — each pair of sqlite/postgres functions must be diffed to confirm the postgres version is functionally complete on its own (not silently relying on logic that only existed in the sqlite twin). This is where a booking-state or money-math regression is most likely to hide. Mitigated by routing to opus + mandatory adversarial review in Phase 3b.
2. **Pre-existing uncommitted changes in the working tree** (`.claude/launch.json`, `docker-compose.yml`, `hotel-app-be/docker-compose.yml` — confirmed via `git status`/`git diff --stat` at planning time, 8 lines changed total, not made by this planning session) will get swept into `feat/remove-sqlite`'s first commit unless deliberately stashed/committed separately first. Low content risk (small diffs) but should not be silently conflated with the sqlite removal in the PR history.
3. **`--all-features`/`--features X --no-default-features` are load-bearing in CI *and* in developer muscle memory** (README, docs/guides/deployment.md, CLAUDE.md all tell developers to run `cargo run --features sqlite --no-default-features` today). Landing Phase 5 (Cargo.toml) without Phase 8 (CI) and Phase 9 (docs) in the same PR will break CI immediately (`--features sqlite` becomes a hard error: unknown feature) and leave docs actively lying. These three phases should land together, not incrementally, even though they're listed separately above for dispatch/review granularity.
4. **The 38 "divergent" `sql_query!` sites are only spot-checked (~15 read), not all individually verified in this planning pass** — Phase 1's execution must re-open every one of the 38, not just trust that "keep the postgres arm" is always safe; a few may have PostgreSQL-specific casts that were added *because* SQLite couldn't do something, meaning the postgres arm is correct, but a few might reveal the reverse (unlikely given `sql_query!`'s own macro semantics default to postgres when both features are on, which is the current always-shipped behavior — so behaviorally nothing changes, only dead code is removed. This significantly de-risks Phase 1: the *runtime* behavior of every `sql_query!`/`param!`/`decimal_to_db`/etc. site is already 100% postgres today, since `default = ["postgres"]` and nobody builds with `--features sqlite --no-default-features` in production. Removing sqlite cannot change production behavior — it can only introduce a *transcription* error while deleting the dead arm.)
5. **Test count regression risk**: deleting ~1200+ lines of `sqlite_tests` (Phase 7) reduces the test suite's line count sharply; confirm the *scenarios* those tests covered (e.g. `payment_record.rs`'s `record_payment_uses_sqlite_payment_schema_and_recomputes_status`) have an equivalent postgres-gated test already, or file a follow-up if coverage is genuinely lost (not just duplicated).

---

## ROLLBACK

- All work on `feat/remove-sqlite`, branched from current `master` tip. No `git commit --amend`, no force-push, no history rewrite at any point.
- Land phases as separate commits (not one giant commit) so any single phase can be `git revert`-ed independently if it breaks something the others don't depend on. Suggested commit boundaries: Phase 1, Phase 2, Phase 3a, Phase 3b, Phase 4, Phase 5+8+9 together (per Risk #3), Phase 6+7 together (migrations directory and the tests that reference it are coupled).
- If Phase 3b (opus, booking/ledger files) reveals a genuine behavioral divergence between the postgres and sqlite arms that suggests the *postgres* arm has a latent bug the sqlite arm was accidentally avoiding: **stop, do not fix it inside this PR** — file it as a separate issue/task, since fixing a pre-existing postgres bug is out of scope for a "remove sqlite" change and would conflate two unrelated risks in one diff.
- Before merging to `master`: full `cargo test` (bare) green, `cargo clippy -- -D warnings` clean, frontend untouched (this plan has zero frontend files in scope — confirm with `git diff --stat` showing only `hotel-app-be/`, `.github/`, `.claude/`, `docs/`, `README.md` touched (NOT `AGENTS.md` — see ASK-FIRST item 6), nothing under `hotel-web-fe/` or `hotel-desktop/`).
