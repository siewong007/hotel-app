# gRPC Contract — Phase 1 Mapping (pilot: rooms + housekeeping)

Status: **implemented** — this contract was approved and Phases 1–3 landed:
the services are served by tonic in `hotel-app-be/src/grpc/` and the generated
Connect-ES clients in `hotel-web-fe/src/gen/` are live behind per-context
runtime flags (`src/api/grpc/flags.ts`, default off → REST). Kept as the
contract-of-record reference for the mapped contexts.

Scope: `hotel.rooms.v1` (22 REST routes) + `hotel.housekeeping.v1`
(housekeeping 5 routes + maintenance 4 routes) + `hotel.guests.v1` (12 RPCs
covering the 13 FE-called `/api/guests` endpoints; link/unlink/upgrade and the
untyped credit-mutation routes stay REST-only for now). Lowest-risk contexts
first, per the rollout plan. Remaining bounded contexts (reservations, rates,
billing, iam, guestportal, ops) follow the same pattern after this review.

## Package layout

```
proto/
  buf.yaml                    v2 module, googleapis dep, lint STANDARD, breaking FILE
  buf.gen.yaml                codegen pins (not run in Phase 1)
  buf.lock                    resolved googleapis dep
  hotel/common/v1/types.proto Money + resource-name convention (shared, not a context)
  hotel/rooms/v1/
    room.proto                Room, RoomType, RoomEvent, RoomBookingSummary,
                              RoomDetailedStatus, RoomStatusChange, RoomChangeRecord,
                              RoomReview, occupancy messages, RoomStatus enum
    room_service.proto        RoomService (21 RPCs)
    room_type_service.proto   RoomTypeService (5 RPCs)
  hotel/housekeeping/v1/
    housekeeping.proto        HousekeepingTask, board, staff; task/priority/status/scope enums
    housekeeping_service.proto HousekeepingService (5 RPCs)
    maintenance.proto         MaintenanceTicket; status/category/priority enums
    maintenance_service.proto  MaintenanceService (4 RPCs)
  hotel/guests/v1/
    guest.proto               Guest (+ ekyc summary, sensitive profile, profile,
                              summary/booking rows, credit rows, tourism
                              conversion); GuestType/TourismType/GuestSegment
    guest_service.proto       GuestService (12 RPCs)
```

`hotel.common.v1` was added beyond the brief's six packages: `Money` is needed
by multiple contexts and can't live inside one of them without creating a
cross-context import.

## Endpoint → RPC map

### RoomService (`hotel.rooms.v1`)

| REST | RPC | Permission |
|---|---|---|
| GET /rooms | ListRooms | rooms:read |
| GET /rooms/available | SearchRooms | rooms:read |
| — (none) | GetRoom | rooms:read — no REST pair; AIP-completeness get |
| POST /rooms | CreateRoom | rooms:create |
| PATCH /rooms/{id} | UpdateRoom | rooms:update |
| DELETE /rooms/{id} | DeleteRoom | rooms:delete |
| PUT /rooms/{id}/status | UpdateRoomStatus | rooms:update + DB transition table |
| POST /rooms/{id}/end-maintenance | EndRoomMaintenance | rooms:update |
| POST /rooms/{id}/end-cleaning | EndRoomCleaning | computed transition permission |
| POST /rooms/sync-statuses | SyncRoomStatuses | rooms:update |
| GET /rooms/{id}/detailed | GetRoomDetailedStatus | rooms:read |
| GET /rooms/{id}/history | ListRoomStatusHistory | ROOM_OPERATIONS_READ |
| POST /rooms/{id}/events | CreateRoomEvent | rooms:update |
| GET /rooms/{room_type}/reviews | ListRoomReviews | rooms:read |
| POST /rooms/{id}/execute-change | ExecuteRoomChange | bookings:update |
| GET /rooms/change-history | ListRoomChangeHistory | bookings:read |
| GET /rooms/occupancy | ListRoomOccupancy | rooms:read |
| GET /rooms/occupancy/summary | GetOccupancySummary | rooms:read |
| GET /rooms/occupancy/by-type | ListRoomTypeOccupancy | rooms:read |
| GET /rooms/with-occupancy | ListRoomsWithOccupancy | rooms:read |
| GET /rooms/{id}/occupancy | GetRoomOccupancy | rooms:read |

### RoomTypeService (`hotel.rooms.v1`)

| REST | RPC | Permission |
|---|---|---|
| GET /room-types (+ /all) | ListRoomTypes (include_inactive flag) | rooms:read |
| GET /room-types/{id} | GetRoomType | rooms:read |
| POST /room-types | CreateRoomType | rooms:update |
| PATCH /room-types/{id} | UpdateRoomType | rooms:update |
| DELETE /room-types/{id} | DeleteRoomType | rooms:update |
| POST /room-types/{id}/images | **stays REST** — multipart upload | rooms:update |

