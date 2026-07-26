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

- Wrong: treating "compiles under --all-features + clippy clean" as sufficient for new runtime SQL strings; trusting column names from a mapping report instead of the DDL.

## 2026-07-10b — room_events / room_history: tables referenced by SQL that were never migrated at all
- Trigger: live 500 on PATCH /api/housekeeping/tasks/{id}, diagnosed from
  hotel-app-be/logs/backend-*.log: "current transaction is aborted, commands
  ignored until end of transaction block". Root query was `INSERT INTO
  room_events` inside a `let _ = sqlx::query(...)` in
  src/services/rooms.rs:216 — the error was swallowed, but Postgres had
  already poisoned the transaction, so the NEXT statement (audit_logs insert)
  failed instead and that unswallowed error is what surfaced as the 500.
  Grepping confirmed `room_events` had ZERO CREATE TABLE in schema.sql or
  src/repositories/rooms_queries.rs (INSERT/SELECT). Follow-up grep found the
  hit "no such table: room_history" on every check-in/check-out.
- Wrong: assuming a table exists because repository code queries it. Also:
  `let _ = sqlx::query(...)` inside a Postgres transaction is not a safe way
  to make a write "best-effort" — a failed statement aborts the whole
  transaction regardless of whether Rust looks at the Result, so the failure
  just resurfaces on the next statement with a confusing unrelated error.
  columns matched against the actual RoomEvent/RoomHistory struct field types
  in src/models/room.rs (e.g. scheduled_date is TIMESTAMPTZ/DateTime<Utc>,
  not DATE). Verified by: applying schema.sql to live Postgres, replaying all
  exact INSERT+SELECT shapes the Rust queries use, and re-running the exact
  failing multi-statement transaction directly in psql to confirm it no
  longer aborts. `cargo check` passed on both feature sets throughout —
  compile success never caught any of this.
- Rule: when a 500 traces to "transaction is aborted" or "relation/no such
  table by name before assuming it's a data problem — if the CREATE TABLE
  doesn't exist in one or both, that's the bug, not a stale-migration issue
  (contrast with the ota_reference case). Never trust `let _ =` around a
  `sqlx::query` inside a transaction as "safe to ignore" — in Postgres it
  isn't; either propagate the error or wrap the statement in a SAVEPOINT.


## 2026-07-10 — TypeScript 7 blocked by Bun: side-by-side TS6 bridge is not expressible
- Trigger: chore/ts7-upgrade branch. typescript@7.0.2 (native) passed typecheck (1.6s)/test/build/build:tauri, but lint hard-crashed — @typescript-eslint/typescript-estree needs the TS JS API, which TS 7.0 does not ship (returns in 7.1; typescript-eslint supports `>=4.8.4 <6.1.0`)
- Wrong: assumed Microsoft's recommended @typescript/typescript6 side-by-side bridge could be wired up under bun. Attempt 1: nested `"overrides"` → `warn: Bun currently does not support nested "overrides"`. Attempt 2: alias flip (`typescript` → npm:@typescript/typescript6, `typescript-native` → npm:typescript@~7.0) → bun re-resolved the bare name `typescript` inside the second alias through the FIRST alias, installing the compat package under both names and leaving `.bin/tsc` a dangling symlink
- Right: hold at typescript@~6.0 (all gates green; 6.0-clean code compiles identically under 7.0 by design). Adopt 7 when typescript-eslint ships TS 7.1 API support — no config tricks needed then
- Rule: bun does not support nested overrides and mis-resolves self-referential `npm:` aliases (both verified 2026-07-10) — do not attempt npm/pnpm override recipes under bun; after any aliased install, verify by reading the installed package's package.json `name`/`version`, not by install success. Also: TS 6.0 hard-errors on `alwaysStrict` in tsconfig (TS5107), and browser code must use `ReturnType<typeof setTimeout>` not `NodeJS.Timeout`

## 2026-07-12 — cargo check passes while test targets are broken; signature changes must run cargo test to verify
- Wrong: treating a clean cargo check (both feature sets) as proof a signature change is complete
- Right: cargo check does not compile tests/ targets; integration tests calling service functions directly break invisibly until cargo test (or cargo check --tests) runs
- Rule: after changing ANY pub fn signature in hotel-app-be, grep hotel-app-be/tests/ for the fn name AND run cargo test (or at minimum cargo check --tests) before claiming done — cargo check alone is insufficient even with all feature flags

## 2026-07-12 — booking/ledger refs described a dead two-layer architecture
- Trigger: 13-agent scan (independent verifier confirmed) found
  `.claude/refs/booking-workflow.md` and `ledger-workflow.md` still described
  business logic as living in `handlers/bookings.rs`/`handlers/ledgers.rs` at
  anchors like `create_booking_handler:537`. Re-grepping showed those handler
  files are now 264 and 129 lines of thin wrappers; the real logic moved to
  `repositories/bookings/lifecycle.rs` (4259 lines) and `repositories/ledger.rs`
  (2335 lines) at a prior refactor whose commit wasn't cross-checked against refs.
- Wrong: trusting refs written 2026-07-05 without re-verifying anchors before an
  agent used them to navigate — `create_booking_handler` was grepped at
  lifecycle.rs:1183, not bookings.rs:537 (off by >600 lines and a different file).
- Right: also found a three-layer nuance worth preserving — `services/bookings.rs`
  holds real logic (`void_booking:51`, `manual_checkin:153`, permission/ownership
  checks beyond route-level RBAC) while `services/ledgers.rs` is pure 1-line
  passthrough to `repositories::ledger`. The two domains diverged in whether the
  service layer does anything; a rewritten ref must say so explicitly rather than
  assuming symmetry between domains that look structurally similar.
- Rule: refs describing "where logic lives" rot silently when a refactor moves
  logic between layers without touching the ref (nothing forces that link). Any
  session doing a large repository-layer refactor should grep
  `.claude/refs/*.md` for the old file's name and flag stale refs in the same
  commit, not leave it for a future scan to discover. Rewrote both refs in
  this pass; every anchor re-verified via direct grep same-session, not
  reused from the scan report's claims.
  (Salvaged 2026-07-17 from the uncommitted unruffled-hellman worktree.)

## 2026-07-15 — data.sql has a self-validating bootstrap transaction; adding a system permission/route/action touches ~6 lists, not 1
- Trigger: Phase 2 of the communications build added 5 `communications:*` permissions, a `/communications` nav route, and two new actions (`compose`,`send`). Appending them after data.sql's `COMMIT` (the "obvious" idempotent spot) failed, then a cascade of DIFFERENT bootstrap-validation `RAISE EXCEPTION`s fired on each fix. Only a real `postgres:19beta1` docker apply (twice, for idempotency) surfaced them — `cargo check` compiles the SQL as an opaque `include_str!` and catches NONE of this.
- Wrong: (a) append-after-`COMMIT` — data.sql wraps lines ~14–1425 in one `BEGIN…COMMIT` with an in-txn validation DO block (~1300–1420) that `RAISE`s if any `expected_route_access_policies` row lacks a matching `route_access_policies` row, so the route MUST be inserted inside the txn. (b) Assuming ONE action allowlist — `valid_action` is defined FIVE times: an inline CHECK in the permissions CREATE TABLE + three idempotent `ALTER…DROP/ADD CONSTRAINT` re-assertions in schema.sql, PLUS a copy in data.sql, PLUS the quarantine/delete reconciliation (3 sub-copies) AND a final "invalid system-owned records remain" counter — a new action must be added to ALL of them or the DB re-apply aborts. (c) Not registering perms in `expected_system_permissions` (data.sql ~line 45) — a `DELETE FROM permissions WHERE is_system_permission AND NOT EXISTS (in expected_system_permissions)` silently removes them before the route-permission-reference validation then reports them "unknown".

- Wrong: treating the schema append as done after live-apply verification; also the legacy-import test replays the WHOLE schema file then seeds a 1..=28 ledger, so any new section containing a non-idempotent statement (ALTER TABLE ADD COLUMN) fails on replay.

## 2026-07-17 — Workflow subagents at top-tier model died on the monthly spend limit; cost-tiering fixed it
- Trigger: guest-portal review workflow, 8 agents inheriting the main-loop model (fable) all failed with "You've hit your monthly spend limit" after burning ~713k tokens with zero results returned
- Wrong: launching a wide fan-out with every agent on the session's (top-tier) model; no early abort when the first agent failed
- Right: relaunch with explicit tiers — haiku for mechanical evidence-gathering reviewers, one opus adjudicator for judgment, sonnet for targeted re-checks — completed 10/10 agents (~1.8M tokens, mostly haiku/sonnet) and the opus adjudicator caught haiku hallucinations (fabricated evidence details) while confirming 20/21 findings; a 1-call haiku "canary" agent at the workflow start makes the spend-limit failure mode cost ~nothing
- Rule: in Workflow scripts, always set model explicitly per stage (haiku=gather, opus/sonnet=judge) instead of inheriting the session model, and open with a trivial haiku canary agent that aborts the run if it returns null


## 2026-07-19 — SameSite=Strict refresh cookie bounces admins out in Safari (works in Chrome); Salim Inn WebGL landing needs fixed-bar layer promotion
- Trigger: user reported "unable to click admin console" in desktop Safari on the localhost index page, then "redirect back after direct to the admin page and fail". The index page is the static WebGL landing hotel-web-fe/salim-inn/index.html (React `/` route LandingPage.tsx does window.location.replace('/salim-inn/index.html?account=...')); its "Admin console" pill is `<a href="/admin-portal" target="_top">`.
- Two distinct bugs, both Safari-only:
  1. CLICK: the #webgl `<canvas>` (position:absolute;inset:0 inside a sticky .stage) fills the viewport from y=0, spatially under the fixed 84px .topbar. Chromium hit-tests the fixed bar on top (verified document.elementFromPoint → A#accountAction), but Safari composites the GPU-backed canvas ABOVE a plain position:fixed element regardless of z-index:40, swallowing the clicks. Fix: promote the bar to its own layer — `.topbar{-webkit-transform:translateZ(0);transform:translateZ(0);will-change:transform}` + `.brand,.top-actions{position:relative;z-index:1}`. (Also added -webkit-backdrop-filter to the 5 glass panels — unprefixed backdrop-filter is Safari 18+ only; and `.pill[hidden]{display:none}` because `.pill{display:inline-flex}` was defeating the UA [hidden] rule so admin-mode never hid "Book stay".)
  2. SESSION: after the click navigates (full page load) to /admin-portal, AuthContext re-mints the access token by POSTing /api/auth/refresh (in-memory access token + HttpOnly refresh cookie design). The refresh cookie was `SameSite=Strict; Path=/api/auth` (hotel-app-be/src/handlers/auth.rs build_refresh_cookie). Backend refresh roundtrip works via curl (200) and the same-origin fetch returns 200 in Chromium — but Safari does NOT reliably attach a Strict cookie to the fetch that fires immediately after a top-level link navigation, so refresh 401s, isAuthenticated stays false, and RootLayout.tsx:60 bounces the admin to /login (perceived as "redirect back"). Fix: SameSite::Strict → SameSite::Lax on build_refresh_cookie AND clear_refresh_cookie. Lax is sent on all same-site requests in every browser incl. Safari, still withheld from cross-site POSTs so CSRF protection on the POST refresh endpoint holds. In-memory token is lost on every full page load by design, so the landing→/admin-portal hop always depends on the cookie.
- Rule: a `SameSite=Strict` cookie that a SPA must send on the FIRST request after a top-level navigation (session-restore-on-load, refresh-token cookies) is a Safari footgun — it works in Chrome and in curl but Safari drops it, so default to `SameSite=Lax` for refresh/session cookies (Lax still blocks cross-site POST CSRF). Existing users keep the old Strict cookie until they re-login, so a cookie-attribute change requires re-login to take effect. Separately: any fixed/sticky UI over a WebGL/`<canvas>` or 3D-transformed layer must be GPU-promoted (translateZ(0)/will-change) or Safari composites the canvas on top and eats the clicks — Chromium's elementFromPoint will NOT reveal this (it hit-tests correctly); only Safari misbehaves.

## 2026-07-19b — CORRECTION: the admin-portal bounce was a half-up docker stack on :80, not SameSite
- Trigger: after the SameSite=Lax fix + re-login, user still bounced. Asking them to type localhost:3000/admin-portal was never tested — their Safari showed bare "localhost" (no port) = port 80, which `lsof` revealed is the `hotel-frontend` DOCKER container (OrbStack), while all my verification ran against the Vite dev stack on :3000.
- Wrong: attributing the bounce to Safari SameSite=Strict fetch behavior (plausible, but never reproduced — Strict refresh returned 200 in Chromium and was never isolated in Safari). Also wrong: assuming "localhost" in the user's browser meant the dev server.
- Right: the compose topology (docker-compose.yml:71-97) is Caddy (`--profile https`) → `/api` to backend, rest to frontend; the frontend nginx has NO /api route by design (verified: POST /api/auth/login on :80 → 405 text/html from the SPA fallback). Locally only the frontend container was up (backend Exited 11h, no caddy), so http://localhost could never authenticate — every full-page load's cookie refresh fails and RootLayout bounces off /admin-portal in ANY browser. The frontend image (built 2026-07-18T07:42Z, no volume mounts) also predates all of today's CSS fixes. Keep the SameSite=Lax change anyway (standard for refresh cookies; Strict on a session-restore-on-load cookie remains a documented WebKit risk — tag: unverified here).
- Rule: when a web bug "only happens in browser X", FIRST establish which server that browser is actually hitting — bare "localhost" (no port) means :80, and on this machine :80 is the docker frontend, not Vite. `lsof -iTCP:80 -sTCP:LISTEN` + `docker ps -a` before any client-side theory. A stale/half-up docker stack on :80 shadows the dev stack and produces "works in my test browser, fails in the user's" purely by port mismatch.

## 2026-07-24 — the V1 PG baseline could not install at all; hand-edits into a pg_dump file must respect its three-phase ordering
- Trigger: verifying repo baseline against the live VPS (`saliminn-db`). A fresh apply of `database/postgres/migrations/0001_v1_baseline.sql` to a scratch `postgres:19beta2` container failed at statement 1: `ERROR: there is no unique constraint matching given keys for referenced table "payments"`. Commit 9b92a8eec had appended `CREATE TABLE public.payment_receipt_requests (payment_id bigint PRIMARY KEY REFERENCES public.payments(id) …)` inline right after `CREATE TABLE public.payments`, but the file is pg_dump-shaped: table bodies first, then `ALTER TABLE … ADD CONSTRAINT … PRIMARY KEY` (payments_pkey at ~line 5764), then FKs (~line 9032). The FK referenced a PK that did not exist yet. Same commit's `seed.sql` additions then failed with `promotions_updated_by_fkey … Key (updated_by)=(1) is not present in table "users"` — the seeded admin is id **1000** (seed.sql:50), not 1.
- Wrong: treating a `.sql` baseline as append-anywhere text, and hardcoding `created_by, updated_by = 1, 1` in seed rows. Neither is caught by `cargo check --all-features`, clippy, `cargo test --test status_vocabulary` (all passed on the broken file — the baseline is an opaque `include_str!`), or `scripts/check-schema-drift.mjs` (exits 0; it is a report of known engine differences).
- Right: new tables in the PG baseline go in three places — CREATE TABLE (no inline PK/FK), `ADD CONSTRAINT …_pkey` in the constraints block, `ADD CONSTRAINT …_fkey` in the FK block. Seed rows needing an audit user must resolve it (`SELECT id FROM users WHERE username = 'admin'`), never a literal id. Also: an existing-DB patch should be written in the baseline's own expression spelling (`(status)::text = ANY (ARRAY[('x'::character varying)::text, …])`) rather than `status IN (…)` — both are semantically identical but pg_dump renders them differently, and the difference shows up forever as fake drift.
- Rule: after ANY edit to `database/postgres/migrations/0001_v1_baseline.sql`, `data.sql`, or `seed.sql`, apply all three in order to a scratch `postgres:19beta2` container (`docker run` + `psql -v ON_ERROR_STOP=1`) before claiming done — Rust compilation and the test suite cannot detect a baseline that will not install. Then `pg_dump --schema-only --no-owner --no-privileges` both the scratch DB and the target DB and diff them; that diff is the only reliable statement about drift. Remember to mirror the result into `hotel-desktop/src-tauri/database/postgres/` (it holds byte-identical copies).

## 2026-07-25 — salim-inn WebGL scene had a plan/height scale split; instanced props need matrix-level debugging
- Trigger: rebuilding hotel-web-fe/salim-inn from Google Earth footage. Buildings rendered as ~25-storey towers on a floating map.
- Wrong: the scene divided plan coordinates by `SCALE=10` (map px → units) but left heights in raw metres (`BUILDING_H=8.4`, `FLOOR_H=2.8`). Plan and height were on scales ~8x apart, so a 3-storey shophouse extruded to ~84 m. `SALIM.angle` was also used for orientation, which points the frontage 180° from `SALIM.frontNormal` — invisible while the ground was a flat map screenshot, wrong as soon as there is a modelled road to face.
- Right: 1 map px = 1 m (verified two ways: the dual carriageway measures ~22 px against a real ~22 m; the Salim row measures 71.6 x 29.4 px against a twelve-lot shophouse block). Orient from `frontNormal` via `Math.atan2(-nx, -nz)`, never from the raw rectangle angle.
- Rule: when debugging "what is that object in front of the camera", a `scene.traverse` that reads `getWorldPosition()` SILENTLY SKIPS every InstancedMesh instance — an InstancedMesh reports its group origin, so a tent 8 m from the camera looks 70 m away. Decompose per-instance matrices (`getMatrixAt(i, m)` + `setFromMatrixPosition`) or the scan is worthless. Two related gotchas in the same pass: `PlaneGeometry` faces +Z, so canvas-texture signage on a facade that faces local -Z needs `rotation.y = Math.PI` or it renders backwards into the wall; and after rotating a props group, local -Z may point at the opposite building from the one intended — check which world direction it resolves to before placing anything.

## 2026-07-25b — tracing a site plan: use the capture's own scale bar, and pin left/right from the frontage normal
- Trigger: user supplied a Google Earth top-down of the Farley block after the first rebuild, saying cafe.cafe was on the wrong side of Salim Inn, the neighbour should lean inwards, and the buildings were misplaced. All three were correct.
- Wrong: the first trace came from a Google *road map* screenshot at an unknown zoom. Blocks ended up in roughly the right relationship to each other but the wrong place relative to the two buildings that matter, and the row was modelled as one straight block when it actually bends twice.
- Right: the Google Earth capture carries a scale bar — measure it in pixels rather than estimating. Detected the rule row by scanning for a run of bright pixels (`ffmpeg -vf crop,format=gray -f rawvideo` then find the row with the widest bright span): 320.5 px for 40 m, so 0.12481 m/px. Then `drawgrid=w=200:h=200` over the capture gives a readable coordinate frame to read POI pins off directly. Frontage resolved to a 3-segment polyline, 122.8 m total, bending 26° then 43° inward.
- Rule: "left" and "right" in a user's description of a building are from the FRONTAGE view, not from image or world axes. Derive them: for frontage direction d and outward normal n = (d.z, -d.x), a viewer standing outside facing the building has their right along -d, i.e. toward DECREASING distance along the polyline. Verify it numerically by projecting both landmarks into camera NDC and comparing x — do not eyeball it from a render. Also: when a terrace bends, sweep it per-lot along the polyline with `ry = atan2(-dz, dx)` per lot; one long rotated box cannot express a dog-leg, and the interior fitted inside it has to inherit the local bearing too.

## 2026-07-26 — full-system eval: pipe-masked gate exits, a stillborn SQL-function endpoint, --all-targets-only clippy errors
- Trigger: 7-dimension evaluation sweep (32-agent workflow) + CI gate re-runs. Three independent discoveries.
- Wrong: (1) background gates written as `cargo clippy … | tail -30` and `a && b && c | tail` reported exit 0 while the gates actually FAILED — a pipeline's exit code is the LAST command's (tail's). Also `bun --cwd <dir> run <script>` silently prints usage and runs nothing; the flag belongs after `run`. (2) Assuming a routed, RBAC-gated endpoint implies its SQL objects exist: `POST /rooms/sync-statuses` called `SELECT * FROM sync_all_room_statuses()`, a function with ZERO definitions anywhere in git history (`git log -S sync_all_room_statuses --all -- "*.sql"` is empty) — the endpoint 500'd since birth, no FE caller ever existed. (3) Believing CI-green means clippy-clean: `items_after_test_module` (items appended below `mod tests` in credits.rs/audit.rs) only fires with `--all-targets`, which CI does not pass.
- Right: removed the dead endpoint chain (route/handler/service) instead of inventing sync semantics — judgment-rubrics #3 forbids guessing business policy; a task chip offers the real implementation as a user decision. Gates re-run bare (no trailing pipe) with real exit codes: clippy --all-features --all-targets clean, lib tests pass, FE typecheck/lint/260 tests pass.
- Rule: never end a verification command in a pipe — run it bare or append explicit `echo EXIT=$?` markers; extend the room_events missing-table rule to FUNCTIONS: every `SELECT … FROM some_fn()` in runtime Rust must have a matching CREATE FUNCTION in the baseline (grep it, and `git log -S <name>` to check it ever existed); after appending items to a Rust file, confirm they land above `mod tests` or clippy --all-targets breaks while CI stays green.
- Status update (2026-07-26, later session): the user chose to implement the real feature. `sync_all_room_statuses(p_user_id)` now exists in the PG baseline (mirrors the sync_room_status_with_booking trigger policy; never overrides dirty/cleaning/reserved_dirty/maintenance/out_of_order), the route/handler/service chain is reinstated with an audit_logs entry, and a "Sync statuses" button was added to HousekeepingPage (gated on rooms:update). Verified by scratch postgres:19beta2 install + live curl (found 15 rooms of genuine drift in the dev DB). The endpoint is no longer dead — do not re-remove it.

## 2026-07-26c — PG19 physical-design rewrite: dump-diff convergence is the only check that catches everything
- Trigger: full V1 baseline rewrite (68 serial→identity via SEQUENCE NAME, 4 STORED→virtual generated columns relocated to end-of-table, 7 ledger columns→timestamptz) + patches/2026-07-26-pg19-native-physical-design.sql for live DBs
- Wrong: (a) the coupling-audit subagent reported 3 explicit-id test INSERTs; a script sweep at edit time found 16 (users/room_types/rooms/guests/bookings across booking_service.rs fixtures) — grep-audit reports rot instantly, re-sweep by script when editing. (b) The patch's drop/re-add of customer_ledgers.balance_due silently lost its COMMENT ON COLUMN — nothing compiled, no test failed; ONLY the fresh-vs-patched pg_dump diff caught it.
- Right (all verified empirically on postgres:19beta2): pg_dump renders VIRTUAL generated columns with NO trailing keyword (bare `GENERATED ALWAYS AS (expr),` = virtual; STORED is always explicit). `OVERRIDING SYSTEM VALUE` is accepted on tables with no identity column, so a generic INSERT builder (data_transfer) can add it unconditionally. pg_get_serial_sequence()/setval()/`SELECT last_value FROM seq` keep working on identity sequences when SEQUENCE NAME preserves the serial-era name. pg_dump 18+ emits random `\restrict`/`\unrestrict` tokens — strip them before diffing dumps. STORED→VIRTUAL has no in-place ALTER; drop+re-add moves the column to the last attnum, so the baseline must also declare those columns last or fresh/patched schemas diverge forever.
- Rule: any baseline rewrite ships with (1) an idempotent patch for existing V1 DBs and (2) the convergence proof: scratch-install NEW trio, scratch-install OLD trio + patch, `pg_dump --schema-only --no-owner --no-privileges` both, strip `\restrict` lines, diff MUST be empty. Compile, clippy, and the full test suite all passed on a patch that was still losing a column comment — only the dump diff saw it.

## 2026-07-26d — adversarial opus review caught what every green gate missed: panicking Row::get decodes and a silent-money deployment gap
- Trigger: post-implementation review (fresh opus agent) of the pg19 rewrite returned FAIL with 3 blockers after check/clippy/full tests/live API probes were ALL green.
- Wrong: (a) the tier-3 coupling audit scoped models/+repositories/ledger.rs and missed repositories/analytics.rs:2354,2415 where `Row::get::<NaiveDateTime>` (get, not try_get → unwrap → panic) reads customer_ledgers/customer_ledger_payments.created_at — zero tests cover those report paths, so the suite proved nothing there. (b) Rust `.and_utc()` on a parsed naive noon stored 12:00Z while the patch's `AT TIME ZONE` conversion stored 04:00Z for the same logical date — two instants for one business date. (c) On an UNPATCHED database the row_mappers `.ok()`/default fallbacks turn the decode failure into epoch dates and a un-zeroed voided-ledger balance — silent wrong money, not an error.
- Right: decode timestamptz as DateTime<Utc> everywhere sqlx touches it (grep the TABLE names across ALL of src/, not the module you think owns them); make date→instant conversion happen in SQL (`$n + INTERVAL '12 hours'` on a date param) so the session (hotel) timezone interprets it identically to the patch; add a startup schema guard (information_schema data_type probe → process::exit) so a schema-generation mismatch is loud everywhere (VPS, desktop, dev) instead of silently degrading.
- Rule: any change that retypes columns decoded by sqlx MUST (1) grep the whole backend for the table names (not the domain module) hunting `NaiveDateTime`/`Row::get`, and (2) ship a startup guard that refuses schema generations older than the code — mapper fallbacks make type mismatches SILENT, so "the app boots and tests pass" proves nothing about unpatched deployments. Budget an adversarial fresh-context review for every money/schema change; this one paid for itself.

## 2026-07-26e — pg reactivation test flaked on rerun: trigger-written room_status_change_log FK-pins fixture rooms
- Trigger: postgres_concurrent_reactivation_allows_only_one_success passed on a fresh DB, panicked on rerun (duplicate key room_types_code_key) — reproduced on scratch postgres:19beta2
- Wrong: cleanup_pg_fixture deleted rooms/room_types with `.ok()` but never room_status_change_log; reactivation's UPDATE bookings fires trg_sync_room_status_booking → update_room_status() → INSERT INTO room_status_change_log (FK room_id, NO cascade), so DELETE FROM rooms silently failed every run and the leftovers collided with the reseed. The sibling postgres_creation_tests cleanup already deleted that table — divergence between sibling fixtures was the tell.
- Right: cleanup deletes room_status_change_log by room_id before rooms (room_history cascades, so it needs no delete), AND fixed-id seeds are ON CONFLICT DO UPDATE resets so the pre-test state ('voided' booking, 'available' room) is guaranteed even when a delete is FK-blocked. Verified: fresh-DB double run, polluted-DB double run, and a pinned-rows double run (payments + housekeeping_tasks rows deliberately blocking the deletes) all pass.
- Rule: any PG test that mutates bookings.status or rooms.status writes room_status_change_log via trigger — its cleanup must delete those rows explicitly; and fixed-id fixtures against a persistent DB must upsert-reset state, never plain-INSERT behind a best-effort `.ok()` delete.

## 2026-07-26f — FE hotel-timezone date rendering: bare localStorage is unusable in vitest; helpers must handle BOTH schema generations
- Trigger: FE fix for the ledger timestamptz change (business dates now render in the hotel timezone via new utils/date.ts helpers reading hotelSettings 'timezone', fallback Asia/Kuala_Lumpur). New date.test.ts failed 8/8 with `localStorage` undefined DESPITE vitest.config.ts `environment: 'jsdom'` (Node 26's global localStorage getter yields undefined; jsdom env does not fix the bare global here).
- Wrong: assuming environment:'jsdom' provides a working bare `localStorage` global in this repo's vitest setup; also nearly treated "Z-suffixed instants" as the only wire shape while the LOCAL dev hotel-db was still `timestamp without time zone` (pre-patch — the 2026-07-26 patch had not been applied to it as of this session, so the new backend's schema guard blocks full-stack dev verification until it is).
- Right: every repo test touching localStorage stubs it (`vi.stubGlobal('localStorage', …)` or Object.defineProperty — see currency/notificationStore/dashboardUtils tests); production code paths that read it must guard (getHotelSettings' try/catch makes utils/date.ts safe in non-DOM runtimes). The date helpers branch on wire shape: date-only and zone-less naive strings pass through literally (pre-patch backends keep exact old behavior), only zone-carrying strings/Date instants get Intl timeZone conversion — verified with real dev-DB rows under TZ=America/New_York, UTC, and Asia/Kuala_Lumpur (KL output unchanged).
- Rule: in hotel-web-fe tests, never touch bare `localStorage` — stub it via vi.stubGlobal like the existing tests; and any FE formatter for backend timestamps must detect zone info per value (date-only / naive / zoned) rather than assume one shape, because patched and unpatched deployments coexist during a schema-generation rollout.

## 2026-07-26g — Edit "success" on this volume can silently revert; only an independent reviewer caught it
- Trigger: tauri.conf.json resources edit reported success, cargo/clippy passed, then the SSD flaked ("Working directory was deleted" mid-session); an adversarial opus review of the diff found the file back at its pre-edit content (git clean, no patches entry) while sibling edits made in the same window survived
- Wrong: trusting the Edit tool's success result as proof of persistence on "/Volumes/APPLE EXTERNAL SSD /"; also my re-check grep used a paraphrase of the written text (missed a backtick) and false-alarmed a second file as lost
- Right: after any volume flake event (EACCES, cwd-deleted), re-verify every recent Write/Edit by grepping for an EXACT substring of the new content, and confirm via `git status` that the file shows as modified
- Rule: on this volume, treat a cwd-deleted/EACCES flake as a checkpoint — grep-verify all edits from the preceding minutes before building on them; and never skip the independent review for schema/packaging changes, it is what caught the silent revert

## 2026-07-26h — desktop pgsql provisioning fail-soft shipped a wrong-version tree for 9 days; version truth lives in postgres.rs constants
- Trigger: build-setup audit found src-tauri/pgsql/ contains PostgreSQL 18.4 (manifest: provisioned 2026-07-05 from Homebrew postgresql@18) while postgres.rs has required 19beta2 since 2026-07-17 (commit 78926f898); ensure_postgres_running hard-fails VersionDetectionFailed on mismatch, so every desktop package built since then was dead on arrival — desktop-prepare.mjs downgraded the provisioning failure to a warning because pgsql/ existed, and CI's desktop job (placeholder resources, cargo check only) can never see it
- Wrong: warn-and-continue on provisioning failure whenever a pgsql/ tree exists, regardless of whether that tree matches the required build; assuming brew can supply the pin (Homebrew core has no postgresql@19 formula — betas are not shipped)
- Right: provision-pgsql.mjs now exits 2 when the existing tree is CONFIRMED wrong (version/build mismatch, inconsistent or missing binaries, mismatched manifest) vs 1 when merely unverifiable; desktop-prepare hard-fails on 2. Getting 19beta2 on macOS requires a source build (or POSTGRES_PREFIX to one) — brew cannot provide it
- Rule: a bundled-runtime version requirement in code (CONFIGURED_POSTGRES_* in postgres.rs) must be enforced by the packaging path, not just at app runtime; any "keep going with the existing artifact" fallback needs to distinguish unverifiable-but-plausible from confirmed-wrong — after changing a required bundled version, re-run `bun run provision:pgsql` and check the manifest before trusting any build

## 2026-07-26i — Tauri CSP silently kills inline <script> blocks that survive the Vite build
- Trigger: audit adjudicator verified tauri.conf.json csp `script-src 'self'` (no inline, no nonce for srcless scripts — tauri-utils 2.8.1 html.rs only nonces script[src^='http']) against dist/: the salim-inn account-pill inline block and the root index.html guest-branding inline block both ship INLINE through vite build, so in the packaged webview neither runs — a signed-in desktop admin never sees the "Admin console" pill on the landing page (LandingPage.tsx redirects / there unconditionally)
- Wrong: assuming a script that works in browser dev/prod works in the desktop webview; browser serving has no CSP header here, so nothing ever flagged it
- Right: externalized both blocks (salim-inn/account-actions.js as a module entry-adjacent script; public/guest-branding.js as a classic head script keeping pre-paint timing). Also noted: csp img-src 'self' blocks the landing page's remote room photos in the packaged app (left for a vendoring decision)
- Rule: any inline <script> (or style beyond 'unsafe-inline') in HTML that the desktop webview loads is dead code under the packaged CSP — externalize scripts to files; when adding markup with scripts, grep tauri.conf.json csp and test against the PACKAGED app, not the dev server
