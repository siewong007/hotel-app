# CLAUDE.md

Index and routing for agents in this repo. Keep this file ≤150 lines — long content
belongs in `.claude/refs/` (facts about the code, loaded on demand) or `.claude/rules/`
(how agents work; the harness auto-loads `.claude/rules/*.md` every session, so keep
those lean). Do not add content here without removing something.

Facts below verified against the tree 2026-08-02. Line anchors in refs rot as code moves —
verify with Grep first. This volume path has a trailing space ("…EXTERNAL SSD ") — always
quote paths in shell.

## Read-this-first routing

| Situation | Read |
|---|---|
| Any non-trivial work | `.claude/rules/00-diagnosis.md` (top failure modes + mandatory checklists) |
| Before delegating to a subagent | `.claude/refs/model-dispatch.md` + `.claude/refs/delegation-templates.md` |
| Escalate / done / ask-user / change-approach decisions | `.claude/rules/judgment-rubrics.md` |
| Changing `.claude/` files, or after any failure/correction | `.claude/refs/maintenance.md` (+ append `lessons.md`) |
| Working on bookings | `.claude/refs/booking-workflow.md` |
| Working on ledgers / city ledger / invoicing | `.claude/refs/ledger-workflow.md` |
| Architecture, dependency, caller, or change-impact question | `.claude/refs/codegraph.md` — use CodeGraph before broad repository searches |
| Cross-vendor second opinion via Codex | `.claude/refs/codex-collab.md` |
| Desktop/Tauri build or packaging | `hotel-desktop/BUILD_SPEED.md`, `hotel-desktop/UPDATER.md` |
| Architecture / deployment / decisions | `docs/architecture/architecture-flow.md`, `docs/guides/deployment.md`, `docs/architecture/ADRS.md` |
| Production access, backups, incident response | `docs/guides/vps-access.md`, `docs/security/` |
| Picking the next improvement / tech-debt work | `docs/ongoing-dev.md` |

`AGENTS.md` owns the conventions this file only summarizes (naming, refactoring safety,
dependency policy). The two must agree — fix both or neither.

## Repository layout

Three-project monorepo; no root workspace — run commands from the subdirectory:

- `hotel-app-be/` — Rust 1.95 backend API (Axum 0.8, SQLx 0.8, PostgreSQL 19)
- `hotel-web-fe/` — React 19 + TypeScript 6 (Vite 8, MUI v9, TanStack Query + Router)
- `hotel-desktop/` — Tauri 2 wrapper: backend as sidecar + embedded PostgreSQL under `src-tauri/pgsql/`

`bun` is the frontend and desktop package manager (`bun.lock`; there is no
package-lock.json). CodeGraph's `.codegraph/` index is Git-ignored and local.

## Common commands

Backend (`hotel-app-be/`):
```bash
cargo check --all-features                    # minimum bar before claiming done
cargo clippy --all-features -- -D warnings    # what CI actually runs — copy it verbatim
cargo test --all-features                     # DATABASE_URL must be set or 15 of 19 test files silently skip
cargo run --bin hotel-app-be                  # port 3030 (bare `cargo run` errors: multiple bins)
cargo run --bin hash_password -- <password>   # helper bins in src/bin/ (also fix_password)
psql "$DATABASE_URL" -f database/postgres/migrations/0001_v1_baseline.sql
psql "$DATABASE_URL" -f database/postgres/seed.sql   # one-time V1 initialization
```

Frontend (`hotel-web-fe/`) — `bun run start` (Vite :3000, proxies to 127.0.0.1:3030),
then `bun run typecheck && bun run lint && bun run test` (three independent gates; vitest
is the weakest — it transpiles without type info) and `bun run build`.

Desktop (`hotel-desktop/`) — `bun run dev` (tauri dev + sidecar), `bun run build`
(installer), `build:no-bundle` (binary only), `desktop:prepare:force` (refresh resources).

Root `Makefile` wraps the common ones (`make dev-be`, `check-all`, `test-all`, `lint-all`,
`docker-up`, `db-setup`); `make help` lists all targets.

CI (`.github/workflows/ci.yml`, push/PR to master) runs five jobs: secret scan +
`cargo audit`; FE typecheck + `lint:strict` + test + build; BE check/test/clippy/release
plus PostgreSQL schema and booking smoke; a full PostgreSQL suite with a stale-`#[ignore]`
check; and a desktop `cargo check` against placeholder resources — so a broken
`tauri build` is NOT caught by CI. Deploy runs on a successful CI run on master only.

## Architecture essentials

