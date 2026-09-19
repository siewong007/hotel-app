# Desktop `desktop-build.yml` end-to-end ledger

**Branch:** `feat/2026-09-18-hardening-plans`
**Scope:** first-ever `full_bundle=true` runs of the three platform jobs —
the baseline, the fixes each failure produced, and the final verification
run. Companion eval: [`rpm-eval-2026-09-19.md`](rpm-eval-2026-09-19.md).

## Run history

| Run | macOS aarch64 | Linux x86_64 | Windows x86_64 | Outcome / fixes landed |
|---|---|---|---|---|
| 35354808394 (baseline) | ✅ | ❌ | ❌ | First full-bundle run ever. Linux: `provision-pgsql` produced absolute symlinks — bun 1.3.14 `cpSync({preserveTimestamps:true})` rewrites *relative* soname link text into absolute source-prefix paths, so the `pgsql/` self-containment check failed and re-provisioning was impossible (`POSTGRES_PREFIX` only on the provision step env). Windows: `for /f` vswhere capture — the `)` in `%ProgramFiles(x86)%` closed the `in(...)` clause → `\Microsoft was unexpected at this time`. |
| 35398662670 | ✅ | ❌ | ❌ | Fix-round-1 verified (symlink + vswhere fixes held). Both failed later at `bun scripts/package-portable.mjs`: payload was staged from `target/release` but the sidecar lives in `src-tauri/binaries/` and `pgsql/`/`database/` under `src-tauri/` — stale paths. Fixed by per-item sourcing + interleaved `tar -C` archiving (`8ef154e16`); the Windows upload glob `target/release/hotel-app-be-*.exe` was repointed at `src-tauri/binaries/`. |
| 35416174865 | ✅ | ❌ | ❌ | Bundles produced and *installed* on both OSes — failures moved inside the install-smoke steps. Linux: the app-binary glob (`/bin/[^/]+$`, first match) picked `pgsql/bin/pg_dump`, which then "failed to launch". Fixed by matching `/hotel-desktop$` minus `/pgsql/` plus a non-empty guard. Windows: `Get-ChildItem -Filter 'hotel-app-be-*.exe'` could never match — tauri-bundler **strips** the `-<triple>` suffix when installing externalBin (`$INSTDIR\hotel-app-be.exe` flat). Fixed with `-Recurse -Filter 'hotel-app-be*.exe'` (`5af7b3926`). |
| 35424550838 (`rpm_eval`) | — | ⚠️ | — | RPM evaluation dispatch (Linux only): `.rpm` built in-bundle and install-verified in a clean `fedora:41` container — 314 deps resolved from Fedora repos, `/usr/bin/hotel-desktop` present, bundled `postgres --version` = 19beta2 → **RPM shipped** into the default `--bundles deb,appimage,rpm` list with a permanent `timeout 3600` guard against tauri-apps/tauri#15698. The run's only failure was the already-fixed deb-smoke glob. |
| 35425902135 (final) | ✅ | ✅ | ✅ | **First all-green full-bundle run.** macOS 9m30s; Linux 19m23s incl. deb install + xvfb launch smoke; Windows 1h0m54s incl. NSIS `/S` install that found the triple-stripped `hotel-app-be.exe` via the recursive glob. Release job correctly skipped (tag-gated). Pipeline verified end-to-end. |

## Fixes landed, by commit

- `provision-pgsql.mjs`: `verbatimSymlinks: true` on the `lib/`/`share/`
  `cpSync` calls (root fix — relative soname links stay relative), plus
  `relativizeTreeSymlinks()` normalizing any absolute link that still
  appears (in-tree → relative; outside-tree → same-basename sibling; no
  counterpart → fatal).
- `desktop-build.yml`: vswhere writes `installationPath` to a file read by
  `for /f` (no parens in the clause); `POSTGRES_PREFIX` propagated via
  `$GITHUB_ENV` (macOS/Linux — `runner` context is illegal in job `env:`)
  and a literal job-level `env:` on Windows.
- `package-portable.mjs`: payload sourced per-item from the real locations
  (exe from `target/release`, sidecar from `src-tauri/binaries`,
  `pgsql/`/`database/` presence-checked under `src-tauri`), archived via
  interleaved `tar -C` so members stay flat.
- Install smokes: deb launch probe matches the exact app binary name;
  NSIS tree check recurses and matches the triple-stripped sidecar name.

## What the smokes now cover

- **Linux**: `dpkg -i` the `.deb`, bundled `pgsql/bin/postgres` reports
  19beta2, installed `hotel-desktop` launches under `xvfb` for 25 s;
  `dnf install` of the `.rpm` in `fedora:41` asserts install + binary +
  bundled PG.
- **Windows**: NSIS `/S` silent install, installed tree contains
  `hotel-desktop.exe`, the `hotel-app-be*.exe` sidecar, and a `pgsql` whose
  `postgres.exe --version` reports 19beta2.
- **macOS**: artifact existence only — GUI launch checks on headless CI
  stay manual.

## Residual / pending

- **Final verification**: ✅ complete — run 35425902135 completed all three
  platform jobs green on the post-fix code (macOS, Linux, Windows).
- **Signed-build verification**: pending cert provisioning (Windows PFX,
  Apple Developer ID + notarization creds) — all signing steps are
  secret-gated and currently skip.
- **Updater release path**: `desktop-release` is tag-gated; a `v*` tag run
  is the arming proof for `latest.json` publication (not exercised by
  dispatch runs — by design).
