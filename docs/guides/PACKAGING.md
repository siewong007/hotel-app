# Desktop Packaging

How `hotel-desktop` produces shippable artifacts for macOS, Windows, and Linux.
Build-speed details (caching, profiles) live in
[`hotel-desktop/BUILD_SPEED.md`](../../hotel-desktop/BUILD_SPEED.md); updater
status in [`hotel-desktop/UPDATER.md`](../../hotel-desktop/UPDATER.md).

## Supported targets

| OS | Architecture | Artifacts | CI job |
|---|---|---|---|
| macOS | aarch64 (Apple Silicon) | `.app`, `.dmg` | `desktop-build-macos` (macos-14) |
| Windows | x86_64 | NSIS `-setup.exe`, MSI, portable `.zip` | `desktop-build-windows` (windows-latest) |
| Linux | x86_64 | `.deb`, `.AppImage`, portable `.tar.gz` | `desktop-build-linux` (ubuntu-24.04) |

Only these are built and smoke-tested in CI. Windows ARM64 and Linux ARM64 are
*not* claimed — Tauri can target them, but nothing here builds or verifies them.

### Linux compatibility floor

The Linux build runs on `ubuntu-24.04`, so bundled binaries require
**glibc ≥ 2.39** and WebKitGTK 4.1 (`libwebkit2gtk-4.1`) plus
`libayatana-appindicator3` for the `.deb` (Tauri fills `Depends:`). The
`.AppImage` needs `libfuse2` on the host (`libfuse2t64` on Ubuntu ≥ 24.04).
Older glibc distros (Debian 11, Ubuntu 22.04) are out of scope — build from
source there.

## Commands

All from `hotel-desktop/`. Development → build → packaging → release are
separate steps; nothing edits config per-OS.

```bash
# development
bun run dev                    # prepare (provision + sync + debug sidecar) + tauri dev
bun run dev:no-prepare         # tauri dev only

# build (any OS — Tauri picks the platform's targets)
bun run build                  # release binary + all bundles valid on this OS
bun run build:no-bundle        # release binary only (no installer)
bun run build:fast             # debug build, no bundles — quickest smoke
bun run build:debug            # debug build with bundling

# per-format bundles (run on the matching OS)
bun run build:nsis             # Windows NSIS installer
bun run build:msi              # Windows MSI (WiX)
bun run build:deb              # Linux .deb
bun run build:appimage         # Linux .AppImage
bun run build:rpm              # Linux .rpm (needs rpmbuild toolchain)

# packaging (requires a completed build)
bun run package:portable       # portable archive of the release output
                               #   → bundle/hotel-desktop-<os>-<arch>-portable.zip  (win/mac)
                               #   → bundle/hotel-desktop-<os>-<arch>-portable.tar.gz (linux)
```

RPM is opt-in: the bundler needs `rpmbuild`, which the Ubuntu CI job does not
carry, so `build`/`all` on Linux would fail there. CI passes `--bundles
deb,appimage` explicitly; run `build:rpm` locally on a Fedora/RHEL-ish system if
RPM distribution ever becomes a requirement.

## Embedded PostgreSQL provisioning

`bun run provision:pgsql` fills `src-tauri/pgsql/` (gitignored) with the exact
binaries the app shells out to (`initdb`, `pg_ctl`, `pg_dump`, `pg_isready`,
`pg_restore`, `postgres`, `psql`) plus `lib/` and `share/`. The required build
is read from `CONFIGURED_POSTGRES_MAJOR_VERSION` / `CONFIGURED_POSTGRES_BUILD_IDENTITY`
in `src-tauri/src/postgres.rs` — currently **19beta2**; a `POSTGRES_PREFIX` whose
binaries report anything else is refused.

There is no trustworthy prebuilt 19beta2 for any OS (EDB's CDN rejects automated
fetches; zonky embedded-postgres ships stable releases only), so every platform
provisions from a **from-source build install prefix** via `POSTGRES_PREFIX`:

| OS | Build recipe | Relocation |
|---|---|---|
| macOS | `./configure --prefix=$P --datadir=$P/share/postgresql@19 --libdir=$P/lib/postgresql@19 --with-openssl --with-lz4` (deps via Homebrew); falls back to `brew --prefix postgresql@19` | `install_name_tool` rewrites dylib refs to `@loader_path/…`, external dylibs copied into `lib/`, ad-hoc re-sign |
| Linux | same configure line (apt deps); **no** rename needed — the `@19` names copy verbatim | `patchelf --set-rpath` gives every ELF `$ORIGIN`-relative rpaths covering flat `lib/` and nested `lib/postgresql@19/`; external `.so`s copied into `lib/` |
| Windows | `meson setup --prefix C:\pg19 -Dssl=openssl -Dlz4=enabled -Dzlib=enabled -Dicu=auto …` under `vcvars64` | none needed — Windows resolves DLLs next to the exe; copy vcpkg `installed/x64-windows/bin/*.dll` into `<prefix>\bin` *before* provisioning (the script errors if `bin/` has no DLLs) |

Exact working recipes are the `Build PostgreSQL 19 Beta 2` steps in
`.github/workflows/desktop-build.yml` — they are the reference, keep them in
sync when bumping the PostgreSQL pin.