### HousekeepingService (`hotel.housekeeping.v1`)

| REST | RPC | Permission |
|---|---|---|
| GET /housekeeping/tasks | ListHousekeepingTasks | housekeeping:read |
| POST /housekeeping/tasks | CreateHousekeepingTask | housekeeping:create |
| PATCH /housekeeping/tasks/{id} | UpdateHousekeepingTask | housekeeping:update |
| GET /housekeeping/board | GetHousekeepingBoard | housekeeping:read |
| GET /housekeeping/assignable-staff | ListAssignableStaff | housekeeping:read |

### MaintenanceService (`hotel.housekeeping.v1`)

Maintenance lives in the housekeeping package: the two work queues share
staff (assignable-staff `scope` already spans both) and the same room
inventory. Enum vocabularies are distinct (`HousekeepingPriority` low/normal/
high/urgent vs `MaintenancePriority` low/medium/high/critical).

| REST | RPC | Permission |
|---|---|---|
| GET /maintenance | ListMaintenanceTickets | maintenance:read |
| GET /maintenance/{id} | GetMaintenanceTicket | maintenance:read |
| POST /maintenance | CreateMaintenanceTicket | maintenance:create |
| PATCH /maintenance/{id} | UpdateMaintenanceTicket | maintenance:update |

## Contract decisions (the brief's non-negotiables, applied)

- **Money** — `hotel.common.v1.Money { int64 amount_minor; string currency_code }`.
  DB stores major-unit `numeric(…,2)`; service layer converts ×100 at the
  boundary. `currency_code` empty on input = property currency
  (`system_settings.currency`, char(3) — confirmed in baseline schema).
  Replaces `f64` inputs (`RoomCreateInput.price_per_night` etc.) — a strict
  correctness upgrade, same business semantics.
- **Non-money numerics** — ratings, occupancy %, labor hours use
  `google.type.Decimal` (string-encoded, arbitrary precision). The schema has
  `numeric(10,4)` columns that minor-units cannot represent.
- **Dates** — `google.type.Date` for business dates (check-in/out, scheduled,
  task_date, status-update date strings). `google.protobuf.Timestamp` (UTC)
  for true instants (created_at, started_at, status windows — stored
  timestamptz).
- **Property timezone** — not modeled in this context; the Property resource
  carrying it belongs to settings/ops (Phase 1 follow-up contract). Room
  screens don't render it.
- **Idempotency** — `string request_id` on every mutating RPC.
- **Partial update** — `google.protobuf.FieldMask update_mask` on all Update
  RPCs; `clear_assignee` kept as an explicit flag (REST COALESCE semantics
  can't clear via the mask).
- **Enums** — every enum has `_UNSPECIFIED = 0`; vocabularies taken verbatim
  from the backend's VALID_* allowlists. `ROOM_STATUS_CLEAN` kept as a
  write-only alias of AVAILABLE (REST accepts "clean", maps before storing).
- **Resource names** — AIP-122 `{collection}/{id}` strings wrapping the int64
  PKs. Forward-declared collections (bookings/, guests/, users/, rewards/)
  are name strings only until their packages land.
- **Pagination** — `page_size`/`page_token`/`next_page_token`/`total_size` on
  all lists (REST used offset `page`/`page_size` or none; `total_size`
  preserves the REST `total` field).
- **Response wrappers** — buf STANDARD requires unique `XxxResponse` per RPC,
  so resource-returning RPCs return `{ Resource r = 1; }` wrappers.
- **Reserved numbers** — new contract, nothing retired yet; convention noted
  for future edits.

## Deliberate REST-vs-proto shape differences

- `ListRoomReviewsRequest.room_type_name` — REST path param is the type's
  display name, not an id; kept exactly.
- `RoomBookingSummary` — trimmed `BookingWithDetails` (13 fields the room
  screens use) instead of dragging the full bookings type into this package.
- `items_used`, `images` — `google.protobuf.Value` (free-form JSON today;
  `Struct` cannot represent the bare arrays REST accepts).
- `success`/`synced_count`-style REST JSON flags dropped where gRPC status
  already conveys them; `message` fields kept where the FE displays them.
- `GetRoom` has no REST counterpart (REST only lists + detailed) — flagged.

## Deferred to a later proto review

- `hotel.reservations.v1`, `hotel.rates.v1`, `hotel.guests.v1`,
  `hotel.billing.v1` (+ proposed `iam`, `guestportal`, `ops` from the audit).
- Streaming RPCs for the 5 WebSocket families (separate design; hubs stay
  shared regardless).
- Multipart uploads, file downloads, `/uploads`, webhooks — permanent REST.
- Property resource + explicit timezone field (ops/settings context).

## CI wiring

`ci.yml` gains a `proto` job: buf-setup-action (pinned SHA), `buf format
--diff --exit-code`, `buf lint`, and a breaking-change check against the PR
base ref — self-skipping until a proto baseline exists on the base branch.
