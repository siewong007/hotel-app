# Lessons Log

Corrections and escalations, grouped by failure mode. This file is auto-loaded every
session — keep it lean. Append under the matching theme; add a theme only when nothing
fits. Format and triggers: `.claude/refs/maintenance.md`. Reconsolidate at >20 themes.

Consolidated 2026-08-02 from 66 dated entries (531 lines); original at
`.claude/backups/lessons.md.2026-08-02.bak`. Three-D/map-capture lessons moved on-demand
to `.claude/refs/webgl-scene-tracing.md`. No conflicts open: two former entries were
corrections to earlier ones, folded into themes 3 and 6.

---

## 1. This working tree is shared — attribute before you act

Multiple sessions have run in this tree at once and committed each other's work. Files
have reverted to byte-exact HEAD mid-session, a commit returned exit 0 and an echoed hash
but left no reflog entry, and `git status` has gone clean because another session's
commit absorbed 154 files including this session's.

- At the start of any sweep: `ps aux | grep "[c]argo\|[c]laude"` and `git status --short`. Any path already dirty or untracked belongs to someone else — never delete "dead code" from an untracked module, and never edit an already-dirty file without diffing it hunk by hunk first.
- Attribute every gate failure to a FILE before believing it: `grep -E "^\s+-->" clippy.txt | sort -u` and compare against what you touched. A failed `Edit` on text you just read means the file moved under you — re-read, don't force.
- `git diff --cached --stat` before committing is a snapshot, not a lock; another session can stage between the check and the commit (observed within one shell invocation). When `git status` shows another session's files, build the commit with plumbing against a temp index: `GIT_INDEX_FILE=<tmp> git read-tree <parent>; git update-index --cacheinfo …; git commit-tree; git update-ref`. Commit the blob you actually TESTED, not the working-tree file.
- After any commit that matters, verify persistence separately: `git cat-file -t <sha>`, `git merge-base --is-ancestor <sha> HEAD`, and the sha present in both `reflog` and `log`. If one is missing, check the working tree first — the content is usually still there and a plain re-commit fixes it.
- Use `git worktree add <scratch> HEAD --detach` for verification when the tree is mid-edit by someone else. Authoring tests in a shared tree compiles them against another session's uncommitted structs, which then fail `E0063` in a clean checkout.

**The working tree is also not what is deployed.**
A security audit called an unauthenticated `PATCH /api/bookings/{id}/pre-checkin` fixed
because grep found nothing in `routes/bookings.rs` — but that grep read a working tree
carrying an uncommitted deletion, and production deploys from `master`, where the route
was still live. An uncommitted fix is indistinguishable from no fix.

**Rule:** for any claim about what is deployed, read `git show <deployed-ref>:<path>` and
get the ref from the deploy workflow's trigger. Verify every "already fixed" claim with
`git log --all -S "<symbol>" -- <path>` before downgrading a finding.

## 2. Verification commands lie — in this shell especially

Every one of these produced a green-looking result from a command that never ran or never
could fail:

- **Pipes eat exit codes.** `cargo clippy … | tail -30` reports tail's status. Never end a verification command in a pipe: run it bare, or `cmd > file 2>&1; echo "EXIT=$?"`.
- **`${PIPESTATUS[0]}` is empty in zsh** (it is `$pipestatus`), and an empty `EXIT=` reads as success.
- **A failed glob aborts the command in zsh.** Output containing "no matches found" means the command DID NOT RUN; its exit marker is meaningless. Use `grep -r --include="*.ext"`.
- **zsh does not word-split unquoted `$var`.** `for t in "--test foo"; do cargo test $t; done` passes one argument containing a space; cargo errors before running. A bare `EXIT=1` with no test output or compiler error means the invocation was malformed.
- **`bun --cwd <dir> run <script>`** silently prints usage and runs nothing; the flag belongs after `run`.
- **`cargo fmt -- <path>` formats the WHOLE crate.** Everything after `--` is passed to rustfmt as an *option*, not a file filter; cargo still enumerates every target. One such call reformatted 54 unrelated files in this tree — including a test file another session had open — and the noise is not whitespace-only (rustfmt reorders imports and rewraps signatures, so `git diff -w` still shows it). To format one file: `rustfmt --edition 2024 <path>`. If it has already happened, revert by exclusion (`git diff --name-only | grep -v <your files> | tr '\n' '\0' | xargs -0 git checkout --`) and never `checkout` a path that was dirty before you started.
- **A check that cannot fail is worse than no check.** "Zero `Skipping` lines in the output" was proposed here as proof tests ran — but libtest captures stderr for passing tests, so a fully-skipped run prints zero such lines and exits 0. Before trusting any "grep the output for X" assertion, confirm X would actually appear on the failure path.
- **Never identify a CI/deploy run by workflow name plus recency.** `gh run list --json name` + `.[0]` returns the PREVIOUS deploy, so the watcher reports success one second after a push. Filter on the full `headSha` you pushed.
- **Never accept a subagent's verdict on a gate it ran.** A haiku gate agent reported "10 ignored tests passed, remove the `#[ignore]`s"; re-running by hand gave exit 101 with 0 passed. Re-run the load-bearing command yourself when the conclusion decides whether to ship.

