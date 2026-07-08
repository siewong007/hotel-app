# Plan: Migrate npm → Bun for hotel-web-fe and hotel-desktop

Date: 2026-07-08. Scope: `hotel-web-fe/` and `hotel-desktop/` only. `hotel-app-be/`
is Rust/cargo and out of scope. Plan only — no files modified except this one;
no install commands were run.

Path warning: this repo lives at
"/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app" (trailing space after
"SSD"). Always double-quote paths in shell commands referenced below.

---

## INVENTORY

1. **Bun installed**: yes — `/Users/goaltosuceed/.bun/bin/bun`, version `1.3.14`.
2. **Node/npm in use**: `node v26.4.0`, `npm 11.17.0` locally. CI pins
   `node-version: 22` (`.github/workflows/ci.yml:23`,
   `.github/workflows/desktop-build.yml:50`). No `engines` field, no
   `.nvmrc`/`.node-version`, no Volta config in either `package.json`
   (`hotel-web-fe/package.json`, `hotel-desktop/package.json` — grepped, no hits).
3. **npm invocation sites** (10 total):
   - `hotel-web-fe/package.json:11-21` — scripts: `start`, `start:tauri`, `test`,
     `typecheck`, `lint`, `lint:strict`, `build`, `build:web`, `build:tauri`,
     `preview`. All are plain `vite`/`vitest`/`tsc`/`eslint` invocations — no
     nested npm calls.
   - `hotel-desktop/package.json:6-23` — scripts: `tauri`, `dev`, `build`,
     `build:debug`, `build:fast`, `build:no-bundle`, `build:msi`, `build:nsis`,
     `provision:pgsql(:force)`, `sync:resources(:force)`,
     `build:frontend` (line 15: **`"npm --prefix ../hotel-web-fe run build:tauri"`**
     — the one cross-project npm call), `build:frontend:cached/:force`,
     `build:backend(:debug/:force)`, `copy:backend(:debug/:force)`,
     `desktop:prepare(:force)`.
   - `hotel-desktop/src-tauri/tauri.conf.json:7` —
     `"beforeDevCommand": "npm --prefix ../hotel-web-fe run start:tauri"`.
   - `hotel-desktop/src-tauri/tauri.conf.json:9` —
     `"beforeBuildCommand": "npm run desktop:prepare"` (runs in-place, no `--prefix`).
   - `hotel-desktop/scripts/build-frontend.mjs:21-24` — sniffs
     `process.env.npm_execpath` to build `[node, npmExecPath, 'run', 'build:tauri']`,
     falling back to `[npm|npm.cmd, 'run', 'build:tauri']`; runs via
     `spawnSync(..., { cwd: frontendRoot })` (line 57) — cwd is set by **Node's**
     child_process option, not a CLI flag, so this is safe to keep as a pattern.
   - `hotel-desktop/scripts/tauri-build.mjs:31` — only a string in an error
     message ("Run npm install in hotel-desktop first"), not an invocation.
   - `.github/workflows/ci.yml:21-40` — `setup-node@v5` (line 21-25), `npm ci`
     (28), `npm run typecheck` (31), `npm run lint` (34), `npm run test -- --run`
     (37), `npm run build` (40). **ASK-FIRST file** (see below).
   - `.github/workflows/desktop-build.yml:48-80` — `setup-node@v5` (48-51),
     `npm ci` in `hotel-web-fe` (58) and `hotel-desktop` (62), `npm run
     provision:pgsql` (72), `npm run build:no-bundle` (76) / `npm run build` (80).
     Not in the ASK-FIRST list explicitly (only `ci.yml` is named in
     `.claude/rules/maintenance.md`) but treat with the same caution since it's a
     CI workflow — flagged for confirmation in Phase 3 regardless.
   - `.github/workflows/docker.yml` — no npm/node references found (grepped, 0 hits).
   - `.claude/launch.json:12-13` — dev server config: `"cd .../hotel-web-fe &&
     npm run start"`.
   - Docs mentioning `npm run`/`npm install`/`npm ci` (counts, not line-itemized —
     Phase 4 scope): `README.md` (12), `CONTRIBUTING.md` (6), `AGENTS.md` (14,
     Codex-owned — ask before editing per CLAUDE.md), `hotel-app-be/README.md`
     (12, likely cargo-adjacent context not FE commands — verify before editing),
     `hotel-desktop/BUILD_SPEED.md` (14), `hotel-desktop/UPDATER.md` (1),
     `docs/guides/deployment.md` (13), plus incidental example commands inside
     `.claude/rules/model-dispatch.md`, `judgment-rubrics.md`,
     `delegation-templates.md`, and two `.claude/reports/*` files (historical,
     do not edit).
