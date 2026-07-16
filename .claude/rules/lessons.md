# Lessons Log

Append-only log of corrections and escalations. Format and triggers are defined
in `maintenance.md`. Newest at the bottom. Consolidate at >30 entries / >300 lines.

## 2026-07-05 — CLAUDE.md claimed desktop mode uses wildcard CORS
- Trigger: subagent scan of hotel-desktop/src-tauri/src/commands.rs:113-116
- Wrong: CLAUDE.md said `ALLOWED_ORIGINS=*` is "used by desktop mode"
- Right: desktop mode sets a specific origin list (`tauri://localhost,...`); the
  wildcard path exists in the backend but desktop does not use it today
- Rule: treat CLAUDE.md environment claims as hints, not facts — verify against
  the code (grep the env var name) before repeating them to the user

## 2026-07-05 — External volume Write can fail transiently
- Trigger: Write tool returned `EACCES: permission denied, mkdir '/Volumes/APPLE EXTERNAL SSD '` on a path that had just worked
- Wrong: n/a (first occurrence)
- Right: retrying the identical Write succeeded immediately
- Rule: on EACCES writing under "/Volumes/APPLE EXTERNAL SSD /", retry once before
  changing approach; if it persists, fall back to Bash heredoc with quoted paths

## 2026-07-05 — Write tool refuses to overwrite unread files; .claude/rules/ is auto-loaded
- Trigger: `Write CLAUDE.md` failed with "File has not been read yet" after a session restart
- Wrong: assumed having the file content in context (via system reminder) counts as having read it
- Right: the Write tool requires an actual Read call on an existing file in the same
  session before overwriting; a short `limit` Read is enough. Separately observed:
  this harness auto-loads every `.claude/rules/*.md` as project instructions each session.
- Rule: before overwriting any existing file, Read it first (limit 10 is fine).
  Treat `.claude/rules/*.md` as ALWAYS-LOADED context — keep them lean; put
  on-demand content in `.claude/refs/` instead

## 2026-07-05 — Parallel agents shipped a producer/consumer mismatch
- Trigger: provision-pgsql.mjs (agent 1) bundled only the 6 binaries the OLD code
  invoked; agent 2 concurrently added pg_restore usage, and pg_dump (backups) was
  missed too — both agents' self-verification passed; only the commander's final
  cross-diff review caught it (runtime would fail with BinaryNotFound)
- Wrong: each agent verified its own artifact in isolation; the bin list was
  derived from the existing tree instead of from the consuming code
- Right: derive the required-binaries list by grepping `pgsql_bin.join` callers in
  postgres.rs; after parallel delegations, the commander must explicitly check
  producer artifacts against consumer code (what is provided vs what is invoked)
- Rule: when two subagents build artifacts where one consumes the other's output,
  always run a final cross-check that greps the consumer for everything the
  producer must supply — self-verification of each half is not sufficient

## 2026-07-06 — Token-storage migration: hidden session-minting path + stale plan facts
- Trigger: P0 token-storage fix (localStorage → in-memory access token + HttpOnly
  refresh cookie). `grep AuthResponse` found src/services/passkey.rs:314 also builds
  a session (passkey login), not just password login in handlers/auth.rs.
- Wrong: (a) plan said CORS List branch needed `.allow_credentials(true)` added —
  it was ALREADY present at routes/mod.rs:112. (b) Scoping only the password login
  path would have left passkey login putting refresh_token in the JSON body.
- Right: any handler returning AuthResponse/RefreshTokenResponse mints a session and
  must set the cookie — grep the RESPONSE type, not just the endpoint named in the
  spec. `Secure` cookies are accepted by browsers over http://localhost (dev proxy
  works, no cookieDomainRewrite needed since the Vite proxy is same-origin).
- Rule: for any auth-transport change, grep for every construction site of the
  session-response struct (here AuthResponse) and treat each as an entry point;
  verify plan claims about existing code (CORS flags, config) against the file
  before repeating them — they may already be done.

## 2026-07-06 — SameSite=Strict cookie migration silently breaks the Tauri desktop build
- Trigger: independent second-opinion review of the P0 cookie migration (fresh
  general-purpose agent + commander read-through), required by
  judgment-rubrics.md rubric #1 for auth-touching changes.