### Green gates prove less than they look like they prove

- **`cargo test --all-features` exits 0 with every money test skipped.** 15 of the 19 files in `tests/` gate on `DATABASE_URL` and return early (count verified 2026-08-02; it grows). Export it and assert the RUN COUNT (~513 passed / 10 ignored is real; ~209 is lib-only). An exit code is not evidence here.
- **`cargo check` does not compile `tests/`.** After changing any `pub fn` signature, run `cargo test` or at least `cargo check --tests`.
- **`clippy --all-targets` is NOT a superset of plain clippy.** `main.rs` re-declares every module rather than using the lib, so the crate compiles twice and `dead_code` applies in full to the bin copy. Adding targets adds *uses*, which SILENCES the lint — a test calling a handler hides it. CI runs `cargo clippy --all-features -- -D warnings` with no `--all-targets`. Run BOTH; they catch disjoint things (`--all-targets` finds `items_after_test_module`, plain finds bin-target `dead_code`). Copy CI's command string character for character.
- Corollary for dead-code sweeps: a `dead_code` warning is evidence about the BIN only. Before deleting, grep `tests/` for the QUALIFIED form (`BookingRepository::method`, `use hotel_app_be::`) — un-qualified name greps collide on `check`, `create`, `limit`, `room_number`. If a test owns it, keep it with `#[allow(dead_code)] // used by tests/<file>.rs`.
- The SQL baseline is an opaque `include_str!`: compilation, clippy, and the full suite all pass on a baseline that cannot install.

## 3. Schema changes: know who applies the file

- **Only the patch catalog is applied; loose SQL is still dead.** A `0002_*.sql` written to a plan's "forward-only migration" convention was inert because CI, deploy, `sync-desktop-resources.mjs`, and `postgres.rs` all hardcoded `0001_v1_baseline.sql`. *Superseded 2026-08-21:* `database/postgres/patches/` now exists and IS applied — by `apply-patches.sh` (`make db-patch`, deploy) and `src-tauri/src/postgres/patches.rs` (desktop). The underlying rule is unchanged: nothing discovers files. A patch runs only if it has a row in `patches/manifest.tsv` with a matching `sha256:` checksum and a contiguous version. Before writing any schema change, `grep -rn "<filename>" .github/workflows hotel-desktop/scripts hotel-desktop/src-tauri/src hotel-app-be/database`; if nobody reads it, the SQL is dead however correct it is. Shipped versions/checksums are immutable — `_begin.sql` aborts on a mismatch, so ship a new version, never an edit.
- Additive changes go into the baseline (fresh installs) PLUS an idempotent patch (live databases). New columns must be declared LAST in their `CREATE TABLE` — `ALTER TABLE ADD COLUMN` lands at the last attnum, so any other placement makes fresh and patched schemas diverge forever. New indexes go in the index section in pg_dump NAME order.
- **The baseline is pg_dump-shaped: table bodies, then PKs, then FKs.** An inline `REFERENCES` added next to its `CREATE TABLE` fails at statement 1 (`no unique constraint matching given keys`). Write new tables in three places.
- **Convergence proof, required:** scratch-install the new trio; scratch-install old trio + patch; `pg_dump --schema-only --no-owner --no-privileges` both; strip pg_dump 18+'s random `\restrict`/`\unrestrict` lines; the diff MUST be empty. Check the dumps are non-trivial first (line count + grep the new object in BOTH) — two failed dumps also diff to zero. This is the only check that caught a dropped `COMMENT ON COLUMN`. Mirror the result into `hotel-desktop/src-tauri/database/postgres/` (byte-identical copies).
- **Objects referenced by runtime SQL must exist in the baseline.** `room_events`, `room_history`, and `two_factor_challenges` were queried by shipped code with zero `CREATE TABLE` anywhere; `sync_all_room_statuses()` had zero definitions in all of git history and its endpoint 500'd since birth. Extend this to FUNCTIONS: grep every `FROM some_fn()` for a matching `CREATE FUNCTION`, and `git log -S <name>` to check it ever existed.
- **Bootstrap data:** a table read with `fetch_one` and never written by any handler is bootstrap data. The loyalty tiers/rules rows were lost in the SQLite removal, so a fresh install had a dead loyalty module while the dev DB kept working. Grep `seed.sql` for it, and `git log -S "INSERT INTO <table>" -- "*.sql"` for a version dropped in a past migration. When seeded ids are compared with `<=`/`>=` in Rust, insert one statement per row in rank order — a set-based `VALUES` insert does not preserve order.
- **`seed.sql` is one self-validating transaction** (~lines 14–1425) with an in-transaction DO block that RAISEs on missing expected records; appending after `COMMIT` fails. Adding a system permission/route/action touches ~6 lists, and `valid_action` is defined five times. **Correction to an earlier lesson: seed.sql does not DELETE obsolete system permissions — it copies them to `app.invalid_data_quarantine` and leaves them in place.** `expected_system_permissions` is a must-exist checklist only. Before deleting any `permissions` row, check both `ON DELETE CASCADE` FKs (`role_permissions`, `user_permissions`) — deleting drops per-role AND per-user grant history.
- Write patches in the baseline's own expression spelling (`(status)::text = ANY (ARRAY[…])`, not `status IN (…)`) or the difference shows up forever as fake drift. Seed rows needing an audit user must resolve it (`SELECT id FROM users WHERE username='admin'`), never a literal id — the seeded admin is 1000, not 1.
- Legacy schemas are unsupported: export data and rebuild from the current baseline rather than mutating in place.

