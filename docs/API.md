# API Reference

The machine-readable route index is [`api/openapi.json`](api/openapi.json) —
generated from the router and kept honest by `tests/openapi_drift.rs` (a CI
gate: any route add/remove/update fails CI until regenerated).

Regenerate after changing routes:

```bash
cd hotel-app-be
HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift
```

The OpenAPI document is a method+path index (366 operations across ~300
paths). This page documents the cross-cutting contract every endpoint shares;
for per-endpoint request/response shapes read the handler and model files —
`src/handlers/<domain>.rs` and `src/models/<domain>.rs` are the source of
truth.

## Base URL

- Dev: `http://localhost:3030` (Vite proxies `/api`, `/uploads`, `/health`,
  `/ws` to it)
- All application routes live under `/api/*` except `/webhooks/*` and
  `/health`, `/ws`.

## Authentication

| Surface | Mechanism |
|---|---|
| Staff API (`/api/**`) | `Authorization: Bearer <access_token>` — short-lived JWT minted by `POST /api/auth/login` or `POST /api/auth/refresh` |
| Refresh | HttpOnly cookie on the refresh endpoint; tokens are revocable DB rows |
| Guest portal (`/api/guest-portal/**`) | Guest session cookie/bearer from `/api/guest-portal/auth/*`; booking access tokens for pre-check-in links |
| Webhooks (`/webhooks/paypal`) | **No bearer** — PayPal signature verification + IP rate limit |
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

Grouped by path prefix (counts from `openapi.json`):

| Prefix | Ops | Domain |
|---|---|---|
| `/api/guest-portal/*` | 48 | Guest self-service: auth, bookings, pre-check-in, eKYC, payments, vouchers, support, preferences |
| `/api/admin/*` | 44 | Back-office: RBAC, users, vouchers, system settings, admin actions |
| `/api/auth/*` | 19 | Login/refresh/logout, password, passkey, 2FA, Google |
| `/api/rooms*`, `/api/room-types`, `/api/room-rates` | ~25 | Inventory and pricing |
| `/api/bookings*`, `/api/booking` | ~25 | Booking lifecycle |
| `/api/guests*` | 14 | Guest records |
| `/api/ekyc*` | 15 | eKYC submissions + review queue |
| `/api/profile/*` | 12 | Self-service profile/settings |
| `/api/rbac/*` | 10 | Role/permission management |
| `/api/ledgers*`, `/api/payments*`, `/api/invoices*` | ~21 | Money |
| `/api/promotions*`, `/api/loyalty*` | ~7 | Marketing |
| `/api/night-audit*`, `/api/audit-logs*`, `/api/analytics*`, `/api/reports*` | ~17 | Ops intelligence |
| `/api/{housekeeping,maintenance,support,teams,communications,data-transfer,settings,booking-channels,companies,search,users,system,updates}*` | rest | Assorted domains |
| `/webhooks/paypal` | 1 | PayPal signature-verified events |

## Realtime

`/ws` upgrades to WebSocket (loyalty + notifications hubs); clients reconnect
with capped exponential backoff and lagged-drop is logged server-side.