`desktop:prepare` calls the provisioner first: exit 0 = tree verified, exit 2 =
on-disk tree confirmed unusable (refuses to continue), exit 1 = provisioning
failed but the existing unproven tree may still work (warns, continues).
`provision:pgsql:force` re-copies unconditionally. Staging goes through
`src-tauri/pgsql.tmp/` (gitignored) and swaps atomically.

## Windows

- **NSIS** (`build:nsis`) is the primary installer: per-user, installs under
  `%LOCALAPPDATA%`, writes Start-menu shortcut, and `installer-hooks.nsh` stops
  a running `hotel-app-be.exe` / bundled `postgres.exe` before install or
  uninstall. Data lives outside the install dir (`%LOCALAPPDATA%\HotelApp`) and
  is preserved on uninstall.
- **MSI** (`build:msi`) is built additionally on tag releases — it pulls a WiX
  toolchain at bundle time, so routine validation builds skip it.
- **Portable zip** (`package:portable`) is a validation/escape-hatch artifact:
  unzip anywhere, run `hotel-desktop.exe`. Nothing is written outside the
  user's data dir.
- **Signing**: set the `WINDOWS_CERT_THUMBPRINT` secret (and optionally the
  `WINDOWS_SIGN_TIMESTAMP_URL` repo variable) and the CI job merges
  `bundle.windows.certificateThumbprint`/`digestAlgorithm`/`timestampUrl` into
  the config via `tauri build --config`, so `signtool` signs the exe and the
  installers. No secret → unsigned artifacts; local builds stay unsigned.
  Certificates are never committed.
- Known limits: WebView2 must exist on the host — the config uses
  `downloadBootstrapper` so the NSIS installer fetches it when missing. The
  app must not run elevated: PostgreSQL refuses to start as Administrator/root.
- Deep links / auto-launch: not currently implemented on any platform — no
  `tauri-plugin-deep-link` or autostart wiring exists to port.

## Linux

- **`.deb`** (`build:deb`): installs to `/usr/bin` + `/usr/lib/<name>/`, ships a
  `.desktop` entry and icons; `Depends:` is auto-resolved by the bundler.
- **`.AppImage`** (`build:appimage`): single-file build; host needs `libfuse2`.
- **`.rpm`** (`build:rpm`): supported by the bundler but not exercised in CI —
  see "Commands".
- Portable `.tar.gz` mirrors the portable zip semantics on Windows.

## macOS

Unchanged: `bun run build` → `.app` + `.dmg` for aarch64. Signing/notarization
are not configured (`certificateThumbprint`/identity placeholders remain empty)
— see UPDATER.md for the Apple-side checklist when that work lands.

## CI

`.github/workflows/desktop-build.yml` runs the real `tauri build` on all three
OSes: manual `workflow_dispatch` (inputs: `full_bundle`, `platform`) and tag
pushes `v*`. Each job builds PostgreSQL 19beta2 from the sha256-verified source
tarball, provisions `pgsql/`, builds, and uploads `hotel-desktop-<os>-<arch>`
artifacts (14-day retention). Tag pushes always produce installers; manual runs
default to binary-only unless `full_bundle` is checked.

Packaged-build smoke tests run only when installers are produced:

- **Linux**: `dpkg -i` the `.deb`, assert the installed `pgsql/bin/postgres`
  reports `19beta2`, launch the installed binary under `xvfb` for 25 s (still
  alive = pass).
- **Windows**: run the NSIS installer `/S`, assert the installed tree contains
  `hotel-desktop.exe`, the `hotel-app-be-*.exe` sidecar, and a `pgsql` whose
  `postgres.exe --version` reports `19beta2`.
- **macOS**: artifact existence only — GUI launch checks on headless CI are
  flaky, so `.app` verification stays manual.

`.github/workflows/ci.yml` additionally runs `cargo check` + `cargo test` for
the desktop crate on Ubuntu **and** Windows on every PR (with placeholder
pgsql/sidecar resources, since `tauri build` is too slow for the PR loop). The
psql-spawning unit tests are `#[cfg(unix)]`-gated; `DESKTOP_TEST_*` env vars
enable live-psql coverage when a real database is available.

GitHub Release publishing on tags is deliberately **not** wired — the workflow
is `contents: read` and uploads artifacts only; promoting a tag to a Release is
a maintainer step (`gh release create` with the downloaded artifacts).

## Troubleshooting

- `POSTGRES_PREFIX is not set` (Windows/Linux): point it at a from-source
  install prefix; there is no Homebrew fallback off macOS.
- `contains no DLLs` (Windows): the vcpkg `bin/*.dll` copy step was skipped —
  PostgreSQL's meson install does not stage dependency DLLs.
- `patchelf is required` (Linux): `apt install patchelf` (or dnf equivalent).
- `libpq.so.5 => not found` inside the bundle: a nested `lib/postgresql@19`
  rpath gap — `bun run provision:pgsql:force` after checking `ldd` on the tree.
- AppImage won't launch: install `libfuse2t64` (Ubuntu ≥ 24.04) / `libfuse2`.
- `.deb` installs but window never appears: check `~/.local/share/HotelApp/logs`
  — the backend sidecar and initdb log there.
- Windows installer opens a console flash or leaves `postgres.exe` running on
  uninstall: `installer-hooks.nsh` is responsible — check its `pg_ctl.exe stop`
  path, not the app.
