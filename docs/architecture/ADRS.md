# Architecture Decision Records (ADRs)

This document tracks key architectural decisions made for the hotel management system.

## ADR 001: Three-Project Monorepo Structure

**Status:** Accepted (2025)

**Context:** The project needed to serve both web and desktop deployment targets while sharing backend logic.

**Decision:** Organize as a monorepo with three independent subdirectories:
- `hotel-app-be/` — Rust backend API
- `hotel-web-fe/` — React web frontend
- `hotel-desktop/` — Tauri desktop wrapper

Each has its own build system, dependency management, and CI jobs. There is no root-level package manager.

**Consequences:**
- ✅ Independent versioning and CI for each project
- ✅ Clear separation of concerns
- ✅ Desktop can embed backend as a sidecar without coupling
- ❌ No shared dependency management (must install per project)
- ❌ Must update CI matrix when adding workspace-level changes

---

## ADR 002: PostgreSQL-Only Persistence

**Status:** Accepted (2026)

**Context:** Web, Docker, and desktop deployments all use PostgreSQL. Maintaining
an additional compile-time database backend created schema drift, duplicated
queries, and test paths that did not represent the shipped desktop architecture.

**Decision:** PostgreSQL is the only supported database engine. SQLx is compiled
with PostgreSQL support, `DATABASE_URL` is required, and all deployment targets
use the PostgreSQL V1 lifecycle.

**Consequences:**
- ✅ One schema and query implementation
- ✅ Desktop and server deployments exercise the same database behavior
- ✅ Database tests represent the production engine
- ❌ Local development requires PostgreSQL

---

## ADR 003: Layered Backend Architecture (Routes → Handlers → Services → Repositories → Models)

**Status:** Accepted (2025); partial migration (2026)

**Context:** Early backend code had a flat structure with business logic mixed into handlers. This made testing difficult and violated separation of concerns.

**Decision:** Adopt a five-layer architecture:
- `routes/` — HTTP path registration, auth/rate-limit guards
- `handlers/` — HTTP input/output translation (thin)
- `services/` — Business workflows, validation orchestration
- `repositories/` — SQL persistence (only)
- `models/` — DTOs and domain structs

Long-term goal: migrate to domain modules under `modules/<domain>/`.

**Consequences:**
- ✅ Clear separation of concerns
- ✅ Service-layer code is testable without HTTP
- ✅ Repositories isolate SQL changes
- ❌ Migration is ongoing; some handlers still contain inline SQL
- ❌ Requires discipline to maintain layering

---

## ADR 004: JWT-based Authentication with RBAC

**Status:** Accepted (2025)

**Context:** The system needed role-based access control with fine-grained permissions for hotel staff roles (admin, receptionist, manager, etc.).

**Decision:** Use JWT (via `jsonwebtoken` crate) for stateless authentication with access + refresh token pairs. RBAC permissions follow a `<resource>:<action>` pattern (e.g., `bookings:create`, `bookings:manage`). The `manage` action implies all other actions for that resource.

**Key components:**
- `core/auth.rs` — JWT verification, `require_auth()` for route guards
- `core/middleware.rs` — Middleware that checks permissions
- `core/rbac_cache.rs` — In-memory cache for RBAC state
- `core/settings_cache.rs` — In-memory cache for system settings

**Consequences:**
- ✅ Stateless auth scales horizontally
- ✅ Fine-grained permission model
- ✅ Auto-grant via `manage` permission reduces boilerplate
- ❌ In-memory caches limit multi-instance deployment
- ✅ Refresh tokens ARE revocable: `refresh_tokens` table (`is_revoked`,
  `revoked_at`, `revoked_by`) backs `AuthService::revoke_refresh_token` /
  `revoke_all_user_tokens`, called on logout and password-change. Short-lived
  access tokens themselves are not individually revocable before expiry
  (standard JWT tradeoff), but the refresh chain that mints new ones is.

---

## ADR 005: In-Memory Rate Limiting

**Status:** Accepted (2025)

**Context:** Rate limiting was needed to protect the API. External dependencies were to be minimized.

**Decision:** Implement rate limiting in-memory (`core/rate_limiter.rs`) using a simple token bucket approach. No external dependency like Redis.

**Consequences:**
- ✅ Zero external dependencies for rate limiting
- ✅ Simple implementation
- ❌ Bounds the backend to single-instance deployment
- ❌ State lost on process restart

