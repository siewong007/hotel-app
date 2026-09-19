# Development

Verified setup and commands. Run each project's commands from its own
directory — there is no root workspace.

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Rust + Cargo | 1.95.0 (edition 2024) | backend + desktop |
| Bun | 1.3.14 | frontend/desktop package manager **and** script runtime — not npm, not node. CI pins this exact version (`ci.yml` → `oven-sh/setup-bun`) |
| Node.js | optional | Nothing in the repo requires it: every script is invoked as `bun …` (the desktop `.mjs` scripts re-spawn via `process.execPath`, i.e. bun), and the CI frontend job installs no Node at all. Install it only if you want `node`/`npx` for ad-hoc tooling |
| Docker (OrbStack/Desktop) | any recent | PostgreSQL for dev + backend tests |
| PostgreSQL 19 | `postgres:19beta3` image | tracked beta until GA (see ongoing-dev note) |

Optional: `psql`/`pg_dump` on PATH for the schema-drift/patch-lifecycle tests
(CI has them; locally they can be shimmed through the dev container — see
Troubleshooting).

## Install

```bash
cd hotel-web-fe && bun install        # frontend deps
cd ../hotel-desktop && bun install    # desktop deps (tauri scripts)
```

Backend needs no install step — `cargo` fetches on first build.

## Environment

Two example files, both fully read by something:

- `.env.example` (root) — what `docker compose` reads: `POSTGRES_*`, ports,
  `JWT_SECRET`, `TOTP_ENCRYPTION_KEY`, image tags.
- `hotel-app-be/.env.example` — the backend-process reference:
  `DATABASE_URL`, `JWT_SECRET` (≥32 chars), `ALLOWED_ORIGINS`, `SMTP_*`,
  `TOTP_ENCRYPTION_KEY`, `PASSKEY_RP_ID`, `GOOGLE_CLIENT_ID`, `TURNSTILE_*`,
  pool tuning.

Copy → `.env` and fill in. `docker compose` aborts on blank `:?` secrets.

## Run

```bash
make docker-up                                   # start postgres + (optionally) caddy
cd hotel-app-be && cargo run --bin hotel-app-be  # API on :3030 (bare `cargo run` errors: multiple bins)
cd hotel-web-fe && bun run start                 # Vite dev on :3000, proxies /api → 127.0.0.1:3030
cd hotel-desktop && bun run dev                  # Tauri dev: sidecar backend + embedded PG
```

## Database

```bash
# Canonical: full structure on a fresh database (baseline + system seed + patches):
make db-baseline

# Canonical: comprehensive deterministic staging dataset (safe to rerun):
make db-seed

# Equivalent by hand, once and in this order:
psql "$DATABASE_URL" -f hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f hotel-app-be/database/postgres/seed.sql
make db-patch

# Schema drift check (needs psql + pg_dump):
make db-schema-drift
```

`db-seed` applies `database/postgres/staging.sql`: deterministic rows in the
800000-899999 id band, deleted-then-reinserted on rerun, all dates relative to
`CURRENT_DATE` (pin via `PGOPTIONS='-c staging.ref_date=YYYY-MM-DD'`). Staging
logins share the password `HotelStaging2026!` — see
`hotel-app-be/database/README.md` for the full scenario inventory.

The compose service auto-initializes `hotel_management` on first boot.
Schema rules: additive changes go in the baseline **and** a new catalog patch
registered in `patches/manifest.tsv` + `deploy/deploy.sh` +
`deploy/deploy-staging.sh` + both deploy workflows — a loose `000N_*.sql`
file is never executed. The catalog publishes converge-style patches
registered in `patches/manifest.tsv` (the original 1.2–1.23 lineage was
folded into the baseline and the catalog republished from empty — read the
manifest for the current entries). A database that still records the pre-fold 1.2+ names/checksums aborts
on `patch 1.N checksum mismatch` — the one-time lineage reset runbook is in
`docs/guides/deployment.md`.

## Validate

Backend (`hotel-app-be/`):

```bash
cargo check --all-features                      # compile
cargo clippy --all-features -- -D warnings      # CI gate verbatim
cargo fmt --check                               # formatting
cargo test --all-features                       # needs DATABASE_URL for full coverage
```

