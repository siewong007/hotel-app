# API Reference

The machine-readable route index is [`openapi.json`](openapi.json) —
generated from the router and kept honest by `tests/openapi_drift.rs` (a CI
gate: any route add/remove/update fails CI until regenerated).

Regenerate after changing routes:

```bash
cd hotel-app-be
HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift
```

The OpenAPI document is a method+path index (443 operations across 367
paths). This page documents the cross-cutting contract every endpoint shares;
for per-endpoint request/response shapes read the handler and model files —
`src/modules/<domain>/handlers.rs` and `src/modules/<domain>/models.rs` are
the source of truth.

## Base URL

- Dev: `http://localhost:3030` (Vite proxies `/api`, `/uploads`, `/health`,
  `/ws`, and `/hotel.` to it)
- All REST application routes live under `/api/*` — including the webhook and
  WebSocket routes. Root-level paths are `/health`, `/ws/status` (a plain
  status probe, not a socket upgrade), public `/uploads`, and the gRPC/Connect
  service paths `/hotel.<package>.<Service>/<Method>` (plus gRPC health and
  reflection services).

## Authentication

| Surface | Mechanism |
|---|---|
| Staff API (`/api/**`) | `Authorization: Bearer <access_token>` — short-lived JWT minted by `POST /api/auth/login` or `POST /api/auth/refresh` |
| Refresh | HttpOnly cookie on the refresh endpoint; tokens are revocable DB rows |
| Guest portal (`/api/guest-portal/**`) | Guest session cookie/bearer from `/api/guest-portal/auth/*`; booking access tokens (anonymous-booking credential, SHA-256 at rest) and 48-hour pre-check-in tokens |
| Webhooks (`/api/webhooks/paypal`) | **No bearer** — PayPal signature verification + IP rate limit |
| Public endpoints | `/api/booking/{offers,room-types,quote,reservations}` (anonymous booking, IP rate-limited), `/api/promotions`, `/api/promotions/{slug}`, auth/guest-portal public routes, `/health` |

Authorization: after auth, route wrappers call
`check_permission("<resource>:<action>")` — e.g. `bookings:read`,
`payments:refund`. `<resource>:manage` implies every action on that resource.
Missing permission → `403`.

## Error format

Errors serialize as `{"error": "<message>"}`; stable machine-readable `code`
fields exist where the client must branch:

| Status | Variant | Notes |
|---|---|---|
| 400 | BadRequest | validation/body errors |
| 401 | Unauthorized | missing/expired token → client does one refresh-and-retry |
| 403 | Forbidden | permission denied, or `code: "two_factor_enrollment_required"` |
| 404 | NotFound | |
| 409 | Conflict | duplicates, idempotency-key conflicts, `code: "guest_name_taken"` |
| 422 | ProfileIncomplete | carries `missing_fields` list |
| 429 | TooManyRequests | some responses carry `Retry-After` (client honors it) |
| 500 | Internal / Database | generic message; detail stays in server logs |
| 503 | ServiceUnavailable | e.g. PayPal/Turnstile/SMTP unreachable — fails closed |

## Rate limiting

Fixed-window limits shared through the `rate_limit_buckets` PostgreSQL table
per category (login `sensitive`, writes, portal tokens, webhooks, general) —
multi-replica safe and fail-open on database error (ADR 005 is superseded).
`Retry-After` is returned where applicable.

## Idempotency

Staff payment-creation endpoints accept a client-generated `Idempotency-Key`‑style
field in the body; the server stores the key + a SHA-256 fingerprint of the
material request. Exact replay returns the original payment; same key with
different fields → `409`.

## Endpoint domains

Grouped by path prefix (counts from `openapi.json`, 443 ops total):

| Prefix | Ops | Domain |
|---|---|---|
| `/api/admin/*` | 66 | Back-office: communications, loyalty, promotions, payments, segments, vouchers, online-inventory |
| `/api/guest-portal/*` | 51 | Guest self-service: auth, bookings, pre-check-in, eKYC, payments, vouchers, support, preferences |
| `/api/guests*` | 31 | Guest records + guest-relations interactions/preferences/reviews |
| `/api/bookings*`, `/api/booking*` | 44 | Booking lifecycle + channel attribution |
| `/api/rooms*`, `/api/room-types`, `/api/room-rates` | 35 | Inventory and pricing |
| `/api/auth/*` | 20 | Login/refresh/logout, password, passkey, 2FA, Google |
| `/api/users*` | 17 | Staff user management |
| `/api/ekyc*` | 16 | eKYC submissions + review queue |
| `/api/rbac/*` | 15 | Role/permission management |
| `/api/ledgers*`, `/api/payments*`, `/api/invoices*` | 29 | Money |
| `/api/profile/*` | 14 | Self-service profile/settings |
| `/api/teams*` | 8 | Team management |
| `/api/data-transfer/*` | 9 | `hotel-backup` JSON export + staged import pipeline — see below |
| `/api/night-audit*`, `/api/audit-logs*`, `/api/analytics*`, `/api/insights*`, `/api/reports*` | 21 | Ops intelligence |
| `/api/{housekeeping,maintenance,support,communications,settings,booking-channels,companies,search,rate-plans,market-codes,rate-codes,rate-management,complimentary,revenue,promotions,loyalty,guest-relations,system,updates,channel-*}*` | rest | Assorted domains |
| `/api/webhooks/paypal` | 1 | PayPal signature-verified events |
| `/health`, `/ws/status` | 2 | Infrastructure probes (root level) |

