# AGENTS.md

This file defines the working rules for Codex and other coding agents in this repository. Follow it when reading, changing, testing, or refactoring the codebase.

## Repository Layout

This is a three-project monorepo. Each project has its own build system and should be worked on independently:

- `hotel-app-be/` - Rust backend API using Axum + SQLx, with PostgreSQL and SQLite support via Cargo features.
- `hotel-web-fe/` - React 19 + TypeScript frontend using Vite, MUI v7, ky, and Zustand.
- `hotel-desktop/` - Tauri 2 desktop wrapper that embeds the backend sidecar and bundled PostgreSQL resources for offline use.

There is no root-level package manager or workspace. Run commands from the relevant subdirectory.

## Preferred Architecture Pattern

### Backend

Preferred request flow:

`routes/<domain>.rs` -> auth/rate-limit guards -> `handlers/<domain>/` -> `services/<domain>/` -> `repositories/<domain>/` -> `models/<domain>/`

Responsibilities:

- `routes/`: HTTP path registration, route ordering, auth/rate-limit guards, and extraction wiring only. Do not put business logic or SQL here.
- `handlers/`: Translate HTTP inputs into domain calls and domain results into HTTP responses. Keep handlers thin.
- `services/`: Business workflows, validation orchestration, transactions, audit decisions, cross-entity rules, and domain invariants.
- `repositories/`: SQL only. Parameter binding, row fetching, persistence, and row mapping belong here.
- `models/`: Request/response DTOs and domain structs. Keep serialization and validation annotations close to the types they describe.
- `core/`: Cross-cutting infrastructure: auth, DB pool, errors, middleware, rate limiting, SQL compatibility.
- `utils/`: Small reusable pure helpers such as sanitization, date parsing, and validation helpers.

Handlers may contain inline SQL only as a temporary bridge while refactoring legacy files. New code should use repositories.

### Frontend

Preferred feature flow:

`features/<domain>/pages` -> `features/<domain>/components` -> `features/<domain>/hooks` -> `features/<domain>/api` or global `api/<domain>.service.ts`

Responsibilities:

- Pages compose feature components and route-level state.
- Components render UI and receive data/actions via props where practical.
- Hooks own async loading, derived state, local workflow state, and orchestration.
- API services wrap HTTP calls only. They should not contain UI decisions.
- Feature `types.ts`, `utils.ts`, and `constants.ts` should live inside the feature when only that feature uses them.
- Shared reusable UI, hooks, utilities, and types live under `src/components`, `src/hooks`, `src/utils`, and `src/types`.

Large UI files should be split by workflow, not by arbitrary line count. Prefer extracting dialogs, tables, form sections, and pure helpers before changing behavior.

### Desktop

Preferred desktop structure:

- Tauri commands expose UI-facing operations only.
- Backend sidecar lifecycle code should be separate from PostgreSQL lifecycle code.
- PostgreSQL initialization, migration running, status checks, and seed/bootstrap handling should be separate modules when touched.
- Desktop database resources are derived from backend database resources where possible. Keep sync scripts accurate.

## Folder Structure Rules

### Backend

Current structure is flat by layer. When adding or heavily refactoring a domain, move toward this domain-module structure incrementally:

```text
src/
  modules/
    <domain>/
      mod.rs
      routes.rs
      handlers.rs
      service.rs
      repository.rs
      queries.rs
      models.rs
      validation.rs
```

Do not perform a repo-wide move in one change. Migrate one domain at a time, preserving public routes and response shapes.

Keep these existing global areas:

- `core/` for infrastructure shared by all domains.
- `services/audit.rs` for append-only audit logging.
- `database/postgres/migrations/0001_v1_baseline.sql` for the PostgreSQL V1 baseline.
- `database/postgres/data.sql` and `database/postgres/seed.sql` for one-time PostgreSQL initialization data.
- `database/sqlite/migrations/0001_v1_baseline.sql`, `database/sqlite/data.sql`, and `database/sqlite/seed.sql` for the embedded SQLite V1 lifecycle.

When schema changes are made, keep PostgreSQL and SQLite resources aligned or clearly document why they intentionally differ. V1 resources are clean baselines: do not reintroduce historical SQLite sections or startup seed/backfill reruns.

### Frontend

Feature folders should follow this shape for new or refactored code:

```text
src/features/<domain>/
  api.ts
  types.ts
  constants.ts
  utils.ts
  hooks/
  components/
  pages/
  index.ts
```

Rules:

- Keep route-level components under `pages/` when introducing new feature structure.
- Keep reusable domain widgets under `components/`.
- Keep feature-specific data loading in `hooks/`.
- Avoid adding more global barrels unless they reduce real duplication.
- Do not call `fetch` directly. Use `src/api/client.ts` or an existing domain service.
- Use `src/utils/storage.ts` for localStorage access.

### Desktop

New or refactored Rust desktop code should move toward:

```text
src-tauri/src/
  commands/
  process/
  postgres/
  config.rs
  paths.rs
```

