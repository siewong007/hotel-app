# CLAUDE.md

Routing index for coding agents. Hard budget: **≤150 lines**, index/routing only — detail goes to
`.claude/refs/` (on demand), `.claude/rules/` (auto-loaded, keep lean), or `docs/`. Do not add
here without removing something. Facts verified 2026-09-17 against `origin/master` (`925fff188`).
**What deploys is `origin/master`, not this tree** — confirm with `git show origin/master:<path>`.
Line anchors rot; Grep first. This volume path has a trailing space — quote paths in shell.

## Read this first

| Situation | Read |
|---|---|
| Any non-trivial work | [.claude/rules/00-diagnosis.md](.claude/rules/00-diagnosis.md) — failure modes + checklists |
| Done / escalate / ask-user calls; past corrections | [.claude/rules/judgment-rubrics.md](.claude/rules/judgment-rubrics.md), [.claude/rules/lessons.md](.claude/rules/lessons.md) |
| Delegating to a subagent | [.claude/refs/model-dispatch.md](.claude/refs/model-dispatch.md), [.claude/refs/delegation-templates.md](.claude/refs/delegation-templates.md) |
| Architecture / caller / impact question | [.claude/refs/codegraph.md](.claude/refs/codegraph.md) — CodeGraph before broad searches |
| Bookings, ledgers, invoicing | [.claude/refs/booking-workflow.md](.claude/refs/booking-workflow.md), [.claude/refs/ledger-workflow.md](.claude/refs/ledger-workflow.md) |
| Editing `.claude/`, or after any failure | [.claude/refs/maintenance.md](.claude/refs/maintenance.md) (+ append `lessons.md`) |
| UI work / i18n / backup & restore | [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md), [docs/guides/internationalization.md](docs/guides/internationalization.md), [docs/guides/data-transfer.md](docs/guides/data-transfer.md) |
| Deploy, prod access, incidents | [docs/guides/deployment.md](docs/guides/deployment.md), [docs/guides/vps-access.md](docs/guides/vps-access.md), [docs/security/](docs/security/) |
| Architecture & decisions (13 ADRs) | [docs/architecture/architecture-flow.md](docs/architecture/architecture-flow.md), [docs/architecture/ADRS.md](docs/architecture/ADRS.md) |
| Desktop build / packaging | [docs/guides/PACKAGING.md](docs/guides/PACKAGING.md), [hotel-desktop/BUILD_SPEED.md](hotel-desktop/BUILD_SPEED.md), [hotel-desktop/UPDATER.md](hotel-desktop/UPDATER.md) |
| What exists / what's next | [docs/FEATURES.md](docs/FEATURES.md), [docs/ongoing-dev.md](docs/ongoing-dev.md) |

[AGENTS.md](AGENTS.md) owns naming, refactoring safety, and dependency policy — not repeated here.
The two must agree: fix both or neither.

## Overview and layout

Hotel PMS: bookings, rooms, housekeeping, rates, payments, guest/city ledgers, invoicing, night
audit, loyalty, promotions, eKYC, guest portal, analytics. Ships as a web app **and** a desktop app
bundling its own PostgreSQL. Three projects, no root workspace — run commands from the subdirectory:

- `hotel-app-be/` — Rust 1.95.0 (edition 2024), Axum 0.8, SQLx 0.9, PostgreSQL, JWT + bcrypt.
- `hotel-web-fe/` — React 19, TypeScript ~6.0, Vite 8, MUI v9, TanStack Query/Router/Table, ky 2, Nivo.
- `hotel-desktop/` — Tauri 2; backend sidecar + embedded PostgreSQL in `src-tauri/pgsql/`.

`bun` is the FE/desktop package manager (`bun.lock`, no package-lock.json). `.codegraph/` is Git-ignored
and local; `codegraph.json` (tracked) holds its exclude list.

## Commands

```bash
# hotel-app-be/
cargo check --all-features                    # minimum bar before claiming done
cargo clippy --all-features -- -D warnings    # what CI runs — copy verbatim
cargo test --all-features                     # set DATABASE_URL or the PG suites silently skip
cargo run --bin hotel-app-be                  # :3030 (bare `cargo run` errors: multiple bins)
# hotel-web-fe/  — four independent gates; vitest is weakest (transpiles without type info)
bun run start                                 # Vite :3000, proxies to 127.0.0.1:3030
bun run typecheck && bun run lint:strict && bun run test && bun run build
# hotel-desktop/
bun run dev | build | build:no-bundle | desktop:prepare:force | sync:resources
```

Root `Makefile` wraps the common ones (`make help`): `dev-be`, `check-all`, `lint-all`, `test-all`, `docker-up`, `docs-check`, `db-*`.

## Database — PostgreSQL only

