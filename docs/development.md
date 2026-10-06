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

# Canonical: deterministic demo/staging dataset (safe to rerun; never on production):
make db-seed                                     # = cargo run --bin seed -- --all
cd hotel-app-be && cargo run --bin seed -- --list   # named scenarios

# Equivalent by hand, once and in this order:
psql "$DATABASE_URL" -f hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f hotel-app-be/database/postgres/seed.sql
make db-patch

# Schema drift check (needs psql + pg_dump):
make db-schema-drift
```

`db-seed` runs the `seed` binary (`hotel-app-be/src/bin/seed/`). It writes
deterministic rows in the 800000-899999 id band, wipes and re-inserts them on
every run, and derives all dates from the hotel business date. Pin the date
with `--ref-date YYYY-MM-DD`. Apply a subset with `--scenario <name>`, or
wipe only with `--reset`, which is refused unless the environment is a
development one or the database is on loopback.

**Development logins.** Every seeded staff account shares the password
`HotelStaging2026!`. The seed binary points here for credentials. Accounts
include `manager_stg`, `frontdesk_amy`, `finance_mei`, `marketing_nadia`, and
`hk_siti`, plus the portal login `guest_portal` and an inactive and a locked
account. Never reuse them outside development or staging. The scenario table,
fixture inventory, and safety rules are in
`hotel-app-be/database/README.md`.

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

`DATABASE_URL` must point at a **baseline+seed+patch initialized** database,
or the PostgreSQL-backed files silently skip. **Do not judge this by run
count.** A skipped test early-returns, and libtest counts an early return as a
*pass*, so a no-database run looks exactly like a real one. Measured
2026-10-05:

| `payment_characterization.rs` | Result | Time |
|---|---|---|
| no `DATABASE_URL` | 48 passed, 0 ignored, exit 0 | **0.00s** |
| scratch database at patch head | 48 passed, 0 ignored, exit 0 | **3.45s** |

(Older docs quoted 1,317 tests for a no-database run. That figure counted the
`src/` unit tests twice, back when `main.rs` re-declared every module instead
of linking the lib. The duplicate went away on 2026-09-19.)

**Judge by wall-clock time and per-suite counts instead.** A PostgreSQL suite
that finishes in hundredths of a second did nothing. To see the skips that
announce themselves:

```bash
cargo test --all-features -- --nocapture 2>&1 | grep -ci skipping   # >0 means suites skipped
```

A zero here is **not** proof of a full run. Several suites return without
printing anything (for example `consent_gate`, `checkout_receipt`, and
`email_verification`). `distributed_state` also skips silently when
`DATABASE_URL` is set but the server is unreachable.

Never point `DATABASE_URL` at a database holding real data. Build a scratch
one (baseline, `seed.sql`, then `make db-patch`) and drop it afterwards.

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
bun run build:nsis     # Windows installer | build:deb / build:appimage / build:rpm on Linux
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
- **Backend tests all "pass" but suspiciously fast**: `DATABASE_URL` is unset
  or unreachable, so the PostgreSQL suites early-return, and each early return
  counts as a pass. The count looks normal and only the time gives it away:
  `payment_characterization` runs 48 tests in ~3.5s with a database and in
  0.00s without one.
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
