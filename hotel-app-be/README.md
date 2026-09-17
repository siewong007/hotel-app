# hotel-app-be

Rust backend API for the hotel administrative panel: Axum 0.8, SQLx 0.9, PostgreSQL 19.
It serves the React frontend in web deployments and runs as a sidecar process inside the
Tauri desktop app.

Project overview and the endpoint table are in the [root README](../README.md).
Architecture essentials and agent routing are in [CLAUDE.md](../CLAUDE.md); layer
responsibilities and conventions are in [AGENTS.md](../AGENTS.md).

## Quick start

```bash
cp .env.example .env          # set DATABASE_URL and a JWT_SECRET of at least 32 chars
createdb hotel_management
psql "$DATABASE_URL" -f database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f database/postgres/seed.sql
cargo run --bin hotel-app-be  # http://localhost:3030
```

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
cargo fmt
```

`cargo check` does not compile the `tests/` targets, so it cannot catch a broken
integration test after a signature change — run `cargo test`, or at least
`cargo check --tests`.

49 of the 53 files under `tests/` return early when `DATABASE_URL` is unset, and the
suite still exits 0 — and each early return counts as a *pass*, so a no-database run
reports **more** tests (~1,317), not fewer. Do not judge by run count or exit code:
judge by wall-clock and per-suite counts (e.g. `payment_characterization` is
44 passed in ~0.01s without a database vs ~29 passed / 2 ignored with one).
See [../docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md#validate) for the full heuristic.
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
  services/       Cross-domain services only: audit, account_emails,
                  google_identity, invoice_numbers
  repositories/   Cross-domain persistence only: audit, invoice_numbers
  models/         Cross-domain DTOs only: audit, common, row_mappers
  utils/          Sanitization and small pure helpers
  bin/            hash_password, fix_password
database/postgres/  V1 baseline, seed, and PostgreSQL 19 tuning scripts
tests/              Integration tests, most requiring DATABASE_URL
```

Every new domain router must be merged in `routes/mod.rs::create_router` or it is dead.
Database lifecycle rules are in [database/README.md](database/README.md).

## Environment

`DATABASE_URL` and `JWT_SECRET` are required; everything else has a default. Optional
variables cover the listen address, CORS origins, proxy trust, passkey relying-party ID,
Google sign-in, SMTP delivery, desktop mode, and pool/cache tuning. The full annotated
list is [.env.example](.env.example). Production additionally requires
`ENVIRONMENT=production`, and startup refuses insecure combinations such as a wildcard
CORS origin or skipped email verification.

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
directory exists. See ADR 009 in [../docs/architecture/ADRS.md](../docs/architecture/ADRS.md)
for the authorization constraint any future implementation has to satisfy.
