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

## ADR 002: Dual-Database Support (PostgreSQL + SQLite)

**Status:** Accepted (2025)

**Context:** The system needed both server-deployed (PostgreSQL) and offline/desktop (SQLite) database modes. The backend must compile for exactly one database at runtime.

**Decision:** Use Cargo features (`postgres` and `sqlite`) to select the database backend at compile time. The default feature is `postgres`. Use `sqlx` for database access with custom compatibility macros in `core/sql_compat.rs`.

**Core pattern:**
- `param!(N)` macros for cross-DB placeholder syntax (`$1` vs `?1`)
- `sql_query!(postgres: "...", sqlite: "...")` for divergent SQL
- Helpers like `current_timestamp()`, `current_date()` in `core/sql_compat.rs`
- `core/db.rs` provides database-specific value conversion (e.g., `Decimal` → `String` on SQLite)

**Consequences:**
- ✅ Offline/desktop mode works without PostgreSQL
- ✅ Full PostgreSQL features in production deployment
- ❌ Must maintain both PostgreSQL resources and `database/sqlite_schema.sql` / `sqlite_data.sql`
- ❌ Some SQL must be duplicated in the `sql_query!` macro
- ❌ SQLite has limitations (no `FOR UPDATE`, different UUID handling)

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

## ADR 006: Frontend State Management (React Query + Zustand)

**Status:** Accepted (2025)

**Context:** The frontend needed server-state management, caching, and some client-side state.

**Decision:** Use TanStack Query (React Query) for server state management and Zustand for client-side state. All HTTP communication goes through a configured `ky` instance in `src/api/client.ts`.

**Key patterns:**
- `src/api/*.service.ts` — One service per backend domain
- `src/api/client.ts` — Handles auth token injection, retries, 401 handling
- `src/api/queryKeys.ts` — Centralized query key definitions
- TanStack Query hooks in `features/<domain>/hooks/`

**Consequences:**
- ✅ Automatic caching, retry, and refetch
- ✅ Clean separation between API layer and UI
- ✅ Centralized auth token management
- ❌ Requires discipline to keep query keys consistent
- ❌ Some components still have local fetch patterns

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

**Status:** Accepted (2025)

**Context:** The project needed API access from AI assistants like Claude Desktop and Cursor.

**Decision:** Create MCP servers under `hotel-app-be/mcp-server/` that wrap the REST API. They authenticate via JWT and access the backend through the same database, bypassing the HTTP layer.

**Consequences:**
- ✅ Direct AI assistant access to hotel data
- ✅ No separate API surface to maintain
- ❌ MCP servers could bypass auth middleware if not careful
- ❌ Additional surface area to secure

---

## ADR 010: Schema-as-Source for PostgreSQL (No sqlx Migrations)

**Status:** Accepted (2025)

**Context:** The PostgreSQL schema was maintained differently from typical sqlx migration patterns, using raw SQL files.

**Decision:** Use `database/schema.sql` and `database/data.sql` as the authoritative PostgreSQL source, applied via direct `psql -f` execution. Use `database/sqlite_schema.sql` and `database/sqlite_data.sql` as the authoritative SQLite source. At startup, SQLite imports successful legacy SQLx versions, transactionally applies pending numbered schema sections, then executes rerunnable seed and backfill data.

**Consequences:**
- ✅ Single source of truth for PostgreSQL schema
- ✅ Idempotent application via IF NOT EXISTS / OR REPLACE
- ✅ Compatible with Docker init scripts
- ✅ Existing SQLite databases retain their applied-version history without replaying destructive legacy sections
- ❌ Different from typical sqlx migration workflow
- ❌ Must manually keep SQLite resources in sync with the PostgreSQL resources
- ❌ No automated rollback path

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
