# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

This is a three-project monorepo; each subdirectory has its own build system and is worked on independently:

- `hotel-app-be/` — Rust backend API (Axum + SQLx, dual PostgreSQL/SQLite via Cargo features)
- `hotel-web-fe/` — React 19 + TypeScript web frontend (Vite, MUI v7, Zustand)
- `hotel-desktop/` — Tauri 2 wrapper that embeds the backend binary and a database for offline desktop use

There is no root-level package manager or workspace; run commands from the relevant subdirectory.

## Common Commands

### Backend (`hotel-app-be/`)

```bash
cargo check --all-features                    # CI: fast typecheck
cargo clippy --all-features -- -D warnings    # CI: lint (warnings are errors)
cargo build --release                         # CI: release build
cargo run                                     # Default: PostgreSQL, port 3030
cargo run --features sqlite --no-default-features   # SQLite mode (requires DATABASE_PATH or defaults to ./hotel_data.db)
sqlx migrate run                              # Apply PostgreSQL migrations in database/migrations/
cargo test <name>                             # Run a single test by name substring
```

The `postgres` and `sqlite` features are mutually exclusive at runtime — `core::db::DbPool` resolves to a different concrete pool type depending on which feature is active. Code touching SQL must compile under both.

Helper binaries live in `src/bin/` (`hash_password`, `fix_password`): run with `cargo run --bin hash_password -- <password>`.

### Frontend (`hotel-web-fe/`)

```bash
npm install
npm run start                  # Vite dev server on port 3000, proxies API to 127.0.0.1:3030
npm run build                  # Production build
npx tsc --noEmit               # CI: typecheck (there is no lint or test script)
```

The dev server proxy list in `vite.config.ts` is hand-maintained — when adding a new top-level API route on the backend, add its prefix there or the frontend dev server won't forward it.

### Desktop (`hotel-desktop/`)

```bash
npm install
npm run dev                    # tauri dev — launches the Rust backend as a sidecar
npm run build                  # tauri build — production installer
npm run build:debug            # debug build
```

The desktop app ships an embedded PostgreSQL binary under `src-tauri/pgsql/` and its own `src-tauri/database/`. The backend detects desktop mode via the `HOTEL_DESKTOP_MODE` env var and, when set, binds to `127.0.0.1` on a dynamically-chosen free port starting at `BACKEND_PORT` (default 3030).

### CI

`.github/workflows/ci.yml` runs on push/PR to `master`: frontend (`tsc --noEmit` + `vite build`) and backend (`cargo check/clippy/build` with `--all-features` and `-D warnings`). There is no automated test job — keep `cargo clippy --all-features` clean.

## Architecture

### Backend layering

Requests flow: `routes/<domain>.rs` → auth middleware → `handlers/<domain>.rs` → `repositories/<domain>.rs` (or inline SQL) → `models/<domain>.rs`.

- `routes/mod.rs::create_router` composes all `routes::<domain>::routes()` routers, wires CORS, rate limiters, and security headers (HSTS, CSP, X-Frame-Options, etc.). All domain routes must be `.merge()`d in here to be live.
- `core/auth.rs` + `core/middleware.rs` — JWT verification and RBAC. `require_auth(&headers)` extracts a user ID; `check_permission(pool, user_id, "<resource>:<action>")` enforces RBAC and auto-grants if the user has `<resource>:manage`.
- `core/db.rs` — pool creation. On PostgreSQL, `after_connect` reads `system_settings.timezone` and runs `SET timezone = '<tz>'` per connection so `(ts AT TIME ZONE $tz)::date` comparisons are correct. Timezone values are validated against a safe character set before interpolation because `SET` doesn't accept bound parameters.
- `core/rate_limiter.rs` — in-memory rate limiting (no external dependency); `RateLimiters` is injected as an `Extension`.
- `core/sql_compat.rs` — `sql_query!(postgres: "...", sqlite: "...")` and `param!(N)` macros plus helpers (`current_timestamp()`, `current_date()`) for database-agnostic queries.
- `services/audit.rs` — append-only audit log; call from handlers that mutate business data.
- `utils/sanitization.rs` — `Sanitizer` for user-supplied strings (uses `ammonia`); `utils/validation.rs` for shape validation (uses `validator`).