### Data transfer

Every endpoint runs on the grantable `data_transfer:*` permission set —
neither `settings:manage` nor the super-admin flag opens the surface on its
own. Conditional permissions (`export_sensitive`, `import_sensitive`,
`override`, `restore`) and a 120-second `X-Step-Up` token are enforced deeper,
where the file and request mode are known:

- `GET /api/data-transfer/export/preview` — `data_transfer:view`
  (`export_sensitive` when the scope is sensitive); super-admin for the
  protected `system` scope.
- `GET /api/data-transfer/export` — `data_transfer:export` (`standard`) or
  `export_sensitive` + step-up (`full`, `backup`); `system` adds the
  super-admin flag and a required `X-Backup-Passphrase` header.
- `POST /api/data-transfer/step-up` — re-authentication (password + TOTP)
  minting the `X-Step-Up` token; auth + IP rate limit only.
- `GET /api/data-transfer/history` — `data_transfer:view`.
- `POST /api/data-transfer/import/uploads` — `data_transfer:import`; streams
  the backup file (≤256 MB) to a staged upload; returns
  `{uploadId, bytes, detectedFormat}`.
- `POST /api/data-transfer/import/preview` — `data_transfer:import`;
  `{uploadId}` → pre-flight diff.
- `POST /api/data-transfer/import/execute` — `data_transfer:import` plus
  conditional `import_sensitive` / `override` / `restore` (+ step-up on
  restore) depending on the file and request;
  `{uploadId, mode, onConflict?, tables?, confirm: true}` → `202 {jobId}`.
- `GET /api/data-transfer/import/jobs/{jobId}` — `data_transfer:import`;
  poll job status/result.
- `DELETE /api/data-transfer/import/uploads/{uploadId}` —
  `data_transfer:import`; discard a staged file.

The file format, entity coverage, and semantics are documented in
[`../guides/data-transfer.md`](../guides/data-transfer.md).

## gRPC / Connect (partial rollout)

The same process serves tonic gRPC + gRPC-Web (Connect protocol) services at
root-level paths — a strangler migration, not a second API surface
(ADR 014):

| Service | Path prefix |
|---|---|
| `hotel.rooms.v1.RoomService` | `/hotel.rooms.v1.RoomService/<Method>` |
| `hotel.rooms.v1.RoomTypeService` | `/hotel.rooms.v1.RoomTypeService/<Method>` |
| `hotel.housekeeping.v1.HousekeepingService` | `/hotel.housekeeping.v1.HousekeepingService/<Method>` |
| `hotel.housekeeping.v1.MaintenanceService` | `/hotel.housekeeping.v1.MaintenanceService/<Method>` |
| `hotel.guests.v1.GuestService` | `/hotel.guests.v1.GuestService/<Method>` |

gRPC health and reflection (v1 + v1alpha) are also mounted for tooling.
Authorization mirrors the REST routes — the adapters in `src/grpc/` call the
same permission checks and service layer, so a method and its REST twin have
identical access rules. Protobuf contracts live in `proto/`; the browser
clients in `hotel-web-fe/src/gen/` are generated from them and enabled per
context (`rooms`, `housekeeping`, `maintenance`, `guests`) by
`src/api/grpc/flags.ts`. A disabled context calls REST — REST is the default
and the fallback for every domain. The OpenAPI index above covers REST only.
Migration working record: [`../architecture/grpc-migration/`](../architecture/grpc-migration/).

## Realtime

WebSocket upgrades live under `/api`: `/api/updates/socket` (staff data-change
hub, `modules/realtime` — token via `Sec-WebSocket-Protocol`, session checked
before upgrade), `/api/admin/loyalty/socket` (staff loyalty),
`/api/guest-portal/me/{loyalty,support}/socket` (guest), and
`/api/guest-portal/me/availability` (availability push). Payloads are domain
names only — clients refetch through permission-checked REST queries. Clients
reconnect with capped exponential backoff and lagged-drop is logged
server-side. There is no SSE endpoint (ADR 015). `/ws/status` is a plain JSON
status probe, not an upgrade endpoint.
