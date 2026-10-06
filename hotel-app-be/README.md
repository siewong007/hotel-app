# hotel-app-be

Rust backend API for the hotel administrative panel: Axum 0.8, SQLx 0.9, PostgreSQL 19.
It serves the React frontend in web deployments and runs as a sidecar process inside the
Tauri desktop app.

Project overview and the endpoint table are in the [root README](../README.md).
Architecture essentials and agent routing are in [CLAUDE.md](../CLAUDE.md); layer
responsibilities and conventions are in [AGENTS.md](../AGENTS.md).

## Quick start

Building needs `protoc` on `PATH` (macOS: `brew install protobuf`), because `build.rs`
compiles the gRPC contract in `proto/`.

```bash
cp .env.example .env          # set DATABASE_URL and a JWT_SECRET of at least 32 chars
createdb hotel_management
psql "$DATABASE_URL" -f database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f database/postgres/seed.sql
./database/postgres/apply-patches.sh   # the patch catalog; the backend refuses to start without it
cargo run --bin hotel-app-be  # http://localhost:3030
```

From the repository root, `make db-baseline` runs the same three steps. For demo data,
run `cargo run --bin seed -- --all` (or `make db-seed`); `--list` shows the scenarios.

The bootstrap seed does not install a usable shared password. Set the administrator
password before the first login:

```bash
cargo run --bin fix_password -- admin '<strong-admin-password>'
```

Verify the service is up:

```bash
curl http://localhost:3030/health
```

## Verification commands

```bash
cargo check --all-features                    # minimum bar
cargo clippy --all-features -- -D warnings    # exactly what CI runs
cargo test --all-features                     # see the DATABASE_URL caveat below
cargo fmt --check                             # CI gate; `cargo fmt` to fix
```

`cargo check` does not compile the `tests/` targets, so it cannot catch a broken
integration test after a signature change — run `cargo test`, or at least
`cargo check --tests`.

55 of the 59 files under `tests/` read `DATABASE_URL` and return early without it (or,
for some, when the server is unreachable). The suite still exits 0, and each early
return counts as a *pass*, so a no-database run reports the same counts as a real
one. Do not judge by run count or exit code. Judge by wall-clock and per-suite
counts: on 2026-10-05, `payment_characterization` reported 48 passed in 0.00s without
a database and the same 48 in ~3.5s with one.
See [../docs/development.md](../docs/development.md#validate) for the full heuristic.
The patch-lifecycle
and schema-drift suites additionally shell out to `psql` — on macOS add libpq to PATH
(`/opt/homebrew/opt/libpq/bin`) or they fail with `psql: command not found`.

## Layout

```text
src/
  core/           Auth, DB pool, errors, middleware, rate limiting, metrics, caches, SQL compat
  routes/         Router composition — every module router merged in routes/mod.rs
  modules/        All domains: <domain>/{routes,handlers,service,repository,models}.rs
                  (38 routed; `consent` is internal with no routes)
  grpc/           tonic gRPC/gRPC-Web adapters (rooms, room types, housekeeping,
                  maintenance, guests) merged into the same Axum router at
                  `/hotel.*` paths — they reuse the module service layer (ADR 014)
  services/       Cross-domain services only: audit, account_emails,
                  google_identity, invoice_numbers
  repositories/   Cross-domain persistence only: audit, invoice_numbers
  models/         Cross-domain DTOs only: audit, common, row_mappers
  utils/          Sanitization and small pure helpers
  bin/            hash_password, fix_password, seed/ (deterministic demo dataset)
database/postgres/  V1 baseline, seed.sql, the patches/ catalog, drift + PG19 tuning scripts
proto/              Mirror of ../proto/hotel (compiled by build.rs; refresh with `make sync-proto`)
tests/              Integration tests, most requiring DATABASE_URL
```

Every new domain router must be merged in `routes/mod.rs::create_router` or it is dead.
Database lifecycle rules are in [database/README.md](database/README.md).

## Environment

`DATABASE_URL` and `JWT_SECRET` are required; everything else has a default. Optional
variables cover the listen address, CORS origins, proxy trust, passkey relying-party ID,
Google sign-in, SMTP delivery, desktop mode, and pool/cache tuning. The full annotated
list is [.env.example](.env.example). `APP_ENV` (which wins) or `ENVIRONMENT` selects
`development`/`staging`/`production`, and in production startup refuses insecure
combinations such as a wildcard or localhost CORS origin or skipped email verification.

Never commit a real `.env` file or local credentials.

## Desktop mode

With `HOTEL_DESKTOP_MODE` set, the backend binds `127.0.0.1` on a dynamically probed free
port starting at `BACKEND_PORT`, and the Tauri shell passes an explicit `ALLOWED_ORIGINS`
list rather than a wildcard. Build and packaging instructions are in
[../hotel-desktop/BUILD_SPEED.md](../hotel-desktop/BUILD_SPEED.md).

## Stopping local processes

Stop interactive processes with `Ctrl+C`. To free lingering ports on macOS:

```bash
kill $(lsof -ti tcp:3000)   # frontend
kill $(lsof -ti tcp:3030)   # backend
kill $(lsof -ti tcp:3031)   # alternate backend
```

To stop the desktop app's embedded PostgreSQL:

```bash
cd ../hotel-desktop/src-tauri
./pgsql/bin/pg_ctl stop -D "$HOME/Library/Application Support/HotelApp/pgdata" -m fast
```

## MCP servers

Not implemented. Earlier documentation described MCP servers under `mcp-server/`; no such
directory exists. See ADR 009 in [../docs/architecture/decision-records.md](../docs/architecture/decision-records.md)
for the authorization constraint any future implementation has to satisfy.
