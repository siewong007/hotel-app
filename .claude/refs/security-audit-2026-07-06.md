# Security Audit — 2026-07-06

Proactive hardening pass (no incident trigger). Full plan:
`.claude/rules/lessons.md` has the implementation lessons; this doc is the
standing reference for future sessions so the same ground isn't re-scanned.

## Fixed

- **Auth token storage (was CRITICAL).** Access token now lives only in memory
  (`hotel-web-fe/src/auth/tokenStore.ts`), never `localStorage`/`sessionStorage`.
  Refresh token rides an `HttpOnly`, `Secure`, `SameSite=Strict` cookie
  (`REFRESH_COOKIE` in `hotel-app-be/src/handlers/auth.rs`), scoped to
  `/api/auth`, rotated on every refresh. Applies to password login, refresh,
  logout, and passkey login (`services/passkey.rs::login_finish` mints a
  session too — grep `AuthResponse`/`RefreshTokenResponse` construction sites
  for any NEW auth path, they all need the same treatment).
  - **Known limitation, accepted by user:** `hotel-desktop`'s Tauri webview
    (`tauri://localhost` / `https://tauri.localhost`) talks to the backend
    sidecar at `http://127.0.0.1:<dynamic port>` — a different origin, so the
    `SameSite=Strict` refresh cookie never round-trips there. Desktop users
    must log in again after every full app restart (in-memory token is lost on
    reload, cookie can't cross the origin boundary). Degrades gracefully to the
    login screen, not a crash. No desktop-specific persistence was built —
    if this needs revisiting, the options are (a) Tauri OS-keychain storage via
    a plugin, or (b) a non-cookie refresh transport for desktop specifically.
- **SQL table-name whitelist** in `hotel-app-be/src/repositories/data_transfer.rs`
  (`count_table`/`export_table`/`export_query`/`set_user_triggers`): these built
  SQL via `format!("...{}...", table)`. Verified NOT exploitable at the time
  (callers always pass compile-time literals from `TABLE_INSERT_ORDER`), but a
  `KNOWN_TABLES` whitelist check was added so this stays true even if a future
  caller sources a table name from request data.
- **2FA field serialization**: `User.two_factor_secret` /
  `two_factor_recovery_codes` (`hotel-app-be/src/models/user.rs`) now have
  `#[serde(skip_serializing)]`. Confirmed no handler ever returned raw `User`
  (all use `UserResponse`/`UserProfile` DTOs) — this is belt-and-suspenders.
- **Audit logging gaps (real, not hypothetical)**: `services/companies.rs` had
  zero audit calls for create/update/delete — added. `services/rooms.rs` had
  audit on room-TYPE CRUD but not individual room CRUD — added, threading
  `user_id` through handlers/rooms.rs from the permission check that was
  already running (previously its result was discarded).
- **Unbounded queries**: `repositories/booking_channels.rs::list` and
  `repositories/rooms_queries.rs` (GET_ALL_ROOM_TYPES, both PG/SQLite) had no
  LIMIT — added `LIMIT 1000` as a DoS backstop. Note:
  `search.rs::GlobalSearchQuery.limit` (already clamped 1..=15) and
  `company.rs` list (already `limit.min(500)`) were flagged by the initial scan
  but were already safe — verify current state before trusting old scan output.
- **Frontend**: production builds now strip `console.*`/`debugger` (Vite config
  uses Rolldown's built-in minifier `rolldownOptions.output.minify.compress`,
  NOT esbuild — this project is on Vite 8/Rolldown, `build.esbuild.drop` is a
  no-op here). `innerHTML` usage in invoice/report print views was traced and
  confirmed safe — all user text passes through JSX first and is escaped by
  React before the DOM is re-serialized; no DOMPurify was needed.

## Ruled out (checked, no action needed)

- Backend JWT handling, RBAC (`require_auth`/`check_permission` coverage),
  rate limiting, CORS origin handling, security headers, generic error
  messages, secrets loading — all correct as of this audit.
- No committed `.env` or hardcoded credentials anywhere in the repo.
- No direct `fetch()` bypassing the `ky` client.
- Desktop Tauri secret handling (random PG password, file mode 0600,
  per-session `JWT_SECRET`, CSP locked to `localhost`+`self`) is solid.
- This app is single-property, not multi-tenant (no `hotel_id`/`tenant_id`/
  `property_id` anywhere in `database/schema.sql`) — "cross-tenant data
  leakage" framing from an early scan pass was a false positive; don't repeat it.
- No raw card data (PAN/CVV) stored anywhere in the schema.

## Process note

The P0 change was implemented by one opus agent (backend+frontend together, to
keep the cookie contract coherent — see the 2026-07-05 lessons entry on
producer/consumer mismatches from split delegation). It was still reviewed by
a fresh pass afterward and that review caught the desktop cross-origin cookie
issue the implementer's curl-only test missed. Keep doing both steps for any
future auth-transport change.
