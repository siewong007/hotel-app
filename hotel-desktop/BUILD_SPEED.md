# Desktop Build Speed

The desktop build has two stages:

1. `desktop:prepare` refreshes the assets that Tauri packages.
2. `tauri build` compiles and optionally bundles the Tauri application.

`npm run build` still runs the production Tauri build, but the preparation step is now cache-aware so repeated builds skip unchanged work.

## Preparation Order

`npm run desktop:prepare` runs these steps in order and prints the duration for each one:

1. Provision the embedded PostgreSQL tree into `src-tauri/pgsql/`.
   - Skipped (fast path) when `pgsql/` already contains binaries matching the major version parsed from `CONFIGURED_POSTGRES_MAJOR_VERSION` in `src-tauri/src/postgres.rs`.
   - This step is non-fatal in `desktop:prepare`: if provisioning fails but `pgsql/` already exists, the existing tree is used and the build continues.
2. Sync backend database resources into `src-tauri/database/`.
   - `database/schema.sql` and `database/data.sql` are copied only when the content changed.
3. Build the Tauri frontend bundle.
   - The Vite build is skipped when frontend source, public assets, build config, package files, and `VITE_`/`TAURI_ENV_` environment inputs are unchanged and `hotel-web-fe/dist/index.html` exists.
4. Build the backend sidecar.
   - The release Cargo build is skipped when backend source, Cargo files, Rust toolchain metadata, and build command metadata are unchanged and the backend release binary exists.
   - `build:fast` and `build:debug` set `DESKTOP_BACKEND_PROFILE=debug`, so those local builds use the faster debug sidecar instead of forcing a release backend rebuild.
5. Copy the backend sidecar into `src-tauri/binaries/`.
   - The sidecar copy is skipped when the target binary already matches the source binary.

Cache stamps are stored under `src-tauri/target/desktop-build-cache/`, so they are local build artifacts and are not committed.

## Embedded PostgreSQL Provisioning

`npm run provision:pgsql` populates `src-tauri/pgsql/` (gitignored, ~44MB) with the
subset of a Homebrew `postgresql@<major>` install (`bin`, `lib`, `share`) that the
app needs at runtime. The major version comes from `CONFIGURED_POSTGRES_MAJOR_VERSION`
in `src-tauri/src/postgres.rs` — it is not hardcoded in the script.

- Fast path: if `pgsql/` exists, its `postgres`/`initdb`/`pg_ctl` report the expected
  major version, and it exits 0 without copying anything.
- On macOS, provisioning locates the source via `brew --prefix postgresql@<major>`
  (install it with `brew install postgresql@<major>` if missing), copies it into a
  `pgsql.tmp` staging directory, verifies the binaries, then atomically renames it
  into place. A failed copy never touches the existing `pgsql/` tree.
- Windows/Linux sources are not configured yet; the script exits 1 with a message
  rather than guessing a download URL.
- Force re-provisioning (e.g. after a version bump or a suspected bad copy):
  `npm run provision:pgsql:force`, or `node scripts/provision-pgsql.mjs --force`.

## Commands

Use these commands from `hotel-desktop/`:

```bash
npm run desktop:prepare        # cache-aware resource, frontend, backend, and sidecar preparation
npm run desktop:prepare:force  # rebuild and recopy all preparation outputs

npm run build                  # production build with all configured bundle targets
npm run build:no-bundle        # production binary build without installer packaging
npm run build:fast             # debug app + debug sidecar without installer packaging
npm run build:debug            # debug app + debug sidecar with Tauri's default debug bundling behavior

npm run build:msi              # Windows-only MSI package
npm run build:nsis             # Windows-only NSIS package
```

For day-to-day verification, prefer `npm run build:fast`. For release candidates, use `npm run build` or a single installer target such as `npm run build:nsis`.

## Rust Build Profiles

The default Tauri release profile remains optimized for distribution:

- link-time optimization enabled
- one codegen unit
- size-oriented optimization
- stripped binary

Both the desktop and backend release profiles use Cargo `build-override` settings so build scripts and proc macros compile with cheaper settings while final runtime code remains optimized. This reduces release build time and avoids spending release-level optimization on host-only build artifacts.

`src-tauri/Cargo.toml` and `../hotel-app-be/Cargo.toml` also define `release-fast` for local Rust compile experiments where a release-like optimized build is useful but final binary size is less important. Tauri's normal fast path is still `npm run build:fast`, which uses Tauri's debug build mode, prepares a debug backend sidecar, and skips installer packaging.

## Optional Machine-Level Cache

Rust builds can be sped up further with `sccache`:

```bash
set RUSTC_WRAPPER=sccache      # Windows cmd
$env:RUSTC_WRAPPER="sccache"   # Windows PowerShell
export RUSTC_WRAPPER=sccache   # macOS/Linux
```

Keep this as a local or CI setting; the project scripts do not require `sccache`.