---

## ADR 006: Frontend State Management (TanStack Query, no client-state library)

**Status:** Accepted (2025), amended 2026-08-02

**Context:** The frontend needed server-state management, caching, and some client-side state.

**Decision:** Use TanStack Query (React Query) for server state. All HTTP communication
goes through a configured `ky` instance in `src/api/client.ts`. Client-side state stays
in React state and context.

**Amendment (2026-08-02):** This ADR originally paired TanStack Query with Zustand for
client state. Zustand was never adopted — it is not a dependency and appears nowhere in
`src/`. Nearly all non-server state turned out to be either route state (owned by
TanStack Router) or component-local, and auth state is served by `src/auth/AuthContext.tsx`.
Introducing a store library now requires a new ADR.

**Key patterns:**
- `src/api/*.service.ts` — One service per backend domain
- `src/api/client.ts` — In-memory access token, HttpOnly refresh cookie, idempotent-GET retries, one refresh-and-retry per 401
- `src/api/queryKeys.ts` — Centralized query key definitions
- TanStack Query hooks in `features/<domain>/hooks/`

**Consequences:**
- ✅ Automatic caching, retry, and refetch
- ✅ Clean separation between API layer and UI
- ✅ Centralized auth token management, with no token in `localStorage`
- ✅ One less state abstraction to keep consistent
- ❌ Requires discipline to keep query keys consistent
- ❌ Genuinely cross-cutting client state has no established home, so context providers accumulate

---

## ADR 007: Desktop Sidecar Pattern (Tauri + Backend Binary)

**Status:** Accepted (2025)

**Context:** The desktop app needed to run the Rust backend alongside the web frontend as a standalone application.

**Decision:** Use Tauri 2 to embed the backend binary as a sidecar. The backend detects desktop mode via `HOTEL_DESKTOP_MODE` env var and binds to `127.0.0.1` on a dynamically-chosen port.

**Key components:**
- `hotel-desktop/src-tauri/` — Tauri Rust commands
- Embedded PostgreSQL lifecycle management
- Backend sidecar startup and monitoring
- Resource sync scripts (`sync-desktop-resources.mjs`)

**Consequences:**
- ✅ Single distribution package
- ✅ Offline-capable desktop application
- ✅ Reuses web frontend code
- ❌ Backend and database bundled can be large
- ❌ Cross-compilation complexity for sidecar
- ❌ Limited backup/restore capabilities

---

## ADR 008: Append-Only Audit Logging

**Status:** Accepted (2025)

**Context:** Regulatory and operational requirements demanded an immutable audit trail.

**Decision:** Implement an append-only audit log service (`services/audit.rs`). Audit entries are INSERT-only; no UPDATE or DELETE operations are allowed on audit records.

**Consequences:**
- ✅ Immutable audit trail
- ✅ Tamper-evident (database-level append-only)
- ❌ Storage grows unbounded (requires retention policy)
- ❌ Some mutation handlers may not yet call the audit service

---

## ADR 009: MCP Server Integration

**Status:** Proposed — never implemented (recorded as Accepted in 2025; corrected 2026-08-02)

**Context:** The project wanted API access from AI assistants like Claude Desktop and Cursor.

**Decision (as originally recorded):** Create MCP servers under `hotel-app-be/mcp-server/`
that wrap the REST API, authenticating via JWT.

**Correction:** No such directory exists and none ever has. Documentation across the
repository described these servers as shipped for roughly a year. Nothing depends on them.

**If this is revived,** the open question that stalled it is the one flagged below: an
MCP server that reaches the database directly bypasses the route-layer RBAC gate, which
is where this codebase enforces permissions. Any implementation must call the HTTP API
as a normal client, or re-implement `check_permission` at its own boundary.

**Consequences:**
- ✅ Direct AI assistant access to hotel data
- ❌ An MCP server on the database bypasses the auth middleware that carries the permission model
- ❌ Additional surface area to secure

---

## ADR 010: Schema-as-Source for PostgreSQL (No sqlx Migrations)

**Status:** Accepted (2025)

**Context:** The PostgreSQL schema was maintained differently from typical sqlx migration patterns, using raw SQL files.

**Decision:** Treat the schema itself as the source of truth. A new empty database is
initialized exactly once, in order:

```text
database/postgres/migrations/0001_v1_baseline.sql  →  database/postgres/seed.sql
```

