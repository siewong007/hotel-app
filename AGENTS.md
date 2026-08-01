# AGENTS.md

Working rules for Codex and other coding agents in this repository: conventions,
refactoring safety, and dependency policy.

**Layout, commands, environment variables, CI jobs, and architecture essentials live in
[CLAUDE.md](CLAUDE.md) — this file does not repeat them.** Human-facing contribution
process (branching, PR checklist, commit format) lives in
[CONTRIBUTING.md](CONTRIBUTING.md). When a fact changes, update it in the one file that
owns it.

## Preferred architecture pattern

### Backend

`routes/<domain>.rs` → auth/rate-limit guards → `handlers/<domain>.rs` →
`services/<domain>.rs` → `repositories/<domain>.rs` → `models/<domain>.rs`

- `routes/`: HTTP path registration, route ordering, auth/rate-limit guards, extraction wiring. No business logic or SQL.
- `handlers/`: Translate HTTP inputs into domain calls and domain results into HTTP responses. Keep thin.
- `services/`: Business workflows, validation orchestration, transactions, audit decisions, cross-entity rules, domain invariants. Not every domain has one; some handlers call repositories directly.
- `repositories/`: SQL only. Parameter binding, row fetching, persistence, row mapping.
- `models/`: Request/response DTOs and domain structs, with their serialization and validation annotations.
- `core/`: Cross-cutting infrastructure — auth, DB pool, errors, middleware, rate limiting, metrics, SQL compatibility.
- `utils/`: Small pure helpers such as sanitization and date parsing.

Handlers may contain inline SQL only as a temporary bridge while refactoring legacy
files. New code uses repositories.

### Frontend

`features/<domain>/pages` → `features/<domain>/components` → `features/<domain>/hooks` →
`features/<domain>/api` or global `api/<domain>.service.ts`

- Pages compose feature components and route-level state.
- Components render UI and receive data/actions via props where practical.
- Hooks own async loading, derived state, local workflow state, and orchestration.
- API services wrap HTTP calls only; no UI decisions.
- Feature-local `types.ts`, `utils.ts`, `constants.ts` stay inside the feature. Shared code lives under `src/components`, `src/hooks`, `src/utils`, `src/types`.

Split large UI files by workflow, not by line count. Extract dialogs, tables, form
sections, and pure helpers before changing behavior.

### Desktop

- Tauri commands expose UI-facing operations only.
- Keep backend-sidecar lifecycle code separate from PostgreSQL lifecycle code.
- PostgreSQL initialization, status checks, and seed/bootstrap handling belong in separate modules when touched.
- Desktop database resources are derived from backend resources by the sync scripts. Do not hand-edit synced resources without also updating the backend source and the script.

## Folder structure targets

New backend domains use the domain-module layout already adopted by `modules/analytics`,
`communications`, `ekyc`, `guest_booking`, `loyalty`, `promotions`, `settings`,
`support`, and `teams`:

```text
src/modules/<domain>/
  mod.rs  routes.rs  handlers.rs  service.rs  repository.rs  queries.rs  models.rs  validation.rs
```

The older flat-by-layer directories (`routes/`, `handlers/`, `services/`,
`repositories/`, `models/`) still hold most domains. Migrate one domain at a time,
preserving public routes and response shapes; never do a repo-wide move in one change.

Keep these global areas: `core/`, `services/audit.rs`,
`database/postgres/migrations/0001_v1_baseline.sql`, `database/postgres/seed.sql`.

New or refactored frontend features use:

```text
src/features/<domain>/
  api.ts  types.ts  constants.ts  utils.ts  hooks/  components/  pages/  index.ts
```

Refactored desktop Rust moves toward `src-tauri/src/{commands,process,postgres}/` plus
`config.rs` and `paths.rs`.

## Naming conventions

### Rust

- Files, modules, functions, variables: `snake_case`. Types/structs/enums/traits: `PascalCase`. Constants: `SCREAMING_SNAKE_CASE`.
- `_handler` suffix only inside handler modules; route wrappers use action names such as `create_booking`.
- Repository methods use persistence verbs: `find_by_id`, `list`, `insert`, `update`, `delete`, `exists`.
- Service methods use domain verbs: `check_in_booking`, `void_booking`, `calculate_invoice_totals`.
- Avoid `data`, `item`, `thing`, `do_update` when a domain name exists.

### TypeScript/React

- Components: `PascalCase` file and export names. Hooks: `useX` in `useX.ts`.
- Services: `<Domain>Service` in `<domain>.service.ts` until moved into feature-local `api.ts`.
- Types and interfaces: `PascalCase`. Constants: `SCREAMING_SNAKE_CASE` for fixed values.
- Event handlers: `handleX`. Boolean props/state: `isX`, `hasX`, `canX`, `shouldX`.

## Testing expectations

Add or update tests when refactoring pure business logic, SQL builders, date/money/
status/permission/validation logic, and anything touching auth, 2FA, passkeys, eKYC,
booking state transitions, payments, ledgers, or night audit.

