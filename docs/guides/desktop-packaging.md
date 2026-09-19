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
| Linux | x86_64 | `.deb`, `.AppImage`, `.rpm`, portable `.tar.gz` | `desktop-build-linux` (ubuntu-24.04) |

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
bun run build:rpm              # Linux .rpm

# packaging (requires a completed build)
bun run package:portable       # portable archive of the release output
                               #   → bundle/hotel-desktop-<os>-<arch>-portable.zip  (win/mac)
                               #   → bundle/hotel-desktop-<os>-<arch>-portable.tar.gz (linux)
```

RPM ships alongside deb/AppImage: tauri-bundler writes `.rpm` in-process via
the pure-Rust `rpm` crate, so no `rpmbuild` toolchain is needed anywhere —
CI passes `--bundles deb,appimage,rpm` and install-smokes the result in a
`fedora:41` container (`dnf install` + bundled-PostgreSQL check, run
35424550838). `build:rpm` remains the single-format local path.

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
- **Signing**: two secret-gated paths feed `signtool` via
  `bundle.windows.certificateThumbprint` (merged through `tauri build
  --config` when `WINDOWS_CERT_THUMBPRINT` is in the environment). Hosted
  runners use `WINDOWS_CERT_PFX_BASE64` + `WINDOWS_CERT_PASSWORD` — a job
  step imports the PFX into `Cert:\CurrentUser\My` and passes the resolved
  thumbprint through `GITHUB_ENV`. Self-hosted runners with a persisted cert
  store can set `WINDOWS_CERT_THUMBPRINT` directly instead (PFX wins when
  both are set, since the freshly imported cert is guaranteed present).
  `WINDOWS_SIGN_TIMESTAMP_URL` repo variable overrides the timestamp server
  (default `http://timestamp.digicert.com`). No secrets → unsigned
  artifacts; local builds stay unsigned. Certificates are never committed.
- Known limits: WebView2 must exist on the host — the config uses
  `downloadBootstrapper` so the NSIS installer fetches it when missing. The
  app must not run elevated: PostgreSQL refuses to start as Administrator/root.

## Linux

- **`.deb`** (`build:deb`): installs to `/usr/bin` + `/usr/lib/<name>/`, ships a
  `.desktop` entry and icons; `Depends:` is auto-resolved by the bundler.
- **`.AppImage`** (`build:appimage`): single-file build; host needs `libfuse2`.
- **`.rpm`** (`build:rpm`): supported and exercised in CI — `desktop-build.yml`
  builds it on every bundle run and install-smokes it in a `fedora:41`
  container (`dnf install` → `rpm -q` → `/usr/bin/hotel-desktop` → bundled
  `postgres --version` = 19beta2). Package name is kebab-cased
  `hotel-management-system` (from `productName`), not `hotel-desktop`.
  `rpm -qpR` declares only SONAME requires — `libwebkit2gtk-4.1.so.0` and
  `libgtk-3.so.0` — which dnf resolved to a 314-package transaction on f41
  (webkit2gtk4.1 2.50.1, gtk3 3.24.43; verified run 35424550838).
- Portable `.tar.gz` mirrors the portable zip semantics on Windows.

## macOS

`bun run build` → `.app` + `.dmg` for aarch64. OS signing is secret-gated in
CI: with the Apple secrets provisioned, `desktop-build-macos` imports a
Developer ID certificate into a throwaway keychain, signs every bundled
Mach-O (`scripts/sign-macos-resources.sh` — the `pgsql/` tree and the
backend sidecar) before `tauri build` signs the `.app`, then notarizes and
staples the `.dmg` (`scripts/notarize-macos.sh`). Absent secrets → every
step is skipped and the build stays unsigned. See the provisioning
checklist below and UPDATER.md for the updater-sig distinction.

## Known limits — all platforms