- Wrong: the implementing (opus) agent verified the refresh-cookie flow with a
  curl cookie-jar sequence against the plain HTTP server and declared it done.
  That test can't catch cross-origin cookie behavior because curl doesn't
  enforce SameSite/origin semantics the way a browser/webview does.
- Right: `hotel-desktop`'s Tauri webview loads the frontend from
  `tauri://localhost` (macOS/Linux) / `https://tauri.localhost` (Windows), but
  the backend sidecar is `http://127.0.0.1:<dynamic port>` — a different origin,
  so every request is cross-site. `SameSite=Strict` (and even `Lax`) cookies are
  never sent on cross-site fetch/XHR, only `Lax` allows top-level GET
  navigation. Since `AuthContext.tsx` calls the refresh endpoint on every app
  mount, the desktop build will never restore a session after a full restart —
  it degrades gracefully to the login screen (not a crash), but it is a real UX
  change from the previous (insecure) localStorage-persisted-across-restarts
  behavior. User decision: accepted as-is (desktop re-login on every restart is
  a reasonable trade-off for removing the XSS-exfiltration risk); no
  desktop-specific persistence path was built.
- Rule: any cookie-based auth change must be checked against EVERY origin that
  consumes the API, not just the browser-facing production/dev origin — grep
  `tauri.conf.json` / equivalent embedding configs for the actual scheme+host
  the frontend loads from, and compare against the backend's bind
  address/port. A same-process curl test cannot substitute for this; state
  explicitly in the report which origins were and weren't exercised.

## 2026-07-07 — cargo check cannot catch runtime SQL column divergence; smoke-run new SQL on SQLite
- Trigger: adversarial review + live SQLite smoke test of the new guest-portal endpoints. Three runtime-only breaks survived `cargo check/clippy --all-features` AND the implementing agent's self-verification: invoices.bill_to_guest_id (PG) vs invoices.guest_id (SQLite), payments.transaction_id (PG) vs payments.reference_number (SQLite), and a `SELECT * FROM guests` decode requiring guests.is_active which exists in NEITHER checked-in schema (pre-existing drift; live DBs have it from a manual ALTER).
- Wrong: treating "compiles under --all-features + clippy clean" as sufficient for new runtime SQL strings; trusting column names from a mapping report instead of the DDL.
- Right: for any new SQL, verify every column against BOTH database/schema.sql and database/sqlite_schema.sql (grep the CREATE TABLE), and run the endpoint once against a scratch SQLite DB (resources auto-run at startup; seed via sqlite3, auth via a hand-inserted session row). The smoke test found in minutes what static review missed.
- Rule: new runtime SQL is not "done" until each referenced column is confirmed in both DDLs; when feasible, curl the new endpoint against a scratch SQLite server before claiming complete. Never decode full model structs (`SELECT *`) in new code — select explicit columns.