Backend request flow: `routes/<domain>.rs` (RBAC gate) → auth middleware →
`handlers/<domain>.rs` (thin) → `services/<domain>.rs` (business logic, where a domain
has one) → `repositories/` → `models/`. Nine domains have migrated to the newer
`modules/<domain>/` layout (analytics, communications, ekyc, guest_booking, loyalty,
promotions, settings, support, teams) — put new domains there.

- `routes/mod.rs::create_router` — ALL domain routers must be `.merge()`d here; wires CORS, rate limits, security headers.
- `core/auth.rs` + `core/middleware.rs` — `require_auth(&headers)`; `check_permission(pool, user_id, "<resource>:<action>")`; `<resource>:manage` implies all actions of that resource.
- `core/db.rs` — pool creation, `hotel_today(executor)` for business-day math, decimal helpers. Each connection gets the timezone from `system_settings.timezone`, so SQL `CURRENT_DATE` is the hotel business day. Never use `chrono::Local`/`Utc` date math for business dates.
- `core/sql_compat.rs` — `param!(N)` placeholders, `current_timestamp()`, `current_date()`.
- `services/audit.rs` — call from every mutating handler; `utils/sanitization.rs::Sanitizer` for free text; `validator` derives on request models.

PostgreSQL is the only engine. A new empty database is initialized exactly once by the
V1 baseline then `seed.sql`; Docker, server and desktop share that sequence, and legacy
schemas are exported and rebuilt rather than migrated. **Nothing in the repo applies a
second migration file** — CI, deploy, the desktop sync script and `postgres.rs` all
hardcode `0001_v1_baseline.sql`, so schema changes go into the baseline plus an
idempotent patch for live databases. `seed.sql` is one self-validating transaction that
`RAISE`s on re-apply; adding a permission/route/action touches several checklists inside it.

Frontend:
- `src/features/<domain>/` feature modules; `src/api/*.service.ts` one per backend domain.
- ALL HTTP via `src/api/client.ts` (ky; in-memory access token, HttpOnly refresh cookie, idempotent-GET retries, one refresh-and-retry on 401). Never call `fetch` directly.
- Server state is TanStack Query; there is no separate client-state store library.
- Routing: TanStack Router file routes in `src/routes/*.tsx` **and** the lazy registry `src/navigation/routeRegistry.tsx` — add new pages to BOTH (not App.tsx). The sidebar reads the registry; `route_access_policies` rows only drive the RBAC admin panel.
- Vite dev proxy list in `vite.config.ts` is hand-maintained — add new top-level API prefixes or dev 404s.
- Dates: `toISOString().split/.slice` is lint-banned (CI fails); use `src/utils/date.ts`.
- `tsconfig.json` has `strict: false` (`strictNullChecks` on) and `lib: ES2020` — `.at()`, `Object.groupBy`, `findLast` fail typecheck even though vitest accepts them.

Desktop mode: `HOTEL_DESKTOP_MODE` env → backend binds 127.0.0.1 on a dynamically probed
free port starting at `BACKEND_PORT` (default 3030); the webview learns the port via
Tauri IPC (`commands.rs` `get_status` / `backend-ready` → FE `src/desktop/runtimeApi.ts`).
The sidecar gets a SPECIFIC `ALLOWED_ORIGINS` list (`tauri://localhost`, …), not the
wildcard. Any inline `<script>` in HTML the webview loads is dead under the packaged CSP.

## Environment

Two example files, every variable in each read by something: root `.env.example` is what
`docker compose` reads (Postgres credentials, ports, TLS, image tags);
`hotel-app-be/.env.example` is the full backend-process reference.

Required: `DATABASE_URL`, `JWT_SECRET` (≥32 chars), plus `POSTGRES_PASSWORD` for Compose.
The latter two are declared `:?` in every compose file and ship blank, so an unset or
empty value aborts `docker compose` rather than starting insecurely. Optional:
`BACKEND_PORT` (3030), `ALLOWED_ORIGINS`, `TRUST_PROXY_HEADERS`, `PASSKEY_RP_ID`,
`GOOGLE_CLIENT_ID`, `HOTEL_DESKTOP_MODE`, `SMTP_*` (enables the email worker),
`VITE_API_URL`, plus pool/cache tuning read in `core/db.rs::create_pool` and
`core/rbac_cache.rs`. Production requires `ENVIRONMENT=production`.

**Concurrent sessions share this tree** — `git status --short` before editing; an
already-dirty path is someone else's in-flight work. Details in `lessons.md` theme 1.