- **Sessions do not survive an app restart.** The webview origin
  (`tauri://localhost` / `http://tauri.localhost`) differs from the backend
  sidecar's `http://127.0.0.1:*`, so the `SameSite` refresh cookie is never
  sent to the backend — after every launch the user logs in again. This is
  an accepted limitation: closing it means token-in-keychain work (a
  separate spec), not a packaging change.
- Deep links / auto-launch: not implemented on any platform — no
  `tauri-plugin-deep-link` or autostart wiring exists to port.

## Signing provisioning checklist

Everything below is secret-gated: with nothing provisioned, the
`desktop-build.yml` jobs produce **unsigned** artifacts (the default). Set
the secrets per platform to turn signing on — no workflow edits needed.
Certificate material lives only in repo secrets, never in the tree.

This covers **OS-level** signing only. Updater signing is separate and
**mandatory**: `createUpdaterArtifacts` + a configured `pubkey` make
`tauri build` hard-fail without `TAURI_SIGNING_PRIVATE_KEY` (provisioned —
see [`hotel-desktop/UPDATER.md`](../../hotel-desktop/UPDATER.md)), so
"unsigned" here always means unsigned OS artifacts, never unsigned
updater artifacts.

### Windows (pick one path)

- **PFX (hosted runners)** — export the code-signing cert + private key as
  `.pfx`, then `base64 -i cert.pfx` into secrets:
  - `WINDOWS_CERT_PFX_BASE64` — base64 of the `.pfx`
  - `WINDOWS_CERT_PASSWORD` — the PFX export password
- **Thumbprint (self-hosted runners)** — cert already in the agent's store:
  - `WINDOWS_CERT_THUMBPRINT` — SHA-1 thumbprint of the installed cert
- Optional repo *variable*: `WINDOWS_SIGN_TIMESTAMP_URL` (default
  `http://timestamp.digicert.com`).

### macOS

- `APPLE_CERTIFICATE` — base64 of a `.p12` export of the **Developer ID
  Application** certificate + private key (Keychain Access → export).
- `APPLE_CERTIFICATE_PASSWORD` — the `.p12` export password.
- `APPLE_SIGNING_IDENTITY` — the cert's common name, e.g.
  `Developer ID Application: Your Name (TEAMID)`.
- `KEYCHAIN_PASSWORD` — any string; it locks the ephemeral CI keychain only.
- Notarization credentials, **either**:
  - `APPLE_ID` + `APPLE_PASSWORD` (an [app-specific
    password](https://support.apple.com/102654)) + `APPLE_TEAM_ID`, **or**
  - `APPLE_API_KEY` + `APPLE_API_ISSUER` + `APPLE_API_KEY_P8` (base64 of the
    `.p8`) — an App Store Connect API key. API-key auth is preferred by
    `notarize-macos.sh` when all three are set.

### First signed release checklist

1. Provision the secrets above for the platforms you intend to sign.
2. Dispatch `desktop-build.yml` with `full_bundle` → confirm the signing
   steps run (not skipped) and artifacts upload.
3. Verify locally: `codesign --verify --deep --strict` +
   `spctl --assess --type execute` on the `.app`; `signtool verify /pa` on
   the NSIS exe; `xcrun stapler validate` on the `.dmg`.
4. Tag a release (`v*`) — the same jobs sign, notarize, and publish via
   `desktop-release`.

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

Tag pushes additionally run `desktop-release` — the only job with
`contents: write` (the workflow default stays `contents: read`). It
downloads the three platforms' artifacts, assembles `latest.json` and the
release assets via `hotel-desktop/scripts/build-update-manifest.mjs`, and
publishes them to the tag's GitHub Release (`gh release create`; an
idempotent `gh release upload --clobber` covers re-runs). That Release is
the updater endpoint — see [`hotel-desktop/UPDATER.md`](../../hotel-desktop/UPDATER.md).
`workflow_dispatch` runs never publish: the job is gated on
`github.ref_type == 'tag'`.

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