## 2026-07-10b — room_events / room_history: tables referenced by SQL that were never migrated at all
- Trigger: live 500 on PATCH /api/housekeeping/tasks/{id}, diagnosed from
  hotel-app-be/logs/backend-*.log: "current transaction is aborted, commands
  ignored until end of transaction block". Root query was `INSERT INTO
  room_events` inside a `let _ = sqlx::query(...)` in
  src/services/rooms.rs:216 — the error was swallowed, but Postgres had
  already poisoned the transaction, so the NEXT statement (audit_logs insert)
  failed instead and that unswallowed error is what surfaced as the 500.
  Grepping confirmed `room_events` had ZERO CREATE TABLE in schema.sql or
  the then-current SQLite migrations (now consolidated in sqlite_schema.sql) despite being fully wired in
  src/repositories/rooms_queries.rs (INSERT/SELECT). Follow-up grep found the
  same pattern for `room_history`: it exists in schema.sql but SQLite only
  ever got a differently-shaped `room_status_history` table — SQLite builds
  hit "no such table: room_history" on every check-in/check-out.
- Wrong: assuming a table exists because repository code queries it. Also:
  `let _ = sqlx::query(...)` inside a Postgres transaction is not a safe way
  to make a write "best-effort" — a failed statement aborts the whole
  transaction regardless of whether Rust looks at the Result, so the failure
  just resurfaces on the next statement with a confusing unrelated error.
- Right: added `room_events` (schema.sql + SQLite schema section 17) and
  `room_history` (SQLite schema section 18, schema.sql already had it) with
  columns matched against the actual RoomEvent/RoomHistory struct field types
  in src/models/room.rs (e.g. scheduled_date is TIMESTAMPTZ/DateTime<Utc>,
  not DATE). Verified by: applying schema.sql to live Postgres, replaying all
  the 18 then-current SQLite sections in order against a scratch `sqlite3` DB, running the
  exact INSERT+SELECT shapes the Rust queries use, and re-running the exact
  failing multi-statement transaction directly in psql to confirm it no
  longer aborts. `cargo check` passed on both feature sets throughout —
  compile success never caught any of this.
- Rule: when a 500 traces to "transaction is aborted" or "relation/no such
  table X does not exist", grep schema.sql AND sqlite_schema.sql for the
  table by name before assuming it's a data problem — if the CREATE TABLE
  doesn't exist in one or both, that's the bug, not a stale-migration issue
  (contrast with the ota_reference case). Never trust `let _ =` around a
  `sqlx::query` inside a transaction as "safe to ignore" — in Postgres it
  isn't; either propagate the error or wrap the statement in a SAVEPOINT.

## 2026-07-10 — cargo check --all-features does NOT cover the sqlite-only build
- Trigger: maintenance-module delegation hit 6 compile errors in src/repositories/data_transfer.rs under `--features sqlite --no-default-features` (`= ANY($1)` slice binds, introduced in commit 0ef5435b) even though `cargo check --all-features` and clippy were clean on that same code
- Wrong: treating "--all-features compiles" as proof of dual-DB compile safety; with BOTH features enabled the cfg gates resolve to the postgres branch, so sqlite-only code paths are never type-checked
- Right: CI's backend-sqlite job builds `--features sqlite --no-default-features`; the sqlite-only build is a distinct compile target. Fix pattern for array filters: cfg-gated `= ANY($n)` (postgres) vs dynamically built `IN ($1, $2, ...)` with per-element binds (sqlite) — precedent in src/repositories/audit.rs:368-383 ($N placeholders are valid SQLite syntax)
- Rule: before claiming done on any backend SQL change, run BOTH `cargo check --all-features` AND `cargo check --features sqlite --no-default-features` — the first alone cannot catch sqlite-only breaks

## 2026-07-10 — TypeScript 7 blocked by Bun: side-by-side TS6 bridge is not expressible
- Trigger: chore/ts7-upgrade branch. typescript@7.0.2 (native) passed typecheck (1.6s)/test/build/build:tauri, but lint hard-crashed — @typescript-eslint/typescript-estree needs the TS JS API, which TS 7.0 does not ship (returns in 7.1; typescript-eslint supports `>=4.8.4 <6.1.0`)
- Wrong: assumed Microsoft's recommended @typescript/typescript6 side-by-side bridge could be wired up under bun. Attempt 1: nested `"overrides"` → `warn: Bun currently does not support nested "overrides"`. Attempt 2: alias flip (`typescript` → npm:@typescript/typescript6, `typescript-native` → npm:typescript@~7.0) → bun re-resolved the bare name `typescript` inside the second alias through the FIRST alias, installing the compat package under both names and leaving `.bin/tsc` a dangling symlink
- Right: hold at typescript@~6.0 (all gates green; 6.0-clean code compiles identically under 7.0 by design). Adopt 7 when typescript-eslint ships TS 7.1 API support — no config tricks needed then
- Rule: bun does not support nested overrides and mis-resolves self-referential `npm:` aliases (both verified 2026-07-10) — do not attempt npm/pnpm override recipes under bun; after any aliased install, verify by reading the installed package's package.json `name`/`version`, not by install success. Also: TS 6.0 hard-errors on `alwaysStrict` in tsconfig (TS5107), and browser code must use `ReturnType<typeof setTimeout>` not `NodeJS.Timeout`

## 2026-07-12 — cargo check passes while test targets are broken; signature changes must run cargo test to verify
- Trigger: plumbing user_id through services/payments.rs + services/ledgers.rs signatures; cargo check --all-features AND --features sqlite --no-default-features both exited 0, but cargo test failed with E0061 arity errors in tests/deposit_refund_revert.rs and tests/payment_record.rs which call those service fns directly
- Wrong: treating a clean cargo check (both feature sets) as proof a signature change is complete
- Right: cargo check does not compile tests/ targets; integration tests calling service functions directly break invisibly until cargo test (or cargo check --tests) runs
- Rule: after changing ANY pub fn signature in hotel-app-be, grep hotel-app-be/tests/ for the fn name AND run cargo test (or at minimum cargo check --tests) before claiming done — cargo check alone is insufficient even with all feature flags

## 2026-07-15 — data.sql has a self-validating bootstrap transaction; adding a system permission/route/action touches ~6 lists, not 1
- Trigger: Phase 2 of the communications build added 5 `communications:*` permissions, a `/communications` nav route, and two new actions (`compose`,`send`). Appending them after data.sql's `COMMIT` (the "obvious" idempotent spot) failed, then a cascade of DIFFERENT bootstrap-validation `RAISE EXCEPTION`s fired on each fix. Only a real `postgres:19beta1` docker apply (twice, for idempotency) surfaced them — `cargo check` compiles the SQL as an opaque `include_str!` and catches NONE of this.
- Wrong: (a) append-after-`COMMIT` — data.sql wraps lines ~14–1425 in one `BEGIN…COMMIT` with an in-txn validation DO block (~1300–1420) that `RAISE`s if any `expected_route_access_policies` row lacks a matching `route_access_policies` row, so the route MUST be inserted inside the txn. (b) Assuming ONE action allowlist — `valid_action` is defined FIVE times: an inline CHECK in the permissions CREATE TABLE + three idempotent `ALTER…DROP/ADD CONSTRAINT` re-assertions in schema.sql, PLUS a copy in data.sql, PLUS the quarantine/delete reconciliation (3 sub-copies) AND a final "invalid system-owned records remain" counter — a new action must be added to ALL of them or the DB re-apply aborts. (c) Not registering perms in `expected_system_permissions` (data.sql ~line 45) — a `DELETE FROM permissions WHERE is_system_permission AND NOT EXISTS (in expected_system_permissions)` silently removes them before the route-permission-reference validation then reports them "unknown".
- Right: to add a system permission+route+action in data.sql: (1) add perm rows to the in-txn `INSERT INTO permissions … VALUES` list (the blanket `admin/super_admin` grant covers them); (2) add the route INSERT inside the txn next to the sibling routes; (3) add the route_id to `expected_route_access_policies`; (4) add each perm name to `expected_system_permissions`; (5) if introducing a NEW action verb, add it to EVERY `valid_action`/action-allowlist copy in BOTH schema.sql and data.sql. Verify by applying schema.sql+data.sql to a scratch `postgres:19` container TWICE (idempotency) and to a scratch sqlite3 DB — SQLite has NO `valid_action` CHECK and NO reconciliation, and its lightweight seed defines only the `admin` role (no `super_admin`), so grant counts legitimately differ from Postgres.
- Rule: never trust `cargo check` for schema/seed SQL changes — apply to a real PG (`postgres:19beta1` image is present locally; the schema.sql guard needs major ≥19) and a scratch sqlite3, each TWICE for idempotency, and use a TCP readiness gate not `pg_isready` (the postgres image's bootstrap phase answers on the socket before the real server is up). Shell is zsh: it does NOT word-split unquoted command vars — put multi-step DB checks in a `bash` script with functions, not inline `$VAR "arg"`.

## 2026-07-15 — adding a SQLite @migration section breaks three hardcoded tests in core/db.rs
- Trigger: communications build added `-- @migration 29` to sqlite_schema.sql; `cargo test --lib` (sqlite) failed 3 tests in src/core/db.rs::sqlite_resource_tests that assert the version list is exactly 1..=28 and count 28.
- Wrong: treating the schema append as done after live-apply verification; also the legacy-import test replays the WHOLE schema file then seeds a 1..=28 ledger, so any new section containing a non-idempotent statement (ALTER TABLE ADD COLUMN) fails on replay.
- Right: after adding `@migration N`, update core/db.rs tests: the 1..=N version-list assert, the applied-count assert, AND rebuild the legacy-import fixture from sections ≤ the old max (filter `sqlite_schema_sections`) so newer sections apply on adoption instead of replaying.
- Rule: any sqlite_schema.sql `@migration` addition MUST be followed by `cargo test --lib --features sqlite --no-default-features` and updating the three sqlite_resource_tests expectations — grep `1..=` and `applied_versions,` in src/core/db.rs.