## 4. sqlx type mismatches are runtime-only, and they travel in packs

This codebase uses plain `sqlx::query()`, not the checking macros, so a Rust-type/column-type
mismatch compiles cleanly and fails in production. Found four separate times:

- `NaiveDateTime` against a `DATE` column broke invoice generation AND payment recording for 4 days.
- `Option<Vec<String>>` against `jsonb` made rate-plan creation fail on *every* call regardless of input — the Option-ness looks like it should matter and doesn't.
- `array_to_json` (a SQLite-era shim) bound a JSON string against `users.two_factor_recovery_codes text[]`, breaking 2FA enable, recovery-code regeneration, and the recovery-code disable branch.
- `Row::get::<NaiveDateTime>` (get, not try_get) in `repositories/analytics.rs` panicked on timestamptz columns the coupling audit had scoped out.

**Rules:** when fixing one, grep the **column names** across all of `src/` — not the struct
name, not the module you think owns the domain. Any new `FromRow` over date/timestamp/
numeric/array columns needs one live-PostgreSQL test that actually fetches it. Never trust
a String/f64 double-fallback around a `numeric` column: sqlx decodes numeric as
`Decimal`-or-nothing, so `.unwrap_or_else(|_| "0")` after two failed attempts is "always
zero, silently". Any change retyping decoded columns must ship a startup schema guard —
mapper `.ok()` fallbacks turn a mismatch into epoch dates and wrong balances instead of an
error, so "it boots and tests pass" proves nothing about unpatched deployments.

## 5. Rust name resolution and silent-SQL traps