`make db-baseline` (baseline + seed.sql + patches = structure & system bootstrap) initializes an
empty DB **once**; `make db-seed` loads `staging.sql` demo data (optional, never production);
`make db-patch` converges an existing V1 database. **There is no second migration file** — the only
forward path is `hotel-app-be/database/postgres/patches/`, a checksum-verified catalog driven by
`manifest.tsv` (generation 1, head version 8 — read the manifest, never a
remembered range), applied by `apply-patches.sh` and `hotel-desktop/src-tauri/src/postgres/patches.rs`. Lifecycle
details (deprecated `db-setup` alias, legacy rebuild path): `hotel-app-be/database/README.md`.

- **Nothing discovers loose SQL.** A new `000N_*.sql` is dead until registered in `patches/manifest.tsv`, `deploy/deploy.sh`, `deploy/deploy-staging.sh`, **and both** `.github/workflows/deploy*.yml`. `tests/postgres_patch_catalog.rs` enforces that parity.
- Additive change → baseline (fresh installs) **and** a new patch (installed DBs). A patch must converge *both* the current baseline and the previous one: guard on exact `pg_get_constraintdef`/`pg_get_functiondef` text like `0002` does, and `RAISE` otherwise.
- Shipped versions/checksums are **immutable** — add a version, never edit a patch. The V1 baseline checksum in `_begin.sql`/`seed.sql` is a **frozen lineage token, not a file hash**; rotating it aborts every patch on every installed database.
- New columns go **last** in their `CREATE TABLE` (`ADD COLUMN` lands at the last attnum). The baseline is pg_dump-shaped — bodies, then PKs, then FKs; an inline `REFERENCES` fails.
- Prove convergence with a `pg_dump --schema-only` diff of fresh vs old-baseline+patch; only that catches a dropped `COMMENT ON COLUMN`. Mirror into `hotel-desktop/src-tauri/database/postgres/` via `bun run sync:resources` (plain copy — should be byte-identical).
- `seed.sql` is one self-validating transaction that `RAISE`s on re-apply; adding a permission/route/action touches several checklists inside it. `.gitattributes` pins `*.sql`/`*.tsv` to `eol=lf` — a CRLF checkout silently disables the catalog (both executors hash raw bytes).

## Backend

`modules/<domain>/routes.rs` (RBAC gate) → auth middleware → `handlers.rs` (thin) →
`service.rs` (where a domain has one) → `repository.rs` → `models.rs`. **All domains live in
`modules/<domain>/`** — 38 are merged in `routes/mod.rs::create_router`; `consent` is the only
routeless module — **put new domains there**. The residual flat files are shared globals only:
`routes/mod.rs` composition, `services/{audit,account_emails,google_identity,invoice_numbers}.rs`,
`repositories/{audit,invoice_numbers}.rs`, `models/{audit,common,row_mappers}.rs`.

- `routes/mod.rs::create_router` — every router must be `.merge()`d here (38 today) or it is dead. Wires CORS, rate limits, security headers.
- `core/middleware.rs` — `require_auth(&headers) -> i64`, `check_permission(pool, user_id, "<resource>:<action>")`, `check_any_permission`, `ensure_super_admin`. `<resource>:manage` implies every action of that resource.
- `core/db.rs` — `hotel_today(executor)`, `decimal_to_db`, `generate_uuid`. Each connection takes its timezone from `system_settings.timezone`, so SQL `CURRENT_DATE` **is** the business day. Never use `chrono::Local`/`Utc` for business dates.
- `core/sql_compat.rs` — `param!(N)`, `current_timestamp()`, `current_date()`. Never literal `$1`/`NOW()`.
- `core/i18n.rs` — `SUPPORTED_LOCALES = ["en","ms","zh","zh-TW"]`, `Accept-Language` negotiation, email catalogs in `core/locales/`. Every mutating handler calls `services/audit.rs`; free text goes through `utils/sanitization.rs::Sanitizer`; request models carry `validator` derives.
- `main.rs` spawns every background loop through `core::leader::spawn_exclusive` (night audit, payment receipts, unpaid-hold release — window `unpaid_hold_release_hours`, 24 default / 0 disables — communications worker + scheduler, rate-limit bucket prune): a `pg_advisory_lock` on a pinned connection makes exactly one replica drive each loop, and `core::cache_bus::spawn_listener` LISTENs for cross-replica cache invalidation + data-change fan-out. Rate limits live in `rate_limit_buckets` (Postgres fixed windows, fail-open on DB error) — `RateLimiters::new(pool)`; `RateLimiter::new(config)` is the memory-only test constructor. Adding/removing **any** route drifts `docs/api/openapi.json` and fails `tests/openapi_drift.rs` — regenerate with `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift`.

`sqlx` is plain `sqlx::query()`, **not** the checking macros — a type/column mismatch compiles cleanly
and fails in production. Any new `FromRow` over date/timestamp/numeric/array columns needs a
live-PostgreSQL test that actually fetches it.

## Frontend

