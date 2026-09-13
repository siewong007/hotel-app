# Auto refresh for bookings / guests / ledger pages — design

Status: **approved** (2026-09-13)

## Problem

Page refresh after mutations is hand-wired per call site: some mutations go
through `useMutation` hooks that invalidate query-key groups, but many call
sites (`CustomerLedgerPage`'s ~15 direct service calls, `CheckoutInvoiceModal`,
`useCheckoutFlow`'s default `updateBooking`) invoke services directly and rely
on manually remembered `loadX()` / `refetch()` callbacks. The ledger page's own
read paths (`loadCompanies`, `loadAllCompanyBookings`, `loadLedgerRooms`) are
manual `useState` fetches outside the query cache entirely, so invalidations
never reach them. And nothing refreshes a client when *another* staff session
mutates data.

## Design

Two complementary mechanisms; both converge on the existing
`invalidate*Dependencies` key groups in `src/api/queryInvalidation.ts`.

### 1. Local mutations — API-layer auto-invalidation

- `queryInvalidation.ts` gains `invalidateLedgerDependencies(queryClient)`
  (ledgers, companies, bookings, invoices, dashboard, analytics, audit — same
  shape as the sibling helpers) plus:
  - `domainForApiPath(path) → ApiDomain | null` — maps request paths to domains:
    `/api/bookings*` → bookings, `/api/guests*` → guests,
    `/api/rooms*` `/api/room-types*` → rooms,
    `/api/payments*` `/api/invoices*` `/api/admin/payments*` → bookings
    (payments alter booking folio/balance and ledger views),
    `/api/customer-ledgers*` `/api/admin/ledger*` `/api/companies*` → ledgers,
    `/api/housekeeping*` → housekeeping, `/api/night-audit*` → night-audit.
    Unmapped paths (auth, guest-portal, settings, profile, two-factor,
    data-transfer, ws) return `null` — no invalidation.
  - `invalidateDomain(queryClient, domain)` — dispatches to the matching
    `invalidate*Dependencies` helper.
- `api/client.ts` `afterResponse` hook: when `response.ok` and the method is
  POST/PUT/PATCH/DELETE, call `invalidateDomain(queryClient, domainForApiPath(path))`.
  `queryClient` is the module singleton (`api/queryClient.ts`), importable
  outside React — no new dependency direction (`client.ts` → `queryClient.ts`
  only; `queryClient.ts` does not import `client.ts`).
- `CustomerLedgerPage`: the three manual loaders become query-backed so
  invalidation reaches them —
  `loadCompanies` → `useActiveCompanies()` (existing hook,
  `queryKeys.companies.list({is_active:true})`),
  `loadAllCompanyBookings` → `useBookingsWithDetails({company_billed:true})`
  + `useMemo` active-status filter,
  `loadLedgerRooms` → `useRooms()` (shared `rooms.all` key, already warm).
  The `loadX()` call sites stay as thin `invalidateQueries` shims so the ~15
  mutation handlers are untouched; the API hook makes even those redundant.

### 2. Other clients' mutations — server push

- New `modules/realtime/` (module-layout convention):
  `hub.rs` — `DataChangeHub` wrapping `tokio::sync::broadcast` (capacity 256,
  mirrors `LoyaltyHub`), event `{event_type:"data_changed", domain:String}`;
  `serve_socket` forwards every event (staff clients want all domains).
- Route `GET /api/updates/socket` — same auth as
  `loyalty_socket_handler`: token in `Sec-WebSocket-Protocol`
  (`['hotel-updates', token]`), `require_auth` equivalent + session-active
  check; any authenticated staff session may subscribe (no domain permission —
  events carry only a domain name, no data).
- `publish_data_changes` middleware in `create_router` (inside the `/api`
  nest, after `enforce_active_session`): after each response, if the method is
  mutating and status is 2xx and the path maps to a domain, publish
  `data_changed`. One emit point covers every mutation — including unaudited
  ones — with zero per-handler wiring. Hub is injected via
  `Extension(data_hub)` like the existing hubs.
- FE `useDataChangeSocket()` (loyalty-socket pattern + reconnect with ~3s
  backoff, fresh access token per attempt) mounted once inside `<AuthProvider>`
  in `App.tsx` → `invalidateDomain` on `data_changed`. Own mutations therefore
  invalidate twice (ky hook + socket echo) — harmless, react-query dedupes the
  refetch.

## Why not per-call-site `useMutation` conversion

The ledger page alone has ~15 direct service calls; converting each is a large
diff and every future mutation still has to remember the wiring. The API-layer
hook + one middleware emit point make refresh automatic for all current and
future mutations — matching what the user asked for ("auto handled").

## Deliberately out of scope

- No per-entity payload in events (domain names only) — invalidation refetches
  through existing endpoints, so no data leaks through the socket.
- Guest-portal clients are unaffected (separate sockets already exist there).
- No `refetchInterval` polling — push + invalidation covers the requirement.
- The in-flight rooms/housekeeping refactor in this worktree is untouched.

## Testing

- FE: unit tests for `domainForApiPath`/`invalidateDomain` mapping; extend an
  existing hook-level test if a socket test harness exists.
- BE: unit test for the path→domain map; socket auth mirrors the loyalty
  handler (already covered pattern).
- `docs/api/openapi.json` regenerated for the new route (CI drift gate).
- Smoke: connect socket, run a mutation from a second session, observe
  `data_changed` on the wire.