Do not manually edit synced desktop database resources without also checking the backend source resource and sync script.

## Naming Conventions

### Rust

- Files and modules: `snake_case`.
- Functions and variables: `snake_case`.
- Types, structs, enums, traits: `PascalCase`.
- Constants: `SCREAMING_SNAKE_CASE`.
- Handler functions should end with `_handler` only inside handler modules. Route wrapper functions can use action names such as `create_booking`.
- Repository methods should use persistence verbs: `find_by_id`, `list`, `insert`, `update`, `delete`, `exists`.
- Service methods should use domain verbs: `check_in_booking`, `void_booking`, `calculate_invoice_totals`.
- Avoid vague names like `data`, `item`, `thing`, `do_update` when a domain name is available.

### TypeScript/React

- Components: `PascalCase` file and export names.
- Hooks: `useX` names and `useX.ts` files.
- Services: `<Domain>Service` in `<domain>.service.ts` until moved into feature-local `api.ts`.
- Types and interfaces: `PascalCase`.
- Constants: `SCREAMING_SNAKE_CASE` for fixed values, `camelCase` for config objects when the existing feature uses that style.
- Event handlers: `handleX`.
- Boolean props/state: `isX`, `hasX`, `canX`, `shouldX`.

## Testing Expectations

### Backend

Add or update tests when refactoring:

- Pure business logic.
- SQL query builders and cross-database helpers.
- Date, money, status, permission, and validation logic.
- Behavior around auth, 2FA, passkeys, eKYC documents, booking state transitions, payments, ledgers, and night audit.

Use focused tests. Prefer unit tests for extracted pure helpers and services. Use SQLite integration tests for database behavior that can run locally without PostgreSQL.

Useful commands:

```bash
cd hotel-app-be
cargo test <name>
cargo check --all-features
cargo clippy --all-features -- -D warnings
```

For SQL changes, verify both database modes when practical:

```bash
cargo check --all-features
cargo check --features sqlite --no-default-features
```

### Frontend

There is currently no frontend test runner configured. For frontend refactors:

- Always run `npx tsc --noEmit`.
- Run `npm run build` for route, bundling, or lazy-loading changes.
- Prefer extracting pure utilities so they can be tested later without coupling to UI.
- Do not add a test framework or test dependency as part of an unrelated refactor. Propose that as a separate, explicit change.

### Desktop

For desktop Rust changes:

```bash
cd hotel-desktop/src-tauri
cargo check
```

For desktop packaging/resource changes, run or inspect:

```bash
cd hotel-desktop
bun run sync:resources
bun run desktop:prepare
```

If a command cannot be run because of local tooling, sandboxing, or network limits, report that clearly.

## Linting And Type-Checking Expectations

Before finishing backend changes:

```bash
cd hotel-app-be
cargo fmt
cargo check --all-features
cargo clippy --all-features -- -D warnings
```

Before finishing frontend changes:

```bash
cd hotel-web-fe
npx tsc --noEmit
npm run build
```

Before finishing desktop Rust changes:

```bash
cd hotel-desktop/src-tauri
cargo fmt
cargo check
```

CI runs on push/PR to `master`: frontend `tsc --noEmit` + Vite build, and backend `cargo check`, `cargo clippy --all-features -- -D warnings`, and release build.

## Dependency Rules

- Avoid unnecessary new dependencies.
- Prefer existing standard library, existing crate, or existing npm package capabilities.
- Add a dependency only when it removes substantial complexity, improves safety, or uses a well-established implementation for a nontrivial domain.
- Do not add overlapping libraries for state, HTTP, validation, dates, UI, or charts without a strong reason.
- Keep backend rate limiting in the existing in-memory implementation unless a separate task approves a different design.
- For frontend HTTP, keep using `ky` through `src/api/client.ts`.
- For frontend UI, prefer MUI components and existing shared components.
- If a dependency is added, explain why, keep it scoped to the project that needs it, and verify lockfile changes.

## Refactoring Rules

- Keep refactors incremental and easy to review.
- Do not combine broad restructuring with feature changes unless explicitly requested.
- Preserve public API routes, request/response shapes, database behavior, UI workflows, and existing permissions unless fixing an obvious bug.
- Move code before rewriting code when possible.
- Extract pure helpers first, then services, then repositories.
- Add tests around extracted logic before or alongside behavior-preserving moves.
- Prefer one domain at a time. Good first backend domains are small route-guard/helper refactors before large domains like bookings, rooms, ledgers, and analytics.
- Good first frontend targets are duplicate shared components and obvious page splits, before large workflow rewrites.
- Avoid mechanical repo-wide formatting churn. Format touched files only unless running the project formatter is required.
- Remove compatibility layers only after all callers have migrated.
- Keep barrel exports purposeful. Do not create import cycles.
- Document any intentional behavior change in the final summary.

## Safety Rules For Preserving Behavior