Docker, server, and desktop deployments all run that same sequence. There is no
migration runner and no second migration file — every install path hardcodes the
baseline filename, so a new `000N_*.sql` would never be applied. Additive schema changes
go into the baseline (so fresh installs get them) plus an idempotent patch applied to
live databases of the same generation. Legacy schemas are exported and rebuilt rather
than upgraded in place. `seed.sql` is one self-validating transaction that raises on
re-apply.

Verify any baseline edit by installing the baseline and seed into a scratch
`postgres:19beta2` container before claiming it works — the SQL is an opaque
`include_str!` to the compiler, so `cargo check` and the test suite cannot detect a
baseline that will not install.

**Consequences:**
- ✅ Single source of truth for PostgreSQL schema
- ✅ Explicit, repeatable initialization order for new databases
- ✅ Compatible with Docker init scripts
- ✅ Existing V1 databases avoid accidental seed or backfill rewrites at startup
- ❌ Different from typical sqlx migration workflow
- ❌ PostgreSQL 19 Beta 2 remains a testing target until general availability

---

## ADR 011: React 19 with TanStack Router (File-Based Routing)

**Status:** Accepted (2026)

**Context:** The frontend needed a type-safe routing solution with lazy loading support.

**Decision:** Use TanStack Router with file-based routing (`src/routes/`). The router plugin auto-generates `routeTree.gen.ts`. Non-critical pages use `React.lazy()` within `Suspense` and `ErrorBoundary` wrappers.

**Consequences:**
- ✅ Type-safe route parameters and search params
- ✅ Automatic route tree generation
- ✅ Built-in lazy loading support
- ❌ Generated file must be committed
- ❌ Migration from previous router required routes to be reorganized

---

## ADR 012: Hand-Rolled Internationalisation on `Intl`

**Status:** Accepted (2026-09-09)

**Context:** The platform serves a Malaysian hotel and needed to speak more than
English — guests booking online, and staff running the property. Interface text,
dates and numbers all needed to follow a chosen language, and so did the
transactional email a guest receives, which is rendered on the server minutes
after the request that triggered it, with no session left to consult.

The obvious choice was `i18next` + `react-i18next`. Against it: the dependency
policy in `AGENTS.md` asks for a strong reason before adding a library, and the
"nontrivial domain" argument that justified i18next historically has largely
moved into the platform — `Intl.PluralRules`, `Intl.NumberFormat`,
`Intl.DateTimeFormat` and `Intl.RelativeTimeFormat` are all native and are what
a library would delegate to anyway. This repo has also been burned by a
dependency's version constraints (see the typescript-eslint note in
`.claude/rules/lessons.md`), and an interface-wide dependency is an expensive
one to be pinned by.

**Decision:** Implement i18n in-house, on `Intl`, on both sides of the stack:

- `hotel-web-fe/src/i18n/` — a pure translation engine (namespace lookup, plural
  selection via `Intl.PluralRules`, `{{var}}` interpolation), JSON bundles per
  locale, a module-level locale store read through `useSyncExternalStore`, and
  memoised `Intl` formatters. The `useTranslation(ns)` → `{ t }` surface is
  deliberately i18next-shaped, so adopting the library later is an import
  change rather than a call-site migration.
- `hotel-app-be/src/core/i18n.rs` — a `Locale` type, `Accept-Language`
  negotiation with q-values, and JSON catalogs compiled in with `include_str!`.

Both sides use `{{name}}` placeholders, matching the spelling
`communications::validation::render_template` already uses for email templates,
so a string can move between the three without being rewritten.

Guest language is persisted in `guests.language_preference`, a column that
already existed in the V1 baseline and had no reader. Staff interface language
is a browser preference (`localStorage`), consistent with how `themeMode` and
`hotelCurrency` are already handled.

**Consequences:**
- ✅ No new frontend dependency, and no version constraint on the interface layer
- ✅ One idiom across web, desktop and server; one placeholder syntax
- ✅ Guest-facing email is written in the guest's language, resolved at render
  time from stored state rather than from a request that is long gone
- ✅ Bundle parity, plural coverage and placeholder correctness are enforced by
  tests on both sides — a half-translated locale fails CI instead of silently
  serving English
- ✅ No schema change: the language column and its default already ship
- ❌ Features a library would give for free must be written if ever needed:
  context/gender selection, ICU message format, translator tooling integration
- ❌ Translations live in the repo, so a copy change is a code change
