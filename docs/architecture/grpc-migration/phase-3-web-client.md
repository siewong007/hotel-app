# React Client — Phase 3 (Connect/gRPC-Web)

Frontend side of the migration: rooms, room types, housekeeping, maintenance
and guests now dispatch to generated Connect clients **per bounded context**,
with REST kept as default and fallback. Zero behaviour change for the UI —
service classes keep their signatures and return the same hand-written types.

## Architecture

```
Component → RoomsService.getAllRooms()          (unchanged call site)
          → grpcEnabled('rooms') ?
              grpc/rooms.ts  : REST type → pb request → Connect client → pb → REST type
            : api.get('rooms')  (existing ky path)
```

- `src/gen/` — protoc-gen-es v2 output (`buf generate`, `erasable_syntax=true`
  because `tsconfig` sets `erasableSyntaxOnly`). Google imports are emitted
  via buf managed mode + `include_imports`. **Do not hand-edit.**
- `src/api/grpcClient.ts` — lazy `createGrpcWebTransport` (binary format,
  30 s timeout) + one interceptor that mirrors `client.ts`: in-memory bearer
  token, `Accept-Language`, `X-Client-Timezone`, single-flight refresh with
  **one** retry on `Code.Unauthenticated`, `auth:unauthorized` on refresh
  failure, and TanStack Query domain invalidation after successful mutating
  RPCs. Lazy because the desktop sidecar URL resolves asynchronously.
- `src/api/grpc/flags.ts` — `grpcEnabled(ctx)` resolution order:
  `storage['grpcContexts']` override → `VITE_GRPC_CONTEXTS` (comma-separated)
  → none (REST). An empty stored list intentionally overrides build defaults.
  `setGrpcContexts(list?)` writes/clears the override.
- `src/api/grpc/convert.ts` — shared converters: resource names
  (`rooms/54` ⇄ `54`), `Money` minor units ⇄ major units, `google.type.Date`
  ⇄ `YYYY-MM-DD`, `Timestamp` ⇄ epoch/string, `Value` ⇄ `JsonValue`, enum ⇄
  REST snake-case strings.
- `toApiError` in `client.ts` gained a `ConnectError` branch mapping Connect
  codes to the HTTP statuses REST would have produced, so notification and
  error UI see no transport difference.

## Dispatch table

| Context flag | REST service methods switched | Stays REST |
|---|---|---|
| `rooms` | all `RoomsService` incl. room types, occupancy, history, events, reviews | `uploadRoomTypeImage` (multipart — not in the unary contract) |
| `housekeeping` | board, tasks CRUD, assignable staff | — |
| `maintenance` | tickets CRUD | — |
| `guests` | all `GuestsService` methods (list/page/all, get, profile, bookings, credits, my-guests, CRUD, tourism conversion, portal-account transfer) | `link`/`unlink`/`upgrade` (untyped responses — contract deferred), guest credits mutation routes, interactions/preferences/reviews/loyalty/vouchers/communications/support/relations endpoints (not yet in contract) |

## Dev routing

`vite.config.ts` proxies `/hotel.*` → backend (Connect/gRPC-Web service paths
live at router root, not `/api`). Desktop uses the same dynamic
`getApiBaseUrl()`; `ALLOWED_ORIGINS` unchanged.

## Enabling gRPC

- Build default: `VITE_GRPC_CONTEXTS=rooms,housekeeping,maintenance,guests`
- Runtime override (per browser, survives reload):
  `setGrpcContexts(['rooms'])` / `setGrpcContexts()` to clear.

## Verified

- `typecheck`, `lint:strict`, `build`, `grpc.test.ts` (15 tests: converters,
  flag precedence, interceptor retry/invalidation).
- Backend `grpc_equivalence` covers guests too (15 tests: REST-vs-gRPC
  field equality on list/get/create/update-mask, permission-denied,
  bad-resource-name, no-perm empty page).
- Live through the Vite proxy: authenticated `ListRooms` returned 313 rooms
  identical to REST; missing auth → `grpc-status 16`; revoked session →
  REST 401 and gRPC 16 `Session has been logged out` in lockstep.
- i18n hardcoded-string audit: mask-path tables in the adapters use `Set`s of
  proto field names, not `title:`-keyed objects (the scanner treats `title`
  as a UI prop).

## Not done / boundaries

- REST remains live; removing migrated REST routes is a separate PR after
  production validation.
- No browser streaming (unary only). WebSocket hubs untouched.
- OTA / channel-manager / payment webhooks stay REST+JSON permanently.
