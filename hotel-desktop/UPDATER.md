# Desktop auto-update (scaffold)

The Tauri updater plugin is wired in but **not yet armed**. Builds are unaffected
until you complete the steps below, because `bundle.createUpdaterArtifacts` is
`false` and the public key / endpoint are placeholders.

## What is already in place

- `tauri-plugin-updater` + `tauri-plugin-process` dependencies (`src-tauri/Cargo.toml`)
- Plugins registered in `src-tauri/src/lib.rs`
- `check_for_updates` Tauri command (`src-tauri/src/commands.rs`) — checks only;
  the signature is verified by the plugin before any artifact is trusted
- `plugins.updater` config block in `src-tauri/tauri.conf.json` (placeholders)
- `updater:default` + `process:default` capability grants (`capabilities/default.json`)

## Steps to arm it

1. **Generate a signing keypair** (keep the private key secret, never commit it):
   ```bash
   bunx @tauri-apps/cli signer generate -w ~/.tauri/hotel-app.key
   ```
   This prints a **public key**. Put it in `tauri.conf.json` →
   `plugins.updater.pubkey` (replacing `REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY`).

2. **Set the update endpoint(s)** in `plugins.updater.endpoints`, replacing
   `REPLACE_WITH_YOUR_UPDATE_HOST`. Tauri expands `{{target}}`, `{{arch}}`, and
   `{{current_version}}`. The endpoint serves a JSON manifest pointing at the
   signed artifacts (see Tauri "Server-side" updater docs).

3. **Enable artifact generation**: set `bundle.createUpdaterArtifacts` to `true`.

4. **Build with the signing key in the environment** (CI secret, not in git):
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/hotel-app.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<key password>"
   bun run build
   ```
   This emits `*.sig` files and a `latest.json` manifest to publish at your endpoint.

5. **(Related, still open)** Installer code-signing is separate and still
   unconfigured: `bundle.windows.certificateThumbprint` is `null` and
   `timestampUrl` is empty. Configure these (and macOS notarization) so the
   downloaded installer itself is trusted by the OS.

## Frontend usage

```ts
import { invoke } from '@tauri-apps/api/core';
const info = await invoke('check_for_updates');
// { available, version, current_version, notes }
```
Driving the actual download/install (`update.downloadAndInstall()` +
`relaunch()`) can be added once endpoints and keys are live.

## Frontend update UI (as of 2026-07-05)

A grep of `hotel-web-fe/src` for `updater`, `check_for_update(s)`, `checkForUpdate`,
`update-available`, `@tauri-apps/plugin-updater`, `relaunch`, and
`downloadAndInstall` found **no matches** — the frontend does not currently call
`check_for_updates` or render any update-check UI. There is nothing to gate today.

If/when update-check UI or IPC calls are added to the frontend, they must be
gated behind `import.meta.env.VITE_DESKTOP_UPDATER_ENABLED === 'true'` (default:
absent → disabled → UI hidden and IPC never called). The FE update UI should
stay hidden until `VITE_DESKTOP_UPDATER_ENABLED=true` is set at build time —
flip it only after completing the arming steps above.
