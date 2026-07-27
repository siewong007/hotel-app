# Architecture Flow

Decisions and rationale live in [ADRS.md](ADRS.md); deployment steps live in
[the deployment guide](../guides/deployment.md).

## Web request flow

```text
Browser (React / MUI / TanStack Router and Query)
  └─ src/api/client.ts (ky, bearer token, auth events)
      └─ Vite proxy in development or Caddy in production
          └─ Axum routes, CORS, rate limits, and security headers
              └─ authentication and permission checks
                  └─ handlers
                      └─ services
                          └─ repositories
                              └─ PostgreSQL
```

## Desktop flow

```text
Tauri webview
  └─ Tauri IPC and backend-ready event
      └─ backend sidecar on a dynamically selected localhost port
          └─ bundled PostgreSQL runtime and resources
```

Desktop mode sets `HOTEL_DESKTOP_MODE`. The webview obtains the selected backend
port through Tauri IPC. The sidecar receives an explicit `ALLOWED_ORIGINS` list.

## PostgreSQL V1 lifecycle

A new empty database is initialized exactly once:

```text
database/postgres/migrations/0001_v1_baseline.sql
  → database/postgres/seed.sql
```

Docker, server, and desktop deployments share this sequence. Legacy databases
must be exported and rebuilt rather than upgraded in place. See the
[database lifecycle](../../hotel-app-be/database/README.md).

## Payments and PayPal webhooks

Two capture paths converge on one policy: the synchronous capture
(`services/payments.rs::capture_paypal_payment`) and the inbound webhook
(`/webhooks/paypal` → `routes/webhooks.rs` → `handlers/webhooks.rs`). Both
verify the captured amount against the stored payment row — never the editable
booking total. On a mismatch after money has moved they write a
`paypal_capture_conflict` / `paypal_webhook_conflict` audit event and leave the
payment untouched for staff review; a payment is only marked failed when money
never moved. Webhook routes carry no bearer auth by design — each delivery is
cryptographically verified and IP rate-limited; unhandled event types are
audit-logged as `paypal_webhook_ignored` and acknowledged. Conflicts surface on
the admin Payment Approvals page (requires `payments:read` + `audit:read`).
Payments RBAC lives at the route layer: every wrapper in `routes/payments.rs`
calls `require_permission_helper` before its handler.

## Hotel business day

The hotel timezone lives in `system_settings.timezone` and is applied to every
pooled connection (`core/db.rs`), so SQL `CURRENT_DATE` is the hotel business
day. Rust code must use `core/db.rs::hotel_today(executor)` for business-day
decisions (due dates, occupancy gating, report windows) — never
`chrono::Local`/`Utc` date math.

## Guest portal security

Pre-checkin tokens are 256-bit (`generate_session_token`) and invalidated on
submit; the portal has logout/revoke and `/guest_portal/me/*` is rate-limited.
Every portal mutation writes an audit event. Portal booking creation is
race-safe: `lock_room_type_tx` (`FOR UPDATE`) plus `allocate_room_tx`
(`FOR UPDATE SKIP LOCKED`) guarantee a single winner for the last room.

## Communications (email)

`modules/communications/`: SMTP via lettre (delivery worker spawned in
`main.rs` when `SMTP_*` env vars are set), campaign scheduler, per-guest
notification preferences (`/guest-portal/me/notification-preferences`), and
booking-confirmation deliveries queued from the guest-booking and payment
paths.

## Realtime resilience

WebSocket hubs log lagged-drop counts; frontend sockets reconnect with capped
exponential backoff plus jitter; the HTTP client honors `Retry-After` on
413/429/503.

## Important wiring checks

- Merge every new backend router in `routes/mod.rs`.
- Add new top-level API prefixes to `hotel-web-fe/vite.config.ts`.
- Register new pages in both `src/routes/` and `src/navigation/routeRegistry.tsx`.
- Keep SQL parameterized and validate it against PostgreSQL.
