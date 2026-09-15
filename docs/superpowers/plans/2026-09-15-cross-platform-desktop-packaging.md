# Cross-Platform Desktop Packaging Implementation Plan

**Goal:** Extend the existing Tauri 2 desktop build (macOS-only today) to produce production-ready Windows and Linux artifacts, using Tauri's official bundler, without disturbing the macOS path.

**Architecture:** One Tauri app + backend sidecar + embedded PostgreSQL 19beta2, provisioned per-platform at build time. macOS keeps its existing Homebrew/`POSTGRES_PREFIX` + Mach-O relink provisioning. Linux/Windows gain a generic `POSTGRES_PREFIX` provisioning path; CI builds the pinned 19beta2 from the sha256-verified official source tarball on each native runner (configure/make on Ubuntu; Meson+MSVC on Windows), because no trustworthy prebuilt 19beta2 binaries exist (EDB CDN blocks automated fetches; zonky embedded-postgres ships stables only).

**Tech stack:** Tauri 2.11 bundler (nsis/msi/deb/appimage), bun `.mjs` build scripts, GitHub Actions, patchelf (Linux), meson+MSVC+vcpkg (Windows PG).

## Audit findings (what already exists)

- Framework: **Tauri 2** (`hotel-desktop/src-tauri`), plugins: shell, updater (placeholders, not armed), process.
- Rust is already cross-platform: `EXE_SUFFIX`, `PATH_SEP`, `CREATE_NO_WINDOW`, `\\?\` stripping, `open_data_folder` per-OS, `patches.rs` has `compile_error!` on unsupported OSes, `build.rs` cfg'd perms.
- `tauri.conf.json`: `bundle.windows` (nsis installer hooks at `installer-hooks.nsh`, webviewInstallMode) configured; `icon.ico` + Square* icons already generated; `targets: "all"`.
- Scripts already Windows-aware: `copy-backend-sidecar.mjs` (triple + `.exe`), `build-backend-sidecar.mjs`, `build-frontend.mjs`, `bun-path.mjs`.
- `package.json` already has `build:msi`/`build:nsis`.
- Frontend is platform-agnostic (`runtimeApi.ts` IPC bridge, `DesktopServiceGate`, `metaKey||ctrlKey`).
- **Gaps:** `provision-pgsql.mjs` exits 1 on non-darwin ("to be filled in"); `desktop-build.yml` is macOS-only; docs are macOS-only; no portable/zip packaging; `ci.yml` desktop check is ubuntu-only.

## Global constraints

- Do not change routes, response shapes, permission names, column meanings, `CONFIGURED_POSTGRES_*` constants, or macOS provisioning behavior.
- Gitignored `pgsql/` + `binaries/` are per-platform build artifacts; never commit binaries/certs.
- All new GitHub Actions pinned by SHA (repo convention); `bun` is the package manager; `bun:test` for script tests.
- No new dependency unless it replaces substantial complexity (patchelf already a CI dep).
- Updater stays unarmed (separate backlog item); signing config is conditional/env-based only.

## File map

- Modify: `hotel-desktop/scripts/provision-pgsql.mjs` (linux/win32 paths)
- Create: `hotel-desktop/scripts/package-portable.mjs`, `hotel-desktop/scripts/provision-pgsql.test.mjs`, `hotel-desktop/PACKAGING.md`
- Modify: `hotel-desktop/package.json` (bundle scripts), `hotel-desktop/src-tauri/tauri.conf.json` (publisher/descriptions), `.github/workflows/desktop-build.yml` (3-OS jobs + smoke), `.github/workflows/ci.yml` (windows check), `hotel-desktop/BUILD_SPEED.md`, `docs/DEVELOPMENT.md`, `docs/FEATURES.md`, `docs/ongoing-dev.md`, `CLAUDE.md`, `hotel-desktop/.gitignore` (drop stale `installer/` lines)

## Task 1: provision-pgsql.mjs — Linux + Windows paths

- `exe(name)` helper (`name + '.exe'` on win32); use in `checkExistingInstall` + verification.
- Gate Mach-O self-containment check to darwin; on linux, `ldd` every ELF under `pgsql/{bin,lib}` and fail on "not found"; on win32, presence+version only.
- New `provisionPortableFromPrefix`: requires `POSTGRES_PREFIX`; copies `bin/` (required exes + all `*.dll` on win32), `lib/` wholesale minus `pkgconfig`, `share/postgresql*` entries verbatim (preserves the compiled-in relocatable tail regardless of naming).
- Linux relink: walk ELFs in `pgsql/{bin,lib}`; `ldd` each → copy non-system deps (exclude linux-vdso/ld-linux/libc/libm/libdl/libpthread/librt/libresolv/libnss_*) flat into `pgsql/lib/`; iterate to closure; `patchelf --set-rpath` every ELF to `$ORIGIN` + `$ORIGIN/<rel-to-pgsql/lib>`; hard-fail if patchelf missing.
- Verify `postgres/initdb/pg_ctl --version` in staged tree; manifest gains `platform`, `bundledLibs`.
- Error text: no `POSTGRES_PREFIX` on linux → "build PostgreSQL <id> from source (see hotel-desktop/PACKAGING.md)"; on win32 → same + meson pointer.

## Task 2: package.json scripts + package-portable.mjs

- Add `build:deb`, `build:appimage`, `build:rpm` (mirroring `build:msi`/`build:nsis`).
- `package:portable` → `scripts/package-portable.mjs`: `tar -a -cf` a zip of `target/release/{hotel-desktop[.exe], hotel-app-be-*(.exe), pgsql/, database/}` → `target/release/bundle/hotel-desktop-<os>-<arch>-portable.zip`. Fails loudly if payload missing (run after `build:no-bundle`/`build`).

## Task 3: tauri.conf.json metadata

- `bundle.publisher: "Hotel App"`, `shortDescription`, `longDescription`. No other changes (targets stay "all"; windows block already complete; updater untouched).

## Task 4: desktop-build.yml — Windows + Linux jobs

- `workflow_dispatch` gains `platform` choice (`all|macos|windows|linux`, default all); jobs get `if` gates; tags build all.
- `linux` job (ubuntu-24.04): apt = PG build deps (libssl-dev libicu-dev liblz4-dev zlib1g-dev libreadline-dev pkg-config build-essential curl) + tauri deps (libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf); build PG19beta2 via same configure/`@19` datadir+libdir flags as macOS; `POSTGRES_PREFIX` provision; `build:no-bundle` or `--bundles deb,appimage`; upload `bundle/deb|appimage`; smoke on full/tag builds: `dpkg -i`, `dpkg -L`-discovered `postgres --version` asserts 19beta2, `xvfb-run` launch probe.
- `windows` job (windows-latest): `choco install winflexbison3 nasm`; vcpkg (`$env:VCPKG_INSTALLATION_ROOT` else clone+bootstrap) `openssl lz4 zlib icu` x64-windows; `pip install meson ninja pkgconf`; download+sha256-verify PG tarball; `vcvars64.bat` via vswhere; `meson setup --prefix=$PG_PREFIX -Dssl=openssl -Dicu=enabled -Dlz4=enabled -Dzlib=enabled -Dnls=disabled -Dplperl=disabled -Dplpython=disabled -Dpltcl=disabled -Dtap_tests=disabled -Ddocs=disabled`; `meson compile`+`install`; copy `vcpkg installed/x64-windows/bin/*.dll` into prefix `bin/`; provision; `build:no-bundle` or `--bundles nsis` (full/tags add `msi`); conditional `--config` merge injecting `bundle.windows.certificateThumbprint`+`timestampUrl` when `secrets.WINDOWS_CERT_THUMBPRINT` present; `package:portable`; upload; smoke on full: NSIS `/S` silent install → locate installed tree under `%LOCALAPPDATA%` → `postgres.exe --version` asserts 19beta2.
- Artifact names: `hotel-desktop-macos-aarch64` (existing), `hotel-desktop-linux-x86_64`, `hotel-desktop-windows-x86_64`.

## Task 5: ci.yml — Windows desktop check

- New `desktop-windows` job on windows-latest: placeholder resources via pwsh, `cargo check` + `cargo test` (exercises `cfg(windows)` unit tests). No bundling (slow path stays in desktop-build.yml).

## Task 6: Docs

- New `hotel-desktop/PACKAGING.md`: platform/arch matrix, artifacts (dmg/app, nsis/msi, deb/appimage, portable zip; rpm opt-in via `build:rpm` — evaluated, not default since no RHEL-runner demand and rpmbuild isn't preinstalled), per-OS prerequisites, `POSTGRES_PREFIX` contract, signing story (updater placeholders; Windows thumbprint env gate; macOS notarization unchanged/TODO), CI behavior, smoke coverage, troubleshooting (Windows: PG refuses elevated processes → NSIS currentUser; WebView2 bootstrapper needs network; Linux glibc ≥2.39 baseline from ubuntu-24.04 runner, webkit2gtk-4.1 host dep for AppImage).
- `BUILD_SPEED.md`: provisioning section → per-OS sources; commands list += new scripts.
- `DEVELOPMENT.md`: desktop prerequisites per-OS + packaging pointer.
- `FEATURES.md` line 58: platform breadth.
- `ongoing-dev.md`: rewrite "Desktop packaging" item — Windows/Linux CI jobs + per-platform provisioning done; keep updater/origin-consolidation/SameSite items.
- `CLAUDE.md`: desktop bullet gains `PACKAGING.md` pointer (index only).
- `hotel-desktop/.gitignore`: drop stale `installer/` entries.

## Task 7: Validation

- `bun test` on the two script test files (sync test must stay green; new provision test for pure helpers: ldd parse/system-lib filter/layout discovery).
- `cargo check` + `cargo test` in `src-tauri` (host macOS) — no regression.
- `bun run provision:pgsql` fast-path still exits 0 on this mac.
- `python3 -c json.load` on tauri.conf.json; `python3 -c yaml` on workflows; `make docs-check`.
- `git diff` review; report files/commands/artifacts/OS+arch/CI/tests/limitations.

## Explicit non-goals / risks

- No Rust changes expected — all platform cfg already in place (verify by compile).
- Windows PG-from-source recipe is only verifiable on a Windows runner — documented as such; isolated in its own job so macOS/Linux are unaffected.
- SameSite session-persistence limitation, updater arming, macOS notarization: unchanged backlog items.
- No tray/deep-link/auto-launch/notifications exist in the app — nothing to port (documented in audit section of PACKAGING.md).
