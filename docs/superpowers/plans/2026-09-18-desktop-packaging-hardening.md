# Desktop Packaging Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the desktop release story — prove `desktop-build.yml` end-to-end, arm the Tauri updater against GitHub Releases, wire Windows + macOS signing (artifacts stay unsigned until certs exist), evaluate RPM, and collapse the hand-maintained origin/proxy lists into a parity check.

**Architecture:** `desktop-build.yml` gains a `desktop-release` job (tags only, `contents: write`) that assembles `latest.json` + uploads signed updater artifacts to the tag's GitHub Release; the updater endpoint points at `releases/latest/download/latest.json`. Signing is secret-gated everywhere: no secrets → unsigned artifacts, exactly as today.

**Tech Stack:** GitHub Actions, Tauri 2 bundler + updater plugin, `bun` scripts, `gh` CLI, codesign/notarytool (macOS), signtool via PFX import (Windows).

## Global Constraints

- `git status --short --branch` before editing — shared tree.
- `desktop-build.yml` is **not** part of the PR CI loop (by design — real `tauri build` is too slow). Verification of workflow changes is `workflow_dispatch` runs, plus `actionlint`/`yaml.safe_load` locally before pushing.
- Actions stay SHA-pinned with `# vN` comments (existing convention — `actions/checkout@3d3c42e5…` etc.). New third-party actions get the same treatment.
- Secrets are referenced only via `${{ secrets.* }}` — never echoed, never in config files, never committed. `TAURI_SIGNING_PRIVATE_KEY`, `WINDOWS_CERT_PFX_*`, `APPLE_*` live in repo secrets; the pubkey is public data and does go in `tauri.conf.json`.
- Keep every signing step **conditional on its secret existing** — the current "no thumbprint → unsigned" behavior is the baseline and must not regress.
- macOS stays aarch64-only; Windows/Linux x86_64-only. No new platforms in this plan.
- `hotel-desktop/UPDATER.md` and `docs/guides/PACKAGING.md` are the owner docs — update them in the same commits that change behavior.
- Desktop session persistence across restarts is an **accepted limitation** (SameSite boundary) — document it, do not fix it here.

---

### Task 1: Run the existing jobs end-to-end and fix what breaks

The Windows/Linux/macOS jobs have never run with `full_bundle=true`. Baseline first — updater artifacts are worthless if the installers don't build.

**Files:**
- Modify: `.github/workflows/desktop-build.yml` (only what the runs prove broken)
- Create: `.claude/reports/desktop-build-e2e-<date>.md` (results record)

**Interfaces:** none — CI operation task.

- [ ] **Step 1: Dispatch a full-bundle run on all platforms**

```bash
gh workflow run desktop-build.yml -f full_bundle=true -f platform=all
gh run watch   # ~90–120 min
```

- [ ] **Step 2: Triage failures**

Known-risk areas, in order of likelihood:

1. **macOS**: `bun run build` bundles `.app` + `.dmg` — `make -j world-bin` memory on macos-14 is fine, but the ad-hoc re-sign in `provision-pgsql.mjs` can fail if the runner image changed `codesign` behavior; check the provision step output first.
2. **Linux AppImage**: needs `linuxdeploy` fetch inside tauri-build (network flake) and `libfuse2t64` for the smoke run.
3. **Windows**: longest pole — vcpkg builds OpenSSL+ICU (~40 min); `meson`/`ninja` via pip; the NSIS smoke needs the silent-install to actually register `%LOCALAPPDATA%` paths on the runner.
4. **Artifact globs**: the upload `path:` lists — verify every produced file lands under one of them (e.g. `.dmg` under `bundle/**`, portable tar.gz at `bundle/*-portable.tar.gz`).

Fix what breaks in the smallest possible diff; keep the job structure as-is.

- [ ] **Step 3: Record the run**