4. **Lockfiles**: `hotel-web-fe/package-lock.json`, `hotel-desktop/package-lock.json`.
   A third, `.ds-sync/package-lock.json`, exists but `.ds-sync/` is gitignored
   (`.gitignore:84`) tooling infra unrelated to the app — **out of scope**, not
   touched by any phase below. No `postinstall`/`prepare` lifecycle scripts in
   either in-scope `package.json` (grepped, 0 hits) — lifecycle-script migration
   risk is low, EXCEPT `hotel-desktop/package.json:26` devDependency `sharp@^0.34.5`,
   which downloads a platform-specific native binary during install (see Research #6).
5. **Dev-server assumption**: `.claude/launch.json:12-13` and CLAUDE.md's
   "Common commands" section both hardcode `npm run start`. Phase 1 changes this
   to `bun run start` (or `bun --bun run start`, see Research #7) once the local
   trial passes; Phase 4 updates the doc text.

---

## RESEARCH FINDINGS

Note on source quality: several search hits were from SEO/content-farm sites with
2026 dates (pkgpulse.com, misar.blog, buildmvpfast.com, snipshift.dev,
oneuptime.com/blog, nexgismo.com, byteiota.com, trybuildpilot.com,
dfieldsolutions.com) that read as AI-generated filler — their claims are NOT used
below except where independently corroborated by an official doc or a live GitHub
issue. Every claim below is tagged and sourced from an official doc, the
oven-sh/bun or oven-sh/setup-bun repo, vitest-dev/vitest, or v2.tauri.app.

**6. Lockfile migration** — VERIFIED
(https://bun.com/docs/pm/lockfile, https://bun.sh/docs/pm/cli/install):
`bun install` run in a directory with `package-lock.json` but no `bun.lock`
automatically migrates it: "When running `bun install` in a project without a
`bun.lock`, Bun automatically migrates existing lockfiles: `yarn.lock` (v1),
`package-lock.json` (npm), `pnpm-lock.yaml` (pnpm)." The original
`package-lock.json` is left untouched ("preserved and can be removed manually
after verification") — safe to run in parallel with npm during Phase 1 trial.
`bun.lock` is Bun's default text-based lockfile since v1.2 (human-readable,
diff-friendly). No documented caveat about `overrides` specifically for the
npm→bun path (the repo's `hotel-web-fe/package.json:38-43` `overrides` block) —
Bun's own docs confirm it supports npm's `overrides` field natively
(https://bun.com/docs/pm/lockfile "Overrides and resolutions" section), so this
should carry over, but **UNCONFIRMED** whether values migrate byte-for-byte from
an existing npm-generated `package-lock.json` — verify by diffing
`bun.lock` overrides section against `package.json` after Phase 1 install.

**7. Vite 8 (Rolldown) + vitest under Bun** — MIXED, one confirmed risk:
- Running Vite's dev/build commands via `bun run dev`/`bun run build` (i.e. Bun
  as the Node-compatible JS runtime executing Vite's own CLI) is the standard,
  documented way to use Bun with Vite — no official caveat found specific to
  Rolldown-vite (Vite 8) vs Bun as the invoking runtime. INFERRED low risk,
  verify empirically in Phase 1.
- CJS interop: Vite 8/Rolldown's own migration notes call out CJS interop as
  "the most common runtime breakage" for the Rolldown migration in general
  (`legacy.inconsistentCjsInterop: true` workaround) — this is a Rolldown-vs-Vite7
  concern, not Bun-specific, and this repo is already on Vite 8 per
  `hotel-web-fe/package.json:47` (`"vite": "^8.0.14"`), so it does not add new
  risk from the Bun migration itself. INFERRED (source was a lower-quality
  aggregator page but the underlying Rolldown CJS-interop caveat is consistent
  with Rolldown's own project docs; treat as plausible but re-verify against
  https://v7.vite.dev/guide/rolldown before relying on it further).
- `bun test` (Bun's OWN built-in test runner) is CONFIRMED NOT a drop-in
  replacement for `vitest`: closed-as-not-planned issue
  https://github.com/vitest-dev/vitest/issues/5551 — running `bun test` against
  a jsdom-environment vitest suite fails with `ReferenceError: Can't find
  variable: document` because Bun's native runner does not initialize vitest's
  configured jsdom environment; `yarn test`/`npm run test` (i.e. running vitest
  itself, not Bun's runner) work fine. **Decision: this repo's `test` script
  MUST remain `vitest run`, invoked as `bun run test` — never switch it to
  `bun test`.**
- Whether `bun run test` (Bun-as-runtime executing the real `vitest` CLI, as
  opposed to Bun's native `bun test` runner) has its own jsdom incompatibility
  distinct from the above is **UNCONFIRMED** — no direct report found either
  way in vitest-dev/vitest issues or Bun docs; the confirmed failure (#5551) is
  specifically about Bun's native runner replacing vitest, not about Bun
  executing vitest's own CLI. This repo's `hotel-web-fe/vitest.config.ts:8` sets
  `environment: 'jsdom'` — because this is the exact configuration implicated in
  the adjacent (but distinct) failure mode, **Phase 1's verification gate must
  include a real `bun run test` execution of the full existing suite**, not just
  a trust-the-docs assumption.

**8. Tauri 2 + Bun** — VERIFIED (https://v2.tauri.app/develop/,
https://v2.tauri.app/reference/config/): Tauri 2's own docs list `bun tauri dev`
alongside npm/yarn/pnpm/deno as an equivalent invocation — Bun is an officially
supported package manager for the Tauri CLI workflow, no caveats documented.
Separately VERIFIED via the config schema: `build.beforeDevCommand` and
`build.beforeBuildCommand` accept either a plain string or an object form
`{ "script": "...", "cwd": "..." }` where `cwd` sets the working directory Tauri
spawns the command in (Rust-side `cwd`, not a package-manager flag). **This is
the mechanism this plan uses to replace `--prefix`** (see Research #10 — Bun has
no reliable `--prefix` equivalent), avoiding the flag entirely:
```json
"beforeDevCommand": { "script": "bun run start:tauri", "cwd": "../hotel-web-fe" }
```

**9. CI: oven-sh/setup-bun** — VERIFIED
(https://bun.com/docs/pm/cli/install "CI/CD" section, https://github.com/oven-sh/setup-bun):
```yaml
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: latest   # or pin e.g. "1.3.14"
- run: bun install          # or `bun ci` for frozen/reproducible installs
- run: bun run build
```
`bun ci` is documented as exactly equivalent to `bun install --frozen-lockfile`:
installs exact versions from `bun.lock` and fails if `package.json` disagrees —
this is the direct replacement for `npm ci`. The action does NOT have a built-in
dependency cache input comparable to `actions/setup-node`'s `cache: npm`
(INFERRED from the action's documented inputs: `bun-version`, `no-cache`, no
`cache`/`cache-dependency-path` input found) — Phase 3 must add a manual
`actions/cache` step keyed on `bun.lock` hash if install-time caching is wanted
(currently `ci.yml:24-25` and `desktop-build.yml:51` rely on
`setup-node`'s built-in npm cache — losing this is a minor CI speed regression,
not a correctness issue).

**10. What Bun does NOT replace here** — VERIFIED by local inventory + Bun docs:
- `hotel-app-be/` (Rust/Cargo) is entirely untouched — no JS package manager
  involved.
- `hotel-desktop/scripts/*.mjs` (`build-backend-sidecar.mjs`,
  `copy-backend-sidecar.mjs`, `provision-pgsql.mjs`, `sync-desktop-resources.mjs`,
  `desktop-prepare.mjs`, `tauri-build.mjs`, `build-frontend.mjs`) are plain
  Node ESM scripts invoked via `"node scripts/x.mjs"` in `package.json` — these
  can keep running under `node` even after switching the *package manager* to
  Bun (Bun does not require you to also switch the runtime for every script);
  optionally they can be switched to run under `bun` later since Bun is
  Node-API-compatible for `fs`/`path`/`child_process`/`node:url` (all used in
  `build-frontend.mjs:1-4`) — treat this as an optional Phase 2 stretch item, not
  required for the migration to be complete.
- The Rust/Cargo-driven Tauri sidecar build and embedded-PostgreSQL provisioning
  (`postgres.rs`, `provision-pgsql.mjs` shelling to `brew`/binary downloads) are
  unaffected — no npm involvement found there (grepped, 0 hits of "npm" in
  `provision-pgsql.mjs`).
- `--prefix` has no direct Bun equivalent for `bun run`: feature request
  https://github.com/oven-sh/bun/issues/15135 is still OPEN (opened
  2024-11-13, unresolved as of this research). Bun does have a top-level
  `bun --cwd <dir> run <script>`, but this is UNSAFE for anything that itself
  calls `process.cwd()` to resolve files (which Vite does, to find
  `vite.config.ts` and project root): CONFIRMED open bugs
  https://github.com/oven-sh/bun/issues/8167 ("bun run --cwd flag doesn't
  change process.cwd() return value") and
  https://github.com/oven-sh/bun/issues/6386 (same symptom, nested script case).
  **Decision: do not use `bun --cwd` or `bun run --cwd` anywhere in this
  migration.** Use real subshell `cd` (package.json scripts) or Tauri's
  object-form `cwd` config (Research #8) instead — both sidestep the bug because
  they set the OS-level/Node-level working directory before Bun ever computes
  its own `process.cwd()`.

---

## PHASES

### Phase 1 — Local dev trial (hotel-web-fe only) — Effort: S

Keep `package-lock.json` in git; do not touch CI yet.

1. `cd "hotel-web-fe" && bun install` — auto-migrates `package-lock.json` →
   `bun.lock` (Research #6). Do not delete `package-lock.json` yet.
2. Update `hotel-web-fe/package.json` scripts to keep the exact same script
   *names* and bodies (no npm-specific syntax exists in them — `vite`,
   `vitest run`, `tsc --noEmit`, `eslint . --quiet` all run identically under
   `bun run <name>`). No edits needed to the scripts themselves.
3. Update `.claude/launch.json:12-13` `"frontend"` config: `npm run start` →
   `bun run start`.
4. **Verification gate (must all pass before Phase 1 is done):**
   - `bun run typecheck` exits 0.
   - `bun run lint` exits 0.
   - `bun run test` exits 0 — run the FULL existing suite and confirm the same
     pass count as `npm run test` gave; this is the empirical check for the
     UNCONFIRMED jsdom-under-Bun risk (Research #7). If any jsdom-dependent test
     fails only under `bun run test`, STOP — do not proceed past Phase 1; this
     would be a genuine blocker requiring either `happy-dom` migration or
     keeping `npm`/`node` for the test step specifically (a hybrid outcome is
     acceptable and should be reported to the user as a taste/tradeoff decision
     per judgment-rubrics.md rubric #5, not silently patched around).
   - `bun run build` exits 0 and produces the same `dist/` shape as `npm run build`.
   - `bun run start` serves on :3000 and the app loads (manual or Preview-tool check).
5. Rollback: `git checkout -- hotel-web-fe/package.json .claude/launch.json`,
   `rm hotel-web-fe/bun.lock`, keep using `npm`. No other files touched, so
   rollback is a two-file revert.

### Phase 2 — hotel-desktop scripts + Tauri wiring — Effort: M

Depends on Phase 1 passing.

1. `cd "hotel-desktop" && bun install` — migrates `hotel-desktop/package-lock.json`
   → `bun.lock`. Verify `sharp` (native binary devDependency,
   `hotel-desktop/package.json:26`) installs correctly — Bun's docs state it
   special-cases `sharp`'s postinstall automatically (Research #4/#6); confirm
   by checking `node_modules/sharp` resolves and `bun run build:no-bundle`
   (which uses `sharp` for icon generation, if applicable — verify via grep)
   still succeeds.
2. `hotel-desktop/src-tauri/tauri.conf.json:7,9` — replace the two npm command
   strings with Tauri's object form (Research #8/#10), NOT `bun --cwd`:
   ```json
   "beforeDevCommand": { "script": "bun run start:tauri", "cwd": "../hotel-web-fe" },
   "beforeBuildCommand": "bun run desktop:prepare"
   ```
   (`beforeBuildCommand` needs no `cwd` object — it already runs in-place per
   the current plain-string form at line 9.)
3. `hotel-desktop/package.json:15` — `build:frontend` script: replace
   `"npm --prefix ../hotel-web-fe run build:tauri"` with a real subshell `cd`
   (portable form used elsewhere is fine, but note Windows CI runners exist —
   `desktop-build.yml` only runs on `macos-14`, so a `sh`-style `cd &&` is
   acceptable here; if Windows CI is ever added, use a small `.mjs` wrapper
   instead): `"cd ../hotel-web-fe && bun run build:tauri"`.
4. `hotel-desktop/scripts/build-frontend.mjs:21-24` — simplify away the
   `npm_execpath` sniffing (it existed only to locate the right npm binary
   cross-platform); replace with a direct `['bun', 'run', 'build:tauri']` and
   keep the existing `spawnSync(..., { cwd: frontendRoot })` (line 57 — this
   already uses Node's own cwd option, not a CLI flag, so it is unaffected by
   the `bun --cwd` bug and needs no other change). Also update line 31 of
   `tauri-build.mjs` (error-message text only: "Run npm install" → "Run bun
   install").
5. **Verification gate:**
   - `bun run desktop:prepare` (or `:force`) exits 0 and produces the same
     `dist/` + sidecar artifacts as before.
   - `bun run dev` (i.e. `tauri dev` with the new `beforeDevCommand`) launches
     the webview, backend sidecar comes up, and the FE dev server is reached at
     the configured `devUrl` (`tauri.conf.json:8`, `http://127.0.0.1:3000`) —
     drive this with the `run`/Preview skill rather than trusting compilation.
   - `bun run build:no-bundle` exits 0 and the resulting binary launches.
6. Rollback: revert `tauri.conf.json`, `hotel-desktop/package.json`,
   `build-frontend.mjs`, `tauri-build.mjs`; `rm hotel-desktop/bun.lock`.

### Phase 3 — CI — Effort: M — **ASK-FIRST**

`.github/workflows/ci.yml` changes require explicit user approval per
`.claude/rules/maintenance.md` ("Files that require ASKING THE USER first").
`.github/workflows/desktop-build.yml` is not literally named in that list but
modifies the same class of file (workflow semantics) — get the same approval
before touching it, per judgment-rubrics.md rubric #3 ("changing
`.github/workflows/ci.yml` semantics" is explicitly a stop-and-ask trigger, and
this is the same risk class).

Proposed diff (do not apply without approval):
1. `ci.yml:21-25` — replace `actions/setup-node@v5` + `cache: npm` block with:
   ```yaml
   - uses: oven-sh/setup-bun@v2
     with:
       bun-version: "1.3.14"   # pin to the version validated in Phase 1/2
   ```
   Add a manual cache step (Research #9 — setup-bun has no built-in dependency
   cache):
   ```yaml
   - uses: actions/cache@v4
     with:
       path: ~/.bun/install/cache
       key: bun-${{ hashFiles('hotel-web-fe/bun.lock') }}
   ```
2. `ci.yml:28` `npm ci` → `bun ci` (Research #9 — exact `--frozen-lockfile` equivalent).
3. `ci.yml:31,34,37,40` — `npm run X` → `bun run X` (mechanical, scripts unchanged).
4. `desktop-build.yml:48-51,58,62,72,76,80` — same `setup-node`→`setup-bun`
   swap, `npm ci`→`bun ci` (once per project dir, lines 58/62), `npm run
   X`→`bun run X`.
5. **Verification gate:** push to a branch (not master) and confirm both
   workflows go green before merging; specifically confirm `bun ci` fails loudly
   if `bun.lock` and `package.json` disagree (test by deliberately editing one
   in a throwaway branch) so the "frozen lockfile" CI guarantee is real, not
   just assumed.
6. Rollback: revert the two workflow files (git revert of that specific commit);
   no lockfile changes are involved in this phase (bun.lock is already committed
   from Phase 1/2).

### Phase 4 — Docs / launch.json cleanup — Effort: S

Depends on Phases 1-3 all landed (do not update docs to describe a state that
isn't true yet).

1. `CLAUDE.md` "Common commands" section (`npm run start`, `npm run
   typecheck && npm run lint && npm run test`, `npm run build`,
   `npm run dev`, etc.) — this is a structural change to CLAUDE.md and per
   `.claude/rules/maintenance.md` needs user approval for anything beyond a
   line-anchor/factual fix; command-name changes across the whole "Common
   commands" block are more than a one-line fix, so treat as ASK-FIRST too, or
   at minimum flag it explicitly in the same PR for visibility even if not
   strictly "structural."
2. `README.md`, `CONTRIBUTING.md`, `hotel-desktop/BUILD_SPEED.md`,
   `hotel-desktop/UPDATER.md`, `docs/guides/deployment.md` — mechanical
   `npm run`/`npm install`/`npm ci` → `bun run`/`bun install`/`bun ci` swap;
   spec is exact (find/replace per the counts in Inventory #3), suitable for a
   haiku batch job per `model-dispatch.md`.
3. `AGENTS.md` is Codex-owned (CLAUDE.md: "ask before editing") — do not edit
   without asking, even though it has 14 npm mentions.
4. `hotel-app-be/README.md` — verify each of its 12 npm mentions is actually
   about the FE/desktop projects (not, e.g., a Rust-adjacent doc tool) before
   changing; do not blanket find/replace.
5. **Verification gate:** fresh-context haiku read-back of each edited doc
   confirms no leftover `npm` command examples remain (grep count → 0) and that
   no unrelated prose was altered (`git diff --stat` touches only the listed
   files).
6. Rollback: revert the doc commit; no functional risk (docs only).

---

## ASK-FIRST ITEMS (collected)

- `.github/workflows/ci.yml` (Phase 3) — explicitly named in
  `.claude/rules/maintenance.md`.
- `.github/workflows/desktop-build.yml` (Phase 3) — same risk class, not
  explicitly named but treated identically per judgment-rubrics.md rubric #3.
- `CLAUDE.md` "Common commands" section rewrite (Phase 4) — structural/semantic
  change beyond a line-anchor fix.
- `AGENTS.md` — Codex-owned; do not touch regardless of phase.

## RISKS + ROLLBACK

| Risk | Phase | Likelihood | Mitigation |
|---|---|---|---|
| jsdom fails under `bun run test` (distinct from the confirmed `bun test` failure) | 1 | Unconfirmed, must verify | Phase 1 gate runs the full suite under `bun run test` before proceeding; hybrid fallback (keep `npm run test`/`node` for just the test script) is an acceptable, explicitly-flagged outcome, not a failure of the plan |
| `bun --cwd` silently resolves the wrong `process.cwd()` for Vite | 2 | Confirmed bug exists (#8167, #6386) | Plan avoids `--cwd` entirely; uses Tauri's object-form `cwd` and real subshell `cd` instead |
| `sharp` native binary fails to install under Bun's script-blocking default | 2 | Low — Bun docs claim special-cased handling | Explicit install verification step in Phase 2 |
| `overrides` block doesn't migrate faithfully from `package-lock.json` | 1 | Unconfirmed | Diff `bun.lock` overrides section against `package.json` after Phase 1 install; re-add manually if missing |
| CI cache regression (no built-in `setup-bun` cache) | 3 | Confirmed (no cache input) | Manual `actions/cache` step keyed on `bun.lock` hash added in the same PR |
| Losing `npm ci`'s reproducibility guarantee during transition | 3 | N/A if `bun ci` used | Use `bun ci`, not `bun install`, in all CI steps — verified equivalent |
| Each phase rollback | 1-4 | — | Every phase lists an explicit git-revert path above; no phase deletes a lockfile the other package manager still needs until the *next* phase's gate has passed |

Full rollback of the entire migration at any point: `git revert` the phase
commits in reverse order, `rm **/bun.lock`, keep `package-lock.json` files
(never deleted by this plan until Phase 3's CI gate passes, and even then only
optionally — this plan does not require deleting `package-lock.json`; doing so
is a nice-to-have cleanup, not a stated step above).

## UNCONFIRMED

- Whether `bun run test` (Bun-as-runtime executing vitest's actual CLI) has a
  jsdom-environment failure distinct from the confirmed `bun test` (Bun's native
  runner) failure — no direct report found either way; Phase 1's gate is
  designed specifically to resolve this empirically before the plan proceeds.
- Whether the `overrides` block in `hotel-web-fe/package.json:38-43` migrates
  byte-for-byte into `bun.lock` from the existing `package-lock.json` — Bun
  supports `overrides` as a feature, but no source confirmed the *migration
  path specifically* preserves them from an npm lockfile (as opposed to reading
  them fresh from `package.json`, which would actually be fine either way since
  `overrides` lives in `package.json`, not the lockfile — noted as
  low-confidence risk, likely a non-issue, but left unconfirmed rather than
  asserted).
- CJS-interop breakage claims for Rolldown-vite (Research #7) were sourced from
  a lower-quality aggregator; the underlying Rolldown concept is plausible but
  was not re-verified against `v7.vite.dev/guide/rolldown` directly in this pass.
- Whether Windows is a real target for this repo's CI (`desktop-build.yml`
  currently only runs `macos-14`) — Phase 2's `build:frontend` script change
  assumes a POSIX shell `cd &&` is acceptable; flagged as a caveat rather than
  fully resolved.
