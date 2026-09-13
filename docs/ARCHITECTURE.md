# Architecture

This document describes the system as it exists today. Historical decisions and
rationale live in [architecture/ADRS.md](architecture/ADRS.md); request-flow
detail lives in [architecture/architecture-flow.md](architecture/architecture-flow.md);
setup commands live in [DEVELOPMENT.md](DEVELOPMENT.md).

## System overview

A hotel management platform with three deployment surfaces sharing one codebase:

- **Staff web application** — front-desk and back-office operations: bookings,
  rooms, housekeeping, night audit, invoicing, ledgers, payments, promotions,
  eKYC review, communications, loyalty, reports, and administration.
- **Guest portal** — self-service online booking, pre-check-in, eKYC submission,
  payments, support, and document access, exposed under `/guest-portal/*`.
- **Desktop application** — the same web frontend and backend packaged by Tauri
  with an embedded PostgreSQL, for on-premise/offline operation.

Major user roles are hotel staff (admin, manager, receptionist, and finer-grained
custom roles), companies with city-ledger accounts, and guests.

## High-level architecture

### Web request flow

```text
Browser (React / MUI / TanStack Router and Query)
  └─ src/api/client.ts (ky, bearer token, refresh cookie, retries)
      └─ Vite proxy in development / Caddy in production
          └─ Axum routes — CORS, rate limits, security headers
              └─ require_auth + check_permission (route layer)
                  └─ handlers (thin)
                      └─ services (business logic)
                          └─ repositories (SQL only)
                              └─ PostgreSQL
```

### Desktop flow

```text
Tauri webview
  └─ Tauri IPC (get_status / backend-ready event)
      └─ backend sidecar on a dynamically probed 127.0.0.1 port
          └─ bundled PostgreSQL under src-tauri/pgsql/
```

Desktop mode is signalled by `HOTEL_DESKTOP_MODE`. The webview learns the backend
port through IPC; the sidecar receives an explicit `ALLOWED_ORIGINS` list rather
than the wildcard. Embedded PostgreSQL is initialized through the same baseline
→ seed → ordered-patches lifecycle as the server.

## Repository structure

```text
hotel-app-be/      Rust 1.95 backend (Axum 0.8, SQLx 0.9, PostgreSQL 19)
hotel-web-fe/      React 19 + TypeScript 6 frontend (Vite 8, MUI 9)
hotel-desktop/     Tauri 2 wrapper (Rust sidecar + embedded PostgreSQL)
docs/              Project documentation
deploy/            Production deployment scripts
.github/workflows/ CI and deploy pipelines
```

There is no root package workspace: each project owns its manifest, lockfile,
and toolchain commands.

## Backend architecture

`hotel-app-be/src/`:

```text
routes/         HTTP registration, auth + rate-limit guards, route ordering
handlers/       HTTP ↔ domain translation (thin)
services/       Business workflows, transactions, validation orchestration
repositories/   SQL persistence only (sqlx runtime queries)
models/         Request/response DTOs and domain structs
modules/        Domain-module layout (newer domains; same layers, one directory)
core/           Auth, DB pool, errors, middleware, rate limiting, RBAC/settings caches
utils/          Small pure helpers (sanitization, dates)
database/postgres/  Baseline, seed, and the checksum-verified patch catalog
```

Eleven domains already live in `modules/<domain>/` (analytics, communications,
consent, ekyc, guest_booking, loyalty, promotions, realtime, settings, support,
teams); new domains go there. Remaining domains use the flat-by-layer layout.

Cross-cutting machinery:

- `core/auth.rs` — JWT issue/verify, password hashing, TOTP secret encryption
  at rest, passkey support, session/refresh-token lifecycle.
- `core/middleware.rs` — `require_auth`, `check_permission`; `<resource>:manage`
  implies all actions on that resource.
- `core/db.rs` — pool creation, per-connection hotel timezone, `hotel_today()`
  business-day helper, decimal/UUID helpers.
- `core/rate_limiter.rs` — in-memory token-bucket limiter (single-instance
  deployment trade-off, see ADR 005).
- `services/audit.rs` — append-only audit log called from mutating handlers.
- Background loops spawned in `main.rs`: night audit, payment receipts,
  unpaid online-hold release, communications delivery worker and campaign
  scheduler.

Error handling: handlers return `ApiError` variants mapped to HTTP status +
JSON error body; internal detail is logged server-side, client-facing messages
stay generic.

## Frontend architecture

`hotel-web-fe/src/`:

```text
main.tsx            Entry: providers (QueryClient, Theme, Auth, i18n)
routes/             TanStack Router file routes (routeTree.gen.ts generated)
navigation/         routeRegistry.tsx — lazy page registry driving the sidebar
features/<domain>/  Feature modules: components/, hooks/, api.ts, utils, types
api/                client.ts (ky) + <domain>.service.ts per backend domain
auth/               AuthContext (session state, permissions)
components/         Shared UI (data-table, dialogs, layout, common)
hooks/              Shared hooks (useApi, usePermissions, …)
guest/              Guest-portal application shell and guest router
i18n/               In-house Intl-based i18n engine + JSON locale bundles
utils/              date.ts, errorMessage, pagination, sanitization, …
```

- Server state: TanStack Query; there is deliberately no client-state library
  (ADR 006). Auth state lives in `AuthContext`; route state in the router.
- Routing: file routes under `src/routes/` **and** the lazy registry
  `src/navigation/routeRegistry.tsx` — new pages register in both.