Write `.claude/reports/desktop-build-e2e-<date>.md`: run URL, per-job outcome, artifact names+sizes, smoke-test output lines, fixes applied, remaining issues.

- [ ] **Step 4: Commit any fixes**

```bash
git add .github/workflows/desktop-build.yml <fixed files> .claude/reports/desktop-build-e2e-<date>.md
git commit -m "ci(desktop): fix full-bundle build issues found in first end-to-end run"
```

---

### Task 2: Origin/proxy parity test

The same logical list is hand-maintained in four places: `runtimeApi.ts` `ROOT_API_PREFIXES`, `vite.config.ts` `PROXY_PREFIXES`, `commands.rs` `ALLOWED_ORIGINS` env, and `capabilities/default.json` `remote.urls`. They drift independently — a parity test turns the KEEP-IN-SYNC comment into a check.

**Files:**
- Create: `hotel-desktop/scripts/origin-parity.test.mjs`
- Modify: none else (runs via existing `bun test scripts/` → `test:scripts`)

**Interfaces:**
- Produces: a bun test asserting: (a) `ROOT_API_PREFIXES` set == `PROXY_PREFIXES` set minus leading `/`; (b) every dev `http(s)` origin in `ALLOWED_ORIGINS` also appears in `remote.urls` (and vice versa); (c) `ALLOWED_ORIGINS` contains both tauri origins.

- [ ] **Step 1: Write the parity test**