- Treat existing behavior as the specification unless there is a clear bug, security issue, or data-loss risk.
- Do not change route paths, HTTP methods, status codes, response fields, permission names, localStorage keys, or database column meanings during a refactor.
- Do not change migrations that may already have been applied in production. Add a new migration instead.
- Do not rewrite historical seed or migration files unless the repository explicitly treats them as source templates and the change is safe.
- Do not delete legacy code until `rg` confirms there are no callers or a compatibility shim remains.
- Do not change authentication, authorization, passkey, 2FA, payment, ledger, eKYC, or night audit behavior without targeted tests or explicit approval.
- Keep SQL parameterized. Never interpolate user input into SQL.
- Sanitize free-text user input with existing sanitization utilities.
- Use transactions for multi-step mutations.
- Log internal error details server-side but return generic client-facing errors where appropriate.
- Respect dirty worktrees. Do not revert or overwrite changes you did not make.

## Backend Dual-Database Contract

The backend compiles for exactly one database at runtime. The default feature is PostgreSQL; SQLite is used for offline/test modes. CI may compile with `--all-features`.

When writing SQL:

- Use `param!(1)` / `param!(2)` or `sql_query!(postgres: "...", sqlite: "...")` instead of hand-building placeholders.
- Use helpers from `core/sql_compat.rs` such as `current_timestamp()` and `current_date()` instead of hardcoded database-specific expressions when possible.
- Use helpers in `core/db.rs` for database-specific value conversion such as decimals and UUID generation.
- Keep PostgreSQL and SQLite schema expectations aligned.
- Avoid duplicating long PostgreSQL and SQLite queries inline in handlers. Move them into repositories or query modules.

## Existing Project Commands

### Backend (`hotel-app-be/`)

```bash
cargo check --all-features
cargo clippy --all-features -- -D warnings
cargo build --release
cargo run
cargo run --features sqlite --no-default-features
psql "$DATABASE_URL" -f database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f database/postgres/data.sql
psql "$DATABASE_URL" -f database/postgres/seed.sql
cargo test <name>
```

Helper binaries live in `src/bin/`:

```bash
cargo run --bin hash_password -- <password>
cargo run --bin fix_password -- <username> <new-password>
```

### Frontend (`hotel-web-fe/`)

```bash
npm install
npm run start
npm run build
npx tsc --noEmit
```

The Vite dev server proxy list in `vite.config.ts` is hand-maintained. When adding a new top-level backend API route, add its prefix there or the frontend dev server will not forward it.

### Desktop (`hotel-desktop/`)

```bash
bun install
bun run dev
bun run build
bun run build:debug
bun run sync:resources
bun run desktop:prepare
```

The desktop app ships embedded PostgreSQL resources under `src-tauri/pgsql/` and copied database resources under `src-tauri/database/`. The backend detects desktop mode with `HOTEL_DESKTOP_MODE` and binds to localhost on a dynamically chosen port starting at `BACKEND_PORT`.

## Environment

Required env vars are documented in `hotel-app-be/.env.example`:

- `DATABASE_URL` - PostgreSQL DSN.
- `DATABASE_PATH` - SQLite file path.
- `JWT_SECRET` - at least 32 characters.
- `BACKEND_PORT` - default 3030.
- `ALLOWED_ORIGINS` - comma-separated origins.
- `TRUST_PROXY_HEADERS` - only set true behind a trusted proxy.
- `HOTEL_DESKTOP_MODE` - enables desktop-mode backend behavior.
- `VITE_API_URL` - frontend production API URL.

Never commit real secrets or local `.env` files.

## MCP Servers

`hotel-app-be/README.md` references MCP servers under `hotel-app-be/mcp-server/`. They wrap the REST API and authenticate through JWT. They should not bypass the backend authorization/database access patterns.

## CodeGraph

This project's local code index is generated in `.codegraph/`, which is intentionally Git-ignored and remains local.

Prerequisite: install CodeGraph CLI 1.5.0 (`npm install --global @colbymchenry/codegraph@1.5.0`), run `codegraph init .`, and wire the Codex MCP server with `codegraph install --target=codex` when MCP access is desired.

When CodeGraph is initialized, use it for repository architecture, dependency, and impact questions before broad file searches:

- Use `codegraph explore "<question>"` for architecture, data-flow, and cross-file behavior questions.
- Use `codegraph callers "<symbol>"`, `codegraph callees "<symbol>"`, and `codegraph impact "<symbol>"` before changing shared code.
- Use `codegraph node "<symbol-or-file>"` when you need one symbol or file with line-numbered source.
- Use `codegraph status .` to check freshness. The MCP server auto-syncs changes; use `codegraph sync .` for a manual incremental refresh and `codegraph index . --force` to rebuild the index.
- Treat CodeGraph output as current source when it has no staleness warning, but verify authentication, authorization, payment, ledger, migration, and other security/data-critical findings against the files.

CodeGraph is the repository's only code-graph system. It indexes the backend, frontend, and desktop source trees. SQL schema/data resources, secrets, generated outputs, build artifacts, design-sync files, and deployment infrastructure remain outside the graph and must be inspected directly when relevant.
