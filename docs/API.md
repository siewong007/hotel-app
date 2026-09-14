# API Reference

The machine-readable route index is [`api/openapi.json`](api/openapi.json) —
generated from the router and kept honest by `tests/openapi_drift.rs` (a CI
gate: any route add/remove/update fails CI until regenerated).

Regenerate after changing routes:

```bash
cd hotel-app-be
HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift
```

The OpenAPI document is a method+path index (424 operations across 352
paths). This page documents the cross-cutting contract every endpoint shares;
for per-endpoint request/response shapes read the handler and model files —
`src/handlers/<domain>.rs` and `src/models/<domain>.rs` are the source of
truth.

## Base URL

- Dev: `http://localhost:3030` (Vite proxies `/api`, `/uploads`, `/health`,
  `/ws` to it)
- All application routes live under `/api/*` — including the webhook and
  WebSocket routes. The only root-level paths are `/health` and `/ws/status`
  (a plain status probe, not a socket upgrade).

## Authentication

| Surface | Mechanism |
|---|---|
| Staff API (`/api/**`) | `Authorization: Bearer <access_token>` — short-lived JWT minted by `POST /api/auth/login` or `POST /api/auth/refresh` |
| Refresh | HttpOnly cookie on the refresh endpoint; tokens are revocable DB rows |
| Guest portal (`/api/guest-portal/**`) | Guest session cookie/bearer from `/api/guest-portal/auth/*`; booking access tokens for pre-check-in links |
| Webhooks (`/api/webhooks/paypal`) | **No bearer** — PayPal signature verification + IP rate limit |
| Public endpoints | `/api/promotions`, `/api/promotions/{slug}`, auth/guest-portal public routes, `/health` |

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

In-memory token buckets per category (login `sensitive`, writes, portal
tokens, webhooks, general). `Retry-After` is returned where applicable.
Single-instance scope — see ADR 005.

## Idempotency

Staff payment-creation endpoints accept a client-generated `Idempotency-Key`‑style
field in the body; the server stores the key + a SHA-256 fingerprint of the
material request. Exact replay returns the original payment; same key with
different fields → `409`.

## Endpoint domains

Grouped by path prefix (counts from `openapi.json`, 424 ops total):

| Prefix | Ops | Domain |
|---|---|---|
| `/api/admin/*` | 66 | Back-office: communications, loyalty, promotions, payments, segments, vouchers, online-inventory |
| `/api/guest-portal/*` | 51 | Guest self-service: auth, bookings, pre-check-in, eKYC, payments, vouchers, support, preferences |
| `/api/guests*` | 31 | Guest records + guest-relations interactions/preferences/reviews |
| `/api/bookings*`, `/api/booking*` | 32 | Booking lifecycle |
| `/api/rooms*`, `/api/room-types`, `/api/room-rates` | 35 | Inventory and pricing |
| `/api/auth/*` | 20 | Login/refresh/logout, password, passkey, 2FA, Google |
| `/api/users*` | 17 | Staff user management |
| `/api/ekyc*` | 16 | eKYC submissions + review queue |
| `/api/rbac/*` | 15 | Role/permission management |
| `/api/ledgers*`, `/api/payments*`, `/api/invoices*` | 29 | Money |
| `/api/profile/*` | 14 | Self-service profile/settings |
| `/api/teams*` | 8 | Team management |
| `/api/data-transfer/*` | 7 | `hotel-backup` JSON export + staged import pipeline — see below |
| `/api/night-audit*`, `/api/audit-logs*`, `/api/analytics*`, `/api/insights*`, `/api/reports*` | ~20 | Ops intelligence |
| `/api/{housekeeping,maintenance,support,communications,settings,booking-channels,companies,search,rate-plans,market-codes,rate-codes,rate-management,complimentary,revenue,promotions,loyalty,guest-relations,system,updates}*` | rest | Assorted domains |
| `/api/webhooks/paypal` | 1 | PayPal signature-verified events |
| `/health`, `/ws/status` | 2 | Infrastructure probes (root level) |

### Data transfer

`GET /api/data-transfer/export` and `GET /api/data-transfer/export/preview` run
under `settings:manage`; the five import endpoints are super-admin only
(`users.is_super_admin`):

- `POST /api/data-transfer/import/uploads` — stream the backup file (≤256 MB)
  to a staged upload; returns `{uploadId, bytes, detectedFormat}`.
- `POST /api/data-transfer/import/preview` — `{uploadId}` → pre-flight diff.
- `POST /api/data-transfer/import/execute` — `{uploadId, mode, onConflict?,
  tables?, confirm: true}` → `202 {jobId}`.
- `GET /api/data-transfer/import/jobs/{jobId}` — poll job status/result.
- `DELETE /api/data-transfer/import/uploads/{uploadId}` — discard a staged file.

The file format, entity coverage, and semantics are documented in
[`guides/data-transfer.md`](guides/data-transfer.md).

## Realtime

WebSocket upgrades live under `/api`: `/api/updates/socket` (staff data-change
hub, `modules/realtime`), `/api/admin/loyalty/socket` (staff loyalty), and
`/api/guest-portal/me/{loyalty,support}/socket` (guest). Clients reconnect
with capped exponential backoff and lagged-drop is logged server-side.
`/ws/status` is a plain JSON status probe, not an upgrade endpoint.