- `src/features/<domain>/` (26); `src/api/*.service.ts`, one per backend domain (24). Server state is TanStack Query; there is no separate client-state store.
- **All** HTTP through `src/api/client.ts` (ky: in-memory access token, HttpOnly refresh cookie, one refresh-and-retry on 401). Never call `fetch` directly.
- New pages go in **both** `src/routes/*.tsx` and the lazy registry `src/navigation/routeRegistry.tsx` (not App.tsx). The sidebar reads that registry; `route_access_policies` only drives the RBAC admin panel.
- Vite proxies only `PROXY_PREFIXES` (`/api`, `/uploads`, `/health`, `/ws`). A new `/api/...` route needs no edit; a new **top-level** prefix needs one here *and* in the desktop CORS allow-list (`hotel-desktop/src-tauri/src/commands.rs`).
- `lint:strict` (`--max-warnings=0`) is a CI gate. `no-restricted-syntax` bans `toISOString().split/.slice` (use `src/utils/date.ts`), `*.response.json()` (ky 2 already consumed the body — use `readErrorData`), and `replace(/_/g,' ')` enum humanizing (use `formatStatusLabel`).
- **UI:** one semantic token layer (`src/theme/tokens.ts`) feeds the MUI theme, republished as `--hotel-*` CSS vars. Consume semantic roles, never raw hex; add a missing role rather than a one-off value. Status tones must clear WCAG AA 4.5:1 over the worst surface they sit on. Print/PDF keeps its own literal palette.
- **i18n:** hand-rolled on `Intl`, **no i18next** (ADR 012). `useTranslation(ns)` → `{ t, tOr, locale, setLocale }`; `t('ns:key')` crosses namespaces, `tOr(key, fallback)` covers un-migrated screens. Bundles: `src/i18n/resources/<locale>/<ns>.json`; a parity test asserts matching keys. Placeholders are `{{name}}`, matching backend email templates.

## Testing

Backend: 53 files in `hotel-app-be/tests/`; PG-backed ones **skip without `DATABASE_URL`, exit 0,
and each skip counts as a PASS** — a no-DB run reports *more* (1,317; `payment_characterization`
44-in-0.01s vs a real 29 passed / 2 ignored), so run count cannot detect it: judge by wall-clock +
per-suite counts. Patch/drift suites need `psql`. Fix-gated tests carry `#[ignore]`; CI fails when
one starts passing. Characterization tests must assert *correct* values — one pinning a bug passes
forever. Frontend: Vitest + Testing Library (253 files); build ky errors with
`src/api/testSupport/httpError.ts` (a readable-body fixture lets the bug pass); never run two
vitest suites concurrently here — they starve each other's timeouts.

## CI, deployment, environment

`.github/workflows/ci.yml` (push/PR to master) runs **eight** jobs: secret scan + `cargo audit`;
**Markdown link check** (`scripts/check-doc-links.py` — a broken relative link in any `.md` fails
CI); **desktop DB mirror** (`make db-mirror-check`); FE typecheck/lint:strict/test/build; BE
check/test/clippy/release + schema/booking smoke; a full PostgreSQL suite with a stale-`#[ignore]`
check; and a desktop `cargo check` against
placeholder resources — **so a broken `tauri build` is not caught by CI**. Deploy triggers only on a
successful CI run on master (no `workflow_dispatch` by design). A green "Deploy production" run may
still have deployed nothing — read the job conclusion. Never hand-provision secrets on the host; CI
owns them. A rolled-back host is a **mixed** state: read `SELECT version();` and the running compose
file, not the intent.

Env: root `.env.example` feeds `docker compose`; `hotel-app-be/.env.example` is the full backend
reference. Real `.env` files exist here, are Git-ignored, and hold live secrets — **never read one
into a document, commit, or log**. Required: `DATABASE_URL`, `JWT_SECRET` (≥32 chars),
`POSTGRES_PASSWORD` for Compose; the latter two are `:?` in every compose file so an unset value
aborts rather than starting insecurely. Production requires `ENVIRONMENT=production`.

**Desktop mode:** `HOTEL_DESKTOP_MODE` → backend binds 127.0.0.1 on a probed free port from
`BACKEND_PORT`, learned by the webview over Tauri IPC. The sidecar gets a *specific*
`ALLOWED_ORIGINS` list, not the wildcard — and since the webview origin differs, `SameSite` refresh
cookies never reach it, so desktop cannot restore a session after restart (accepted). **Any inline
`<script>` is dead under the packaged CSP** and nothing flags it when browser-served.

## Changing existing behavior

Treat existing behavior as the spec absent a clear bug, security issue, or data-loss risk. Do not
change route paths, methods, status codes, response fields, permission names, storage keys, or
column meanings in a refactor. Money, tax, auth, RBAC, passkey, 2FA, eKYC, booking state, ledger,
and night-audit changes need targeted tests or approval — where the spec is ambiguous there, **ask;
never guess financial policy**. Before "fixing" a rule that rejects valid-looking input, grep the
test tree for the invariant behind it. `hotel-backup` v1 JSON carries **business data only** — never
password hashes, sessions, tokens, or eKYC evidence; it is not a `pg_dump` replacement, and import
ordering is FK-sensitive (verify with an end-to-end round trip). **Concurrent sessions share this
tree:** run `git status --short --branch` before editing — an already-dirty path is someone else's
work, and two sibling worktrees live under `.worktrees/`.