- HTTP: all requests go through `src/api/client.ts` (in-memory access token,
  HttpOnly refresh cookie, idempotent-GET retry, one refresh-and-retry on 401,
  `Retry-After` honored). `fetch` is never called directly.
- UI: MUI 9 + Emotion; shared `DataTable` on TanStack Table 9; charts via
  Recharts; PDFs via jsPDF (+autotable); forms use controlled MUI inputs with
  `validator`-equivalent checks server-side.
- i18n: `useTranslation(ns)` → `{ t }`, i18next-shaped but implemented on
  `Intl` (ADR 012). Staff language is a browser preference; guest language is
  persisted server-side.

## Database architecture

PostgreSQL is the only engine (ADR 002). The schema is the source of truth
(ADR 010):

```text
database/postgres/migrations/0001_v1_baseline.sql   (V1 baseline, fresh installs)
  → database/postgres/seed.sql                       (one-time seed, self-validating)
      → database/postgres/patches/                   (manifest.tsv-ordered, sha256-verified)
```

- Every additive schema change lands in the baseline **and** a new catalog
  patch; nothing discovers loose SQL files. Published patch checksums are
  immutable.
- Backend startup validates the schema; it never applies patches. Patch
  executors: `make db-patch` / `apply-patches.sh` (server), deploy script
  (production), `src-tauri/src/postgres/patches.rs` (desktop).
- The hotel business day comes from `system_settings.timezone`, applied to
  every pooled connection — SQL `CURRENT_DATE` is the hotel day. Rust business
  logic uses `hotel_today(executor)`, never `chrono::Local`.

Major entity groups: users/roles/permissions + sessions/refresh tokens/passkeys;
guests and guest-portal access; rooms, room types, housekeeping, maintenance;
bookings, booking channels, rates/rate plans, promotions; invoices, payments
(PayPal + staff-recorded), deposit refunds; customer/city ledgers; night audit
runs; eKYC submissions; communications (campaigns, deliveries, preferences);
loyalty; support tickets; audit logs (partitioned, append-only); system
settings.

## Authentication & authorization

- Staff login: username/password → JWT access token (in memory on the client)
  + HttpOnly refresh cookie. Refresh tokens are server-side rows and revocable
  (logout, password change, passkey reset all revoke). Optional TOTP 2FA with
  recovery codes; passkeys supported. TOTP secrets are encrypted at rest under
  `TOTP_ENCRYPTION_KEY` (`enc1:` prefix).
- Guest portal: self-registration/login with its own session tokens; booking
  access tokens (256-bit) for pre-check-in links; Turnstile bot protection on
  public forms; Google identity federation for both surfaces.
- Authorization: `check_permission(pool, user_id, "<resource>:<action>")` at the
  route layer. Roles map to permission sets managed through the RBAC admin UI;
  `<resource>:manage` implies all actions on that resource.
- Webhook routes (`/webhooks/paypal`) carry no bearer auth by design — each
  delivery is cryptographically signature-verified and IP rate-limited.

## Feature modules

See [FEATURES.md](FEATURES.md) for the status registry. Delivered domains:

| Domain | Backend surface | Frontend surface |
|---|---|---|
| Auth, users, RBAC | `routes/{auth,users,rbac,profile,passkey,two_factor}.rs` | `features/{auth,admin/rbac,user}` |
| Rooms & housekeeping | `routes/{rooms,housekeeping,maintenance}.rs` | `features/{rooms,housekeeping}` |
| Bookings & rates | `routes/{bookings,rates,booking_channels}.rs` + `modules/guest_booking` | `features/{bookings,onlineInventory}` |
| Guests & companies | `routes/{guests,companies}.rs` | `features/guests`, `features/admin` |
| Payments & ledgers | `routes/{payments,ledgers,payment_retry}.rs`, `routes/webhooks.rs` | `features/{customer-ledger,invoices,paymentRecovery}` |
| Night audit & reports | `routes/{night_audit,analytics,audit}.rs` | `features/{night-audit,reports,audit-log,dashboard}` |
| Promotions & loyalty | `modules/promotions`, `modules/loyalty` | `features/{promotions,loyalty}` |
| eKYC | `modules/ekyc` | `features/ekyc` |
| Communications & support | `modules/{communications,support}` | `features/{communications,support,notifications,help}` |
| Settings & data transfer | `modules/settings`, `routes/data_transfer.rs` | `features/{user,data-transfer}` |
| Guest portal | `routes/guest_portal.rs` + `modules/{guest_booking,consent}` | `guest/` + `features/guestPortal` |
| Search | `routes/search.rs` | shared search |

## Notable invariants

- All money/status transitions happen in transactions; payments persist a
  client-generated idempotency key + SHA-256 `idempotency_fingerprint` with
  partial unique indexes, so a replay returns the original row and a reused
  key with different fields conflicts.
- `let _ = sqlx::query(...)` inside a failed transaction is unsafe in
  PostgreSQL — propagate or use a savepoint.
- PayPal capture conflicts never auto-resolve: mismatch after money moved
  writes a `paypal_capture_conflict`/`paypal_webhook_conflict` audit event for
  staff review.
- Every portal mutation writes an audit event; booking allocation uses
  `FOR UPDATE` / `FOR UPDATE SKIP LOCKED` for last-room race safety.
- WebSocket hubs log lagged drops; clients reconnect with capped backoff.
