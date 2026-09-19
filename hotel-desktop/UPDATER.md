# Desktop auto-update (armed)

The Tauri updater is **armed**: it checks a static `latest.json` manifest
served from this repo's GitHub Releases, verifies each download's minisign
signature against the public key baked into `tauri.conf.json`, and applies the
update on user confirmation.

## What is in place

- `tauri-plugin-updater` + `tauri-plugin-process` (`src-tauri/Cargo.toml`),
  registered in `src-tauri/src/lib.rs`
- Commands (`src-tauri/src/commands.rs`):
  - `check_for_updates` — queries the endpoint, returns
    `{ available, version, current_version, notes }`
  - `install_update` — downloads, signature-verifies, and installs; returns
    `{ installed, version }`
  - `restart_app` — relaunches the app (separate so the UI can confirm first)
- `plugins.updater` in `src-tauri/tauri.conf.json`:
  - endpoint: `https://github.com/siewong007/hotel-app/releases/latest/download/latest.json`
  - `pubkey`: the minisign public key (public data, committed)
  - `windows.installMode: passive`
- `bundle.createUpdaterArtifacts: true` — every `tauri build` that produces
  bundles also emits updater artifacts (`*.app.tar.gz`, `*.nsis.zip`,
  `*.AppImage.tar.gz`) plus their `*.sig` files when the signing key is in the
  environment
- `updater:default` + `process:default` capability grants
  (`capabilities/default.json`)
- `scripts/build-update-manifest.mjs` — assembles `latest.json` and stages the
  release assets from the downloaded build artifacts; hard-fails if any
  platform's updater bundle or `.sig` is missing

## Signing key

Generated **2026-09-18 by the repo maintainer** via
`bunx @tauri-apps/cli signer generate`. The private key lives **only** in repo
secrets — it is not committed anywhere:

- `TAURI_SIGNING_PRIVATE_KEY` — private key material
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password

All three platform bundle steps in `.github/workflows/desktop-build.yml`
export both. With the secrets absent, `tauri build` still succeeds but emits
no `*.sig` files — and the release job then hard-fails instead of publishing a
manifest that would strand a platform.

**Rotation:** generate a new keypair (`tauri signer generate`), put the new
private key + password into the two secrets, commit the new public key to
`plugins.updater.pubkey`, and ship a release signed with the new key. Clients
older than that release cannot verify it — keep the old pubkey release
installable-in-sequence (updates verify against the *installed* app's pubkey).

## Release flow

1. Push a `v*` tag → `desktop-build.yml` runs all three platform jobs.
2. Each job's bundle step signs updater artifacts with
   `TAURI_SIGNING_PRIVATE_KEY` and uploads `hotel-desktop-<platform>` artifacts.
3. The `desktop-release` job (`if: github.ref_type == 'tag'`,
   `contents: write`) downloads all three artifacts, runs
   `build-update-manifest.mjs`, and publishes the result to the tag's GitHub
   Release: `latest.json`, installers (`*.dmg`, `*.deb`, `*.AppImage`,
   `*-setup.exe`, `*.msi`), updater bundles + `*.sig`, and portable archives.
   Re-runs are idempotent (`gh release upload --clobber` when the release
   already exists).
   The tag's version must equal `tauri.conf.json` `version` — the script
   hard-fails on a mismatch, because a manifest advertising a version no
   build equals would loop clients on an update they can never reach.
4. Installed apps GET `releases/latest/download/latest.json`, compare
   `version`, and offer the update.

`workflow_dispatch` builds (including `full_bundle=true`) produce and sign the
same artifacts but never publish a release — the release job is tag-gated.

## Frontend flag

Update UI is gated on `VITE_DESKTOP_UPDATER_ENABLED === 'true'` at build time
(and `shouldUseDesktopRuntime()`). CI will set it on the bundle steps — the
env lands with the update-UI task, so it has no effect until then. For a
local `bun run build`, add `VITE_DESKTOP_UPDATER_ENABLED=true` to
`hotel-web-fe/.env.tauri` (untracked via root `.env.*`); `build-frontend.mjs`
hashes `VITE_*` into the build cache key, so flipping it rebuilds the bundle.

## Installer code-signing vs updater signing

These are independent. `*.sig` files above are *updater* signatures — they
prove to the installed app that an update is authentic. They do **not** make
the installer trusted by the OS. OS-level signing remains secret-gated and
unsigned-by-default:

- Windows: `WINDOWS_CERT_THUMBPRINT` (cert in the runner's store) or the PFX
  secrets `WINDOWS_CERT_PFX_BASE64` / `WINDOWS_CERT_PASSWORD` — the NSIS/MSI
  step merges `certificateThumbprint` + `timestampUrl` into the config.
- macOS: `APPLE_*` secrets for Developer ID signing + notarization.

See `docs/guides/PACKAGING.md` for the provisioning checklist.

## Verifying a release end-to-end

```bash
git tag v0.0.0-test && git push origin v0.0.0-test   # maintainer only
gh run watch                                          # three builds + release
curl -sL https://github.com/siewong007/hotel-app/releases/latest/download/latest.json
```

The last command must return JSON with `platforms.darwin-aarch64`,
`platforms.windows-x86_64`, and `platforms.linux-x86_64` entries, each with a
`signature` and a `releases/download/<tag>/...` URL.