`DATABASE_URL` must point at a **baseline+seed initialized** database or the
PostgreSQL-backed files silently skip. **Do not judge this by run count** —
measured 2026-09-15, that heuristic is backwards:

| | `cargo test --all-features` with no `DATABASE_URL` |
|---|---|
| exit code | `0` |
| total | **1,317 passed, 0 failed** across 54 binaries |
| `payment_characterization.rs` | **44 passed** in **0.01s** |

With a real database that same suite reports **29 passed / 2 ignored**. Skipped
tests early-return, and libtest counts an early return as a *pass* — so removing
the database makes the number go **up** while testing less. The `~1,300` figure
older docs quote as proof of "a full run" is in fact the fully-skipped number.
(958 of those 1,317 *were* the `src/` unit tests counted twice — `main.rs`
re-declared every module, so lib and bin each reported 479. Since 2026-09-19
`main.rs` links the lib instead, so the bin reports **0** unit tests and the
lib reports **509**; expect a total well below 1,317, which is the duplicate
going away, not tests disappearing.)

**Judge by wall-clock time and per-suite counts instead.** A PostgreSQL suite
that finishes in hundredths of a second did nothing. To see the skips explicitly:

```bash
cargo test --all-features -- --nocapture 2>&1 | grep -ci skipping   # >0 means suites skipped
```

Patch-lifecycle and schema-drift tests also shell out to `psql` —
on macOS that means libpq on PATH, e.g. `PATH="/opt/homebrew/opt/libpq/bin:$PATH"`. Postgres-backed suites create and destroy their own scratch
databases against the server in `DATABASE_URL`.

Frontend (`hotel-web-fe/`):

```bash
bun run typecheck    # tsc --noEmit (strict)
bun run lint         # eslint --quiet; lint:strict = --max-warnings=0 (CI gate)
bun run test         # vitest run
bun run build        # vite build
```

Desktop (`hotel-desktop/`):

```bash
cd src-tauri && cargo check && cargo clippy --all-targets -- -D warnings
bun run build          # installer(s) for the current OS; build:no-bundle = binary only
bun run build:nsis     # Windows installer | build:deb / build:appimage on Linux
bun run package:portable  # portable archive of the release output
```

Cross-platform packaging (supported targets, signing, PostgreSQL provisioning,
CI): `docs/guides/desktop-packaging.md`.

Root Makefile: `make check-all`, `make test-all`, `make lint-all`,
`make help`.

## Production build

```bash
cd hotel-web-fe && bun run build              # static bundle → served by Caddy/nginx
cd hotel-app-be && cargo build --release      # API binary
cd hotel-desktop && bun run build             # Tauri installer
```

Deploy itself is scripted in `deploy/deploy.sh` (+ `docs/guides/deployment.md`).

## Troubleshooting

- **`cargo run` → "a bin target must be available"**: the crate ships multiple
  bins; use `cargo run --bin hotel-app-be`.
- **Backend tests all "pass" but suspiciously fast**: `DATABASE_URL` unset, so
  the PostgreSQL suites early-return — and each early return counts as a pass, so
  the total goes *up*, not down. Point it at an initialized db and compare a known
  suite: `payment_characterization` is 29 passed / 2 ignored with a database and
  44 passed / 0 ignored (in ~0.01s) without one.
- **`postgres_patch_lifecycle` fails with "psql: command not found"**: needs a
  PostgreSQL toolchain on PATH. Shim it through the dev container:

  ```bash
  mkdir -p /tmp/pgtools
  printf '#!/bin/sh\nexec docker exec -i hotel-db psql "$@"\n' > /tmp/pgtools/psql
  printf '#!/bin/sh\nexec docker exec -i hotel-db pg_dump "$@"\n' > /tmp/pgtools/pg_dump
  chmod +x /tmp/pgtools/*
  PATH=/tmp/pgtools:$PATH cargo test --all-features --test postgres_patch_lifecycle
  ```

  (Forward `PG*` env through `docker exec -e` if the tests rely on
  `PGAPPNAME`-style session settings.)
- **Vite port taken**: `bun run start` uses `--strictPort`; free :3000 or stop
  the other process.
- **Stale `routeTree.gen.ts`**: regenerated by the router plugin on dev/build —
  don't hand-edit.
- **Typecheck fails but tests pass**: vitest transpiles without type info;
  `typecheck` is a separate gate — run it.