```js
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const listLiteral = (source, name) => {
  const match = source.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]+)\\]`));
  if (!match) throw new Error(`${name} not found`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

describe('origin/proxy parity', () => {
  test('runtimeApi ROOT_API_PREFIXES == vite PROXY_PREFIXES (sans slash)', () => {
    const root = listLiteral(read('hotel-web-fe/src/desktop/runtimeApi.ts'), 'ROOT_API_PREFIXES');
    const proxy = listLiteral(read('hotel-web-fe/vite.config.ts'), 'PROXY_PREFIXES').map((p) =>
      p.replace(/^\//, ''),
    );
    expect(root.sort()).toEqual(proxy.sort());
  });

  test('commands.rs ALLOWED_ORIGINS covers the capability remote urls', () => {
    const commands = read('hotel-desktop/src-tauri/src/commands.rs');
    const originsLine = commands.match(/"ALLOWED_ORIGINS",\s*\n?\s*"([^"]+)"/)[1];
    const origins = originsLine.split(',').map((s) => s.trim());
    // Tauri webview origins must be present for the bundled app.
    expect(origins).toContain('tauri://localhost');
    expect(origins).toContain('http://tauri.localhost');

    const caps = JSON.parse(read('hotel-desktop/src-tauri/capabilities/default.json'));
    const remoteUrls = caps.remote.urls.map((u) => u.replace(/\/\*$/, ''));
    // Every http dev origin in the capability list is also an allowed origin,
    // and every http origin in ALLOWED_ORIGINS is covered by a capability url.
    for (const url of remoteUrls.filter((u) => u.startsWith('http'))) {
      expect(origins).toContain(url);
    }
    for (const origin of origins.filter((o) => o.startsWith('http') && !o.includes('tauri'))) {
      expect(remoteUrls).toContain(origin);
    }
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd hotel-desktop && bun test scripts/origin-parity.test.mjs
```

Expected: green on current lists (verify — if it fails, the lists have *already* drifted; reconcile them first in the same commit, noting the drift in the message).

```bash
git add hotel-desktop/scripts/origin-parity.test.mjs
git commit -m "test(desktop): origin/proxy list parity check"
```

---

### Task 3: Arm the updater — config, signing key, release job, `latest.json`, `install_update`

The plugin scaffold is complete; what's missing is a keypair, a real endpoint, `createUpdaterArtifacts`, the release pipeline that publishes `latest.json`, and a Rust `install_update` command.

**Files:**
- Modify: `hotel-desktop/src-tauri/tauri.conf.json` (`plugins.updater`, `bundle.createUpdaterArtifacts`)
- Modify: `hotel-desktop/src-tauri/src/commands.rs` (`install_update`, `restart_app`)
- Modify: `hotel-desktop/src-tauri/src/lib.rs` (invoke_handler)
- Create: `hotel-desktop/scripts/build-update-manifest.mjs`
- Modify: `.github/workflows/desktop-build.yml` (signing env on bundle steps + new `desktop-release` job)
- Modify: `hotel-desktop/UPDATER.md` (rewrite — armed state)

**Interfaces:**
- Consumes: existing `check_for_updates` command; artifact uploads from the three build jobs.
- Produces:
  - `commands::install_update() -> Result<InstallOutcome, String>` — `{ installed: bool, version: String }`
  - `commands::restart_app() -> !` — `tauri::process::restart(&app_handle.env())`
  - `latest.json` manifest at `releases/latest/download/latest.json` on each tag release
  - Updater endpoint: `https://github.com/siewong007/hotel-app/releases/latest/download/latest.json` (verify repo slug with `gh repo view --json nameWithOwner` — use the real one)

- [ ] **Step 1: Generate the signing keypair (maintainer step, once)**

```bash
bunx @tauri-apps/cli signer generate -w ~/.tauri/hotel-app.key
```

Put the **private key** (+password) into repo secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The **public key** goes into `tauri.conf.json` in Step 2 — it is public, commit it. Record in UPDATER.md who generated it and when (not the key material).

- [ ] **Step 2: `tauri.conf.json`**

```json
"bundle": {
  "createUpdaterArtifacts": true,
  ...
},
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/siewong007/hotel-app/releases/latest/download/latest.json"
    ],
    "pubkey": "<pubkey from step 1>",
    "windows": { "installMode": "passive" }
  }
}
```

- [ ] **Step 3: `install_update` + `restart_app` commands**

```rust
#[derive(serde::Serialize)]
pub struct InstallOutcome {
    pub installed: bool,
    pub version: String,
}

/// Download, verify (against plugins.updater.pubkey), and install the pending
/// update. Restart is a separate command so the UI can confirm first.
#[tauri::command]
pub async fn install_update(app_handle: AppHandle) -> Result<InstallOutcome, String> {
    use tauri_plugin_updater::UpdaterExt;

    let updater = app_handle.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(InstallOutcome {
            installed: false,
            version: env!("CARGO_PKG_VERSION").to_string(),
        });
    };
    let version = update.version.clone();
    let mut downloaded: usize = 0;
    update
        .download_and_install(
            |chunk_length, content_length| {
                downloaded += chunk_length;
                log::info!("update: {}/{}", downloaded, content_length.unwrap_or(0));
            },
            || log::info!("update download finished; installing"),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(InstallOutcome { installed: true, version })
}

/// Relaunch the app (e.g. after install_update). Separate from install so the
/// user can finish what they're doing before the restart.
#[tauri::command]
pub fn restart_app(app_handle: AppHandle) {
    tauri::process::restart(&app_handle.env())
}
```

Register both in `invoke_handler!`. (If `tauri::process::restart` isn't reachable at this tauri version, fall back to emitting `update-ready-to-relaunch` and have the FE invoke `plugin:process|restart` — `process:default` is already granted. Verify with `cargo check`.)

- [ ] **Step 4: `build-update-manifest.mjs`**

New script: scans a directory of downloaded build artifacts, pairs every updater bundle with its `.sig`, writes `latest.json`, and stages release assets. Shape:

```js
// bun hotel-desktop/scripts/build-update-manifest.mjs \
//   --tag v1.0.0 --artifacts ./artifacts --repo owner/name --out ./release
// Produces <out>/latest.json + copies installer/updater/sig assets into <out>/
const PLATFORM_ARTIFACTS = {
  'darwin-aarch64': { match: /\.app\.tar\.gz$/, artifact: 'hotel-desktop-macos-aarch64' },
  'windows-x86_64': { match: /\.nsis\.zip$/, artifact: 'hotel-desktop-windows-x86_64' },
  'linux-x86_64': { match: /\.AppImage\.tar\.gz$/, artifact: 'hotel-desktop-linux-x86_64' },
};
// For each platform: find the bundle under artifacts/<artifactDir>/, read
// sibling <bundle>.sig → { signature, url: `https://github.com/${repo}/releases/download/${tag}/${name}` }.
// Emit { version: tagWithoutV, pub_date: new Date().toISOString(), platforms: {...} }.
// Copy every installer/updater/sig file (skip raw binaries + portable archives? —
// no: portable archives ARE release assets; skip only the raw hotel-desktop bin).
```

Implement it fully (~100 lines): `readdirSync` walk, `match.test`, `.sig` read via `readFileSync(sigPath,'utf8').trim()`, hard-fail if any platform's bundle or sig is missing (a release missing a platform's updater artifact must not ship a manifest that leaves that platform dead). Bun-test it: `build-update-manifest.test.mjs` with a fixture artifacts tree asserting the emitted JSON shape + URLs.

- [ ] **Step 5: Signing env on the bundle steps + `desktop-release` job**

Add to each platform's bundle step env (macOS `Build desktop app (full bundle)`, Linux `deb + AppImage`, Windows `NSIS / MSI`):

```yaml
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

Append the release job:

```yaml
  desktop-release:
    name: Publish GitHub Release + updater manifest
    if: ${{ github.ref_type == 'tag' }}
    needs: [desktop-build-macos, desktop-build-windows, desktop-build-linux]
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7

      - name: Setup Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2

      - name: Download build artifacts
        uses: actions/download-artifact@<sha-of-v6> # v6
        with:
          pattern: hotel-desktop-*
          path: artifacts

      - name: Assemble release assets + latest.json
        run: |
          bun hotel-desktop/scripts/build-update-manifest.mjs \
            --tag "$GITHUB_REF_NAME" --artifacts artifacts \
            --repo "$GITHUB_REPOSITORY" --out release-assets

      - name: Publish GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release create "$GITHUB_REF_NAME" \
            --title "$GITHUB_REF_NAME" \
            --generate-notes \
            release-assets/*
```

(`--generate-notes` needs the tag pushed; if the release may already exist, `gh release upload "$GITHUB_REF_NAME" release-assets/* --clobber` as the fallback. Pin `download-artifact` to the v6 SHA — look it up, don't guess.)

- [ ] **Step 6: Rewrite UPDATER.md for the armed state**

Restructure: "armed via GitHub Releases" — what exists (plugin, commands, endpoint, manifest pipeline), the release flow (tag → three builds → release job → latest.json), secrets inventory (`TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`, cert secrets per Tasks 4–5), the local FE flag (`VITE_DESKTOP_UPDATER_ENABLED` — CI sets it; local devs add it to untracked `.env.tauri`), and how to rotate the key.

- [ ] **Step 7: Verify**

```bash
cd hotel-desktop/src-tauri && cargo check
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/desktop-build.yml'))" 2>/dev/null || \
  ruby -ryaml -e "YAML.load_file('.github/workflows/desktop-build.yml')"
cd hotel-desktop && bun test scripts/
```

Real verification = a `v0.0.0-test` tag run end-to-end producing a release with `latest.json` — schedule it after Task 1's baseline is green; that's the arming proof. Then `curl -sL https://github.com/<repo>/releases/latest/download/latest.json` returns the manifest.

- [ ] **Step 8: Commit**

```bash
git add hotel-desktop/src-tauri/tauri.conf.json hotel-desktop/src-tauri/src/commands.rs \
        hotel-desktop/src-tauri/src/lib.rs hotel-desktop/scripts/build-update-manifest.mjs \
        hotel-desktop/scripts/build-update-manifest.test.mjs .github/workflows/desktop-build.yml \
        hotel-desktop/UPDATER.md
git commit -m "feat(desktop): arm auto-updater via GitHub Releases manifest pipeline"
```

---

### Task 4: Frontend update-check UI (flag-gated)

Minimal operator UI: a "Desktop app" card on `SystemHealthPage` (system-info surface, admin-gated) showing current version + check/install/restart flow. Hidden unless `shouldUseDesktopRuntime()` **and** `VITE_DESKTOP_UPDATER_ENABLED === 'true'` — CI sets the flag for bundle builds (Task 3's job env: add `VITE_DESKTOP_UPDATER_ENABLED: "true"` next to the signing envs so it reaches `build-frontend.mjs`, which passes `VITE_*` through and hashes it into the build cache key).

**Files:**
- Create: `hotel-web-fe/src/desktop/UpdateChecker.tsx`
- Create: `hotel-web-fe/src/desktop/UpdateChecker.test.tsx`
- Modify: `hotel-web-fe/src/desktop/runtimeApi.ts` (wrappers + types)
- Modify: `hotel-web-fe/src/features/admin/system/SystemHealthPage.tsx` (mount card)
- Modify: `hotel-web-fe/src/i18n/resources/{en,ms,zh,zh-TW}/common.json` (`desktop.updates.*`)
- Modify: `.github/workflows/desktop-build.yml` (`VITE_DESKTOP_UPDATER_ENABLED` env)

**Interfaces:**
- Consumes: `check_for_updates` (existing), `install_update`, `restart_app` (Task 3); `get_status` already returns `version`.
- Produces:
  ```ts
  export interface DesktopUpdateInfo { available: boolean; version: string; current_version: string; notes: string | null }
  export async function checkForUpdates(): Promise<DesktopUpdateInfo>
  export async function installUpdate(): Promise<{ installed: boolean; version: string }>
  export async function restartApp(): Promise<void>
  export function isDesktopUpdaterEnabled(): boolean  // shouldUseDesktopRuntime() && env flag === 'true'
  ```

- [ ] **Step 1: runtimeApi additions**

```ts
export interface DesktopUpdateInfo {
  available: boolean;
  version: string;
  current_version: string;
  notes: string | null;
}

export function isDesktopUpdaterEnabled(): boolean {
  return shouldUseDesktopRuntime() && import.meta.env.VITE_DESKTOP_UPDATER_ENABLED === 'true';
}

export async function checkForUpdates(): Promise<DesktopUpdateInfo> {
  const { invoke } = await getTauriCoreApi();
  return invoke<DesktopUpdateInfo>('check_for_updates');
}

export async function installUpdate(): Promise<{ installed: boolean; version: string }> {
  const { invoke } = await getTauriCoreApi();
  return invoke('install_update');
}

export async function restartApp(): Promise<void> {
  const { invoke } = await getTauriCoreApi();
  return invoke('restart_app');
}
```

- [ ] **Step 2: `UpdateChecker.tsx`**

Card states: idle (version + Check button) → checking → up-to-date alert → available (version + notes + Install) → installing (progress bar) → installed (Restart now / Later). Errors → inline alert, never thrown to the page. Return `null` when `!isDesktopUpdaterEnabled()`.

- [ ] **Step 3: Mount**

In `SystemHealthPage.tsx`, render `<UpdateChecker />` in the page's card grid — read the page first and match its layout idiom.

- [ ] **Step 4: i18n keys in all four `common.json` bundles**

```json
"updates": {
  "title": "App updates",
  "check": "Check for updates",
  "checking": "Checking…",
  "upToDate": "You're on the latest version ({{version}}).",
  "available": "Version {{version}} is available.",
  "install": "Install update",
  "installing": "Downloading and installing…",
  "installed": "Update installed. Restart to apply version {{version}}.",
  "restartNow": "Restart now",
  "restartLater": "Later",
  "checkFailed": "Update check failed"
}
```

- [ ] **Step 5: Test + manifest**

`UpdateChecker.test.tsx` — mock `runtimeApi` (`isDesktopUpdaterEnabled` true; `checkForUpdates`/`installUpdate`/`restartApp` vi.fn): renders version, check → available → install → restart invoked. Assert disabled renders nothing. Add to `pageManifest.ts` `system-health` `workflowTests` (or keep as a component test — manifest only tracks page surfaces; add to `system-health` `workflowTests` only if it's the page's workflow file, else leave manifest alone — decide per where the assertions live: the component test file stands alone, manifest unchanged).

- [ ] **Step 6: Verify + commit**

```bash
cd hotel-web-fe && bun run test src/desktop/UpdateChecker.test.tsx && bun run typecheck && bun run lint:strict
```

```bash
git add hotel-web-fe/src/desktop/UpdateChecker.tsx hotel-web-fe/src/desktop/UpdateChecker.test.tsx \
        hotel-web-fe/src/desktop/runtimeApi.ts hotel-web-fe/src/features/admin/system/SystemHealthPage.tsx \
        hotel-web-fe/src/i18n/resources/ .github/workflows/desktop-build.yml
git commit -m "feat(desktop): update-check UI behind VITE_DESKTOP_UPDATER_ENABLED"
```

---

### Task 5: Signing wiring — Windows PFX + macOS sign/notarize (secret-gated)

**Files:**
- Modify: `.github/workflows/desktop-build.yml` (Windows PFX import step; macOS sign+notarize step)
- Create: `hotel-desktop/scripts/sign-macos-resources.sh`, `hotel-desktop/scripts/notarize-macos.sh`
- Modify: `docs/guides/PACKAGING.md` (provisioning checklist)

**Interfaces:**
- Consumes: secrets `WINDOWS_CERT_PFX_BASE64`, `WINDOWS_CERT_PASSWORD` (new — for GitHub-hosted runners the cert can't live in a persisted store); `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
- Produces: signed exe+installers when secrets exist; unsigned otherwise — same default as today.

- [ ] **Step 1: Windows — import PFX before the bundle step**

`secrets` is not a legal context in step `if:` — map the secrets to job-level env on `desktop-build-windows` first (same pattern for the macOS steps in Step 2):

```yaml
    env:
      WINDOWS_CERT_PFX_BASE64: ${{ secrets.WINDOWS_CERT_PFX_BASE64 }}
      WINDOWS_CERT_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}
```

Then insert before `Build desktop app (NSIS / MSI)`:

```yaml
      - name: Import code-signing certificate
        if: ${{ env.WINDOWS_CERT_PFX_BASE64 != '' }}
        run: |
          $pfx = Join-Path $env:RUNNER_TEMP 'hotel-codesign.pfx'
          [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERT_PFX_BASE64))
          $pwd = ConvertTo-SecureString $env:WINDOWS_CERT_PASSWORD -AsPlainText -Force
          $cert = Import-PfxCertificate -FilePath $pfx -Password $pwd -CertStoreLocation Cert:\CurrentUser\My
          Remove-Item $pfx -Force
          "WINDOWS_CERT_THUMBPRINT=$($cert.Thumbprint)" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
          Write-Host "Certificate imported (thumbprint resolved; expires $($cert.NotAfter.ToString('yyyy-MM-dd')))"
```

The existing build step already merges `certificateThumbprint`/`timestampUrl` via `--config` when `WINDOWS_CERT_THUMBPRINT` is set — this step feeds it from a PFX. (Note the existing step reads the *secret* `WINDOWS_CERT_THUMBPRINT` — the GITHUB_ENV value takes precedence in the step env, so both paths work: thumbprint secret for self-hosted stores, PFX for hosted runners. Verify the env read order in the step and keep both.)

- [ ] **Step 2: macOS — pre-build resource signing script**

`scripts/sign-macos-resources.sh` — signs every Mach-O in the provisioned tree + the sidecar **before** `tauri build`, so the bundler copies already-signed binaries into the `.app`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Signs sidecar + bundled postgres binaries with the Developer ID identity.
# Runs BEFORE tauri build: the bundler copies these files into the .app, so
# they must carry a valid hardened-runtime signature beforehand or the outer
# signature/notarization fails.
IDENTITY="${APPLE_SIGNING_IDENTITY:?set APPLE_SIGNING_IDENTITY}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
sign_tree() {
  find "$1" -type f \( -perm +111 -o -name '*.dylib' \) -print0 |
  while IFS= read -r -d '' f; do
    if file "$f" | grep -q 'Mach-O'; then
      codesign --force --options runtime --timestamp --sign "$IDENTITY" "$f"
    fi
  done
}
sign_tree "$ROOT/src-tauri/pgsql"
for sidecar in "$ROOT"/src-tauri/binaries/hotel-app-be-*; do
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$sidecar"
done
echo "Signed bundled resources with $IDENTITY"
```

CI steps in `desktop-build-macos` between `Provision embedded PostgreSQL tree` and `Build desktop app`. Map secrets to job env (same reason as Windows — `secrets` isn't legal in `if:`):

```yaml
    env:
      APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
      APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
      APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
      KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
      APPLE_ID: ${{ secrets.APPLE_ID }}
      APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
      APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

Then:

```yaml
      - name: Import Apple signing certificate
        if: ${{ env.APPLE_CERTIFICATE != '' }}
        run: |
          echo "$APPLE_CERTIFICATE" | base64 --decode > "$RUNNER_TEMP/certificate.p12"
          security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security default-keychain -s build.keychain
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security import "$RUNNER_TEMP/certificate.p12" -k build.keychain -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" build.keychain

      - name: Sign bundled resources
        if: ${{ env.APPLE_SIGNING_IDENTITY != '' }}
        run: bash scripts/sign-macos-resources.sh
```

- [ ] **Step 3: macOS — notarize after the bundle**

`scripts/notarize-macos.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Notarize the produced .dmg via notarytool and staple the ticket.
# Expects the bundle to exist and APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID set.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="$(ls -1d "$ROOT"/src-tauri/target/release/bundle/macos/*.app | head -1)"
DMG="$(ls -1t "$ROOT"/src-tauri/target/release/bundle/dmg/*.dmg | head -1)"
codesign --verify --deep --strict "$APP_PATH"   # verify first — don't notarize a broken signature
xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
xcrun stapler staple "$DMG"
```

CI step after the macOS bundle step, gated on `env.APPLE_ID != ''` (env already mapped in Step 2). (`$APP_PATH`/`$ROOT` resolved in the script; verify the .app path is `target/release/bundle/macos/*.app`.)

- [ ] **Step 4: PACKAGING.md — signing provisioning section**

Document: which secrets, how to produce them (PFX export / Developer ID Application cert / app-specific password / API key alternative `APPLE_API_KEY`+`APPLE_API_ISSUER`), where they plug in, and that absent = unsigned. Also the maintainer checklist for a first signed release.

- [ ] **Step 5: Verify**

YAML-parse the workflow; `bash -n` both scripts. Real verification needs the certs — mark in the report that signed-build verification is pending secret provisioning (that's the "wire it, certs pending" posture the user chose).

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/desktop-build.yml hotel-desktop/scripts/sign-macos-resources.sh \
        hotel-desktop/scripts/notarize-macos.sh docs/guides/PACKAGING.md
git commit -m "ci(desktop): secret-gated Windows PFX + macOS sign/notarize wiring"
```

---

### Task 6: RPM evaluation — produce one, then decide

`build:rpm` exists but has never run (needs `rpmbuild`, which the Ubuntu job lacks). Evaluate honestly, then ship it in CI or document why not.

**Files:**
- Create: `.github/workflows/rpm-eval.md` output goes into `.claude/reports/` — evaluate in a dispatch-gated job OR locally; add the job below if taking the CI route
- Modify: `docs/guides/PACKAGING.md` (the `.rpm` row — final decision)

**Interfaces:** none — evaluation task ending in a documented decision.

- [ ] **Step 1: Produce an RPM on a Fedora-ish environment**

Cheapest path that doesn't touch the release workflow: run the Linux build inside a `fedora:41` container locally (or on a Fedora machine):

```bash
docker run --rm -v "$PWD:/src" -w /src/hotel-desktop fedora:41 bash -lc '
  dnf install -y rpm-build gcc-c++ curl ca-certificates pkg-config \
    openssl-devel libicu-devel lz4-devel zlib-devel readline-devel \
    webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel patchelf nodejs && \
  curl -fsSL https://bun.sh/install | bash && export PATH="$HOME/.bun/bin:$PATH" && \
  POSTGRES_PREFIX=??? bun run provision:pgsql && bun run build:rpm'
```

If docker-on-fedora proves too heavy (webkit2gtk4.1-devel package name drift across Fedora releases is the likely first failure), the fallback is a `workflow_dispatch`-gated `rpm-eval` job in `desktop-build.yml` running on `ubuntu-24.04` with `sudo apt-get install -y rpm` — `rpmbuild` exists there via the `rpm` package and Tauri only needs the tool, not RPM-native system deps.

- [ ] **Step 2: Evaluate the artifact**

- Does it install? `dnf install ./hotel-desktop-*.rpm` in a clean fedora container; check `/usr/bin/hotel-desktop` + bundled `pgsql/bin/postgres --version` = 19beta2.
- Are deps sane? `rpm -qpR` — WebKitGTK 4.1 + appindicator must resolve on current Fedora.
- Does the app launch? GUI check best-effort.

- [ ] **Step 3: Decide and document**

- If clean → add `rpm` to the Linux `--bundles` list + an `rpm -i` smoke step mirroring the deb smoke, and mark RPM supported in PACKAGING.md.
- If not → keep `build:rpm` opt-in and record *why* in PACKAGING.md (e.g. dep resolution failures on Fedora XX), plus what would unblock it.
- Either way, record the evaluation in `.claude/reports/rpm-eval-<date>.md`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/desktop-build.yml docs/guides/PACKAGING.md .claude/reports/rpm-eval-<date>.md
git commit -m "ci(desktop): rpm evaluation — <shipped|deferred with reason>"
```

---

### Task 7: Close out — session-persistence note + tracker updates

- [ ] **Step 1: Document the SameSite limitation**

In `docs/guides/PACKAGING.md` "Windows → Known limits" (or a new "All platforms" note): the webview origin (`tauri://localhost`/`http://tauri.localhost`) differs from the sidecar's `http://127.0.0.1:*`, so `SameSite` refresh cookies never reach the backend — a session cannot survive an app restart; users log in again. Accepted; revisiting means token-in-keychain work, a separate spec.

- [ ] **Step 2: Update `docs/ongoing-dev.md`**

Rewrite the "Desktop packaging" P2 entry to reflect what shipped: end-to-end verified (link report), updater armed via GitHub Releases, signing wired-but-pending-certs, RPM decision, origin parity test. Keep open: cert provisioning, session persistence (accepted), macOS signed-build verification pending certs.

- [ ] **Step 3: Final verify**

```bash
python3 scripts/check-doc-links.py
cd hotel-desktop && bun test scripts/
cd hotel-desktop/src-tauri && cargo check && cargo test
cd hotel-web-fe && bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add docs/guides/PACKAGING.md docs/ongoing-dev.md
git commit -m "docs(desktop): packaging hardening status — updater armed, signing wired, session limits documented"
```