- **A file-local `fn` silently shadows an imported one of the same name.** `repositories/rate.rs` defined a private `row_to_room_type` that won over the correct `models::row_mappers` version for every unqualified call in that file — no ambiguity error, Rust prefers the local item. Room-type prices decoded as 0 everywhere. Grep `fn row_to_<type>` repo-wide, not just the domain module. (Note `rooms_queries.rs:74` has its own copy that is CORRECT — a duplicate, not a bug.)
- **Count placeholders against `.bind()` calls** after moving or writing raw SQL. A `room_history` INSERT declared 6 columns / `$1..$6` with 5 binds; check, clippy, and 200+ tests all passed.
- **A validation guard must precede any unconditional push to the collection it counts.** `if updates.len() < 2` after unconditionally pushing `updated_by`/`updated_at` can never fire, so an empty update returned 200 instead of 400. Both sibling repositories already used `is_empty()` before their pushes — grep siblings before designing a fix.
- **`let _ = sqlx::query(...)` inside a Postgres transaction is not "best effort".** A failed statement aborts the whole transaction; the error resurfaces on the NEXT statement as a confusing unrelated failure. Use a SAVEPOINT or propagate.
- **Never alias a computed column to an existing column's name.** `AS payment_date` shadowed the real user-supplied `customer_ledger_payments.payment_date`, hiding recording-date vs business-date entirely.
- **Check for INSERT-only derivation triggers before wiring a column into an UPDATE.** `customer_ledgers.net_amount` is written by a `BEFORE INSERT` trigger with `IF NEW.net_amount IS NULL`, so it silently desynced on every amount edit. And a derived SET clause must never reference a column the same statement assigns — SQL evaluates every SET expression against the OLD row. Emit each input as its own `$N` (changed) or a bare column name (unchanged).
- For an N-args → param-struct refactor, destructure (`let Struct { a, b, .. } = values;`) as the first line and leave the body byte-identical: the bind chain cannot drift and a missed field is a compile error. Machine-diff every call site against its HEAD version; tests pass regardless of which argument landed in which field.

## 6. Test fixtures against one shared, persistent database

- **`cargo` runs test fns in one binary concurrently.** Two scenarios sharing fixture id `920_010` produced "state I just wrote reads as unwritten" (login reads the user row twice, so a concurrent reset landed between the reads). Grep the whole file for EVERY fixed id you intend to use — including actor ids, which are easy to miss — and grep `tests/` repo-wide PER TABLE for cross-file collisions.
- **Cascade is per-FK, never per-table.** `room_history.room_id` cascades from `rooms`; `room_history.changed_by` → `users` does NOT. Deleting a fixture ACTOR is FK-pinned by rows the status triggers wrote behind the test's back. Before deleting a fixture user, list its inbound FKs (`grep -E "REFERENCES public.users\(id\)" 0001_v1_baseline.sql | grep -v "ON DELETE"` — 38 today) and delete what the test can populate. Functions scoped to a whole table (`sync_all_*`, night audit) write rows for NON-fixture ids, so cleanup must key on the actor, not `room_id`.
- Any test mutating `bookings.status` or `rooms.status` writes `room_status_change_log` via trigger; its cleanup must delete those rows. Fixed-id fixtures must upsert-reset state rather than plain-INSERT behind a best-effort `.ok()` delete, or a blocked delete leaves stale state.
- **A crashed run poisons the DB** for every later run. When the full suite fails mid-session, first check whether the failing file is untracked/new (`git status --short <file>`) — a never-green brand-new test is a concurrent session's WIP, not your regression. Skip it by name and verify the rest.
- **Never run two vitest suites concurrently in this tree.** Overlapping runs starve the 5s timeout: one measured run went 9 failures → 46 failures across untouched domains, with import phase 145s vs 4.9s quiet. Timeout-heavy failures in tracked, green-committed tests are load flakes until reproduced on a quiet machine (quiet rerun: 776/776).

## 7. Characterization tests must assert CORRECT values

Three self-verifying sonnet agents wrote a money test net; a fresh opus reviewer told to
REFUTE found 12 issues, two money-critical — one test blessed an unbounded deposit refund
on a booking with zero deposit, another pinned a reversal row that doubles reported
billings and invents collected cash.

**Rules:** a test that pins a bug passes forever. Where behavior is wrong, write the
correct assertion and `#[ignore]` it naming the pending fix — then verify DIRECTIONALITY
by running `-- --ignored` and reading each failure message (it must fail at its intended
assertion, not at fixture setup). Prove any regression test is non-vacuous by reverting
the fix (`git apply -R`) and confirming it goes red at your assertion. Clean up fixtures
BEFORE any assertion that can panic. Never let the agent that wrote a test certify it, and
never use haiku for a ship/no-ship judgement.

## 8. Delegate by cost tier, and verify producer against consumer

- A 8-agent fan-out inheriting the session's top-tier model burned ~713k tokens and died on the monthly spend limit with zero results. Re-run with explicit per-stage tiers (haiku to gather, opus/sonnet to judge) it completed 10/10 — and the opus adjudicator caught haiku fabricating evidence details. Always set `model` explicitly per stage and open with a trivial haiku canary that aborts the run if it returns null.
- When two agents build artifacts where one consumes the other's, self-verification of each half is not sufficient: derive the requirement from the CONSUMING code (grep its call sites) and cross-check at the end. A provisioning script bundled only the binaries the old code invoked while another agent concurrently added `pg_restore`.
- Before implementing any tracker/backlog line, grep-verify its factual claim. In one sweep 11 of ~25 items were already done, and a P0 claim ("13 payments handlers lack `check_permission`") was false — implementing it would have produced duplicate guards.

