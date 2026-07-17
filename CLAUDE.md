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
| Onboarding context from the 2026-07-05 Fable session | `.claude/refs/letter-to-future-sessions.md` |
| Using Codex (OpenAI) for second opinions / cross-vendor review | `.claude/refs/codex-collab.md` |
| Picking the next improvement / tech-debt work | `docs/ongoing-dev.md` |

Line anchors cited in refs rot as code moves — verify with Grep before relying on them.
This volume path contains a trailing space ("…EXTERNAL SSD ") — always quote paths in shell.

## Repository layout

Three-project monorepo; no root workspace — run commands from the subdirectory:

- `hotel-app-be/` — Rust backend API (Axum + SQLx; dual PostgreSQL/SQLite via cargo features)
- `hotel-web-fe/` — React 19 + TypeScript (Vite, MUI v7, TanStack Query + Router)
- `hotel-desktop/` — Tauri 2 wrapper: backend as sidecar + embedded PostgreSQL under `src-tauri/pgsql/`

`AGENTS.md` is the Codex-oriented rulebook (overlapping content) — owned by other tooling; ask before editing.

## Common commands

Backend (`hotel-app-be/`):
```bash
cargo check --all-features                    # minimum bar before claiming done
cargo clippy --all-features -- -D warnings    # what CI actually runs
cargo run                                     # PostgreSQL mode, port 3030
cargo run --features sqlite --no-default-features   # SQLite mode (DATABASE_PATH, default ./hotel_data.db)
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
BE check/clippy/build `--all-features -D warnings` + tests on both DBs + schema
smoke. The desktop job is only a `cargo check` with placeholder resources — a
broken `tauri build` is NOT caught by CI.

## Architecture essentials

Backend request flow: `routes/<domain>.rs` → auth middleware → `handlers/<domain>.rs`
→ (some domains) `services/<domain>.rs` for cross-cutting checks/logic →
`repositories/` or inline SQL → `models/`. Key modules:
- `routes/mod.rs::create_router` — ALL domain routers must be `.merge()`d here; wires CORS, rate limits, security headers.
- `core/auth.rs` + `core/middleware.rs` — `require_auth(&headers)`; `check_permission(pool, user_id, "<resource>:<action>")`; `<resource>:manage` implies all actions of that resource.
- `core/db.rs` — pool creation; on PostgreSQL sets per-connection timezone from `system_settings.timezone`; cross-DB value helpers (`decimal_to_db`, `opt_decimal_to_db`, `generate_uuid`).
- `core/sql_compat.rs` — `sql_query!(postgres: …, sqlite: …)`, `param!(N)`, `current_timestamp()`, `current_date()`.
- `core/rate_limiter.rs` — in-memory rate limiting, injected as an Extension.
- `services/audit.rs` — call from every mutating handler; `utils/sanitization.rs::Sanitizer` for free-text input; `utils/validation.rs` for shape validation.

Dual-database contract (full checklist: `.claude/rules/00-diagnosis.md` Leak #2):
one DB per production build (default `postgres`); every SQL change must compile
under `--all-features`. PostgreSQL V1 = baseline migration, then `data.sql`,
then `seed.sql`, exactly once for a new empty database; Docker and desktop use
that same order and do not rerun it for existing V1 data. SQLite embeds the
corresponding V1 baseline, data, and seed scripts and applies them once only to
a new empty database. There is no SQLite legacy migration. Schema changes must
touch BOTH database paths.
Note: `hotel-desktop` does NOT use the sqlite feature (it ships embedded PostgreSQL);
sqlite serves the standalone lightweight server mode and CI. Removal decided
2026-07-08, execution pending — see `docs/ongoing-dev.md` (plan in `.claude/reports/`).

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
- Test backend query changes against both DBs (minimum: `cargo check --all-features`).

## Environment

Required (see `hotel-app-be/.env.example`): `DATABASE_URL` (postgres) /
`DATABASE_PATH` (sqlite), `JWT_SECRET` (≥32 chars), `BACKEND_PORT` (3030),
`ALLOWED_ORIGINS` (comma-separated; `*` = permissive), `HOTEL_DESKTOP_MODE`,
`VITE_API_URL` (prod FE only; dev uses the Vite proxy). Optional pool/cache tuning
vars are read in `core/db.rs::create_pool` and `core/rbac_cache.rs`.

MCP servers (analytics-server, hotel-search-server): described in
`hotel-app-be/README.md` as `hotel-app-be/mcp-server/`, but that directory does
NOT exist on disk (verified 2026-07-05) — treat as external or aspirational.
