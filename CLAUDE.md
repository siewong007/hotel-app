# CLAUDE.md

Index and routing for agents in this repo. Keep this file ≤150 lines — long
content belongs in `.claude/refs/` (facts about the code, loaded on demand) or
`.claude/rules/` (how agents work; NOTE: the harness auto-loads `.claude/rules/*.md`
every session, so keep those lean). Do not add content here without removing something.

## Read-this-first routing

| Situation | Read |
|---|---|
| Any non-trivial work | `.claude/rules/00-diagnosis.md` (top failure modes + mandatory checklists) |
| Before delegating to a subagent | `.claude/rules/model-dispatch.md` + `.claude/rules/delegation-templates.md` |
| Escalate / done / ask-user / change-approach decisions | `.claude/rules/judgment-rubrics.md` |
| Changing `.claude/` files, or after any failure/correction | `.claude/rules/maintenance.md` (+ append `lessons.md`) |
| Working on bookings | `.claude/refs/booking-workflow.md` |
| Working on ledgers / city ledger / invoicing | `.claude/refs/ledger-workflow.md` |
| Desktop/Tauri build or packaging | `hotel-desktop/BUILD_SPEED.md`, `hotel-desktop/UPDATER.md` |
| Architecture overview / deployment / ADRs | `docs/architecture/architecture-flow.md`, `docs/guides/deployment.md`, `docs/architecture/ADRS.md` |
| Architecture, dependency, caller, or change-impact question | `.claude/refs/codegraph.md` — use CodeGraph before broad repository searches |
| Using Codex (OpenAI) for second opinions / cross-vendor review | `.claude/refs/codex-collab.md` |
| Picking the next improvement / tech-debt work | `docs/ongoing-dev.md` |

Line anchors cited in refs rot as code moves — verify with Grep before relying on them.
This volume path contains a trailing space ("…EXTERNAL SSD ") — always quote paths in shell.

## Repository layout

Three-project monorepo; no root workspace — run commands from the subdirectory:

- `hotel-web-fe/` — React 19 + TypeScript (Vite, MUI v7, TanStack Query + Router)
- `hotel-desktop/` — Tauri 2 wrapper: backend as sidecar + embedded PostgreSQL under `src-tauri/pgsql/`

`AGENTS.md` is the Codex-oriented rulebook (overlapping content) — owned by other tooling; ask before editing.

CodeGraph is the repository's only code-graph system. Its local `.codegraph/` index is
Git-ignored; use it for architecture and impact discovery, then verify security-,
authorization-, payment-, ledger-, and migration-critical findings against source files.

## Common commands

Backend (`hotel-app-be/`):
```bash
cargo check --all-features                    # minimum bar before claiming done
cargo clippy --all-features -- -D warnings    # what CI actually runs
cargo run                                     # PostgreSQL mode, port 3030
psql "$DATABASE_URL" -f database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f database/postgres/data.sql
psql "$DATABASE_URL" -f database/postgres/seed.sql                 # one-time V1 initialization
cargo test <name>                             # single test by substring
cargo run --bin hash_password -- <password>   # helper bins in src/bin/
```

Frontend (`hotel-web-fe/`):
```bash
bun run start        # Vite dev on :3000, proxies API to 127.0.0.1:3030
bun run typecheck && bun run lint && bun run test   # CI gates (lint errors fail build)
bun run build
```

Desktop (`hotel-desktop/`):
```bash
bun run dev                    # tauri dev with backend sidecar
bun run build                  # production installer
bun run build:no-bundle       # production binary, no installer
bun run desktop:prepare:force  # force resource/frontend/backend/sidecar refresh
```

CI (`.github/workflows/ci.yml`, push/PR to master): FE typecheck+lint+test+build;
BE check/clippy/build `--all-features -D warnings` + PostgreSQL tests and schema
smoke. The desktop job is only a `cargo check` with placeholder resources — a
broken `tauri build` is NOT caught by CI.

## Architecture essentials

Backend request flow: `routes/<domain>.rs` → auth middleware → `handlers/<domain>.rs`
→ (some domains) `services/<domain>.rs` for cross-cutting checks/logic →
`repositories/` or inline SQL → `models/`. Key modules:
- `routes/mod.rs::create_router` — ALL domain routers must be `.merge()`d here; wires CORS, rate limits, security headers.
- `core/auth.rs` + `core/middleware.rs` — `require_auth(&headers)`; `check_permission(pool, user_id, "<resource>:<action>")`; `<resource>:manage` implies all actions of that resource.
- `core/db.rs` — PostgreSQL pool creation and database value helpers; each connection receives the timezone from `system_settings.timezone`.
- `core/rate_limiter.rs` — in-memory rate limiting, injected as an Extension.
- `services/audit.rs` — call from every mutating handler; `utils/sanitization.rs::Sanitizer` for free-text input; `utils/validation.rs` for shape validation.

PostgreSQL is the only database engine. Every SQL change must compile under
`--all-features`. PostgreSQL V1 initialization is the baseline migration,
`data.sql`, then `seed.sql`, exactly once for a new empty database. Docker and
desktop use that same sequence.

Frontend:
- `src/features/<domain>/` feature modules; `src/api/*.service.ts` one per backend domain.
- ALL HTTP via `src/api/client.ts` (ky; bearer token from storage, idempotent-GET retries, 401 → `auth:unauthorized` event). Never call `fetch` directly.
- `src/utils/storage.ts` for localStorage; `src/auth/AuthContext.tsx` for auth state + permission helpers.
- Routing: TanStack Router file-based routes in `src/routes/*.tsx` + lazy page registry `src/navigation/routeRegistry.tsx` — add new pages in BOTH (not App.tsx; verified 2026-07-07).
- Vite dev proxy list in `vite.config.ts` is hand-maintained — add new top-level API prefixes or dev 404s.
- Dates: `toISOString().split/.slice` is lint-banned (CI fails); use `src/utils/date.ts` helpers.
- `tsconfig.json` has `strict: false` — don't assume strict typing.

Desktop mode: `HOTEL_DESKTOP_MODE` env → backend binds 127.0.0.1 on a dynamically
probed free port starting at `BACKEND_PORT` (default 3030); the webview learns the
port via Tauri IPC (`commands.rs` `get_status` / `backend-ready` event → FE
`src/desktop/runtimeApi.ts`). Desktop launches the sidecar with a SPECIFIC
`ALLOWED_ORIGINS` list (`tauri://localhost`, …) — not the wildcard; `*` exists in
the backend as a permissive option but desktop does not use it.

## Conventions (from CONTRIBUTING.md)

- Parameterize all SQL; never interpolate user input. Sanitize free text. Transactions for multi-step mutations.
- Generic errors to clients; log specifics server-side.
- FE: prefer MUI components; request/response types in `src/types/`.
- Test backend query changes with PostgreSQL (minimum: `cargo check --all-features`).

## Environment

Required (see `hotel-app-be/.env.example`): `DATABASE_URL` (postgres) /
`ALLOWED_ORIGINS` (comma-separated; `*` = permissive), `HOTEL_DESKTOP_MODE`,
`VITE_API_URL` (optional build-time override; web defaults to dynamic same-origin
routing and dev uses the Vite proxy). Optional pool/cache tuning
vars are read in `core/db.rs::create_pool` and `core/rbac_cache.rs`.

MCP servers (analytics-server, hotel-search-server): described in
`hotel-app-be/README.md` as `hotel-app-be/mcp-server/`, but that directory does
NOT exist on disk (verified 2026-07-05) — treat as external or aspirational.