### Dual-database contract

The backend compiles for exactly one database at a time in production (default feature `postgres`; CI builds with `--all-features` for checking). When writing SQL:

- Use `param!(1)` / `param!(2)` for placeholders (`$1` vs `?1`).
- Use `sql_compat::current_timestamp()` / `current_date()` instead of literal `NOW()` / `CURRENT_DATE`.
- For values that differ between databases (e.g. `Decimal` → `String` on SQLite, UUID generation), use the helpers in `core/db.rs` (`decimal_to_db`, `opt_decimal_to_db`, `generate_uuid`, etc.).
- PostgreSQL migrations live in `database/migrations/` (run via `sqlx migrate run`). SQLite migrations live in `database/sqlite_migrations/` and are run automatically at startup by `create_pool`. Keep them in sync when changing schema.

### Frontend structure

- `src/features/<domain>/` — feature modules (bookings, rooms, guests, loyalty, admin/rbac, ekyc, reports, dashboard, invoices, auth, user). Each typically contains a `components/` folder; barrel exports at the feature root.
- `src/api/*.service.ts` — one service per backend domain. All HTTP goes through `src/api/client.ts` (a configured `ky` instance). Never call `fetch` directly.
- `src/api/client.ts` — attaches `Authorization: Bearer <token>` from `storage`, retries idempotent GETs, and dispatches a `window` `auth:unauthorized` event on 401s from protected endpoints so `AuthContext` can navigate to login without a hard redirect.
- `src/utils/storage.ts` — always use this for localStorage (preserves language preferences on logout; typed getters).
- `src/store/useAuthStore.ts` — Zustand auth store; `AuthContext` in `src/auth/` wraps it.
- `App.tsx` — all non-critical pages are `React.lazy()`-loaded; add new routes there and keep them inside the `Suspense` + `ErrorBoundary` wrappers.
- `tsconfig.json` has `"strict": false` — don't assume strict-mode typing; types tighten gradually.

### API surface

Domain routers are listed in `src/routes/mod.rs`; see `README.md` for the full endpoint table. All protected routes use `require_auth` + `check_permission("<resource>:<action>")`. Uploads are served from the backend's `uploads/` directory via a `ServeDir` mounted at `/uploads`.

## Conventions (from CONTRIBUTING.md)

- **Backend:** parameterize all SQL (never interpolate user input); apply `Sanitizer` to free-text user input; guard protected routes with `require_auth`; use transactions for multi-step mutations; return generic errors to clients and log specifics server-side.
- **Frontend:** always go through the `api` client in `src/api/client.ts` and the `storage` util; add request/response types in `src/types/`; prefer MUI components for UI.
- **Cross-DB:** test backend query changes against both PostgreSQL and SQLite (or at minimum `cargo check --all-features`).

## Environment

Required env vars (see `hotel-app-be/.env.example`):

- `DATABASE_URL` — PostgreSQL DSN (postgres mode)
- `DATABASE_PATH` — SQLite file path (sqlite mode; defaults to `./hotel_data.db`)
- `JWT_SECRET` — ≥32 chars
- `BACKEND_PORT` — default 3030
- `ALLOWED_ORIGINS` — comma-separated; `*` switches CORS to permissive (used by desktop mode)
- `HOTEL_DESKTOP_MODE` — any value enables desktop-mode behavior (localhost-only bind, dynamic port)
- `VITE_API_URL` — frontend production API URL (dev uses the Vite proxy)

## MCP Servers

`hotel-app-be/README.md` references two MCP servers under `hotel-app-be/mcp-server/` (analytics-server, hotel-search-server) that wrap the REST API for Claude Desktop / Cursor integration. They authenticate via JWT and read from the same backend; no separate database access.