Backend integration tests require `DATABASE_URL`: 15 of the 19 files in
`hotel-app-be/tests/` return early without it and the suite still exits 0. Verify by run
count (a real full run is ~513 passed / 10 ignored; ~209 means only lib tests ran), never
by exit code alone. Fix-gated tests carry `#[ignore]`; CI fails when one starts passing,
which means the fix landed and the attribute is stale.

The frontend runs Vitest with Testing Library (`bun run test`). `typecheck`, `lint`, and
`test` are three independent gates — vitest transpiles without type information, so code
using APIs newer than `lib: ES2020` passes tests and fails typecheck.

## Dependency rules

- Avoid unnecessary new dependencies; prefer the standard library or an existing crate/package.
- Add one only when it removes substantial complexity, improves safety, or implements a nontrivial domain well.
- Do not add overlapping libraries for state, HTTP, validation, dates, UI, or charts without a strong reason.
- Keep backend rate limiting in the existing in-memory implementation unless a separate task approves a different design.
- Frontend HTTP stays on `ky` through `src/api/client.ts`; frontend UI prefers MUI and existing shared components.
- If you add a dependency, explain why, scope it to the project that needs it, and verify the lockfile diff. `bun update <name>` on a *transitive* dependency silently promotes it to a direct dependency — fix transitives by removing their `bun.lock` entries and reinstalling.

## Refactoring rules

- Keep refactors incremental and reviewable. Do not combine broad restructuring with feature changes unless asked.
- Move code before rewriting it. Extract pure helpers first, then services, then repositories.
- Add tests around extracted logic before or alongside behavior-preserving moves.
- One domain at a time. Prefer small route-guard/helper refactors before bookings, rooms, ledgers, and analytics.
- Avoid mechanical repo-wide formatting churn; format touched files only.
- Remove compatibility layers only after all callers have migrated — and generate the rename map by parsing the layer itself rather than writing it by hand. Test files reference such layers as `vi.mock` object *keys*, which no call-site regex matches.
- Keep barrel exports purposeful; do not create import cycles.
- Document any intentional behavior change in the final summary.

## Safety rules for preserving behavior

- Treat existing behavior as the specification unless there is a clear bug, security issue, or data-loss risk.
- Do not change route paths, HTTP methods, status codes, response fields, permission names, storage keys, or database column meanings during a refactor.
- Schema changes go into the V1 baseline plus an idempotent patch for live databases. Nothing in this repo applies a second migration file, so a new `000N_*.sql` is inert.
- Do not delete legacy code until a qualified grep confirms there are no callers. In this crate `main.rs` re-declares every module, so a `dead_code` warning describes the *bin* target only and can name an item that `tests/` still uses — grep `Struct::method` and `use hotel_app_be::` across `tests/` first.
- Do not change authentication, authorization, passkey, 2FA, payment, ledger, eKYC, or night audit behavior without targeted tests or explicit approval.
- Keep SQL parameterized; never interpolate user input. Sanitize free text with the existing utilities. Use transactions for multi-step mutations — and note that in PostgreSQL a failed statement aborts the whole transaction, so `let _ = sqlx::query(...)` is not a safe "best effort"; use a SAVEPOINT or propagate the error.
- Log internal error details server-side; return generic client-facing errors.
- Respect dirty worktrees. Do not revert or overwrite changes you did not make.

## Backend PostgreSQL contract

- Use `core/sql_compat.rs` helpers (`param!(N)`, `current_timestamp()`, `current_date()`) rather than hardcoded expressions.
- Use `core/db.rs` for value conversion (`decimal_to_db`, `opt_decimal_to_db`, `generate_uuid`) and `hotel_today(executor)` for business-day math.
- SQLx type checking is runtime-only here (plain `sqlx::query()`, not the macros), so a Rust-type/column-type mismatch compiles cleanly and fails in production. Any new `FromRow` struct over date, timestamp, numeric, or array columns needs one live-PostgreSQL test that actually fetches it.

## CodeGraph

The local index is generated in `.codegraph/`, which is Git-ignored and stays local.
Install with `npm install --global @colbymchenry/codegraph`, then `codegraph init .`;
`codegraph install --target=codex` wires the MCP server for Codex.

Use it for architecture, dependency, and impact questions before broad file searches:
`codegraph explore "<question>"`, `codegraph callers|callees|impact "<symbol>"`,
`codegraph node "<symbol-or-file>"`, `codegraph status .` for freshness. The MCP server
auto-syncs; `codegraph sync .` refreshes manually and `codegraph index . --force`
rebuilds.

Treat CodeGraph output as current source when it carries no staleness warning, but
verify authentication, authorization, payment, ledger, and migration findings against
the files. It indexes the backend, frontend, and desktop source trees only — SQL schema
and data resources, secrets, generated output, build artifacts, design-sync files, and
deployment infrastructure are outside the graph and must be inspected directly.