## 9. Refs and docs rot silently; verify anchors before use

`booking-workflow.md` and `ledger-workflow.md` described logic in handler files a refactor
had reduced to thin wrappers — anchors off by 600+ lines, in a different file. Nothing
links a ref to the code it describes.

**Rules:** treat CLAUDE.md/refs environment and architecture claims as hints, not facts —
grep before repeating them (a documented wildcard-CORS claim about desktop mode was wrong;
a plan's claim that CORS needed `allow_credentials` was already done). Any session doing a
large repository-layer refactor greps `.claude/refs/*.md` for the old file's name and fixes
stale refs in the same commit. Never trust a lessons.md claim about what a SQL bootstrap
file does without re-grepping the statement it names.

## 10. Auth transport changes: grep the response type, check every origin

- Any handler returning `AuthResponse`/`RefreshTokenResponse` mints a session and must set the cookie — grep the RESPONSE TYPE, not the endpoint named in the spec. Passkey login (`services/passkey.rs`) builds one too, and scoping a fix to the password path would have left it leaking the refresh token in the JSON body.
- A cookie change must be checked against EVERY origin consuming the API. The Tauri webview loads from `tauri://localhost` while the sidecar is `http://127.0.0.1:<port>` — a different origin, so `SameSite=Strict`/`Lax` cookies are never sent and desktop cannot restore a session after restart (accepted by the user as the price of removing the XSS risk). A curl cookie-jar test cannot catch this; state which origins were and weren't exercised.
- Default to `SameSite=Lax` for refresh/session cookies: Strict is a documented WebKit risk for a cookie the SPA must send on the first request after a top-level navigation. Existing users keep the old cookie until they re-login.
- `Secure` cookies are accepted over `http://localhost`, so the same-origin Vite proxy works in dev with no `cookieDomainRewrite`.

## 11. "Only happens in browser X" — check which server that browser is hitting

A bounce off `/admin-portal` was blamed on Safari SameSite behavior. The user's bare
`localhost` (no port) meant :80 — on this machine the **docker frontend container**, a
stale half-up stack with the backend exited and no Caddy, so no browser could
authenticate. All verification had run against Vite on :3000.

**Rule:** `lsof -iTCP:80 -sTCP:LISTEN` + `docker ps -a` before any client-side theory.
(One genuinely Safari-specific trap does exist — GPU-promoting fixed UI over a canvas;
see `.claude/refs/webgl-scene-tracing.md`.)

## 12. Desktop packaging: version truth lives in code, and the CSP is real

- A bundled-runtime version required by `postgres.rs` constants must be enforced by the PACKAGING path, not just at app runtime — a warn-and-continue provisioning fallback shipped a wrong-version tree for 9 days. Distinguish "confirmed wrong" (exit 2, hard-fail) from "unverifiable" (exit 1).
- Bundled binaries must not retain absolute build-machine paths. `provision-pgsql.mjs` now copies external dylibs in-tree, rewrites refs to `@loader_path`-relative, re-points absolute symlinks, codesigns each touched file, and asserts zero external refs. Proof is: rename the source prefix away, run the full initdb/start/CREATE EXTENSION/pg_dump cycle from the bundle, rename back. (`DYLD_PRINT_LIBRARIES` does not reach the postmaster through `pg_ctl` — SIP strips `DYLD_*`; run `bin/postgres` directly.)
- **Any inline `<script>` is dead code under the packaged CSP** (`script-src 'self'`, and Tauri only nonces `script[src^='http']`). Two inline blocks shipped through `vite build` and silently never ran in the desktop webview. Browser serving sends no CSP header, so nothing ever flagged it — test against the PACKAGED app.
- A desktop DB that starts cleanly is NOT schema-current. Validate schema-critical objects before launching the sidecar.
- Windows: any `spawnSync(cmd, args, {shell:true})` with a path argument must quote it (a user directory with a space breaks it). "Rolldown failed to resolve import X" is a stale `node_modules` signal, not a config problem.
- For npm/crate paired ecosystems (tauri), pin the npm side to the crate's major.minor whenever `Cargo.lock` moves — the CLI hard-errors on drift. When a CI step builds against Homebrew libs, add flags for EVERY keg-only formula it links (icu4c, openssl@3, lz4). A workflow whose later steps have never executed fails once per step; budget dispatch iterations.
- To test a CI desktop artifact locally: sync `src-tauri/{pgsql,database}/` into `target/release/` first (the copy there can be stale), use a scratch HOME, disable the shell sandbox for the GUI (no WindowServer access otherwise), free port 5433 after checking who owns it, use ≥60s HTTP timeouts under build load, and `pg_ctl stop` the embedded PG after killing the app.

## 13. Frontend gates and tooling specifics

- `bun run typecheck` and `bun run test` are independent gates and vitest is the weaker one: it transpiles without type information, so `.at()`, `Object.groupBy`, and `findLast` pass tests and fail `tsc` (`lib: ES2020`). Run typecheck after adding tests.
- Never touch bare `localStorage` in tests — stub it via `vi.stubGlobal` like the existing tests do; `environment: 'jsdom'` does not provide a working bare global here. Production code reading it must guard for non-DOM runtimes.
- Any FE formatter for backend timestamps must detect zone info per value (date-only / naive / zoned), because patched and unpatched deployments coexist during a schema rollout.
- `bun update <pkg>` only truly updates DIRECT dependencies — passing a transitive name silently ADDS it to `package.json` at a major version outside every parent's range. Fix transitives by deleting their `bun.lock` lines and reinstalling; check `git diff package.json` afterwards. `bun why <pkg>` shows direct vs transitive first.
- bun does not support nested `overrides` and mis-resolves self-referential `npm:` aliases — do not attempt npm/pnpm override recipes here. TypeScript is held at ~6.0 because typescript-eslint needs the TS JS API that 7.0 does not ship. TS 6.0 hard-errors on `alwaysStrict` (TS5107), and browser code needs `ReturnType<typeof setTimeout>`, not `NodeJS.Timeout`.
- When deleting a backwards-compat aliasing layer, generate the rename map by PARSING the layer, then separately grep the test tree for its name as a `vi.mock` object KEY — call-site regexes never match those, and a stale service mock fails as a wrong-value assertion, not an import error. Diff alias name vs target name; some "aliases" are renames.
- The sidebar is CODE-driven (`navigationRouteDefinitions` in `src/navigation/routeRegistry.tsx`); `route_access_policies` rows drive only the RBAC admin panel's Navigation Access section. They are not the same list.

## 14. Infrastructure: a wedged unit makes the control run lie

`caddy validate` run as root pre-created the site's access log `root:root 0600`; the
`caddy` user could not open it, so `systemctl reload` HUNG for the full 90s timeout
instead of failing. Mid-diagnosis "the known-good config also hangs" looked like a
pre-existing defect — but the unit was still in `reload-notify` from the previous hung
attempt, and every later reload queued behind it.

**Rules:** before A/B testing a reload, assert the unit is `active/running` and settled,
or the control is contaminated — read `journalctl -u <unit>` for `Reloading → Reloaded`
pairs rather than trusting one timed invocation. Bound every production probe to a SINGLE
reload with an explicit `timeout` (chaining three in one SSH call overran the tool cap,
was SIGTERMed before its restore trap ran, and left the unit cycling). A reload that
hangs rather than errors means a permission the validator holds and the service does not.

## 15. This volume

- `Write`/`Edit` can fail transiently with `EACCES` on `/Volumes/APPLE EXTERNAL SSD /`; retry once before changing approach, then fall back to a Bash heredoc with quoted paths.
- After any flake (EACCES, "working directory was deleted"), re-verify recent edits by grepping an EXACT substring of the new content and confirming `git status` shows the file modified. A paraphrased grep false-alarmed once. (Files reverting to byte-exact HEAD is at least as well explained by a concurrent session — see theme 1 — so root cause here remains unverified.)
- `cargo` has reported `Fresh` while a source file's mtime was 14 minutes newer than the newest fingerprint; `cargo clean -p hotel-app-be` restored a truthful build.
- The Write tool requires an actual `Read` on an existing file in the same session before overwriting — having the content in context via a system reminder does not count.
- `git gc`/`prune` on this volume needs a clean `fsck` first; a past corruption ate 269 objects and was recovered via bare-clone pack copy.
