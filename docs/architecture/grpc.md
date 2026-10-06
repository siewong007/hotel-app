# gRPC-Web Transport

A typed protobuf transport that runs alongside the REST API for a few bounded
contexts. **Why** it exists, and its trade-offs, are in
[ADR 014](decision-records.md#adr-014-grpc-web-for-selected-domains-strangler-migration).
Rollout status is owned by [`../features.md`](../features.md) (*gRPC-Web
transport*). This document covers how it is built and how to extend it.

Consolidated 2026-10-05 from the phase 0–3 migration records (REST audit,
contract mapping, web client). Those records are deleted; recover them with
`git log --all -- docs/architecture/grpc-migration/`.

## What is served

| Service | Package | RPCs | Frontend flag |
|---|---|---|---|
| `RoomService` | `hotel.rooms.v1` | 21 | `rooms` |
| `RoomTypeService` | `hotel.rooms.v1` | 5 | `rooms` |
| `HousekeepingService` | `hotel.housekeeping.v1` | 5 | `housekeeping` |
| `MaintenanceService` | `hotel.housekeeping.v1` | 4 | `maintenance` |
| `GuestService` | `hotel.guests.v1` | 12 | `guests` |

RPC counts come from `grep -c '^\s*rpc ' proto/hotel/*/v1/*_service.proto`.
Everything else, including the remaining REST surface (368 paths in
`docs/api/openapi.json`), is REST only.

Maintenance lives in the housekeeping package because the two work queues
share staff (assignable-staff `scope` spans both) and the same room inventory.
Their enums stay distinct: `HousekeepingPriority` is low/normal/high/urgent,
and `MaintenancePriority` is low/medium/high/critical.

## Where the pieces live

| Piece | Location |
|---|---|
| Contract of record | `proto/` — buf v2 module (`buf.yaml`: lint `STANDARD`, breaking `FILE`, googleapis dep) |
| Backend copy of the contract | `hotel-app-be/proto/hotel/` — a plain mirror that `build.rs` compiles with `tonic-prost-build`. The Docker build context is `hotel-app-be/` alone, so it cannot reach `../proto`. Refresh it with `make sync-proto`; `make proto-mirror-check` (CI `db-mirror` job) fails on drift. |
| Server adapters | `hotel-app-be/src/grpc/` — `rooms.rs`, `housekeeping.rs` (housekeeping and maintenance), `guests.rs`, plus `auth.rs`, `convert.rs`, `error.rs`, `idempotency.rs`, and `server.rs`. `server.rs` adds one `GrpcWebLayer` per service and merges everything into the Axum router at the root. It also registers `tonic-health` and `tonic-reflection` (v1 + v1alpha), so `grpcurl` works against a dev server. |
| Generated browser client | `hotel-web-fe/src/gen/` — `buf generate` with `protoc-gen-es` v2 (`erasable_syntax=true`, because `tsconfig` sets `erasableSyntaxOnly`). **Never hand-edit.** |
| Client transport | `hotel-web-fe/src/api/grpcClient.ts` |
| Client adapters and flags | `hotel-web-fe/src/api/grpc/` — `flags.ts`, `convert.ts`, one adapter per context |

The adapters delegate to the same `modules/<domain>/` service and repository
code as the REST handlers. Authorization, business rules, audit writes, and
realtime `publish_*` fan-out therefore happen once, in the shared layer. The
gRPC path never gets its own copy. The actor id comes from the authenticated
session, never from a request field.

## Contract rules

These are enforced in `src/grpc/convert.rs` so every service converts the
same way. Follow them for any new RPC.

- **Money**: `hotel.common.v1.Money { int64 amount_minor; string currency_code }`.
  The database stores major units (`numeric(…,2)`), and the adapter multiplies
  or divides by 100 at the boundary. An empty `currency_code` on input means
  the property currency (`system_settings.currency`).
- **Other numbers**: ratings, occupancy percentages, and labour hours use
  `google.type.Decimal`. The schema has `numeric(10,4)` columns that minor
  units cannot represent.
- **Dates**: business dates use `google.type.Date`, and true instants
  (`timestamptz`) use `google.protobuf.Timestamp` in UTC.
- **Resource names**: AIP-122 `{collection}/{id}` strings (`rooms/42`) over the
  int64 keys. `parse_name` rejects a wrong collection with `INVALID_ARGUMENT`.
- **Idempotency**: every mutating RPC carries `string request_id`.
- **Partial update**: every Update RPC takes `google.protobuf.FieldMask update_mask`.
  Explicit clear flags (`clear_assignee`) exist where REST's `COALESCE`
  semantics cannot express "set to null".
- **Enums**: each enum has `_UNSPECIFIED = 0`, and its values come verbatim
  from the backend's `VALID_*` allow-lists. `ROOM_STATUS_CLEAN` is a
  write-only alias of `AVAILABLE`, mirroring REST.
- **Pagination**: lists use `page_size`/`page_token`/`next_page_token`/`total_size`
  (`total_size` preserves REST's `total`).
- **Responses**: buf `STANDARD` lint requires a unique response type per RPC,
  so resource-returning RPCs wrap the resource (`{ Room room = 1; }`).
- **Errors**: `src/grpc/error.rs` maps `ApiError` to gRPC status codes. On the
  client, `toApiError` in `src/api/client.ts` maps a `ConnectError` back to the
  HTTP status REST would have returned, so error UI cannot tell the transports
  apart.
- **Field numbers**: once shipped, a field number is never reused. Retire it
  with `reserved`, and the `proto` CI job's breaking check enforces this.

Intentional differences from the REST shapes: `GetRoom` has no REST twin (REST
only lists rooms and fetches the detailed view). `RoomBookingSummary` is a
13-field cut of `BookingWithDetails`. `items_used`/`images` are
`google.protobuf.Value`, because `Struct` cannot hold the bare arrays REST
accepts. REST `success` flags are dropped wherever the gRPC status already
says the same thing.

## Endpoint → RPC map

REST paths are relative to `/api`. Each RPC runs the same permission check as
its REST twin.

**RoomService**: `GET /rooms` ListRooms · `GET /rooms/available` SearchRooms ·
(none) GetRoom · `POST /rooms` CreateRoom · `PATCH /rooms/{id}` UpdateRoom ·
`DELETE /rooms/{id}` DeleteRoom · `PUT /rooms/{id}/status` UpdateRoomStatus ·
`POST /rooms/{id}/end-maintenance` EndRoomMaintenance ·
`POST /rooms/{id}/end-cleaning` EndRoomCleaning ·
`POST /rooms/sync-statuses` SyncRoomStatuses ·
`GET /rooms/{id}/detailed` GetRoomDetailedStatus ·
`GET /rooms/{id}/history` ListRoomStatusHistory ·
`POST /rooms/{id}/events` CreateRoomEvent ·
`GET /rooms/{room_type}/reviews` ListRoomReviews (the path segment is the
type's display name, kept exactly) · `POST /rooms/{id}/execute-change`
ExecuteRoomChange · `GET /rooms/change-history` ListRoomChangeHistory ·
`GET /rooms/occupancy` ListRoomOccupancy · `GET /rooms/occupancy/summary`
GetOccupancySummary · `GET /rooms/occupancy/by-type` ListRoomTypeOccupancy ·
`GET /rooms/with-occupancy` ListRoomsWithOccupancy ·
`GET /rooms/{id}/occupancy` GetRoomOccupancy.

**RoomTypeService**: `GET /room-types` (and `/all`) ListRoomTypes with
`include_inactive` · `GET /room-types/{id}` GetRoomType · `POST /room-types`
CreateRoomType · `PATCH /room-types/{id}` UpdateRoomType ·
`DELETE /room-types/{id}` DeleteRoomType. The `POST /room-types/{id}/images`
multipart upload stays REST.

**HousekeepingService**: `GET /housekeeping/tasks` ListHousekeepingTasks ·
`POST /housekeeping/tasks` CreateHousekeepingTask ·
`PATCH /housekeeping/tasks/{id}` UpdateHousekeepingTask ·
`GET /housekeeping/board` GetHousekeepingBoard ·
`GET /housekeeping/assignable-staff` ListAssignableStaff.

**MaintenanceService**: `GET /maintenance` ListMaintenanceTickets ·
`GET /maintenance/{id}` GetMaintenanceTicket · `POST /maintenance`
CreateMaintenanceTicket · `PATCH /maintenance/{id}` UpdateMaintenanceTicket.

**GuestService**: `GET /guests` ListGuests · `GET /guests/{id}` GetGuest ·
`GET /guests/{id}/profile` GetGuestProfile · `GET /guests/{id}/bookings`
ListGuestBookings · `GET /guests/{id}/credits` GetGuestCredits ·
`GET /guests/my-guests` ListMyGuests · `GET /guests/my-guests-with-credits`
ListMyGuestsWithCredits · `POST /guests` CreateGuest · `PATCH /guests/{id}`
UpdateGuest · `DELETE /guests/{id}` DeleteGuest ·
`POST /guests/{id}/tourism-from-last-check-in` ApplyTourismTypeFromLastCheckIn ·
`POST /guests/{id}/portal-account` TransferGuestPortalAccount. Still REST
only: `link`/`unlink`/`upgrade` (their responses are untyped), the
guest-credit mutation routes, and the interactions, preferences, reviews,
loyalty, vouchers, communications, support, and relations endpoints.

## How the browser picks a transport

```
Component → RoomsService.getAllRooms()          (call site unchanged)
          → grpcEnabled('rooms')
              ? grpc/rooms.ts: REST type → pb request → Connect client → pb → REST type
              : api.get('rooms')                 (the ky REST path)
```

Service classes keep their signatures and return the same hand-written types,
so the transport choice is invisible above the service layer.

`grpcEnabled(ctx)` (`src/api/grpc/flags.ts`) resolves in this order:

1. the per-browser override in storage key `grpcContexts`, written by
   `setGrpcContexts([...])` and cleared by `setGrpcContexts()`. An empty stored
   list deliberately overrides the build default.
2. the build default `VITE_GRPC_CONTEXTS` (comma-separated, for example
   `rooms,housekeeping,maintenance,guests`)
3. none, which means REST

`grpcClient.ts` creates the gRPC-Web transport lazily, because the desktop
sidecar URL resolves asynchronously. It uses binary format and a 30 s timeout.
One interceptor mirrors `client.ts`:

- in-memory bearer token, `Accept-Language`, and `X-Client-Timezone` headers
- a single-flight refresh with one retry on `Code.Unauthenticated`
- `auth:unauthorized` when the refresh fails
- TanStack Query domain invalidation after a successful mutating RPC

## What stays REST permanently

- **WebSockets**: the realtime hubs are bidirectional. gRPC-Web is unary here,
  so it has no browser streaming.
- **Multipart uploads, file downloads, and `/uploads`**.
- **External callers**: payment-gateway and channel webhooks.
- **Auth and sessions**: login/refresh, passkey, 2FA, and guest-portal token
  flows. These depend on the HttpOnly refresh cookie and magic-link tokens.
- **`/health`**.

## Rollout state and open gaps

- Every context is **off by default**. No build sets `VITE_GRPC_CONTEXTS`, and
  `hotel-web-fe/.env.example` does not list it.
- **The production edge does not route gRPC.** In development, the Vite proxy
  forwards `/hotel.` (`PROXY_PREFIXES`). But `deploy/Caddyfile`'s `@backend`
  matcher and the site matchers generated by `deploy/deploy{,-staging}.sh` do
  not. Until those matchers learn `/hotel.*`, enabling a flag in production
  fails every RPC. Keep the flags off outside development until then. The
  Desktop is unaffected: it calls the sidecar directly.
- **REST twins stay.** Removing a migrated REST route is a separate change,
  made after production validation.

Phase 0 audit guidance for the contexts not yet migrated:

| Proposed package | Modules it would absorb |
|---|---|
| `hotel.iam.v1` | users, rbac, teams, profile (non-2FA parts) |
| `hotel.reservations.v1` | bookings (complimentary, guest credits, rate/market codes), night_audit |
| `hotel.rates.v1` | rates, promotions, revenue (rate calendar), booking_channels (config) |
| `hotel.billing.v1` | payments, ledgers, invoices, payment_retry (admin parts) |
| `hotel.guestportal.v1` | guest_portal, guest_booking, portal-side loyalty/support/promotions |
| `hotel.ops.v1` | analytics, insights, audit, search, system, settings, communications, data_transfer (non-upload), ekyc (admin review) |

Ordering advice: migrate payments, ledgers, booking mutations, night audit,
and eKYC **last**. They are money, legal, or audit critical. Prefer typed,
read-mostly, low-blast-radius surfaces first. Defer guest-portal token flows
until their auth model is redesigned.

## Adding a context

1. Write `proto/hotel/<ctx>/v1/*.proto` following the contract rules above.
   Run `buf format -w proto && buf lint proto`.
2. Run `make sync-proto`, then `cargo check --all-features` (`build.rs`
   regenerates the Rust types).
3. Add `src/grpc/<ctx>.rs`, delegating to `modules/<ctx>/service.rs`, and
   register the server in `src/grpc/server.rs`.
4. Run `buf generate` from `proto/` to refresh `hotel-web-fe/src/gen/`.
5. Add `src/api/grpc/<ctx>.ts` and branch the service class on
   `grpcEnabled('<ctx>')`.
6. Extend `tests/grpc_equivalence.rs`, which compares REST and gRPC field by
   field and needs `DATABASE_URL`, and `src/api/grpc/grpc.test.ts`.
7. Fix the production edge matchers before anyone enables the flag outside
   development.

`scripts/bench-rest-vs-grpc.sh` compares p50/p99 latency, throughput, and
response size for the same call on both transports. Record its numbers in
the PR that changes a context's default.
