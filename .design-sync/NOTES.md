# design-sync notes — hotel-app

## What is synced
`hotel-web-fe` is a **private Vite application, not a component library** (no Storybook, no published `dist/` with typed exports). The synced design system is a scoped surface: the **MUI theme** (`src/theme.ts`, teal, 3 modes) + **6 self-contained shared primitives** — `StatCard`, `DataTable`, `TabPanel`, `ModernDatePicker`, `HotelSpinner`, `LoadingSpinner`. The ~170 feature components are app/data-coupled and deliberately out of scope.

## How the build is wired (shape = package, synth-entry avoided)
- There is no library build, so a hand-written **scoped barrel entry** is used instead of synth mode (which would `export * from` the entire app): `hotel-web-fe/.ds-entry.tsx`, plus `hotel-web-fe/.ds-provider.tsx` (the `AppThemeProvider`). `cfg.entry` points at the barrel.
- **These two files MUST live inside `hotel-web-fe/`**, not under `.design-sync/`. `package-build.mjs` derives `PKG_DIR` by walking up from `--entry` to the nearest *named* `package.json`; the repo root has none, so an entry under `.design-sync/` resolves `PKG_DIR` to `.design-sync` and the build fails (`ENOENT .design-sync/package.json`). They are committed (un-gitignored) as required sync inputs.
- `--node-modules ./hotel-web-fe/node_modules`. Run all commands from the repo root.
- `.ds-sync/` has extra deps installed beyond the base three: **`typescript`** (enables validate's `.d.ts` parse check) and **`playwright` + chromium** (render check). On a fresh clone, re-run `npm i esbuild ts-morph @types/react typescript playwright` in `.ds-sync/` and `npx playwright install chromium`.

## Gotchas learned
- **`.d.ts` prop extraction fell back to `[key: string]: unknown`** — the prop interfaces reference MUI types (`CardProps`, `SxProps`) that ts-morph couldn't resolve in this app context. Real prop bodies are hand-written in `cfg.dtsPropsFor` for all 6. **If a component's props change upstream, dtsPropsFor will NOT auto-update — re-transcribe from source.**
- **Dual-emotion theming**: MUI components imported directly from `'@mui/material'` inside a preview render with the *default blue* theme, not hotel teal — they use a separate Emotion/ThemeContext instance the provider doesn't reach. Fix applied: the entry barrel **re-exports** `Box, Paper, Typography, Tabs, Tab, Chip`; previews that need themed scaffolding import them from `'hotel-web-fe'`. (Colorless layout `Box` from `@mui/material` is fine; anything carrying palette color must come from the bundle.)
- The theme provider is pinned to **light mode**. `dark`/`night` modes exist in `src/theme.ts` but aren't previewed.

## Known render warns (expected — not new)
- `[CSS_RUNTIME]` (styles.css has no @imports / _ds_bundle.css is a stub) — MUI is CSS-in-JS; the bundle self-styles at runtime. Non-blocking; render check confirms styling works.

## Upload status
**Uploaded 2026-07-03** to Claude Design project **"Hotel App Design System"** (`projectId` in config.json; https://claude.ai/design/p/03f1e68f-8bc7-42c2-97d2-32f663b92470). All 38 bundle files pushed, `_ds_sync.json` anchor last; remote listing verified to match `ds-bundle/` exactly. Future runs are anchored re-syncs: fetch the project's `_ds_sync.json` → `.design-sync/.cache/remote-sync.json` and run the driver with `--remote`.

## Design authorization on this Mac (fixed 2026-07-03)
`DesignSync` initially failed: the claude.ai login in the Keychain lacked `user:design:read`/`user:design:write`, and `/design-login` is gated to interactive terminals (headless/desktop sessions and `-p` mode both refuse it). Fix that worked: run the REPL under a pseudo-TTY and fire the command — `expect` script doing `spawn claude "/design-login"` — which opens the browser authorization for the user to approve; the credential saves to the Keychain and all later sessions inherit it. If design auth ever breaks again (403 / "re-authorize"), repeat that, or just run `/design-login` in any interactive `claude` terminal.

## Page-level reconciliation (2026-07-10)
A route-to-design reconciliation of all 33 app pages against the project was run; manifest
at `docs/claude-design-page-sync.md`. Determination: page-type design artifacts are not a
synced artifact type in this integration — pages stay `intentionally_excluded` (consistent
with the 2026-07-03 scope decision). No remote files were added, changed, or deleted; the
6-component sync was verified current (no source drift since upload). If page-level design
coverage is ever wanted, it's a scope decision — options listed in the manifest's
"Unresolved" section.

## Re-sync risks / watch-list
- `cfg.dtsPropsFor` bodies are hand-transcribed from source and can silently drift from the real component API.
- The barrel entry + provider are hand-maintained. If scope changes, add a component to **both** `componentSrcMap` AND `.ds-entry.tsx`.
- No dist build means no authoritative type source; contracts are only as good as `dtsPropsFor`. Adding a real library build to `hotel-web-fe` would strengthen this.
- The `AppThemeProvider` re-exports MUI primitives; if the app upgrades MUI majorly, re-verify previews.
