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
- Right: for any new SQL, verify every column against BOTH database/schema.sql and the sqlite_migrations DDL (grep the CREATE TABLE), and run the endpoint once against a scratch SQLite DB (migrations auto-run at startup; seed via sqlite3, auth via a hand-inserted session row). The smoke test found in minutes what static review missed.
- Rule: new runtime SQL is not "done" until each referenced column is confirmed in both DDLs; when feasible, curl the new endpoint against a scratch SQLite server before claiming complete. Never decode full model structs (`SELECT *`) in new code — select explicit columns.
